import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signup, type TestApp, type TestClient } from '../helpers/app.js';

let t: TestApp;
let user: TestClient;
let base = '';

function multipart(file: Buffer, filename: string) {
  const b = `----lumen${Date.now()}`;
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`)]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

beforeAll(async () => {
  t = await createTestApp();
  user = t.client();
  await signup(user);
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
});
afterAll(() => t.close());

describe('streamed responses over real HTTP', () => {
  it('serves large files to concurrent clients without breaking the server', async () => {
    const big = Buffer.from('lorem ipsum dolor sit amet\n'.repeat(200_000));
    const m = multipart(big, 'big.txt');
    const file = (await user.request('POST', '/api/files', m.payload, m.headers)).json();
    const cookie = [...(user as unknown as { cookies: Map<string, string> }).cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const results = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const res = await fetch(`${base}/api/files/${file.id}/content`, { headers: { cookie } });
        return { status: res.status, length: (await res.arrayBuffer()).byteLength };
      }),
    );
    expect(results.every((r) => r.status === 200 && r.length === big.length)).toBe(true);
    // A client that disconnects mid-download must not take the server down either.
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/files/${file.id}/content`, { headers: { cookie }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    await reader.read();
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});
