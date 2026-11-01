import type { FileInfo } from '../files/types.js';

export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  instructions: string;
  defaultModelId: string | null;
  defaultStyleId: string | null;
  templateId: string | null;
  archived: boolean;
  role: 'viewer' | 'editor' | 'owner';
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  instructions: string;
  starters: string[];
}

export interface ProjectDashboard {
  project: Project;
  chats: { id: string; title: string; lastMessageAt: string; pinned: boolean }[];
  knowledge: FileInfo[];
  usage: { inputTokens: number; outputTokens: number };
  starters: string[];
}
