import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseChartSpec } from '@lumen/shared';
import { reduce } from '../src/features/chat/store.js';
import { ArtifactCard, describeArtifactCall } from '../src/features/artifacts/ArtifactCard.js';
import { DiffView } from '../src/features/artifacts/DiffView.js';
import { downloadBlob, editorLanguage, embedSnippet, extensionFor, mimeFor, printElement, safeFileName, serializeSvg } from '../src/features/artifacts/files.js';
import { useArtifactPanel } from '../src/features/artifacts/panel.js';
import { barPath, formatValue, hBarPath, labelStride, linePath, niceTicks, partToWhole, prepareChart, tickFormatter, toNumber } from '../src/features/artifacts/renderers/chart-layout.js';
import { ChartView } from '../src/features/artifacts/renderers/ChartView.js';
import { latexToMarkdown } from '../src/features/artifacts/renderers/latex.js';
import { SpreadsheetView } from '../src/features/artifacts/renderers/SpreadsheetView.js';
import { TableView } from '../src/features/artifacts/renderers/TableView.js';

const spec = (o: Record<string, unknown>) => {
  const r = parseChartSpec(JSON.stringify(o));
  if (!r.ok) throw new Error(r.error);
  return r.spec;
};

describe('chart layout', () => {
  it('produces nice ticks that include zero and cover the domain', () => {
    expect(niceTicks(0, 97)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-12, 30)).toContain(0);
    expect(niceTicks(5, 5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    const t = niceTicks(0.1, 0.9);
    expect(t[0]).toBeLessThanOrEqual(0.1);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(0.9);
  });
  it('formats axis ticks in full under 10,000 and compact above', () => {
    expect(tickFormatter([0, 2000, 4000])(4000)).toBe('4,000');
    expect(tickFormatter([0, 10000, 20000])(20000)).toMatch(/20K/);
    expect(formatValue(null)).toBe('—');
    expect(formatValue(0.12345)).toBe('0.1235');
  });
  it('coerces numeric strings and rejects junk', () => {
    expect(toNumber('1,234')).toBe(1234);
    expect(toNumber('$5')).toBe(5);
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(null)).toBeNull();
  });
  it('prepares series with fixed color order and stacked domains', () => {
    const p = prepareChart(spec({ type: 'bar', stacked: true, data: [{ m: 'a', x: 2, y: 3 }, { m: 'b', x: -1, y: 4 }], x: 'm', y: ['x', 'y'] }));
    expect(p.series.map((s) => s.color)).toEqual(['var(--lm-chart-1)', 'var(--lm-chart-2)']);
    expect(p.domain).toEqual([-1, 5]);
  });
  it('limits scatter to three series and reports the rest', () => {
    const p = prepareChart(spec({ type: 'scatter', data: [{ x: 1, a: 1, b: 2, c: 3, d: 4 }], x: 'x', y: ['a', 'b', 'c', 'd'] }));
    expect(p.series).toHaveLength(3);
    expect(p.omitted).toEqual(['d']);
    expect(p.xDomain).toEqual([1, 1]);
  });
  it('turns pies into a segmented bar (≤6 parts) or ranked bars', () => {
    const few = partToWhole(spec({ type: 'pie', data: [{ k: 'a', v: 1 }, { k: 'b', v: 3 }, { k: 'c', v: 0 }], x: 'k', y: 'v' }));
    expect(few.mode).toBe('segmented');
    expect(few.parts.map((p) => p.name)).toEqual(['b', 'a']);
    expect(few.parts[0]!.share).toBe(0.75);
    const many = partToWhole(spec({ type: 'pie', data: Array.from({ length: 8 }, (_, i) => ({ k: `p${i}`, v: i + 1 })), x: 'k', y: 'v' }));
    expect(many.mode).toBe('ranked');
    expect(new Set(many.parts.map((p) => p.color)).size).toBe(1);
  });
  it('builds bar paths with rounded data ends and square baselines', () => {
    expect(barPath(0, 10, 100, 40)).toMatch(/^M0,100V44Q0,40/);
    expect(barPath(0, 10, 100, 140)).toMatch(/^M0,100V136/);
    expect(barPath(0, 10, 100, 100)).toBe('');
    expect(hBarPath(0, 50, 0, 16)).toMatch(/^M0,0H46/);
    expect(hBarPath(0, 0, 0, 16)).toBe('');
    expect(linePath([{ x: 0, y: 0 }, null, { x: 2, y: 2 }, { x: 3, y: 3 }])).toBe('M0.0,0.0M2.0,2.0L3.0,3.0');
    expect(labelStride(100, 400, 10)).toBeGreaterThan(1);
    expect(labelStride(3, 400, 4)).toBe(1);
  });
});

