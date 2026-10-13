// Documentos do projeto elétrico em SVG/tabelas: quadro executivo (trilhos DIN), diagrama multifilar,
// unifilar geral (quadros subordinados), quadro de demanda e legenda de fiação.
import { fmtSec, nomeQuadro, fdIlumTug, fdTue } from './eletrico.js';
import { TIPOS } from './tipos.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = (v) => Math.round(v).toLocaleString('pt-BR');
const n1 = (v, d = 1) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function desenho() {
  const out = [];
  const t = (x, y, s, o = {}) => out.push(`<text x="${x}" y="${y}" font-size="${o.size || 11}" ${o.anchor ? `text-anchor="${o.anchor}"` : ''} ${o.bold ? 'font-weight="700"' : ''} fill="${o.cor || '#1f2933'}"${o.rot ? ` transform="rotate(${o.rot} ${x} ${y})"` : ''}>${esc(s)}</text>`);
  const l = (x1, y1, x2, y2, o = {}) => out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.cor || '#1f2933'}" stroke-width="${o.w || 1.2}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`);
  const r = (x, y, w, h, o = {}) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 2}" fill="${o.fill || 'none'}" stroke="${o.cor || '#1f2933'}" stroke-width="${o.w || 1.2}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`);
  const svg = (W, H) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMinYMin meet" font-family="Segoe UI, Arial, sans-serif" style="background:#fff;max-width:100%;height:auto">${out.join('')}</svg>`;
  return { out, t, l, r, svg };
}

const ordenados = (rq) => rq.circuitos.slice().sort((a, b) => a.circuito.numero - b.circuito.numero);

// ---------------------------------------------------------------- quadro executivo
// Vista frontal do quadro com os dispositivos nos trilhos DIN (1 módulo = 18 mm).
export function componentesQuadro(rq) {
  const comps = [];
  const nF = rq.fasesQ.length;
  if (rq.disjuntorGeral) comps.push({ tipo: 'geral', mod: nF, rot: `${nF}P ${rq.disjuntorGeral} A`, nome: 'Geral' });
  if (rq.dps) comps.push({ tipo: 'dps', mod: nF + 1, rot: 'DPS', nome: 'DPS classe II' });
  const circs = ordenados(rq);
  const usados = new Set();
  rq.drGrupos.forEach((g, i) => {
    comps.push({ tipo: 'dr', mod: g.polos, rot: `DR${i + 1} ${g.nominal} A`, nome: `IDR ${g.polos}P ${g.nominal} A 30 mA` });
    for (const id of g.circuitos) {
      const r = circs.find((x) => x.circuito.id === id);
      if (!r) continue;
      usados.add(r);
      comps.push({ tipo: 'disj', mod: r.polos, rot: `${r.circuito.numero}`, sub: `${r.disjuntor ?? '-'} A`, nome: `${r.circuito.numero} - ${r.circuito.nome.replace(/^C\d+\s*/, '')}`, dr: i + 1 });
    }
  });
  for (const r of circs) {
    if (usados.has(r)) continue;
    comps.push(r.reserva
      ? { tipo: 'reserva', mod: 1, rot: `${r.circuito.numero}`, sub: 'res.', nome: `${r.circuito.numero} - Reserva` }
      : { tipo: 'disj', mod: r.polos, rot: `${r.circuito.numero}`, sub: `${r.disjuntor ?? '-'} A`, nome: `${r.circuito.numero} - ${r.circuito.nome.replace(/^C\d+\s*/, '')}` });
  }
  return comps;
}

