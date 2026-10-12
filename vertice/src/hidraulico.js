// Hidrossanitário simplificado.
// Água fria (referência NBR 5626): rede em árvore a partir do reservatório, vazão pelo
// método dos pesos Q = 0,3·√ΣP, diâmetro por velocidade ≤ 3 m/s, perda de carga por
// Fair-Whipple-Hsiao (PVC) com +20% de perdas localizadas, pressão dinâmica ≥ 1 mca.
// Esgoto (referência NBR 8160): rede em árvore até a caixa de inspeção, diâmetro pela
// soma de UHC a montante e pelo diâmetro mínimo de cada aparelho.

import { TIPOS } from './tipos.js';

// diâmetro externo PVC soldável (mm) -> diâmetro interno (mm)
export const TUBOS_AF = [[20, 17], [25, 21.6], [32, 27.8], [40, 35.2], [50, 44], [60, 53.4], [75, 66.6], [85, 75.6]];
// DN do ramal de esgoto -> UHC máximo
export const TUBOS_ESG = [[40, 3], [50, 6], [75, 20], [100, 160], [150, 620]];
export const V_MAX = 3; // m/s
export const P_MIN = 1; // mca (≈ 10 kPa)

const ehAparelho = (e) => TIPOS[e.tipo]?.peso != null;

// Coordenadas absolutas (z = cota do pavimento + altura do ponto).
function nos(projeto, filtro) {
  const out = [];
  for (const pav of projeto.pavimentos) {
    for (const e of pav.elementos) if (filtro(e)) out.push({ el: e, pav, x: e.x, y: e.y, z: pav.cota + e.altura });
  }
  return out;
}

// Árvore geradora mínima (Prim) a partir da raiz. Distância = trajeto ortogonal em planta + desnível,
// que é como tubulação costuma correr.
export function arvore(raiz, pontos) {
  const d = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
  const dentro = [raiz];
  const fora = pontos.slice();
  const arestas = [];
  while (fora.length) {
    let best = null;
    for (let i = 0; i < fora.length; i++) {
      for (const n of dentro) {
        const dd = d(n, fora[i]);
        if (!best || dd < best.dd) best = { i, pai: n, dd };
      }
    }
    const filho = fora.splice(best.i, 1)[0];
    filho.pai = best.pai;
    filho.comp = best.dd;
    dentro.push(filho);
    arestas.push({ de: best.pai, para: filho, comp: best.dd });
  }
  return arestas;
}

const filhosDe = (arestas) => {
  const m = new Map();
  for (const a of arestas) m.set(a.de, [...(m.get(a.de) || []), a.para]);
  return m;
};

function somaSubarvore(no, filhos, fn) {
  let s = fn(no);
  for (const f of filhos.get(no) || []) s += somaSubarvore(f, filhos, fn);
  return s;
}

export function perdaUnitaria(qLs, dInternoMm) {
  // J (m/m) = 0,000859 · Q^1,75 · D^-4,75, Q em m³/s, D em m
  if (qLs <= 0) return 0;
  return 0.000859 * Math.pow(qLs / 1000, 1.75) * Math.pow(dInternoMm / 1000, -4.75);
}

export function aguaFria(projeto) {
  const avisos = [];
  const res = nos(projeto, (e) => e.tipo === 'reservatorio');
  const aps = nos(projeto, ehAparelho);
  if (!aps.length) return { segmentos: [], pontos: [], avisos, raiz: null };
  if (!res.length) {
    avisos.push({ nivel: 'aviso', texto: 'Água fria: insira um reservatório para dimensionar a rede.' });
    return { segmentos: [], pontos: [], avisos, raiz: null };
  }
  if (res.length > 1) avisos.push({ nivel: 'aviso', texto: 'Água fria: mais de um reservatório. Usando o primeiro.' });
  const raiz = res[0];
  const arestas = arvore(raiz, aps);
  const filhos = filhosDe(arestas);
  const segmentos = arestas.map((a) => {
    const somaP = somaSubarvore(a.para, filhos, (n) => TIPOS[n.el.tipo].peso || 0);
    const q = 0.3 * Math.sqrt(somaP);
    let idx = TUBOS_AF.findIndex(([, di]) => q / 1000 / (Math.PI * (di / 1000) ** 2 / 4) <= V_MAX);
    if (idx < 0) idx = TUBOS_AF.length - 1;
    return { de: a.de, para: a.para, comp: a.comp, somaP, q, idx };
  });

  // pressão dinâmica em cada ponto; se faltar pressão, aumenta o tubo de maior perda no caminho
  const calcPressoes = () => {
    const p = new Map([[raiz, 0]]);
    const ordem = [raiz];
    for (const n of ordem) {
      for (const f of filhos.get(n) || []) {
        const s = segmentos.find((sg) => sg.para === f);
        const [, di] = TUBOS_AF[s.idx];
        s.v = s.q / 1000 / (Math.PI * (di / 1000) ** 2 / 4);
        s.j = perdaUnitaria(s.q, di);
        s.perda = s.j * s.comp * 1.2;
        p.set(f, p.get(n) + (n.z - f.z) - s.perda);
        ordem.push(f);
      }
    }
    return p;
  };
  let pressoes = calcPressoes();
  for (let it = 0; it < 60; it++) {
    const ruim = aps.filter((a) => pressoes.get(a) < P_MIN);
    if (!ruim.length) break;
    // caminho até o ponto mais crítico
    const pior = ruim.reduce((a, b) => (pressoes.get(a) < pressoes.get(b) ? a : b));
    const caminho = [];
    for (let n = pior; n.pai; n = n.pai) caminho.push(segmentos.find((s) => s.para === n));
    const cand = caminho.filter((s) => s.idx < TUBOS_AF.length - 1).sort((a, b) => b.perda - a.perda)[0];
    if (!cand) break;
    cand.idx++;
    pressoes = calcPressoes();
  }

  const pontos = aps.map((a) => ({ no: a, pressao: pressoes.get(a) }));
  for (const pt of pontos) {
    if (pt.pressao < P_MIN) {
      const est = pt.no.z - (raiz.z - P_MIN);
      avisos.push({
        nivel: 'erro',
        texto: `Água fria: ${TIPOS[pt.no.el.tipo].nome} (${pt.no.pav.nome}) com ${pt.pressao.toFixed(2)} mca. ` +
          (est > -0.5 ? 'Reservatório baixo demais em relação ao ponto: eleve o reservatório.' : 'Perda de carga alta mesmo no maior tubo.'),
      });
    }
  }
  for (const s of segmentos) s.de_mm = TUBOS_AF[s.idx][0];
  return { segmentos, pontos, avisos, raiz };
}

