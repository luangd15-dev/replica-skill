// Pranchas para entrega: folhas A4–A0 com margem e selo, montadas a partir de imagens da planta em escala,
// diagramas (SVG) e tabelas (HTML). O resultado é um HTML com @page em milímetros, impresso em PDF.

export const FOLHAS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
const ORDEM = ['A4', 'A3', 'A2', 'A1', 'A0'];
const SELO = { w: 180, h: 52 };
const GAP = 8;
const PX_MM = 0.27; // mm por px dos diagramas SVG

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// tamanho em mm de um item de conteúdo
export function tamanhoItem(it) {
  if (it.wmm && it.hmm) return [it.wmm, it.hmm];
  if (it.tipo === 'svg') {
    const w = Number(/width="([\d.]+)"/.exec(it.svg)?.[1] || 800), h = Number(/height="([\d.]+)"/.exec(it.svg)?.[1] || 600);
    return [w * PX_MM, h * PX_MM + 6];
  }
  // tabela: largura pedida, altura pelo número de linhas
  const linhas = (it.html.match(/<tr/g) || []).length;
  return [it.wmm || 170, it.hmm || 10 + linhas * 4.6];
}

function margens(folha) {
  const pequena = folha === 'A4' || folha === 'A3';
  return { esq: 25, dir: pequena ? 7 : 10, sup: pequena ? 7 : 10, inf: pequena ? 7 : 10 };
}

// posiciona os itens na folha (bottom-left: o primeiro ponto livre de cima para baixo, da esquerda para a direita);
// devolve as posições e os itens que não couberam
function arranjar(itens, folha) {
  const [W, H] = FOLHAS[folha];
  const m = margens(folha);
  const area = { x0: m.esq, y0: m.sup, x1: W - m.dir, y1: H - m.inf };
  const selo = { x: area.x1 - SELO.w, y: area.y1 - SELO.h, w: SELO.w, h: SELO.h };
  const ocup = [selo];
  const postos = [];
  const sobra = [];
  const bate = (r) => ocup.some((o) => r.x < o.x + o.w + GAP && r.x + r.w + GAP > o.x && r.y < o.y + o.h + GAP && r.y + r.h + GAP > o.y);
  for (const it of itens) {
    const [w, h] = tamanhoItem(it);
    const xs = [area.x0 + 4, ...ocup.map((o) => o.x + o.w + GAP)];
    const ys = [area.y0 + 4, ...ocup.map((o) => o.y + o.h + GAP)];
    let achou = null;
    for (const y of [...new Set(ys)].sort((a, b) => a - b)) {
      for (const x of [...new Set(xs)].sort((a, b) => a - b)) {
        const r = { x, y, w, h };
        if (x + w > area.x1 - 2 || y + h > area.y1 - 2) continue;
        if (!bate(r)) { achou = r; break; }
      }
      if (achou) break;
    }
    if (achou) { ocup.push(achou); postos.push({ it, ...achou }); } else sobra.push(it);
  }
  return { postos, sobra, area, selo };
}

// distribui o conteúdo em folhas; com papel "auto", cada prancha usa a menor folha em que tudo cabe
export function paginar(pranchas, papel) {
  const folhas = [];
  for (const p of pranchas) {
    let resto = p.conteudo.slice();
    let cont = 0;
    while (resto.length) {
      let folha = papel, arr = null;
      if (papel === 'auto') {
        for (const f of ORDEM) { arr = arranjar(resto, f); folha = f; if (!arr.sobra.length) break; }
      } else arr = arranjar(resto, papel);
      if (!arr.postos.length) {
        // item maior que a folha: vai sozinho, reduzido para caber
        const it = resto.shift();
        const [W, H] = FOLHAS[folha];
        const m = margens(folha);
        const [w, h] = tamanhoItem(it);
        const k = Math.min((W - m.esq - m.dir - 8) / w, (H - m.sup - m.inf - SELO.h - 16) / h, 1);
        arr = arranjar([{ ...it, wmm: w * k, hmm: h * k, reduzido: true }], folha);
      } else resto = arr.sobra;
      folhas.push({ titulo: cont++ ? `${p.titulo} (continuação)` : p.titulo, escala: p.escala, folha, ...arr });
    }
  }
  return folhas;
}