describe('ChartView', () => {
  it('draws one bar per value with a legend for multiple series and a table view', async () => {
    const user = userEvent.setup();
    const { container } = render(<ChartView content={JSON.stringify({ type: 'bar', title: 'Sales', data: [{ q: 'Q1', a: 3, b: 4 }, { q: 'Q2', a: 5, b: 1 }], x: 'q', y: ['a', 'b'] })} />);
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('ab');
    expect(container.querySelectorAll('path[fill^="var(--lm-chart"]')).toHaveLength(4);
    // Keyboard reading shows a tooltip with every series at that category.
    const plot = screen.getByRole('group', { name: /Sales/ });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(screen.getByRole('status')).toHaveTextContent('Q1');
    fireEvent.keyDown(plot, { key: 'End' });
    expect(screen.getByRole('status')).toHaveTextContent('Q2');
    await user.click(screen.getByRole('button', { name: /Table view/ }));
    expect(screen.getByRole('table')).toHaveTextContent('Q2');
  });
  it('renders lines, single series without a legend, and errors readably', () => {
    const { container, rerender } = render(<ChartView content={JSON.stringify({ type: 'line', data: [{ d: 1, v: 1 }, { d: 2, v: 3 }], x: 'd', y: 'v' })} />);
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(container.querySelector('path[stroke="var(--lm-chart-1)"]')).not.toBeNull();
    rerender(<ChartView content="{bad" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/valid JSON/);
  });
  it('renders area, scatter and part-to-whole forms', () => {
    const { container, rerender } = render(<ChartView content={JSON.stringify({ type: 'area', data: [{ d: 'a', v: 1, w: 2 }, { d: 'b', v: 3, w: 1 }], x: 'd', y: ['v', 'w'] })} />);
    expect(container.querySelector('path[fill-opacity="0.1"]')).not.toBeNull();
    rerender(<ChartView content={JSON.stringify({ type: 'scatter', data: [{ x: 1, y: 2 }, { x: 3, y: 1 }], x: 'x', y: 'y' })} />);
    expect(container.querySelectorAll('circle[r="12"]')).toHaveLength(2);
    rerender(<ChartView content={JSON.stringify({ type: 'pie', data: [{ k: 'Rent', v: 3 }, { k: 'Food', v: 1 }], x: 'k', y: 'v' })} />);
    expect(screen.getByRole('listitem', { name: /Rent: 3 \(75%\)/ })).toBeInTheDocument();
  });
});

describe('SpreadsheetView', () => {
  it('shows computed values and saves cell edits as CSV', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SpreadsheetView content={'a,b,sum\n1,2,=A2+B2'} onChange={onChange} />);
    const cells = () => within(screen.getByRole('grid')).getAllByRole('gridcell'); // 8 columns per row
    expect(cells()[8 + 2]).toHaveTextContent('3');
    await user.click(cells()[8 + 2]!);
    expect(screen.getByLabelText('Formula bar')).toHaveValue('=A2+B2');
    await user.click(cells()[8]!); // A2
    await user.keyboard('5{Enter}');
    expect(onChange).toHaveBeenCalledWith('a,b,sum\n5,2,=A2+B2');
  });
  it('is read-only without onChange', async () => {
    render(<SpreadsheetView content={'=1/0'} />);
    expect(screen.getByText('#DIV/0!')).toBeInTheDocument();
    expect(screen.getByLabelText('Formula bar')).toHaveAttribute('readonly');
  });
});

describe('TableView', () => {
  it('filters and sorts rows', async () => {
    const user = userEvent.setup();
    render(<TableView content={'name,score\nbo,10\nal,9\ncy,100'} />);
    await user.click(screen.getByRole('button', { name: 'score' }));
    const rows = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows()).toEqual(['al9', 'bo10', 'cy100']);
    await user.click(screen.getByRole('button', { name: /score/ }));
    expect(rows()[0]).toBe('cy100');
    await user.type(screen.getByLabelText('Filter rows'), 'bo');
    expect(rows()).toEqual(['bo10']);
    expect(screen.getByText('1 of 3 rows')).toBeInTheDocument();
  });
});

describe('latexToMarkdown', () => {
  it('converts structure, emphasis, lists and math', () => {
    const { markdown, title } = latexToMarkdown(String.raw`\documentclass{article}
\title{Notes}\author{Ada}
\begin{document}
\maketitle
\section{Intro} % a comment
Some \textbf{bold} and \emph{em} text with $x^2$ and 50\% off.
\begin{itemize}
\item First
\item[Key] Second
\end{itemize}
\begin{equation}\label{eq:1}
E = mc^2
\end{equation}
\begin{tabular}{ll}
a & b \\ c & d \\
\end{tabular}
\end{document}`);
    expect(title).toBe('Notes');
    expect(markdown).toContain('# Notes');
    expect(markdown).toContain('*Ada*');
    expect(markdown).toContain('## Intro');
    expect(markdown).not.toContain('a comment');
    expect(markdown).toContain('**bold** and *em*');
    expect(markdown).toContain('$x^2$');
    expect(markdown).toContain('50% off');
    expect(markdown).toContain('- First');
    expect(markdown).toContain('- **Key** Second');
    expect(markdown).toMatch(/\$\$\nE = mc\^2\n\$\$/);
    expect(markdown).toContain('| a | b |');
  });
});

