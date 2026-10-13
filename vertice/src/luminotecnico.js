// Distribuição automática de lâmpadas (método dos lúmens) e de tomadas (mínimos da NBR 5410).
import { AMBIENTES } from './tipos.js';
import { minimosAmbiente } from './eletrico.js';

export const LUMINARIAS = [
  { id: 'led9', nome: 'Lâmpada LED bulbo 9 W', potencia: 9, fluxo: 806 },
  { id: 'led12', nome: 'Lâmpada LED bulbo 12 W', potencia: 12, fluxo: 1055 },
  { id: 'led15', nome: 'Lâmpada LED bulbo 15 W', potencia: 15, fluxo: 1400 },
  { id: 'pl18', nome: 'Plafon LED 18 W', potencia: 18, fluxo: 1600 },
  { id: 'pl24', nome: 'Painel LED 24 W', potencia: 24, fluxo: 2200 },
  { id: 'pl36', nome: 'Painel LED 36 W 60x60', potencia: 36, fluxo: 3600 },
];

// fator de utilização de luminária de distribuição direta, refletâncias teto 70% / parede 50% /
// piso 10%, em função do índice do recinto K; corrigido de forma aproximada para outras refletâncias
const U_BASE = [[0.6, 0.31], [0.8, 0.38], [1, 0.43], [1.25, 0.48], [1.5, 0.52], [2, 0.57], [2.5, 0.61], [3, 0.64], [4, 0.68], [5, 0.7]];
export function fatorUtilizacao(K, ref = { teto: 0.7, parede: 0.5, piso: 0.1 }) {
  let u;
  if (K <= U_BASE[0][0]) u = U_BASE[0][1] * (K / U_BASE[0][0]) ** 0.5;
  else if (K >= U_BASE[U_BASE.length - 1][0]) u = U_BASE[U_BASE.length - 1][1];
  else {
    const i = U_BASE.findIndex(([k]) => k >= K);
    const [k0, u0] = U_BASE[i - 1], [k1, u1] = U_BASE[i];
    u = u0 + ((u1 - u0) * (K - k0)) / (k1 - k0);
  }
  // correção: paredes e teto mais claros refletem mais luz útil
  const corr = 1 + 0.45 * (ref.parede - 0.5) + 0.3 * (ref.teto - 0.7) + 0.1 * (ref.piso - 0.1);
  return Math.max(0.1, u * corr);
}

export function metodoLumens({ comprimento, largura, peDireito, planoTrabalho = 0.75, alturaLuminaria, iluminancia, luminaria, fm = 0.8, refletancias }) {
  const C = Math.max(comprimento, largura), L = Math.min(comprimento, largura);
  const hm = Math.max(0.3, (alturaLuminaria ?? peDireito) - planoTrabalho);
  const A = C * L;
  const K = (C * L) / (hm * (C + L));
  const u = fatorUtilizacao(K, refletancias);
  const fluxoTotal = (iluminancia * A) / (u * fm);
  const n = Math.max(1, Math.ceil(fluxoTotal / luminaria.fluxo - 0.05));
  // malha nx × ny: menor total possível, com espaçamentos parecidos nas duas direções
  let nx = 1, ny = n, melhor = Infinity;
  for (let i = 1; i <= n; i++) {
    const j = Math.ceil(n / i);
    const nota = i * j + 0.8 * Math.abs(comprimento / i - largura / j);
    if (nota < melhor) { melhor = nota; nx = i; ny = j; }
  }
  const total = nx * ny;
  const Eobtida = (total * luminaria.fluxo * u * fm) / A;
  return { A, hm, K, u, fm, fluxoTotal, n, nx, ny, total, Eobtida, potenciaTotal: total * luminaria.potencia, wm2: (total * luminaria.potencia) / A };
}

// posições das luminárias: centro de cada célula da malha nx × ny
export function posicoesLuminarias(amb, nx, ny) {
  const pts = [];
  const C = amb.x2 - amb.x1, L = amb.y2 - amb.y1;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    pts.push({ x: Math.round((amb.x1 + (C * (i + 0.5)) / nx) * 100) / 100, y: Math.round((amb.y1 + (L * (j + 0.5)) / ny) * 100) / 100 });
  }
  return pts;
}

// tomadas: espaçadas ao longo do perímetro, a 15 cm da face da parede, evitando cantos
export function posicoesTomadas(amb, n, recuo = 0.15) {
  const x1 = amb.x1 + recuo, y1 = amb.y1 + recuo, x2 = amb.x2 - recuo, y2 = amb.y2 - recuo;
  const lados = [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]];
  const comp = lados.map(([a, b, c, d]) => Math.hypot(c - a, d - b));
  const P = comp.reduce((a, b) => a + b, 0);
  const passo = P / n;
  const pts = [];
  for (let k = 0; k < n; k++) {
    let s = passo * (k + 0.5);
    let i = 0;
    while (s > comp[i] && i < 3) { s -= comp[i]; i++; }
    const [a, b, c, d] = lados[i];
    const t = Math.min(1, Math.max(0, s / comp[i]));
    pts.push({ x: Math.round((a + (c - a) * t) * 100) / 100, y: Math.round((b + (d - b) * t) * 100) / 100 });
  }
  return pts;
}

export function planoTomadas(amb) {
  const m = minimosAmbiente(amb);
  const altura = ['cozinha', 'servico', 'banheiro'].includes(amb.tipo) ? 1.1 : 0.3;
  return { ...m, altura, posicoes: posicoesTomadas(amb, m.tug), regra: AMBIENTES[amb.tipo]?.tomadas };
}

export function relatorioLuminotecnico(amb, entrada, r) {
  return [
    ['Ambiente', `${amb.nome} (${AMBIENTES[amb.tipo]?.nome || amb.tipo})`],
    ['Dimensões', `${(amb.x2 - amb.x1).toFixed(2)} × ${(amb.y2 - amb.y1).toFixed(2)} m · ${r.A.toFixed(2)} m²`],
    ['Iluminância desejada', `${entrada.iluminancia} lx`],
    ['Luminária', `${entrada.luminaria.nome} · ${entrada.luminaria.fluxo} lm`],
    ['Altura de montagem útil (h)', `${r.hm.toFixed(2)} m (plano de trabalho ${entrada.planoTrabalho.toFixed(2)} m)`],
    ['Índice do recinto K', r.K.toFixed(2)],
    ['Refletâncias teto/parede/piso', `${Math.round(entrada.refletancias.teto * 100)}/${Math.round(entrada.refletancias.parede * 100)}/${Math.round(entrada.refletancias.piso * 100)} %`],
    ['Fator de utilização u', r.u.toFixed(3)],
    ['Fator de manutenção', r.fm.toFixed(2)],
    ['Fluxo necessário', `${Math.round(r.fluxoTotal)} lm`],
    ['Luminárias (calculado → adotado)', `${r.n} → ${r.total} (${r.nx} × ${r.ny})`],
    ['Iluminância obtida', `${Math.round(r.Eobtida)} lx`],
    ['Potência instalada', `${r.potenciaTotal} W · ${r.wm2.toFixed(1)} W/m²`],
  ];
}
