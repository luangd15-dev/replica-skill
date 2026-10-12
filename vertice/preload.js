const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  openProject: () => ipcRenderer.invoke('file:open'),
  saveProject: (content, filePath) => ipcRenderer.invoke('file:save', { content, filePath }),
  exportFile: (content, defaultName, ext, label) =>
    ipcRenderer.invoke('file:export', { content, defaultName, ext, label }),
  setTitle: (title) => ipcRenderer.send('win:title', title),
});
