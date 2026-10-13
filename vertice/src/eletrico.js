// Projeto elétrico de baixa tensão (referência: NBR 5410).
//
// Pipeline (calcularEletrica):
//   1. quadros e hierarquia (entrada de serviço → medição → distribuição)
//   2. rede de eletrodutos por quadro: árvore geradora mínima pelos pontos dos seus circuitos,
//      com trajeto pelo forro (descidas até cada ponto) e prumadas entre pavimentos
//   3. condutores em cada trecho: fases, neutro, terra e retornos de cada comando
//   4. eletroduto de cada trecho pela taxa de ocupação de 40%
//   5. circuitos: corrente de projeto, fator de agrupamento (maior nº de circuitos num trecho
//      do caminho), fator de temperatura, seção, disjuntor, queda de tensão e DR
//   6. fases balanceadas automaticamente, demanda, alimentadores, reservas e verificações

import { TIPOS, AMBIENTES } from './tipos.js';
export { TIPOS };

// ---------------------------------------------------------------- tabelas
// capacidade de condução (A), cobre/PVC 70 °C, método B1 — 2 e 3 condutores carregados (tab. 36)
export const CAPACIDADE = [
  [1.5, 17.5, 15.5], [2.5, 24, 21], [4, 32, 28], [6, 41, 36], [10, 57, 50], [16, 76, 68],
  [25, 101, 89], [35, 125, 110], [50, 151, 134], [70, 192, 171], [95, 232, 207],
];
export const DISJUNTORES = [10, 16, 20, 25, 32, 40, 50, 63, 70, 80, 100, 125, 160, 200];
export const DR_NOMINAIS = [25, 40, 63, 80, 100];
const RHO = 0.0172; // Ω·mm²/m, cobre
export const QUEDA_MAX = 4; // % circuitos terminais (padrão; configurável no projeto)
// fator de agrupamento (tab. 42, condutores em feixe/eletroduto)
const AGRUPAMENTO = [1, 1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5, 0.5, 0.5, 0.45, 0.45, 0.45, 0.45, 0.41, 0.41, 0.41, 0.41, 0.38];
export const fatorAgrupamento = (n) => AGRUPAMENTO[Math.min(n, AGRUPAMENTO.length - 1)] ?? 0.38;
// fator de temperatura ambiente, PVC (tab. 40)
const TEMPERATURA = { 10: 1.22, 15: 1.17, 20: 1.12, 25: 1.06, 30: 1, 35: 0.94, 40: 0.87, 45: 0.79, 50: 0.71 };
export const fatorTemperatura = (t) => TEMPERATURA[Math.round(t / 5) * 5] ?? 1;
// seção externa aproximada do condutor isolado 750 V (mm²) para ocupação de eletroduto
const AREA_CABO = { 1.5: 7.1, 2.5: 10.2, 4: 13.9, 6: 18.1, 10: 30.2, 16: 44.2, 25: 63.6, 35: 81.7, 50: 113, 70: 154, 95: 201 };
// eletroduto corrugado/rígido: diâmetro nominal (mm) -> diâmetro interno (mm)
export const ELETRODUTOS = [[20, 16], [25, 20.4], [32, 26.6], [40, 33.4], [50, 42], [60, 50.8], [75, 64]];
// demanda residencial (iluminação + TUG) por faixa de potência instalada (kW)
const FD_ILUM_TUG = [[1, 0.86], [2, 0.75], [3, 0.66], [4, 0.59], [5, 0.52], [6, 0.45], [7, 0.4], [8, 0.35], [9, 0.31], [10, 0.27], [Infinity, 0.24]];
// demanda de TUE pelo número de equipamentos
const FD_TUE = [1, 1, 1, 0.84, 0.76, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.49, 0.48, 0.46, 0.45, 0.44, 0.43, 0.42, 0.41, 0.4, 0.4];
export const fdIlumTug = (kw) => FD_ILUM_TUG.find(([lim]) => kw <= lim)[1];
export const fdTue = (n) => (n <= 0 ? 0 : FD_TUE[Math.min(n, FD_TUE.length - 1)] ?? 0.39);
export const MODULOS_QD = [12, 18, 24, 36, 48, 60, 72, 96];

export const ESQUEMAS = { 'F+N': ['R'], '2F+N': ['R', 'S'], '3F+N': ['R', 'S', 'T'] };
export const COMANDO_TIPOS = ['interruptor', 'paralelo', 'intermediario', 'dimmer', 'sensor', 'pulsador'];
const ehComando = (e) => COMANDO_TIPOS.includes(e.tipo);
const ehQuadro = (e) => TIPOS[e.tipo]?.quadro;

export const fmtSec = (s) => (s == null ? '-' : String(s).replace('.', ','));
const area = (d) => (Math.PI * d * d) / 4;

export function configEletrica(projeto) {
  return {
    tensaoFN: 127, tensaoFF: 220, quedaMax: QUEDA_MAX, quedaAlim: 1, temperatura: 30,
    // eletrodutos: diâmetro mínimo, taxa de ocupação (NBR 5410 6.2.11.1.6), tomadas baixas pelo piso ou pelo forro,
    // trecho contínuo máximo entre caixas (15 m, menos 3 m por curva de 90°)
    diametroMin: 20, ocupacaoMax: 0.4, rotaBaixa: 'piso', trechoMax: 15,
    material: 'Eletroduto corrugado PVC',
    ...(projeto.eletrica || {}),
  };
}

export const MATERIAIS_ELETRODUTO = ['Eletroduto corrugado PVC', 'Eletroduto rígido PVC roscável', 'Eletroduto PEAD', 'Eletroduto de aço galvanizado', 'Eletrocalha perfurada'];

