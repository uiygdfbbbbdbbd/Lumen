import type { RetrievalService } from '../files/retrieval.service.js';
import { formatLocation } from '../files/context.js';
import type { Tool } from './registry.js';

/** Lets the model run its own searches over the attached files / project knowledge. */
export function fileSearchTool(retrieval: RetrievalService): Tool {
  return {
    definition: {
      name: 'file_search',
      description: 'Search the user’s attached files and project knowledge for passages relevant to a query. Returns numbered excerpts with file names and pages.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, in natural language or keywords.' } }, required: ['query'] },
    },
    async run(args, ctx) {
      const scope = ctx.fileScope;
      if (!scope || (!scope.fileIds.length && !scope.projectId)) return 'No files are available to search in this conversation.';
      const hits = await retrieval.search({ fileIds: scope.fileIds, projectId: scope.projectId }, String(args.query ?? ''), 6, ctx.user.id);
      if (!hits.length) return 'No matching passages found.';
      return hits.map((h, i) => `[S${i + 1}] ${h.fileName}${formatLocation(h.location) ? ` (${formatLocation(h.location)})` : ''}\n${h.content}`).join('\n\n');
    },
  };
}
