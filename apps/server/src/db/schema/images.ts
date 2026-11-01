import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { conversations } from './chat.js';
import { files } from './files.js';

/** An AI-generated image. Pixels live in `files` (storage, quota, serving); this row keeps how it was made. */
export const generatedImages = pgTable(
  'generated_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    messageId: uuid('message_id'),
    prompt: text('prompt').notNull(),
    revisedPrompt: text('revised_prompt'),
    negativePrompt: text('negative_prompt'),
    aspectRatio: text('aspect_ratio').notNull().default('1:1'),
    modelId: uuid('model_id'),
    modelName: text('model_name'),
    seed: integer('seed'),
    /** Set for variations: the image this one was made from. */
    variationOf: uuid('variation_of'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generated_images_user_idx').on(t.userId, t.createdAt)],
);

export type GeneratedImageRow = typeof generatedImages.$inferSelect;
