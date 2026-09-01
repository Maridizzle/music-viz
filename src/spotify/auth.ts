import { SPOTIFY_SCOPES } from './config';

const AUTH_KEY = 'music-viz:spotify-auth';
const PKCE_KEY = 'music-viz:spotify-pkce';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Date.now() ms
  clientId: string;
}

interface PendingLogin {
  verifier: string;
  state: string;
  redirectUri: string;
  clientId: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export class SpotifyAuthError extends Error {
  /** True when the stored grant is dead (revoked / wrong client) and a fresh login is needed. */
  fatal = false;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, length);
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Spotify "Authorization Code with PKCE" — the flow for apps that can't keep a
 * secret (browsers, mobile, desktop). Tokens persist in localStorage so a login
 * survives reloads and, in the desktop app, the screensaver window being recreated.
 */
export class SpotifyAuth {
  constructor(
    private readonly clientId: () => string,
    private readonly redirectUri: () => string,
  ) {}

  isConnected(): boolean {
    return !!readJson<StoredAuth>(AUTH_KEY)?.refreshToken;
  }

  /** True for a URL Spotify redirected back to (has `state` plus `code` or `error`). */
  static isCallbackUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return u.searchParams.has('state') && (u.searchParams.has('code') || u.searchParams.has('error'));
    } catch {
      return false;
    }
  }

  /** Build the authorize URL and hand it to `open` (redirect / custom tab / system browser). */
  async beginLogin(open: (url: string) => void | Promise<void>): Promise<void> {
    const clientId = this.clientId().trim();
    if (!clientId) throw new SpotifyAuthError('No Spotify Client ID configured.');
    const verifier = randomString(64);
    const state = randomString(16);
    const redirectUri = this.redirectUri();
    const pending: PendingLogin = { verifier, state, redirectUri, clientId };
    writeJson(PKCE_KEY, pending);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: await codeChallenge(verifier),
      state,
    });
    await open(`${AUTHORIZE_URL}?${params.toString()}`);
  }

  /** Exchange the code in a callback URL for tokens. Throws SpotifyAuthError on any failure. */
  async completeLogin(url: string): Promise<void> {
    const pending = readJson<PendingLogin>(PKCE_KEY);
    writeJson(PKCE_KEY, null);
    const u = new URL(url);
    const error = u.searchParams.get('error');
    if (error) {
      throw new SpotifyAuthError(
        error === 'access_denied' ? 'Spotify login was cancelled.' : `Spotify login failed: ${error}`,
      );
    }
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (!pending || !code || state !== pending.state) {
      throw new SpotifyAuthError('Spotify login could not be verified — please try again.');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    });
    const tok = await this.tokenRequest(body);
    const stored: StoredAuth = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? '',
      expiresAt: Date.now() + tok.expires_in * 1000,
      clientId: pending.clientId,
    };
    writeJson(AUTH_KEY, stored);
  }

  /** A valid access token, refreshing when it is within a minute of expiry (or when forced). */
  async getAccessToken(force = false): Promise<string> {
    const auth = readJson<StoredAuth>(AUTH_KEY);
    if (!auth?.refreshToken) throw new SpotifyAuthError('Not connected to Spotify.');
    if (!force && auth.accessToken && Date.now() < auth.expiresAt - 60_000) return auth.accessToken;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: auth.clientId,
    });
    let tok: TokenResponse;
    try {
      tok = await this.tokenRequest(body);
    } catch (e) {
      if (e instanceof SpotifyAuthError && e.fatal) this.logout();
      throw e;
    }
    const next: StoredAuth = {
      ...auth,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token || auth.refreshToken,
      expiresAt: Date.now() + tok.expires_in * 1000,
    };
    writeJson(AUTH_KEY, next);
    return next.accessToken;
  }

  logout(): void {
    writeJson(AUTH_KEY, null);
    writeJson(PKCE_KEY, null);
  }

  private async tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new SpotifyAuthError('Could not reach Spotify (network).');
    }
    if (!res.ok) {
      let message = `Spotify auth error (${res.status})`;
      try {
        const j = (await res.json()) as { error?: string; error_description?: string };
        if (j.error_description) message = j.error_description;
        else if (j.error) message = j.error;
      } catch {
        /* no body */
      }
      const err = new SpotifyAuthError(message);
      err.fatal = res.status === 400 || res.status === 401;
      throw err;
    }
    return (await res.json()) as TokenResponse;
  }
}
