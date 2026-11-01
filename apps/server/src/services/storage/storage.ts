import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface StoredObject {
  body: Readable;
  size: number;
  contentType: string;
}

export interface StorageDriver {
  put(key: string, body: Buffer | Readable, contentType: string): Promise<{ size: number }>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Object keys are generated server-side, but validate anyway: no traversal, no absolute paths. */
export function assertSafeKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,511}$/.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

export class FsStorage implements StorageDriver {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('storage key escapes root');
    return full;
  }

  async put(key: string, body: Buffer | Readable, contentType: string) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await pipeline(Buffer.isBuffer(body) ? Readable.from([body]) : body, createWriteStream(full));
    await writeFile(`${full}.meta`, JSON.stringify({ contentType }));
    return { size: (await stat(full)).size };
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.resolve(key);
    try {
      const s = await stat(full);
      const meta = JSON.parse(await readFile(`${full}.meta`, 'utf8').catch(() => '{}')) as { contentType?: string };
      return { body: createReadStream(full), size: s.size, contentType: meta.contentType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    const full = this.resolve(key);
    await rm(full, { force: true });
    await rm(`${full}.meta`, { force: true });
  }

  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export class S3Storage implements StorageDriver {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  static fromConfig(c: { endpoint?: string; region: string; bucket: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean }) {
    const client = new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      forcePathStyle: c.forcePathStyle,
      credentials: c.accessKeyId && c.secretAccessKey ? { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } : undefined,
    });
    return new S3Storage(client, c.bucket);
  }

  async put(key: string, body: Buffer | Readable, contentType: string) {
    assertSafeKey(key);
    const buf = Buffer.isBuffer(body) ? body : Buffer.concat(await body.toArray());
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: contentType }));
    return { size: buf.length };
  }

  async get(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { body: res.Body as Readable, size: res.ContentLength ?? 0, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string) {
    assertSafeKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
