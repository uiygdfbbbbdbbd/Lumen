/**
 * Bridge code that runs inside the sandboxed artifact frame. It has no network access (CSP connect-src 'none')
 * and an opaque origin, so all capabilities go through postMessage to the parent, which applies the user's auth,
 * quotas and rate limits.
 */
export const BRIDGE_SOURCE = `(() => {
  if (window.lumen) return;
  let seq = 0;
  const pending = new Map();
  const send = (msg) => parent.postMessage({ __lumen: true, ...msg }, '*');
  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || !e.data.__lumen || e.data.kind !== 'reply') return;
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
  });
  const call = (method, args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    send({ kind: 'call', id, method, args });
  });
  window.lumen = {
    ai: (prompt, opts) => call('ai', { prompt: String(prompt), ...(opts || {}) }).then((r) => r.text),
    storage: {
      get: (key, opts) => call('storage.get', { key, shared: !!(opts && opts.shared) }),
      set: (key, value, opts) => call('storage.set', { key, value, shared: !!(opts && opts.shared) }),
      delete: (key) => call('storage.delete', { key }),
    },
  };
  const fmt = (a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } };
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { send({ kind: 'console', level, text: args.map(fmt).join(' ').slice(0, 2000) }); orig(...args); };
  }
  window.addEventListener('error', (e) => send({ kind: 'error', message: String(e.message), line: e.lineno, column: e.colno }));
  window.addEventListener('unhandledrejection', (e) => send({ kind: 'error', message: 'Unhandled promise rejection: ' + fmt(e.reason && e.reason.message || e.reason) }));
  const report = () => send({ kind: 'size', height: document.documentElement.scrollHeight });
  new ResizeObserver(report).observe(document.documentElement);
  window.addEventListener('message', (e) => { if (e.source === parent && e.data && e.data.__lumen && e.data.kind === 'print') window.print(); });
})();`;
