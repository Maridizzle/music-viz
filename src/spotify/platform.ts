import { Capacitor } from '@capacitor/core';
import { NATIVE_REDIRECT_URI } from './config';

/** Bridge exposed by the Electron preload (desktop/preload.js). Truthy on desktop. */
export interface DesktopBridge {
  openExternal?: (url: string) => Promise<void>;
  onSpotifyCallback?: (cb: (url: string) => void) => void;
}

export type PlatformKind = 'web' | 'android' | 'desktop';

export function desktopBridge(): DesktopBridge | null {
  const b = (window as unknown as { mvDesktop?: DesktopBridge | boolean }).mvDesktop;
  if (!b) return null;
  return typeof b === 'object' ? b : {};
}

export function platformKind(): PlatformKind {
  if (Capacitor.isNativePlatform()) return 'android';
  if (desktopBridge()) return 'desktop';
  return 'web';
}

/** True inside the native Android app (Capacitor). */
export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * The OAuth redirect URI for this deployment. It must be registered verbatim in
 * the Spotify app's settings:
 *  - web:     the page URL itself (e.g. https://maridizzle.github.io/music-viz/)
 *  - Android / desktop: musicviz://spotify (custom scheme handled by the shell)
 */
export function getRedirectUri(): string {
  if (platformKind() !== 'web') return NATIVE_REDIRECT_URI;
  const path = location.pathname.replace(/index\.html$/, '');
  return `${location.origin}${path.endsWith('/') ? path : `${path}/`}`;
}

/** Send the user to Spotify's login page in the way that works on this platform. */
export async function openAuth(url: string): Promise<void> {
  const kind = platformKind();
  if (kind === 'android') {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, presentationStyle: 'popover' });
    return;
  }
  if (kind === 'desktop') {
    const bridge = desktopBridge();
    if (bridge?.openExternal) {
      await bridge.openExternal(url);
      return;
    }
  }
  location.assign(url);
}

/** Subscribe to the native shells' callback delivery (musicviz://spotify?code=…). No-op on the web. */
export async function onAppUrl(cb: (url: string) => void): Promise<void> {
  const kind = platformKind();
  if (kind === 'android') {
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', ({ url }) => {
      if (!url.startsWith(NATIVE_REDIRECT_URI)) return;
      void import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => undefined));
      cb(url);
    });
    return;
  }
  if (kind === 'desktop') desktopBridge()?.onSpotifyCallback?.(cb);
}
