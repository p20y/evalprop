import type { Clock, ProviderFailure, ProviderResult } from "@evalprop/data";

/** One shared deadline for all provider work in a run (ARCHITECTURE §7.4: 5 s overall). */
export class Deadline {
  private readonly clock: Clock;
  private readonly handle: unknown;
  private readonly fired: Promise<void>;
  private isExpired = false;

  constructor(clock: Clock, ms: number) {
    this.clock = clock;
    let handle: unknown;
    this.fired = new Promise<void>((resolve) => {
      handle = clock.setTimeout(() => {
        this.isExpired = true;
        resolve();
      }, ms);
    });
    this.handle = handle;
  }

  get expired(): boolean {
    return this.isExpired;
  }

  /** Stops the timer. Call once provider work is done so no timer outlives the run. */
  cancel(): void {
    this.clock.clearTimeout(this.handle);
  }

  /**
   * Resolves with `work`'s result, or with a typed `TIMEOUT` failure if the deadline passes first. The
   * underlying call is not cancelled here (the gateway's own per-call timeout still bounds it, and its
   * result still lands in the cache), but the pipeline stops waiting for it.
   */
  race<T>(work: Promise<ProviderResult<T>>): Promise<ProviderResult<T>> {
    const late: ProviderFailure = { ok: false, code: "TIMEOUT", message: "overall deadline reached" };
    if (this.isExpired) return Promise.resolve(late);
    return Promise.race([work, this.fired.then((): ProviderResult<T> => late)]);
  }
}
