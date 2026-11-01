import { FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Globe, NotebookPen, Presentation, File as FileGeneric } from 'lucide-react';

export function FileIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const p = { size, 'aria-hidden': true as const };
  switch (kind) {
    case 'image':
      return <FileImage {...p} />;
    case 'pdf':
    case 'document':
    case 'text':
    case 'ebook':
      return <FileText {...p} />;
    case 'code':
    case 'html':
    case 'data':
      return <FileCode {...p} />;
    case 'spreadsheet':
      return <FileSpreadsheet {...p} />;
    case 'presentation':
      return <Presentation {...p} />;
    case 'audio':
      return <FileAudio {...p} />;
    case 'video':
      return <FileVideo {...p} />;
    case 'archive':
      return <FileArchive {...p} />;
    case 'url':
      return <Globe {...p} />;
    case 'note':
      return <NotebookPen {...p} />;
    default:
      return <FileGeneric {...p} />;
  }
}

export const STATUS_LABEL: Record<string, string> = {
  uploading: 'Uploading',
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
  quarantined: 'Blocked (malware)',
};
