// Leitura e gravação de DXF.
// Leitura: LINE, LWPOLYLINE (com bulge), POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE, SPLINE (aprox.),
// TEXT, MTEXT, INSERT (blocos explodidos, recursivo) e DIMENSION (bloco anônimo).
// Gravação: AutoCAD 2000 (AC1015), montada sobre um modelo gerado pelo LibreDWG, para que o
// conversor dxf2dwg aceite o arquivo e gere DWG.

const TO_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

export function pares(texto) {
  const L = texto.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < L.length; i += 2) out.push([parseInt(L[i], 10), L[i + 1]]);
  return out;
}

const decodificar = (s) =>
  s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%');

const limparMtext = (s) =>
  decodificar(s)
    .replace(/\\P/g, ' ')
    .replace(/\\[ACcFfHhLlOoQqTtWwKkSs][^;\\{}]*;?/g, '')
    .replace(/[{}]/g, '')
    .trim();

// lista de entidades: cada uma é { tipo, g: [[code, value], ...] }
function entidades(ps, i, fim) {
  const out = [];
  while (i < ps.length) {
    const [c, v] = ps[i];
    if (c === 0 && fim.includes(v)) break;
    if (c === 0) {
      const e = { tipo: v, g: [] };
      i++;
      while (i < ps.length && ps[i][0] !== 0) e.g.push(ps[i++]);
      out.push(e);
    } else i++;
  }
  return { lista: out, i };
}

const get = (e, c, d) => {
  const p = e.g.find((x) => x[0] === c);
  return p ? p[1] : d;
};
const num = (e, c, d = 0) => {
  const v = get(e, c);
  return v == null ? d : parseFloat(v);
};

