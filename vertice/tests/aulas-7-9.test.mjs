import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularEletrica, curvasTrecho, nivelTrecho, distConduto } from '../src/eletrico.js';
import { svgQuadroExecutivo, svgMultifilar, svgUnifilarGeral, quadroDemanda, componentesQuadro } from '../src/documentos.js';
import { exportarIfc } from '../src/ifc.js';
import { gerarXlsx, zip } from '../src/xlsx.js';
import { paginar, gerarPranchas, FOLHAS } from '../src/prancha.js';

let n = 0;
const alt = { luz: 2.8, interruptor: 1.1, tug: 0.3, tue: 2.2, qd: 1.5, qm: 1.5, cp: 2.7 };
const E = (tipo, x, y, extra = {}) => ({ id: `E${++n}`, tipo, x, y, altura: alt[tipo] ?? 1, potencia: { luz: 100, tug: 100, tue: 5500 }[tipo] ?? 0, ...extra });
function casa(extra = {}) {
  n = 0;
  const pav = {
    id: 'PV1', nome: 'Térreo', cota: 0, peDireito: 2.8, paredes: [{ x1: 0, y1: 0, x2: 12, y2: 0, esp: 0.15 }], vigas: [], lajes: [], eletrodutos: [],
    ambientes: [{ id: 'A1', nome: 'Sala', tipo: 'sala', x1: 0, y1: 0, x2: 6, y2: 5 }],
    elementos: [
      { ...E('qd', 0.5, 0.2), id: 'QD', esquema: '2F+N', alimentadoPor: 'QM' }, { ...E('qm', 13, 0), id: 'QM' },
      E('luz', 3, 2.5, { circuitoId: 'C1', comando: 'a' }), E('interruptor', 0.3, 1, { circuitoId: 'C1', comandos: ['a'] }),
      E('tug', 0.3, 2.5, { circuitoId: 'C2' }), E('tug', 3, 4.8, { circuitoId: 'C2' }), E('tug', 5.7, 2, { circuitoId: 'C2' }),
      E('tue', 11.6, 7.8, { circuitoId: 'C3' }),
    ],
  };
  return {
    nome: 'Casa teste', pavimentos: [pav], eletrica: { ...extra },
    circuitos: [
      { id: 'C1', numero: 1, nome: 'C1 Iluminação', tipo: 'ILUM', tensao: 127 }, { id: 'C2', numero: 2, nome: 'C2 TUG', tipo: 'TUG', tensao: 127 },
      { id: 'C3', numero: 3, nome: 'C3 Chuveiro', tipo: 'TUE', tensao: 220 },
      { id: 'C4', numero: 4, nome: 'C4 Reserva', tipo: 'RESERVA', potencia: 1000 }, { id: 'C5', numero: 5, nome: 'C5 Reserva', tipo: 'RESERVA', potencia: 1000 },
    ],
  };
}

test('trecho: curvas, nível (piso/forro) e comprimento entre pontos', () => {
  const pav = { cota: 0, peDireito: 2.8 };
  const no = (tipo, x, y, h) => ({ el: { tipo }, pav, x, y, h, z: h });
  const t1 = no('tug', 0, 0, 0.3), t2 = no('tug', 4, 3, 0.3), l = no('luz', 2, 2, 2.8);
  assert.equal(nivelTrecho(t1, t2, 'piso'), 'piso');
  assert.equal(nivelTrecho(t1, t2, 'teto'), 'teto');
  assert.equal(nivelTrecho(t1, l, 'piso'), 'teto');
  assert.equal(curvasTrecho(t1, t2, 'piso'), 3); // L em planta + subida nas duas caixas
  assert.equal(curvasTrecho(l, no('luz', 5, 2, 2.8), 'teto'), 0); // reto no forro, entre caixas de teto
  assert.ok(Math.abs(distConduto(t1, t2, 'piso') - (7 + 0.6)) < 1e-9);
});

