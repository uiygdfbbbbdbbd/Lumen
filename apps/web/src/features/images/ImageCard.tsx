import { IconButton, cn, toast } from '@lumen/ui';
import { Copy, Download, Shuffle, Trash2 } from 'lucide-react';
import { errorMessage } from '../../lib/api.js';
import { ratioClass, type GeneratedImage } from './api.js';

/** One generated image with its actions. Alt text is the prompt the image was made from. */
export function ImageCard({ img, onVariations, onDelete, compact = false }: { img: GeneratedImage; onVariations?: () => Promise<void>; onDelete?: () => Promise<void>; compact?: boolean }) {
  const run = (fn?: () => Promise<void>, failed = 'Something went wrong') => async () => {
    try {
      await fn?.();
    } catch (e) {
      toast.error(failed, errorMessage(e));
    }
  };
  return (
    <figure className="group relative m-0 overflow-hidden rounded-lg border border-border bg-surface">
      <a href={img.url} target="_blank" rel="noreferrer" className={cn('block', ratioClass[img.aspectRatio] ?? 'aspect-square')}>
        <img src={img.url} alt={img.revisedPrompt ?? img.prompt} loading="lazy" className="h-full w-full object-cover" />
      </a>
      <figcaption className={cn('flex items-center gap-1 border-t border-border bg-elevated px-2 py-1', compact && 'sr-only')}>
        <span className="min-w-0 flex-1 truncate text-xs text-fg-2" title={img.prompt}>{img.prompt}</span>
        <IconButton size="icon-sm" label="Copy prompt" icon={<Copy size={14} />} onClick={() => void navigator.clipboard.writeText(img.prompt).then(() => toast.success('Prompt copied'))} />
        <IconButton size="icon-sm" label="Download image" icon={<Download size={14} />} onClick={() => window.open(`${img.url}?download=1`, '_blank', 'noopener')} />
        {onVariations ? <IconButton size="icon-sm" label="Make variations" icon={<Shuffle size={14} />} onClick={() => void run(onVariations, 'Couldn’t make variations')()} /> : null}
        {onDelete ? <IconButton size="icon-sm" label="Delete image" icon={<Trash2 size={14} />} onClick={() => void run(onDelete, 'Couldn’t delete')()} /> : null}
      </figcaption>
    </figure>
  );
}
