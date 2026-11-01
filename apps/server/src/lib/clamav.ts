import net from 'node:net';

export interface VirusScanner {
  /** Returns the signature name if infected, null if clean. Throws if the scanner is unreachable. */
  scan(data: Buffer): Promise<string | null>;
}

/** clamd INSTREAM protocol client (TCP). Enable with CLAMAV_HOST / CLAMAV_PORT. */
export class ClamdScanner implements VirusScanner {
  constructor(private readonly host: string, private readonly port = 3310, private readonly timeoutMs = 30_000) {}

  scan(data: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let reply = '';
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('ClamAV timed out')));
      socket.on('error', reject);
      socket.on('data', (d) => (reply += d.toString()));
      socket.on('end', () => {
        const r = reply.replace(/\0/g, '').trim();
        if (/: OK$/.test(r)) resolve(null);
        else if (/FOUND$/.test(r)) resolve(r.replace(/^stream: /, '').replace(/ FOUND$/, ''));
        else reject(new Error(`Unexpected ClamAV reply: ${r.slice(0, 200)}`));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += 64 * 1024) {
          const chunk = data.subarray(i, i + 64 * 1024);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          socket.write(len);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}

export const noScanner: VirusScanner = { scan: async () => null };
