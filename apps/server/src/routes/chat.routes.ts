import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  bulkConversationSchema,
  conversationPatchSchema,
  createConversationSchema,
  editMessageSchema,
  feedbackSchema,
  listConversationsQuery,
  LumenError,
  regenerateSchema,
  searchQuerySchema,
  sendMessageSchema,
  styleFromSampleSchema,
  styleInputSchema,
  patchOf,
} from '@lumen/shared';
import type { Container } from '../container.js';
import { route, uuidParams } from '../http/route.js';
import { conversations, messages } from '../db/schema/index.js';
import { summarize } from '../services/chat/conversation.service.js';

const msgParams = z.object({ id: z.string().uuid(), messageId: z.string().uuid() });
const MIN = 60_000;

export function chatRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'POST',
    url: '/api/conversations',
    auth: 'user',
    feature: 'chat',
    body: createConversationSchema,
    rateLimit: { name: 'chat:create', limit: 60, windowMs: MIN, by: 'user' },
    handler: async ({ auth, body, reply }) => {
      if (body.projectId) await c.projects.require(auth.user, body.projectId, 'viewer');
      return reply.code(201).send(summarize(await c.conversations.create(auth.user, body)));
    },
  });
  route(app, c, { method: 'GET', url: '/api/conversations', auth: 'user', query: listConversationsQuery, handler: async ({ auth, query }) => c.conversations.list(auth.user, query) });
  route(app, c, {
    method: 'GET',
    url: '/api/conversations/search',
    auth: 'user',
    query: searchQuerySchema,
    rateLimit: { name: 'chat:search', limit: 60, windowMs: MIN, by: 'user' },
    handler: async ({ auth, query }) => ({ items: await c.conversations.search(auth.user, query) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/conversations/bulk',
    auth: 'user',
    body: bulkConversationSchema,
    handler: async ({ auth, body }) => ({ updated: await c.conversations.bulk(auth.user, body.ids, body.action) }),
  });
  route(app, c, { method: 'GET', url: '/api/conversations/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => c.conversations.tree(auth.user, params.id) });
  route(app, c, {
    method: 'PATCH',
    url: '/api/conversations/:id',
    auth: 'user',
    params: uuidParams,
    body: conversationPatchSchema,
    handler: async ({ auth, params, body }) => {
      if (body.projectId) await c.projects.require(auth.user, body.projectId, 'viewer');
      return summarize(await c.conversations.patch(auth.user, params.id, body));
    },
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/conversations/:id',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => {
      if (!(await c.conversations.softDelete(auth.user, [params.id]))) throw new LumenError('NOT_FOUND', 'Conversation not found.');
    },
  });
  route(app, c, { method: 'POST', url: '/api/conversations/:id/restore', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => summarize(await c.conversations.restore(auth.user, params.id)) });
  route(app, c, { method: 'POST', url: '/api/conversations/:id/duplicate', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => summarize(await c.conversations.duplicate(auth.user, params.id)) });

  route(app, c, {
    method: 'POST',
    url: '/api/conversations/:id/messages',
    auth: 'user',
    feature: 'chat',
    params: uuidParams,
    body: sendMessageSchema,
    bodyLimit: 1024 * 1024,
    rateLimit: { name: 'chat:send', limit: 30, windowMs: MIN, by: 'user' },
    handler: async ({ auth, params, body, reply }) => reply.code(201).send(await c.chat.send(auth.user, auth.entitlements, params.id, body)),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/conversations/:id/messages/:messageId/regenerate',
    auth: 'user',
    feature: 'chat',
    params: msgParams,
    body: regenerateSchema,
    rateLimit: { name: 'chat:send', limit: 30, windowMs: MIN, by: 'user' },
    handler: async ({ auth, params, body, reply }) => reply.code(201).send(await c.chat.regenerate(auth.user, auth.entitlements, params.id, params.messageId, body)),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/conversations/:id/messages/:messageId/edit',
    auth: 'user',
    feature: 'chat',
    params: msgParams,
    body: editMessageSchema,
    rateLimit: { name: 'chat:send', limit: 30, windowMs: MIN, by: 'user' },
    handler: async ({ auth, params, body, reply }) => reply.code(201).send(await c.chat.edit(auth.user, auth.entitlements, params.id, params.messageId, body)),
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/conversations/:id/messages/:messageId',
    auth: 'user',
    params: msgParams,
    handler: async ({ auth, params }) => c.conversations.deleteMessage(auth.user, params.id, params.messageId),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/conversations/:id/messages/:messageId/feedback',
    auth: 'user',
    params: msgParams,
    body: feedbackSchema,
    handler: async ({ auth, params, body }) => c.chat.feedback(auth.user, params.id, params.messageId, body.rating, body.reason),
  });

  /** Owner check for a streaming message: joins through the conversation, so foreign ids look missing. */
  async function ownedMessage(userId: string, messageId: string) {
    const [row] = await c.db
      .select({ m: messages, conv: conversations })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.id, messageId), eq(conversations.userId, userId)));
    if (!row) throw new LumenError('NOT_FOUND', 'Stream not found.');
    return row;
  }

  route(app, c, {
    method: 'GET',
    url: '/api/streams/:id',
    auth: 'user',
    params: uuidParams,
    query: z.object({ after: z.coerce.number().int().min(0).optional() }),
    handler: async ({ auth, params, query, req, reply }) => {
      const { m } = await ownedMessage(auth.user.id, params.id);
      const lastId = Number(req.headers['last-event-id'] ?? query.after ?? 0) || 0;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      raw.write('retry: 2000\n\n');
      const exists = await c.hub.exists(params.id);
      if (!exists && m.status !== 'streaming') {
        // Finished long ago (or on another node without Redis): tell the client to load it from the API.
        raw.write(`id: ${lastId + 1}\ndata: ${JSON.stringify({ type: 'done', status: m.status === 'cancelled' ? 'cancelled' : 'complete', finishReason: 'stored' })}\n\n`);
        raw.end();
        return;
      }
      const heartbeat = setInterval(() => raw.write(': ping\n\n'), 15_000);
      const sub: { off?: () => void } = {};
      const close = () => {
        clearInterval(heartbeat);
        sub.off?.();
        if (!raw.writableEnded) raw.end();
      };
      req.raw.on('close', close);
      sub.off = await c.hub.subscribe(
        params.id,
        lastId,
        ({ seq, event }) => {
          raw.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
        },
        close,
      );
    },
  });
  route(app, c, {
    method: 'POST',
    url: '/api/streams/:id/cancel',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => {
      await ownedMessage(auth.user.id, params.id);
      return { cancelled: c.runner.cancel(auth.user.id, params.id) };
    },
  });

  // Response styles
  route(app, c, { method: 'GET', url: '/api/styles', auth: 'user', handler: async ({ auth }) => c.styles.list(auth.user) });
  route(app, c, { method: 'POST', url: '/api/styles', auth: 'user', body: styleInputSchema, handler: async ({ auth, body, reply }) => reply.code(201).send(await c.styles.create(auth.user, body)) });
  route(app, c, {
    method: 'POST',
    url: '/api/styles/from-sample',
    auth: 'user',
    body: styleFromSampleSchema,
    rateLimit: { name: 'styles:sample', limit: 10, windowMs: 60 * MIN, by: 'user' },
    handler: async ({ auth, body, reply }) => reply.code(201).send(await c.styles.fromSample(auth.user, body.name, body.sample)),
  });
  route(app, c, { method: 'PATCH', url: '/api/styles/:id', auth: 'user', params: uuidParams, body: patchOf(styleInputSchema), handler: async ({ auth, params, body }) => c.styles.update(auth.user, params.id, body) });
  route(app, c, { method: 'DELETE', url: '/api/styles/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => c.styles.delete(auth.user, params.id) });
}
