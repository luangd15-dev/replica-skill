// Estrutural em concreto armado, pré-dimensionamento (referência NBR 6118 / NBR 6120).
// Concreto C25, aço CA-50, γc = 1,4, γs = 1,15, γf = 1,4.
// Lajes descarregam nas vigas pelas áreas de influência (charneiras a 45°), vigas biapoiadas
// descarregam nos pilares, pilares acumulam carga de cima para baixo até a fundação.

export const MAT = { fck: 25, fyk: 500, gc: 1.4, gs: 1.15, gf: 1.4, pesoConcreto: 25, pesoAlvenaria: 13 };
const fcd = MAT.fck / MAT.gc; // MPa
const fyd = MAT.fyk / MAT.gs; // MPa
export const BITOLAS = [8, 10, 12.5, 16, 20, 25];
const TOL = 0.3; // m, tolerância para considerar apoio

const area = (phi) => (Math.PI * phi * phi) / 4 / 100; // cm²

// ---------------------------------------------------------------- geometria
export function detectarAmbientes(pav, res = 0.1) {
  // rasteriza as paredes e encontra regiões fechadas (flood fill); cada região vira um retângulo
  if (!pav.paredes.length) return [];
  const xs = pav.paredes.flatMap((w) => [w.x1, w.x2]), ys = pav.paredes.flatMap((w) => [w.y1, w.y2]);
  const x0 = Math.min(...xs) - 1, y0 = Math.min(...ys) - 1;
  const nx = Math.ceil((Math.max(...xs) + 1 - x0) / res), ny = Math.ceil((Math.max(...ys) + 1 - y0) / res);
  if (nx * ny > 4e6) return [];
  const grid = new Uint8Array(nx * ny); // 0 livre, 1 parede, 2 visitado
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = { x: x0 + (i + 0.5) * res, y: y0 + (j + 0.5) * res };
      for (const w of pav.paredes) if (segDist(p, w) <= w.esp / 2 + res * 0.75) { grid[j * nx + i] = 1; break; }
    }
  }
  const regioes = [];
  for (let s = 0; s < grid.length; s++) {
    if (grid[s]) continue;
    const pilha = [s];
    grid[s] = 2;
    let toca = false, n = 0, mi = nx, ma = 0, mj = ny, mb = 0;
    while (pilha.length) {
      const k = pilha.pop();
      const i = k % nx, j = (k - i) / nx;
      n++;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) toca = true;
      mi = Math.min(mi, i); ma = Math.max(ma, i); mj = Math.min(mj, j); mb = Math.max(mb, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii;
        if (!grid[kk]) { grid[kk] = 2; pilha.push(kk); }
      }
    }
    if (toca || n * res * res < 1) continue;
    // estende até o eixo das paredes vizinhas
    const meia = 0.075 + res * 0.75;
    const r = {
      x1: x0 + mi * res - meia, y1: y0 + mj * res - meia,
      x2: x0 + (ma + 1) * res + meia, y2: y0 + (mb + 1) * res + meia,
    };
    const snap = (v, lista) => {
      const c = lista.reduce((b, q) => (Math.abs(q - v) < Math.abs(b - v) ? q : b), lista[0]);
      return Math.abs(c - v) < 0.3 ? c : v;
    };
    const ux = [...new Set(xs)], uy = [...new Set(ys)];
    r.x1 = snap(r.x1, ux); r.x2 = snap(r.x2, ux); r.y1 = snap(r.y1, uy); r.y2 = snap(r.y2, uy);
    r.retangular = n * res * res > 0.85 * (r.x2 - r.x1) * (r.y2 - r.y1);
    regioes.push(r);
  }
  return regioes;
}

function segDist(p, w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / l2));
  return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
}

const chave = (x, y) => `${Math.round(x * 100)}|${Math.round(y * 100)}`;

