import { and, desc, eq, lte } from 'drizzle-orm';
import sharp, { type Metadata } from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { LumenError, onboardingSchema, type Me, type OnboardingState, type ProfilePatch } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { loginEvents, sessions, users, type UserRow } from '../../db/schema/index.js';
import { randomToken } from '../../lib/tokens.js';
import type { AuditService } from '../audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { StorageDriver } from '../storage/storage.js';
import type { PasswordHasher } from '../../lib/password.js';

export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const AVATAR_SIZE = 512;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Modules register exporters so the account export grows as features are added (chats, files, memory...). */
export type DataExporter = (userId: string) => Promise<Record<string, Uint8Array>>;

export class UserService {
  private readonly exporters: { name: string; fn: DataExporter }[] = [];

  constructor(
    private readonly db: Database,
    private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly hasher: PasswordHasher,
    private readonly apiUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  registerExporter(name: string, fn: DataExporter) {
    this.exporters.push({ name, fn });
  }

  avatarUrl(user: Pick<UserRow, 'avatarKey'>): string | null {
    return user.avatarKey ? `${this.apiUrl}/api/avatars/${user.avatarKey.split('/').slice(1).join('/')}` : null;
  }

  toMe(user: UserRow): Me {
    const onboarding = onboardingSchema.safeParse(user.onboarding);
    return {
      id: user.id,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      displayName: user.displayName,
      avatarUrl: this.avatarUrl(user),
      bio: user.bio,
      timezone: user.timezone,
      locale: user.locale,
      pronouns: user.pronouns,
      role: user.role,
      status: user.status,
      totpEnabled: user.totpEnabled,
      onboarding: onboarding.success ? onboarding.data : { step: 0, completed: false, useCases: [] },
      createdAt: user.createdAt.toISOString(),
      deletionScheduledFor: user.deletionScheduledFor?.toISOString() ?? null,
    };
  }

  async get(id: string): Promise<UserRow> {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw new LumenError('NOT_FOUND', 'User not found.');
    return u;
  }

  async updateProfile(user: UserRow, patch: ProfilePatch): Promise<UserRow> {
    const [u] = await this.db
      .update(users)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(users.id, user.id))
      .returning();
    return u!;
  }

  async patchOnboarding(user: UserRow, patch: Partial<OnboardingState>): Promise<UserRow> {
    const current = onboardingSchema.safeParse(user.onboarding);
    const merged = onboardingSchema.parse({ ...(current.success ? current.data : { step: 0, completed: false, useCases: [] }), ...patch });
    // Steps only move forward unless explicitly restarted from 0.
    if (current.success && patch.step !== undefined && patch.step !== 0 && patch.step < current.data.step) merged.step = current.data.step;
    const [u] = await this.db.update(users).set({ onboarding: merged, updatedAt: this.now() }).where(eq(users.id, user.id)).returning();
    return u!;
  }

