import type { SpotifyModeState, SpotifyTrack, TempoInfo } from '../spotify/types';

export interface NowPlayingHandlers {
  onTapBeat: () => void;
  onDisconnect: () => void;
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

const STATE_ICON: Record<SpotifyModeState, string> = {
  off: '',
  idle: '💤',
  paused: '⏸',
  listening: '🎤',
  beatlock: '🎧',
};

/** Small always-on card (bottom-left) showing the Spotify track, mode, and a tap-the-beat button. */
export class NowPlayingCard {
  readonly root: HTMLElement;
  private readonly art: HTMLImageElement;
  private readonly title: HTMLElement;
  private readonly artist: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly tapBtn: HTMLButtonElement;
  private dimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement, handlers: NowPlayingHandlers) {
    this.root = el('div', 'np-card');
    this.art = el('img', 'np-art') as HTMLImageElement;
    this.art.alt = '';
    this.art.decoding = 'async';
    const text = el('div', 'np-text');
    this.title = el('div', 'np-title', 'Spotify');
    this.artist = el('div', 'np-artist', 'Connecting…');
    this.chip = el('div', 'np-chip', '');
    text.append(this.title, this.artist, this.chip);

    const actions = el('div', 'np-actions');
    this.tapBtn = el('button', 'np-btn np-tap', '👆 Tap beat') as HTMLButtonElement;
    this.tapBtn.type = 'button';
    this.tapBtn.title = 'Tap along to sync the beat';
    this.tapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onTapBeat();
      this.wake();
    });
    const closeBtn = el('button', 'np-btn np-close', '✕') as HTMLButtonElement;
    closeBtn.type = 'button';
    closeBtn.title = 'Leave Spotify mode';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onDisconnect();
    });
    actions.append(this.tapBtn, closeBtn);

    this.root.append(this.art, text, actions);
    this.root.addEventListener('pointerdown', () => this.wake());
    parent.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add('visible');
    this.wake();
  }

  hide(): void {
    this.root.classList.remove('visible', 'dim');
  }

  setTrack(track: SpotifyTrack | null, tempo: TempoInfo | null): void {
    if (track) {
      this.title.textContent = track.name;
      this.artist.textContent = track.artists;
      if (track.artUrl) {
        this.art.src = track.artUrl;
        this.art.classList.add('has-art');
      } else {
        this.art.removeAttribute('src');
        this.art.classList.remove('has-art');
      }
    } else {
      this.title.textContent = 'Spotify';
      this.artist.textContent = 'Nothing playing';
      this.art.removeAttribute('src');
      this.art.classList.remove('has-art');
    }
    this.tapBtn.classList.toggle('synced', tempo?.source === 'tap' || tempo?.source === 'learned');
    this.wake();
  }

  setState(state: SpotifyModeState, detail: string): void {
    this.chip.textContent = `${STATE_ICON[state]} ${detail}`.trim();
    this.chip.dataset.state = state;
    this.root.classList.toggle('beatlock', state === 'beatlock');
    this.wake();
  }

  /** Fade to a subtle ghost after a few seconds so it never fights the visuals. */
  private wake(): void {
    this.root.classList.remove('dim');
    if (this.dimTimer) clearTimeout(this.dimTimer);
    this.dimTimer = setTimeout(() => this.root.classList.add('dim'), 6000);
  }
}
