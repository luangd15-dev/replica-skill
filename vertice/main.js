const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const PROJECT_FILTER = [{ name: 'Projeto Vértice', extensions: ['vtx'] }];

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Vértice',
    backgroundColor: '#eef0f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenu(null);
  win.maximize();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

ipcMain.handle('file:open', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { filters: PROJECT_FILTER, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, content: fs.readFileSync(p, 'utf8') };
});

ipcMain.handle('file:save', async (e, { content, filePath }) => {
  let p = filePath;
  if (!p) {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(win, { filters: PROJECT_FILTER, defaultPath: 'projeto.vtx' });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
  }
  fs.writeFileSync(p, content, 'utf8');
  return p;
});

ipcMain.handle('file:export', async (e, { content, defaultName, ext, label }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: label, extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;
  // BOM so Excel opens accented CSV correctly
  fs.writeFileSync(r.filePath, ext === 'csv' ? '﻿' + content : content, 'utf8');
  return r.filePath;
});

ipcMain.on('win:title', (e, title) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setTitle(title);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
