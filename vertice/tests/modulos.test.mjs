import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calcularHidraulica, perdaUnitaria } from '../src/hidraulico.js';
import { calcularSpda } from '../src/spda.js';
import { calcularEstrutura, dimensionarViga, dimensionarPilar, lancamentoAutomatico, detectarAmbientes } from '../src/estrutural.js';
import { lerDxf, gravarDxf, paraFundo } from '../src/dxf.js';
import { paredesDeLinhas } from '../src/importar.js';

const TEMPLATE = fs.readFileSync(new URL('../assets/template-r2000.dxf', import.meta.url), 'latin1');
let n = 0;
const uid = (p) => p + ++n;
const W = (x1, y1, x2, y2) => ({ id: uid('P'), x1, y1, x2, y2, esp: 0.15 });
const casa = () => ({ id: 'PV', nome: 'Térreo', cota: 0, peDireito: 2.8, vigas: [], lajes: [], elementos: [],
  paredes: [W(0, 0, 8, 0), W(8, 0, 8, 6), W(8, 6, 0, 6), W(0, 6, 0, 0), W(4, 0, 4, 6)] });

// ---------------------------------------------------------------- hidráulica
const banheiro = (alturaRes) => ({
  circuitos: [],
  pavimentos: [{ nome: 'T', cota: 0, peDireito: 2.8, paredes: [], elementos: [
    { id: 'R', tipo: 'reservatorio', x: 0, y: 0, altura: alturaRes },
    { id: 'A', tipo: 'chuveiro', x: 3, y: 0, altura: 2.1 },
    { id: 'B', tipo: 'bacia', x: 3, y: 2, altura: 0.2 },
    { id: 'C', tipo: 'lavatorio', x: 1, y: 2, altura: 0.6 },
    { id: 'D', tipo: 'ci', x: 6, y: 4, altura: -0.4 },
  ] }],
});

test('água fria: vazão pelo método dos pesos e pressão por desnível', () => {
  const h = calcularHidraulica(banheiro(5));
  assert.equal(h.af.segmentos.length, 3);
  const tronco = h.af.segmentos.find((s) => s.somaP > 0.9);
  assert.ok(Math.abs(tronco.q - 0.3 * Math.sqrt(1.0)) < 1e-9);
  for (const p of h.af.pontos) assert.ok(p.pressao >= 1, `pressão ${p.pressao}`);
});

test('água fria: reservatório baixo gera erro de pressão no chuveiro', () => {
  const h = calcularHidraulica(banheiro(2.6));
  assert.ok(h.af.avisos.some((a) => a.nivel === 'erro' && /Chuveiro/.test(a.texto)));
});

test('perda de carga cresce com a vazão e cai com o diâmetro', () => {
  assert.ok(perdaUnitaria(0.4, 17) > perdaUnitaria(0.2, 17));
  assert.ok(perdaUnitaria(0.4, 21.6) < perdaUnitaria(0.4, 17));
});

test('esgoto: trecho da bacia sanitária é DN 100', () => {
  const h = calcularHidraulica(banheiro(5));
  const daBacia = h.esg.segmentos.find((s) => s.para.el.id === 'B');
  assert.equal(daBacia.dn, 100);
  assert.equal(daBacia.declividade, 1);
  assert.ok(h.esg.segmentos.every((s) => s.dn >= 40));
});

// ---------------------------------------------------------------- SPDA
test('SPDA: descidas e malha por nível de proteção', () => {
  const p = { spda: { ativo: true, nivel: 'III' }, pavimentos: [casa()] };
  const s3 = calcularSpda(p);
  assert.equal(s3.descidas.length, 4); // lados 8 e 6 m < 15 m: uma descida por lado
  p.spda.nivel = 'I';
  const s1 = calcularSpda(p);
  assert.equal(s1.malha, 5);
  assert.equal(s1.captacao.length, 2 + 1 + 2 + 1); // 8 m -> 2 vãos (3 linhas), 6 m -> 2 vãos (3 linhas)
  assert.ok(s1.descidas.length >= 4);
  assert.equal(calcularSpda({ spda: { ativo: false }, pavimentos: [casa()] }).ativo, false);
});

// ---------------------------------------------------------------- estrutural
test('detecção de ambientes acha os dois cômodos', () => {
  const amb = detectarAmbientes(casa());
  assert.equal(amb.length, 2);
  const areas = amb.map((r) => Math.round((r.x2 - r.x1) * (r.y2 - r.y1))).sort();
  assert.deepEqual(areas, [24, 24]);
});

test('lançamento automático: pilares em cantos, encontros e vãos > 5 m', () => {
  const pav = casa();
  const l = lancamentoAutomatico(pav, uid);
  assert.equal(l.pilares.length, 9);
  assert.equal(l.vigas.length, 10);
  assert.equal(l.lajes.length, 2);
});

test('viga: momento e armadura de flexão', () => {
  const r = dimensionarViga({ b: 15, h: 40, L: 4, q: 15 });
  assert.equal(r.M, 30); // qL²/8
  assert.equal(r.V, 30);
  assert.ok(r.As > 2.5 && r.As < 4, `As ${r.As}`);
  assert.ok(r.barras.n * Math.PI * (r.barras.phi / 10) ** 2 / 4 >= r.As);
  assert.ok(dimensionarViga({ b: 12, h: 20, L: 8, q: 30 }).avisos.length > 0);
});

