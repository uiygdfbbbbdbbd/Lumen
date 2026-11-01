export interface FileInfo {
  id: string;
  name: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  projectId: string | null;
  sourceUrl: string | null;
  status: 'uploading' | 'queued' | 'processing' | 'ready' | 'failed' | 'quarantined';
  error: string | null;
  tokenCount: number;
  pageCount: number | null;
  chunkCount: number;
  embedded: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
