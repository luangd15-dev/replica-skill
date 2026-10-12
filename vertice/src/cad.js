// Monta as entidades CAD do projeto para exportar em DXF/DWG.
// Camadas por disciplina; coordenadas em metros com Y para cima (padrão CAD).
import { TIPOS } from './tipos.js';
import { gravarDxf } from './dxf.js';
import TEMPLATE from '../assets/template-r2000.dxf';

export const CAMADAS = [
  { nome: 'ARQ-PAREDES', cor: 8 },
  { nome: 'EST-PILARES', cor: 1 },
  { nome: 'EST-VIGAS', cor: 6 },
  { nome: 'EST-LAJES', cor: 4 },
  { nome: 'EST-TEXTO', cor: 6 },
  { nome: 'ELE-PONTOS', cor: 5 },
  { nome: 'ELE-FIACAO', cor: 5 },
  { nome: 'ELE-TEXTO', cor: 5 },
  { nome: 'HID-PONTOS', cor: 4 },
  { nome: 'HID-AGUA-FRIA', cor: 150 },
  { nome: 'HID-ESGOTO', cor: 32 },
  { nome: 'HID-TEXTO', cor: 4 },
  { nome: 'SPDA', cor: 3 },
  { nome: 'DESENHO', cor: 7 },
  { nome: 'TITULO', cor: 7 },
];

