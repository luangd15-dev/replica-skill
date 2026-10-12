// Baixa os conversores DWG <-> DXF do LibreDWG (GNU, GPL-3.0) para vendor/libredwg.
// Eles rodam como programas separados, chamados pelo Vértice para abrir e salvar DWG.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const VERSAO = '0.13.3';
const URL_ZIP = `https://github.com/LibreDWG/libredwg/releases/download/${VERSAO}/libredwg-${VERSAO}-win64.zip`;
const SHA256 = 'b5133f8b6bd71b7e682a06ef5f99c93b40d628a791c30a31924a80d258c87173';
const ARQUIVOS = ['dwg2dxf.exe', 'dxf2dwg.exe', 'libredwg-0.dll', 'libiconv-2.dll', 'libpcre2-8-0.dll'];

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destino = path.join(raiz, 'vendor', 'libredwg');
if (ARQUIVOS.every((f) => fs.existsSync(path.join(destino, f)))) {
  console.log('LibreDWG já está em', destino);
  process.exit(0);
}
fs.mkdirSync(destino, { recursive: true });
const zip = path.join(destino, 'libredwg.zip');
console.log('Baixando', URL_ZIP);
const r = await fetch(URL_ZIP);
if (!r.ok) throw new Error(`download falhou: HTTP ${r.status}`);
const buf = Buffer.from(await r.arrayBuffer());
const hash = crypto.createHash('sha256').update(buf).digest('hex');
if (hash !== SHA256) throw new Error(`hash inesperado: ${hash}`);
fs.writeFileSync(zip, buf);
const tmp = path.join(destino, 'tmp');
fs.mkdirSync(tmp, { recursive: true });
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zip}' '${tmp}'`]);
} else {
  execFileSync('unzip', ['-q', '-o', zip, '-d', tmp]);
}
for (const f of ARQUIVOS) fs.copyFileSync(path.join(tmp, f), path.join(destino, f));
fs.copyFileSync(path.join(tmp, 'README.txt'), path.join(destino, 'README-LibreDWG.txt'));
fs.copyFileSync(path.join(raiz, 'licencas', 'GPL-3.0.txt'), path.join(destino, 'COPYING.txt'));
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(zip);
console.log('LibreDWG', VERSAO, 'pronto em', destino);
