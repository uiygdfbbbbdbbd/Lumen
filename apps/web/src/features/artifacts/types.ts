import type { ArtifactType } from '@lumen/shared';

export interface ArtifactSummary {
  id: string;
  type: ArtifactType;
  title: string;
  language: string | null;
  version: number;
  conversationId: string | null;
  projectId: string | null;
  published: boolean;
  publicSlug: string | null;
  forkedFrom: string | null;
  createdAt: string;
  updatedAt: string;
  preview?: string;
}

export interface Artifact extends ArtifactSummary {
  content: string;
  viewingVersion: number;
  versionLabel: string | null;
}

export interface ArtifactVersion {
  version: number;
  source: 'ai' | 'user' | 'restore' | 'fork' | string;
  label: string | null;
  basedOn: number | null;
  createdAt: string;
  size: number;
}

export interface PublicArtifact {
  id: string;
  type: ArtifactType;
  title: string;
  language: string | null;
  version: number;
  content: string;
  publishedAt: string | null;
}