function arcoPontos(cx, cy, r, a0, a1) {
  // ângulos em radianos, sentido anti-horário
  while (a1 <= a0) a1 += Math.PI * 2;
  const n = Math.max(4, Math.ceil(((a1 - a0) / (Math.PI / 2)) * 8));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function bulgeSeg(p1, p2, bulge) {
  if (!bulge) return [p1, p2];
  const theta = 4 * Math.atan(bulge);
  const [x1, y1] = p1, [x2, y2] = p2;
  const c = Math.hypot(x2 - x1, y2 - y1);
  const r = c / (2 * Math.sin(theta / 2));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const h = r * Math.cos(theta / 2);
  const nx = -(y2 - y1) / c, ny = (x2 - x1) / c;
  const cx = mx + nx * h, cy = my + ny * h;
  const a0 = Math.atan2(y1 - cy, x1 - cx), a1 = Math.atan2(y2 - cy, x2 - cx);
  const pts = bulge > 0 ? arcoPontos(cx, cy, Math.abs(r), a0, a1) : arcoPontos(cx, cy, Math.abs(r), a1, a0).reverse();
  pts[0] = p1;
  pts[pts.length - 1] = p2;
  return pts;
}

export function lerDxf(texto) {
  const ps = pares(texto);
  const camadas = new Map();
  const blocos = new Map();
  let insunits = 0;
  let ents = [];
  for (let i = 0; i < ps.length; i++) {
    if (ps[i][0] === 9 && ps[i][1].trim() === '$INSUNITS') insunits = parseInt(ps[i + 1][1], 10) || 0;
    if (ps[i][0] === 0 && ps[i][1] === 'LAYER' && ps[i - 1]?.[1] !== 'TABLE' && !(ps[i - 1]?.[0] === 2)) {
      let nome = '0', cor = 7;
      for (let k = i + 1; k < ps.length && ps[k][0] !== 0; k++) {
        if (ps[k][0] === 2) nome = decodificar(ps[k][1].trim());
        if (ps[k][0] === 62) cor = parseInt(ps[k][1], 10);
      }
      camadas.set(nome, { nome, cor: Math.abs(cor) || 7, desligada: cor < 0 });
    }
    if (ps[i][0] === 2 && ps[i][1] === 'BLOCKS' && ps[i - 1]?.[1] === 'SECTION') {
      let k = i + 1;
      while (k < ps.length && !(ps[k][0] === 0 && ps[k][1] === 'ENDSEC')) {
        if (ps[k][0] === 0 && ps[k][1] === 'BLOCK') {
          const cab = { g: [] };
          k++;
          while (k < ps.length && ps[k][0] !== 0) cab.g.push(ps[k++]);
          const r = entidades(ps, k, ['ENDBLK']);
          blocos.set(get(cab, 2, '').trim(), { bx: num(cab, 10), by: num(cab, 20), lista: r.lista });
          k = r.i;
        }
        k++;
      }
    }
    if (ps[i][0] === 2 && ps[i][1] === 'ENTITIES' && ps[i - 1]?.[1] === 'SECTION') {
      ents = entidades(ps, i + 1, ['ENDSEC']).lista;
    }
  }

  const segs = [], circs = [], textos = [];
  const addPoli = (pts, layer) => { for (let k = 0; k + 1 < pts.length; k++) segs.push([layer, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]]); };

  function processa(lista, T, layerPai, prof) {
    for (let idx = 0; idx < lista.length; idx++) {
      const e = lista[idx];
      let layer = decodificar((get(e, 8, '0') || '0').trim());
      if (layer === '0' && layerPai) layer = layerPai;
      if (!camadas.has(layer)) camadas.set(layer, { nome: layer, cor: 7, desligada: false });
      const P = (x, y) => T(x, y);
      switch (e.tipo) {
        case 'LINE': addPoli([P(num(e, 10), num(e, 20)), P(num(e, 11), num(e, 21))], layer); break;
        case 'LWPOLYLINE': {
          const vs = [];
          let cur = null;
          for (const [c, v] of e.g) {
            if (c === 10) { cur = { x: parseFloat(v), y: 0, b: 0 }; vs.push(cur); }
            else if (c === 20 && cur) cur.y = parseFloat(v);
            else if (c === 42 && cur) cur.b = parseFloat(v);
          }
          const fechado = (parseInt(get(e, 70, '0'), 10) & 1) === 1;
          const n = vs.length;
          for (let k = 0; k < (fechado ? n : n - 1); k++) {
            const a = vs[k], b = vs[(k + 1) % n];
            addPoli(bulgeSeg([a.x, a.y], [b.x, b.y], a.b).map(([x, y]) => P(x, y)), layer);
          }
          break;
        }
        case 'POLYLINE': {
          const fechado = (parseInt(get(e, 70, '0'), 10) & 1) === 1;
          const vs = [];
          while (lista[idx + 1] && lista[idx + 1].tipo === 'VERTEX') {
            const v = lista[++idx];
            vs.push({ x: num(v, 10), y: num(v, 20), b: num(v, 42) });
          }
          if (lista[idx + 1]?.tipo === 'SEQEND') idx++;
          const n = vs.length;
          for (let k = 0; k < (fechado ? n : n - 1); k++) {
            const a = vs[k], b = vs[(k + 1) % n];
            addPoli(bulgeSeg([a.x, a.y], [b.x, b.y], a.b).map(([x, y]) => P(x, y)), layer);
          }
          break;
        }
        case 'CIRCLE': {
          const c = P(num(e, 10), num(e, 20));
          const borda = P(num(e, 10) + num(e, 40), num(e, 20));
          circs.push([layer, c[0], c[1], Math.hypot(borda[0] - c[0], borda[1] - c[1])]);
          break;
        }
        case 'ARC': {
          const pts = arcoPontos(num(e, 10), num(e, 20), num(e, 40), (num(e, 50) * Math.PI) / 180, (num(e, 51) * Math.PI) / 180);
          addPoli(pts.map(([x, y]) => P(x, y)), layer);
          break;
        }
        case 'ELLIPSE': {
          const cx = num(e, 10), cy = num(e, 20), mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 1);
          let t0 = num(e, 41, 0), t1 = num(e, 42, Math.PI * 2);
          if (t1 <= t0) t1 += Math.PI * 2;
          const pts = [];
          for (let k = 0; k <= 48; k++) {
            const t = t0 + ((t1 - t0) * k) / 48;
            pts.push(P(cx + mx * Math.cos(t) - my * ratio * Math.sin(t), cy + my * Math.cos(t) + mx * ratio * Math.sin(t)));
          }
          addPoli(pts, layer);
          break;
        }
        case 'SPLINE': {
          const pts = [];
          const fit = e.g.some(([c]) => c === 11);
          let cur = null;
          for (const [c, v] of e.g) {
            if (c === (fit ? 11 : 10)) { cur = [parseFloat(v), 0]; pts.push(cur); }
            else if (c === (fit ? 21 : 20) && cur) cur[1] = parseFloat(v);
          }
          addPoli(pts.map(([x, y]) => P(x, y)), layer);
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const t = e.tipo === 'MTEXT'
            ? limparMtext(e.g.filter(([c]) => c === 3 || c === 1).map(([, v]) => v).join(''))
            : decodificar(get(e, 1, ''));
          if (!t) break;
          const p = P(num(e, e.tipo === 'TEXT' && e.g.some(([c]) => c === 11) && parseInt(get(e, 72, '0'), 10) ? 11 : 10), num(e, e.tipo === 'TEXT' && e.g.some(([c]) => c === 21) && parseInt(get(e, 72, '0'), 10) ? 21 : 20));
          const q = P(num(e, 10), num(e, 20) + num(e, 40, 0.25));
          const q0 = P(num(e, 10), num(e, 20));
          textos.push({ l: layer, x: p[0], y: p[1], h: Math.hypot(q[0] - q0[0], q[1] - q0[1]), t, r: num(e, 50, 0) });
          break;
        }
        case 'INSERT':
        case 'DIMENSION': {
          if (prof > 8) break;
          const nome = (get(e, 2, '') || '').trim();
          const b = blocos.get(nome);
          if (!b) break;
          const ix = e.tipo === 'INSERT' ? num(e, 10) : 0, iy = e.tipo === 'INSERT' ? num(e, 20) : 0;
          const sx = e.tipo === 'INSERT' ? num(e, 41, 1) : 1, sy = e.tipo === 'INSERT' ? num(e, 42, 1) : 1;
          const rot = e.tipo === 'INSERT' ? (num(e, 50, 0) * Math.PI) / 180 : 0;
          const cs = Math.cos(rot), sn = Math.sin(rot);
          const T2 = (x, y) => {
            const lx = (x - b.bx) * sx, ly = (y - b.by) * sy;
            return T(ix + lx * cs - ly * sn, iy + lx * sn + ly * cs);
          };
          processa(b.lista, T2, layer, prof + 1);
          break;
        }
        default:
      }
    }
  }
  processa(ents, (x, y) => [x, y], null, 0);

  // extensão e unidade
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  for (const s of segs) { ext(s[1], s[2]); ext(s[3], s[4]); }
  for (const c of circs) { ext(c[1] - c[3], c[2] - c[3]); ext(c[1] + c[3], c[2] + c[3]); }
  for (const t of textos) ext(t.x, t.y);
  const larg = Math.max(maxX - minX, maxY - minY);
  let fator = TO_M[insunits];
  let unidadeAdivinhada = false;
  if (!fator) {
    unidadeAdivinhada = true;
    fator = larg > 2000 ? 0.001 : larg > 300 ? 0.01 : 1;
  }
  const usadas = new Set([...segs.map((s) => s[0]), ...circs.map((c) => c[0]), ...textos.map((t) => t.l)]);
  return {
    camadas: [...camadas.values()].filter((c) => usadas.has(c.nome)),
    segs, circs, textos, insunits, fator, unidadeAdivinhada,
    ext: { minX, minY, maxX, maxY },
  };
}

