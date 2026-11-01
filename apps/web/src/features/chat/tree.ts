import type { ChatMessage } from './types.js';

export interface TreeIndex {
  byId: Map<string, ChatMessage>;
  children: Map<string | null, ChatMessage[]>;
}

export function indexTree(messages: ChatMessage[]): TreeIndex {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const children = new Map<string | null, ChatMessage[]>();
  for (const m of messages) children.set(m.parentId, [...(children.get(m.parentId) ?? []), m]);
  for (const list of children.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { byId, children };
}

/** Siblings of a message (same parent, same role) and its 1-based position, for "< 2 / 3 >" navigation. */
export function siblingsOf(idx: TreeIndex, m: ChatMessage): { list: ChatMessage[]; position: number } {
  const list = (idx.children.get(m.parentId) ?? []).filter((x) => x.role === m.role && (!m.compareGroup || x.compareGroup !== m.compareGroup || x.id === m.id));
  return { list, position: list.findIndex((x) => x.id === m.id) + 1 };
}

/** Assistant siblings created together in compare mode. */
export function compareGroupOf(idx: TreeIndex, m: ChatMessage): ChatMessage[] {
  if (!m.compareGroup) return [m];
  return (idx.children.get(m.parentId) ?? []).filter((x) => x.compareGroup === m.compareGroup);
}

/** Group conversations into sidebar sections by recency. */
export function dateGroup(iso: string, now = new Date()): 'Today' | 'Yesterday' | 'Previous 7 days' | 'Previous 30 days' | 'Older' {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return 'Today';
  if (t >= startOfToday - 86400_000) return 'Yesterday';
  if (t >= startOfToday - 7 * 86400_000) return 'Previous 7 days';
  if (t >= startOfToday - 30 * 86400_000) return 'Previous 30 days';
  return 'Older';
}
