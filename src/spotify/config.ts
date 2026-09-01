/**
 * Baked-in Spotify app Client ID. It is public by design — the PKCE flow needs no
 * secret — but the app it belongs to must list this deployment's redirect URIs
 * (see README → Spotify mode). Users can override it in ⚙️ → Spotify → Client ID.
 */
export const DEFAULT_SPOTIFY_CLIENT_ID = '';

export const SPOTIFY_SCOPES = ['user-read-currently-playing', 'user-read-playback-state'];

/** Custom URI scheme the native shells (Android app, Windows desktop) register for the OAuth callback. */
export const NATIVE_REDIRECT_URI = 'musicviz://spotify';