// ---------------------------------------------------------------- dimensionamento de um circuito
export function dimensionar({ potencia, tensao, comprimentoM, grupo, polos = 1, fAgr = 1, fTemp = 1, quedaMax = QUEDA_MAX, secaoMin, secaoFixa }) {
  // tensao: tensão de referência do circuito (F-N para 1 polo, F-F para 2 e 3 polos)
  const ib = tensao > 0 ? (polos === 3 ? potencia / (Math.sqrt(3) * tensao) : potencia / tensao) : 0;
  const carregados = polos === 3 ? 3 : 2;
  const k = polos === 3 ? Math.sqrt(3) : 2;
  const secMin = secaoMin ?? (grupo === 'ILUM' ? 1.5 : 2.5);
  const avisos = [];
  for (const row of CAPACIDADE) {
    const secao = row[0];
    if (secao < secMin) continue;
    if (secaoFixa && secao !== Number(secaoFixa)) continue;
    const iz = row[carregados === 3 ? 2 : 1] * fAgr * fTemp;
    const disj = DISJUNTORES.find((d) => d >= ib && d <= iz);
    if (!disj) continue;
    const queda = tensao > 0 ? ((k * RHO * comprimentoM * ib) / (secao * tensao)) * 100 : 0;
    if (queda > quedaMax) continue;
    return { ib, secao, iz, disjuntor: disj, queda, avisos, ok: true, carregados };
  }
  avisos.push(secaoFixa ? `A seção fixada de ${fmtSec(secaoFixa)} mm² não atende (corrente, disjuntor ou queda). Libere a seção ou divida o circuito.` : 'Nenhuma combinação de cabo e disjuntor atende. Divida o circuito.');
  return { ib, secao: null, iz: null, disjuntor: null, queda: null, avisos, ok: false, carregados };
}

// ---------------------------------------------------------------- utilidades legadas (testes / relatórios)
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function rotaCircuito(qd, elementos) {
  const rota = [];
  const resto = elementos.slice();
  let atual = qd;
  while (resto.length) {
    let iMin = 0;
    for (let i = 1; i < resto.length; i++) if (dist(atual, resto[i]) < dist(atual, resto[iMin])) iMin = i;
    atual = resto.splice(iMin, 1)[0];
    rota.push(atual);
  }
  return rota;
}
export function comprimento(qd, rota, peDireito) {
  if (!qd || !rota.length) return 0;
  let L = 0, prev = qd;
  for (const e of rota) { L += dist(prev, e) * 1.2; prev = e; }
  return L + rota.reduce((s, e) => s + Math.abs(peDireito - e.altura), Math.abs(peDireito - qd.altura));
}

// ---------------------------------------------------------------- geometria da rede
function no(el, pav) { return { el, pav, circ: el.circuitoId || null, x: el.x, y: el.y, h: el.altura ?? 0, z: pav.cota + (el.altura ?? 0) }; }

// altura até a qual uma tomada (ou caixa) é "baixa" e pode ser ligada pelo piso
export const ALTURA_BAIXA = 1.3;
const ehQuadroNo = (n) => !!TIPOS[n.el.tipo]?.quadro;
// pelo piso: tomadas e caixas baixas; o quadro tem saída por cima (forro) e por baixo (piso)
const pelaBase = (n) => ehQuadroNo(n) || (['tug', 'tue', 'cp'].includes(n.el.tipo) && n.h <= ALTURA_BAIXA);

// nível do trecho entre dois pontos do mesmo pavimento: pelo piso quando os dois admitem (e a rota baixa
// é pelo piso); caso contrário pelo forro
export function nivelTrecho(a, b, rotaBaixa = 'piso') {
  return a.pav === b.pav && rotaBaixa === 'piso' && pelaBase(a) && pelaBase(b) && !(ehQuadroNo(a) && ehQuadroNo(b)) ? 'piso' : 'teto';
}

// comprimento do eletroduto entre dois pontos: ortogonal em planta; no mesmo pavimento sobe ao forro
// (ou desce ao piso) e vai até o outro ponto; entre pavimentos, prumada
export function distConduto(a, b, rotaBaixa = 'teto') {
  const plano = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  if (a.pav === b.pav) {
    if (nivelTrecho(a, b, rotaBaixa) === 'piso') return plano + a.h + b.h;
    const teto = a.pav.peDireito - 0.1;
    return plano + Math.max(0, teto - a.h) + Math.max(0, teto - b.h);
  }
  return plano + Math.abs(a.z - b.z);
}

// curvas de 90° de um trecho: a mudança de direção em planta e cada subida/descida da laje até a caixa
export function curvasTrecho(a, b, nivel) {
  const dx = Math.abs(a.x - b.x) > 0.05, dy = Math.abs(a.y - b.y) > 0.05;
  let n = dx && dy ? 1 : 0;
  if (a.pav !== b.pav) return n + (dx || dy ? 2 : 0);
  const teto = a.pav.peDireito - 0.1;
  const dobra = (p) => (nivel === 'piso' ? p.h > 0.05 : p.h < teto - 0.3);
  if ((dx || dy) && dobra(a)) n++;
  if ((dx || dy) && dobra(b)) n++;
  return n;
}

// fator de custo para ligar pontos de circuitos diferentes: incentiva cada circuito a seguir pelo
// próprio eletroduto (menos agrupamento e eletrodutos menores), saindo do quadro quando compensa
export const PENALIDADE_CIRCUITOS = 1.6;
function custoLigacao(a, b, ctx) {
  // eletroduto lançado à mão: o traçado passa por ele
  if (ctx.manuais.has(`${a.el.id}|${b.el.id}`)) return 1e-3;
  let d = distConduto(a, b, ctx.rotaBaixa);
  // entre pavimentos, a prumada passa preferencialmente por caixas de passagem
  if (a.pav !== b.pav && a.el.tipo !== 'cp' && b.el.tipo !== 'cp' && ctx.temCp) d *= 2.5;
  if (!a.circ || !b.circ || a.circ === b.circ) return d;
  // circuito com eletroduto exclusivo só se liga a pontos dele mesmo (ou ao quadro)
  if (a.excl || b.excl) return Infinity;
  return d * PENALIDADE_CIRCUITOS;
}

