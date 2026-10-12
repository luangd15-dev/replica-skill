// Dimensionamento simplificado de circuitos de baixa tensão (referência: NBR 5410).
// Cobre: corrente de projeto, seção por capacidade de condução (método B1, cobre/PVC,
// 2 condutores carregados), seção mínima, disjuntor e queda de tensão.

import { TIPOS } from './tipos.js';
export { TIPOS };

// seção (mm²) -> capacidade de condução (A), método B1, PVC 70 °C, 2 condutores carregados
export const CAPACIDADE = [
  [1.5, 17.5], [2.5, 24], [4, 32], [6, 41], [10, 57], [16, 76], [25, 101], [35, 125], [50, 151],
];
export const DISJUNTORES = [10, 16, 20, 25, 32, 40, 50, 63, 70, 80, 100, 125];
const RHO_COBRE = 0.0172; // Ω·mm²/m
export const QUEDA_MAX = 4; // % (circuitos terminais)

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Caminho do QD passando por todos os pontos do circuito (vizinho mais próximo).
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

// Comprimento do circuito em metros: rota em planta com fator de 20% para desvios,
// mais as descidas/subidas verticais até cada ponto.
export function comprimento(qd, rota, peDireito) {
  if (!qd || !rota.length) return 0;
  let L = 0;
  let prev = qd;
  for (const e of rota) {
    L += dist(prev, e) * 1.2;
    prev = e;
  }
  const vertical = rota.reduce((s, e) => s + Math.abs(peDireito - e.altura), Math.abs(peDireito - qd.altura));
  return L + vertical;
}

export function dimensionar({ potencia, tensao, comprimentoM, grupo }) {
  const ib = tensao > 0 ? potencia / tensao : 0;
  const secMin = grupo === 'ILUM' ? 1.5 : 2.5;
  const avisos = [];
  for (const [secao, iz] of CAPACIDADE) {
    if (secao < secMin) continue;
    const disj = DISJUNTORES.find((d) => d >= ib && d <= iz);
    if (!disj) continue;
    const queda = tensao > 0 ? ((2 * RHO_COBRE * comprimentoM * ib) / (secao * tensao)) * 100 : 0;
    if (queda > QUEDA_MAX) continue;
    return { ib, secao, iz, disjuntor: disj, queda, avisos, ok: true };
  }
  avisos.push('Nenhuma combinação de cabo e disjuntor atende. Divida o circuito.');
  return { ib, secao: null, iz: null, disjuntor: null, queda: null, avisos, ok: false };
}

// Calcula todos os circuitos do projeto. Um circuito pertence ao QD do pavimento
// onde estão seus pontos (primeiro QD encontrado).
export function calcularProjeto(projeto) {
  const resultados = [];
  for (const c of projeto.circuitos) {
    const pontos = [];
    let qd = null;
    let peDireito = 2.8;
    for (const pav of projeto.pavimentos) {
      const doCircuito = pav.elementos.filter((e) => e.circuitoId === c.id);
      if (doCircuito.length) {
        pontos.push(...doCircuito);
        qd = qd || pav.elementos.find((e) => e.tipo === 'qd') || null;
        peDireito = pav.peDireito;
      }
    }
    const potencia = pontos.reduce((s, e) => s + (Number(e.potencia) || 0), 0);
    const rota = qd ? rotaCircuito(qd, pontos) : pontos;
    const L = qd ? comprimento(qd, rota, peDireito) : 0;
    const r = dimensionar({ potencia, tensao: c.tensao, comprimentoM: L, grupo: c.tipo });
    if (!qd && pontos.length) r.avisos.push('Sem quadro (QD) no pavimento. Comprimento não calculado.');
    if (!pontos.length) r.avisos.push('Circuito sem pontos.');
    resultados.push({ circuito: c, pontos, potencia, comprimento: L, rota, qd, ...r });
  }
  return resultados;
}

export function verificacoes(projeto, resultados) {
  const out = [];
  for (const pav of projeto.pavimentos) {
    const semCirc = pav.elementos.filter((e) => TIPOS[e.tipo]?.disc === 'ele' && e.tipo !== 'qd' && e.tipo !== 'interruptor' && !e.circuitoId);
    if (semCirc.length) out.push({ nivel: 'aviso', texto: `${pav.nome}: ${semCirc.length} ponto(s) sem circuito.` });
    const qds = pav.elementos.filter((e) => e.tipo === 'qd').length;
    if (pav.elementos.some((e) => TIPOS[e.tipo]?.disc === 'ele') && !qds) out.push({ nivel: 'aviso', texto: `${pav.nome}: nenhum quadro de distribuição.` });
  }
  for (const r of resultados) {
    for (const a of r.avisos) out.push({ nivel: r.ok ? 'aviso' : 'erro', texto: `${r.circuito.nome}: ${a}` });
    if (r.circuito.tipo === 'TUE' && r.pontos.length > 1)
      out.push({ nivel: 'aviso', texto: `${r.circuito.nome}: TUE deve ter circuito exclusivo (1 ponto).` });
    if (r.circuito.tipo === 'TUG' && r.ib > 16)
      out.push({ nivel: 'aviso', texto: `${r.circuito.nome}: corrente de ${r.ib.toFixed(1)} A, alta para um circuito de TUG. Divida o circuito.` });
  }
  if (!out.length) out.push({ nivel: 'ok', texto: 'Nenhum problema encontrado.' });
  return out;
}

export function listaMateriais(projeto, resultados) {
  const itens = new Map();
  const add = (desc, un, q) => {
    const k = desc + '|' + un;
    itens.set(k, { desc, un, qtd: (itens.get(k)?.qtd || 0) + q });
  };
  for (const pav of projeto.pavimentos) {
    for (const e of pav.elementos) {
      if (e.tipo === 'luz') { add('Caixa octogonal 4x4"', 'pç', 1); add('Ponto de luz (receptáculo)', 'pç', 1); }
      if (e.tipo === 'tug') { add('Caixa 4x2"', 'pç', 1); add('Tomada 2P+T 10 A', 'pç', 1); }
      if (e.tipo === 'tue') { add('Caixa 4x2"', 'pç', 1); add('Tomada 2P+T 20 A', 'pç', 1); }
      if (e.tipo === 'interruptor') { add('Caixa 4x2"', 'pç', 1); add('Interruptor simples', 'pç', 1); }
      if (e.tipo === 'qd') add('Quadro de distribuição de embutir', 'pç', 1);
    }
  }
  for (const r of resultados) {
    if (!r.ok || !r.comprimento) continue;
    const L = Math.ceil(r.comprimento);
    add(`Cabo de cobre 750 V ${fmtSec(r.secao)} mm² (fase/neutro/terra)`, 'm', L * 3);
    add('Eletroduto corrugado 3/4"', 'm', L);
    add(`Disjuntor monopolar ${r.disjuntor} A`, 'pç', 1);
  }
  return [...itens.values()].sort((a, b) => a.desc.localeCompare(b.desc, 'pt-BR'));
}

export function fmtSec(s) {
  return s == null ? '-' : String(s).replace('.', ',');
}
