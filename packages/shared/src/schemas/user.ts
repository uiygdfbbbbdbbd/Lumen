import { z } from 'zod';
import { displayNameSchema, localeSchema, timezoneSchema } from './common.js';
import { roleSchema } from './auth.js';

export const USE_CASES = ['coding', 'writing', 'research', 'learning', 'business', 'creative', 'other'] as const;
export type UseCase = (typeof USE_CASES)[number];

export const THEME_MODES = ['light', 'dark', 'system'] as const;

export const onboardingSchema = z.object({
  step: z.number().int().min(0).max(7),
  completed: z.boolean(),
  useCases: z.array(z.enum(USE_CASES)).max(USE_CASES.length),
  themeId: z.string().max(64).optional(),
  themeMode: z.enum(THEME_MODES).optional(),
  defaultModel: z.string().max(200).optional(),
  notifications: z
    .object({ email: z.boolean(), push: z.boolean(), productUpdates: z.boolean() })
    .partial()
    .optional(),
  tourCompleted: z.boolean().optional(),
});
export type OnboardingState = z.infer<typeof onboardingSchema>;
export const onboardingPatchSchema = onboardingSchema.partial();

export const profilePatchSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: z.string().trim().max(500).optional(),
  timezone: timezoneSchema.optional(),
  locale: localeSchema.optional(),
  pronouns: z.string().trim().max(40).nullable().optional(),
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string(),
  timezone: z.string(),
  locale: z.string(),
  pronouns: z.string().nullable(),
  role: roleSchema,
  status: z.enum(['active', 'suspended', 'banned', 'pending_deletion']),
  totpEnabled: z.boolean(),
  onboarding: onboardingSchema,
  createdAt: z.string(),
  deletionScheduledFor: z.string().nullable(),
});
export type Me = z.infer<typeof meSchema>;

export const userPreferencesSchema = z.object({
  defaultModel: z.string().max(200).optional(),
  favoriteModels: z.array(z.string().max(200)).max(50).optional(),
  recentModels: z.array(z.string().max(200)).max(20).optional(),
  thinkingEffort: z.enum(['off', 'low', 'medium', 'high']).optional(),
  sendWithEnter: z.boolean().optional(),
  autoTitle: z.boolean().optional(),
  showSuggestions: z.boolean().optional(),
  defaultStyle: z.string().max(64).optional(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
