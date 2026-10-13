import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularEletrica, minimosAmbiente } from '../src/eletrico.js';
import { metodoLumens, LUMINARIAS, planoTomadas } from '../src/luminotecnico.js';
import { svgUnifilar } from '../src/unifilar.js';

function projetoBase() {
  let n = 0;
  const alt = { luz: 2.8, interruptor: 1.1, paralelo: 1.1, tug: 0.3, tue: 2.2, qd: 1.5, qm: 1.5 };
  const E = (tipo, x, y, extra = {}) => ({ id: `E${++n}`, tipo, x, y, altura: alt[tipo] ?? 1, potencia: { luz: 100, tug: 100, tue: 5500 }[tipo] ?? 0, ...extra });
  const pav = {
    id: 'PV1', nome: 'Térreo', cota: 0, peDireito: 2.8, paredes: [],
    ambientes: [{ id: 'A1', nome: 'Sala', tipo: 'sala', x1: 0, y1: 0, x2: 6, y2: 5 }, { id: 'A2', nome: 'Banho', tipo: 'banheiro', x1: 9, y1: 4, x2: 12, y2: 9 }],
    elementos: [
      E('qd', 6.4, 0.4, { esquema: '2F+N', alimentadoPor: 'QM' }), { ...E('qm', 13, 0), id: 'QM' },
      E('luz', 3, 2.5, { circuitoId: 'C1', comando: 'a' }), E('luz', 10.5, 6.5, { circuitoId: 'C1', comando: 'b' }),
      E('paralelo', 0.3, 1, { circuitoId: 'C1', comandos: ['a'] }), E('paralelo', 5.7, 4.5, { circuitoId: 'C1', comandos: ['a'] }),
      E('interruptor', 9.3, 4.4, { circuitoId: 'C1', comandos: ['b'] }),
      E('tug', 0.3, 2.5, { circuitoId: 'C2' }), E('tug', 3, 4.7, { circuitoId: 'C2' }), E('tug', 11.6, 5, { circuitoId: 'C2', potencia: 600 }),
      E('tue', 11.6, 7.8, { circuitoId: 'C3' }),
    ],
  };
  return {
    pavimentos: [pav],
    circuitos: [
      { id: 'C1', numero: 1, nome: 'C1 Iluminação', tipo: 'ILUM', tensao: 127 }, { id: 'C2', numero: 2, nome: 'C2 TUG', tipo: 'TUG', tensao: 127 },
      { id: 'C3', numero: 3, nome: 'C3 Chuveiro', tipo: 'TUE', tensao: 220 }, { id: 'C4', numero: 4, nome: 'C4 Reserva', tipo: 'RESERVA', potencia: 1000 },
    ],
  };
}

test('circuitos: coordenação Ib ≤ In ≤ Iz, seções mínimas e TUE bifásico', () => {
  const c = calcularEletrica(projetoBase());
  const por = (id) => c.circuitos.find((r) => r.circuito.id === id);
  for (const r of c.circuitos.filter((x) => !x.reserva)) {
    assert.ok(r.ok, r.circuito.nome);
    assert.ok(r.ib <= r.disjuntor && r.disjuntor <= r.iz, `${r.circuito.nome}: ${r.ib} ≤ ${r.disjuntor} ≤ ${r.iz}`);
  }
  assert.ok(por('C1').secao >= 1.5);
  assert.ok(por('C2').secao >= 2.5);
  assert.equal(por('C3').polos, 2);
  assert.equal(por('C3').fases.length, 2);
});

test('DR obrigatório em área molhada e grupos de até 4 circuitos', () => {
  const c = calcularEletrica(projetoBase());
  const tug = c.circuitos.find((r) => r.circuito.id === 'C2');
  assert.ok(tug.drObrigatorio && tug.dr);
  const qd = c.quadros.find((q) => q.quadro.tipo === 'qd');
  for (const g of qd.drGrupos) assert.ok(g.circuitos.length <= 4);
});

test('eletrodutos: retornos e travessas entre paralelos, condutores por trecho', () => {
  const c = calcularEletrica(projetoBase());
  assert.ok(c.segmentos.length > 0);
  assert.ok(c.segmentos.some((s) => s.cont.R > 0), 'há retornos');
  for (const s of c.segmentos) {
    assert.ok(s.dn >= 16);
    assert.ok(s.ocupacao <= 0.53 + 1e-9);
  }
});

test('quadros: reservas mínimas, demanda e disjuntor a montante não menor que o de jusante', () => {
  const c = calcularEletrica(projetoBase());
  const qd = c.quadros.find((q) => q.quadro.tipo === 'qd');
  const qm = c.quadros.find((q) => q.quadro.tipo === 'qm');
  assert.equal(qd.reservasMin, 2);
  assert.ok(c.avisos.some((a) => /reserva/.test(a.texto)), 'falta 1 reserva');
  assert.ok(qd.demanda <= qd.instaladaTotal);
  assert.equal(qm.instaladaTotal, qd.instaladaTotal);
  assert.ok(qm.disjuntorGeral >= qd.disjuntorGeral);
});

test('NBR 5410 9.5.2: mínimos de iluminação e tomadas', () => {
  const m = minimosAmbiente({ tipo: 'sala', x1: 0, y1: 0, x2: 4, y2: 4 });
  assert.equal(m.ilum, 100 + 60 * 2); // 16 m² = 6 + 4 + 4 (+2)
  assert.ok(m.tug >= 4); // perímetro 16 m, 1 a cada 5 m
  const t = planoTomadas({ tipo: 'banheiro', x1: 0, y1: 0, x2: 2, y2: 2 });
  assert.equal(t.altura, 1.1);
  assert.equal(t.posicoes.length, t.tug);
});

test('método dos lúmens atinge a iluminância pedida', () => {
  const r = metodoLumens({ comprimento: 6, largura: 5, peDireito: 2.8, iluminancia: 200, luminaria: LUMINARIAS[3], refletancias: { teto: 0.7, parede: 0.5, piso: 0.1 } });
  assert.ok(r.K > 1 && r.K < 1.6);
  assert.ok(r.Eobtida >= 200 * 0.95);
  assert.equal(r.nx * r.ny, r.total);
  assert.ok(r.total >= r.n);
});

test('diagrama unifilar lista todos os circuitos', () => {
  const p = projetoBase();
  const c = calcularEletrica(p);
  const qd = c.quadros.find((q) => q.quadro.tipo === 'qd');
  const svg = svgUnifilar(p, qd);
  assert.match(svg, /^<svg/);
  for (const r of qd.circuitos) assert.ok(svg.includes(`${r.circuito.numero} · `));
  assert.ok(svg.includes('DPS'));
});
