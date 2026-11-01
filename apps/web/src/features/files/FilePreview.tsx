import { useQuery } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, Skeleton } from '@lumen/ui';
import { Download } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatBytes } from '../../lib/i18n.js';
import type { FileInfo } from './types.js';
import { fileUrl } from './upload.js';

/** Minimal CSV/TSV parser (quoted fields, escaped quotes) for table previews. */
export function parseDelimited(text: string, delimiter: string, maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

export function FilePreview({ file, onClose }: { file: FileInfo; onClose: () => void }) {
  const isTable = /\.(csv|tsv)$/i.test(file.name) || file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const needsText = !['image', 'pdf', 'audio', 'video'].includes(file.kind);
  const text = useQuery({ queryKey: ['file-text', file.id], queryFn: () => api<{ text: string; truncated: boolean }>(`/api/files/${file.id}/text`), enabled: needsText });
  const rows = isTable && text.data ? parseDelimited(text.data.text, /\.tsv$/i.test(file.name) || file.kind === 'spreadsheet' && !/\.csv$/i.test(file.name) ? '\t' : ',') : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={file.name} description={`${formatBytes(file.sizeBytes)}${file.pageCount ? ` · ${file.pageCount} pages` : ''}${file.chunkCount ? ` · ${file.chunkCount} chunks` : ''}`} size="xl">
        <div className="max-h-[70vh] overflow-auto">
          {file.kind === 'image' ? <img src={fileUrl(file.id)} alt={file.name} className="mx-auto max-h-[65vh]" /> : null}
          {file.kind === 'pdf' ? <iframe title={file.name} src={fileUrl(file.id)} className="h-[65vh] w-full rounded-md border border-border" sandbox="allow-same-origin" /> : null}
          {file.kind === 'audio' ? <audio controls src={fileUrl(file.id)} className="w-full" /> : null}
          {file.kind === 'video' ? <video controls src={fileUrl(file.id)} className="max-h-[65vh] w-full" /> : null}
          {needsText && text.isLoading ? <Skeleton className="h-60" /> : null}
          {rows ? (
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">Preview of {file.name}</caption>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={i === 0 ? 'bg-surface font-semibold' : ''}>
                    {r.map((c, j) => <td key={j} className="border border-border px-2 py-1">{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : needsText && text.data ? (
            <pre className="whitespace-pre-wrap rounded-md bg-code-bg p-3 text-xs text-code">{text.data.text || 'No text could be extracted from this file.'}{text.data.truncated ? '\n…(truncated)' : ''}</pre>
          ) : null}
        </div>
        <div className="mt-3 flex justify-end">
          <Button asChild variant="secondary"><a href={fileUrl(file.id, true)}><Download size={14} aria-hidden="true" /> Download</a></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
