import { joinUrl, request } from './http.js';
import { LlmError, type ModelInfo, type ProviderConfig, type ProviderType, type ProviderAdapter, type StreamEvent, type EmbeddingResult } from './types.js';

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface ImageRequest {
  model: string;
  prompt: string;
  n: number;
  aspectRatio: AspectRatio;
  negativePrompt?: string;
  seed?: number;
}

export interface GeneratedImage {
  base64: string;
  mimeType: string;
  revisedPrompt?: string;
  seed?: number;
}

export interface ImageResult {
  images: GeneratedImage[];
}

/** Sizes accepted by OpenAI-style image APIs, closest to the requested aspect ratio. */
export function openAiSize(model: string, ratio: AspectRatio): string {
  const wide = ['16:9', '3:2', '4:3'].includes(ratio);
  const tall = ['9:16', '2:3', '3:4'].includes(ratio);
  if (/dall-e-3/.test(model)) return wide ? '1792x1024' : tall ? '1024x1792' : '1024x1024';
  if (/dall-e-2/.test(model)) return '1024x1024';
  return wide ? '1536x1024' : tall ? '1024x1536' : '1024x1024';
}

async function toBase64(cfg: ProviderConfig, url: string, signal?: AbortSignal): Promise<GeneratedImage> {
  const res = await request(cfg, url, { signal });
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mimeType: res.headers.get('content-type')?.split(';')[0] ?? 'image/png' };
}

/** OpenAI-compatible `POST /images/generations` (OpenAI, many gateways, LocalAI, the mock server). */
export async function openAiImages(cfg: ProviderConfig, headers: Record<string, string>, req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
  const gptImage = /^gpt-image/.test(req.model);
  const body: Record<string, unknown> = { model: req.model, prompt: req.prompt, n: req.n, size: openAiSize(req.model, req.aspectRatio) };
  if (!gptImage) body.response_format = 'b64_json';
  const res = await request(cfg, joinUrl(cfg.baseUrl, 'images/generations'), { method: 'POST', headers, body: JSON.stringify(body), signal });
  const j = (await res.json()) as { data?: { b64_json?: string; url?: string; revised_prompt?: string }[] };
  const images: GeneratedImage[] = [];
  for (const d of j.data ?? []) {
    if (d.b64_json) images.push({ base64: d.b64_json, mimeType: 'image/png', revisedPrompt: d.revised_prompt });
    else if (d.url) images.push({ ...(await toBase64(cfg, d.url, signal)), revisedPrompt: d.revised_prompt });
  }
  if (!images.length) throw new LlmError('server', 'The image provider returned no images.');
  return { images };
}

/** Base for providers that only make images: chat and embeddings are refused clearly. */
abstract class ImageOnlyAdapter implements ProviderAdapter {
  constructor(
    protected readonly cfg: ProviderConfig,
    readonly type: ProviderType,
  ) {}
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<StreamEvent> {
    throw new LlmError('invalid_request', 'This provider only generates images. Pick a chat model.');
  }
  async embed(): Promise<EmbeddingResult> {
    throw new LlmError('invalid_request', 'This provider does not offer embeddings.');
  }
  abstract listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  abstract generateImages(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
  protected auth(): Record<string, string> {
    return { ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}), ...(this.cfg.headers ?? {}) };
  }
}

const imageCaps = { vision: false, tools: false, json: false, reasoning: false, audio: false, imageGen: true };

/** Stability AI v2beta Stable Image endpoints. */
export class StabilityAdapter extends ImageOnlyAdapter {
  constructor(cfg: ProviderConfig) {
    super(cfg, 'stability');
  }
  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'stable-image-core', displayName: 'Stable Image Core', capabilities: imageCaps },
      { id: 'stable-image-ultra', displayName: 'Stable Image Ultra', capabilities: imageCaps },
      { id: 'sd3.5-large', displayName: 'Stable Diffusion 3.5 Large', capabilities: imageCaps },
    ];
  }
  async generateImages(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    const endpoint = req.model === 'stable-image-ultra' ? 'ultra' : req.model === 'stable-image-core' ? 'core' : 'sd3';
    const images: GeneratedImage[] = [];
    for (let i = 0; i < req.n; i++) {
      const form = new FormData();
      form.set('prompt', req.prompt);
      form.set('aspect_ratio', req.aspectRatio);
      form.set('output_format', 'png');
      if (endpoint === 'sd3') form.set('model', req.model);
      if (req.negativePrompt) form.set('negative_prompt', req.negativePrompt);
      if (req.seed !== undefined) form.set('seed', String(req.seed + i));
      const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, `v2beta/stable-image/generate/${endpoint}`), { method: 'POST', headers: { ...this.auth(), accept: 'application/json' }, body: form, signal });
      const j = (await res.json()) as { image?: string; seed?: number; finish_reason?: string };
      if (j.finish_reason === 'CONTENT_FILTERED') throw new LlmError('content_filter', 'The image provider blocked this prompt.');
      if (!j.image) throw new LlmError('server', 'The image provider returned no image.');
      images.push({ base64: j.image, mimeType: 'image/png', seed: j.seed });
    }
    return { images };
  }
}

