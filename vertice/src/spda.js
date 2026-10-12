// SPDA externo pelo método das malhas (referência NBR 5419-3).
// Captação: malha sobre a cobertura do pavimento mais alto com paredes.
// Descidas: distribuídas no perímetro com espaçamento máximo por nível de proteção.
// Aterramento: anel a 1 m da edificação, com uma haste por descida.

export const NIVEIS = {
  I: { malha: 5, descidas: 10 },
  II: { malha: 10, descidas: 10 },
  III: { malha: 15, descidas: 15 },
  IV: { malha: 20, descidas: 20 },
};

export function contorno(projeto) {
  // pavimento mais alto que tem paredes
  const comParedes = projeto.pavimentos.filter((p) => p.paredes.length);
  if (!comParedes.length) return null;
  const topo = comParedes.reduce((a, b) => (b.cota > a.cota ? b : a));
  const xs = topo.paredes.flatMap((w) => [w.x1, w.x2]);
  const ys = topo.paredes.flatMap((w) => [w.y1, w.y2]);
  return {
    pav: topo,
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
    z: topo.cota + topo.peDireito + 0.2,
  };
}

const divisoes = (comp, max) => Math.max(1, Math.ceil(comp / max - 1e-9));

export function calcularSpda(projeto) {
  const cfg = projeto.spda || { ativo: false, nivel: 'III' };
  if (!cfg.ativo) return { ativo: false, avisos: [] };
  const c = contorno(projeto);
  const avisos = [];
  if (!c) return { ativo: true, avisos: [{ nivel: 'aviso', texto: 'SPDA: desenhe as paredes para gerar a captação.' }] };
  const nv = NIVEIS[cfg.nivel] || NIVEIS.III;
  const W = c.maxX - c.minX, H = c.maxY - c.minY;
  const nx = divisoes(W, nv.malha), ny = divisoes(H, nv.malha);

  const captacao = [];
  for (let i = 0; i <= nx; i++) {
    const x = c.minX + (W * i) / nx;
    captacao.push({ x1: x, y1: c.minY, x2: x, y2: c.maxY });
  }
  for (let j = 0; j <= ny; j++) {
    const y = c.minY + (H * j) / ny;
    captacao.push({ x1: c.minX, y1: y, x2: c.maxX, y2: y });
  }

  // descidas: começa nos cantos e completa ao longo dos lados respeitando o espaçamento
  const descidas = [];
  const lados = [
    [c.minX, c.minY, c.maxX, c.minY], [c.maxX, c.minY, c.maxX, c.maxY],
    [c.maxX, c.maxY, c.minX, c.maxY], [c.minX, c.maxY, c.minX, c.minY],
  ];
  for (const [x1, y1, x2, y2] of lados) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    const n = divisoes(L, nv.descidas);
    for (let k = 0; k < n; k++) descidas.push({ x: x1 + ((x2 - x1) * k) / n, y: y1 + ((y2 - y1) * k) / n });
  }

  const comprimentoCaptacao = captacao.reduce((s, l) => s + Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 0);
  const alturaDescida = c.z;
  const anel = { minX: c.minX - 1, maxX: c.maxX + 1, minY: c.minY - 1, maxY: c.maxY + 1 };
  const perimetroAnel = 2 * (anel.maxX - anel.minX + anel.maxY - anel.minY);
  const nos = (nx + 1) * (ny + 1);

  if (alturaDescida > 60) avisos.push({ nivel: 'aviso', texto: 'SPDA: edificação acima de 60 m exige proteção contra descargas laterais.' });
  if (descidas.length < 2) avisos.push({ nivel: 'erro', texto: 'SPDA: são necessárias pelo menos 2 descidas.' });
  avisos.push({ nivel: 'ok', texto: `SPDA nível ${cfg.nivel}: malha ${nv.malha}×${nv.malha} m, ${descidas.length} descidas, ${nos} nós de captação.` });

  return {
    ativo: true, nivel: cfg.nivel, malha: nv.malha, esp: nv.descidas, contorno: c, captacao, descidas, anel,
    comprimentoCaptacao, alturaDescida, perimetroAnel, nos, avisos,
  };
}

export function materiaisSpda(s) {
  if (!s.ativo || !s.captacao) return [];
  return [
    { desc: 'Cabo de cobre nu 35 mm² (captação)', un: 'm', qtd: Math.ceil(s.comprimentoCaptacao * 1.1) },
    { desc: 'Cabo de cobre nu 35 mm² (descidas)', un: 'm', qtd: Math.ceil(s.descidas.length * s.alturaDescida * 1.1) },
    { desc: 'Cabo de cobre nu 50 mm² (anel de aterramento)', un: 'm', qtd: Math.ceil(s.perimetroAnel * 1.1) },
    { desc: 'Haste de aterramento cobreada 5/8" x 2,4 m', un: 'pç', qtd: s.descidas.length },
    { desc: 'Caixa de inspeção de aterramento', un: 'pç', qtd: s.descidas.length },
    { desc: 'Terminal aéreo (mini-captor) 300 mm', un: 'pç', qtd: s.nos },
    { desc: 'Conector de cruzamento / emenda', un: 'pç', qtd: s.nos + s.descidas.length * 2 },
    { desc: 'Suporte / presilha para cabo', un: 'pç', qtd: Math.ceil(s.comprimentoCaptacao + s.descidas.length * s.alturaDescida) },
  ];
}
