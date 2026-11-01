/**
 * Envelope encryption for secrets at rest (provider keys, TOTP secrets, OAuth tokens, user sandbox secrets).
 *
 * Format: v1.<kekId>.<wrappedDek>.<payload>   (each part base64url; wrapped/payload = iv(12)|tag(16)|ciphertext)
 * - A fresh 256-bit data key (DEK) encrypts each value with AES-256-GCM.
 * - The DEK is wrapped by a key-encryption key (KEK) from ENCRYPTION_KEYS.
 * - Rotation re-wraps the DEK under the active KEK without touching the payload.
 * - Optional associated data binds a ciphertext to its owner (e.g. "provider:<id>") so it can't be swapped.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const VERSION = 'v1';

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}

function seal(key: Buffer, plaintext: Buffer, aad?: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function open(key: Buffer, sealed: Buffer, aad?: string): Buffer {
  if (sealed.length < 28) throw new CryptoError('ciphertext too short');
  const iv = sealed.subarray(0, 12);
  const tag = sealed.subarray(12, 28);
  const ct = sealed.subarray(28);
  const decipher = createDecipheriv(ALG, key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new CryptoError('decryption failed (wrong key, tampered data, or wrong context)');
  }
}

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

export function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export class SecretBox {
  private readonly keys = new Map<string, Buffer>();
  readonly activeKeyId: string;

  constructor(keys: Buffer[]) {
    if (keys.length === 0) throw new CryptoError('at least one encryption key is required');
    for (const k of keys) {
      if (k.length !== 32) throw new CryptoError('encryption keys must be 32 bytes');
      this.keys.set(keyId(k), k);
    }
    this.activeKeyId = keyId(keys[0]!);
  }

  encrypt(plaintext: string, aad?: string): string {
    const dek = randomBytes(32);
    const kek = this.keys.get(this.activeKeyId)!;
    const payload = seal(dek, Buffer.from(plaintext, 'utf8'), aad);
    const wrapped = seal(kek, dek, `dek:${aad ?? ''}`);
    dek.fill(0);
    return [VERSION, this.activeKeyId, b64u(wrapped), b64u(payload)].join('.');
  }

  private parse(ciphertext: string): { kid: string; wrapped: Buffer; payload: Buffer } {
    const parts = ciphertext.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) throw new CryptoError('unrecognized ciphertext format');
    return { kid: parts[1]!, wrapped: Buffer.from(parts[2]!, 'base64url'), payload: Buffer.from(parts[3]!, 'base64url') };
  }

  decrypt(ciphertext: string, aad?: string): string {
    const { kid, wrapped, payload } = this.parse(ciphertext);
    const kek = this.keys.get(kid);
    if (!kek) throw new CryptoError(`encryption key ${kid} is not configured`);
    const dek = open(kek, wrapped, `dek:${aad ?? ''}`);
    try {
      return open(dek, payload, aad).toString('utf8');
    } finally {
      dek.fill(0);
    }
  }

  needsRotation(ciphertext: string): boolean {
    return this.parse(ciphertext).kid !== this.activeKeyId;
  }

  /** Re-wrap the data key under the active KEK. Payload bytes are unchanged. */
  rotate(ciphertext: string, aad?: string): string {
    const { kid, wrapped, payload } = this.parse(ciphertext);
    if (kid === this.activeKeyId) return ciphertext;
    const oldKek = this.keys.get(kid);
    if (!oldKek) throw new CryptoError(`encryption key ${kid} is not configured`);
    const dek = open(oldKek, wrapped, `dek:${aad ?? ''}`);
    try {
      const rewrapped = seal(this.keys.get(this.activeKeyId)!, dek, `dek:${aad ?? ''}`);
      return [VERSION, this.activeKeyId, b64u(rewrapped), b64u(payload)].join('.');
    } finally {
      dek.fill(0);
    }
  }
}

/** Display-safe mask for secrets: keeps a short prefix and the last 4 chars. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••';
  const prefix = /^[a-z]{2,4}[-_]/i.exec(secret)?.[0] ?? '';
  return `${prefix}••••${secret.slice(-4)}`;
}
