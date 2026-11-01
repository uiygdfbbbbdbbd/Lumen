import { z } from 'zod';
import { displayNameSchema, emailSchema, passwordSchema } from './common.js';
import { ROLES } from '../policy.js';

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  inviteCode: z.string().trim().max(64).optional(),
  captchaToken: z.string().max(4096).optional(),
  acceptTerms: z.literal(true, { message: 'You must accept the terms.' }),
  /** Required when the age gate is enabled. */
  birthYear: z.number().int().min(1900).max(2100).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().trim().max(32).optional(),
  captchaToken: z.string().max(4096).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const tokenSchema = z.object({ token: z.string().min(16).max(256) });
export const requestEmailSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(16).max(256), password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
export const changeEmailSchema = z.object({ newEmail: emailSchema, password: z.string().min(1).max(256) });

export const totpConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const totpDisableSchema = z.object({ password: z.string().min(1).max(256), code: z.string().regex(/^\d{6}$/) });

export const roleSchema = z.enum(ROLES);

export const sessionInfoSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  location: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const loginEventSchema = z.object({
  id: z.string(),
  success: z.boolean(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  location: z.string().nullable(),
  createdAt: z.string(),
});
export type LoginEvent = z.infer<typeof loginEventSchema>;
