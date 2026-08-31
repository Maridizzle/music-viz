export interface ViewportSize {
  width: number;
  height: number;
  dpr: number;
}

/**
 * Track the size of an element (ResizeObserver + orientation changes), reporting
 * CSS pixel size and a capped devicePixelRatio. Coalesced to one rAF.
 */
export class ViewportWatcher {
  private observer: ResizeObserver;
  private frame = 0;
  private dprCap: number;

  constructor(
    private readonly el: HTMLElement,
    dprCap: number,
    private readonly onChange: (size: ViewportSize) => void,
  ) {
    this.dprCap = dprCap;
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(el);
    window.addEventListener('orientationchange', this.schedule);
    window.visualViewport?.addEventListener('resize', this.schedule);
  }

  setDprCap(cap: number): void {
    this.dprCap = cap;
    this.emit();
  }

  measure(): ViewportSize {
    const width = Math.max(1, this.el.clientWidth);
    const height = Math.max(1, this.el.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    return { width, height, dpr };
  }

  private schedule = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.emit();
    });
  };

  private emit(): void {
    this.onChange(this.measure());
  }

  dispose(): void {
    this.observer.disconnect();
    window.removeEventListener('orientationchange', this.schedule);
    window.visualViewport?.removeEventListener('resize', this.schedule);
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}