export function esgoto(projeto) {
  const avisos = [];
  const cis = nos(projeto, (e) => e.tipo === 'ci');
  const aps = nos(projeto, (e) => TIPOS[e.tipo]?.uhc != null);
  if (!aps.length) return { segmentos: [], avisos, raiz: null };
  if (!cis.length) {
    avisos.push({ nivel: 'aviso', texto: 'Esgoto: insira uma caixa de inspeção (saída) para dimensionar a rede.' });
    return { segmentos: [], avisos, raiz: null };
  }
  const raiz = cis[0];
  const arestas = arvore(raiz, aps);
  const filhos = filhosDe(arestas);
  const segmentos = arestas.map((a) => {
    const uhc = somaSubarvore(a.para, filhos, (n) => TIPOS[n.el.tipo].uhc || 0);
    let dnMin = 0;
    somaSubarvore(a.para, filhos, (n) => { dnMin = Math.max(dnMin, TIPOS[n.el.tipo].dnEsg || 0); return 0; });
    const porUhc = (TUBOS_ESG.find(([, max]) => uhc <= max) || TUBOS_ESG[TUBOS_ESG.length - 1])[0];
    const dn = Math.max(porUhc, dnMin);
    if (uhc > TUBOS_ESG[TUBOS_ESG.length - 1][1]) avisos.push({ nivel: 'erro', texto: `Esgoto: trecho com ${uhc} UHC excede a tabela.` });
    return { de: a.de, para: a.para, comp: a.comp, uhc, dn, declividade: dn >= 100 ? 1 : 2 };
  });
  return { segmentos, avisos, raiz };
}

export function calcularHidraulica(projeto) {
  const af = aguaFria(projeto);
  const esg = esgoto(projeto);
  return { af, esg, avisos: [...af.avisos, ...esg.avisos] };
}

export function materiaisHidraulica(projeto, hid) {
  const itens = new Map();
  const add = (desc, un, q) => {
    const k = desc + '|' + un;
    itens.set(k, { desc, un, qtd: (itens.get(k)?.qtd || 0) + q });
  };
  for (const s of hid.af.segmentos) add(`Tubo PVC soldável ${TUBOS_AF[s.idx][0]} mm (água fria)`, 'm', Math.ceil(s.comp * 1.1));
  for (const s of hid.esg.segmentos) add(`Tubo PVC esgoto DN ${s.dn}`, 'm', Math.ceil(s.comp * 1.1));
  for (const pav of projeto.pavimentos) {
    for (const e of pav.elementos) {
      const t = TIPOS[e.tipo];
      if (t?.disc !== 'hid') continue;
      if (e.tipo === 'reservatorio') add('Reservatório de polietileno 1000 L', 'pç', 1);
      else if (e.tipo === 'ci') add('Caixa de inspeção 60x60 cm', 'pç', 1);
      else { add(`Ponto de utilização: ${t.nome}`, 'pç', 1); add('Registro de gaveta 3/4"', 'pç', e.tipo === 'chuveiro' ? 1 : 0); }
    }
  }
  return [...itens.values()].filter((i) => i.qtd > 0).sort((a, b) => a.desc.localeCompare(b.desc, 'pt-BR'));
}
