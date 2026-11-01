export interface ConversationSummary {
  id: string;
  projectId: string | null;
  title: string;
  modelId: string | null;
  pinned: boolean;
  starred: boolean;
  archived: boolean;
  incognito: boolean;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
}

export interface MessagePart {
  type: 'reasoning' | 'tool_call' | 'tool_result' | 'text_segment' | 'citation' | 'attachment' | 'compaction';
  [k: string]: unknown;
}

export interface ChatMessage {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  parts: MessagePart[];
  status: 'complete' | 'streaming' | 'error' | 'cancelled';
  error: { code: string; message: string; resetAt?: string } | null;
  modelId: string | null;
  modelName: string | null;
  usage: { inputTokens: number; outputTokens: number; latencyMs?: number; firstTokenMs?: number } | null;
  rating: number | null;
  compareGroup: string | null;
  createdAt: string;
}

export interface ConversationTree {
  conversation: ConversationSummary & { instructions: string; settings: { thinkingEffort?: string; styleId?: string; temperature?: number }; activeLeafId: string | null; expiresAt: string | null };
  messages: ChatMessage[];
  activePath: string[];
  compactions: { id: string; throughMessageId: string; summary: string; tokensBefore: number; tokensAfter: number; createdAt: string }[];
}