function arvoreMinima(raiz, nos, ctx) {
  // Prim O(n²)
  const todos = [raiz, ...nos];
  const n = todos.length;
  const dentro = new Array(n).fill(false);
  const melhor = new Array(n).fill(Infinity);
  const pai = new Array(n).fill(-1);
  melhor[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!dentro[i] && (u < 0 || melhor[i] < melhor[u])) u = i;
    dentro[u] = true;
    for (let v = 0; v < n; v++) {
      if (dentro[v]) continue;
      const d = custoLigacao(todos[u], todos[v], ctx);
      if (d < melhor[v]) { melhor[v] = d; pai[v] = u; }
    }
  }
  for (const t of todos) t.filhos = [];
  for (let i = 1; i < n; i++) {
    const t = todos[i], p = todos[pai[i]];
    t.pai = p;
    t.nivel = nivelTrecho(p, t, ctx.rotaBaixa);
    t.comp = distConduto(t, p, ctx.rotaBaixa);
    t.manual = ctx.manuais.has(`${t.el.id}|${p.el.id}`);
    p.filhos.push(t);
  }
  const fila = [raiz];
  raiz.prof = 0;
  while (fila.length) { const t = fila.shift(); for (const f of t.filhos) { f.prof = t.prof + 1; fila.push(f); } }
  return todos;
}

function caminho(a, b) {
  // trechos (identificados pelo nó filho) entre dois nós da árvore
  const segs = [];
  while (a.prof > b.prof) { segs.push(a); a = a.pai; }
  while (b.prof > a.prof) { segs.push(b); b = b.pai; }
  while (a !== b) { segs.push(a, b); a = a.pai; b = b.pai; }
  return segs;
}

