export interface SourceHandlers {
  onMic: () => void;
  onDisplay: () => void;
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
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

/** The four audio-source controls (mic / system audio / file / URL). Reused in the start overlay. */
export class SourcePicker {
  readonly root: HTMLElement;
  private buttons: HTMLButtonElement[] = [];

  constructor(handlers: SourceHandlers, opts: { showDisplay: boolean }) {
    this.root = el('div', 'source-grid');

    this.root.appendChild(
      this.makeButton('🎤', 'Microphone', 'React to sound in the room', handlers.onMic),
    );

    if (opts.showDisplay) {
      this.root.appendChild(
        this.makeButton('🖥️', 'Tab / system audio', 'Capture a Spotify or YouTube tab', handlers.onDisplay),
      );
    }

    // File
    const fileInput = el('input') as HTMLInputElement;
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) handlers.onFile(file);
      fileInput.value = '';
    });
    const fileBtn = this.makeButton('📁', 'Audio file', 'Play a track from your device', () =>
      fileInput.click(),
    );
    fileBtn.appendChild(fileInput);
    this.root.appendChild(fileBtn);

    // URL
    const urlBtn = this.makeButton('🔗', 'Stream URL', 'An internet-radio / direct audio link', () => {
      urlRow.classList.toggle('open');
      if (urlRow.classList.contains('open')) urlField.focus();
    });
    this.root.appendChild(urlBtn);

    const urlRow = el('div', 'url-row');
    const urlField = el('input', 'url-input') as HTMLInputElement;
    urlField.type = 'url';
    urlField.placeholder = 'https://stream.example.com/radio.mp3';
    urlField.inputMode = 'url';
    const urlGo = el('button', 'url-go', 'Play') as HTMLButtonElement;
    const submit = (): void => {
      const url = urlField.value.trim();
      if (url) handlers.onUrl(url);
    };
    urlGo.addEventListener('click', submit);
    urlField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    urlRow.append(urlField, urlGo);
    this.root.appendChild(urlRow);
  }

  setBusy(busy: boolean): void {
    for (const b of this.buttons) b.disabled = busy;
    this.root.classList.toggle('busy', busy);
  }

  private makeButton(icon: string, title: string, sub: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'source-btn') as HTMLButtonElement;
    btn.type = 'button';
    btn.append(
      el('span', 'source-icon', icon),
      el('span', 'source-title', title),
      el('span', 'source-sub', sub),
    );
    btn.addEventListener('click', onClick);
    this.buttons.push(btn);
    return btn;
  }
}