export function svgQuadroExecutivo(projeto, rq) {
  const comps = componentesQuadro(rq);
  const total = rq.tamanho;
  const trilhos = total <= 18 ? 1 : total <= 36 ? 2 : total <= 54 ? 3 : 4;
  const porTrilho = Math.ceil(total / trilhos);
  const M = 26; // px por módulo
  const x0 = 40, y0 = 70, hT = 92;
  const larg = x0 * 2 + porTrilho * M;
  const altTrilhos = trilhos * hT;
  const listaH = comps.length * 15 + 30;
  const W = Math.max(larg + 300, 640), H = Math.max(y0 + altTrilhos + 60, y0 + listaH);
  const d = desenho();
  d.t(20, 26, `Quadro executivo — ${nomeQuadro(rq.quadro, projeto)}`, { size: 15, bold: true });
  d.t(20, 44, `${rq.tamanho} módulos DIN · ${trilhos} trilho(s) de ${porTrilho} · ${rq.modulos} módulos ocupados · ${rq.esquema}`, { size: 11, cor: '#5f6b77' });
  // caixa
  d.r(x0 - 18, y0 - 14, porTrilho * M + 36, altTrilhos + 20, { rx: 6, w: 1.6, fill: '#f7f8fa' });
  // distribui os componentes pelos trilhos (sem partir um dispositivo entre trilhos)
  let tr = 0, pos = 0;
  const cores = { geral: '#34404c', dps: '#c98a00', dr: '#1d6fd6', disj: '#ffffff', reserva: '#ffffff' };
  for (const c of comps) {
    if (pos + c.mod > porTrilho) { tr++; pos = 0; }
    if (tr >= trilhos) break;
    const x = x0 + pos * M, y = y0 + tr * hT;
    const w = c.mod * M - 3;
    const escuro = c.tipo === 'geral' || c.tipo === 'dr' || c.tipo === 'dps';
    d.r(x, y + 6, w, 62, { rx: 3, fill: cores[c.tipo], cor: c.tipo === 'reserva' ? '#9aa4ae' : '#34404c', dash: c.tipo === 'reserva' ? '4 3' : '' });
    // alavanca
    d.r(x + w / 2 - 5, y + 24, 10, 16, { rx: 2, fill: escuro ? '#ffffff' : '#34404c', cor: escuro ? '#ffffff' : '#34404c' });
    d.t(x + w / 2, y + 18, c.rot, { size: 10, bold: true, anchor: 'middle', cor: escuro ? '#ffffff' : '#1f2933' });
    if (c.sub) d.t(x + w / 2, y + 58, c.sub, { size: 9, anchor: 'middle', cor: escuro ? '#ffffff' : '#5f6b77' });
    if (c.dr) d.l(x, y + 72, x + w, y + 72, { cor: '#1d6fd6', w: 2.4 });
    pos += c.mod;
  }
  // trilhos
  for (let i = 0; i < trilhos; i++) {
    const y = y0 + i * hT + 37;
    d.l(x0 - 8, y, x0 + porTrilho * M + 5, y, { cor: '#b9bec4', w: 0.8, dash: '2 2' });
    d.t(x0 - 10, y0 + i * hT + 40, `T${i + 1}`, { size: 9, anchor: 'end', cor: '#8a96a3' });
  }
  // lista dos componentes
  const lx = larg + 30;
  d.t(lx, y0 - 2, 'Componentes', { size: 12, bold: true });
  comps.forEach((c, i) => d.t(lx, y0 + 16 + i * 15, `${c.nome}${c.sub && c.tipo === 'disj' ? ` — ${c.mod}P ${c.sub}` : ''}${c.dr ? ` (DR${c.dr})` : ''}`, { size: 10.5, cor: c.tipo === 'reserva' ? '#8a96a3' : '#1f2933' }));
  if (rq.modulos > rq.tamanho) d.t(20, H - 12, `Atenção: ${rq.modulos} módulos ocupados não cabem em ${rq.tamanho}.`, { size: 11, cor: '#d0453a', bold: true });
  return d.svg(W, H);
}

