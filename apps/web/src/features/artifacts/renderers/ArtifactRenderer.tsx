import { forwardRef, lazy, Suspense, useMemo, useState } from 'react';
import type { ArtifactType } from '@lumen/shared';
import { Markdown } from '../../chat/Markdown.js';
import { ArtifactFrame, type ConsoleEntry, type FrameHandle } from '../ArtifactFrame.js';
import { ChartView } from './ChartView.js';
import { CodeView } from './CodeView.js';
import { latexToMarkdown } from './latex.js';
import { RenderError } from './RenderError.js';
import { SlidesView } from './SlidesView.js';
import { SpreadsheetView } from './SpreadsheetView.js';
import { SvgView } from './SvgView.js';
import { TableView } from './TableView.js';

const Mermaid = lazy(() => import('../../chat/Mermaid.js'));

export interface RendererProps {
  artifactId: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string | null;
  /** Signed-in viewers can use the AI/storage bridge; public viewers can't. */
  bridge?: boolean;
  onConsole?: (e: ConsoleEntry) => void;
  onRuntimeError?: (message: string) => void;
  /** Spreadsheet cell edits (saved as a new version). */
  onEdit?: (content: string) => void;
}

function MermaidView({ content }: { content: string }) {
  const [error, setError] = useState<{ for: string; message: string } | null>(null);
  return (
    <div className="p-4">
      {error?.for === content ? <RenderError title="This diagram has a syntax error" error={error.message}>{error.message}</RenderError> : null}
      <Suspense fallback={<div className="h-24 animate-pulse rounded-md bg-surface" />}>
        <Mermaid code={content} onError={(message) => setError({ for: content, message })} />
      </Suspense>
    </div>
  );
}

function LatexView({ content }: { content: string }) {
  const md = useMemo(() => latexToMarkdown(content).markdown, [content]);
  return (
    <article className="mx-auto max-w-3xl px-8 py-6 font-serif">
      <Markdown text={md} />
    </article>
  );
}

/** Renders any artifact type. HTML and React run in the sandboxed runtime frame; everything else is drawn by the app. */
export const ArtifactRenderer = forwardRef<FrameHandle, RendererProps>(function ArtifactRenderer({ artifactId, type, title, content, language, bridge = true, onConsole, onRuntimeError, onEdit }, ref) {
  switch (type) {
    case 'html':
    case 'react':
      return <ArtifactFrame ref={ref} artifactId={artifactId} type={type} content={content} bridge={bridge} onConsole={onConsole} onError={onRuntimeError} />;
    case 'markdown':
      return <article className="mx-auto max-w-3xl px-6 py-5"><Markdown text={content} /></article>;
    case 'code':
      return <CodeView code={content} language={language} />;
    case 'svg':
      return <SvgView content={content} title={title} />;
    case 'mermaid':
      return <MermaidView content={content} />;
    case 'chart':
      return <ChartView content={content} />;
    case 'table':
      return <TableView content={content} />;
    case 'spreadsheet':
      return <SpreadsheetView content={content} onChange={onEdit} />;
    case 'slides':
      return <SlidesView content={content} />;
    case 'latex':
      return <LatexView content={content} />;
    default:
      return <RenderError title="Unsupported artifact">This artifact type can’t be displayed.</RenderError>;
  }
});
