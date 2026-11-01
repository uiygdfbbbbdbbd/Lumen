import type { UseCase } from '@lumen/shared';

export interface Starter {
  title: string;
  prompt: string;
  useCase: UseCase;
}

const STARTERS: Starter[] = [
  { useCase: 'coding', title: 'Explain this error', prompt: 'Here is an error message and the code around it. Explain the root cause and suggest a fix:\n\n' },
  { useCase: 'coding', title: 'Write a test suite', prompt: 'Write thorough unit tests (including edge cases) for this function:\n\n' },
  { useCase: 'coding', title: 'Review my pull request', prompt: 'Review this diff for bugs, security issues and readability. Be specific:\n\n' },
  { useCase: 'writing', title: 'Tighten my draft', prompt: 'Edit this draft to be clearer and more concise while keeping my voice:\n\n' },
  { useCase: 'writing', title: 'Outline an article', prompt: 'Create a detailed outline for an article about ' },
  { useCase: 'research', title: 'Compare options', prompt: 'Compare the main options for ' },
  { useCase: 'research', title: 'Summarize a paper', prompt: 'Summarize the key findings, methods and limitations of this paper:\n\n' },
  { useCase: 'learning', title: 'Teach me step by step', prompt: 'Teach me the basics of ' },
  { useCase: 'learning', title: 'Quiz me', prompt: 'Quiz me with 5 questions on ' },
  { useCase: 'business', title: 'Draft an email', prompt: 'Draft a professional email to ' },
  { useCase: 'business', title: 'Analyze a plan', prompt: 'Identify risks and blind spots in this plan:\n\n' },
  { useCase: 'creative', title: 'Brainstorm ideas', prompt: 'Brainstorm 10 original ideas for ' },
  { useCase: 'creative', title: 'Write a short story', prompt: 'Write a short story about ' },
  { useCase: 'other', title: 'Plan my week', prompt: 'Help me plan my week. Here is what I need to get done:\n\n' },
];

/** Up to `n` starters, round-robin across the user's chosen use cases (or a general mix). */
export function startersFor(useCases: UseCase[], n = 4): Starter[] {
  const pools = (useCases.length ? useCases : (['writing', 'coding', 'research', 'learning'] as UseCase[])).map((u) => STARTERS.filter((s) => s.useCase === u));
  const out: Starter[] = [];
  for (let i = 0; out.length < n && i < 10; i++) {
    for (const p of pools) {
      if (p[i] && out.length < n) out.push(p[i]!);
    }
  }
  return out;
}
