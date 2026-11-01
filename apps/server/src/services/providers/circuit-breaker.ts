/**
 * Per-provider circuit breaker. After `threshold` consecutive failures the circuit opens and calls
 * fail fast for `cooldownMs`; then one trial request is allowed (half-open). Success closes it.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private readonly circuits = new Map<string, { failures: number; openedAt: number | null; trial: boolean }>();

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  private get(id: string) {
    let c = this.circuits.get(id);
    if (!c) {
      c = { failures: 0, openedAt: null, trial: false };
      this.circuits.set(id, c);
    }
    return c;
  }

  state(id: string): CircuitState {
    const c = this.get(id);
    if (c.openedAt === null) return 'closed';
    return this.now() - c.openedAt >= this.cooldownMs ? 'half_open' : 'open';
  }

  /** Whether a request may proceed. In half-open state only one trial request is let through. */
  allow(id: string): boolean {
    const s = this.state(id);
    if (s === 'closed') return true;
    if (s === 'open') return false;
    const c = this.get(id);
    if (c.trial) return false;
    c.trial = true;
    return true;
  }

  success(id: string): void {
    this.circuits.set(id, { failures: 0, openedAt: null, trial: false });
  }

  failure(id: string): void {
    const c = this.get(id);
    c.failures += 1;
    c.trial = false;
    if (c.failures >= this.threshold || c.openedAt !== null) c.openedAt = this.now();
  }
}
