import { asc, eq } from 'drizzle-orm';
import { strToU8 } from 'fflate';
import type { Database } from '../../db/client.js';
import { conversations, files, messages, projects } from '../../db/schema/index.js';
import type { StorageDriver } from '../storage/storage.js';
import type { UserService } from './user.service.js';

/** Plug chat history, projects and uploaded files into the account data export. */
export function registerExporters(users: UserService, db: Database, storage: StorageDriver) {
  users.registerExporter('conversations', async (userId) => {
    const convs = await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(asc(conversations.createdAt));
    const out: Record<string, Uint8Array> = {};
    for (const c of convs) {
      if (c.incognito) continue;
      const msgs = await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(asc(messages.createdAt));
      out[`${c.id}.json`] = strToU8(
        JSON.stringify(
          {
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            projectId: c.projectId,
            instructions: c.instructions,
            activeLeafId: c.activeLeafId,
            messages: msgs.map((m) => ({ id: m.id, parentId: m.parentId, role: m.role, content: m.content, model: m.modelName, createdAt: m.createdAt, parts: m.parts })),
          },
          null,
          2,
        ),
      );
    }
    return out;
  });
  users.registerExporter('projects', async (userId) => {
    const rows = await db.select().from(projects).where(eq(projects.ownerId, userId));
    return { 'projects.json': strToU8(JSON.stringify(rows, null, 2)) };
  });
  users.registerExporter('files', async (userId) => {
    const rows = await db.select().from(files).where(eq(files.userId, userId));
    const out: Record<string, Uint8Array> = { 'files.json': strToU8(JSON.stringify(rows.map(({ text: _t, ...r }) => r), null, 2)) };
    for (const f of rows) {
      if (!f.storageKey || f.status === 'quarantined') continue;
      const obj = await storage.get(f.storageKey);
      if (obj) out[`attachments/${f.id}-${f.name}`] = new Uint8Array(Buffer.concat(await obj.body.toArray()));
    }
    return out;
  });
}