test('NBR 5410 6.2.11.1.6: trecho longo pede caixa de passagem; a caixa resolve', () => {
  const p = casa();
  let c = calcularEletrica(p);
  const longo = c.segmentos.find((s) => s.circuitos.has('C3'));
  assert.ok(longo.excede, `chuveiro a ${longo.comp.toFixed(1)} m com ${longo.curvas} curvas`);
  assert.ok(c.alertas.get(longo.para.el.id)?.some((a) => /caixa de passagem/.test(a.texto)));
  // duas caixas no forro dividem o caminho do quadro ao chuveiro (18,7 m em planta)
  p.pavimentos[0].elementos.push(E('cp', 6, 0.2, { altura: 2.7 }), E('cp', 11.6, 4, { altura: 2.7 }));
  c = calcularEletrica(p);
  assert.ok(!c.segmentos.some((s) => s.excede && s.circuitos.has('C3')));
  assert.equal(c.segmentos.filter((s) => s.circuitos.has('C3')).length, 3);
});

test('rede: TUE em eletroduto exclusivo; iluminação e tomadas em redes separadas', () => {
  const c = calcularEletrica(casa());
  for (const s of c.segmentos) {
    if (s.circuitos.has('C3')) assert.equal(s.circuitos.size, 1);
    assert.ok(!(s.circuitos.has('C1') && s.circuitos.has('C2')), 'iluminação e TUG não dividem trecho');
  }
  assert.ok(c.segmentos.some((s) => s.nivel === 'piso' && s.circuitos.has('C2')));
  const teto = calcularEletrica(casa({ rotaBaixa: 'teto' }));
  assert.ok(!teto.segmentos.some((s) => s.nivel === 'piso'));
});

test('eletroduto lançado à mão é respeitado pelo traçado', () => {
  const p = casa();
  const [, , , , t1, , t3] = p.pavimentos[0].elementos;
  p.pavimentos[0].eletrodutos.push({ id: 'M1', a: p.pavimentos[0].elementos[0].id, b: t3.id });
  const c = calcularEletrica(p);
  const s = c.segmentos.find((x) => x.manual);
  assert.ok(s, 'trecho manual presente');
  assert.deepEqual([s.de.el.id, s.para.el.id].sort(), ['QD', t3.id].sort());
  assert.ok(t1);
});

test('diâmetro mínimo e taxa de ocupação configuráveis', () => {
  const c = calcularEletrica(casa({ diametroMin: 25 }));
  assert.ok(c.segmentos.every((s) => s.dn >= 25));
  for (const s of c.segmentos) assert.ok(s.areaOcupada <= s.taxaMax * s.areaUtil + 1e-9 || s.dn === 75);
});

test('seção fixada e peça do quadro', () => {
  const p = casa();
  p.circuitos[0].secaoFixa = 4;
  p.pavimentos[0].elementos[0].modulosPeca = 12;
  let c = calcularEletrica(p);
  assert.equal(c.circuitos.find((r) => r.circuito.id === 'C1').secao, 4);
  const qd = c.quadros.find((q) => q.quadro.id === 'QD');
  assert.equal(qd.tamanho, 12);
  assert.ok(!qd.excedePeca);
  p.circuitos[2].secaoFixa = 1.5; // chuveiro não cabe em 1,5 mm²
  c = calcularEletrica(p);
  assert.equal(c.circuitos.find((r) => r.circuito.id === 'C3').ok, false);
});

test('documentos: quadro executivo, multifilar, unifilar geral e demanda', () => {
  const p = casa();
  const c = calcularEletrica(p);
  const qd = c.quadros.find((q) => q.quadro.id === 'QD');
  const comps = componentesQuadro(qd);
  assert.equal(comps.reduce((a, x) => a + x.mod, 0), qd.modulos);
  assert.match(svgQuadroExecutivo(p, qd), /^<svg[\s\S]*Componentes/);
  const mf = svgMultifilar(p, qd);
  for (const r of qd.circuitos) assert.ok(mf.includes(`${r.circuito.numero} · `));
  assert.match(svgUnifilarGeral(p, c), /QD1[\s\S]*QM1/);
  const d = quadroDemanda(p, qd);
  assert.equal(d.foot.at(-1), Math.round(qd.demanda).toLocaleString('pt-BR'));
});

