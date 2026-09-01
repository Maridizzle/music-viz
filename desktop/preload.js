// Marks the page as running inside the desktop shell so the web app switches to
// screensaver mode (see src/main.ts).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('mvDesktop', true);
