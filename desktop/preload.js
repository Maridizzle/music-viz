// Marks the page as running inside the desktop shell (the web app checks
// `window.mvDesktop`, see src/spotify/platform.ts) and exposes the two things the
// Spotify login needs from the main process: opening the login page in the user's
// browser, and receiving the musicviz://spotify?code=… callback it comes back with.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mvDesktop', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onSpotifyCallback: (cb) => {
    ipcRenderer.on('spotify-callback', (_event, url) => cb(url));
  },
});