// Pilares nas extremidades e cruzamentos de paredes; vigas sobre paredes, divididas nos pilares;
// lajes nos ambientes fechados.
export function lancamentoAutomatico(pav, uid) {
  const pontos = new Map();
  // pontos a menos de 30 cm de um pilar existente não geram outro
  const addP = (x, y) => {
    for (const q of pontos.values()) if (Math.hypot(q.x - x, q.y - y) < 0.3) return;
    pontos.set(chave(x, y), { x, y });
  };
  for (const w of pav.paredes) { addP(w.x1, w.y1); addP(w.x2, w.y2); }
  // cruzamentos e encontros em T
  for (const a of pav.paredes) {
    for (const b of pav.paredes) {
      if (a === b) continue;
      for (const q of [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }]) if (segDist(q, a) < 0.01) addP(q.x, q.y);
    }
  }
  // vãos grandes (> 5 m) recebem pilar intermediário
  const pilares = [...pontos.values()];
  const vigas = [];
  for (const w of pav.paredes) {
    const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const sobre = pilares
      .filter((p) => segDist(p, w) < 0.01)
      .map((p) => ({ ...p, t: ((p.x - w.x1) * (w.x2 - w.x1) + (p.y - w.y1) * (w.y2 - w.y1)) / (L * L) }))
      .sort((a, b) => a.t - b.t);
    const comInter = [];
    for (let i = 0; i < sobre.length; i++) {
      comInter.push(sobre[i]);
      const nx = sobre[i + 1];
      if (!nx) break;
      const vao = (nx.t - sobre[i].t) * L;
      const n = Math.ceil(vao / 5 - 1e-9);
      for (let k = 1; k < n; k++) {
        const t = sobre[i].t + ((nx.t - sobre[i].t) * k) / n;
        const p = { x: w.x1 + (w.x2 - w.x1) * t, y: w.y1 + (w.y2 - w.y1) * t, t };
        comInter.push(p);
        addP(p.x, p.y);
      }
    }
    for (let i = 0; i + 1 < comInter.length; i++) {
      const a = comInter[i], b = comInter[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05) continue;
      vigas.push({ id: uid('V'), x1: a.x, y1: a.y, x2: b.x, y2: b.y, b: 15, h: 40 });
    }
  }
  const novosPilares = [...pontos.values()].map((p) => ({
    id: uid('E'), tipo: 'pilar', x: p.x, y: p.y, altura: 0, b: 20, h: 30, descricao: '',
  }));
  const lajes = detectarAmbientes(pav).map((r) => ({
    id: uid('L'), x1: Math.min(r.x1, r.x2), y1: Math.min(r.y1, r.y2), x2: Math.max(r.x1, r.x2), y2: Math.max(r.y1, r.y2),
    // espessura: vão menor / 40, mínimo 10 cm
    h: Math.max(10, Math.ceil((Math.min(Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1)) / 40) * 100)), sc: 1.5, rev: 1.0,
  }));
  return { pilares: novosPilares, vigas, lajes };
}

// ---------------------------------------------------------------- cálculo
function sobreposicao(viga, a, b) {
  // comprimento comum entre a viga e o segmento [a,b], se forem colineares
  const L = Math.hypot(viga.x2 - viga.x1, viga.y2 - viga.y1);
  if (!L) return 0;
  const ux = (viga.x2 - viga.x1) / L, uy = (viga.y2 - viga.y1) / L;
  const off = (p) => Math.abs((p.x - viga.x1) * uy - (p.y - viga.y1) * ux);
  if (off(a) > 0.05 || off(b) > 0.05) return 0;
  const ta = (a.x - viga.x1) * ux + (a.y - viga.y1) * uy;
  const tb = (b.x - viga.x1) * ux + (b.y - viga.y1) * uy;
  return Math.max(0, Math.min(L, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb)));
}

