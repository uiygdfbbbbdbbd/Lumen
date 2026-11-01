import { z } from 'zod';

export const THINKING = ['off', 'low', 'medium', 'high'] as const;

export const BUILTIN_STYLES = {
  normal: { name: 'Normal', instructions: '' },
  concise: { name: 'Concise', instructions: 'Be brief and direct. Prefer short paragraphs and bullet points. Skip preamble and filler.' },
  detailed: { name: 'Detailed', instructions: 'Give thorough, well-structured answers with headings, examples and caveats where useful.' },
  explanatory: { name: 'Explanatory', instructions: 'Explain your reasoning step by step and define terms a newcomer might not know.' },
  formal: { name: 'Formal', instructions: 'Use a professional, formal tone suitable for business correspondence.' },
  casual: { name: 'Casual', instructions: 'Use a relaxed, friendly, conversational tone.' },
  learning: {
    name: 'Learning (Socratic)',
    instructions: 'Act as a tutor. Guide the user to the answer with questions and hints instead of giving it outright. Check understanding before moving on.',
  },
} as const;
export type BuiltinStyleId = keyof typeof BUILTIN_STYLES;

export const conversationSettingsSchema = z.object({
  thinkingEffort: z.enum(THINKING).optional(),
  temperature: z.number().min(0).max(2).optional(),
  styleId: z.string().max(64).optional(),
  useMemory: z.boolean().optional(),
});

export const createConversationSchema = z.object({
  title: z.string().trim().max(200).optional(),
  modelId: z.string().max(200).nullable().optional(),
  incognito: z.boolean().default(false),
  instructions: z.string().max(8000).default(''),
  settings: conversationSettingsSchema.default({}),
  projectId: z.string().uuid().nullable().optional(),
});

export const conversationPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    modelId: z.string().max(200).nullable(),
    instructions: z.string().max(8000),
    settings: conversationSettingsSchema,
    pinned: z.boolean(),
    starred: z.boolean(),
    archived: z.boolean(),
    activeLeafId: z.string().uuid(),
    projectId: z.string().uuid().nullable(),
  })
  .partial()
  .strict();

export const sendMessageSchema = z.object({
  content: z.string().max(200_000),
  /** Parent of the new user message. Omit to append to the active branch. null = new root. */
  parentId: z.string().uuid().nullable().optional(),
  modelId: z.string().max(200).optional(),
  /** 2-4 models for side-by-side compare mode. */
  compareModelIds: z.array(z.string().max(200)).min(2).max(4).optional(),
  thinkingEffort: z.enum(THINKING).optional(),
  /** Uploaded file ids to attach to this message. */
  attachments: z.array(z.string().uuid()).max(20).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const regenerateSchema = z.object({ modelId: z.string().max(200).optional(), thinkingEffort: z.enum(THINKING).optional() });
export const editMessageSchema = z.object({ content: z.string().min(1).max(200_000), modelId: z.string().max(200).optional() });
export const feedbackSchema = z.object({ rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]), reason: z.string().max(1000).optional() });

export const listConversationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
  archived: z.enum(['true', 'false']).optional(),
  starred: z.enum(['true', 'false']).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  modelId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  archived: z.enum(['true', 'false', 'any']).default('any'),
});

export const bulkConversationSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['archive', 'unarchive', 'delete', 'star', 'unstar', 'pin', 'unpin']),
});

export const styleInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  instructions: z.string().trim().min(1).max(4000),
});
export const styleFromSampleSchema = z.object({ name: z.string().trim().min(1).max(60), sample: z.string().trim().min(50).max(20_000) });

/** Events on a message stream (SSE `data:` payloads). `seq` enables resume via Last-Event-ID. */
export type ChatStreamEvent =
  | { type: 'start'; messageId: string; model: { id: string | null; name: string | null } }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; content: string; isError: boolean }
  | { type: 'fallback'; from: string; to: string; reason: string }
  | { type: 'compacted'; tokensBefore: number; tokensAfter: number }
  | { type: 'artifact'; id: string; version: number; title: string; artifactType: string; action: 'created' | 'updated' }
  | { type: 'citations'; items: { n: number; chunkId: string; fileId: string; fileName: string; location: { page?: number; section?: string }; snippet: string }[] }
  | { type: 'usage'; inputTokens: number; outputTokens: number; contextTokens: number; contextWindow: number }
  | { type: 'done'; status: 'complete' | 'cancelled'; finishReason: string }
  | { type: 'error'; code: string; message: string; resetAt?: string; retryable: boolean };

/** Events on the per-user realtime channel (WebSocket) for cross-tab/device sync. */
export type RealtimeEvent =
  | { type: 'conversation.upsert'; conversationId: string }
  | { type: 'conversation.deleted'; conversationId: string }
  | { type: 'message.upsert'; conversationId: string; messageId: string }
  | { type: 'stream.started'; conversationId: string; messageId: string }
  | { type: 'stream.finished'; conversationId: string; messageId: string };