// ---------------------------------------------------------------- diagrama multifilar
export function svgMultifilar(projeto, rq) {
  const circs = ordenados(rq);
  const fases = rq.fasesQ;
  const barras = [...fases, 'N', 'PE'];
  const corB = { R: '#1f2933', S: '#7a4b00', T: '#5f6b77', N: '#1d6fd6', PE: '#1f9d55' };
  const xB = Object.fromEntries(barras.map((b, i) => [b, 50 + i * 22]));
  const xD = 50 + barras.length * 22 + 50; // coluna dos disjuntores
  const xR = xD + 140; // fim dos condutores
  const linhasDe = (r) => [...r.fases.map((f) => ({ b: f, k: 'F' })), ...(r.polos === 1 ? [{ b: 'N', k: 'N' }] : []), { b: 'PE', k: 'T' }];
  let y = 110;
  const alturas = circs.map((r) => { const h = linhasDe(r).length * 11 + 22; const y0 = y; y += h; return y0; });
  const H = y + 40, W = xR + 330;
  const d = desenho();
  d.t(20, 26, `Diagrama multifilar — ${nomeQuadro(rq.quadro, projeto)}`, { size: 15, bold: true });
  d.t(20, 44, `${rq.esquema} · ${projeto.eletrica?.tensaoFN || 127}/${projeto.eletrica?.tensaoFF || 220} V · disjuntor geral ${rq.disjuntorGeral ? `${fases.length}P ${rq.disjuntorGeral} A` : '-'}${rq.dps ? ' · DPS classe II' : ''}`, { size: 11, cor: '#5f6b77' });
  for (const b of barras) {
    d.l(xB[b], 78, xB[b], H - 30, { cor: corB[b], w: b === 'PE' ? 1.6 : 2.4, dash: b === 'PE' ? '6 3' : '' });
    d.t(xB[b], 72, b, { size: 11, bold: true, anchor: 'middle', cor: corB[b] });
  }
  d.t(xD - 6, 92, 'Proteção', { size: 10, bold: true, cor: '#5f6b77' });
  d.t(xR + 10, 92, 'Circuito', { size: 10, bold: true, cor: '#5f6b77' });
  circs.forEach((r, i) => {
    const y0 = alturas[i];
    const ls = linhasDe(r);
    ls.forEach((ln, j) => {
      const yy = y0 + 10 + j * 11;
      d.out.push(`<circle cx="${xB[ln.b]}" cy="${yy}" r="2.2" fill="${corB[ln.b]}"/>`);
      const tracejado = r.reserva ? '4 3' : '';
      if (ln.k === 'F') {
        d.l(xB[ln.b], yy, xD, yy, { cor: corB[ln.b], dash: tracejado });
        // contato do disjuntor
        d.l(xD, yy, xD + 12, yy - 6, { cor: '#1f2933' });
        d.l(xD + 14, yy, xR, yy, { cor: corB[ln.b], dash: tracejado });
      } else d.l(xB[ln.b], yy, xR, yy, { cor: corB[ln.b], dash: ln.b === 'PE' ? '6 3' : tracejado });
    });
    const nF = r.fases.length;
    if (nF > 1) d.l(xD + 6, y0 + 10, xD + 6, y0 + 10 + (nF - 1) * 11, { cor: '#1f2933', dash: '2 2' });
    if (!r.reserva) d.t(xD + 2, y0 + 4, `${r.polos}P ${r.disjuntor ?? '-'} A`, { size: 9.5 });
    if (r.dr) {
      const yA = y0 + 3, yB = y0 + 10 + (ls.length - 2) * 11 + 7;
      d.r(xD + 40, yA, 34, yB - yA, { rx: 3, cor: '#1d6fd6', dash: '3 2', fill: 'rgba(29,111,214,.06)' });
      d.t(xD + 57, yB + 9, `DR${r.drGrupo || ''}`, { size: 9, anchor: 'middle', cor: '#1d6fd6' });
    }
    if (!r.reserva) d.t(xD + 84, y0 + 4, `${fmtSec(r.secao)} mm²`, { size: 9.5, cor: '#5f6b77' });
    d.t(xR + 10, y0 + 14, `${r.circuito.numero} · ${r.circuito.nome.replace(/^C\d+\s*/, '')}`, { size: 11, bold: true });
    d.t(xR + 10, y0 + 28, r.reserva ? 'Reserva' : `${n0(r.potencia)} VA · ${r.fases.join('')} · Ib ${n1(r.ib)} A`, { size: 10, cor: '#5f6b77' });
  });
  return d.svg(W, H);
}

