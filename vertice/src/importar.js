// Converte linhas de um desenho importado em paredes.
// Em plantas CAD a parede é desenhada como duas linhas paralelas; cada par paralelo com
// afastamento entre 8 e 40 cm e trecho em comum vira uma parede no eixo, com a espessura medida.

export function paredesDeLinhas(fundo, camadas, uid, { min = 0.08, max = 0.4 } = {}) {
  const segs = [];
  for (let i = 0; i < fundo.s.length; i += 5) {
    if (!camadas.has(fundo.s[i])) continue;
    const [x1, y1, x2, y2] = fundo.s.slice(i + 1, i + 5);
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L < 0.2) continue;
    segs.push({ x1, y1, x2, y2, L, ux: (x2 - x1) / L, uy: (y2 - y1) / L, usado: false });
  }
  segs.sort((a, b) => b.L - a.L);
  segs.forEach((sg, i) => (sg.id = i));
  const paredes = [];
  const pares = new Set();
  for (const a of segs) {
    let melhor = null;
    for (const b of segs) {
      if (b === a || b.usado || pares.has(b.id + '|' + a.id)) continue;
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.02) continue; // não paralelas
      const d = Math.abs((b.x1 - a.x1) * a.uy - (b.y1 - a.y1) * a.ux);
      if (d < min || d > max) continue;
      // trecho em comum, projetado em a
      const t1 = (b.x1 - a.x1) * a.ux + (b.y1 - a.y1) * a.uy;
      const t2 = (b.x2 - a.x1) * a.ux + (b.y2 - a.y1) * a.uy;
      const ini = Math.max(0, Math.min(t1, t2)), fim = Math.min(a.L, Math.max(t1, t2));
      if (fim - ini < 0.3) continue;
      if (!melhor || d < melhor.d - 1e-6 || (Math.abs(d - melhor.d) < 1e-6 && fim - ini > melhor.fim - melhor.ini)) melhor = { b, d, ini, fim };
    }
    if (!melhor || a.usado) continue;
    const { b, d, ini, fim } = melhor;
    pares.add(a.id + '|' + b.id);
    // lado de b em relação a a
    const lado = Math.sign((b.x1 - a.x1) * -a.uy + (b.y1 - a.y1) * a.ux) || 1;
    const ox = -a.uy * lado * (d / 2), oy = a.ux * lado * (d / 2);
    const r = (v) => Math.round(v * 1000) / 1000;
    paredes.push({
      id: uid('P'),
      x1: r(a.x1 + a.ux * ini + ox), y1: r(a.y1 + a.uy * ini + oy),
      x2: r(a.x1 + a.ux * fim + ox), y2: r(a.y1 + a.uy * fim + oy),
      esp: Math.round(d * 100) / 100,
    });
    // consome os dois lados apenas se o trecho cobre a maior parte deles
    if (fim - ini > 0.8 * a.L) a.usado = true;
    if (fim - ini > 0.8 * b.L) b.usado = true;
  }
  return unirParedes(paredes);
}

// Estende ou apara as pontas das paredes até o eixo da parede que encontram (cantos e "T").
// Em CAD as linhas param na face da parede vizinha, não no eixo.
export function unirParedes(paredes, folga = 0.05) {
  const r = (v) => Math.round(v * 1000) / 1000;
  for (const w of paredes) {
    for (const ponta of [1, 2]) {
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      if (!L) continue;
      // direção apontando para fora, a partir da ponta
      const sgn = ponta === 2 ? 1 : -1;
      const ux = ((w.x2 - w.x1) / L) * sgn, uy = ((w.y2 - w.y1) / L) * sgn;
      const E = ponta === 1 ? { x: w.x1, y: w.y1 } : { x: w.x2, y: w.y2 };
      let melhor = null;
      for (const o of paredes) {
        if (o === w) continue;
        const Lo = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
        if (!Lo) continue;
        const ox = (o.x2 - o.x1) / Lo, oy = (o.y2 - o.y1) / Lo;
        const den = ux * oy - uy * ox;
        if (Math.abs(den) < 0.2) continue; // quase paralelas
        // E + t·u = O1 + s·o
        const t = ((o.x1 - E.x) * oy - (o.y1 - E.y) * ox) / den;
        const s = ((o.x1 - E.x) * uy - (o.y1 - E.y) * ux) / den;
        const lim = Math.max(o.esp, w.esp) + folga;
        if (Math.abs(t) > lim) continue;
        if (s < -o.esp / 2 - folga || s > Lo + o.esp / 2 + folga) continue;
        if (!melhor || Math.abs(t) < Math.abs(melhor.t)) melhor = { t };
      }
      if (melhor && Math.abs(melhor.t) > 1e-4) {
        if (ponta === 1) { w.x1 = r(E.x + ux * melhor.t); w.y1 = r(E.y + uy * melhor.t); }
        else { w.x2 = r(E.x + ux * melhor.t); w.y2 = r(E.y + uy * melhor.t); }
      }
    }
  }
  return paredes;
}
