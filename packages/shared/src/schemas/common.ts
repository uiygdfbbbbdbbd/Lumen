import { z } from 'zod';

export const idSchema = z.string().uuid();
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email({ message: 'Enter a valid email address.' });
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(256, 'Use at most 256 characters.');
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(80)
  .refine((s) => !/[\u0000-\u001f\u007f<>]/.test(s), 'Name contains invalid characters.');
export const timezoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone.');
export const localeSchema = z.string().regex(/^[a-z]{2,3}(-[A-Z][a-zA-Z]{1,3})?$/, 'Invalid locale.');
export const isoDateSchema = z.string().datetime();