// ---------------------------------------------------------------- unifilar geral (quadros subordinados)
export function svgUnifilarGeral(projeto, ele) {
  const porQ = new Map(ele.quadros.map((q) => [q.quadro, q]));
  const raizes = ele.quadros.filter((q) => !q.alimentador?.pai || !porQ.has(q.alimentador.pai));
  const colW = 320, linH = 74, x0 = 30, y0 = 80;
  const nos = [];
  let folha = 0;
  const posiciona = (rq, nivel) => {
    const filhos = rq.filhos.map((f) => porQ.get(f)).filter(Boolean);
    let y;
    if (!filhos.length) y = y0 + folha++ * linH;
    else { const ys = filhos.map((f) => posiciona(f, nivel + 1)); y = (Math.min(...ys) + Math.max(...ys)) / 2; }
    nos.push({ rq, nivel, y });
    return y;
  };
  for (const r of raizes) posiciona(r, 0);
  const prof = Math.max(0, ...nos.map((n) => n.nivel));
  const W = x0 * 2 + (prof + 1) * colW + 40, H = y0 + Math.max(1, folha) * linH + 30;
  const d = desenho();
  d.t(20, 26, `Diagrama unifilar geral — ${projeto.nome || ''}`, { size: 15, bold: true });
  d.t(20, 44, 'Entrada de serviço, medição e quadros subordinados, com proteção geral e alimentadores.', { size: 11, cor: '#5f6b77' });
  const pos = new Map(nos.map((n) => [n.rq, n]));
  const bw = 170, bh = 46;
  for (const n of nos) {
    const x = x0 + n.nivel * colW, y = n.y;
    const rq = n.rq;
    const pai = rq.alimentador?.pai ? pos.get(porQ.get(rq.alimentador.pai)) : null;
    if (pai) {
      const xp = x0 + pai.nivel * colW + bw, yp = pai.y;
      d.l(xp, yp, xp + 20, yp, { w: 2 }); d.l(xp + 20, yp, xp + 20, y, { w: 2 }); d.l(xp + 20, y, x, y, { w: 2 });
      // disjuntor do alimentador no quadro de origem
      d.l(xp + 26, y, xp + 34, y - 7); d.t(xp + 30, y - 11, rq.disjuntorGeral ? `${rq.fasesQ.length}P ${rq.disjuntorGeral} A` : '', { size: 9.5, anchor: 'start' });
      if (rq.alimentador?.secao) d.t(xp + 30, y + 14, `${rq.alimentador.condutores} ${fmtSec(rq.alimentador.secao)} mm²${rq.alimentador.L > 0.05 ? ` · ${n1(rq.alimentador.L)} m` : ''}`, { size: 9.5, cor: '#5f6b77' });
    }
    const tipo = rq.quadro.tipo;
    d.r(x, y - bh / 2, bw, bh, { rx: 5, fill: tipo === 'qd' ? '#eaf1fc' : '#f4f1ea', cor: tipo === 'qd' ? '#1d6fd6' : '#8a6d2b', w: 1.4 });
    d.t(x + 10, y - 6, `${nomeQuadro(rq.quadro, projeto)} · ${TIPOS[tipo].nome}`, { size: 11, bold: true });
    d.t(x + 10, y + 10, `${rq.esquema} · ${n1(rq.demanda / 1000)} kVA${tipo === 'qd' ? ` · ${rq.circuitos.length} circ.` : ''}`, { size: 10, cor: '#5f6b77' });
  }
  return d.svg(W, H);
}