// Converte o resultado da leitura em "fundo" de pavimento (metros, Y para baixo, origem no canto).
export function paraFundo(dados, nomeArquivo, fator = dados.fator) {
  const { minX, maxY } = dados.ext;
  const idx = new Map(dados.camadas.map((c, i) => [c.nome, i]));
  const r = (v) => Math.round(v * 1000) / 1000;
  const X = (x) => r((x - minX) * fator), Y = (y) => r((maxY - y) * fator);
  const s = [];
  for (const [l, x1, y1, x2, y2] of dados.segs) {
    if (!idx.has(l)) continue;
    s.push(idx.get(l), X(x1), Y(y1), X(x2), Y(y2));
  }
  const c = [];
  for (const [l, x, y, rr] of dados.circs) if (idx.has(l)) c.push(idx.get(l), X(x), Y(y), r(rr * fator));
  const t = dados.textos.filter((tx) => idx.has(tx.l)).map((tx) => ({ l: idx.get(tx.l), x: X(tx.x), y: Y(tx.y), h: r(tx.h * fator), t: tx.t, r: tx.r }));
  return {
    arquivo: nomeArquivo,
    camadas: dados.camadas.map((cm) => ({ nome: cm.nome, cor: cm.cor, vis: !cm.desligada })),
    s, c, t,
  };
}

// ---------------------------------------------------------------- gravação

