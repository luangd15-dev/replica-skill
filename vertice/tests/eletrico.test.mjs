import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionar, rotaCircuito, comprimento, calcularProjeto, listaMateriais, verificacoes } from '../src/eletrico.js';

test('chuveiro 5500 W em 220 V pede 4 mm² e disjuntor 25 A', () => {
  const r = dimensionar({ potencia: 5500, tensao: 220, comprimentoM: 14, grupo: 'TUE' });
  assert.equal(r.ib, 25);
  assert.equal(r.secao, 4);
  assert.equal(r.disjuntor, 25);
  assert.ok(r.queda < 4);
});

test('respeita seção mínima por tipo de circuito', () => {
  assert.equal(dimensionar({ potencia: 200, tensao: 127, comprimentoM: 10, grupo: 'ILUM' }).secao, 1.5);
  assert.equal(dimensionar({ potencia: 200, tensao: 127, comprimentoM: 10, grupo: 'TUG' }).secao, 2.5);
});

test('circuito longo aumenta a seção por queda de tensão', () => {
  const curto = dimensionar({ potencia: 1800, tensao: 127, comprimentoM: 10, grupo: 'TUG' });
  const longo = dimensionar({ potencia: 1800, tensao: 127, comprimentoM: 60, grupo: 'TUG' });
  assert.ok(longo.secao > curto.secao);
  assert.ok(longo.queda <= 4);
});

test('carga impossível é reportada sem disjuntor', () => {
  const r = dimensionar({ potencia: 50000, tensao: 127, comprimentoM: 30, grupo: 'TUE' });
  assert.equal(r.ok, false);
  assert.equal(r.disjuntor, null);
});

test('rota passa por todos os pontos, do mais próximo ao mais distante', () => {
  const qd = { x: 0, y: 0, altura: 1.5 };
  const pts = [{ x: 5, y: 0, altura: 0.3 }, { x: 1, y: 0, altura: 0.3 }, { x: 3, y: 0, altura: 0.3 }];
  const rota = rotaCircuito(qd, pts);
  assert.deepEqual(rota.map((p) => p.x), [1, 3, 5]);
  // 5 m em planta × 1,2 + descidas: |2,8-1,5| + 3 × |2,8-0,3|
  assert.equal(comprimento(qd, rota, 2.8).toFixed(2), (6 + 1.3 + 7.5).toFixed(2));
});

test('projeto: pontos sem circuito e falta de QD aparecem nas verificações', () => {
  const projeto = {
    circuitos: [{ id: 'C1', numero: 1, nome: 'C1', tipo: 'TUG', tensao: 127 }],
    pavimentos: [{ nome: 'Térreo', cota: 0, peDireito: 2.8, paredes: [], elementos: [
      { id: 'E1', tipo: 'tug', x: 1, y: 1, potencia: 100, altura: 0.3, circuitoId: 'C1' },
      { id: 'E2', tipo: 'tug', x: 2, y: 1, potencia: 100, altura: 0.3, circuitoId: null },
    ] }],
  };
  const res = calcularProjeto(projeto);
  const vs = verificacoes(projeto, res).map((v) => v.texto).join('\n');
  assert.match(vs, /1 ponto\(s\) sem circuito/);
  assert.match(vs, /nenhum quadro/);
  assert.ok(listaMateriais(projeto, res).some((i) => i.desc.startsWith('Tomada 2P+T 10 A') && i.qtd === 2));
});