test('IFC4: cabeçalho, pavimento, elementos e eletrodutos', () => {
  const p = casa();
  const c = calcularEletrica(p);
  const { texto, resumo } = exportarIfc(p, { ele: c, nomeQuadro: () => 'QD1' }, { autor: 'Teste' });
  assert.match(texto, /^ISO-10303-21;[\s\S]*FILE_SCHEMA\(\('IFC4'\)\);[\s\S]*END-ISO-10303-21;\n$/);
  assert.match(texto, /IFCBUILDINGSTOREY\('[0-9A-Za-z_$]{22}'/);
  assert.equal(resumo.eletrodutos, c.segmentos.length);
  assert.equal((texto.match(/IFCCABLECARRIERSEGMENT\(/g) || []).length, c.segmentos.length);
  assert.ok(/IFCLIGHTFIXTURE\(/.test(texto) && /IFCOUTLET\(/.test(texto) && /IFCELECTRICDISTRIBUTIONBOARD\(/.test(texto));
  // referências: todo #n usado existe
  const def = new Set([...texto.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  for (const m of texto.matchAll(/#(\d+)(?!=)/g)) assert.ok(def.has(m[1]), `#${m[1]} indefinido`);
  assert.ok(texto.includes("'Casa teste'"));
});

test('XLSX: ZIP válido com as partes do pacote', () => {
  const z = zip([{ nome: 'a.txt', dados: 'abc' }]);
  assert.equal(new DataView(z.buffer).getUint32(0, true), 0x04034b50);
  const bytes = gerarXlsx([{ nome: 'Materiais', cabecalho: true, linhas: [['Descrição', 'Qtd'], ['Cabo 2,5 mm²', 12.5]] }]);
  const txt = new TextDecoder('latin1').decode(bytes);
  for (const parte of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) assert.ok(txt.includes(parte), parte);
  assert.ok(txt.includes('<v>12.5</v>'));
  const fim = bytes.length - 22;
  assert.equal(new DataView(bytes.buffer).getUint32(fim, true), 0x06054b50);
});

test('pranchas: menor folha que cabe, selo e continuação', () => {
  const img = (w, h) => ({ tipo: 'img', src: 'data:image/png;base64,', wmm: w, hmm: h });
  const f1 = paginar([{ titulo: 'Planta', conteudo: [img(200, 150)] }], 'auto');
  assert.equal(f1[0].folha, 'A3');
  const f2 = paginar([{ titulo: 'Planta', conteudo: [img(700, 450)] }], 'auto');
  assert.equal(f2[0].folha, 'A1');
  const f3 = paginar([{ titulo: 'Quadros', conteudo: [img(250, 150), img(250, 150), img(250, 150)] }], 'A4');
  assert.ok(f3.length >= 2 && f3[1].titulo.includes('continuação'));
  for (const f of [...f1, ...f2, ...f3]) {
    const [W, H] = FOLHAS[f.folha];
    for (const p of f.postos) {
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= W && p.y + p.h <= H);
      const s = f.selo;
      assert.ok(p.x + p.w <= s.x || p.y + p.h <= s.y, 'conteúdo não invade o selo');
    }
  }
  const r = gerarPranchas({ pranchas: [{ titulo: 'Planta', conteudo: [img(200, 150)] }], papel: 'auto', info: { projeto: 'Casa', data: '01/01/2026' } });
  assert.match(r.html, /@page pA3\{size:420mm 297mm/);
  assert.match(r.html, /FOLHA<\/span> <b>1\/1<\/b>/);
});