// nomes de camada não aceitam <>/\":;?*|=` no AutoCAD
const refNome = (n) => `REF-${n}`.replace(/[<>/\\":;?*|=`,]/g, '_').slice(0, 250);
const fmt = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');

export function entidadesPavimento(projeto, calc, pav, dx = 0) {
  const ents = [];
  const X = (x) => x + dx, Y = (y) => -y;
  const line = (l, x1, y1, x2, y2) => ents.push({ t: 'line', l, x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2) });
  const poly = (l, pts, fechado = true) => ents.push({ t: 'poly', l, fechado, pts: pts.map(([x, y]) => [X(x), Y(y)]) });
  const circle = (l, x, y, r) => ents.push({ t: 'circle', l, x: X(x), y: Y(y), r });
  const text = (l, x, y, h, texto) => ents.push({ t: 'text', l, x: X(x), y: Y(y), h, texto });

  // paredes: contorno de cada trecho
  for (const w of pav.paredes) {
    const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
    const ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L, h = w.esp / 2;
    poly('ARQ-PAREDES', [
      [w.x1 - ux * h - uy * h, w.y1 - uy * h + ux * h], [w.x2 + ux * h - uy * h, w.y2 + uy * h + ux * h],
      [w.x2 + ux * h + uy * h, w.y2 + uy * h - ux * h], [w.x1 - ux * h + uy * h, w.y1 - uy * h - ux * h],
    ]);
  }

  // estrutura
  (pav.lajes || []).forEach((l, i) => {
    poly('EST-LAJES', [[l.x1, l.y1], [l.x2, l.y1], [l.x2, l.y2], [l.x1, l.y2]]);
    text('EST-TEXTO', (l.x1 + l.x2) / 2 - 0.4, (l.y1 + l.y2) / 2, 0.18, `L${i + 1} h=${l.h}`);
  });
  (pav.vigas || []).forEach((v, i) => {
    const L = Math.hypot(v.x2 - v.x1, v.y2 - v.y1) || 1;
    const nx = (-(v.y2 - v.y1) / L) * (v.b / 200), ny = ((v.x2 - v.x1) / L) * (v.b / 200);
    line('EST-VIGAS', v.x1 + nx, v.y1 + ny, v.x2 + nx, v.y2 + ny);
    line('EST-VIGAS', v.x1 - nx, v.y1 - ny, v.x2 - nx, v.y2 - ny);
    text('EST-TEXTO', (v.x1 + v.x2) / 2 + 0.1, (v.y1 + v.y2) / 2 - 0.15, 0.15, `V${i + 1} ${v.b}x${v.h}`);
  });
  let np = 0;
  for (const e of pav.elementos) {
    const t = TIPOS[e.tipo];
    if (!t) continue;
    if (e.tipo === 'pilar') {
      np++;
      const bx = e.b / 200, by = e.h / 200;
      poly('EST-PILARES', [[e.x - bx, e.y - by], [e.x + bx, e.y - by], [e.x + bx, e.y + by], [e.x - bx, e.y + by]]);
      text('EST-TEXTO', e.x + bx + 0.05, e.y - by - 0.05, 0.15, `P${np} ${e.b}x${e.h}`);
    } else if (t.disc === 'ele') {
      const r = 0.15;
      if (e.tipo === 'luz') {
        circle('ELE-PONTOS', e.x, e.y, r);
        line('ELE-PONTOS', e.x - r * 0.7, e.y - r * 0.7, e.x + r * 0.7, e.y + r * 0.7);
        line('ELE-PONTOS', e.x + r * 0.7, e.y - r * 0.7, e.x - r * 0.7, e.y + r * 0.7);
      } else if (e.tipo === 'tug' || e.tipo === 'tue') {
        poly('ELE-PONTOS', [[e.x, e.y - r], [e.x + r, e.y + r * 0.8], [e.x - r, e.y + r * 0.8]]);
      } else if (e.tipo === 'interruptor') {
        circle('ELE-PONTOS', e.x, e.y, r * 0.5);
        line('ELE-PONTOS', e.x + r * 0.35, e.y - r * 0.35, e.x + r * 1.2, e.y - r * 1.2);
      } else if (e.tipo === 'qd') {
        poly('ELE-PONTOS', [[e.x - 0.25, e.y - 0.12], [e.x + 0.25, e.y - 0.12], [e.x + 0.25, e.y + 0.12], [e.x - 0.25, e.y + 0.12]]);
      }
      const circ = projeto.circuitos.find((c) => c.id === e.circuitoId);
      const rot = e.tipo === 'qd' ? 'QD' : `${circ ? circ.numero : '?'}${e.tipo === 'tue' ? ` ${e.potencia}W` : ''}`;
      text('ELE-TEXTO', e.x + 0.2, e.y - 0.2, 0.15, rot);
    } else if (t.disc === 'hid') {
      if (e.tipo === 'reservatorio' || e.tipo === 'ci') poly('HID-PONTOS', [[e.x - 0.3, e.y - 0.3], [e.x + 0.3, e.y - 0.3], [e.x + 0.3, e.y + 0.3], [e.x - 0.3, e.y + 0.3]]);
      else circle('HID-PONTOS', e.x, e.y, 0.15);
      text('HID-TEXTO', e.x + 0.2, e.y - 0.2, 0.15, t.sigla);
    }
  }

  // fiação elétrica (trajeto simplificado em linha reta)
  for (const r of calc.results) {
    if (!r.qd || !pav.elementos.includes(r.qd)) continue;
    const pts = [[r.qd.x, r.qd.y], ...r.rota.filter((e) => pav.elementos.includes(e)).map((e) => [e.x, e.y])];
    if (pts.length > 1) poly('ELE-FIACAO', pts, false);
  }

  // redes hidráulicas (trajeto ortogonal)
  const rede = (segs, l, rot) => {
    for (const s of segs) {
      if (s.para.pav !== pav) continue;
      poly(l, [[s.de.x, s.de.y], [s.para.x, s.de.y], [s.para.x, s.para.y]], false);
      text('HID-TEXTO', (s.de.x + s.para.x) / 2, s.de.y - 0.12, 0.13, rot(s));
    }
  };
  if (calc.hid) {
    rede(calc.hid.af.segmentos, 'HID-AGUA-FRIA', (s) => `Ø${s.de_mm}`);
    rede(calc.hid.esg.segmentos, 'HID-ESGOTO', (s) => `DN${s.dn} i=${s.declividade}%`);
  }

  // SPDA
  const sp = calc.spda;
  if (sp?.ativo && sp.captacao) {
    if (sp.contorno.pav === pav) for (const l of sp.captacao) line('SPDA', l.x1, l.y1, l.x2, l.y2);
    for (const d of sp.descidas) circle('SPDA', d.x, d.y, 0.1);
    if (projeto.pavimentos.indexOf(pav) === 0) poly('SPDA', [[sp.anel.minX, sp.anel.minY], [sp.anel.maxX, sp.anel.minY], [sp.anel.maxX, sp.anel.maxY], [sp.anel.minX, sp.anel.maxY]]);
  }

  // linhas e textos desenhados no Vértice
  for (const d of pav.desenho || []) {
    if (d.t === 'linha') line('DESENHO', d.x1, d.y1, d.x2, d.y2);
    else if (d.t === 'ret') poly('DESENHO', [[d.x1, d.y1], [d.x2, d.y1], [d.x2, d.y2], [d.x1, d.y2]]);
    else if (d.t === 'circ') circle('DESENHO', d.x, d.y, d.r);
    else if (d.t === 'texto') text('DESENHO', d.x, d.y, d.h, d.texto);
  }

  // referência importada
  const f = pav.fundo;
  if (f) {
    for (let i = 0; i < f.s.length; i += 5) line(refNome(f.camadas[f.s[i]].nome), f.s[i + 1], f.s[i + 2], f.s[i + 3], f.s[i + 4]);
    for (let i = 0; i < f.c.length; i += 4) circle(refNome(f.camadas[f.c[i]].nome), f.c[i + 1], f.c[i + 2], f.c[i + 3]);
    for (const t of f.t) text(refNome(f.camadas[t.l].nome), t.x, t.y, t.h, t.t);
  }

  text('TITULO', 0, -1.2, 0.35, `${projeto.nome} - ${pav.nome} (cota ${fmt(pav.cota)} m)`);
  return ents;
}

// todos: pavimentos lado a lado, com 5 m entre eles
export function exportarDxf(projeto, calc, pavs) {
  const ents = [];
  let dx = 0;
  for (const pav of pavs) {
    ents.push(...entidadesPavimento(projeto, calc, pav, dx));
    const xs = [...pav.paredes.flatMap((w) => [w.x1, w.x2]), ...pav.elementos.map((e) => e.x), 0];
    if (pav.fundo) for (let i = 0; i < pav.fundo.s.length; i += 5) xs.push(pav.fundo.s[i + 1], pav.fundo.s[i + 3]);
    dx += Math.max(...xs) + 5;
  }
  const usadas = new Set(ents.map((e) => e.l));
  const camadas = [...CAMADAS.filter((c) => usadas.has(c.nome)), ...[...usadas].filter((n) => n.startsWith('REF-')).map((nome) => ({ nome, cor: 8 }))];
  return gravarDxf(TEMPLATE, camadas, ents);
}
