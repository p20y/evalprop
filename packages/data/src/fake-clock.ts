import type { Clock } from "./gateway.ts";

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/**
 * A manually advanced clock for tests: `setTimeout` callbacks run only when `advance` moves time
 * past them, so timeout and retry behavior is deterministic and takes no real time.
 */
export class FakeClock implements Clock {
  private time: number;
  private nextId = 1;
  private timers: Timer[] = [];

  constructor(startMs: number = Date.parse("2026-10-01T00:00:00.000Z")) {
    this.time = startMs;
  }

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  /** Timers still scheduled. A correct gateway leaves none behind once a call settles. */
  get pendingTimers(): number {
    return this.timers.length;
  }

  /** Lets queued promise callbacks run (real macrotask turns; no fake time passes). */
  async flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  /** Moves time forward, firing due timers in order and letting promise chains run between them. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await this.flush();
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.time = Math.max(this.time, due.at);
      due.fn();
      await this.flush();
    }
    this.time = target;
    await this.flush();
  }
}
