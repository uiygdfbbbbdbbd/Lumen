import { z } from 'zod';

export const MEMORY_CATEGORIES = ['profile', 'preferences', 'projects', 'people', 'tasks', 'other'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: 'About you',
  preferences: 'Preferences',
  projects: 'Projects',
  people: 'People',
  tasks: 'Tasks & plans',
  other: 'Other',
};
export const MEMORY_MAX_CHARS = 500;

export const memoryContentSchema = z.string().trim().min(1, 'A memory can’t be empty.').max(MEMORY_MAX_CHARS, `Keep memories under ${MEMORY_MAX_CHARS} characters.`);

export const createMemorySchema = z.object({
  content: memoryContentSchema,
  category: z.enum(MEMORY_CATEGORIES).default('other'),
  /** Null/absent = remembered everywhere; a project id = only inside that project. */
  projectId: z.string().uuid().nullable().optional(),
  pinned: z.boolean().optional(),
});

export const updateMemorySchema = z
  .object({
    content: memoryContentSchema.optional(),
    category: z.enum(MEMORY_CATEGORIES).optional(),
    projectId: z.string().uuid().nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

export const listMemoriesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(MEMORY_CATEGORIES).optional(),
  /** "global", "all", or a project id. */
  scope: z.union([z.enum(['global', 'all']), z.string().uuid()]).default('all'),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const memoryImportPreviewSchema = z.object({ text: z.string().min(1).max(200_000) });
export const memoryImportSchema = z.object({
  entries: z.array(z.object({ content: memoryContentSchema, category: z.enum(MEMORY_CATEGORIES) })).min(1).max(1000),
  projectId: z.string().uuid().nullable().optional(),
});
