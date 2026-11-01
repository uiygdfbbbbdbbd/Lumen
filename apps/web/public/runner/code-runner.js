// Runs one snippet per Web Worker (so a runaway loop can be killed) and streams output to the parent.
(function () {
  'use strict';
  var sandboxed = (function () {
    try {
      return self.origin === 'null' && parent !== window;
    } catch (e) {
      return false;
    }
  })();
  if (!sandboxed) {
    document.body.textContent = 'This page only runs inside Lumen.';
    return;
  }
  var base = location.origin;
  function post(msg) {
    msg.__lumen = true;
    parent.postMessage(msg, '*');
  }

  var JS_WORKER = [
    'var send = function (stream, args) { postMessage({ t: "out", stream: stream, text: args.map(function (a) { try { return typeof a === "string" ? a : JSON.stringify(a); } catch (e) { return String(a); } }).join(" ") }); };',
    'console.log = function () { send("stdout", [].slice.call(arguments)); };',
    'console.info = console.log; console.debug = console.log;',
    'console.warn = function () { send("stderr", [].slice.call(arguments)); }; console.error = console.warn;',
    'self.fetch = function () { return Promise.reject(new Error("Network access is disabled in the code runner.")); };',
    'self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined;',
    'onmessage = async function (e) {',
    '  try { var r = await (0, eval)("(async () => {\\n" + e.data.code + "\\n})()"); postMessage({ t: "done", ok: true, result: r === undefined ? null : String(r) }); }',
    '  catch (err) { postMessage({ t: "done", ok: false, error: (err && err.stack) || String(err) }); }',
    '};',
  ].join('\n');

  // Classic worker + dynamic import(): module workers can't start from blob URLs in an opaque-origin frame.
  var PY_WORKER = [
    'var send = function (stream) { return function (text) { postMessage({ t: "out", stream: stream, text: text }); }; };',
    'onmessage = function (e) {',
    '  postMessage({ t: "status", text: "Loading Python…" });',
    '  import("' + base + '/pyodide/pyodide.mjs")',
    '    .then(function (m) { return m.loadPyodide({ indexURL: "' + base + '/pyodide/", stdout: send("stdout"), stderr: send("stderr") }); })',
    '    .then(function (py) { postMessage({ t: "status", text: "Running…" }); return py.runPythonAsync(e.data.code); })',
    '    .then(function (r) { postMessage({ t: "done", ok: true, result: r === undefined || r === null ? null : String(r) }); })',
    '    .catch(function (err) { postMessage({ t: "done", ok: false, error: String((err && err.message) || err) }); });',
    '};',
  ].join('\n');

  var current = null;
  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.__lumen !== true) return;
    var d = e.data;
    if (d.kind === 'stop' && current) {
      current.worker.terminate();
      post({ kind: 'done', id: current.id, ok: false, error: 'Stopped.' });
      clearTimeout(current.timer);
      current = null;
      return;
    }
    if (d.kind !== 'run' || current) return;
    var python = d.language === 'python';
    var url = URL.createObjectURL(new Blob([python ? PY_WORKER : JS_WORKER], { type: 'text/javascript' }));
    var worker = new Worker(url);
    var started = Date.now();
    var job = { id: d.id, worker: worker, timer: 0 };
    current = job;
    function finish(msg) {
      clearTimeout(job.timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      current = null;
      msg.kind = 'done';
      msg.id = d.id;
      msg.ms = Date.now() - started;
      post(msg);
    }
    job.timer = setTimeout(function () {
      finish({ ok: false, error: 'Timed out after ' + Math.round((d.timeoutMs || 30000) / 1000) + ' seconds.' });
    }, d.timeoutMs || 30000);
    worker.onmessage = function (ev) {
      var m = ev.data;
      if (m.t === 'out') post({ kind: 'output', id: d.id, stream: m.stream, text: String(m.text).slice(0, 20000) });
      else if (m.t === 'status') post({ kind: 'status', id: d.id, text: m.text });
      else if (m.t === 'done') finish({ ok: m.ok, result: m.result, error: m.error });
    };
    worker.onerror = function (ev) {
      ev.preventDefault();
      finish({ ok: false, error: ev.message || 'The code could not start.' });
    };
    worker.postMessage({ code: String(d.code) });
  });
  post({ kind: 'ready' });
})();