function selo(info, f, n, total) {
  const s = f.selo;
  const lin = (y, rot, val, size = 3.2, bold = false) => `<div style="position:absolute;left:3mm;top:${y}mm;width:${s.w - 6}mm;font-size:${size}mm;${bold ? 'font-weight:700;' : ''}white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:#6b7682;font-size:2.3mm">${esc(rot)}</span> ${esc(val)}</div>`;
  return `<div style="position:absolute;left:${s.x}mm;top:${s.y}mm;width:${s.w}mm;height:${s.h}mm;border:0.5mm solid #1f2933;box-sizing:border-box;background:#fff">
    ${lin(2, 'PROJETO', info.projeto, 4, true)}
    ${lin(9.5, 'CONTEÚDO', f.titulo, 3.4, true)}
    ${lin(16.5, 'PROPRIETÁRIO', info.proprietario || '—')}
    ${lin(22.5, 'ENDEREÇO', info.endereco || '—')}
    ${lin(28.5, 'RESPONSÁVEL TÉCNICO', `${info.autor || '—'}${info.registro ? ` · ${info.registro}` : ''}`)}
    <div style="position:absolute;left:0;right:0;top:35mm;border-top:0.3mm solid #1f2933"></div>
    ${lin(37, 'ESCALA', f.escala ? `1:${f.escala}` : 'indicada')}
    <div style="position:absolute;left:62mm;top:37mm;font-size:3.2mm"><span style="color:#6b7682;font-size:2.3mm">DATA</span> ${esc(info.data)}</div>
    <div style="position:absolute;left:112mm;top:37mm;font-size:3.2mm"><span style="color:#6b7682;font-size:2.3mm">FOLHA</span> <b>${n}/${total}</b> · ${f.folha}</div>
    ${lin(44, 'DISCIPLINA', `${info.disciplina || 'Instalações elétricas'} · gerado no Vértice`, 2.8)}
  </div>`;
}

function itemHtml(p) {
  const { it } = p;
  const leg = it.legenda ? `<div style="font-size:3mm;font-weight:700;margin:0 0 1.5mm">${esc(it.legenda)}${it.reduzido ? ' (fora de escala)' : ''}</div>` : '';
  const caixa = `position:absolute;left:${p.x}mm;top:${p.y}mm;width:${p.w}mm;height:${p.h}mm;`;
  if (it.tipo === 'img') return `<div style="${caixa}">${leg}<img src="${it.src}" style="width:${p.w}mm;height:${p.h - (it.legenda ? 5 : 0)}mm;display:block"></div>`;
  if (it.tipo === 'svg') return `<div style="${caixa}">${leg}<div style="width:${p.w}mm">${it.svg.replace(/style="background:#fff;max-width:100%;height:auto"/, 'style="width:100%;height:auto;display:block"')}</div></div>`;
  return `<div style="${caixa}font-size:2.6mm">${leg}${it.html}</div>`;
}

// HTML final: uma <section> por folha
export function gerarPranchas({ pranchas, papel = 'auto', info }) {
  const folhas = paginar(pranchas, papel);
  const css = `.folha,.folha *{box-sizing:border-box}
    .folha{position:relative;overflow:hidden;background:#fff;page-break-after:always;break-after:page;font-family:'Segoe UI',Arial,sans-serif;color:#1f2933}
    .folha table{border-collapse:collapse;width:100%}.folha th,.folha td{border:0.2mm solid #9aa4ae;padding:0.6mm 1.2mm;text-align:right;white-space:nowrap}
    .folha th{background:#eef0f3}.folha td.l{text-align:left}.folha .tag{font-weight:600}`;
  const paginas = folhas.map((f, i) => {
    const [W, H] = FOLHAS[f.folha];
    const m = margens(f.folha);
    return `<section class="folha" style="width:${W}mm;height:${H}mm;page:p${f.folha}">
      <div style="position:absolute;left:${m.esq}mm;top:${m.sup}mm;right:${m.dir}mm;bottom:${m.inf}mm;border:0.5mm solid #1f2933"></div>
      ${f.postos.map(itemHtml).join('')}${selo(info, f, i + 1, folhas.length)}</section>`;
  }).join('');
  const pages = [...new Set(folhas.map((f) => f.folha))].map((f) => `@page p${f}{size:${FOLHAS[f][0]}mm ${FOLHAS[f][1]}mm;margin:0}`).join('');
  return { folhas, html: `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(info.projeto)} — pranchas</title><style>@page{margin:0}${pages}body{margin:0}${css}</style><body>${paginas}</body></html>`, corpo: paginas, css };
}