// ---------------------------------------------------------------- cálculo completo
export function calcularEletrica(projeto) {
  const cfg = configEletrica(projeto);
  const avisos = [];
  const alertas = new Map(); // id do elemento -> [{ nivel, texto }]
  const alerta = (el, nivel, texto) => { if (!el) return; if (!alertas.has(el.id)) alertas.set(el.id, []); alertas.get(el.id).push({ nivel, texto }); };

  const elPav = new Map();
  for (const pav of projeto.pavimentos) for (const e of pav.elementos) elPav.set(e, pav);
  const quadros = [];
  for (const pav of projeto.pavimentos) for (const e of pav.elementos) if (ehQuadro(e)) quadros.push(e);
  const quadroPorId = new Map(quadros.map((q) => [q.id, q]));
  const qds = quadros.filter((q) => q.tipo === 'qd');

  const pontosDe = new Map(projeto.circuitos.map((c) => [c.id, []]));
  for (const pav of projeto.pavimentos) {
    for (const e of pav.elementos) {
      if (TIPOS[e.tipo]?.disc !== 'ele' || ehQuadro(e) || e.tipo === 'cp') continue;
      if (e.circuitoId && pontosDe.has(e.circuitoId)) pontosDe.get(e.circuitoId).push(e);
      else if (e.circuitoId) alerta(e, 'erro', 'Circuito inexistente.');
    }
  }

  const quadroDe = new Map();
  for (const c of projeto.circuitos) {
    let q = c.quadroId ? quadroPorId.get(c.quadroId) : null;
    if (!q) {
      const p0 = pontosDe.get(c.id)[0];
      const pav = p0 ? elPav.get(p0) : null;
      q = (pav && pav.elementos.find((e) => e.tipo === 'qd')) || qds[0] || null;
    }
    quadroDe.set(c.id, q);
  }

  const ambienteDe = (e) => (elPav.get(e)?.ambientes || []).find((a) => dentroDe(a, e)) || null;

  // circuitos com eletroduto exclusivo: marcados no circuito ou TUE (padrão)
  const exclusivos = new Set(projeto.circuitos.filter((c) => c.exclusivo === true || (c.exclusivo !== false && c.tipo === 'TUE')).map((c) => c.id));

  // ---- rede de eletrodutos por quadro
  // eletrodutos lançados à mão (pares de elementos), nos dois sentidos
  const manuais = new Set();
  for (const pav of projeto.pavimentos) for (const m of pav.eletrodutos || []) { manuais.add(`${m.a}|${m.b}`); manuais.add(`${m.b}|${m.a}`); }
  const segmentos = [];
  const redePorQuadro = new Map(); // rede principal de cada quadro
  const redes = [];
  const redeDe = new Map(); // circuito -> rede
  const montarRede = (q, circs) => {
    const pts = circs.flatMap((c) => pontosDe.get(c.id));
    const raiz = no(q, elPav.get(q));
    // caixas de passagem dos pavimentos atendidos entram como nós; as que ficarem em ponta de rede são podadas
    const pavs = new Set([elPav.get(q), ...pts.map((e) => elPav.get(e))]);
    const cps = [...pavs].flatMap((pv) => pv.elementos.filter((e) => e.tipo === 'cp'));
    const nos = [...pts, ...cps].map((e) => no(e, elPav.get(e)));
    for (const t of nos) t.excl = !!(t.circ && exclusivos.has(t.circ));
    let todos;
    if (!pts.length) { raiz.filhos = []; raiz.prof = 0; todos = [raiz]; }
    else {
      todos = arvoreMinima(raiz, nos, { manuais, rotaBaixa: cfg.rotaBaixa, temCp: pavs.size > 1 && cps.length > 0 });
      let podou = true;
      while (podou) {
        podou = false;
        for (const t of todos) {
          if (t !== raiz && t.el.tipo === 'cp' && !t.filhos.length) {
            t.pai.filhos = t.pai.filhos.filter((f) => f !== t);
            todos = todos.filter((x) => x !== t);
            podou = true;
          }
        }
      }
    }
    const rede = { quadro: q, raiz, nos: todos, porEl: new Map(todos.map((t) => [t.el, t])) };
    redes.push(rede);
    for (const c of circs) redeDe.set(c.id, rede);
    return rede;
  };
  for (const q of qds) {
    const circs = projeto.circuitos.filter((c) => quadroDe.get(c.id) === q);
    // circuitos comuns compartilham a rede; com tomadas pelo piso, iluminação (forro) e força (piso) saem do quadro
    // em redes separadas; cada circuito exclusivo (TUE) tem eletroduto próprio, podendo usar as mesmas caixas
    const comuns = circs.filter((c) => !exclusivos.has(c.id));
    if (cfg.rotaBaixa === 'piso') {
      const forca = comuns.filter((c) => c.tipo !== 'ILUM');
      redePorQuadro.set(q, montarRede(q, comuns.filter((c) => c.tipo === 'ILUM')));
      if (forca.some((c) => pontosDe.get(c.id).length)) montarRede(q, forca);
    } else redePorQuadro.set(q, montarRede(q, comuns));
    for (const c of circs) if (exclusivos.has(c.id) && pontosDe.get(c.id).length) montarRede(q, [c]);
  }

  const polosDe = (c) => {
    if (c.polos) return Number(c.polos);
    if (c.tensao > cfg.tensaoFF) return 3;
    if (c.tensao === cfg.tensaoFF && cfg.tensaoFF !== cfg.tensaoFN) return 2;
    return 1;
  };

  const resultados = projeto.circuitos.map((c) => {
    const pontos = pontosDe.get(c.id);
    const q = quadroDe.get(c.id);
    const reserva = c.tipo === 'RESERVA';
    const potencia = reserva ? Number(c.potencia) || 0 : pontos.reduce((s, e) => s + (TIPOS[e.tipo].carga ? Number(e.potencia) || 0 : 0), 0);
    return { circuito: c, pontos, quadro: q, qd: q, rota: pontos, potencia, polos: polosDe(c), reserva, avisos: [], fases: [], trechos: [] };
  });
  const resPorId = new Map(resultados.map((r) => [r.circuito.id, r]));

  // ---- balanceamento de fases (maior carga primeiro, na fase menos carregada)
  for (const q of qds) {
    const fasesQ = ESQUEMAS[q.esquema || '2F+N'] || ESQUEMAS['2F+N'];
    const carga = Object.fromEntries(fasesQ.map((f) => [f, 0]));
    const rs = resultados.filter((r) => r.quadro === q).sort((a, b) => b.potencia - a.potencia);
    for (const r of rs) {
      if (r.polos > fasesQ.length) { r.avisos.push(`Circuito de ${r.polos} polos em quadro ${q.esquema || '2F+N'}.`); r.polos = fasesQ.length; }
      const pedido = r.circuito.fase && r.circuito.fase !== 'auto' ? r.circuito.fase.split('') : null;
      const fases = pedido && pedido.length === r.polos && pedido.every((f) => fasesQ.includes(f))
        ? pedido : [...fasesQ].sort((a, b) => carga[a] - carga[b]).slice(0, r.polos).sort();
      r.fases = fases;
      for (const f of fases) carga[f] += r.potencia / fases.length;
    }
  }

  // ---- condutores por trecho
  const segPorNo = new Map();
  for (const rede of redes) {
    const q = rede.quadro;
    for (const t of rede.nos) {
      if (t === rede.raiz) continue;
      const curvas = curvasTrecho(t.pai, t, t.nivel);
      const s = { quadro: q, de: t.pai, para: t, comp: t.comp, nivel: t.nivel, manual: t.manual, curvas, maxComp: cfg.trechoMax - 3 * curvas,
        circuitos: new Set(), condutoresDe: new Map(), retornos: new Map() };
      segPorNo.set(t, s);
      segmentos.push(s);
    }
    for (const r of resultados.filter((x) => redeDe.get(x.circuito.id) === rede)) {
      const sub = new Map(); // trecho -> passa carga (true) ou só comando (false)
      for (const p of r.pontos) {
        let t = rede.porEl.get(p);
        const soComando = ehComando(p);
        while (t && t !== rede.raiz) {
          const s = segPorNo.get(t);
          sub.set(s, sub.get(s) || !soComando);
          t = t.pai;
        }
      }
      r.trechos = [...sub.keys()];
      r.comprimento = r.trechos.reduce((a, s) => a + s.comp, 0) * 1.05;
      for (const [s, carga] of sub) {
        s.circuitos.add(r.circuito.id);
        s.condutoresDe.set(r.circuito.id, { fases: r.polos, neutro: carga && r.polos === 1 ? 1 : 0, terra: carga ? 1 : 0 });
      }
      const cargasCom = r.pontos.filter((p) => TIPOS[p.tipo].comandada);
      const comandos = r.pontos.filter((p) => ehComando(p) && p.tipo !== 'pulsador');
      for (const L of new Set(cargasCom.map((p) => p.comando).filter(Boolean))) {
        const k = `${r.circuito.id}:${L}`;
        const ss = comandos.filter((p) => (p.comandos || []).includes(L));
        for (const sw of ss) for (const lp of cargasCom.filter((p) => p.comando === L)) {
          const a = rede.porEl.get(sw), b = rede.porEl.get(lp);
          if (!a || !b) continue;
          for (const t of caminho(a, b)) { const s = segPorNo.get(t); s.retornos.set(k, Math.max(s.retornos.get(k) || 0, 1)); }
        }
        // paralelos e intermediários: dois condutores (travessias) entre eles
        const trav = ss.filter((p) => p.tipo === 'paralelo' || p.tipo === 'intermediario');
        for (let i = 0; i + 1 < trav.length; i++) {
          const a = rede.porEl.get(trav[i]), b = rede.porEl.get(trav[i + 1]);
          if (a && b) for (const t of caminho(a, b)) segPorNo.get(t).retornos.set(k, 2);
        }
      }
    }
  }

  // ---- dimensionamento dos circuitos
  const fTemp = fatorTemperatura(cfg.temperatura);
  for (const r of resultados) {
    const c = r.circuito;
    if (!r.quadro && !r.reserva && r.pontos.length) {
      r.avisos.push('Sem quadro (QD). Comprimento não calculado.');
      alerta(r.pontos[0], 'erro', 'Circuito sem quadro de distribuição.');
    }
    if (!r.pontos.length && !r.reserva) r.avisos.push('Circuito sem pontos.');
    r.comprimento ||= 0;
    r.agrupamento = Math.max(1, ...r.trechos.map((s) => s.circuitos.size));
    r.fAgr = fatorAgrupamento(r.agrupamento);
    const tensaoRef = r.polos === 1 ? cfg.tensaoFN : cfg.tensaoFF;
    r.tensao = tensaoRef;
    if (r.reserva) {
      Object.assign(r, { ib: r.potencia / tensaoRef, secao: null, disjuntor: null, queda: null, ok: true, iz: null });
      continue;
    }
    const d = dimensionar({ potencia: r.potencia, tensao: tensaoRef, comprimentoM: r.comprimento, grupo: c.tipo, polos: r.polos, fAgr: r.fAgr, fTemp, quedaMax: cfg.quedaMax, secaoMin: c.secaoMin, secaoFixa: c.secaoFixa });
    Object.assign(r, d, { avisos: [...r.avisos, ...d.avisos] });
    if (c.tipo === 'TUE' && r.pontos.filter((p) => TIPOS[p.tipo].carga).length > 1) {
      r.avisos.push('TUE deve ter circuito exclusivo (1 ponto).');
      for (const p of r.pontos.slice(1)) alerta(p, 'aviso', 'TUE em circuito compartilhado.');
    }
    if (c.tipo === 'TUG' && r.ib > 16) r.avisos.push(`Corrente de ${r.ib.toFixed(1)} A, alta para um circuito de TUG. Divida o circuito.`);
    // DR obrigatório (NBR 5410 5.1.3.2.2): locais com chuveiro/banheira, cozinhas, áreas de
    // serviço, externas e garagens; iluminação a 2,50 m ou mais de altura é dispensada
    const motivo = r.pontos.map((p) => ({ p, a: ambienteDe(p) })).find(({ p, a }) => a && AMBIENTES[a.tipo]?.dr && !(TIPOS[p.tipo].grupo === 'ILUM' && p.altura >= 2.5));
    r.drObrigatorio = !!motivo;
    r.drMotivo = motivo ? `${AMBIENTES[motivo.a.tipo].nome.toLowerCase()} (${motivo.a.nome})` : '';
    r.dr = c.dr === 'sim' || (c.dr !== 'nao' && r.drObrigatorio);
    if (r.drObrigatorio && c.dr === 'nao') {
      r.avisos.push(`DR obrigatório: atende ${r.drMotivo}.`);
      alerta(motivo.p, 'aviso', 'Circuito sem DR em local onde ele é obrigatório.');
    }
    if (!r.ok && r.pontos[0]) alerta(r.pontos[0], 'erro', `${c.nome}: ${d.avisos[0]}`);
  }

  // ---- seção dos condutores e eletroduto de cada trecho
  for (const s of segmentos) {
    s.condutores = [];
    for (const [cid, k] of s.condutoresDe) {
      const sec = resPorId.get(cid).secao || 2.5;
      for (let i = 0; i < k.fases; i++) s.condutores.push({ circuito: cid, tipo: 'F', secao: sec });
      if (k.neutro) s.condutores.push({ circuito: cid, tipo: 'N', secao: sec });
      if (k.terra) s.condutores.push({ circuito: cid, tipo: 'T', secao: sec });
    }
    for (const [k, n] of s.retornos) {
      const [cid, letra] = k.split(':');
      const sec = resPorId.get(cid)?.secao || 1.5;
      for (let i = 0; i < n; i++) s.condutores.push({ circuito: cid, tipo: 'R', secao: sec, comando: letra });
    }
    const ocupada = s.condutores.reduce((a, c) => a + (AREA_CABO[c.secao] || 10), 0);
    const taxa = s.condutores.length <= 1 ? 0.53 : s.condutores.length === 2 ? 0.31 : cfg.ocupacaoMax;
    const e = ELETRODUTOS.find(([dn, di]) => dn >= cfg.diametroMin && ocupada <= taxa * area(di)) || ELETRODUTOS[ELETRODUTOS.length - 1];
    s.dn = e[0];
    s.areaUtil = area(e[1]);
    s.areaOcupada = ocupada;
    s.ocupacao = ocupada / area(e[1]);
    s.taxaMax = taxa;
    s.cont = { F: 0, N: 0, T: 0, R: 0 };
    for (const c of s.condutores) s.cont[c.tipo]++;
    // NBR 5410 6.2.11.1.6: trecho contínuo sem caixa até 15 m, menos 3 m por curva; no máximo 3 curvas
    if (s.curvas > 3 || s.comp > s.maxComp + 1e-6) {
      s.excede = true;
      const txt = s.curvas > 3 ? `Trecho com ${s.curvas} curvas (máximo 3): insira uma caixa de passagem.`
        : `Trecho de ${s.comp.toFixed(1)} m com ${s.curvas} curva(s); máximo ${s.maxComp.toFixed(0)} m sem caixa. Insira uma caixa de passagem.`;
      alerta(s.para.el, 'aviso', txt);
    }
  }
  const trechosLongos = segmentos.filter((s) => s.excede).length;
  if (trechosLongos) avisos.push({ nivel: 'aviso', texto: `${trechosLongos} trecho(s) de eletroduto acima do comprimento máximo entre caixas (NBR 5410 6.2.11.1.6).` });

  // ---- quadros: carga por fase, demanda, reservas, DR, módulos
  const resQuadro = new Map();
  const calcQuadro = (q, pilha = new Set()) => {
    if (resQuadro.has(q)) return resQuadro.get(q);
    if (pilha.has(q)) return null; // hierarquia circular
    pilha.add(q);
    const rs = resultados.filter((r) => r.quadro === q);
    const esquema = q.esquema || (q.tipo === 'qd' ? '2F+N' : '3F+N');
    const fasesQ = ESQUEMAS[esquema] || ESQUEMAS['2F+N'];
    const fases = Object.fromEntries(fasesQ.map((f) => [f, 0]));
    for (const r of rs) for (const f of r.fases) if (f in fases) fases[f] += r.potencia / r.fases.length;
    const instalada = rs.reduce((a, r) => a + r.potencia, 0);
    const ilumTug = rs.filter((r) => r.circuito.tipo !== 'TUE').reduce((a, r) => a + r.potencia, 0);
    const tues = rs.filter((r) => r.circuito.tipo === 'TUE');
    const dIT = ilumTug * fdIlumTug(ilumTug / 1000);
    const dTUE = tues.reduce((a, r) => a + r.potencia, 0) * fdTue(tues.length);
    const filhos = quadros.filter((x) => x.alimentadoPor === q.id && x !== q).map((x) => calcQuadro(x, pilha)).filter(Boolean);
    // carga de demanda por fase: própria rateada pelo fator do quadro + a dos quadros a jusante
    const fatorProprio = instalada ? (dIT + dTUE) / instalada : 1;
    const fasesDem = Object.fromEntries(Object.entries(fases).map(([k, v]) => [k, v * fatorProprio]));
    for (const f of filhos) {
      for (const k of Object.keys(fases)) {
        fases[k] += f.fases[k] || 0;
        fasesDem[k] += f.fasesDem[k] || 0;
      }
    }
    const demanda = dIT + dTUE + filhos.reduce((a, f) => a + f.demanda, 0);
    const instaladaTotal = instalada + filhos.reduce((a, f) => a + f.instaladaTotal, 0);
    const valores = Object.values(fases);
    const maxF = Math.max(...valores), minF = Math.min(...valores);
    const deseq = maxF > 0 && valores.length > 1 ? (maxF - minF) / maxF : 0;
    const efetivos = rs.filter((r) => !r.reserva).length;
    const reservas = rs.filter((r) => r.reserva).length;
    const reservasMin = q.tipo !== 'qd' || !efetivos ? 0 : efetivos <= 6 ? 2 : efetivos <= 12 ? 3 : efetivos <= 30 ? 4 : Math.ceil(efetivos * 0.15);
    // grupos de DR: até 4 circuitos por dispositivo
    const comDr = rs.filter((r) => r.dr && !r.reserva);
    const drGrupos = [];
    for (let i = 0; i < comDr.length; i += 4) {
      const g = comDr.slice(i, i + 4);
      const base = Math.max(...g.map((r) => r.disjuntor || 0), g.reduce((a, r) => a + (r.ib || 0), 0));
      const nominal = DR_NOMINAIS.find((n) => n >= base) || DR_NOMINAIS[DR_NOMINAIS.length - 1];
      const polos = g.some((r) => r.polos === 3) || new Set(g.flatMap((r) => r.fases)).size > 2 ? 4 : 2;
      drGrupos.push({ circuitos: g.map((r) => r.circuito.id), nominal, polos });
      for (const r of g) r.drGrupo = drGrupos.length;
    }
    const dps = q.tipo === 'qd' && q.dps !== false;
    const modulos = rs.reduce((a, r) => a + (r.reserva ? 1 : r.polos), 0) + fasesQ.length + drGrupos.reduce((a, g) => a + g.polos, 0) + (dps ? fasesQ.length + 1 : 0);
    const res = {
      quadro: q, pav: elPav.get(q), esquema, fasesQ, fases, fasesDem, instalada, instaladaTotal, dIT, dTUE, demanda, deseq,
      circuitos: rs, reservas, reservasMin, drGrupos, dps, modulos,
      tamanho: Number(q.modulosPeca) || MODULOS_QD.find((m) => m >= modulos * 1.2) || MODULOS_QD[MODULOS_QD.length - 1], filhos: filhos.map((f) => f.quadro),
    };
    if (q.modulosPeca && modulos > Number(q.modulosPeca)) {
      res.excedePeca = true;
      alerta(q, 'erro', `Quadro com mais módulos (${modulos}) do que a peça comporta (${q.modulosPeca}). Escolha um quadro maior.`);
    }
    resQuadro.set(q, res);
    return res;
  };
  for (const q of quadros) calcQuadro(q);

  // ---- alimentadores e disjuntor geral
  const alimentadores = [];
  const temMedicao = quadros.some((x) => x.tipo === 'qm' || x.tipo === 'es');
  for (const [q, rq] of resQuadro) {
    const nF = rq.fasesQ.length;
    // corrente de projeto do alimentador: fase mais carregada em demanda
    const ib = Math.max(0, ...Object.values(rq.fasesDem)) / cfg.tensaoFN;
    const pai = q.alimentadoPor ? quadroPorId.get(q.alimentadoPor) : null;
    const L = pai ? distConduto(no(pai, elPav.get(pai)), no(q, elPav.get(q))) * 1.1 + 2 : 0;
    const d = dimensionar({
      potencia: ib * cfg.tensaoFN, tensao: cfg.tensaoFN, comprimentoM: L, grupo: 'TUE', polos: 1, fTemp,
      quedaMax: pai ? cfg.quedaAlim : 100, secaoMin: 6,
    });
    d.carregados = nF === 1 ? 2 : 3;
    rq.alimentador = { pai, L, ...d, ib, condutores: `${nF}F+N+T` };
    rq.disjuntorGeral = d.disjuntor;
    if (pai) alimentadores.push({ de: pai, para: q, ...rq.alimentador });
    const nome = nomeQuadro(q, projeto);
    if (!d.ok && rq.demanda > 0) avisos.push({ nivel: 'erro', texto: `${nome}: alimentador sem solução (${d.avisos[0]})` });
    if (rq.reservas < rq.reservasMin) {
      avisos.push({ nivel: 'aviso', texto: `${nome}: ${rq.reservas} reserva(s); a NBR 5410 pede ${rq.reservasMin} para ${rq.circuitos.length - rq.reservas} circuitos.` });
      alerta(q, 'aviso', `Faltam ${rq.reservasMin - rq.reservas} circuito(s) reserva.`);
    }
    if (rq.excedePeca) avisos.push({ nivel: 'erro', texto: `${nome}: ${rq.modulos} módulos não cabem na peça de ${q.modulosPeca} módulos.` });
    if (rq.deseq > 0.15 && rq.instalada > 2000) {
      avisos.push({ nivel: 'aviso', texto: `${nome}: desequilíbrio de fases de ${(rq.deseq * 100).toFixed(0)}%.` });
      alerta(q, 'aviso', `Fases desequilibradas (${(rq.deseq * 100).toFixed(0)}%).`);
    }
    if (q.tipo === 'qd' && !pai && temMedicao) {
      avisos.push({ nivel: 'aviso', texto: `${nome}: sem alimentação definida (associe a um quadro de medição).` });
      alerta(q, 'aviso', 'Quadro sem alimentador: defina "Alimentado por".');
    }
  }

  // ---- comandos (interruptores e lâmpadas)
  for (const r of resultados) {
    const cargasCom = r.pontos.filter((p) => TIPOS[p.tipo].comandada);
    const comandos = r.pontos.filter((p) => ehComando(p) && p.tipo !== 'pulsador');
    for (const p of cargasCom) {
      if (!p.comando) alerta(p, 'aviso', 'Comando indefinido (sem interruptor).');
      else if (!comandos.some((s) => (s.comandos || []).includes(p.comando))) alerta(p, 'aviso', `Nenhum interruptor aciona o comando "${p.comando}".`);
    }
    for (const s of comandos) {
      for (const L of s.comandos || []) if (!cargasCom.some((p) => p.comando === L)) alerta(s, 'aviso', `Comando "${L}" não aciona nenhuma carga.`);
      if (!(s.comandos || []).length) alerta(s, 'aviso', 'Interruptor sem comando.');
    }
    for (const L of new Set(cargasCom.map((p) => p.comando).filter(Boolean))) {
      const ss = comandos.filter((s) => (s.comandos || []).includes(L));
      const par = ss.filter((s) => s.tipo === 'paralelo').length, inter = ss.filter((s) => s.tipo === 'intermediario').length;
      if (inter && par < 2) r.avisos.push(`Comando "${L}": intermediário exige dois paralelos.`);
      if (par === 1) r.avisos.push(`Comando "${L}": paralelo sozinho; use dois paralelos ou um simples.`);
    }
  }

  // ---- pontos sem circuito / pavimentos sem quadro
  for (const pav of projeto.pavimentos) {
    const semCirc = pav.elementos.filter((e) => TIPOS[e.tipo]?.disc === 'ele' && !ehQuadro(e) && e.tipo !== 'cp' && !e.circuitoId);
    for (const e of semCirc) alerta(e, 'erro', 'Circuito indefinido.');
    if (semCirc.length) avisos.push({ nivel: 'aviso', texto: `${pav.nome}: ${semCirc.length} ponto(s) sem circuito.` });
    const temEle = pav.elementos.some((e) => TIPOS[e.tipo]?.disc === 'ele' && !ehQuadro(e));
    if (temEle && !qds.length) avisos.push({ nivel: 'aviso', texto: `${pav.nome}: nenhum quadro de distribuição.` });
  }
  for (const r of resultados) for (const a of r.avisos) avisos.push({ nivel: r.ok === false ? 'erro' : 'aviso', texto: `${r.circuito.nome}: ${a}` });

  // ---- ambientes: mínimos da NBR 5410
  const verifAmb = [];
  for (const pav of projeto.pavimentos) {
    for (const a of pav.ambientes || []) {
      const v = verificarAmbiente(a, pav.elementos);
      verifAmb.push({ pav, ambiente: a, ...v });
      for (const t of v.faltas) avisos.push({ nivel: 'aviso', texto: `${pav.nome} / ${a.nome}: ${t}` });
      if (v.faltas.length) alerta(a, 'aviso', v.faltas.join(' '));
    }
  }

  // ---- centro de cargas por pavimento
  const centros = projeto.pavimentos.map((pav) => {
    let P = 0, sx = 0, sy = 0;
    for (const e of pav.elementos) if (TIPOS[e.tipo]?.disc === 'ele' && TIPOS[e.tipo].carga) { const w = Number(e.potencia) || 0; P += w; sx += w * e.x; sy += w * e.y; }
    return { pav, P, x: P ? sx / P : null, y: P ? sy / P : null };
  });

  return { cfg, circuitos: resultados, quadros: [...resQuadro.values()], segmentos, alimentadores, alertas, avisos, ambientes: verifAmb, centros, redePorQuadro, redes };
}

