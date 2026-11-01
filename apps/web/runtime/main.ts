import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JsxRuntime from 'react/jsx-runtime';
import * as Recharts from 'recharts';
import * as Lucide from 'lucide-react';
import { transform } from 'sucrase';
import { BRIDGE_SOURCE } from './bridge.js';

/** Libraries React artifacts may import. Anything else is rejected with a clear error. */
const MODULES: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': JsxRuntime,
  recharts: Recharts,
  'lucide-react': Lucide,
};

function post(msg: Record<string, unknown>) {
  parent.postMessage({ __lumen: true, ...msg }, '*');
}

function installBridge() {
  // eslint-disable-next-line no-new-func -- runs the bridge in this sandboxed, network-less frame
  new Function(BRIDGE_SOURCE)();
}

function renderHtml(html: string) {
  const hasHead = /<head[^>]*>/i.test(html);
  const bridge = `<script>${BRIDGE_SOURCE}<\/script>`;
  const doc = hasHead ? html.replace(/<head[^>]*>/i, (m) => `${m}${bridge}`) : `<!doctype html><html><head><meta charset="utf-8">${bridge}</head><body>${html}</body></html>`;
  document.open();
  document.write(doc);
  document.close();
}

function renderReact(source: string) {
  installBridge();
  const code = transform(source, { transforms: ['jsx', 'typescript', 'imports'], jsxRuntime: 'automatic', production: true }).code;
  const module = { exports: {} as Record<string, unknown> };
  const req = (name: string) => {
    if (name in MODULES) return MODULES[name];
    throw new Error(`Import "${name}" is not available in artifacts. Allowed: ${Object.keys(MODULES).join(', ')}`);
  };
  // eslint-disable-next-line no-new-func -- compiled artifact code, executed inside the sandbox
  new Function('require', 'module', 'exports', 'React', code)(req, module, module.exports, React);
  const Component = (module.exports.default ?? Object.values(module.exports).find((v) => typeof v === 'function')) as React.ComponentType | undefined;
  if (!Component) throw new Error('The component must have a default export.');
  document.body.innerHTML = '<div id="root"></div>';
  document.body.style.margin = '0';
  document.body.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    componentDidCatch(error: Error) {
      post({ kind: 'error', message: error.message });
    }
    render() {
      return this.state.error ? React.createElement('pre', { style: { color: '#c62a2f', padding: 16, whiteSpace: 'pre-wrap' } }, String(this.state.error.message)) : this.props.children;
    }
  }
  ReactDOMClient.createRoot(document.getElementById('root')!).render(React.createElement(Boundary, null, React.createElement(Component)));
}

/**
 * Only run inside a sandboxed frame (opaque origin, "null"). Opened directly or framed without the sandbox
 * attribute, the runtime would share the app's origin, so it refuses to render anything.
 */
const sandboxed = (() => {
  try {
    return window.origin === 'null' && parent !== window;
  } catch {
    return false;
  }
})();

let rendered = false;
window.addEventListener('message', (e) => {
  if (!sandboxed || e.source !== parent || !e.data || !e.data.__lumen || e.data.kind !== 'render' || rendered) return;
  rendered = true;
  try {
    if (e.data.type === 'html') renderHtml(String(e.data.content));
    else renderReact(String(e.data.content));
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message });
    document.body.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:#c62a2f;padding:16px;white-space:pre-wrap;font:13px ui-monospace,monospace';
    pre.textContent = (err as Error).message;
    document.body.append(pre);
  }
});
if (sandboxed) post({ kind: 'ready' });
else document.body.textContent = 'This page only runs inside Lumen.';
