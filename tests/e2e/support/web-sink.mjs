// A tiny SearXNG-compatible search engine plus a few web pages, for E2E tests of web tools and Deep Research.
import { createServer } from 'node:http';

const PORT = Number(process.env.WEB_SINK_PORT ?? 4020);
const base = `http://127.0.0.1:${PORT}`;
const alt = `http://127.0.0.2:${PORT}`;
const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><nav>Home | About</nav><article><h1>${title}</h1>${body}</article></body></html>`;
const para = (topic) => `<p>${topic} is covered in depth here, with measurements, history and practical advice for readers who want the details. </p>`.repeat(8);

const PAGES = {
  '/tides': ['How Tides Work', para('The pull of the Moon on the oceans')],
  '/moon': ['The Moon and the Sea', para('Lunar gravity and tidal ranges')],
  '/coast': ['Coastal Tide Tables', para('Daily tide tables for coastal towns')],
  '/review': ['An Independent Review of Tide Science', para('Independent tide research')],
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', base);
  if (url.pathname === '/search') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ results: [
      { title: 'How Tides Work', url: `${base}/tides`, content: 'The Moon pulls the oceans.' },
      { title: 'The Moon and the Sea', url: `${base}/moon`, content: 'Lunar gravity explained.' },
      { title: 'Coastal Tide Tables', url: `${base}/coast`, content: 'Tide tables.' },
      { title: 'An Independent Review of Tide Science', url: `${alt}/review`, content: 'A second opinion.' },
    ] }));
  }
  if (url.pathname === '/robots.txt') {
    res.setHeader('content-type', 'text/plain');
    return res.end('User-agent: *\nDisallow: /private/');
  }
  const p = PAGES[url.pathname];
  if (!p) {
    res.statusCode = 404;
    return res.end('not found');
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(page(p[0], p[1]));
}).listen(PORT, '0.0.0.0', () => console.log(`web sink on ${base}`));