export function dimensionarViga({ b, h, L, q }) {
  // b, h em cm; L em m; q em kN/m (característico)
  const M = (q * L * L) / 8; // kN·m
  const V = (q * L) / 2; // kN
  const Md = MAT.gf * M * 100; // kN·cm
  const Vd = MAT.gf * V;
  const d = h - 4;
  const fcdk = fcd / 10; // kN/cm²
  const fydk = fyd / 10;
  const arg = 1 - Md / (0.425 * b * d * d * fcdk);
  const avisos = [];
  let As = null, x = null;
  if (arg < 0) avisos.push('Seção insuficiente à flexão: aumente a altura.');
  else {
    x = 1.25 * d * (1 - Math.sqrt(arg));
    if (x / d > 0.45) avisos.push(`x/d = ${(x / d).toFixed(2)} > 0,45: aumente a altura.`);
    As = Math.max(Md / (fydk * (d - 0.4 * x)), 0.0015 * b * h);
  }
  const VRd2 = 0.27 * (1 - MAT.fck / 250) * fcdk * b * d;
  if (Vd > VRd2) avisos.push('Cisalhamento: biela comprimida esmagada (VSd > VRd2).');
  if (L / (h / 100) > 15) avisos.push(`Altura baixa para o vão (L/h = ${(L / (h / 100)).toFixed(1)}).`);
  return { M, V, Md: Md / 100, Vd, As, x, VRd2, barras: As ? escolherBarras(As, b) : null, avisos, ok: !avisos.length };
}

function escolherBarras(As, b) {
  for (const phi of BITOLAS) {
    const n = Math.max(2, Math.ceil(As / area(phi)));
    // cabe numa camada? cobrimento 2,5 cm, estribo 5 mm, espaçamento ≥ max(2 cm, φ)
    const largura = 2 * 3 + n * (phi / 10) + (n - 1) * Math.max(2, phi / 10);
    if (largura <= b || phi === BITOLAS[BITOLAS.length - 1]) return { n, phi, As: n * area(phi) };
  }
  return null;
}

export function dimensionarPilar({ b, h, N }) {
  // b, h em cm; N característico em kN. Compressão centrada com majoração de 20% para excentricidades.
  const Ac = b * h;
  const Nd = MAT.gf * N * 1.2;
  const fcdk = fcd / 10;
  const sigmaS = 42; // kN/cm² (aço a 2‰)
  const AsNec = (Nd - 0.85 * fcdk * Ac) / sigmaS;
  const AsMin = Math.max((0.15 * MAT.gf * N) / (fyd / 10), 0.004 * Ac);
  const AsMax = 0.04 * Ac;
  const As = Math.max(AsNec, AsMin);
  const avisos = [];
  if (Math.min(b, h) < 19) avisos.push('Menor dimensão abaixo de 19 cm (NBR 6118).');
  if (As > AsMax) avisos.push('Armadura acima de 4% da seção: aumente o pilar.');
  let barras = null;
  for (const phi of BITOLAS.filter((p) => p >= 10)) {
    let n = Math.max(4, Math.ceil(As / area(phi)));
    if (n % 2) n++;
    if (n <= 12) { barras = { n, phi, As: n * area(phi) }; break; }
  }
  return { Nd, As, AsMin, barras, taxa: As / Ac, avisos, ok: !avisos.length };
}

export function cargaLaje(l) {
  return MAT.pesoConcreto * (l.h / 100) + (l.rev ?? 1) + (l.sc ?? 1.5); // kN/m²
}