test('pilar: armadura mínima e seção pequena', () => {
  const r = dimensionarPilar({ b: 20, h: 30, N: 200 });
  assert.ok(r.As >= 0.004 * 600 - 1e-9);
  assert.ok(r.barras.n >= 4);
  assert.ok(dimensionarPilar({ b: 14, h: 30, N: 100 }).avisos.some((a) => /19 cm/.test(a)));
});

test('estrutura: cargas descem das lajes para vigas, pilares e fundação', () => {
  const pav = casa();
  const l = lancamentoAutomatico(pav, uid);
  pav.elementos.push(...l.pilares); pav.vigas = l.vigas; pav.lajes = l.lajes;
  const est = calcularEstrutura({ pavimentos: [pav], estrutura: { sigmaSolo: 200 } });
  const cargaLajes = est.lajes.reduce((s, r) => s + r.p * r.A, 0);
  const naFundacao = est.fundacao.reduce((s, f) => s + f.N, 0);
  const pp = est.vigas.reduce((s, r) => s + r.detalhe.pp, 0) + est.pilares.reduce((s, r) => s + r.pp, 0);
  // equilíbrio: tudo o que entra chega à fundação
  assert.ok(Math.abs(naFundacao - (cargaLajes + pp)) < 0.01, `${naFundacao} vs ${cargaLajes + pp}`);
  assert.equal(est.fundacao.length, 9);
});

// ---------------------------------------------------------------- DXF
test('DXF: grava e relê camadas, textos acentuados, polilinhas e círculos', () => {
  const dxf = gravarDxf(TEMPLATE, [{ nome: 'ARQ', cor: 8 }, { nome: 'ELÉ', cor: 5 }], [
    { t: 'poly', l: 'ARQ', fechado: true, pts: [[0, 0], [4, 0], [4, 3], [0, 3]] },
    { t: 'circle', l: 'ELÉ', x: 1, y: 1, r: 0.2 },
    { t: 'text', l: 'ELÉ', x: 1, y: 1.5, h: 0.2, texto: 'Iluminação' },
  ]);
  const d = lerDxf(dxf);
  assert.equal(d.segs.length, 4);
  assert.equal(d.circs.length, 1);
  assert.equal(d.textos[0].t, 'Iluminação');
  assert.deepEqual(d.camadas.map((c) => c.nome).sort(), ['ARQ', 'ELÉ']);
  assert.equal(d.insunits, 6);
});

test('DXF: blocos (INSERT) são explodidos com escala, rotação e camada', () => {
  const dxf = ['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'PORTA', '10', '0', '20', '0', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '1', '21', '0', '0', 'ENDBLK', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', '0', 'INSERT', '8', 'PORTAS', '2', 'PORTA', '10', '10', '20', '5', '41', '2', '42', '2', '50', '90', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const d = lerDxf(dxf);
  assert.equal(d.segs.length, 1);
  const [l, x1, y1, x2, y2] = d.segs[0];
  assert.equal(l, 'PORTAS');
  assert.deepEqual([x1, y1].map(Math.round), [10, 5]);
  assert.deepEqual([x2, y2].map((v) => Math.round(v * 1000) / 1000), [10, 7]);
});

test('DXF: arco por bulge em LWPOLYLINE', () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', 'A', '90', '2', '70', '0', '10', '0', '20', '0', '42', '1', '10', '2', '20', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const d = lerDxf(dxf);
  assert.ok(d.segs.length > 4);
  const ys = d.segs.flatMap((s) => [s[2], s[4]]);
  assert.ok(Math.abs(Math.min(...ys) + 1) < 0.01); // semicírculo de raio 1 para baixo (bulge +1, sentido anti-horário)
});

test('importação: linhas duplas viram paredes no eixo, unidas nos cantos e no T', () => {
  const E = [];
  const rect = (x1, y1, x2, y2) => E.push({ t: 'poly', l: 'PAREDES', fechado: true, pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] });
  rect(-75, -75, 8075, 6075); rect(75, 75, 7925, 5925);
  E.push({ t: 'line', l: 'PAREDES', x1: 3925, y1: 75, x2: 3925, y2: 5925 }, { t: 'line', l: 'PAREDES', x1: 4075, y1: 75, x2: 4075, y2: 5925 });
  const d = lerDxf(gravarDxf(TEMPLATE, [{ nome: 'PAREDES', cor: 7 }], E));
  const fundo = paraFundo(d, 'teste.dxf', 0.001);
  const ps = paredesDeLinhas(fundo, new Set([0]), uid);
  assert.equal(ps.length, 5);
  for (const p of ps) assert.equal(p.esp, 0.15);
  // o desenho é transladado para começar na origem (canto -75 mm) e o eixo Y é invertido
  const X = (x) => (x + 75) / 1000, Y = (y) => (6075 - y) / 1000;
  const perto = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.002;
  const pontas = ps.flatMap((p) => [[p.x1, p.y1], [p.x2, p.y2]]);
  for (const [x, y] of [[0, 0], [8000, 0], [8000, 6000], [0, 6000], [4000, 0], [4000, 6000]]) {
    assert.ok(pontas.some((q) => perto(q, [X(x), Y(y)])), `falta (${x}, ${y}): ${JSON.stringify(pontas)}`);
  }
});