export function nomeQuadro(q, projeto) {
  if (q.descricao) return q.descricao;
  const mesmo = [];
  for (const p of projeto.pavimentos) for (const e of p.elementos) if (e.tipo === q.tipo) mesmo.push(e);
  return `${TIPOS[q.tipo].sigla}${mesmo.indexOf(q) + 1}`;
}

// ---------------------------------------------------------------- ambientes (NBR 5410 9.5.2)
export function dentroDe(a, e, folga = 0.2) {
  return e.x >= a.x1 - folga && e.x <= a.x2 + folga && e.y >= a.y1 - folga && e.y <= a.y2 + folga;
}
export function minimosAmbiente(a) {
  const C = a.x2 - a.x1, L = a.y2 - a.y1;
  const A = C * L, P = 2 * (C + L);
  const ilum = A <= 6 ? 100 : 100 + 60 * Math.floor((A - 6) / 4);
  const regra = AMBIENTES[a.tipo]?.tomadas || 'outros';
  let tug;
  let potTug;
  if (regra === 'banheiro') { tug = 1; potTug = [600]; }
  else if (regra === 'molhada') { tug = Math.ceil(P / 3.5 - 1e-9); potTug = Array.from({ length: tug }, (_, i) => (i < 3 ? 600 : 100)); }
  else if (regra === 'varanda') { tug = 1; potTug = [100]; }
  else if (regra === 'perimetro5') { tug = Math.max(1, Math.ceil(P / 5 - 1e-9)); potTug = Array(tug).fill(100); }
  else { tug = A <= 6 ? 1 : Math.ceil(P / 5 - 1e-9); potTug = Array(tug).fill(100); }
  return { A, P, ilum, tug, potTug };
}
export function verificarAmbiente(a, elementos) {
  const m = minimosAmbiente(a);
  const dentro = elementos.filter((e) => TIPOS[e.tipo]?.disc === 'ele' && dentroDe(a, e));
  const ilum = dentro.filter((e) => TIPOS[e.tipo].grupo === 'ILUM' && TIPOS[e.tipo].carga && e.tipo !== 'campainha').reduce((s, e) => s + (Number(e.potencia) || 0), 0);
  const pontosLuz = dentro.filter((e) => e.tipo === 'luz' || e.tipo === 'ventilador').length;
  const tug = dentro.filter((e) => e.tipo === 'tug').reduce((s, e) => s + 1, 0);
  const faltas = [];
  if (!pontosLuz) faltas.push('sem ponto de luz no teto.');
  if (ilum < m.ilum) faltas.push(`iluminação ${ilum} VA (mínimo ${m.ilum} VA).`);
  if (tug < m.tug) faltas.push(`${tug} TUG (mínimo ${m.tug}).`);
  return { ...m, ilumInstalada: ilum, tugInstaladas: tug, pontosLuz, faltas };
}

