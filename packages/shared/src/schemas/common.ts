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
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
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

/**
 * Turn a create-schema into a PATCH schema: every field optional and *without* defaults.
 * (`.partial()` keeps `.default()` values, which would silently reset omitted fields on update.)
 */
export function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>): z.ZodType<Partial<z.output<z.ZodObject<S>>>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let inner = field as z.ZodType;
    while (inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
    shape[key] = inner.optional();
  }
  return z.object(shape).strict() as unknown as z.ZodType<Partial<z.output<z.ZodObject<S>>>>;
}