const codificar = (s) => String(s).replace(/[^\x20-\x7e]/g, (ch) => `\\U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
const n = (v) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1e6) / 1e6));

// camadas: [{ nome, cor }]
// ents: [{ t: 'line'|'poly'|'circle'|'text', l: camada, ... }]  (coordenadas DXF: Y para cima)
export function gravarDxf(modelo, camadas, ents) {
  const ps = pares(modelo.replace(/\r/g, ''));
  const find = (pred, from = 0) => { for (let i = from; i < ps.length; i++) if (pred(ps[i], i)) return i; return -1; };

  const iSeed = find(([c, v]) => c === 9 && v.trim() === '$HANDSEED');
  // o próximo handle livre: maior handle do modelo + 1 (o $HANDSEED do modelo nem sempre é confiável)
  let seed = parseInt(ps[iSeed + 1][1], 16) || 1;
  for (const [c, v] of ps) if (c === 5 || c === 105 || (c >= 320 && c <= 369) || c === 390) seed = Math.max(seed, parseInt(v, 16) + 1 || 0);
  const handle = () => (seed++).toString(16).toUpperCase();

  const iUnits = find(([c, v]) => c === 9 && v.trim() === '$INSUNITS');
  if (iUnits >= 0) ps[iUnits + 1] = [70, '     6'];

  // tabela de camadas
  const iLayerTab = find(([c, v], i) => c === 2 && v === 'LAYER' && ps[i - 1][0] === 0 && ps[i - 1][1] === 'TABLE');
  const hLayerTab = ps[find(([c]) => c === 5, iLayerTab)][1];
  const iCount = find(([c]) => c === 70, iLayerTab);
  const iEndTab = find(([c, v]) => c === 0 && v === 'ENDTAB', iLayerTab);
  const existentes = new Set();
  for (let i = iLayerTab; i < iEndTab; i++) if (ps[i][0] === 2 && ps[i - 1]?.[0] !== 0) existentes.add(ps[i][1]);
  // o dxf2dwg do LibreDWG 0.13 descarta a 1ª camada nova da tabela; "Defpoints" (camada padrão
  // do AutoCAD, não imprime) vai na frente para absorver isso
  const novas = [{ nome: 'Defpoints', cor: 7 }, ...camadas].filter((c, i, a) => !existentes.has(c.nome) && a.findIndex((o) => o.nome === c.nome) === i);
  const regs = [];
  for (const c of novas) {
    regs.push([0, 'LAYER'], [5, handle()], [330, hLayerTab], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbLayerTableRecord'],
      [2, codificar(c.nome)], [70, '     0'], [62, String(c.cor ?? 7).padStart(6)], [6, 'CONTINUOUS'], [370, '    -3'], [390, 'F']);
  }
  ps.splice(iEndTab, 0, ...regs);
  ps[iCount] = [70, String(existentes.size + novas.length).padStart(6)];

  // espaço do modelo
  const iMs = find(([c, v]) => c === 2 && v.toUpperCase() === '*MODEL_SPACE');
  let hMs = '1F';
  for (let i = iMs; i > 0; i--) if (ps[i][0] === 5) { hMs = ps[i][1]; break; }

  const iEnt = find(([c, v], i) => c === 2 && v === 'ENTITIES' && ps[i - 1][1] === 'SECTION');
  const iEndSec = find(([c, v]) => c === 0 && v === 'ENDSEC', iEnt);
  const out = [];
  const cab = (tipo, l, sub) => out.push([0, tipo], [5, handle()], [330, hMs], [100, 'AcDbEntity'], [8, codificar(l)], [100, sub]);
  for (const e of ents) {
    if (e.t === 'line') {
      cab('LINE', e.l, 'AcDbLine');
      out.push([10, n(e.x1)], [20, n(e.y1)], [30, '0'], [11, n(e.x2)], [21, n(e.y2)], [31, '0']);
    } else if (e.t === 'poly') {
      cab('LWPOLYLINE', e.l, 'AcDbPolyline');
      out.push([90, String(e.pts.length).padStart(9)], [70, e.fechado ? '     1' : '     0'], [43, '0']);
      for (const [x, y] of e.pts) out.push([10, n(x)], [20, n(y)]);
    } else if (e.t === 'circle') {
      cab('CIRCLE', e.l, 'AcDbCircle');
      out.push([10, n(e.x)], [20, n(e.y)], [30, '0'], [40, n(e.r)]);
    } else if (e.t === 'text') {
      cab('TEXT', e.l, 'AcDbText');
      out.push([10, n(e.x)], [20, n(e.y)], [30, '0'], [40, n(e.h)], [1, codificar(e.texto)]);
      if (e.rot) out.push([50, n(e.rot)]);
      out.push([100, 'AcDbText']);
    }
  }
  ps.splice(iEnt + 1, iEndSec - iEnt - 1, ...out);
  const iSeed2 = find(([c, v]) => c === 9 && v.trim() === '$HANDSEED');
  ps[iSeed2 + 1] = [5, seed.toString(16).toUpperCase()];
  return ps.map(([c, v]) => `${String(c).padStart(3)}\r\n${v}`).join('\r\n') + '\r\n';
}

// cores ACI aproximadas, escurecidas para leitura em fundo claro
export function corAci(i) {
  const base = { 1: '#d0453a', 2: '#b8960c', 3: '#2e9d4f', 4: '#1593a6', 5: '#1d6fd6', 6: '#b0306b', 7: '#3b4652', 8: '#808890', 9: '#a6adb4' };
  if (base[i]) return base[i];
  if (i >= 10 && i <= 249) {
    const h = ((Math.floor(i / 10) - 1) * 15) % 360;
    const l = [42, 55, 34, 48, 28, 40, 22, 33, 18, 26][i % 10];
    return `hsl(${h} 60% ${l}%)`;
  }
  if (i >= 250) return `hsl(0 0% ${30 + (i - 250) * 10}%)`;
  return '#3b4652';
}
