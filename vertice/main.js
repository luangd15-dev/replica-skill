const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

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
    // barra de título desenhada pelo app (atalhos + nome do projeto); minimizar/maximizar/fechar são do sistema
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f1f2f4', symbolColor: '#333333', height: 32 },
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

// arquivos binários (planilhas XLSX)
ipcMain.handle('file:exportBin', async (e, { bytes, defaultName, ext, label }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return r.filePath;
});

// ---------------------------------------------------------------- DWG / DXF
// Conversão DWG <-> DXF pelo LibreDWG (GPL-3.0), executado como programa separado.
function libredwgDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'libredwg') : path.join(__dirname, 'vendor', 'libredwg');
}

function converter(exe, args) {
  const bin = path.join(libredwgDir(), exe);
  if (!fs.existsSync(bin)) return Promise.reject(new Error(`Conversor não encontrado: ${bin}`));
  // fora do Windows (desenvolvimento/testes) usa o Wine
  const [cmd, argv] = process.platform === 'win32' ? [bin, args] : ['wine', [bin, ...args]];
  return new Promise((resolve, reject) => {
    execFile(cmd, argv, { cwd: libredwgDir(), timeout: 180000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, WINEDEBUG: '-all' } }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).split(/\r?\n/).filter((l) => /ERROR/i.test(l)).slice(0, 3).join(' ') || err.message));
      resolve(stderr);
    });
  });
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vertice-'));

ipcMain.handle('cad:import', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Desenhos CAD', extensions: ['dwg', 'dxf'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  try {
    let dxfPath = p;
    if (/\.dwg$/i.test(p)) {
      const dir = tmpDir();
      dxfPath = path.join(dir, 'importado.dxf');
      await converter('dwg2dxf.exe', ['-y', '-o', dxfPath, p]);
      if (!fs.existsSync(dxfPath)) throw new Error('O conversor não gerou a DXF.');
    }
    // latin1 preserva os bytes; acentos chegam como \U+XXXX ou na página de código do arquivo
    return { nome: path.basename(p), content: fs.readFileSync(dxfPath, 'latin1') };
  } catch (err) {
    return { erro: err.message };
  }
});

ipcMain.handle('cad:export', async (e, { content, nome }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    defaultPath: nome,
    filters: [{ name: 'Desenho DWG (AutoCAD 2000)', extensions: ['dwg'] }, { name: 'Desenho DXF (AutoCAD 2000)', extensions: ['dxf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  try {
    if (/\.dwg$/i.test(r.filePath)) {
      const dir = tmpDir();
      const tmp = path.join(dir, 'exportado.dxf');
      fs.writeFileSync(tmp, content, 'latin1');
      await converter('dxf2dwg.exe', ['-y', '--as', 'r2000', '-o', r.filePath, tmp]);
      if (!fs.existsSync(r.filePath)) throw new Error('O conversor não gerou o DWG.');
    } else {
      fs.writeFileSync(r.filePath, content, 'latin1');
    }
    return { path: r.filePath };
  } catch (err) {
    return { erro: err.message };
  }
});

// relatórios em PDF: renderiza o HTML numa janela oculta e imprime em A4
ipcMain.handle('pdf:salvar', async (e, { html, nome }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, { defaultPath: nome, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  const off = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    const tmp = path.join(tmpDir(), 'relatorio.html');
    fs.writeFileSync(tmp, html, 'utf8');
    await off.loadFile(tmp);
    const largo = /<svg[^>]+width="(\d+)"/.exec(html);
    // pranchas: tamanho da folha definido no CSS (@page), sem margens
    const prancha = /@page p?A\d/.test(html);
    const pdf = await off.webContents.printToPDF(prancha
      ? { preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } }
      : { pageSize: 'A4', landscape: !!(largo && Number(largo[1]) > 800) || /Quadro de cargas/.test(html), printBackground: true, margins: { marginType: 'default' } });
    fs.writeFileSync(r.filePath, pdf);
    return { path: r.filePath };
  } catch (err) {
    return { erro: err.message };
  } finally {
    off.destroy();
  }
});

ipcMain.on('win:title', (e, title) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setTitle(title);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
