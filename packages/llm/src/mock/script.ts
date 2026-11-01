/**
 * Deterministic behaviors driven by markers in the last user message:
 *   [tool:name {"json":"args"}]  -> call a tool (once; after a tool result, summarize it)
 *   [error:429] / [error:500]    -> HTTP error with a provider-shaped body
 *   [slow:200]                   -> delay (ms) between chunks
 *   [disconnect]                 -> drop the connection mid-stream
 *   [reason]                     -> stream reasoning before the answer
 *   [long:500]                   -> answer with N words
 *   [json]                       -> answer with a JSON object
 * Otherwise the model echoes the prompt: "You said: ...".
 */
export interface Plan {
  reasoning: string | null;
  words: string[];
  toolCall: { name: string; arguments: Record<string, unknown> } | null;
  errorStatus: number | null;
  delayMs: number;
  disconnectAfter: number | null;
  inputTokens: number;
}

export interface NormalizedTurn {
  lastUserText: string;
  toolResult: { name: string; content: string } | null;
  totalChars: number;
}

export function plan(turn: NormalizedTurn): Plan {
  const t = turn.lastUserText;
  const p: Plan = { reasoning: null, words: [], toolCall: null, errorStatus: null, delayMs: 0, disconnectAfter: null, inputTokens: Math.max(1, Math.ceil(turn.totalChars / 4)) };
  const err = /\[error:(\d{3})\]/.exec(t);
  if (err) p.errorStatus = Number(err[1]);
  const slow = /\[slow:(\d+)\]/.exec(t);
  if (slow) p.delayMs = Math.min(5000, Number(slow[1]));
  if (t.includes('[disconnect]')) p.disconnectAfter = 3;
  if (t.includes('[reason]')) p.reasoning = 'Let me think about this step by step. The user wants a reply.';
  const tool = /\[tool:([a-zA-Z0-9_-]+)\s*/.exec(t);
  if (tool && !turn.toolResult) {
    const json = t[tool.index + tool[0].length] === '{' ? balancedObject(t, tool.index + tool[0].length) : null;
    let args: Record<string, unknown> = {};
    try {
      args = json ? (JSON.parse(json) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    p.toolCall = { name: tool[1]!, arguments: args };
    return p;
  }
  let text: string;
  if (turn.toolResult) text = `Tool ${turn.toolResult.name} returned: ${turn.toolResult.content}`;
  else if (t.includes('[json]')) text = JSON.stringify({ answer: 42, ok: true });
  else {
    const long = /\[long:(\d+)\]/.exec(t);
    if (long) text = Array.from({ length: Math.min(20000, Number(long[1])) }, (_, i) => `word${i}`).join(' ');
    else text = `You said: ${t.replace(/\[[a-z]+(:[^\]]*)?\]/g, '').trim() || '(nothing)'}`;
  }
  p.words = text.split(/(?<= )/);
  return p;
}

/** The JSON object starting at `start`, matching braces outside of strings (so args may contain `}]`). */
export function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
