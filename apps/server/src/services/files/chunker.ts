import { estimateTokens } from '@lumen/llm';
import type { Section } from './extract.js';

export interface Chunk {
  content: string;
  tokenCount: number;
  location: { page?: number; section?: string };
}

/** Split text into units that respect structure: headings and paragraphs first, then sentences, then words. */
export function splitUnits(text: string, maxTokens: number): string[] {
  const paragraphs = text.split(/\n(?=#{1,6} )|\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paragraphs) {
    if (estimateTokens(p) <= maxTokens) {
      out.push(p);
      continue;
    }
    const sentences = p.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n/).filter(Boolean);
    for (const s of sentences) {
      if (estimateTokens(s) <= maxTokens) {
        out.push(s);
        continue;
      }
      const words = s.split(/\s+/);
      let cur: string[] = [];
      for (const w of words) {
        cur.push(w);
        if (estimateTokens(cur.join(' ')) >= maxTokens) {
          out.push(cur.join(' '));
          cur = [];
        }
      }
      if (cur.length) out.push(cur.join(' '));
    }
  }
  return out;
}

/**
 * Pack units into ~`target`-token chunks with `overlap` tokens of trailing context carried into the next
 * chunk (sliding window). Chunks never cross section/page boundaries so citations stay precise.
 */
export function chunkSections(sections: Section[], target = 500, overlap = 80): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const units = splitUnits(section.text, target);
    let cur: string[] = [];
    let curTokens = 0;
    // True while `cur` holds only text carried over from the previous chunk.
    let carryOnly = false;
    const flush = () => {
      const content = cur.join('\n\n');
      chunks.push({ content, tokenCount: estimateTokens(content), location: section.location });
      // Carry ~overlap tokens of trailing context (whole units, or the tail words of a large unit).
      const carry: string[] = [];
      let carried = 0;
      for (let i = cur.length - 1; i >= 0 && carried < overlap; i--) {
        const u = cur[i]!;
        const t = estimateTokens(u);
        if (carried + t <= overlap) {
          carry.unshift(u);
          carried += t;
          continue;
        }
        const words = u.split(/\s+/);
        const tail = words.slice(-Math.max(1, Math.round((overlap - carried) * 0.75))).join(' ');
        carry.unshift(tail);
        carried += estimateTokens(tail);
        break;
      }
      cur = overlap > 0 ? carry : [];
      curTokens = carried;
      carryOnly = cur.length > 0;
    };
    for (const u of units) {
      const t = estimateTokens(u);
      if (curTokens + t > target && cur.length && !carryOnly) flush();
      cur.push(u);
      curTokens += t;
      carryOnly = false;
    }
    if (cur.length && !carryOnly) flush();
  }
  return chunks;
}
