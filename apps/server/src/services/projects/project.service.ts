import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { LumenError } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { conversations, files, projectMembers, projects, usageEvents, type ProjectRow, type UserRow } from '../../db/schema/index.js';
import type { AuditService } from '../audit/audit.service.js';
import type { FileAccess } from '../files/file.service.js';
import { serializeFile } from '../files/file.service.js';
import type { StorageDriver } from '../storage/storage.js';
import { getTemplate } from './templates.js';

export type ProjectRole = 'viewer' | 'editor' | 'owner';
const RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).default(''),
  icon: z.string().regex(/^[a-z0-9-]{1,32}$/).default('folder'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#5b4bdb'),
  instructions: z.string().max(16_000).default(''),
  defaultModelId: z.string().max(200).nullable().default(null),
  defaultStyleId: z.string().max(64).nullable().default(null),
  templateId: z.string().max(64).optional(),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

/** Portable project file (no binary attachments; notes and URLs are included). */
export const projectExportSchema = z.object({
  format: z.literal('lumen.project'),
  version: z.literal(1),
  project: projectInputSchema.omit({ templateId: true }),
  notes: z.array(z.object({ name: z.string().max(200), text: z.string().max(2_000_000) })).max(500),
  urls: z.array(z.object({ url: z.string().url(), recrawlHours: z.number().int().min(1).max(24 * 365).nullable() })).max(500),
});
export type ProjectExport = z.infer<typeof projectExportSchema>;

export function serializeProject(p: ProjectRow, role: ProjectRole) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    icon: p.icon,
    color: p.color,
    instructions: p.instructions,
    defaultModelId: p.defaultModelId,
    defaultStyleId: p.defaultStyleId,
    templateId: p.templateId,
    archived: p.archived,
    role,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export class ProjectService implements FileAccess {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async role(user: Pick<UserRow, 'id'>, projectId: string): Promise<ProjectRole | null> {
    const [p] = await this.db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
    if (!p) return null;
    if (p.ownerId === user.id) return 'owner';
    const [m] = await this.db.select({ role: projectMembers.role }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)));
    return m?.role ?? null;
  }

  async require(user: Pick<UserRow, 'id'>, projectId: string, min: ProjectRole): Promise<{ project: ProjectRow; role: ProjectRole }> {
    const role = await this.role(user, projectId);
    if (!role) throw new LumenError('NOT_FOUND', 'Project not found.');
    if (RANK[role] < RANK[min]) throw new LumenError('FORBIDDEN', min === 'owner' ? 'Only the project owner can do that.' : 'You have view-only access to this project.');
    const [project] = await this.db.select().from(projects).where(eq(projects.id, projectId));
    return { project: project!, role };
  }

  async assertProject(user: UserRow, projectId: string, write: boolean): Promise<void> {
    await this.require(user, projectId, write ? 'editor' : 'viewer');
  }

  async list(user: UserRow, archived = false) {
    const memberOf = this.db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, user.id));
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.archived, archived), or(eq(projects.ownerId, user.id), inArray(projects.id, memberOf))))
      .orderBy(desc(projects.updatedAt));
    const roles = await this.db.select().from(projectMembers).where(eq(projectMembers.userId, user.id));
    return rows.map((p) => serializeProject(p, p.ownerId === user.id ? 'owner' : (roles.find((r) => r.projectId === p.id)?.role ?? 'viewer')));
  }

  async create(user: UserRow, input: ProjectInput, ip: string | null) {
    const t = input.templateId ? getTemplate(input.templateId) : undefined;
    if (input.templateId && !t) throw new LumenError('VALIDATION_FAILED', 'Unknown template.');
    const [p] = await this.db
      .insert(projects)
      .values({
        ownerId: user.id,
        name: input.name,
        description: input.description || t?.description || '',
        icon: input.icon !== 'folder' ? input.icon : (t?.icon ?? 'folder'),
        color: input.color !== '#5b4bdb' ? input.color : (t?.color ?? '#5b4bdb'),
        instructions: input.instructions || t?.instructions || '',
        defaultModelId: input.defaultModelId,
        defaultStyleId: input.defaultStyleId,
        templateId: t?.id ?? null,
      })
      .returning();
    await this.audit.log({ actorId: user.id, action: 'project.created', targetType: 'project', targetId: p!.id, ip });
    return serializeProject(p!, 'owner');
  }

  async update(user: UserRow, id: string, patch: Partial<ProjectInput> & { archived?: boolean }) {
    await this.require(user, id, 'editor');
    const { templateId: _t, ...rest } = patch;
    const [p] = await this.db.update(projects).set({ ...rest, updatedAt: this.now() }).where(eq(projects.id, id)).returning();
    return serializeProject(p!, (await this.role(user, id))!);
  }

  async delete(user: UserRow, id: string, ip: string | null) {
    await this.require(user, id, 'owner');
    const owned = await this.db.select({ key: files.storageKey }).from(files).where(eq(files.projectId, id));
    await this.db.delete(projects).where(eq(projects.id, id));
    for (const f of owned) if (f.key) await this.storage.delete(f.key).catch(() => undefined);
    await this.audit.log({ actorId: user.id, action: 'project.deleted', targetType: 'project', targetId: id, ip });
  }

  /** Dashboard data: recent chats, knowledge, and token usage for chats in this project. */
  async dashboard(user: UserRow, id: string) {
    const { project, role } = await this.require(user, id, 'viewer');
    const chats = await this.db
      .select({ id: conversations.id, title: conversations.title, lastMessageAt: conversations.lastMessageAt, pinned: conversations.pinned })
      .from(conversations)
      .where(and(eq(conversations.projectId, id), eq(conversations.userId, user.id), isNull(conversations.deletedAt)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(50);
    const knowledge = await this.db.select().from(files).where(eq(files.projectId, id)).orderBy(desc(files.createdAt));
    const [usage] = await this.db
      .select({ input: sql<number>`coalesce(sum(${usageEvents.inputTokens}),0)::int`, output: sql<number>`coalesce(sum(${usageEvents.outputTokens}),0)::int` })
      .from(usageEvents)
      .innerJoin(conversations, eq(conversations.id, usageEvents.conversationId))
      .where(eq(conversations.projectId, id));
    return {
      project: serializeProject(project, role),
      chats: chats.map((c) => ({ ...c, lastMessageAt: c.lastMessageAt.toISOString() })),
      knowledge: knowledge.map(serializeFile),
      usage: { inputTokens: usage?.input ?? 0, outputTokens: usage?.output ?? 0 },
      starters: (project.templateId ? getTemplate(project.templateId)?.starters : undefined) ?? [],
    };
  }

  /** Copy settings and knowledge (file bytes are duplicated so the copies are independent). */
  async duplicate(user: UserRow, id: string) {
    const { project } = await this.require(user, id, 'viewer');
    const [copy] = await this.db
      .insert(projects)
      .values({ ownerId: user.id, name: `${project.name} (copy)`, description: project.description, icon: project.icon, color: project.color, instructions: project.instructions, defaultModelId: project.defaultModelId, defaultStyleId: project.defaultStyleId, templateId: project.templateId })
      .returning();
    const knowledge = await this.db.select().from(files).where(eq(files.projectId, id));
    for (const f of knowledge) {
      const [nf] = await this.db
        .insert(files)
        .values({ ...f, id: undefined, userId: user.id, projectId: copy!.id, storageKey: null, createdAt: this.now(), updatedAt: this.now(), status: f.status === 'ready' ? 'ready' : 'failed' })
        .returning();
      if (f.storageKey) {
        const obj = await this.storage.get(f.storageKey);
        if (obj) {
          const key = `files/${user.id}/${nf!.id}`;
          await this.storage.put(key, Buffer.concat(await obj.body.toArray()), f.mimeType);
          await this.db.update(files).set({ storageKey: key }).where(eq(files.id, nf!.id));
        }
      }
      // Chunks are copied so the duplicate is searchable immediately.
      await this.db.execute(sql`
        INSERT INTO file_chunks (file_id, user_id, project_id, ordinal, content, token_count, location, embedding, embedding_model)
        SELECT ${nf!.id}, ${user.id}, ${copy!.id}, ordinal, content, token_count, location, embedding, embedding_model FROM file_chunks WHERE file_id = ${f.id}`);
    }
    return serializeProject(copy!, 'owner');
  }

  async export(user: UserRow, id: string): Promise<ProjectExport> {
    const { project } = await this.require(user, id, 'viewer');
    const knowledge = await this.db.select().from(files).where(eq(files.projectId, id));
    return {
      format: 'lumen.project',
      version: 1,
      project: { name: project.name, description: project.description, icon: project.icon, color: project.color, instructions: project.instructions, defaultModelId: project.defaultModelId, defaultStyleId: project.defaultStyleId },
      notes: knowledge.filter((f) => f.kind !== 'url' && ['text', 'note'].includes(f.kind) && f.text).map((f) => ({ name: f.name, text: f.text! })),
      urls: knowledge.filter((f) => f.kind === 'url' && f.sourceUrl).map((f) => ({ url: f.sourceUrl!, recrawlHours: f.recrawlHours })),
    };
  }
}
