const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibe', {
  init: () => ipcRenderer.invoke('init'),
  client: () => ipcRenderer.invoke('client'),
  status: (id) => ipcRenderer.invoke('status', id),
  news: () => ipcRenderer.invoke('news'),
  themes: () => ipcRenderer.invoke('themes'),
  install: () => ipcRenderer.invoke('install'),
  cancel: () => ipcRenderer.send('cancel'),
  play: (id) => ipcRenderer.invoke('play', id),
  setSetting: (k, v) => ipcRenderer.invoke('setSetting', k, v),
  pickClientDir: () => ipcRenderer.invoke('pickClientDir'),
  openFolder: (what) => ipcRenderer.send('openFolder', what),
  win: (what) => ipcRenderer.send('win', what),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, d) => fn(d)),
});