/** Replicate predictions (e.g. black-forest-labs/flux-schnell). Model ids are "owner/name". */
export class ReplicateAdapter extends ImageOnlyAdapter {
  constructor(cfg: ProviderConfig) {
    super(cfg, 'replicate');
  }
  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'black-forest-labs/flux-schnell', displayName: 'FLUX.1 [schnell]', capabilities: imageCaps },
      { id: 'black-forest-labs/flux-dev', displayName: 'FLUX.1 [dev]', capabilities: imageCaps },
      { id: 'black-forest-labs/flux-1.1-pro', displayName: 'FLUX 1.1 [pro]', capabilities: imageCaps },
    ];
  }
  async generateImages(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(req.model)) throw new LlmError('invalid_request', 'Replicate model ids look like "owner/name".');
    const input: Record<string, unknown> = { prompt: req.prompt, aspect_ratio: req.aspectRatio, num_outputs: req.n, output_format: 'png' };
    if (req.seed !== undefined) input.seed = req.seed;
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, `v1/models/${req.model}/predictions`), {
      method: 'POST',
      headers: { ...this.auth(), 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({ input }),
      signal,
    });
    let p = (await res.json()) as { status: string; output?: string | string[]; error?: string; urls?: { get?: string } };
    const deadline = Date.now() + (this.cfg.timeoutMs ?? 120_000);
    while (!['succeeded', 'failed', 'canceled'].includes(p.status) && p.urls?.get && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      p = (await (await request(this.cfg, p.urls.get, { headers: this.auth(), signal })).json()) as typeof p;
    }
    if (p.status !== 'succeeded') throw new LlmError(p.status === 'failed' ? 'server' : 'timeout', p.error ?? 'The image generation did not finish.');
    const urls = Array.isArray(p.output) ? p.output : p.output ? [p.output] : [];
    return { images: await Promise.all(urls.slice(0, req.n).map((u) => toBase64(this.cfg, u, signal))) };
  }
}

/** A minimal ComfyUI text-to-image workflow; the model id is the checkpoint file name. */
export function comfyWorkflow(req: ImageRequest, width: number, height: number): Record<string, unknown> {
  return {
    '3': { class_type: 'KSampler', inputs: { seed: req.seed ?? Math.floor(Math.random() * 2 ** 31), steps: 25, cfg: 6.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: req.model } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: req.n } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: req.prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: req.negativePrompt ?? 'blurry, low quality', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'lumen', images: ['8', 0] } },
  };
}

const RATIO_PX: Record<AspectRatio, [number, number]> = { '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1152, 896], '3:4': [896, 1152], '3:2': [1216, 832], '2:3': [832, 1216] };

/** Local ComfyUI server (queue a workflow, poll its history, download the outputs). */
export class ComfyUIAdapter extends ImageOnlyAdapter {
  constructor(cfg: ProviderConfig) {
    super(cfg, 'comfyui');
  }
  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'object_info/CheckpointLoaderSimple'), { headers: this.auth(), signal });
    const j = (await res.json()) as { CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } } };
    return (j.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []).map((id) => ({ id, displayName: id.replace(/\.(safetensors|ckpt)$/, ''), capabilities: imageCaps }));
  }
  async generateImages(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    const [w, h] = RATIO_PX[req.aspectRatio];
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'prompt'), { method: 'POST', headers: { ...this.auth(), 'content-type': 'application/json' }, body: JSON.stringify({ prompt: comfyWorkflow(req, w, h), client_id: 'lumen' }), signal });
    const { prompt_id: id } = (await res.json()) as { prompt_id: string };
    const deadline = Date.now() + (this.cfg.timeoutMs ?? 300_000);
    for (;;) {
      if (Date.now() > deadline) throw new LlmError('timeout', 'ComfyUI took too long.');
      const hist = (await (await request(this.cfg, joinUrl(this.cfg.baseUrl, `history/${id}`), { headers: this.auth(), signal })).json()) as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>;
      const outputs = hist[id]?.outputs;
      const files = outputs ? Object.values(outputs).flatMap((o) => o.images ?? []) : [];
      if (files.length) {
        return {
          images: await Promise.all(
            files.slice(0, req.n).map((f) => toBase64(this.cfg, joinUrl(this.cfg.baseUrl, `view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder)}&type=${encodeURIComponent(f.type)}`), signal)),
          ),
        };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
