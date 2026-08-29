/** requestAnimationFrame loop that reports a clamped delta and elapsed seconds. */
export class Loop {
  private raf = 0;
  private last = 0;
  private running = false;

  constructor(private readonly cb: (dt: number, elapsed: number) => void) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.cb(dt, now / 1000);
    this.raf = requestAnimationFrame(this.tick);
  };
}
