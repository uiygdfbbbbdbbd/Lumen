import type { Tool } from './registry.js';

export const CODE_GUIDANCE = `Running code: call run_code to run short Python (standard library only, no network, no file system) or JavaScript snippets for calculations, data wrangling or quick checks. The code runs in the user's browser after they click Run, and they can share the output with you, so your turn ends when you call it. Print results explicitly. Keep it under a few seconds of work.`;

export function codeTools(): Tool[] {
  return [
    {
      endsTurn: true,
      definition: {
        name: 'run_code',
        description: "Run a short Python or JavaScript snippet in the user's browser (sandboxed, no network). Ends your turn; the user can share the output.",
        inputSchema: {
          type: 'object',
          properties: { language: { type: 'string', enum: ['python', 'javascript'] }, code: { type: 'string' } },
          required: ['language', 'code'],
        },
      },
      async run(args) {
        const language = String(args.language ?? '');
        const code = String(args.code ?? '');
        if (language !== 'python' && language !== 'javascript') throw new Error('language must be "python" or "javascript"');
        if (!code.trim()) throw new Error('code is empty');
        if (code.length > 20_000) throw new Error('Code is too long for the browser runner (max 20,000 characters).');
        return `The ${language} code is shown to the user with a Run button. It runs in their browser; they can share the output with you.`;
      },
    },
  ];
}
