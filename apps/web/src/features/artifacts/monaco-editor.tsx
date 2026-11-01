import { useEffect, useRef, useSyncExternalStore } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

// Self-hosted Monaco: never fetch the editor from a CDN (works offline and under a strict CSP).
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

const subscribe = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};

export interface CodeEditorProps {
  /** Initial text. The editor is uncontrolled (so fast typing never races React); remount it via `key` to reset. */
  value: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSelectionChange?: (text: string) => void;
  /** Ctrl/Cmd+S inside the editor. */
  onSave?: () => void;
  label: string;
}

export default function CodeEditor({ value, language, readOnly, onChange, onSelectionChange, onSave, label }: CodeEditorProps) {
  const dark = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === 'dark');
  const handlers = useRef({ onSelectionChange, onSave });
  handlers.current = { onSelectionChange, onSave };
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const onMount: OnMount = (editor, m) => {
    editorRef.current = editor;
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      handlers.current.onSelectionChange?.(sel && !sel.isEmpty() ? (editor.getModel()?.getValueInRange(sel) ?? '') : '');
    });
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => handlers.current.onSave?.());
  };
  useEffect(() => () => void (editorRef.current = null), []);

  return (
    <Editor
      defaultValue={value}
      language={language}
      theme={dark ? 'vs-dark' : 'vs'}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={onMount}
      loading={<div className="h-full animate-pulse bg-surface" aria-label="Loading editor" />}
      options={{
        readOnly,
        ariaLabel: label,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderLineHighlight: 'line',
        accessibilitySupport: 'auto',
      }}
    />
  );
}
