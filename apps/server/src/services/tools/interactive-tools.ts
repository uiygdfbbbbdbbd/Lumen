import { chartSpecSchema } from '@lumen/shared';
import type { Tool } from './registry.js';

export const INTERACTIVE_TOOLS = ['ask_user', 'show_chart', 'show_diagram'];

export const INTERACTIVE_GUIDANCE = `Clarifying questions: when a request is ambiguous and the answer changes what you'd do, call ask_user with 2-6 short options instead of guessing. The user answers by clicking; their choice arrives as their next message. Don't ask about things you can reasonably assume.
Inline visuals: call show_chart for a quick chart in the reply (JSON spec like chart artifacts) or show_diagram for a Mermaid diagram. Use an artifact instead when the user will want to keep or edit it.`;

export function interactiveTools(): Tool[] {
  return [
    {
      endsTurn: true,
      definition: {
        name: 'ask_user',
        description: 'Ask the user a multiple-choice clarifying question, shown as clickable options. Ends your turn.',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label'] }, minItems: 2, maxItems: 6 },
            multiSelect: { type: 'boolean' },
            allowOther: { type: 'boolean', description: 'Offer a free-text answer too (default true).' },
          },
          required: ['question', 'options'],
        },
      },
      async run(args) {
        const question = String(args.question ?? '').trim();
        const options = Array.isArray(args.options) ? args.options : [];
        if (!question) throw new Error('question is required');
        const labels = options.map((o) => (typeof o === 'string' ? o : String((o as { label?: unknown }).label ?? ''))).filter((l) => l.trim());
        if (labels.length < 2 || labels.length > 6) throw new Error('Provide 2 to 6 options.');
        return `The question is shown to the user with options: ${labels.join(' | ')}. Wait for their answer.`;
      },
    },
    {
      definition: {
        name: 'show_chart',
        description: 'Render a small interactive chart inside your reply.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'scatter'] },
            title: { type: 'string' },
            data: { type: 'array', items: { type: 'object' } },
            x: { type: 'string' },
            y: { type: 'array', items: { type: 'string' } },
          },
          required: ['type', 'data', 'x', 'y'],
        },
      },
      async run(args) {
        const r = chartSpecSchema.safeParse(args);
        if (!r.success) throw new Error(`Invalid chart: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        return `Chart "${r.data.title ?? r.data.type}" is shown to the user (${r.data.data.length} rows).`;
      },
    },
    {
      definition: {
        name: 'show_diagram',
        description: 'Render a Mermaid diagram inside your reply.',
        inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Mermaid source' }, title: { type: 'string' } }, required: ['code'] },
      },
      async run(args) {
        const code = String(args.code ?? '').trim();
        if (!code) throw new Error('code is required');
        if (code.length > 20_000) throw new Error('Diagram is too large.');
        return 'Diagram is shown to the user.';
      },
    },
  ];
}
