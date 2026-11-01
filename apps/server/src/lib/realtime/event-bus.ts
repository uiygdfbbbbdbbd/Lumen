import type { Redis } from 'ioredis';
import type { RealtimeEvent } from '@lumen/shared';

/** Per-user fan-out for cross-tab / cross-device sync. */
export interface EventBus {
  publish(userId: string, event: RealtimeEvent): Promise<void>;
  subscribe(userId: string, cb: (e: RealtimeEvent) => void): () => void;
  close(): Promise<void>;
}

export class MemoryEventBus implements EventBus {
  private readonly subs = new Map<string, Set<(e: RealtimeEvent) => void>>();
  async publish(userId: string, event: RealtimeEvent) {
    for (const cb of this.subs.get(userId) ?? []) cb(event);
  }
  subscribe(userId: string, cb: (e: RealtimeEvent) => void) {
    let set = this.subs.get(userId);
    if (!set) this.subs.set(userId, (set = new Set()));
    set.add(cb);
    return () => {
      set.delete(cb);
      if (!set.size) this.subs.delete(userId);
    };
  }
  async close() {
    this.subs.clear();
  }
}

export class RedisEventBus implements EventBus {
  private readonly local = new MemoryEventBus();
  private readonly channels = new Map<string, number>();
  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
  ) {
    this.sub.on('message', (channel: string, message: string) => {
      const userId = channel.slice('lumen:user:'.length);
      void this.local.publish(userId, JSON.parse(message) as RealtimeEvent);
    });
  }
  async publish(userId: string, event: RealtimeEvent) {
    await this.pub.publish(`lumen:user:${userId}`, JSON.stringify(event));
  }
  subscribe(userId: string, cb: (e: RealtimeEvent) => void) {
    const ch = `lumen:user:${userId}`;
    const n = this.channels.get(ch) ?? 0;
    if (n === 0) void this.sub.subscribe(ch);
    this.channels.set(ch, n + 1);
    const off = this.local.subscribe(userId, cb);
    return () => {
      off();
      const left = (this.channels.get(ch) ?? 1) - 1;
      if (left <= 0) {
        this.channels.delete(ch);
        void this.sub.unsubscribe(ch);
      } else this.channels.set(ch, left);
    };
  }
  async close() {
    this.sub.disconnect();
  }
}
