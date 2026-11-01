import { describe, expect, it, vi } from 'vitest';
import { ComfyUIAdapter, comfyWorkflow, createAdapter, openAiSize, ReplicateAdapter, StabilityAdapter } from '../src/index.js';
import { startMockProvider } from '../src/mock/server.js';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const png = () => new Response(Buffer.from('89504e47', 'hex'), { headers: { 'content-type': 'image/png' } });
const req = { model: 'm', prompt: 'a cat', n: 1, aspectRatio: '16:9' as const };

describe('image adapters', () => {
  it('maps aspect ratios to OpenAI sizes per model', () => {
    expect(openAiSize('dall-e-3', '16:9')).toBe('1792x1024');
    expect(openAiSize('gpt-image-1', '2:3')).toBe('1024x1536');
    expect(openAiSize('dall-e-2', '9:16')).toBe('1024x1024');
  });

  it('OpenAI-compatible images against the mock server, including refusals', async () => {
    const mock = await startMockProvider({ apiKey: 'k' });
    try {
      const a = createAdapter({ type: 'openai', baseUrl: `${mock.url}/v1`, apiKey: 'k' });
      const r = await a.generateImages!({ ...req, model: 'mock-image', n: 2 });
      expect(r.images).toHaveLength(2);
      expect(Buffer.from(r.images[0]!.base64, 'base64').subarray(1, 4).toString()).toBe('PNG');
      await expect(a.generateImages!({ ...req, model: 'mock-image', prompt: '[blocked]' })).rejects.toThrow(/safety system/);
    } finally {
      await mock.close();
    }
  });

  it('Stability posts a multipart form per image and reports filtered content', async () => {
    const f = vi.fn(async () => json({ image: 'QUJD', seed: 7, finish_reason: 'SUCCESS' }));
    const a = new StabilityAdapter({ type: 'stability', baseUrl: 'https://api.stability.ai', apiKey: 'sk', fetch: f as never });
    const r = await a.generateImages({ ...req, model: 'stable-image-core', n: 2, seed: 1 });
    expect(r.images.map((i) => i.seed)).toEqual([7, 7]);
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stability.ai/v2beta/stable-image/generate/core');
    expect((init.body as FormData).get('aspect_ratio')).toBe('16:9');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk');
    const filtered = new StabilityAdapter({ type: 'stability', baseUrl: 'https://x', apiKey: 'sk', fetch: (async () => json({ finish_reason: 'CONTENT_FILTERED' })) as never });
    await expect(filtered.generateImages(req)).rejects.toMatchObject({ kind: 'content_filter' });
    await expect((async () => { for await (const _ of a.stream()) void _; })()).rejects.toThrow(/only generates images/);
  });

  it('Replicate waits for the prediction and downloads outputs', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/p1')) return json({ status: 'succeeded', output: ['https://replicate.delivery/a.png'] });
      if (url.includes('/predictions')) return json({ status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } });
      return png();
    });
    const a = new ReplicateAdapter({ type: 'replicate', baseUrl: 'https://api.replicate.com', apiKey: 'r8', fetch: f as never });
    const r = await a.generateImages({ ...req, model: 'black-forest-labs/flux-schnell' });
    expect(r.images[0]!.mimeType).toBe('image/png');
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ input: { prompt: 'a cat', aspect_ratio: '16:9', num_outputs: 1, output_format: 'png' } });
    await expect(a.generateImages({ ...req, model: 'bad id' })).rejects.toThrow(/owner\/name/);
  });

  it('ComfyUI queues a workflow, polls history and downloads images', async () => {
    let polls = 0;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prompt')) {
        const wf = JSON.parse(String(init!.body)).prompt;
        expect(wf['4'].inputs.ckpt_name).toBe('sdxl.safetensors');
        expect(wf['5'].inputs).toMatchObject({ width: 1344, height: 768, batch_size: 1 });
        return json({ prompt_id: 'abc' });
      }
      if (url.includes('/history/abc')) return json(++polls < 2 ? {} : { abc: { outputs: { '9': { images: [{ filename: 'lumen_1.png', subfolder: '', type: 'output' }] } } } });
      if (url.includes('/view?')) return png();
      if (url.includes('object_info')) return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } } });
      return json({}, 404);
    });
    const a = new ComfyUIAdapter({ type: 'comfyui', baseUrl: 'http://comfy:8188', fetch: f as never });
    expect((await a.listModels())[0]).toMatchObject({ id: 'sdxl.safetensors', capabilities: { imageGen: true } });
    const r = await a.generateImages({ ...req, model: 'sdxl.safetensors' });
    expect(r.images).toHaveLength(1);
    expect(comfyWorkflow({ ...req, seed: 5 }, 8, 8)['3']).toMatchObject({ inputs: { seed: 5 } });
  });
});