// ---------------------------------------------------------------- quadro de demanda
export function quadroDemanda(projeto, rq) {
  const ilum = rq.circuitos.filter((r) => !r.reserva && r.circuito.tipo === 'ILUM').reduce((a, r) => a + r.potencia, 0);
  const tug = rq.circuitos.filter((r) => !r.reserva && r.circuito.tipo === 'TUG').reduce((a, r) => a + r.potencia, 0);
  const tues = rq.circuitos.filter((r) => !r.reserva && r.circuito.tipo === 'TUE');
  const pTue = tues.reduce((a, r) => a + r.potencia, 0);
  // reservas entram como carga futura de iluminação/TUG (mesmo critério do cálculo do quadro)
  const res = rq.circuitos.filter((r) => r.reserva).reduce((a, r) => a + r.potencia, 0);
  const it = ilum + tug + res;
  const fIT = fdIlumTug(it / 1000), fT = fdTue(tues.length);
  const linhas = [
    ['Iluminação', n0(ilum), '', ''],
    ['Tomadas de uso geral', n0(tug), '', ''],
    ...(res ? [['Reservas', n0(res), '', '']] : []),
    ['Iluminação + TUG + reservas', n0(it), n1(fIT, 2), n0(it * fIT)],
    ...tues.map((r) => [`TUE: ${r.circuito.nome.replace(/^C\d+\s*/, '')}`, n0(r.potencia), '', '']),
    [`TUE (${tues.length} equipamento(s))`, n0(pTue), n1(fT, 2), n0(pTue * fT)],
  ];
  for (const f of rq.filhos) {
    const q = projeto ? nomeQuadro(f, projeto) : 'quadro';
    linhas.push([`Quadro a jusante ${q}`, '', '', '']);
  }
  const tensao = projeto.eletrica?.tensaoFN || 127;
  const ib = Math.max(0, ...Object.values(rq.fasesDem || rq.fases)) / tensao;
  return {
    head: ['Carga', 'Instalada (VA)', 'Fator de demanda', 'Demanda (VA)'],
    rows: linhas,
    foot: ['Demanda total', n0(rq.instaladaTotal), '', n0(rq.demanda)],
    resumo: [
      ['Corrente de projeto (fase mais carregada)', `${n1(ib)} A`],
      ['Disjuntor geral', rq.disjuntorGeral ? `${rq.fasesQ.length}P ${rq.disjuntorGeral} A` : '—'],
      ['Alimentador', rq.alimentador?.secao ? `${rq.alimentador.condutores} ${fmtSec(rq.alimentador.secao)} mm²` : '—'],
    ],
  };
}

// ---------------------------------------------------------------- legenda de fiação (indicações numéricas)
export function legendaFiacao(projeto, ele, pav, indicacoes) {
  const nomeEl = (n) => (TIPOS[n.el.tipo]?.quadro ? nomeQuadro(n.el, projeto) : TIPOS[n.el.tipo]?.sigla || n.el.tipo);
  const rows = [];
  for (const [sg, n] of indicacoes) {
    const nums = [...sg.circuitos].map((id) => projeto.circuitos.find((c) => c.id === id)?.numero).filter(Boolean).sort((a, b) => a - b);
    const secs = [...new Set(sg.condutores.map((c) => fmtSec(c.secao)))].join('/');
    rows.push([n, `${nomeEl(sg.de)} → ${nomeEl(sg.para)}`, nums.join(', '), `Ø${sg.dn}`, `${sg.cont.F}F ${sg.cont.N}N ${sg.cont.T}T ${sg.cont.R}R`, secs, sg.nivel === 'piso' ? 'piso' : 'forro', n1(sg.comp), sg.curvas]);
  }
  return { head: ['Nº', 'Trecho', 'Circuitos', 'DN', 'Condutores', 'Seção (mm²)', 'Passa', 'L (m)', 'Curvas'], rows };
}
