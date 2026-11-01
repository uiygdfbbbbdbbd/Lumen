import type { ChatMessage, ToolDefinition, Usage } from './types.js';

/**
 * Fast token estimate without shipping a tokenizer (~1-2 MB per vocabulary). Calibrated against
 * cl100k/o200k-style BPE on English prose and code: words ~1.3 tokens, CJK ~1 token per char,
 * punctuation and digits counted separately. Real usage always comes from provider responses;
 * estimates are only for context meters and pre-flight quota checks.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g)?.length ?? 0;
  tokens += cjk;
  const rest = text.replace(/[぀-ヿ㐀-䶿一-鿿가-힯]/g, ' ');
  for (const word of rest.match(/[A-Za-zÀ-ɏ]+|\d+|[^\sA-Za-z\d]/g) ?? []) {
    if (/^\d+$/.test(word)) tokens += Math.ceil(word.length / 3);
    else if (/^[A-Za-zÀ-ɏ]+$/.test(word)) tokens += word.length <= 4 ? 1 : Math.ceil(word.length / 4);
    else tokens += 1;
  }
  return Math.max(1, Math.round(tokens));
}

const PER_MESSAGE_OVERHEAD = 4;

export function estimateMessages(messages: ChatMessage[], tools: ToolDefinition[] = []): number {
  let n = 3;
  for (const m of messages) {
    n += PER_MESSAGE_OVERHEAD;
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const p of m.content) n += p.type === 'text' ? estimateTokens(p.text) : 765; // typical image tile cost
    } else if (m.role === 'assistant') {
      n += estimateTokens(m.content);
      for (const c of m.toolCalls ?? []) n += estimateTokens(c.name) + estimateTokens(JSON.stringify(c.arguments));
    } else {
      n += estimateTokens(m.content as string);
    }
  }
  for (const t of tools) n += estimateTokens(t.name) + estimateTokens(t.description) + estimateTokens(JSON.stringify(t.inputSchema));
  return n;
}

export interface Pricing {
  /** USD per 1M input tokens. */
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

/** Estimated cost in USD (internal tracking only; Lumen is free for users). */
export function estimateCost(usage: Usage, pricing: Pricing | null | undefined): number {
  if (!pricing) return 0;
  const cached = usage.cachedInputTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cached);
  const cost =
    (uncached * pricing.inputPer1M + cached * (pricing.cachedInputPer1M ?? pricing.inputPer1M) + usage.outputTokens * pricing.outputPer1M) /
    1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}