  /**
   * Validate + normalize an uploaded image: decode with sharp (rejects non-images and polyglots that
   * don't decode), optional crop, square resize, re-encode to WebP. Re-encoding strips EXIF/GPS and any
   * embedded payloads. SVG is rejected outright (scriptable).
   */
  async setAvatar(user: UserRow, data: Buffer, crop?: CropRect): Promise<UserRow> {
    if (data.length > MAX_AVATAR_BYTES) throw new LumenError('PAYLOAD_TOO_LARGE', 'Avatar must be 8 MB or smaller.');
    let meta: Metadata;
    try {
      meta = await sharp(data, { limitInputPixels: 40_000_000 }).metadata();
    } catch {
      throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'That file is not a supported image.');
    }
    if (!meta.format || !['jpeg', 'png', 'webp', 'gif', 'avif', 'heif'].includes(meta.format)) {
      throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'Use a JPEG, PNG, WebP, GIF or AVIF image.');
    }
    let img = sharp(data, { limitInputPixels: 40_000_000, animated: false }).rotate();
    if (crop && meta.width && meta.height) {
      const left = Math.max(0, Math.min(Math.round(crop.x), meta.width - 1));
      const top = Math.max(0, Math.min(Math.round(crop.y), meta.height - 1));
      const width = Math.max(1, Math.min(Math.round(crop.width), meta.width - left));
      const height = Math.max(1, Math.min(Math.round(crop.height), meta.height - top));
      img = img.extract({ left, top, width, height });
    }
    const out = await img.resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    const key = `avatars/${user.id}/${randomToken(12)}.webp`;
    await this.storage.put(key, out, 'image/webp');
    if (user.avatarKey) await this.storage.delete(user.avatarKey).catch(() => undefined);
    const [u] = await this.db.update(users).set({ avatarKey: key, updatedAt: this.now() }).where(eq(users.id, user.id)).returning();
    return u!;
  }

  async removeAvatar(user: UserRow): Promise<UserRow> {
    if (user.avatarKey) await this.storage.delete(user.avatarKey).catch(() => undefined);
    const [u] = await this.db.update(users).set({ avatarKey: null, updatedAt: this.now() }).where(eq(users.id, user.id)).returning();
    return u!;
  }

  async scheduleDeletion(user: UserRow, password: string | undefined, ip: string): Promise<UserRow> {
    if (user.role === 'super_admin') {
      throw new LumenError('FORBIDDEN', 'Transfer the super admin role before deleting this account.');
    }
    if (user.passwordHash && !(password && (await this.hasher.verify(user.passwordHash, password)))) {
      throw new LumenError('INVALID_CREDENTIALS', 'Password is incorrect.');
    }
    const { accountDeletionGraceDays } = await this.settings.get('security');
    const when = new Date(this.now().getTime() + accountDeletionGraceDays * 86400_000);
    const [u] = await this.db
      .update(users)
      .set({ status: 'pending_deletion', deletionScheduledFor: when, updatedAt: this.now() })
      .where(eq(users.id, user.id))
      .returning();
    await this.audit.log({ actorId: user.id, action: 'account.deletion_scheduled', targetType: 'user', targetId: user.id, ip, metadata: { when: when.toISOString() } });
    return u!;
  }

  async cancelDeletion(user: UserRow, ip: string): Promise<UserRow> {
    if (user.status !== 'pending_deletion') throw new LumenError('CONFLICT', 'No deletion is scheduled.');
    const [u] = await this.db
      .update(users)
      .set({ status: 'active', deletionScheduledFor: null, updatedAt: this.now() })
      .where(eq(users.id, user.id))
      .returning();
    await this.audit.log({ actorId: user.id, action: 'account.deletion_cancelled', targetType: 'user', targetId: user.id, ip });
    return u!;
  }

  /** Hard-delete accounts whose grace period has ended. Called by the worker. */
  async purgeDueDeletions(): Promise<number> {
    const due = await this.db
      .select()
      .from(users)
      .where(and(eq(users.status, 'pending_deletion'), lte(users.deletionScheduledFor, this.now())));
    for (const u of due) {
      if (u.avatarKey) await this.storage.delete(u.avatarKey).catch(() => undefined);
      await this.db.delete(users).where(eq(users.id, u.id));
      await this.audit.log({ actorId: null, action: 'account.purged', targetType: 'user', targetId: u.id });
    }
    return due.length;
  }

  /** Full export as a zip: profile, sessions, login history, plus everything registered exporters add. */
  async exportData(user: UserRow): Promise<Uint8Array> {
    const files: Record<string, Uint8Array> = {};
    const profile = this.toMe(user);
    files['profile.json'] = strToU8(JSON.stringify(profile, null, 2));
    const s = await this.db.select().from(sessions).where(eq(sessions.userId, user.id));
    files['sessions.json'] = strToU8(
      JSON.stringify(s.map(({ tokenHash: _t, prevTokenHash: _p, ...rest }) => rest), null, 2),
    );
    const logins = await this.db.select().from(loginEvents).where(eq(loginEvents.userId, user.id)).orderBy(desc(loginEvents.createdAt));
    files['login-history.json'] = strToU8(JSON.stringify(logins, null, 2));
    if (user.avatarKey) {
      const obj = await this.storage.get(user.avatarKey);
      if (obj) files['attachments/avatar.webp'] = new Uint8Array(Buffer.concat(await obj.body.toArray()));
    }
    for (const exp of this.exporters) {
      const part = await exp.fn(user.id);
      for (const [name, data] of Object.entries(part)) files[`${exp.name}/${name}`] = data;
    }
    files['README.txt'] = strToU8(`Data export for ${user.email}\nGenerated ${this.now().toISOString()}\n`);
    return zipSync(files, { level: 6 });
  }
}