export function calcularEstrutura(projeto) {
  const avisos = [];
  const vigasRes = [], pilaresRes = [], lajesRes = [];
  const pavs = projeto.pavimentos;
  const acima = new Map(); // pilar -> carga vinda de cima
  // de cima para baixo
  for (let pi = pavs.length - 1; pi >= 0; pi--) {
    const pav = pavs[pi];
    const vigas = pav.vigas || [];
    const lajes = pav.lajes || [];
    const pilares = pav.elementos.filter((e) => e.tipo === 'pilar');
    const cargaViga = new Map(vigas.map((v) => [v, 0])); // kN (total)
    const detalheViga = new Map(vigas.map((v) => [v, { laje: 0, parede: 0, pp: 0 }]));

    for (const l of lajes) {
      const lx = Math.min(l.x2 - l.x1, l.y2 - l.y1), ly = Math.max(l.x2 - l.x1, l.y2 - l.y1);
      const p = cargaLaje(l);
      const A = (l.x2 - l.x1) * (l.y2 - l.y1);
      // área de influência de cada borda (charneiras a 45°)
      const aCurta = (lx * lx) / 4, aLonga = (A - 2 * aCurta) / 2;
      const horizLonga = l.x2 - l.x1 >= l.y2 - l.y1;
      const bordas = [
        { a: { x: l.x1, y: l.y1 }, b: { x: l.x2, y: l.y1 }, area: horizLonga ? aLonga : aCurta },
        { a: { x: l.x1, y: l.y2 }, b: { x: l.x2, y: l.y2 }, area: horizLonga ? aLonga : aCurta },
        { a: { x: l.x1, y: l.y1 }, b: { x: l.x1, y: l.y2 }, area: horizLonga ? aCurta : aLonga },
        { a: { x: l.x2, y: l.y1 }, b: { x: l.x2, y: l.y2 }, area: horizLonga ? aCurta : aLonga },
      ];
      let semApoio = 0;
      const apoiadas = [];
      for (const bd of bordas) {
        const Lb = Math.hypot(bd.b.x - bd.a.x, bd.b.y - bd.a.y);
        const vs = vigas.map((v) => ({ v, s: sobreposicao(v, bd.a, bd.b) })).filter((o) => o.s > 0.05);
        const cob = vs.reduce((s, o) => s + o.s, 0);
        if (cob < Lb * 0.5) { semApoio += bd.area; continue; }
        apoiadas.push({ bd, vs, cob });
      }
      if (!apoiadas.length) {
        avisos.push({ nivel: 'erro', texto: `${pav.nome}: laje L${lajes.indexOf(l) + 1} sem vigas de apoio.` });
        lajesRes.push({ laje: l, pav, p, A, lx, ly, ok: false });
        continue;
      }
      if (semApoio) avisos.push({ nivel: 'aviso', texto: `${pav.nome}: laje L${lajes.indexOf(l) + 1} com borda sem viga; carga redistribuída.` });
      const fator = A / apoiadas.reduce((s, o) => s + o.bd.area, 0);
      for (const { bd, vs, cob } of apoiadas) {
        const F = p * bd.area * fator;
        for (const o of vs) {
          cargaViga.set(o.v, cargaViga.get(o.v) + (F * o.s) / cob);
          detalheViga.get(o.v).laje += (F * o.s) / cob;
        }
      }
      lajesRes.push({ laje: l, pav, p, A, lx, ly, ok: true, espessuraMin: lx / 40 });
      if (l.h / 100 < lx / 40) avisos.push({ nivel: 'aviso', texto: `${pav.nome}: laje L${lajes.indexOf(l) + 1} fina para o vão (h ≥ ${Math.ceil((lx / 40) * 100)} cm).` });
    }

    // paredes do pavimento de cima apoiadas nas vigas deste pavimento
    const sup = pavs[pi + 1];
    for (const v of vigas) {
      const L = Math.hypot(v.x2 - v.x1, v.y2 - v.y1);
      const pp = MAT.pesoConcreto * (v.b / 100) * (v.h / 100) * L;
      let par = 0;
      if (sup) for (const w of sup.paredes) {
        const s = sobreposicao(v, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
        if (s > 0.05) par += MAT.pesoAlvenaria * w.esp * (sup.peDireito - v.h / 100) * s;
      }
      cargaViga.set(v, cargaViga.get(v) + pp + par);
      Object.assign(detalheViga.get(v), { pp, parede: par });
    }

    const reacao = new Map(pilares.map((p) => [p, 0]));
    for (const v of vigas) {
      const L = Math.hypot(v.x2 - v.x1, v.y2 - v.y1);
      const Q = cargaViga.get(v);
      const q = L ? Q / L : 0;
      const r = dimensionarViga({ b: v.b, h: v.h, L, q });
      for (const ponta of [{ x: v.x1, y: v.y1 }, { x: v.x2, y: v.y2 }]) {
        const p = pilares.find((pp) => Math.hypot(pp.x - ponta.x, pp.y - ponta.y) < TOL);
        if (p) reacao.set(p, reacao.get(p) + Q / 2);
        else r.avisos.push('Extremidade sem pilar (apoio em viga não considerado).');
      }
      r.ok = !r.avisos.length;
      vigasRes.push({ viga: v, pav, L, q, Q, detalhe: detalheViga.get(v), ...r });
    }

    for (const p of pilares) {
      const pp = MAT.pesoConcreto * (p.b / 100) * (p.h / 100) * pav.peDireito;
      const deCima = acima.get(chave(p.x, p.y)) || 0;
      const N = reacao.get(p) + pp + deCima;
      const r = dimensionarPilar({ b: p.b, h: p.h, N });
      pilaresRes.push({ pilar: p, pav, N, deCima, local: reacao.get(p), pp, ...r });
    }
    // carga que desce para o pavimento de baixo
    const proximo = new Map();
    for (const r of pilaresRes.filter((x) => x.pav === pav)) proximo.set(chave(r.pilar.x, r.pilar.y), r.N);
    // pilares que nascem neste pavimento e não continuam embaixo: avisa
    const baixo = pavs[pi - 1];
    if (baixo) {
      for (const [k, N] of proximo) {
        const [x, y] = k.split('|').map((v) => Number(v) / 100);
        const continua = baixo.elementos.some((e) => e.tipo === 'pilar' && Math.hypot(e.x - x, e.y - y) < TOL);
        if (!continua && N > 0) avisos.push({ nivel: 'aviso', texto: `${pav.nome}: pilar em (${x.toFixed(2)}; ${y.toFixed(2)}) não continua no ${baixo.nome} (pilar em transição).` });
      }
    }
    acima.clear();
    for (const [k, N] of proximo) acima.set(k, N);
  }

  for (const r of vigasRes) for (const a of r.avisos) avisos.push({ nivel: 'erro', texto: `${r.pav.nome}: viga V${(r.pav.vigas || []).indexOf(r.viga) + 1}: ${a}` });
  for (const r of pilaresRes) for (const a of r.avisos) avisos.push({ nivel: 'erro', texto: `${r.pav.nome}: pilar P${r.pav.elementos.filter((e) => e.tipo === 'pilar').indexOf(r.pilar) + 1}: ${a}` });

  // fundação: pilares do pavimento mais baixo, sapatas para σadm
  const base = pavs[0];
  const sigma = projeto.estrutura?.sigmaSolo ?? 200; // kPa
  const fundacao = pilaresRes.filter((r) => r.pav === base).map((r) => {
    const Aneces = (1.05 * r.N) / sigma; // m²
    const lado = Math.max(0.6, Math.ceil(Math.sqrt(Aneces) * 20) / 20);
    return { pilar: r.pilar, N: r.N, area: Aneces, lado };
  });
  return { vigas: vigasRes, pilares: pilaresRes, lajes: lajesRes, fundacao, avisos, sigma };
}

export function materiaisEstrutura(projeto, est) {
  let concreto = 0, formas = 0, aco = 0;
  for (const r of est.vigas) {
    concreto += (r.viga.b / 100) * (r.viga.h / 100) * r.L;
    formas += ((r.viga.b + 2 * r.viga.h) / 100) * r.L;
    if (r.barras) aco += r.barras.As * 1e-4 * r.L * 1.15 * 7850 * 1.6; // longitudinal + estribos (≈ 60%)
  }
  for (const r of est.pilares) {
    const ht = r.pav.peDireito;
    concreto += (r.pilar.b / 100) * (r.pilar.h / 100) * ht;
    formas += (2 * (r.pilar.b + r.pilar.h) / 100) * ht;
    if (r.barras) aco += r.barras.As * 1e-4 * ht * 1.15 * 7850 * 1.3;
  }
  for (const r of est.lajes) {
    concreto += r.A * (r.laje.h / 100);
    formas += r.A;
    aco += r.A * 3.5; // ≈ 3,5 kg/m² para lajes maciças de pequeno vão
  }
  let sapatas = 0;
  for (const f of est.fundacao) sapatas += f.lado * f.lado * 0.5;
  return [
    { desc: 'Concreto C25 (vigas, pilares, lajes)', un: 'm³', qtd: +(concreto * 1.05).toFixed(2) },
    { desc: 'Concreto C25 (sapatas, h ≈ 0,5 m)', un: 'm³', qtd: +(sapatas * 1.05).toFixed(2) },
    { desc: 'Aço CA-50 (estimado)', un: 'kg', qtd: Math.ceil(aco) },
    { desc: 'Fôrmas', un: 'm²', qtd: +formas.toFixed(1) },
  ].filter((i) => i.qtd > 0);
}
