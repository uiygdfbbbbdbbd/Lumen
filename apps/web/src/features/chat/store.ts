import { create } from 'zustand';
import type { ChatStreamEvent, CitationItem } from '@lumen/shared';

export interface LiveTool {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: { content: string; isError: boolean };
}

export interface LiveStream {
  text: string;
  reasoning: string;
  tools: LiveTool[];
  status: 'streaming' | 'done' | 'cancelled' | 'error';
  error: { code: string; message: string; resetAt?: string; retryable: boolean } | null;
  fallback: string | null;
  compacted: boolean;
  reconnecting: boolean;
  usage: { contextTokens: number; contextWindow: number } | null;
  citations: Citation[];
  artifacts: LiveArtifact[];
  memoryIds: string[];
  research: Extract<ChatStreamEvent, { type: 'research' }> | null;
}

export interface LiveArtifact {
  id: string;
  version: number;
  title: string;
  artifactType: string;
  action: 'created' | 'updated' | 'suggested';
}

export type Citation = CitationItem;

const empty = (): LiveStream => ({ text: '', reasoning: '', tools: [], status: 'streaming', error: null, fallback: null, compacted: false, reconnecting: false, usage: null, citations: [], artifacts: [], memoryIds: [], research: null });

interface Store {
  streams: Record<string, LiveStream>;
  apply: (id: string, e: ChatStreamEvent) => void;
  setReconnecting: (id: string, v: boolean) => void;
  clear: (id: string) => void;
}

export function reduce(s: LiveStream, e: ChatStreamEvent): LiveStream {
  switch (e.type) {
    case 'text':
      return { ...s, text: s.text + e.text, reconnecting: false };
    case 'reasoning':
      return { ...s, reasoning: s.reasoning + e.text, reconnecting: false };
    case 'tool_call':
      return { ...s, tools: [...s.tools, { id: e.id, name: e.name, arguments: e.arguments }] };
    case 'tool_result':
      return { ...s, tools: s.tools.map((t) => (t.id === e.id ? { ...t, result: { content: e.content, isError: e.isError } } : t)) };
    case 'fallback':
      return { ...s, fallback: `${e.from} was unavailable, switched to ${e.to}.` };
    case 'compacted':
      return { ...s, compacted: true };
    case 'research':
      return { ...s, research: { ...e, sources: e.sources ?? s.research?.sources }, reconnecting: false };
    case 'memory':
      return { ...s, memoryIds: e.ids };
    case 'artifact':
      return { ...s, artifacts: [...s.artifacts, { id: e.id, version: e.version, title: e.title, artifactType: e.artifactType, action: e.action }] };
    case 'citations':
      return { ...s, citations: e.items };
    case 'usage':
      return { ...s, usage: { contextTokens: e.contextTokens, contextWindow: e.contextWindow } };
    case 'done':
      return { ...s, status: e.status === 'cancelled' ? 'cancelled' : 'done', reconnecting: false };
    case 'error':
      return { ...s, status: 'error', error: { code: e.code, message: e.message, resetAt: e.resetAt, retryable: e.retryable }, reconnecting: false };
    default:
      return s;
  }
}

export const useStreams = create<Store>((set) => ({
  streams: {},
  apply: (id, e) => set((st) => ({ streams: { ...st.streams, [id]: reduce(st.streams[id] ?? empty(), e) } })),
  setReconnecting: (id, v) => set((st) => ({ streams: { ...st.streams, [id]: { ...(st.streams[id] ?? empty()), reconnecting: v } } })),
  clear: (id) =>
    set((st) => {
      const { [id]: _drop, ...rest } = st.streams;
      return { streams: rest };
    }),
}));
