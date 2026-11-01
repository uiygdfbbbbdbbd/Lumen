import { MEMORY_CATEGORIES, type MemoryCategory } from '@lumen/shared';
import type { ConversationService } from '../chat/conversation.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { Tool, ToolContext } from './registry.js';

export const MEMORY_TOOLS = ['memory_write', 'memory_search', 'memory_update', 'memory_delete'];

export const MEMORY_GUIDANCE = `Memory: you can remember things about the user across chats.
- Save with memory_write: durable facts (name, role, where they work or study), preferences (tone, formats, units, tools they use), ongoing projects and goals, people they mention repeatedly, and standing tasks.
- Don't save: one-off details, things only relevant to this chat, or anything already in memory (update it instead).
- Never save secrets (passwords, keys, account or card numbers, ID numbers). Don't save sensitive personal information (health, religion, politics, sexuality, ethnicity, exact address, finances) unless the user explicitly asks you to remember it.
- Write each memory as one short, self-contained sentence about the user, e.g. "Prefers metric units."
- When the user says "remember …", save it. When they say "forget …", find it with memory_search and delete it with memory_delete. If a remembered fact changed, use memory_update.
- Mention briefly when you save, change or forget something. Don't otherwise talk about your memory unless asked.`;

export const HISTORY_GUIDANCE = 'Past chats: use conversation_search when the user refers to an earlier conversation ("what did we decide last week…") or when earlier context would clearly help. Cite the chat title when you use it.';

const scopeLabel = (projectId: string | null) => (projectId ? 'this project' : 'all chats');

async function requireEnabled(svc: MemoryService, ctx: ToolContext) {
  if (!(await svc.enabledFor(ctx.user))) throw new Error('Memory is paused for this user. Tell them they can turn it back on in Settings → Memory.');
}

export function memoryTools(svc: MemoryService): Tool[] {
  return [
    {
      definition: {
        name: 'memory_write',
        description: 'Save a durable fact or preference about the user so you remember it in future chats.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'One short sentence about the user.' },
            category: { type: 'string', enum: [...MEMORY_CATEGORIES] },
            scope: { type: 'string', enum: ['global', 'project'], description: '"project" to remember it only inside the current project.' },
          },
          required: ['content', 'category'],
        },
      },
      async run(args, ctx) {
        await requireEnabled(svc, ctx);
        const projectId = args.scope === 'project' ? (ctx.projectId ?? null) : null;
        const category = MEMORY_CATEGORIES.includes(args.category as MemoryCategory) ? (args.category as MemoryCategory) : 'other';
        const r = await svc.create(ctx.user, { content: String(args.content ?? ''), category, projectId }, { source: 'ai', conversationId: ctx.conversationId, messageId: ctx.messageId ?? null });
        return r.deduplicated ? `Already remembered; updated the existing memory (id: ${r.memory.id}).` : `Saved to memory for ${scopeLabel(projectId)} (id: ${r.memory.id}).`;
      },
    },
    {
      definition: {
        name: 'memory_search',
        description: 'Search what you remember about the user. Returns memory ids you can update or delete.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
      async run(args, ctx) {
        await requireEnabled(svc, ctx);
        const hits = await svc.search(ctx.user, String(args.query ?? ''), ctx.projectId ?? null);
        if (!hits.length) return 'No matching memories.';
        return hits.map((m) => `- id: ${m.id} (${m.category}${m.projectId ? ', project' : ''}) ${m.content}`).join('\n');
      },
    },
    {
      definition: {
        name: 'memory_update',
        description: 'Change an existing memory (e.g. when a fact about the user changed).',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, content: { type: 'string' }, category: { type: 'string', enum: [...MEMORY_CATEGORIES] } },
          required: ['id'],
        },
      },
      async run(args, ctx) {
        await requireEnabled(svc, ctx);
        const m = await svc.update(ctx.user, String(args.id ?? ''), {
          ...(typeof args.content === 'string' ? { content: args.content } : {}),
          ...(MEMORY_CATEGORIES.includes(args.category as MemoryCategory) ? { category: args.category as MemoryCategory } : {}),
        });
        return `Updated memory ${m.id}: ${m.content}`;
      },
    },
    {
      definition: {
        name: 'memory_delete',
        description: 'Forget a memory permanently.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
      async run(args, ctx) {
        await requireEnabled(svc, ctx);
        const m = await svc.delete(ctx.user, String(args.id ?? ''));
        return `Forgot: ${m.content}`;
      },
    },
  ];
}

export function conversationSearchTool(conversations: ConversationService): Tool {
  return {
    definition: {
      name: 'conversation_search',
      description: "Search the user's past chats (not temporary ones) for earlier discussions.",
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    async run(args, ctx) {
      const q = String(args.query ?? '').trim();
      if (!q) throw new Error('query is required');
      const hits = (await conversations.search(ctx.user, { q, limit: 8, archived: 'any' })).filter((h) => h.conversationId !== ctx.conversationId);
      if (!hits.length) return 'No earlier chats matched.';
      return hits.map((h) => `- "${h.title}" (${h.lastMessageAt.slice(0, 10)}, chat id ${h.conversationId}): ${h.snippet.replace(/<<|>>/g, '')}`).join('\n');
    },
  };
}