describe('artifact files', () => {
  it('maps types to extensions, mime types and editor languages', () => {
    expect(extensionFor('code', 'Python')).toBe('py');
    expect(extensionFor('code', 'unknown')).toBe('txt');
    expect(extensionFor('spreadsheet')).toBe('csv');
    expect(extensionFor('react')).toBe('jsx');
    expect(mimeFor('svg')).toBe('image/svg+xml');
    expect(mimeFor('react')).toBe('text/plain');
    expect(editorLanguage('code', 'ts')).toBe('typescript');
    expect(editorLanguage('chart')).toBe('json');
    expect(editorLanguage('code', null)).toBe('plaintext');
  });
  it('makes safe file names and embed snippets', () => {
    expect(safeFileName('a/b:c*?"<>|  d')).toBe('a b c d');
    expect(safeFileName('   ')).toBe('artifact');
    expect(embedSnippet('abc123', 'My "app"<x>')).toContain('src="http://localhost:3000/a/abc123?embed=1"');
    expect(embedSnippet('abc123', 'My "app"<x>')).toContain('title="My appx"');
  });
  it('downloads blobs and prints a single element', () => {
    const created = vi.fn(() => 'blob:x');
    URL.createObjectURL = created;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadBlob(new Blob(['x']), 'f.txt');
    expect(created).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    const el = document.createElement('div');
    document.body.append(el);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(el).toHaveAttribute('data-print-root');
      expect(document.body).toHaveClass('lm-printing');
    });
    printElement(el);
    expect(print).toHaveBeenCalled();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body).not.toHaveClass('lm-printing');
  });
  it('serializes in-page SVG with a background and size', () => {
    document.body.innerHTML = '<svg width="10" height="5"><rect fill="red" width="1" height="1"/></svg>';
    const out = serializeSvg(document.querySelector('svg')!);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('<rect width="100%" height="100%"');
  });
});

describe('artifact cards and stream events', () => {
  it('records artifact events in the live stream', () => {
    const s = reduce({ text: '', reasoning: '', tools: [], status: 'streaming', error: null, fallback: null, compacted: false, reconnecting: false, usage: null, citations: [], artifacts: [], memoryIds: [] }, { type: 'artifact', id: 'x', version: 2, title: 'T', artifactType: 'markdown', action: 'updated' });
    expect(s.artifacts).toEqual([{ id: 'x', version: 2, title: 'T', artifactType: 'markdown', action: 'updated' }]);
  });
  it('identifies the artifact from tool arguments, results or live events', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(describeArtifactCall('create_artifact', { type: 'chart', title: 'Q' }, { content: `Created artifact "Q" (id: ${id}, version 1).`, isError: false })).toMatchObject({ id, version: 1, title: 'Q', type: 'chart', action: 'Created' });
    expect(describeArtifactCall('update_artifact', { id }, { content: 'Updated artifact "Doc" to version 4.', isError: false })).toMatchObject({ id, version: 4, title: 'Doc', action: 'Updated' });
    expect(describeArtifactCall('create_artifact', { title: 'Live' }, undefined, [{ id, version: 1, title: 'Live', artifactType: 'svg', action: 'created' }])).toMatchObject({ id, type: 'svg' });
  });
  it('opens the panel from a card', async () => {
    const user = userEvent.setup();
    const id = '11111111-2222-3333-4444-555555555555';
    render(<ArtifactCard name="create_artifact" args={{ type: 'markdown', title: 'Plan' }} result={{ content: `Created artifact "Plan" (id: ${id}, version 1).`, isError: false }} />);
    await user.click(screen.getByRole('button', { name: /Created artifact: Plan/ }));
    expect(useArtifactPanel.getState().openId).toBe(id);
    useArtifactPanel.getState().close();
  });
  it('shows diffs with text markers', () => {
    render(<DiffView patch={'===\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same'} />);
    expect(screen.getByText('Removed:')).toBeInTheDocument();
    expect(screen.getByLabelText('Changes between versions')).toHaveTextContent('+new');
    render(<DiffView patch={'--- a\n+++ b\n'} />);
    expect(screen.getByText('These versions are identical.')).toBeInTheDocument();
  });
});
