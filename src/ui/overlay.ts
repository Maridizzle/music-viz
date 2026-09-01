import { NowPlayingCard, type NowPlayingHandlers } from './NowPlayingCard';
import { SourcePicker, type SourceHandlers } from './SourcePicker';

export interface OverlayHandlers {
  source: SourceHandlers;
  onTogglePanel: () => void;
  onFullscreen: () => void;
  nowPlaying: NowPlayingHandlers;
}

export interface OverlayOptions {
  showDisplay: boolean;
  nativeCapture: boolean;
  showFullscreen: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Start overlay ("choose a source"), top-bar buttons, now-playing card, and transient toasts. */
export class UIShell {
  readonly nowPlaying: NowPlayingCard;
  private readonly overlay: HTMLElement;
  private readonly status: HTMLElement;
  private readonly picker: SourcePicker;
  private readonly toastEl: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, handlers: OverlayHandlers, opts: OverlayOptions) {
    // Top bar
    const topbar = el('div', 'topbar');
    const sourceBtn = el('button', 'icon-btn', '🎵') as HTMLButtonElement;
    sourceBtn.title = 'Change source';
    sourceBtn.addEventListener('click', () => this.showOverlay());
    const panelBtn = el('button', 'icon-btn', '⚙️') as HTMLButtonElement;
    panelBtn.title = 'Controls';
    panelBtn.addEventListener('click', handlers.onTogglePanel);
    topbar.append(sourceBtn, panelBtn);
    if (opts.showFullscreen) {
      const fsBtn = el('button', 'icon-btn', '⛶') as HTMLButtonElement;
      fsBtn.title = 'Fullscreen';
      fsBtn.addEventListener('click', handlers.onFullscreen);
      topbar.appendChild(fsBtn);
    }
    root.appendChild(topbar);

    // Overlay
    this.overlay = el('div', 'overlay');
    const card = el('div', 'overlay-card');
    card.append(
      el('h1', 'overlay-title', 'Music Visualizer'),
      el('p', 'overlay-sub', 'Choose an audio source to begin'),
    );
    this.picker = new SourcePicker(handlers.source, {
      showDisplay: opts.showDisplay,
      nativeCapture: opts.nativeCapture,
    });
    card.appendChild(this.picker.root);
    this.status = el('p', 'overlay-status');
    card.appendChild(this.status);
    this.overlay.appendChild(card);
    root.appendChild(this.overlay);

    // Now-playing (Spotify mode) card
    this.nowPlaying = new NowPlayingCard(root, handlers.nowPlaying);

    // Toast
    this.toastEl = el('div', 'toast');
    root.appendChild(this.toastEl);
  }

  showOverlay(): void {
    this.overlay.classList.add('visible');
    this.picker.setBusy(false);
  }

  hideOverlay(): void {
    this.overlay.classList.remove('visible');
  }

  isOverlayOpen(): boolean {
    return this.overlay.classList.contains('visible');
  }

  setBusy(busy: boolean): void {
    this.picker.setBusy(busy);
  }

  setStatus(message: string, isError = false): void {
    this.status.textContent = message;
    this.status.classList.toggle('error', isError);
  }

  toast(message: string, isError = false): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle('error', isError);
    this.toastEl.classList.add('visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('visible'), 4000);
  }
}
