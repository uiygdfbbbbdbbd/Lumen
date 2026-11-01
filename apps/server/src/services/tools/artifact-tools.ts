import { ARTIFACT_TYPES } from '../../db/schema/index.js';
import type { ArtifactService } from '../artifacts/artifact.service.js';
import type { Tool } from './registry.js';

export const ARTIFACT_GUIDANCE = `Artifacts: for substantial, self-contained content the user will likely reuse or iterate on (documents over ~20 lines, code files, HTML/React apps, SVG, Mermaid diagrams, charts, tables, slide decks), call create_artifact instead of pasting it in chat. Then edit it with update_artifact (exact text replacement) or rewrite_artifact for large changes. Keep chat replies short when you create or update an artifact.
Types: markdown, code (set language), html (complete page), react (one default-exported component; you may import React, react-dom, lucide-react, recharts; use Tailwind-free inline styles), svg, mermaid, chart (JSON: {"type":"bar|line|area|pie|scatter","title","data":[{...}],"x":"field","y":["field"]}), table (CSV), slides (markdown, slides separated by ---, "Note:" for speaker notes), spreadsheet (CSV; cells may contain formulas like =SUM(B2:B5)), latex.
Inside html/react artifacts you can call window.lumen.ai(prompt) for AI and window.lumen.storage.get/set(key, value) to persist data.`;

export function artifactTools(svc: ArtifactService): Tool[] {
  return [
    {
      definition: {
        name: 'create_artifact',
        description: 'Create a new artifact shown to the user in a side panel.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...ARTIFACT_TYPES] },
            title: { type: 'string' },
            content: { type: 'string', description: 'Full content of the artifact.' },
            language: { type: 'string', description: 'For code artifacts, e.g. "python".' },
          },
          required: ['type', 'title', 'content'],
        },
      },
      async run(args, ctx) {
        const a = await svc.create(ctx.user, {
          type: String(args.type) as never,
          title: String(args.title ?? 'Untitled'),
          content: String(args.content ?? ''),
          language: typeof args.language === 'string' ? args.language : null,
          conversationId: ctx.conversationId,
          projectId: ctx.fileScope?.projectId ?? null,
          messageId: ctx.messageId ?? null,
        });
        await ctx.emit?.({ type: 'artifact', id: a.id, version: 1, title: a.title, artifactType: a.type, action: 'created' });
        return `Created artifact "${a.title}" (id: ${a.id}, version 1). It is displayed to the user.`;
      },
    },
    {
      definition: {
        name: 'update_artifact',
        description: 'Edit an artifact by replacing an exact, unique snippet of its current content.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, old_str: { type: 'string', description: 'Exact text to replace; must occur exactly once.' }, new_str: { type: 'string' } },
          required: ['id', 'old_str', 'new_str'],
        },
      },
      async run(args, ctx) {
        const a = await svc.edit(ctx.user, String(args.id), String(args.old_str ?? ''), String(args.new_str ?? ''), 'ai', ctx.messageId ?? null);
        await ctx.emit?.({ type: 'artifact', id: a.id, version: a.currentVersion, title: a.title, artifactType: a.type, action: 'updated' });
        return `Updated artifact "${a.title}" to version ${a.currentVersion}.`;
      },
    },
    {
      definition: {
        name: 'rewrite_artifact',
        description: 'Replace the entire content of an artifact (use for large changes).',
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'] },
      },
      async run(args, ctx) {
        const a = await svc.rewrite(ctx.user, String(args.id), String(args.content ?? ''), 'ai', { messageId: ctx.messageId ?? null });
        await ctx.emit?.({ type: 'artifact', id: a.id, version: a.currentVersion, title: a.title, artifactType: a.type, action: 'updated' });
        return `Rewrote artifact "${a.title}" (now version ${a.currentVersion}).`;
      },
    },
  ];
}
