// Diagrama unifilar de um quadro de distribuição, gerado em SVG a partir do cálculo elétrico.
import { fmtSec, nomeQuadro } from './eletrico.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = (v) => Math.round(v).toLocaleString('pt-BR');

export function svgUnifilar(projeto, rq) {
  const q = rq.quadro;
  const circs = rq.circuitos.slice().sort((a, b) => a.circuito.numero - b.circuito.numero);
  const larg = 980, topo = 150, passo = 46;
  const H = topo + Math.max(1, circs.length) * passo + 150;
  const xBarra = 260;
  const out = [];
  const t = (x, y, s, o = {}) => out.push(`<text x="${x}" y="${y}" font-size="${o.size || 12}" ${o.anchor ? `text-anchor="${o.anchor}"` : ''} ${o.bold ? 'font-weight="700"' : ''} fill="${o.cor || '#1f2933'}">${esc(s)}</text>`);
  const l = (x1, y1, x2, y2, o = {}) => out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.cor || '#1f2933'}" stroke-width="${o.w || 1.4}" ${o.dash ? `stroke-dasharray="${o.dash}"` : ''}/>`);
  const disj = (x, y, rot) => {
    // disjuntor: traço inclinado com "x" na base
    l(x, y, x + 10, y - 9);
    l(x - 3, y - 3, x + 3, y + 3); l(x - 3, y + 3, x + 3, y - 3);
    if (rot) t(x + 2, y - 14, rot, { size: 11, anchor: 'middle' });
  };

  // cabeçalho
  t(20, 28, `Diagrama unifilar — ${nomeQuadro(q, projeto)}`, { size: 16, bold: true });
  t(20, 48, `${rq.pav?.nome || ''} · esquema ${rq.esquema} · ${projeto.eletrica?.tensaoFN || 127}/${projeto.eletrica?.tensaoFF || 220} V`, { size: 12, cor: '#5f6b77' });
  t(20, 66, `Instalada ${n0(rq.instaladaTotal)} VA · demanda ${n0(rq.demanda)} VA · quadro ${rq.tamanho} módulos`, { size: 12, cor: '#5f6b77' });

  // alimentação e disjuntor geral
  const yG = 105;
  l(40, yG, 120, yG, { w: 2.4 });
  const ali = rq.alimentador;
  t(40, yG - 10, ali?.pai ? `De ${nomeQuadro(ali.pai, projeto)}` : 'Alimentação', { size: 11 });
  if (ali?.secao) t(40, yG + 18, `${ali.condutores} ${fmtSec(ali.secao)} mm²`, { size: 11, cor: '#5f6b77' });
  disj(130, yG, rq.disjuntorGeral ? `${rq.fasesQ.length}P ${rq.disjuntorGeral} A` : 'geral');
  l(140, yG, xBarra, yG, { w: 2.4 });
  if (rq.dps) {
    l(200, yG, 200, yG + 30);
    out.push(`<rect x="192" y="${yG + 30}" width="16" height="22" fill="none" stroke="#1f2933"/>`);
    t(214, yG + 46, 'DPS', { size: 10 });
    l(200, yG + 52, 200, yG + 62); l(193, yG + 62, 207, yG + 62); l(196, yG + 66, 204, yG + 66);
  }
  // barramento
  const yFim = topo + Math.max(1, circs.length) * passo - passo / 2;
  l(xBarra, yG, xBarra, yFim, { w: 3.2 });
  t(xBarra - 6, yFim + 18, `Barramento ${rq.fasesQ.join(' ')} N T`, { size: 10, anchor: 'end', cor: '#5f6b77' });

  // colunas
  const cols = [[xBarra + 20, 'DR'], [xBarra + 136, 'Disjuntor'], [xBarra + 230, 'Cabo'], [xBarra + 320, 'Fases'], [xBarra + 380, 'Circuito'], [larg - 20, 'Potência']];
  for (const [x, nome] of cols) t(x, topo - 34, nome, { size: 11, bold: true, cor: '#5f6b77', anchor: nome === 'Potência' ? 'end' : 'start' });
  // grupos de DR
  const yDe = new Map(circs.map((r, i) => [r.circuito.id, topo + i * passo]));
  for (const [gi, g] of rq.drGrupos.entries()) {
    const ys = g.circuitos.map((id) => yDe.get(id)).filter((v) => v != null);
    if (!ys.length) continue;
    const y0 = Math.min(...ys) - 12, y1 = Math.max(...ys) + 12;
    out.push(`<rect x="${xBarra + 14}" y="${y0}" width="60" height="${y1 - y0}" rx="4" fill="#eaf1fc" stroke="#1d6fd6" stroke-dasharray="4 3"/>`);
    t(xBarra + 14, y0 - 4, `DR${gi + 1} ${g.polos}P ${g.nominal} A 30 mA`, { size: 10, cor: '#1d6fd6' });
  }
  for (const r of circs) {
    const y = yDe.get(r.circuito.id);
    l(xBarra, y, xBarra + 140, y);
    disj(xBarra + 150, y, r.reserva ? '' : `${r.polos}P ${r.disjuntor ?? '-'} A`);
    l(xBarra + 160, y, larg - 210, y, { dash: r.reserva ? '5 4' : '' });
    t(xBarra + 230, y - 6, r.reserva ? '—' : `${fmtSec(r.secao)} mm²`, { size: 11 });
    t(xBarra + 320, y - 6, r.fases.join(''), { size: 11 });
    t(xBarra + 380, y - 6, `${r.circuito.numero} · ${r.circuito.nome.replace(/^C\d+\s*/, '')}`, { size: 11, bold: true });
    t(xBarra + 380, y + 12, r.reserva ? 'Reserva' : `${r.circuito.tipo} · ${r.pontos.length} pontos · Ib ${r.ib.toFixed(1)} A · ΔV ${r.queda != null ? r.queda.toFixed(2) : '-'}%`, { size: 10, cor: '#5f6b77' });
    t(larg - 20, y - 6, `${n0(r.potencia)} VA`, { size: 11, anchor: 'end' });
  }

  // quadro de fases
  const yQ = topo + Math.max(1, circs.length) * passo + 20;
  t(20, yQ + 20, 'Carga por fase (instalada):', { size: 12, bold: true });
  rq.fasesQ.forEach((f, i) => t(220 + i * 160, yQ + 20, `${f}: ${n0(rq.fases[f])} VA`, { size: 12 }));
  t(20, yQ + 42, `Desequilíbrio: ${(rq.deseq * 100).toFixed(1)}% · demanda iluminação/TUG ${n0(rq.dIT)} VA · TUE ${n0(rq.dTUE)} VA`, { size: 11, cor: '#5f6b77' });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${larg} ${H}" width="${larg}" height="${H}" preserveAspectRatio="xMinYMin meet" font-family="Segoe UI, Arial, sans-serif" style="background:#fff;max-width:100%;height:auto">${out.join('')}</svg>`;
}
