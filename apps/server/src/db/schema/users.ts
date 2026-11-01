import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Feature, OnboardingState, TierLimits } from '@lumen/shared';
import { roleEnum, userStatusEnum } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    avatarKey: text('avatar_key'),
    bio: text('bio').notNull().default(''),
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en'),
    pronouns: text('pronouns'),
    role: roleEnum('role').notNull().default('user'),
    status: userStatusEnum('status').notNull().default('active'),
    statusReason: text('status_reason'),
    tierId: text('tier_id'),
    overrides: jsonb('overrides').$type<{ features?: Partial<Record<Feature, boolean>>; limits?: Partial<TierLimits> }>(),
    onboarding: jsonb('onboarding')
      .$type<OnboardingState>()
      .notNull()
      .default(sql`'{"step":0,"completed":false,"useCases":[]}'::jsonb`),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    /** Last accepted TOTP time step; codes at or before it are rejected (replay protection). */
    totpLastStep: integer('totp_last_step'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    tosVersionAccepted: text('tos_version_accepted'),
    birthYear: integer('birth_year'),
    deletionScheduledFor: timestamp('deletion_scheduled_for', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    index('users_created_at_idx').on(t.createdAt),
    index('users_role_idx').on(t.role),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