// ---------------------------------------------------------------- compatibilidade / relatórios
export function calcularProjeto(projeto) {
  const calc = calcularEletrica(projeto);
  const r = calc.circuitos;
  r.calc = calc;
  return r;
}

export function verificacoes(projeto, resultados) {
  const calc = resultados?.calc || calcularEletrica(projeto);
  const out = calc.avisos.slice();
  if (!out.length) out.push({ nivel: 'ok', texto: 'Nenhum problema encontrado.' });
  return out;
}

export function listaMateriais(projeto, entrada) {
  const calc = entrada?.calc || (entrada?.segmentos ? entrada : calcularEletrica(projeto));
  const itens = new Map();
  const add = (desc, un, q) => {
    if (!q) return;
    const k = desc + '|' + un;
    itens.set(k, { desc, un, qtd: Math.round(((itens.get(k)?.qtd || 0) + q) * 10) / 10 });
  };
  const CAIXA = { oct: 'Caixa octogonal 4x4"', '4x2': 'Caixa 4x2"', cp: 'Caixa de passagem 10x10 cm' };
  const resPorId = new Map(calc.circuitos.map((r) => [r.circuito.id, r]));
  for (const pav of projeto.pavimentos) {
    for (const e of pav.elementos) {
      const t = TIPOS[e.tipo];
      if (t?.disc !== 'ele') continue;
      if (t.caixa && !e.mesmaCaixa) add(CAIXA[t.caixa], 'pç', 1);
      const r = resPorId.get(e.circuitoId);
      const teclas = Math.max(1, (e.comandos || []).length);
      if (e.tipo === 'luz' || e.tipo === 'arandela') add(`Luminária com lâmpada LED ${e.potencia} W`, 'pç', 1);
      if (e.tipo === 'ventilador') add('Ventilador de teto', 'pç', 1);
      if (e.tipo === 'tug') add('Tomada 2P+T 10 A', 'pç', e.dupla ? 2 : 1);
      if (e.tipo === 'tue') {
        if ((Number(e.potencia) || 0) >= 4000) add('Conector para ligação direta de equipamento', 'pç', 1);
        else add(r?.polos === 3 ? 'Tomada 3P+T 20 A' : 'Tomada 2P+T 20 A', 'pç', 1);
      }
      if (e.tipo === 'interruptor') add(`Interruptor simples ${teclas} tecla(s)`, 'pç', 1);
      if (e.tipo === 'paralelo') add(`Interruptor paralelo ${teclas} tecla(s)`, 'pç', 1);
      if (e.tipo === 'intermediario') add('Interruptor intermediário', 'pç', 1);
      if (e.tipo === 'dimmer') add('Dimmer rotativo', 'pç', 1);
      if (e.tipo === 'sensor') add('Sensor de presença de teto', 'pç', 1);
      if (e.tipo === 'pulsador') add('Pulsador de campainha', 'pç', 1);
      if (e.tipo === 'campainha') add('Campainha', 'pç', 1);
      if (e.tipo === 'es') add('Entrada de serviço (padrão da concessionária)', 'cj', 1);
      if (e.tipo === 'qm') add('Caixa de medição', 'pç', 1);
      if (e.tipo === 'tug' && e.comInterruptor) add('Interruptor simples 1 tecla (conjugado)', 'pç', 1);
    }
  }
  const COR = { F: 'fase', N: 'neutro (azul)', T: 'proteção (verde)', R: 'retorno' };
  for (const s of calc.segmentos) {
    for (const c of s.condutores) add(`Cabo de cobre 750 V ${fmtSec(c.secao)} mm² — ${COR[c.tipo]}`, 'm', s.comp * 1.1);
    add(`${calc.cfg?.material || 'Eletroduto corrugado PVC'} DN ${s.dn}`, 'm', s.comp * 1.05);
    add(`Curva 90° DN ${s.dn}`, 'pç', /corrugado|calha/i.test(calc.cfg?.material || 'corrugado') ? 0 : s.curvas);
  }
  for (const a of calc.alimentadores) {
    if (!a.secao) continue;
    const n = Number(a.condutores[0]) || 1;
    add(`Cabo de cobre 0,6/1 kV ${fmtSec(a.secao)} mm² — alimentador fase`, 'm', a.L * n);
    add(`Cabo de cobre 0,6/1 kV ${fmtSec(a.secao)} mm² — alimentador neutro`, 'm', a.L);
    add(`Cabo de cobre 750 V ${fmtSec(a.secao > 16 ? a.secao / 2 : a.secao)} mm² — alimentador proteção`, 'm', a.L);
  }
  for (const q of calc.quadros) {
    if (q.quadro.tipo !== 'qd') continue;
    add(`Quadro de distribuição de embutir ${q.tamanho} módulos DIN`, 'pç', 1);
    if (q.disjuntorGeral) add(`Disjuntor ${q.fasesQ.length}P ${q.disjuntorGeral} A curva C (geral)`, 'pç', 1);
    for (const g of q.drGrupos) add(`Interruptor DR ${g.polos}P ${g.nominal} A 30 mA`, 'pç', 1);
    if (q.dps) add('DPS classe II 275 V 20 kA', 'pç', q.fasesQ.length + 1);
    for (const r of q.circuitos) if (!r.reserva && r.disjuntor) add(`Disjuntor ${r.polos}P ${r.disjuntor} A curva C`, 'pç', 1);
  }
  return [...itens.values()].filter((i) => i.qtd > 0).sort((a, b) => a.desc.localeCompare(b.desc, 'pt-BR'));
}
