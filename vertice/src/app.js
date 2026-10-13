import { ICONS } from './icons.js';
import { Plan2D, corCircuito, fmt, chaveSeg, indicacoesPavimento, renderizarPlanta } from './plan2d.js';
import { View3D } from './view3d.js';
import { TIPOS, DISCIPLINAS, AMBIENTES } from './tipos.js';
import { calcularEletrica, listaMateriais, fmtSec, nomeQuadro, ESQUEMAS, minimosAmbiente, dentroDe, MODULOS_QD, MATERIAIS_ELETRODUTO, configEletrica } from './eletrico.js';
import { svgQuadroExecutivo, svgMultifilar, svgUnifilarGeral, quadroDemanda, legendaFiacao } from './documentos.js';
import { gerarPranchas, FOLHAS } from './prancha.js';
import { exportarIfc } from './ifc.js';
import { gerarXlsx } from './xlsx.js';
import { LUMINARIAS, metodoLumens, posicoesLuminarias, planoTomadas, relatorioLuminotecnico } from './luminotecnico.js';
import { svgUnifilar } from './unifilar.js';
import { calcularHidraulica, materiaisHidraulica, TUBOS_AF } from './hidraulico.js';
import { calcularSpda, materiaisSpda, NIVEIS } from './spda.js';
import { calcularEstrutura, materiaisEstrutura, lancamentoAutomatico, cargaLaje, detectarAmbientes } from './estrutural.js';
import { lerDxf, paraFundo, corAci } from './dxf.js';
import { exportarDxf } from './cad.js';
import { paredesDeLinhas } from './importar.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const host = window.host || {
  // permite abrir o index.html direto no navegador durante o desenvolvimento
  openProject: async () => null, saveProject: async () => null, exportFile: async () => null,
  importCad: async () => null, exportCad: async () => null, setTitle: (t) => (document.title = t),
};

// ---------------------------------------------------------------- projeto exemplo
function projetoExemplo() {
  let n = 0;
  const uid = (p) => p + ++n;
  const W = (x1, y1, x2, y2, esp = 0.15) => ({ id: uid('P'), x1, y1, x2, y2, esp });
  const E = (tipo, x, y, extra = {}) => {
    const t = TIPOS[tipo];
    const e = { id: uid('E'), tipo, x, y, altura: t.altura, descricao: '' };
    if (t.disc === 'ele' && !t.quadro) Object.assign(e, { potencia: t.potencia, circuitoId: null });
    return Object.assign(e, extra);
  };
  const C = (numero, nome, tipo, extra = {}) => ({ id: `C${numero}`, numero, nome: `C${numero} ${nome}`, tipo, tensao: 127, quadroId: 'QD1', fase: 'auto', dr: 'auto', ...extra });
  const circuitos = [
    C(1, 'Iluminação sala e quarto', 'ILUM'), C(2, 'Iluminação cozinha, serviço e banho', 'ILUM'),
    C(3, 'TUG sala', 'TUG'), C(4, 'TUG quarto', 'TUG'), C(5, 'TUG cozinha (bancada)', 'TUG'),
    C(6, 'TUG cozinha e banho', 'TUG'), C(7, 'TUG área de serviço', 'TUG'), C(8, 'Chuveiro', 'TUE', { tensao: 220 }),
    C(9, 'Reserva', 'RESERVA', { potencia: 1000 }), C(10, 'Reserva', 'RESERVA', { potencia: 1000 }), C(11, 'Reserva', 'RESERVA', { potencia: 1000 }),
  ];
  const terreo = {
    id: 'PV1', nome: 'Térreo', cota: 0, peDireito: 2.8, vigas: [], lajes: [], desenho: [],
    paredes: [
      W(0, 0, 12, 0), W(12, 0, 12, 9), W(12, 9, 0, 9), W(0, 9, 0, 0),
      W(6, 0, 6, 9), W(0, 5, 6, 5), W(6, 4, 12, 4), W(9, 4, 9, 9),
    ],
    elementos: [
      // entrada de serviço → medição → distribuição
      E('es', 13.6, -1.2, { id: 'ES1', esquema: '2F+N' }), E('qm', 12.6, -0.4, { id: 'QM1', esquema: '2F+N', alimentadoPor: 'ES1' }),
      E('qd', 6.4, 0.4, { id: 'QD1', esquema: '2F+N', alimentadoPor: 'QM1', dps: true, descricao: 'QD1' }),
      // iluminação e comandos
      E('luz', 1.8, 2.5, { circuitoId: 'C1', comando: 'a', potencia: 240 }), E('luz', 4.2, 2.5, { circuitoId: 'C1', comando: 'b', potencia: 240 }),
      E('interruptor', 5.6, 4.6, { circuitoId: 'C1', comandos: ['a', 'b'] }),
      E('luz', 3, 7, { circuitoId: 'C1', comando: 'c', potencia: 340 }),
      E('paralelo', 5.6, 5.4, { circuitoId: 'C1', comandos: ['c'] }), E('paralelo', 0.4, 8.6, { circuitoId: 'C1', comandos: ['c'] }),
      E('luz', 9, 2, { circuitoId: 'C2', comando: 'd', potencia: 340 }), E('interruptor', 6.4, 3.6, { circuitoId: 'C2', comandos: ['d'] }),
      E('luz', 7.5, 6.5, { circuitoId: 'C2', comando: 'e', potencia: 220 }), E('interruptor', 6.4, 4.4, { circuitoId: 'C2', comandos: ['e'] }),
      E('luz', 10.5, 6.5, { circuitoId: 'C2', comando: 'f', potencia: 220, altura: 2.8 }), E('interruptor', 9.4, 4.4, { circuitoId: 'C2', comandos: ['f'] }),
      E('tue', 11.6, 7.8, { circuitoId: 'C8', potencia: 5500, altura: 2.2 }),
      // caixa de passagem no forro: divide o trecho longo até o chuveiro (máx. 15 m menos 3 m por curva)
      E('cp', 8.8, 4.3, { altura: 2.7 }),
      // hidrossanitário: banheiro (9-12 × 4-9), cozinha (6-12 × 0-4), serviço (6-9 × 4-9)
      E('reservatorio', 10.5, 6.5, { altura: 4.6 }),
      E('chuveiro', 11.3, 8.3), E('bacia', 9.5, 8.4), E('lavatorio', 9.5, 5),
      E('pia', 10, 0.5), E('tanque', 8.5, 8.5), E('mlr', 7, 8.6),
      E('ci', 13.5, 10, { altura: -0.4 }),
    ],
  };
  // ambientes a partir das paredes e tomadas pelos mínimos da NBR 5410
  const nomes = [['Sala', 'sala'], ['Quarto', 'quarto'], ['Cozinha', 'cozinha'], ['Área de serviço', 'servico'], ['Banheiro', 'banheiro']];
  const amb = detectarAmbientes(terreo).sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1);
  const ordem = { '0|0': 0, '0|5': 1, '6|0': 2, '6|4': 3, '9|4': 4 };
  terreo.ambientes = amb.map((r) => {
    const [nome, tipo] = nomes[ordem[`${Math.round(r.x1)}|${Math.round(r.y1)}`] ?? 0];
    return { id: uid('A'), nome, tipo, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };
  });
  const circTug = { Sala: 'C3', Quarto: 'C4', Cozinha: ['C5', 'C5', 'C5', 'C6', 'C6', 'C6'], 'Área de serviço': 'C7', Banheiro: 'C6' };
  for (const a of terreo.ambientes) {
    const pl = planoTomadas(a);
    pl.posicoes.forEach((p, i) => {
      const c = Array.isArray(circTug[a.nome]) ? circTug[a.nome][i] || circTug[a.nome].at(-1) : circTug[a.nome];
      terreo.elementos.push(E('tug', p.x, p.y, { circuitoId: c, potencia: pl.potTug[i], altura: pl.altura }));
    });
  }
  const projeto = {
    versao: 3, nome: 'Residência exemplo', autor: '', pavimentos: [terreo], circuitos,
    spda: { ativo: true, nivel: 'III' }, estrutura: { sigmaSolo: 200 },
    eletrica: { tensaoFN: 127, tensaoFF: 220, quedaMax: 4, quedaAlim: 1, temperatura: 30 },
  };
  const lan = lancamentoAutomatico(terreo, uid);
  terreo.elementos.push(...lan.pilares);
  terreo.vigas = lan.vigas;
  terreo.lajes = lan.lajes;
  projeto.seq = n;
  return projeto;
}

function normalizar(p) {
  p.spda ||= { ativo: false, nivel: 'III' };
  p.estrutura ||= { sigmaSolo: 200 };
  p.eletrica = { tensaoFN: 127, tensaoFF: 220, quedaMax: 4, quedaAlim: 1, temperatura: 30, ...(p.eletrica || {}) };
  p.circuitos ||= [];
  for (const pv of p.pavimentos) {
    pv.vigas ||= []; pv.lajes ||= []; pv.elementos ||= []; pv.paredes ||= []; pv.desenho ||= []; pv.ambientes ||= []; pv.eletrodutos ||= [];
    pv.id ||= 'PV' + Math.random().toString(36).slice(2, 8);
  }
  p.pavimentos.sort((a, b) => a.cota - b.cota);
  return p;
}

// ---------------------------------------------------------------- estado
const store = {
  project: normalizar(projetoExemplo()),
  floorIdx: 0,
  selection: null,
  activeCircuitId: 'C1',
  settings: {
    grid: true, snap: true, orto: true,
    vis: { arq: true, est: true, ele: true, hid: true, spda: true, fundo: true },
    chamada: { ele: 'simples', hid: 'circulo', est: 'retangulo' },
    filtro: 'todos', otimizar: true, indicacaoNumerica: false, planta: 'completa', so3dAteAtual: false, planos3d: false, orto3d: false, fundo3d: '#f4f6f9', corte: null, escala: 50, altura: null, subrede: null,
  },
  rede: 'ele',
  results: [], ele: null, hid: null, spda: null, est: null,
  nomeQuadro(q) { return nomeQuadro(q, this.project); },
  undo: [], redo: [],
  clipboard: null,
  filePath: null,
  dirty: false,

  get floor() { return this.project.pavimentos[this.floorIdx]; },
  get activeCircuit() { return this.project.circuitos.find((c) => c.id === this.activeCircuitId) || null; },

  uid(p) { this.project.seq = (this.project.seq || 0) + 1; return p + this.project.seq; },

  calc() {
    this.ele = calcularEletrica(this.project);
    this.results = this.ele.circuitos;
    this.hid = calcularHidraulica(this.project);
    this.spda = calcularSpda(this.project);
    this.est = calcularEstrutura(this.project);
  },
  snapshot() {
    this.undo.push(JSON.stringify(this.project));
    if (this.undo.length > 150) this.undo.shift();
    this.redo = [];
  },
  commit(label, fn) {
    this.snapshot();
    fn();
    this.changed(true, label);
  },
  changed(final = true) {
    this.calc();
    plan.render();
    if (final) {
      this.dirty = true;
      updateTitle();
      renderTree();
      renderProps();
      if (painelAtual === 'gerenciador') renderGerenciador();
      view3d.invalidate();
    } else {
      renderProps();
    }
  },
  restore(json) {
    const selIds = this.selItens().map((it) => it.ref?.id);
    this.project = normalizar(JSON.parse(json));
    this.floorIdx = Math.min(this.floorIdx, this.project.pavimentos.length - 1);
    const f = this.floor;
    const achar = (id) => {
      const el = f.elementos.find((e) => e.id === id); if (el) return { kind: 'elemento', ref: el };
      const w = f.paredes.find((e) => e.id === id); if (w) return { kind: 'parede', ref: w };
      const v = f.vigas.find((e) => e.id === id); if (v) return { kind: 'viga', ref: v };
      const l = f.lajes.find((e) => e.id === id); if (l) return { kind: 'laje', ref: l };
      const d = f.desenho.find((e) => e.id === id); if (d) return { kind: 'desenho', ref: d };
      const am = f.ambientes.find((e) => e.id === id); if (am) return { kind: 'ambiente', ref: am };
      return null;
    };
    const itens = selIds.map(achar).filter(Boolean);
    this.selection = itens.length > 1 ? { kind: 'multi', itens } : itens[0] || null;
    if (!this.activeCircuit) this.activeCircuitId = this.project.circuitos[0]?.id || null;
    this.changed(true);
    renderRibbon();
  },
  doUndo() { if (!this.undo.length) return; this.redo.push(JSON.stringify(this.project)); this.restore(this.undo.pop()); log('Desfeito.'); },
  doRedo() { if (!this.redo.length) return; this.undo.push(JSON.stringify(this.project)); this.restore(this.redo.pop()); log('Refeito.'); },

  selItens() {
    const s = this.selection;
    if (!s) return [];
    return s.kind === 'multi' ? s.itens : ['elemento', 'parede', 'viga', 'laje', 'desenho', 'ambiente'].includes(s.kind) ? [s] : [];
  },
  isSelected(ref) { return this.selItens().some((it) => it.ref === ref); },
  select(sel, silent) {
    this.selection = sel;
    if (sel?.kind === 'elemento' && sel.ref.circuitoId && !silent) this.activeCircuitId = sel.ref.circuitoId;
    plan.render(); renderProps(); renderTree(); syncCircuitSelect();
    if (sel && ['elemento', 'parede', 'viga', 'laje', 'desenho', 'ambiente', 'multi', 'eletroduto'].includes(sel.kind)) mostrarPainelSeSelecao();
  },
  selectMany(itens, add) {
    const atual = add ? this.selItens() : [];
    const todos = [...atual, ...itens.filter((it) => !atual.some((a) => a.ref === it.ref))];
    this.select(todos.length > 1 ? { kind: 'multi', itens: todos } : todos[0] || null, true);
    if (todos.length > 1) log(`${todos.length} elementos selecionados.`);
  },
  toggleSelect(hit) {
    const atual = this.selItens();
    const ja = atual.some((a) => a.ref === hit.ref);
    const todos = ja ? atual.filter((a) => a.ref !== hit.ref) : [...atual, hit];
    this.select(todos.length > 1 ? { kind: 'multi', itens: todos } : todos[0] || null, true);
  },
  remove(hit) {
    const itens = hit.kind === 'multi' ? hit.itens : [hit];
    this.commit('Apagar', () => {
      const f = this.floor;
      for (const it of itens) {
        const lista = { elemento: f.elementos, parede: f.paredes, viga: f.vigas, laje: f.lajes, desenho: f.desenho, ambiente: f.ambientes }[it.kind];
        const i = lista.indexOf(it.ref);
        if (i >= 0) lista.splice(i, 1);
      }
    });
    if (itens.some((it) => this.isSelected(it.ref))) this.select(null);
    log(itens.length > 1 ? `${itens.length} elementos apagados.` : 'Elemento apagado.');
  },
  copy() {
    const itens = this.selItens();
    if (!itens.length) return log('Selecione algo para copiar (arraste no vazio para selecionar por área).', 'warn');
    let minX = Infinity, minY = Infinity;
    for (const it of itens) {
      const r = it.ref;
      minX = Math.min(minX, r.x ?? Math.min(r.x1, r.x2)); minY = Math.min(minY, r.y ?? Math.min(r.y1, r.y2));
    }
    this.clipboard = { base: { x: minX, y: minY }, itens: itens.map((it) => ({ kind: it.kind, ref: JSON.parse(JSON.stringify(it.ref)) })) };
    log(`Bloco copiado: ${itens.length} elemento(s). Ctrl+V cola na posição do cursor (também em outro pavimento).`, 'ok');
  },
  paste() {
    const cb = this.clipboard;
    if (!cb) return log('Nada copiado.', 'warn');
    const alvo = plan.mouse.inside ? { x: plan.mouse.x, y: plan.mouse.y } : { x: cb.base.x + 1, y: cb.base.y + 1 };
    const dx = alvo.x - cb.base.x, dy = alvo.y - cb.base.y;
    const novos = [];
    this.commit('Colar bloco', () => {
      const f = this.floor;
      for (const it of cb.itens) {
        const r = JSON.parse(JSON.stringify(it.ref));
        r.id = this.uid({ elemento: 'E', parede: 'P', viga: 'V', laje: 'L', desenho: 'D', ambiente: 'A' }[it.kind]);
        if ('x' in r) { r.x += dx; r.y += dy; } else { r.x1 += dx; r.y1 += dy; r.x2 += dx; r.y2 += dy; }
        ({ elemento: f.elementos, parede: f.paredes, viga: f.vigas, laje: f.lajes, desenho: f.desenho, ambiente: f.ambientes })[it.kind].push(r);
        novos.push({ kind: it.kind, ref: r });
      }
    });
    this.selectMany(novos, false);
    log(`Bloco colado: ${novos.length} elemento(s).`, 'ok');
  },
  setTool(t) {
    plan.setTool(t);
    document.querySelectorAll('.rb[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    clearTimeout(flash);
    atualizaComando();
    this.refreshHint();
  },
  refreshHint() { $('#hint').textContent = plan.hint(); },
  setCoord(x, y) { $('#st-coord').textContent = `${fmt(x)} ; ${fmt(y)}`; },
  log: (t, k) => log(t, k),
};

// ---------------------------------------------------------------- mensagens
let flash = null;
function log(texto, kind = '') {
  const d = document.createElement('div');
  const h = new Date().toLocaleTimeString('pt-BR');
  d.innerHTML = `<span class="t">${h}</span><span class="${kind}">${esc(texto)}</span>`;
  $('#log').appendChild(d);
  $('#log').scrollTop = 1e9;
  // a última mensagem aparece na barra de status por alguns segundos
  $('#st-cmd').textContent = texto;
  $('#st-cmd').title = texto;
  clearTimeout(flash);
  flash = setTimeout(atualizaComando, 5000);
}
function atualizaComando() {
  const nome = TIPOS[plan.tool]?.nome || RIBBON_LABEL[plan.tool] || 'Selecione';
  $('#st-cmd').textContent = `Comando - ${nome}`;
}

function updateTitle() {
  const nome = store.filePath ? store.filePath.split(/[\\/]/).pop() : store.project.nome;
  const t = `${nome}${store.dirty ? ' *' : ''}`;
  $('#doc-title').textContent = `Vértice [${t}]`;
  host.setTitle(`${t} - Vértice`);
  $('#st-floor').textContent = `${store.floor.nome}${store.floor.intermediario ? ' (intermediário)' : ''} · cota ${fmt(store.floor.cota)} m`;
  const v = [...new Set(store.project.circuitos.map((c) => c.tensao))].join('/');
  $('#st-volt').textContent = v ? `${v} V` : '';
  renderDocTabs();
}

// ---------------------------------------------------------------- janelas (pavimento + disciplina)
const VISTAS = {
  arq: { nome: 'Arquitetura', icon: 'parede', foco: 'arq', rede: 'arq' },
  est: { nome: 'Estrutura', icon: 'pilar', foco: 'est', rede: 'est' },
  ele: { nome: 'Fiação', icon: 'raio', foco: 'ele', rede: 'ele' },
  af: { nome: 'Hidráulico', icon: 'hidro', foco: 'hid', sub: 'af', rede: 'af' },
  esg: { nome: 'Sanitário', icon: 'esgoto', foco: 'hid', sub: 'esg', rede: 'esg' },
  spda: { nome: 'SPDA', icon: 'spda', foco: 'spda', rede: 'spda' },
  '3d': { nome: 'Visão 3D', icon: 'vista3d' },
};
const REDES = [['ele', 'Elétrica'], ['af', 'Água fria'], ['esg', 'Esgoto'], ['est', 'Estrutura'], ['spda', 'SPDA'], ['arq', 'Arquitetura']];
const docs = { lista: [], ativo: null };
let docSeq = 0;

function abrirDoc(tipo, pavId = store.floor.id) {
  let d = docs.lista.find((x) => x.tipo === tipo && (tipo === '3d' || x.pavId === pavId));
  if (!d) { d = { id: ++docSeq, tipo, pavId: tipo === '3d' ? null : pavId }; docs.lista.push(d); }
  ativarDoc(d);
}
function ativarDoc(d) {
  docs.ativo = d;
  const v = VISTAS[d.tipo];
  if (d.tipo === '3d') {
    setView('3d');
  } else {
    const i = store.project.pavimentos.findIndex((p) => p.id === d.pavId);
    if (i < 0) return fecharDoc(d);
    if (i !== store.floorIdx) { store.floorIdx = i; store.selection = null; plan.start = null; view3d.invalidate(); }
    store.settings.foco = v.foco === 'arq' ? null : v.foco;
    store.settings.subrede = v.sub || null;
    store.rede = v.rede;
    setView('2d');
    renderProps();
  }
  if (currentTab === 'LANÇAMENTO') renderRibbon();
  syncRede();
  renderDocTabs(); renderTree(); updateTitle(); plan.render();
}
function fecharDoc(d) {
  const i = docs.lista.indexOf(d);
  if (i < 0) return;
  if (docs.lista.filter((x) => x.tipo !== '3d').length === 1 && d.tipo !== '3d') return log('Mantenha pelo menos uma janela de planta aberta.', 'warn');
  docs.lista.splice(i, 1);
  if (docs.ativo === d) ativarDoc(docs.lista[Math.max(0, i - 1)]);
  else renderDocTabs();
}
function renderDocTabs() {
  const box = $('#doc-tabs');
  // janelas de pavimentos excluídos somem
  docs.lista = docs.lista.filter((d) => d.tipo === '3d' || store.project.pavimentos.some((p) => p.id === d.pavId));
  box.innerHTML = docs.lista.map((d) => {
    const pav = store.project.pavimentos.find((p) => p.id === d.pavId);
    const nome = d.tipo === '3d' ? 'Visão 3D' : `${pav.nome} - ${VISTAS[d.tipo].nome}`;
    return `<div class="doc-tab${d === docs.ativo ? ' active' : ''}" data-id="${d.id}" title="${esc(nome)}">${ICONS[VISTAS[d.tipo].icon]}<span>${esc(nome)}</span><button class="x" title="Fechar">×</button></div>`;
  }).join('');
}
$('#doc-tabs').addEventListener('mousedown', (e) => {
  const t = e.target.closest('.doc-tab');
  if (!t) return;
  const d = docs.lista.find((x) => x.id === Number(t.dataset.id));
  if (e.target.classList.contains('x') || e.button === 1) { e.preventDefault(); return fecharDoc(d); }
  ativarDoc(d);
});

// ---------------------------------------------------------------- ribbon
// item: { id, label, run } | { id, label, tool: true } | { ..., small: true } | { id, label, menu: [...] } | { field }
const tool = (id, label, extra = {}) => ({ id, label, tool: true, ...extra });
const small = (o) => ({ ...o, small: true });
const APARELHOS = ['bacia', 'lavatorio', 'chuveiro', 'pia', 'tanque', 'mlr'];

const GRUPOS_LANCAMENTO = {
  ele: [
    { label: 'Quadro', items: [
      { id: 'qd', label: 'Quadro', menu: ['qd', 'qm', 'es', 'cp'].map((t) => tool(t, TIPOS[t].nome)) },
      small({ id: 'centro', label: 'Centro de cargas', run: () => toggleCentro(), active: () => store.settings.centroCargas }),
      small({ id: 'unifilar', label: 'Diagrama unifilar', run: () => diagramaUnifilar() }),
      small({ id: 'gerenciador', label: 'Associar quadros', run: () => mostrarPainel('gerenciador') }),
    ] },
    { label: 'Pontos', items: [
      { id: 'ponto', label: 'Ponto', menu: ['luz', 'arandela', 'ventilador', 'tug', 'tue', 'campainha'].map((t) => tool(t, TIPOS[t].nome)) },
      { id: 'interruptor', label: 'Comando', menu: ['interruptor', 'paralelo', 'intermediario', 'dimmer', 'sensor', 'pulsador'].map((t) => tool(t, TIPOS[t].nome)) },
      small(tool('luz', 'Lâmpada')), small(tool('interruptor', 'Interruptor')), small(tool('paralelo', 'Paralelo')),
      small(tool('tug', 'Tomada TUG')), small(tool('tue', 'Tomada TUE')), small(tool('arandela', 'Arandela')),
    ] },
    { label: 'Conduto', items: [
      tool('eletroduto', 'Eletroduto'),
      small(tool('cp', 'Caixa de passagem')),
      small({ id: 'caixaPassagem', label: 'Caixas automáticas', run: () => inserirCaixasPassagem() }),
      small({ id: 'dimensionar', label: 'Dimensionar eletrodutos', run: () => relatorioEletrodutos() }),
    ] },
    { label: 'Lançamento automático', items: [
      small(tool('distLuz', 'Distribuir lâmpadas')), small(tool('distTom', 'Distribuir tomadas')),
      small({ id: 'ambientes', label: 'Ambientes', run: () => reconhecerAmbientes() }),
    ] },
    { label: 'Circuitos e comandos', items: [
      { id: 'circuito', label: 'Novo circuito', run: () => novoCircuito() },
      small({ id: 'reserva', label: 'Circuito reserva', run: () => novaReserva() }),
      small(tool('atribuir', 'Definir circuito')), small(tool('atribComando', 'Definir comando')),
      { field: 'circuito-ativo' },
    ] },
    { label: 'Cálculo', items: [
      { id: 'processar', label: 'Processar', run: () => dialogoProcessar() },
      small({ id: 'verificar', label: 'Verificar', run: () => relatorioVerificacoes() }),
      small({ id: 'luminotecnico', label: 'Luminotécnico', run: () => relatorioLuminotecnicoGeral() }),
      small({ id: 'memorial', label: 'Memorial', run: () => memorialDescritivo() }),
    ] },
  ],
  af: [
    { label: 'Origem', items: [tool('reservatorio', 'Reservatório')] },
    { label: 'Pontos', items: [
      { id: 'pecas', label: 'Peça de utilização', menu: APARELHOS.map((t) => tool(t, TIPOS[t].nome)) },
      ...APARELHOS.map((t) => small(tool(t, TIPOS[t].nome.split(' ')[0]))),
    ] },
    { label: 'Cálculo', items: [{ id: 'hidro', label: 'Dimensionar água fria', run: () => relatorioAguaFria() }] },
  ],
  esg: [
    { label: 'Destino', items: [tool('ci', 'Caixa de inspeção')] },
    { label: 'Aparelhos', items: [
      { id: 'pecas', label: 'Aparelho sanitário', menu: APARELHOS.map((t) => tool(t, TIPOS[t].nome)) },
      ...APARELHOS.map((t) => small(tool(t, TIPOS[t].nome.split(' ')[0]))),
    ] },
    { label: 'Cálculo', items: [{ id: 'esgoto', label: 'Dimensionar esgoto', run: () => relatorioEsgoto() }] },
  ],
  est: [
    { label: 'Lançamento', items: [{ id: 'lancamento', label: 'Lançamento automático', run: () => lancarEstrutura() }] },
    { label: 'Elementos', items: [tool('pilar', 'Pilar'), tool('viga', 'Viga'), tool('laje', 'Laje')] },
    { label: 'Cálculo', items: [small({ id: 'calcEst', label: 'Vigas', run: () => relatorioVigas() }), small({ id: 'pilar', label: 'Pilares', run: () => relatorioPilares() }), small({ id: 'fundacao', label: 'Fundações', run: () => relatorioFundacoes() })] },
  ],
  spda: [
    { label: 'Proteção', items: [
      { id: 'spda', label: 'SPDA ativo', run: () => toggleSpda(), active: () => store.project.spda.ativo },
      { field: 'spda-nivel' },
    ] },
    { label: 'Cálculo', items: [{ id: 'malha', label: 'Relatório SPDA', run: () => relatorioSpda() }] },
  ],
  arq: [
    { label: 'Elementos', items: [tool('parede', 'Parede')] },
    { label: 'Referência', items: [{ id: 'paredesRef', label: 'Paredes do desenho', run: () => dialogoParedes() }] },
  ],
};

const RIBBON = [
  { tab: 'DESENHOS', groups: () => [
    { label: 'Construir', items: [small(tool('linha', 'Linha')), small(tool('retangulo', 'Retângulo')), small(tool('circulo', 'Círculo')), small(tool('texto', 'Texto')), small(tool('medir', 'Medir'))] },
    { label: 'Manipular', items: [
      tool('selecionar', 'Mover / selecionar', { id: 'selecionar' }),
      { id: 'rotacionar', label: 'Rotacionar 90°', run: () => transformar('rot') },
      { id: 'espelhar', label: 'Espelhar', run: () => transformar('espH') },
      small({ id: 'espelharV', label: 'Espelhar vertical', run: () => transformar('espV') }),
      small(tool('apagar', 'Apagar')),
    ] },
    { label: 'Editar', items: [
      { id: 'copiar', label: 'Copiar (clipboard)', run: () => store.copy() },
      { id: 'colar', label: 'Colar (clipboard)', run: () => store.paste() },
      small({ id: 'desfazer', label: 'Desfazer', run: () => store.doUndo() }), small({ id: 'refazer', label: 'Refazer', run: () => store.doRedo() }),
    ] },
    { label: 'Níveis', items: [{ id: 'camadas', label: 'Camadas', run: () => mostrarPainel('camadas') }, { field: 'chamadas' }] },
    { label: 'Filtro de seleção', items: [{ field: 'filtro' }] },
  ] },
  { tab: 'ELEMENTOS', groups: () => [
    { label: 'Arquitetura', items: [tool('parede', 'Parede')] },
    { label: 'Edificação', items: [
      { id: 'pavimento', label: 'Novo pavimento', run: () => novoPavimento() },
      { id: 'nivel', label: 'Nível intermediário', run: () => novoNivelIntermediario() },
    ] },
    { label: 'Estrutura', items: [tool('pilar', 'Pilar'), tool('viga', 'Viga'), tool('laje', 'Laje'), { id: 'lancamento', label: 'Lançamento automático', run: () => lancarEstrutura() }] },
    { label: 'Referência DWG/DXF', items: [
      { id: 'importarCad', label: 'Importar DWG/DXF', run: () => importarCad() },
      small({ id: 'camadas', label: 'Camadas', run: () => mostrarPainel('camadas') }),
      small({ id: 'paredesRef', label: 'Paredes do desenho', run: () => dialogoParedes() }),
      small({ id: 'removerRef', label: 'Remover referência', run: () => removerReferencia() }),
    ] },
  ] },
  { tab: 'LANÇAMENTO', groups: () => [
    { label: 'Rede', items: [{ field: 'rede' }] },
    ...GRUPOS_LANCAMENTO[store.rede || 'ele'],
    { label: '3D', items: [{ id: 'vista3d', label: 'Visão 3D geral', run: () => abrirDoc('3d') }] },
  ] },
  { tab: '3D', groups: () => [
    { label: 'Visualização', items: [
      { id: 'enquadrar', label: 'Enquadrar 3D', run: () => { abrirDoc('3d'); view3d.enquadrar(); } },
      { id: 'atualizar', label: 'Atualização completa', run: () => { abrirDoc('3d'); view3d.invalidate(); log('Modelo 3D atualizado.'); } },
    ] },
    { label: 'Vistas', items: ['topo', 'frente', 'lateral', 'iso'].map((v) => small({ id: v, label: { topo: 'Topo', frente: 'Frente', lateral: 'Lateral', iso: 'Isométrica' }[v], run: () => { abrirDoc('3d'); view3d.vista(v); } })) },
    { label: 'Configurações', items: [
      small({ id: 'ateAtual', label: 'Só até o pavimento atual', run: () => toggle3d('so3dAteAtual'), active: () => store.settings.so3dAteAtual }),
      small({ id: 'planos', label: 'Planos dos pavimentos', run: () => toggle3d('planos3d'), active: () => store.settings.planos3d }),
      small({ id: 'ortografica', label: 'Projeção ortográfica', run: () => { store.settings.orto3d = !store.settings.orto3d; view3d.setOrtografica(store.settings.orto3d); renderRibbon(); }, active: () => store.settings.orto3d }),
      { field: 'fundo3d' },
    ] },
    { label: 'Corte', items: [{ field: 'corte' }] },
    { label: 'Disciplinas visíveis', items: Object.entries({ arq: 'parede', est: 'pilar', ele: 'raio', hid: 'hidro', spda: 'spda', fundo: 'camadas' }).map(([d, ic]) => small({
      id: ic, label: DISCIPLINAS[d].replace('Referência DWG/DXF', 'Referência'), run: () => toggleVis(d), active: () => store.settings.vis[d],
    })) },
  ] },
  { tab: 'OPERAÇÕES', groups: () => [
    { label: 'Dimensionamento', items: [
      { id: 'processar', label: 'Processar', run: () => dialogoProcessar() },
      small({ id: 'dimensionar', label: 'Dimensionar eletrodutos', run: () => relatorioEletrodutos() }),
      small({ id: 'caixaPassagem', label: 'Caixas de passagem', run: () => inserirCaixasPassagem() }),
      small({ id: 'verificar', label: 'Verificar projeto', run: () => relatorioVerificacoes() }),
    ] },
    { label: 'Gerenciador', items: [
      small({ id: 'gerenciador', label: 'Gerenciador', run: () => mostrarPainel('gerenciador') }),
      small({ id: 'renumerar', label: 'Renumerar circuitos', run: () => renumerarCircuitos() }),
      small({ id: 'eliminar', label: 'Eliminar não utilizados', run: () => eliminarNaoUtilizados() }),
    ] },
    { label: 'Tabelas', items: [
      { id: 'materiais', label: 'Lista de materiais', run: () => relatorioMateriais() },
      small({ id: 'cargas', label: 'Quadro de cargas', run: () => relatorioCargas() }),
      small({ id: 'demanda', label: 'Quadro de demanda', run: () => relatorioDemanda() }),
      small({ id: 'legenda', label: 'Legenda de fiação', run: () => relatorioLegendaFiacao() }),
      small({ id: 'simbolos', label: 'Legenda de símbolos', run: () => relatorioSimbolos() }),
      small({ id: 'luminotecnico', label: 'Luminotécnico', run: () => relatorioLuminotecnicoGeral() }),
    ] },
    { label: 'Diagramas', items: [
      { id: 'unifilar', label: 'Diagrama unifilar', run: () => diagramaUnifilar() },
      small({ id: 'unifilar', label: 'Unifilar geral', run: () => diagramaUnifilarGeral() }),
      small({ id: 'multifilar', label: 'Multifilar', run: () => diagramaMultifilar() }),
      small({ id: 'executivo', label: 'Quadro executivo', run: () => quadroExecutivo() }),
    ] },
    { label: 'Exibir', items: [
      { field: 'planta' },
      small({ id: 'numerica', label: 'Indicação numérica', run: () => toggleSetting('indicacaoNumerica'), active: () => store.settings.indicacaoNumerica }),
      small({ id: 'otimizar', label: 'Otimizar indicações', run: () => toggleSetting('otimizar'), active: () => store.settings.otimizar !== false }),
    ] },
    { label: 'Disciplinas', items: [{ id: 'predio', label: 'Outras disciplinas', menu: [
      { id: 'calcEst', label: 'Vigas', run: () => relatorioVigas() }, { id: 'pilar', label: 'Pilares', run: () => relatorioPilares() }, { id: 'fundacao', label: 'Fundações', run: () => relatorioFundacoes() },
      { id: 'hidro', label: 'Água fria', run: () => relatorioAguaFria() }, { id: 'esgoto', label: 'Esgoto', run: () => relatorioEsgoto() }, { id: 'malha', label: 'SPDA', run: () => relatorioSpda() },
    ] }] },
    { label: 'Entrega', items: [
      { id: 'prancha', label: 'Pranchas', run: () => dialogoPranchas() },
      small({ id: 'memorial', label: 'Memorial descritivo', run: () => memorialDescritivo() }),
      small({ id: 'ifc', label: 'Exportar IFC (BIM)', run: () => exportarModeloIfc() }),
      small({ id: 'exportarCad', label: 'DWG / DXF', run: () => exportarCad(true) }),
      small({ id: 'exportar', label: 'Relatório HTML', run: () => exportarRelatorioCompleto() }),
    ] },
  ] },
];
const ARQUIVO = () => [
  { label: 'Projeto', items: [
    { id: 'novo', label: 'Novo', run: () => novoProjeto() },
    { id: 'abrir', label: 'Abrir', run: () => abrir() },
    { id: 'salvar', label: 'Salvar', run: () => salvar() },
    { id: 'salvar', label: 'Salvar como', run: () => salvar(true) },
  ] },
  { label: 'DWG / DXF', items: [
    { id: 'importarCad', label: 'Importar DWG/DXF', run: () => importarCad() },
    { id: 'exportarCad', label: 'Exportar pavimento', run: () => exportarCad(false) },
    { id: 'exportarCad', label: 'Exportar todos', run: () => exportarCad(true) },
  ] },
  { label: 'Entrega', items: [
    { id: 'prancha', label: 'Pranchas (PDF)', run: () => dialogoPranchas() },
    { id: 'ifc', label: 'Exportar IFC', run: () => exportarModeloIfc() },
    { id: 'exportar', label: 'Relatório HTML', run: () => exportarRelatorioCompleto() },
  ] },
  { label: 'Projeto', items: [{ id: 'configuracoes', label: 'Configurações', run: () => { store.select({ kind: 'projeto' }); mostrarPainel('propriedades'); } }] },
];
const todosItens = () => [...RIBBON.flatMap((t) => t.groups()), ...Object.values(GRUPOS_LANCAMENTO).flat()].flatMap((g) => g.items.flatMap((i) => [i, ...(i.menu || [])]));
const RIBBON_LABEL = {};
let currentTab = 'LANÇAMENTO';

function renderRibbon() {
  const tabs = $('#ribbon-tabs');
  tabs.innerHTML = '';
  for (const nome of ['ARQUIVO', ...RIBBON.map((t) => t.tab)]) {
    const b = document.createElement('button');
    b.textContent = nome;
    b.className = (nome === 'ARQUIVO' ? 'file' : '') + (nome === currentTab ? ' active' : '');
    b.onclick = () => { currentTab = nome; renderRibbon(); };
    tabs.appendChild(b);
  }
  const groups = currentTab === 'ARQUIVO' ? ARQUIVO() : RIBBON.find((t) => t.tab === currentTab).groups();
  for (const it of todosItens()) if (it.tool && !RIBBON_LABEL[it.id]) RIBBON_LABEL[it.id] = it.label;
  const rb = $('#ribbon');
  rb.innerHTML = '';
  for (const g of groups) {
    const ge = document.createElement('div');
    ge.className = 'group';
    const items = document.createElement('div');
    items.className = 'group-items';
    let col = null;
    for (const it of g.items) {
      if (it.field) { col = null; items.appendChild(campoRibbon(it.field)); continue; }
      const b = document.createElement('button');
      b.className = it.small ? 'sb' : 'rb';
      b.innerHTML = (ICONS[it.icon || it.id] || ICONS.ponto) + `<span>${esc(it.label)}</span>` + (it.menu ? '<span class="dd">▼</span>' : '');
      b.title = it.label;
      if (it.tool) { b.dataset.tool = it.id; if (plan.tool === it.id) b.classList.add('active'); b.onclick = () => store.setTool(it.id); }
      else if (it.menu) b.onclick = () => abrirMenu(b, it.menu);
      else b.onclick = it.run;
      if (it.active?.()) b.classList.add('active');
      if (it.small) {
        // botões pequenos empilham em colunas de três
        if (!col || col.children.length === 3) { col = document.createElement('div'); col.className = 'col'; items.appendChild(col); }
        col.appendChild(b);
      } else { col = null; items.appendChild(b); }
    }
    ge.appendChild(items);
    const l = document.createElement('div');
    l.className = 'group-label';
    l.textContent = g.label;
    ge.appendChild(l);
    rb.appendChild(ge);
  }
  syncCircuitSelect();
}

function abrirMenu(btn, itens) {
  const m = $('#menu');
  m.innerHTML = itens.map((it, i) => `<button data-i="${i}">${ICONS[it.id] || ''}<span>${esc(it.label)}</span></button>`).join('');
  const r = btn.getBoundingClientRect();
  Object.assign(m.style, { left: r.left + 'px', top: r.bottom + 1 + 'px' });
  m.hidden = false;
  m.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const it = itens[Number(b.dataset.i)];
    m.hidden = true;
    if (it.tool) store.setTool(it.id); else it.run?.();
  };
}
window.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu') && !e.target.closest('.rb, .sb')) $('#menu').hidden = true; });

function campoRibbon(tipo) {
  const f = document.createElement('div');
  f.className = 'rb-field';
  if (tipo === 'rede') {
    const pos = [['', '-'], [0.3, 'Baixa (0,30)'], [1.1, 'Média (1,10)'], [2.2, 'Alta (2,20)'], ['teto', 'Teto']];
    f.innerHTML = `<label>Rede</label><select id="sel-rede">${REDES.map(([v, n]) => `<option value="${v}"${store.rede === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label>Altura</label><input id="in-altura" type="number" step="0.05" placeholder="padrão do ponto" value="${store.settings.altura ?? ''}">
      <label>Posição</label><select id="sel-pos">${pos.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>`;
    f.querySelector('#sel-rede').onchange = (e) => trocarRede(e.target.value);
    f.querySelector('#in-altura').onchange = (e) => { store.settings.altura = e.target.value === '' ? null : Number(e.target.value); };
    f.querySelector('#sel-pos').onchange = (e) => {
      const v = e.target.value;
      store.settings.altura = v === '' ? null : v === 'teto' ? store.floor.peDireito : Number(v);
      f.querySelector('#in-altura').value = store.settings.altura ?? '';
    };
  } else if (tipo === 'circuito-ativo') {
    f.innerHTML = `<label>Circuito</label><select id="sel-circuito"></select><label>Comando</label><select id="sel-comando">${LETRAS.map((l) => `<option${(store.settings.comandoAtivo || 'a') === l ? ' selected' : ''}>${l}</option>`).join('')}</select><label>Tipo</label><span id="circ-info"></span>`;
    f.querySelector('#sel-comando').onchange = (e) => { store.settings.comandoAtivo = e.target.value; store.refreshHint(); };
  } else if (tipo === 'spda-nivel') {
    f.innerHTML = `<label>Nível</label><select id="sel-nivel">${Object.keys(NIVEIS).map((n) => `<option${store.project.spda.nivel === n ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label>Malha</label><span>${NIVEIS[store.project.spda.nivel].malha} × ${NIVEIS[store.project.spda.nivel].malha} m</span><label>Descidas</label><span>a cada ${NIVEIS[store.project.spda.nivel].descidas} m</span>`;
    f.querySelector('select').onchange = (e) => { store.commit('Nível SPDA', () => { store.project.spda.nivel = e.target.value; }); renderRibbon(); };
  } else if (tipo === 'chamadas') {
    const op = (d) => `<select data-d="${d}">${[['simples', 'Simples'], ['circulo', 'Círculo'], ['retangulo', 'Retângulo']].map(([v, l]) => `<option value="${v}"${store.settings.chamada[d] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    f.innerHTML = `<label>Chamada elét.</label>${op('ele')}<label>Chamada hidr.</label>${op('hid')}<label>Chamada estr.</label>${op('est')}`;
    f.querySelectorAll('select').forEach((s) => (s.onchange = () => { store.settings.chamada[s.dataset.d] = s.value; plan.render(); }));
  } else if (tipo === 'filtro') {
    const op = [['todos', 'Todos os elementos'], ['arq', 'Paredes'], ['est', 'Estrutura'], ['ele', 'Elétrico'], ['hid', 'Hidrossanitário'], ['desenho', 'Desenho (linhas e textos)']];
    f.innerHTML = `<label>Classe</label><select id="sel-filtro">${op.map(([v, n]) => `<option value="${v}"${store.settings.filtro === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label></label><button class="btn" id="sel-apenas" style="min-width:0;padding:1px 8px">Selecionar apenas</button>`;
    f.querySelector('#sel-filtro').onchange = (e) => { store.settings.filtro = e.target.value; log(`Filtro de seleção: ${e.target.selectedOptions[0].text}.`); };
    f.querySelector('#sel-apenas').onclick = () => selecionarTudo(true);
  } else if (tipo === 'planta') {
    const op = [['completa', 'Completa'], ['iluminacao', 'Iluminação (luz)'], ['tomadas', 'Tomadas (força)'], ['alimentacao', 'Alimentação']];
    f.innerHTML = `<label>Planta</label><select id="sel-planta">${op.map(([v, n]) => `<option value="${v}"${(store.settings.planta || 'completa') === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    f.querySelector('select').onchange = (e) => { store.settings.planta = e.target.value; plan.render(); log(`Planta exibida: ${e.target.selectedOptions[0].text}.`); };
  } else if (tipo === 'fundo3d') {
    const op = [['#f4f6f9', 'Claro'], ['#ffffff', 'Branco'], ['#c9d3de', 'Cinza'], ['#20262d', 'Escuro']];
    f.innerHTML = `<label>Fundo</label><select>${op.map(([v, n]) => `<option value="${v}"${store.settings.fundo3d === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    f.querySelector('select').onchange = (e) => { store.settings.fundo3d = e.target.value; view3d.setFundo(e.target.value); };
  } else if (tipo === 'corte') {
    const max = Math.max(...store.project.pavimentos.map((p) => p.cota + p.peDireito)) + 1;
    const h = store.settings.corte ?? max;
    f.classList.add('wide');
    f.innerHTML = `<label>Ativo</label><input type="checkbox" id="corte-on" style="height:auto;justify-self:start" ${store.settings.corte != null ? 'checked' : ''}>
      <label>Altura</label><input type="range" id="corte-h" min="0" max="${max.toFixed(1)}" step="0.05" value="${h}"><label></label><span id="corte-v">${fmt(h)} m</span>`;
    const aplica = () => {
      const on = f.querySelector('#corte-on').checked, v = Number(f.querySelector('#corte-h').value);
      store.settings.corte = on ? v : null;
      f.querySelector('#corte-v').textContent = `${fmt(v)} m`;
      view3d.setCorte(store.settings.corte);
      if (on && docs.ativo?.tipo !== '3d') abrirDoc('3d');
    };
    f.querySelector('#corte-on').onchange = aplica;
    f.querySelector('#corte-h').oninput = aplica;
  }
  return f;
}

function trocarRede(r) {
  store.rede = r;
  // a janela de planta ativa passa a mostrar a rede escolhida
  if (docs.ativo && docs.ativo.tipo !== '3d') abrirDoc(r, docs.ativo.pavId); else renderRibbon();
}
function syncRede() { const s = $('#sel-rede'); if (s) s.value = store.rede; }

function syncCircuitSelect() {
  const sel = $('#sel-circuito');
  if (!sel) return;
  sel.innerHTML = store.project.circuitos.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  sel.value = store.activeCircuitId || '';
  sel.onchange = () => { store.activeCircuitId = sel.value; syncCircuitSelect(); plan.render(); renderTree(); store.refreshHint(); };
  const c = store.activeCircuit;
  $('#circ-info').innerHTML = c ? `<span class="swatch" style="background:${corCircuito(store.project, c.id)}"></span> ${c.tipo} · ${c.tensao} V` : '-';
}

// ---------------------------------------------------------------- painel lateral
const PAINEIS = [['edificacao', 'edificacao', 'Edificação'], ['gerenciador', 'gerenciador', 'Gerenciador elétrico'], ['propriedades', 'propriedades', 'Propriedades'], ['camadas', 'camadas', 'Camadas'], ['mensagens', 'mensagens', 'Mensagens']];
let painelAtual = 'edificacao';
function mostrarPainel(nome) {
  painelAtual = nome;
  $('#workspace').classList.remove('dock-hidden');
  document.querySelectorAll('#dock-panels .panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === nome));
  document.querySelectorAll('#dock-switch button').forEach((b) => b.classList.toggle('on', b.dataset.p === nome));
  $('#dock-title').textContent = PAINEIS.find((p) => p[0] === nome)[2];
  if (nome === 'camadas') renderCamadas();
  if (nome === 'gerenciador') renderGerenciador();
  if (nome === 'mensagens') $('#msgs').scrollTop = 1e9;
}
$('#dock-switch').innerHTML = PAINEIS.map(([p, ic, t]) => `<button data-p="${p}" title="${t}">${ICONS[ic]}</button>`).join('');
$('#dock-switch').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) mostrarPainel(b.dataset.p); });
$('#dock-close').onclick = () => $('#workspace').classList.add('dock-hidden');

function renderCamadas() {
  const f = store.floor.fundo;
  const vis = store.settings.vis;
  const disc = Object.entries(DISCIPLINAS).map(([d, n]) => `<label class="camada-row"><input type="checkbox" data-d="${d}" ${vis[d] !== false ? 'checked' : ''}>${esc(n)}</label>`).join('');
  const ref = f ? `<div class="camada-head">Referência: ${esc(f.arquivo)}</div>
    <div class="camada-row"><button class="btn" data-todas="1" style="min-width:0">Todas</button><button class="btn" data-todas="0" style="min-width:0">Nenhuma</button></div>
    ${f.camadas.map((c, i) => `<label class="camada-row"><input type="checkbox" data-i="${i}" ${c.vis ? 'checked' : ''}><span class="swatch" style="background:${corAci(c.cor)}"></span>${esc(c.nome)}</label>`).join('')}`
    : `<div class="empty">Sem desenho de referência no ${esc(store.floor.nome)}. Use ELEMENTOS › Importar DWG/DXF.</div>`;
  $('#camadas').innerHTML = `<div class="camada-head">Disciplinas</div>${disc}${ref}`;
  $('#camadas').onchange = (e) => {
    const t = e.target;
    if (t.dataset.d) { store.settings.vis[t.dataset.d] = t.checked; plan.render(); view3d.invalidate(); renderRibbon(); }
    if (t.dataset.i != null && f) { f.camadas[Number(t.dataset.i)].vis = t.checked; store.dirty = true; plan.render(); renderTree(); }
  };
  $('#camadas').onclick = (e) => {
    const b = e.target.closest('[data-todas]');
    if (!b || !f) return;
    for (const c of f.camadas) c.vis = b.dataset.todas === '1';
    store.dirty = true; plan.render(); renderCamadas();
  };
}

// ---------------------------------------------------------------- árvore Edificação
const collapsed = new Set(['circ', 'redes']);
function renderTree() {
  const p = store.project;
  const node = (key, icon, label, opts = {}) => {
    const kids = opts.children;
    const open = kids && !collapsed.has(key);
    return `<li><div class="node${opts.sel ? ' sel' : ''}${opts.aberto ? ' open-view' : ''}" data-key="${esc(key)}"${opts.act ? ` data-act="${esc(opts.act)}"` : ''}${opts.dbl ? ` data-dbl="${esc(opts.dbl)}"` : ''}>
      <span class="tw">${kids ? (open ? '▼' : '▶') : ''}</span>${icon}<span class="lbl">${esc(label)}</span>${opts.badge != null ? `<span class="badge">${esc(opts.badge)}</span>` : ''}</div>
      ${kids && open ? `<ul>${kids}</ul>` : ''}</li>`;
  };
  const sw = (cor) => `<span class="swatch" style="background:${cor}"></span>`;
  const conta = (pv) => ({
    arq: pv.paredes.length + (pv.desenho?.length || 0),
    est: pv.vigas.length + pv.lajes.length + pv.elementos.filter((e) => e.tipo === 'pilar').length,
    ele: pv.elementos.filter((e) => TIPOS[e.tipo]?.disc === 'ele').length,
    af: pv.elementos.filter((e) => TIPOS[e.tipo]?.peso != null || e.tipo === 'reservatorio').length,
    esg: pv.elementos.filter((e) => TIPOS[e.tipo]?.uhc != null || e.tipo === 'ci').length,
  });
  const pavs = [...p.pavimentos].reverse().map((pv) => {
    const i = p.pavimentos.indexOf(pv);
    const n = conta(pv);
    const vistas = ['arq', 'est', 'ele', 'af', 'esg', 'spda'].map((t) => {
      const aberto = docs.lista.some((d) => d.tipo === t && d.pavId === pv.id);
      const ativo = docs.ativo?.tipo === t && docs.ativo.pavId === pv.id;
      return node(`pv${i}-${t}`, ICONS[VISTAS[t].icon], VISTAS[t].nome, { badge: n[t] ?? (t === 'spda' && store.spda.ativo ? '' : null), dbl: `vista:${t}:${pv.id}`, act: `vista:${t}:${pv.id}`, sel: ativo, aberto });
    });
    if (pv.fundo) vistas.push(node(`pv${i}-ref`, ICONS.importarCad, pv.fundo.arquivo, { badge: `${pv.fundo.camadas.filter((c) => c.vis).length}/${pv.fundo.camadas.length}`, act: 'camadas' }));
    return node(`pv${i}`, pv.intermediario ? ICONS.nivel : ICONS.camada, `${pv.nome}`, { children: vistas.join(''), sel: i === store.floorIdx && docs.ativo?.tipo !== '3d', act: `pav:${i}`, badge: `${fmt(pv.cota)} m` });
  }).join('');
  const circs = store.results.map((r) => node(`c-${r.circuito.id}`, sw(corCircuito(p, r.circuito.id)), r.circuito.nome, {
    badge: `${Math.round(r.potencia)} VA`, sel: r.circuito.id === store.activeCircuitId, act: `circ:${r.circuito.id}`,
  })).join('');
  const hid = store.hid;
  const redes = [
    node('rel-af', sw('#1593a6'), 'Água fria', { badge: `${hid.af.segmentos.length} trechos`, act: 'rel:af' }),
    node('rel-esg', sw('#8a5a2b'), 'Esgoto', { badge: `${hid.esg.segmentos.length} trechos`, act: 'rel:esg' }),
  ].join('');
  $('#tree').innerHTML = `<div class="tree"><ul>${node('root', ICONS.predio, p.nome, {
    act: 'projeto',
    children: pavs
      + node('m3d', ICONS.vista3d, 'Modelos 3D', { children: node('v3d', ICONS.vista3d, 'Visão 3D geral', { dbl: 'vista:3d', act: 'vista:3d', sel: docs.ativo?.tipo === '3d' }) })
      + node('circ', ICONS.raio, 'Circuitos', { children: circs || '<li class="empty">Nenhum circuito.</li>', badge: p.circuitos.length })
      + node('redes', ICONS.hidro, 'Redes hidráulicas', { children: redes })
      + node('spda', ICONS.spda, 'SPDA', { badge: store.spda.ativo ? `nível ${p.spda.nivel}` : 'desativado', act: 'rel:spda' }),
  })}</ul></div><div class="tree-hint">Duplo clique abre a janela do pavimento.</div>`;
}

$('#tree').addEventListener('click', (e) => {
  const n = e.target.closest('.node');
  if (!n) return;
  const key = n.dataset.key;
  if (e.target.classList.contains('tw')) {
    collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
    return renderTree();
  }
  const act = n.dataset.act || '';
  if (act.startsWith('pav:')) {
    store.selection = { kind: 'pavimento', ref: store.project.pavimentos[Number(act.slice(4))] };
    renderProps(); mostrarPainelSeSelecao();
  } else if (act.startsWith('circ:')) {
    store.activeCircuitId = act.slice(5);
    store.selection = { kind: 'circuito', ref: store.activeCircuit };
    syncCircuitSelect(); plan.render(); renderTree(); renderProps();
  } else if (act === 'camadas') mostrarPainel('camadas');
  else if (act === 'projeto') { store.selection = { kind: 'projeto' }; renderProps(); }
});
$('#tree').addEventListener('dblclick', (e) => {
  const n = e.target.closest('.node');
  const act = n?.dataset.dbl || n?.dataset.act || '';
  if (act.startsWith('vista:')) {
    const [, tipo, pavId] = act.split(':');
    abrirDoc(tipo, pavId);
  } else if (act === 'rel:af') relatorioAguaFria();
  else if (act === 'rel:esg') relatorioEsgoto();
  else if (act === 'rel:spda') relatorioSpda();
  else if (act.startsWith('pav:')) abrirDoc(docs.ativo?.tipo !== '3d' ? docs.ativo.tipo : 'ele', store.project.pavimentos[Number(act.slice(4))].id);
});

function setFloor(i) {
  const tipo = docs.ativo && docs.ativo.tipo !== '3d' ? docs.ativo.tipo : 'arq';
  abrirDoc(tipo, store.project.pavimentos[i].id);
  store.selection = { kind: 'pavimento', ref: store.floor };
  renderProps();
}
function mostrarPainelSeSelecao() {
  if (painelAtual !== 'propriedades') mostrarPainel('propriedades');
}

// ---------------------------------------------------------------- barra de status
const ESCALAS = [20, 25, 50, 75, 100, 125, 200, 250, 500, 1000];
function renderStatus() {
  const t = [
    ['enquadrar', 'Zoom extensão', () => plan.zoomExtents()], ['zoomMais', 'Aproximar', () => plan.zoomPor(1.25)], ['zoomMenos', 'Afastar', () => plan.zoomPor(0.8)],
    null,
    ['grade', 'Grade (F7)', () => toggleSetting('grid'), 'grid'], ['ponto', 'Snap (F9)', () => toggleSetting('snap'), 'snap'], ['orto', 'Ortogonal (F8)', () => toggleSetting('orto'), 'orto'],
    null,
    ['filtro', 'Filtro de seleção', () => { currentTab = 'DESENHOS'; renderRibbon(); }],
  ];
  $('#st-tools').innerHTML = t.map((x, i) => (x ? `<button data-i="${i}" title="${x[1]}" class="${x[3] && store.settings[x[3]] ? 'on' : ''}">${ICONS[x[0]]}</button>` : '<span class="st-sep"></span>')).join('');
  $('#st-tools').onclick = (e) => { const b = e.target.closest('button'); if (b) t[Number(b.dataset.i)][2](); };
}
function syncEscala() {
  const sel = $('#st-escala');
  const n = plan.escala;
  const lista = ESCALAS.includes(n) ? ESCALAS : [...ESCALAS, n].sort((a, b) => a - b);
  if (sel.dataset.n !== String(n)) {
    sel.innerHTML = lista.map((v) => `<option value="${v}"${v === n ? ' selected' : ''}>1:${v}</option>`).join('');
    sel.dataset.n = String(n);
  }
}
$('#st-escala').onchange = (e) => { plan.setEscala(Number(e.target.value)); store.settings.escala = Number(e.target.value); };

// ---------------------------------------------------------------- propriedades
const LETRAS = 'abcdefghijklmnop'.split('');
function renderProps() {
  const sel = store.selection;
  const box = $('#props');
  const row = (label, html) => `<tr><td title="${esc(label)}">${esc(label)}</td><td>${html}</td></tr>`;
  const ro = (v, cor) => `<span class="ro"${cor ? ` style="color:${cor}"` : ''}>${esc(v)}</span>`;
  const inp = (k, v, type = 'number', step = '0.01') => `<input data-k="${k}" type="${type}" ${type === 'number' ? `step="${step}"` : ''} value="${esc(v ?? '')}">`;
  const opts = (k, v, list, extra = '') => `<select data-k="${k}" ${extra}>${list.map(([val, lab]) => `<option value="${esc(val)}"${String(val) === String(v ?? '') ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  const sim = (k, v) => opts(k, v ? 'true' : 'false', [['true', 'Sim'], ['false', 'Não']], 'data-bool="1"');
  const th = (t) => `<tr><th colspan="2">${esc(t)}</th></tr>`;
  const avisos = (lista) => (lista?.length ? `<tr><td colspan="2" class="aviso">${lista.map(esc).join('<br>')}</td></tr>` : '');
  const alertasDe = (id) => (store.ele?.alertas.get(id) || []).map((a) => `${a.nivel === 'erro' ? '⛔' : '⚠'} ${a.texto}`);
  const botoes = (lista) => `<div class="props-acoes">${lista.map(([id, t]) => `<button class="btn" data-acao="${id}">${esc(t)}</button>`).join('')}</div>`;
  const cfg = store.project.eletrica;
  const quadrosDoProjeto = () => store.project.pavimentos.flatMap((pv) => pv.elementos.filter((e) => TIPOS[e.tipo]?.quadro));
  let html = '';

  if (!sel) {
    const f = store.floor;
    html = `<table class="props">${th('Desenho')}${row('Janela', ro(docs.ativo ? (docs.ativo.tipo === '3d' ? 'Visão 3D' : `${f.nome} - ${VISTAS[docs.ativo.tipo].nome}`) : '-'))}
      ${row('Pavimento', ro(f.nome))}${row('Cota', ro(`${fmt(f.cota)} m`))}${row('Pé-direito', ro(`${fmt(f.peDireito)} m`))}
      ${th('Escala')}${row('Planta baixa', ro(`1:${plan.escala}`))}
      ${th('Projeto')}${row('Título', ro(store.project.nome))}${row('Autor', ro(store.project.autor || '-'))}${row('Data', ro(new Date().toLocaleDateString('pt-BR')))}
      ${th('Seleção')}<tr><td colspan="2" class="nota">Clique num elemento, ou arraste no vazio para selecionar por área (da direita para a esquerda pega o que toca). No 3D: Shift + arrastar. Passe o mouse sobre um triângulo de alerta para ver o problema.</td></tr></table>`;
  } else if (sel.kind === 'multi') {
    const cont = {};
    for (const it of sel.itens) {
      const nome = it.kind === 'elemento' ? TIPOS[it.ref.tipo].nome : { parede: 'Parede', viga: 'Viga', laje: 'Laje', desenho: 'Desenho (linhas e textos)', ambiente: 'Ambiente' }[it.kind];
      cont[nome] = (cont[nome] || 0) + 1;
    }
    const eles = sel.itens.filter((it) => it.kind === 'elemento' && TIPOS[it.ref.tipo].disc === 'ele' && !TIPOS[it.ref.tipo].quadro);
    html = `<table class="props">${th(`Seleção (${sel.itens.length})`)}${Object.entries(cont).map(([k, v]) => row(k, ro(v))).join('')}
      ${eles.length ? th('Atribuir aos pontos elétricos') + row('Circuito', `<select id="m-circ"><option value="">(manter)</option>${store.project.circuitos.filter((c) => c.tipo !== 'RESERVA').map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('')}</select>`) : ''}</table>
      ${botoes([['copiar', 'Copiar bloco'], ['apagar', 'Apagar']])}`;
  } else if (sel.kind === 'elemento') {
    const e = sel.ref;
    const t = TIPOS[e.tipo];
    html = `<table class="props">${th(t.nome)}${row('Identificador', ro(e.id))}${row(t.quadro ? 'Nome' : 'Descrição', inp('descricao', e.descricao, 'text'))}
      ${row('X (m)', inp('x', e.x))}${row('Y (m)', inp('y', e.y))}`;
    if (e.tipo === 'pilar') {
      const r = store.est.pilares.find((x) => x.pilar === e);
      html += `${row('Largura b (cm)', inp('b', e.b, 'number', '1'))}${row('Altura h (cm)', inp('h', e.h, 'number', '1'))}
        ${th('Pré-dimensionamento')}${r ? `${row('Carga do pavimento', ro(`${fmt(r.local, 1)} kN`))}${row('Carga de cima', ro(`${fmt(r.deCima, 1)} kN`))}
        ${row('Peso próprio', ro(`${fmt(r.pp, 1)} kN`))}${row('N total (caract.)', ro(`${fmt(r.N, 1)} kN`))}${row('Nd (com excentric.)', ro(`${fmt(r.Nd, 1)} kN`))}
        ${row('As adotada', ro(r.barras ? `${r.barras.n} φ ${fmtSec(r.barras.phi)} mm (${fmt(r.barras.As)} cm²)` : '—'))}${row('Taxa', ro(`${fmt(r.taxa * 100)} %`))}${avisos(r.avisos)}` : ''}`;
    } else {
      html += row('Altura de instalação (m)', inp('altura', e.altura));
      if (t.disc === 'ele' && t.quadro) {
        const rq = store.ele.quadros.find((q) => q.quadro === e);
        const outros = quadrosDoProjeto().filter((q) => q !== e && q.tipo !== 'qd' || (q !== e && q.tipo === 'qd' && e.tipo === 'qd'));
        html += `${th('Quadro')}${row('Esquema', opts('esquema', e.esquema || '2F+N', Object.keys(ESQUEMAS).map((k) => [k, k])))}
          ${e.tipo !== 'es' ? row('Alimentado por', opts('alimentadoPor', e.alimentadoPor || '', [['', '(nenhum)'], ...outros.map((q) => [q.id, store.nomeQuadro(q)])])) : ''}
          ${e.tipo === 'qd' ? row('DPS', sim('dps', e.dps !== false)) + row('Peça (módulos DIN)', opts('modulosPeca', e.modulosPeca ?? '', [['', 'Automático'], ...MODULOS_QD.map((m) => [m, `${m} módulos`])], 'data-num="1"')) : ''}`;
        if (rq) {
          html += `${th('Cargas')}${row('Instalada', ro(`${fmt(rq.instaladaTotal, 0)} VA`))}${row('Demanda', ro(`${fmt(rq.demanda, 0)} VA`))}
            ${rq.fasesQ.map((f) => row(`Fase ${f}`, ro(`${fmt(rq.fases[f], 0)} VA`))).join('')}
            ${row('Desequilíbrio', ro(`${fmt(rq.deseq * 100, 1)} %`, rq.deseq > 0.15 ? 'var(--danger)' : ''))}
            ${th('Proteção e alimentação')}${row('Disjuntor geral', ro(rq.disjuntorGeral ? `${rq.fasesQ.length}P ${rq.disjuntorGeral} A` : '—'))}
            ${row('Alimentador', ro(rq.alimentador?.secao ? `${rq.alimentador.condutores} ${fmtSec(rq.alimentador.secao)} mm²` : '—'))}
            ${rq.alimentador?.pai ? row('Comprimento / ΔV', ro(`${fmt(rq.alimentador.L, 1)} m / ${fmt(rq.alimentador.queda ?? 0)} %`)) : ''}
            ${e.tipo === 'qd' ? `${row('Grupos DR', ro(rq.drGrupos.map((g, i) => `DR${i + 1} ${g.polos}P ${g.nominal} A`).join(', ') || '—'))}
            ${row('Reservas', ro(`${rq.reservas} (mínimo ${rq.reservasMin})`, rq.reservas < rq.reservasMin ? 'var(--danger)' : ''))}
            ${row('Módulos DIN', ro(`${rq.modulos} → quadro de ${rq.tamanho}`))}` : ''}`;
        }
        html += avisos(alertasDe(e.id)) + '</table>' + (e.tipo === 'qd' ? botoes([['unifilar', 'Diagrama unifilar'], ['multifilar', 'Multifilar'], ['executivo', 'Quadro executivo'], ['demanda', 'Quadro de demanda'], ['novoCircuitoQd', 'Novo circuito'], ['reservaQd', 'Nova reserva']]) : '');
      } else if (t.disc === 'ele' && e.tipo !== 'cp') {
        const circs = [['', '(sem circuito)'], ...store.project.circuitos.filter((c) => c.tipo !== 'RESERVA').map((c) => [c.id, c.nome])];
        if (t.carga) html += row(e.tipo === 'tue' ? 'Potência (W)' : 'Potência (VA)', inp('potencia', e.potencia, 'number', '10'));
        html += row('Circuito', opts('circuitoId', e.circuitoId || '', circs));
        if (t.comandada) html += row('Comando', opts('comando', e.comando || '', [['', '(nenhum)'], ...LETRAS.map((l) => [l, l])]));
        if (t.comando && t.comando !== 'pulsador') html += row('Comandos (teclas)', `<input data-k="comandosTxt" type="text" value="${esc((e.comandos || []).join(', '))}" placeholder="ex.: a, b">`);
        if (e.tipo === 'tug') html += row('Tomada dupla', sim('dupla', !!e.dupla)) + row('Com interruptor', sim('comInterruptor', !!e.comInterruptor));
        const r = store.results.find((x) => x.circuito.id === e.circuitoId);
        if (r) html += `${th('Circuito')}${row('Nome', ro(r.circuito.nome))}${row('Fases', ro(r.fases.join('') || '—'))}${row('Seção / disjuntor', ro(r.ok ? `${fmtSec(r.secao)} mm² / ${r.disjuntor} A` : '—'))}${row('DR', ro(r.dr ? `sim${r.drGrupo ? ` (DR${r.drGrupo})` : ''}` : 'não'))}`;
        html += avisos(alertasDe(e.id)) + '</table>';
      } else if (t.disc === 'hid') {
        if (t.peso != null) html += `${row('Peso (água fria)', ro(fmt(t.peso, 1)))}${row('UHC (esgoto)', ro(t.uhc))}${row('DN mínimo esgoto', ro(`${t.dnEsg} mm`))}`;
        const pt = store.hid.af.pontos.find((x) => x.no.el === e);
        if (pt) html += `${th('Água fria')}${row('Pressão dinâmica', ro(`${fmt(pt.pressao, 2)} mca`, pt.pressao < 1 ? 'var(--danger)' : 'var(--ok)'))}`;
        if (e.tipo === 'reservatorio') html += `<tr><td colspan="2" class="nota">A altura é a cota do fundo do reservatório em relação ao piso do pavimento.</td></tr>`;
        html += '</table>';
      } else html += '</table>';
    }
    if (!html.endsWith('</table>') && !html.includes('props-acoes')) html += '</table>';
  } else if (sel.kind === 'ambiente') {
    const a = sel.ref;
    const v = store.ele.ambientes.find((x) => x.ambiente === a) || { ...minimosAmbiente(a), faltas: [] };
    const lt = a.luminotecnico;
    html = `<table class="props">${th('Ambiente')}${row('Nome', inp('nome', a.nome, 'text'))}${row('Tipo', opts('tipo', a.tipo, Object.entries(AMBIENTES).map(([k, x]) => [k, x.nome])))}
      ${row('Dimensões', ro(`${fmt(a.x2 - a.x1)} × ${fmt(a.y2 - a.y1)} m`))}${row('Área / perímetro', ro(`${fmt(v.A)} m² / ${fmt(v.P)} m`))}
      ${th('NBR 5410 — mínimos')}${row('Iluminação', ro(`${v.ilumInstalada ?? 0} / ${v.ilum} VA`, (v.ilumInstalada ?? 0) < v.ilum ? 'var(--danger)' : 'var(--ok)'))}
      ${row('Tomadas TUG', ro(`${v.tugInstaladas ?? 0} / ${v.tug}`, (v.tugInstaladas ?? 0) < v.tug ? 'var(--danger)' : 'var(--ok)'))}
      ${row('DR obrigatório', ro(AMBIENTES[a.tipo]?.dr ? 'sim' : 'não'))}
      ${lt ? `${th('Luminotécnico')}${row('Iluminância', ro(`${lt.entrada.iluminancia} lx desejada / ${Math.round(lt.resultado.Eobtida)} lx obtida`))}${row('Luminárias', ro(`${lt.resultado.total} × ${lt.entrada.luminaria.nome}`))}` : ''}
      </table>${botoes([['distLuz', 'Distribuir lâmpadas'], ['distTom', 'Distribuir tomadas']])}`;
  } else if (sel.kind === 'desenho') {
    const d = sel.ref;
    const nome = { linha: 'Linha', ret: 'Retângulo', circ: 'Círculo', texto: 'Texto' }[d.t];
    html = `<table class="props">${th(nome)}${d.t === 'texto' ? row('Texto', inp('texto', d.texto, 'text')) + row('Altura do texto (m)', inp('h', d.h)) : ''}
      ${'x' in d ? row('X (m)', inp('x', d.x)) + row('Y (m)', inp('y', d.y)) : row('X inicial', inp('x1', d.x1)) + row('Y inicial', inp('y1', d.y1)) + row('X final', inp('x2', d.x2)) + row('Y final', inp('y2', d.y2))}
      ${d.t === 'circ' ? row('Raio (m)', inp('r', d.r)) : ''}${d.t === 'linha' ? row('Comprimento', ro(`${fmt(Math.hypot(d.x2 - d.x1, d.y2 - d.y1))} m`)) : ''}</table>`;
  } else if (sel.kind === 'parede') {
    const w = sel.ref;
    html = `<table class="props">${th('Parede')}${row('Identificador', ro(w.id))}${row('Comprimento (m)', ro(fmt(Math.hypot(w.x2 - w.x1, w.y2 - w.y1))))}
      ${row('Espessura (m)', inp('esp', w.esp))}${row('X inicial', inp('x1', w.x1))}${row('Y inicial', inp('y1', w.y1))}${row('X final', inp('x2', w.x2))}${row('Y final', inp('y2', w.y2))}</table>`;
  } else if (sel.kind === 'viga') {
    const v = sel.ref;
    const r = store.est.vigas.find((x) => x.viga === v);
    html = `<table class="props">${th(`Viga V${store.floor.vigas.indexOf(v) + 1}`)}${row('Largura b (cm)', inp('b', v.b, 'number', '1'))}${row('Altura h (cm)', inp('h', v.h, 'number', '1'))}
      ${row('X inicial', inp('x1', v.x1))}${row('Y inicial', inp('y1', v.y1))}${row('X final', inp('x2', v.x2))}${row('Y final', inp('y2', v.y2))}
      ${r ? `${th('Pré-dimensionamento')}${row('Vão', ro(`${fmt(r.L)} m`))}${row('Carga de lajes', ro(`${fmt(r.detalhe.laje, 1)} kN`))}${row('Alvenaria acima', ro(`${fmt(r.detalhe.parede, 1)} kN`))}
      ${row('Peso próprio', ro(`${fmt(r.detalhe.pp, 1)} kN`))}${row('q (caract.)', ro(`${fmt(r.q, 2)} kN/m`))}${row('M máx.', ro(`${fmt(r.M, 1)} kN·m`))}${row('V máx.', ro(`${fmt(r.V, 1)} kN`))}
      ${row('As inferior', ro(r.barras ? `${r.barras.n} φ ${fmtSec(r.barras.phi)} mm (${fmt(r.barras.As)} cm²)` : '—'))}${avisos(r.avisos)}` : ''}</table>`;
  } else if (sel.kind === 'laje') {
    const l = sel.ref;
    const r = store.est.lajes.find((x) => x.laje === l);
    html = `<table class="props">${th(`Laje L${store.floor.lajes.indexOf(l) + 1}`)}${row('Espessura h (cm)', inp('h', l.h, 'number', '1'))}
      ${row('Sobrecarga (kN/m²)', inp('sc', l.sc, 'number', '0.5'))}${row('Revestimento (kN/m²)', inp('rev', l.rev, 'number', '0.1'))}
      ${row('Dimensões', ro(`${fmt(l.x2 - l.x1)} × ${fmt(l.y2 - l.y1)} m`))}${row('Carga total', ro(`${fmt(cargaLaje(l), 2)} kN/m²`))}
      ${r?.espessuraMin ? row('h mínimo (vão/40)', ro(`${Math.ceil(r.espessuraMin * 100)} cm`)) : ''}</table>`;
  } else if (sel.kind === 'pavimento') {
    const pv = sel.ref;
    html = `<table class="props">${th(pv.intermediario ? 'Nível intermediário' : 'Pavimento')}${row('Nome', inp('nome', pv.nome, 'text'))}${row('Cota (m)', inp('cota', pv.cota))}${row('Pé-direito (m)', inp('peDireito', pv.peDireito))}
      ${row('Paredes', ro(pv.paredes.length))}${row('Ambientes', ro(pv.ambientes.length))}${row('Elementos', ro(pv.elementos.length))}${row('Vigas / lajes', ro(`${pv.vigas.length} / ${pv.lajes.length}`))}
      ${pv.fundo ? row('Referência', ro(pv.fundo.arquivo)) : ''}</table>
      ${store.project.pavimentos.length > 1 ? botoes([['delPav', 'Excluir pavimento']]) : ''}`;
  } else if (sel.kind === 'eletroduto') {
    const sg = store.ele.segmentos.find((x) => chaveSeg(x) === sel.chave);
    if (!sg) html = '<table class="props"><tr><td colspan="2" class="nota">O trecho mudou com o recálculo. Selecione-o de novo.</td></tr></table>';
    else {
      const nome = (n) => (TIPOS[n.el.tipo]?.quadro ? store.nomeQuadro(n.el) : `${TIPOS[n.el.tipo]?.nome || n.el.tipo}`);
      const ligs = sg.condutores.map((k) => {
        const c = store.project.circuitos.find((x) => x.id === k.circuito);
        const r = store.results.find((x) => x.circuito.id === k.circuito);
        return `<tr><td>${esc(c?.numero ?? '?')}</td><td>${{ F: 'Fase', N: 'Neutro', T: 'Terra', R: `Retorno ${k.comando || ''}` }[k.tipo]}</td><td>${fmtSec(k.secao)}</td><td>${k.tipo === 'F' && r ? fmt(r.ib) : '—'}</td></tr>`;
      }).join('');
      html = `<table class="props">${th('Eletroduto')}${row('Trecho', ro(`${nome(sg.de)} → ${nome(sg.para)}`))}${row('Material', ro(store.ele.cfg.material))}
        ${row('Passa pelo', ro(sg.nivel === 'piso' ? 'piso' : 'forro'))}${row('Lançamento', ro(sg.manual ? 'manual' : 'automático'))}
        ${th('Dimensionamento')}${row('Diâmetro', ro(`DN ${sg.dn}`))}${row('Área útil', ro(`${fmt(sg.areaUtil, 1)} mm²`))}${row('Área dos condutores', ro(`${fmt(sg.areaOcupada, 1)} mm²`))}
        ${row('Taxa de ocupação', ro(`${fmt(sg.ocupacao * 100, 0)} % (máx. ${fmt(sg.taxaMax * 100, 0)} %)`, sg.ocupacao > sg.taxaMax ? 'var(--danger)' : 'var(--ok)'))}
        ${th('Comprimento')}${row('Comprimento do trecho', ro(`${fmt(sg.comp, 1)} m`))}${row('Número de curvas', ro(sg.curvas, sg.curvas > 3 ? 'var(--danger)' : ''))}
        ${row('Comprimento máximo', ro(`${fmt(Math.max(0, sg.maxComp), 0)} m`, sg.excede ? 'var(--danger)' : 'var(--ok)'))}
        ${sg.excede ? `<tr><td colspan="2" class="aviso">Acima do máximo entre caixas (NBR 5410 6.2.11.1.6): insira uma caixa de passagem no trecho.</td></tr>` : ''}
        </table>
        <table class="props lig"><tr class="cab"><td>Circ.</td><td>Condutor</td><td>mm²</td><td>Ib (A)</td></tr>${ligs}</table>
        ${botoes([...(sg.excede ? [['cpTrecho', 'Inserir caixa de passagem']] : []), ...(sg.manual ? [['soltaTrecho', 'Liberar trecho (automático)']] : [['fixaTrecho', 'Fixar trecho']])])}`;
    }
  } else if (sel.kind === 'circuito' && sel.ref) {
    const c = sel.ref;
    const r = store.results.find((x) => x.circuito.id === c.id);
    const qds = quadrosDoProjeto().filter((q) => q.tipo === 'qd');
    const polos = r?.polos || 1;
    const fasesOp = polos === 1 ? ['R', 'S', 'T'] : polos === 2 ? ['RS', 'RT', 'ST'] : ['RST'];
    html = `<table class="props">${th(c.tipo === 'RESERVA' ? 'Circuito reserva' : 'Circuito')}${row('Número', inp('numero', c.numero, 'number', '1'))}${row('Nome', inp('nome', c.nome, 'text'))}
      ${row('Tipo', opts('tipo', c.tipo, [['ILUM', 'Iluminação'], ['TUG', 'Tomadas de uso geral'], ['TUE', 'Tomada de uso específico'], ['RESERVA', 'Reserva']]))}
      ${row('Quadro', opts('quadroId', c.quadroId || '', [['', '(automático)'], ...qds.map((q) => [q.id, store.nomeQuadro(q)])]))}
      ${row('Ligação', opts('polos', polos, [[1, `F+N (${cfg.tensaoFN} V)`], [2, `F+F (${cfg.tensaoFF} V)`], [3, `3F (${cfg.tensaoFF} V)`]], 'data-num="1"'))}
      ${row(c.faseCalculada ? 'Fase(s) — balanceada' : 'Fase(s)', opts('fase', c.fase || 'auto', [['auto', 'Automático (balancear)'], ...fasesOp.map((f) => [f, f])]))}
      ${row('DR', opts('dr', c.dr || 'auto', [['auto', 'Automático (NBR 5410)'], ['sim', 'Sim'], ['nao', 'Não']]))}
      ${c.tipo !== 'RESERVA' ? row('Eletroduto exclusivo', opts('exclusivo', c.exclusivo ?? (c.tipo === 'TUE' ? 'true' : 'false'), [['true', 'Sim'], ['false', 'Não']], 'data-bool="1"')) : ''}
      ${c.tipo === 'RESERVA' ? row('Potência prevista (VA)', inp('potencia', c.potencia, 'number', '100')) : row('Seção mínima', opts('secaoMin', c.secaoMin ?? '', [['', 'Padrão (1,5 / 2,5)'], [1.5, '1,5 mm²'], [2.5, '2,5 mm²'], [4, '4 mm²'], [6, '6 mm²'], [10, '10 mm²']], 'data-num="1"'))
        + row('Seção fixada', opts('secaoFixa', c.secaoFixa ?? '', [['', 'Não (dimensionar)'], ...[1.5, 2.5, 4, 6, 10, 16, 25].map((v) => [v, `${fmtSec(v)} mm²`])], 'data-num="1"'))}
      ${r && !r.reserva ? `${th('Dimensionamento')}${row('Pontos', ro(r.pontos.length))}${row('Potência', ro(`${fmt(r.potencia, 0)} VA`))}${row('Fases', ro(r.fases.join('')))}
      ${row('Corrente de projeto Ib', ro(`${fmt(r.ib)} A`))}${row('Comprimento (eletrodutos)', ro(`${fmt(r.comprimento, 1)} m`))}
      ${row('Agrupamento', ro(`${r.agrupamento} circuito(s) → f = ${fmt(r.fAgr)}`))}
      ${row('Seção', ro(r.ok ? `${fmtSec(r.secao)} mm²` : '—'))}${row('Iz corrigida', ro(r.ok ? `${fmt(r.iz, 1)} A` : '—'))}${row('Disjuntor', ro(r.ok ? `${r.polos}P ${r.disjuntor} A curva C` : '—'))}
      ${row('Queda de tensão', ro(r.ok ? `${fmt(r.queda)} %` : '—', r.ok && r.queda > cfg.quedaMax * 0.8 ? 'var(--warn)' : ''))}
      ${row('DR', ro(r.dr ? `sim${r.drGrupo ? ` (DR${r.drGrupo})` : ''}${r.drObrigatorio ? ` — obrigatório: ${r.drMotivo}` : ''}` : 'não'))}${avisos(r.avisos)}` : ''}</table>
    ${botoes([['definir', 'Definir circuito'], ['localizar', 'Localizar pontos'], ['delCirc', 'Excluir circuito']])}`;
  } else if (sel.kind === 'projeto') {
    const ce = configEletrica(store.project);
    const pe = (k, label, step) => `<tr><td>${esc(label)}</td><td><input data-k="${k}" data-obj="eletrica" type="number" step="${step}" value="${ce[k]}"></td></tr>`;
    html = `<table class="props">${th('Projeto')}${row('Nome', inp('nome', store.project.nome, 'text'))}${row('Proprietário', inp('proprietario', store.project.proprietario || '', 'text'))}
      ${row('Endereço', inp('endereco', store.project.endereco || '', 'text'))}${row('Responsável técnico', inp('autor', store.project.autor || '', 'text'))}${row('Registro (CREA/CAU)', inp('registro', store.project.registro || '', 'text'))}
      ${row('Pavimentos', ro(store.project.pavimentos.length))}${row('Circuitos', ro(store.project.circuitos.length))}
      ${th('Elétrico')}${row('Tensões', `<select data-k="tensoes" data-obj="eletrica">${[['127/220', '127 / 220 V'], ['220/380', '220 / 380 V']].map(([v, l]) => `<option value="${v}"${`${cfg.tensaoFN}/${cfg.tensaoFF}` === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      <tr><td>Queda máx. circuitos (%)</td><td><input data-k="quedaMax" data-obj="eletrica" type="number" step="0.5" value="${cfg.quedaMax}"></td></tr>
      <tr><td>Queda máx. alimentadores (%)</td><td><input data-k="quedaAlim" data-obj="eletrica" type="number" step="0.5" value="${cfg.quedaAlim}"></td></tr>
      <tr><td>Temperatura ambiente (°C)</td><td><input data-k="temperatura" data-obj="eletrica" type="number" step="5" value="${cfg.temperatura}"></td></tr>
      ${th('Eletrodutos')}${row('Material', `<select data-k="material" data-obj="eletrica">${MATERIAIS_ELETRODUTO.map((m) => `<option${m === ce.material ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>`)}
      ${row('Diâmetro mínimo', `<select data-k="diametroMin" data-obj="eletrica" data-num="1">${[[20, 'DN 20 (3/4")'], [25, 'DN 25 (1")'], [32, 'DN 32 (1 1/4")']].map(([v, l]) => `<option value="${v}"${v === ce.diametroMin ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${row('Taxa de ocupação máx. (%)', `<input data-k="ocupacaoPct" data-obj="eletrica" type="number" step="1" value="${Math.round(ce.ocupacaoMax * 100)}">`)}
      ${row('Tomadas baixas', `<select data-k="rotaBaixa" data-obj="eletrica">${[['piso', 'Pelo piso'], ['teto', 'Pelo forro']].map(([v, l]) => `<option value="${v}"${v === ce.rotaBaixa ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${pe('trechoMax', 'Trecho máx. entre caixas (m)', 1)}
      ${th('Estrutura')}<tr><td>Tensão admissível do solo (kPa)</td><td><input data-k="sigmaSolo" data-obj="estrutura" type="number" step="10" value="${store.project.estrutura.sigmaSolo}"></td></tr></table>`;
  }
  box.innerHTML = html;
  // categorias recolhíveis, como numa grade de propriedades
  box.querySelectorAll('.props th').forEach((thEl) => {
    thEl.onclick = () => {
      thEl.classList.toggle('fechado');
      let tr = thEl.parentElement.nextElementSibling;
      while (tr && !tr.querySelector('th')) { tr.hidden = thEl.classList.contains('fechado'); tr = tr.nextElementSibling; }
    };
  });
  const target = sel?.kind === 'projeto' ? store.project : sel?.ref;
  box.querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('change', () => {
      const k = el.dataset.k;
      let v = el.value;
      if (el.type === 'number' || el.dataset.num) v = v === '' ? null : Number(v);
      if (el.dataset.bool) v = v === 'true';
      if (['circuitoId', 'alimentadoPor', 'quadroId', 'comando'].includes(k)) v = v || null;
      const obj = el.dataset.obj ? store.project[el.dataset.obj] : target;
      store.commit('Propriedade', () => {
        if (k === 'comandosTxt') obj.comandos = [...new Set(v.toLowerCase().split(/[^a-z]+/).filter(Boolean))];
        else if (k === 'tensoes') { const [fn, ff] = v.split('/').map(Number); obj.tensaoFN = fn; obj.tensaoFF = ff; for (const c of store.project.circuitos) c.tensao = (c.polos || 1) === 1 ? fn : ff; }
        else if (k === 'polos') { obj.polos = v; obj.tensao = v === 1 ? cfg.tensaoFN : cfg.tensaoFF; obj.fase = 'auto'; obj.faseCalculada = false; }
        else if (k === 'fase') { obj.fase = v; obj.faseCalculada = false; }
        else if (k === 'ocupacaoPct') obj.ocupacaoMax = Math.min(0.53, Math.max(0.2, v / 100));
        else if (k === 'alimentadoPor' && v && criaCiclo(obj, v)) log('Esse quadro já alimenta o escolhido; a hierarquia ficaria circular.', 'err');
        else obj[k] = v;
      });
      if (sel.kind === 'pavimento' && k === 'cota') {
        normalizar(store.project);
        store.floorIdx = store.project.pavimentos.indexOf(sel.ref);
        renderTree();
      }
      syncCircuitSelect(); updateTitle(); renderGerenciador();
    });
  });
  $('#m-circ')?.addEventListener('change', (ev) => {
    const id = ev.target.value;
    if (!id) return;
    const alvo = sel.itens.filter((it) => it.kind === 'elemento' && TIPOS[it.ref.tipo].disc === 'ele' && !TIPOS[it.ref.tipo].quadro);
    store.commit('Definir circuito', () => { for (const it of alvo) it.ref.circuitoId = id; });
    log(`${alvo.length} ponto(s) no ${store.project.circuitos.find((c) => c.id === id).nome}.`, 'ok');
  });
  box.querySelectorAll('[data-acao]').forEach((b) => (b.onclick = () => acaoProps(b.dataset.acao, sel)));
}

function criaCiclo(q, paiId) {
  const porId = new Map(store.project.pavimentos.flatMap((pv) => pv.elementos).map((e) => [e.id, e]));
  for (let p = porId.get(paiId), n = 0; p && n < 50; p = porId.get(p.alimentadoPor), n++) if (p === q) return true;
  return false;
}

function acaoProps(acao, sel) {
  const ref = sel.ref;
  if (acao === 'copiar') return store.copy();
  if (acao === 'apagar') return store.remove(sel);
  if (acao === 'unifilar') return diagramaUnifilar(ref);
  if (acao === 'multifilar') return diagramaMultifilar(ref);
  if (acao === 'executivo') return quadroExecutivo(ref);
  if (acao === 'demanda') return relatorioDemanda(ref);
  if (acao === 'cpTrecho' || acao === 'fixaTrecho' || acao === 'soltaTrecho') {
    const sg = store.ele.segmentos.find((x) => chaveSeg(x) === sel.chave);
    if (!sg) return;
    const pav = sg.para.pav;
    if (acao === 'cpTrecho') return inserirCaixasPassagem([sg]);
    const a = sg.de.el.id, b = sg.para.el.id;
    store.commit(acao === 'fixaTrecho' ? 'Fixar eletroduto' : 'Liberar eletroduto', () => {
      pav.eletrodutos ||= [];
      if (acao === 'fixaTrecho') pav.eletrodutos.push({ id: store.uid('M'), a, b });
      else pav.eletrodutos = pav.eletrodutos.filter((m) => !((m.a === a && m.b === b) || (m.a === b && m.b === a)));
    });
    return log(acao === 'fixaTrecho' ? 'Trecho fixado: o traçado automático passa a mantê-lo.' : 'Trecho liberado para o traçado automático.', 'ok');
  }
  if (acao === 'novoCircuitoQd') return novoCircuito(ref);
  if (acao === 'reservaQd') return novaReserva(ref);
  if (acao === 'distLuz' || acao === 'distTom') return distribuir(acao, ref);
  if (acao === 'definir') { store.activeCircuitId = ref.id; syncCircuitSelect(); return store.setTool('atribuir'); }
  if (acao === 'localizar') return localizarCircuito(ref);
  if (acao === 'delPav') {
    if (!confirm(`Excluir "${ref.nome}" e tudo o que há nele?`)) return;
    store.commit('Excluir pavimento', () => store.project.pavimentos.splice(store.project.pavimentos.indexOf(ref), 1));
    return setFloor(Math.min(store.floorIdx, store.project.pavimentos.length - 1));
  }
  if (acao === 'delCirc') {
    store.commit('Excluir circuito', () => {
      store.project.circuitos.splice(store.project.circuitos.indexOf(ref), 1);
      for (const pv of store.project.pavimentos) for (const e of pv.elementos) if (e.circuitoId === ref.id) e.circuitoId = null;
    });
    store.activeCircuitId = store.project.circuitos[0]?.id || null;
    store.select(null);
    log(`${ref.nome} excluído.`);
  }
}

// ---------------------------------------------------------------- comandos
function novoPavimento() {
  const pavs = store.project.pavimentos.filter((p) => !p.intermediario);
  const ult = pavs[pavs.length - 1];
  const n = pavs.length;
  store.commit('Novo pavimento', () => {
    store.project.pavimentos.push({
      id: store.uid('PV'), nome: n === 1 ? 'Superior' : `Pavimento ${n + 1}`,
      cota: Math.round((ult.cota + ult.peDireito + 0.12) * 100) / 100, peDireito: ult.peDireito,
      paredes: ult.paredes.map((w) => ({ ...w, id: store.uid('P') })), elementos: [], vigas: [], lajes: [], desenho: [],
    });
    normalizar(store.project);
  });
  setFloor(store.project.pavimentos.length - 1);
  log(`Pavimento "${store.floor.nome}" criado com as paredes do pavimento abaixo.`, 'ok');
}

async function novoNivelIntermediario() {
  const base = store.floor;
  const nome = await pedirTexto('Nível intermediário', 'Nome do nível:', `Mezanino ${base.nome}`);
  if (!nome) return;
  let novo;
  store.commit('Nível intermediário', () => {
    novo = { id: store.uid('PV'), nome, intermediario: true, cota: Math.round((base.cota + base.peDireito / 2) * 100) / 100,
      peDireito: Math.round((base.peDireito / 2) * 100) / 100, paredes: [], elementos: [], vigas: [], lajes: [], desenho: [] };
    store.project.pavimentos.push(novo);
    normalizar(store.project);
  });
  setFloor(store.project.pavimentos.indexOf(novo));
  log(`Nível intermediário "${nome}" criado na cota ${fmt(novo.cota)} m.`, 'ok');
}

function lancarEstrutura() {
  const f = store.floor;
  if (!f.paredes.length) return log('Desenhe ou importe as paredes antes do lançamento automático.', 'warn');
  const tem = f.vigas.length || f.lajes.length || f.elementos.some((e) => e.tipo === 'pilar');
  if (tem && !confirm('Substituir pilares, vigas e lajes deste pavimento pelo lançamento automático?')) return;
  let lan;
  store.commit('Lançamento automático', () => {
    f.elementos = f.elementos.filter((e) => e.tipo !== 'pilar');
    lan = lancamentoAutomatico(f, (p) => store.uid(p));
    f.elementos.push(...lan.pilares);
    f.vigas = lan.vigas;
    f.lajes = lan.lajes;
  });
  log(`Lançamento: ${lan.pilares.length} pilares, ${lan.vigas.length} vigas, ${lan.lajes.length} lajes. Revise vãos e seções.`, 'ok');
  const erros = store.est.avisos.filter((a) => a.nivel === 'erro').length;
  if (erros) log(`${erros} verificação(ões) estrutural(is) com problema. Veja Relatórios > Vigas / Pilares.`, 'warn');
}

function toggleSpda() {
  store.commit('SPDA', () => { store.project.spda.ativo = !store.project.spda.ativo; });
  renderRibbon();
  log(store.project.spda.ativo ? `SPDA ativado: ${store.spda.avisos.map((a) => a.texto).join(' ')}` : 'SPDA desativado.', 'ok');
}

function toggleSetting(k) {
  store.settings[k] = !store.settings[k];
  renderStatus();
  renderRibbon();
  plan.render();
}
function toggleVis(d) {
  store.settings.vis[d] = !store.settings.vis[d];
  renderRibbon(); plan.render(); view3d.invalidate();
  if (painelAtual === 'camadas') renderCamadas();
}

function setView(v) {
  $('#plan').hidden = v !== '2d';
  $('#view3d').hidden = v !== '3d';
  $('#hint').hidden = v !== '2d';
  if (v === '3d') view3d.show(); else { view3d.hide(); plan.resize(); }
}


// ---------------------------------------------------------------- elétrico: comandos
function quadroPadrao() {
  const f = store.floor;
  return f.elementos.find((e) => e.tipo === 'qd') || store.project.pavimentos.flatMap((pv) => pv.elementos).find((e) => e.tipo === 'qd') || null;
}
function proximoNumero(q) {
  const nums = store.project.circuitos.filter((c) => !q || (c.quadroId || quadroPadrao()?.id) === q.id).map((c) => c.numero);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
function novoCircuito(q = quadroPadrao()) {
  const numero = proximoNumero(q);
  const tipo = store.activeCircuit && store.activeCircuit.tipo !== 'RESERVA' ? store.activeCircuit.tipo : 'TUG';
  const cfg = store.project.eletrica;
  const nomeTipo = { ILUM: 'Iluminação', TUG: 'TUG', TUE: 'TUE' }[tipo];
  const c = { id: store.uid('C'), numero, nome: `C${numero} ${nomeTipo}`, tipo, tensao: tipo === 'TUE' ? cfg.tensaoFF : cfg.tensaoFN, polos: tipo === 'TUE' ? 2 : 1, quadroId: q?.id || null, fase: 'auto', dr: 'auto' };
  store.commit('Novo circuito', () => store.project.circuitos.push(c));
  store.activeCircuitId = c.id;
  store.selection = { kind: 'circuito', ref: c };
  syncCircuitSelect(); renderTree(); renderProps(); renderGerenciador(); store.refreshHint();
  mostrarPainel('propriedades');
  log(`${c.nome} criado${q ? ` no ${store.nomeQuadro(q)}` : ''}. Use "Definir circuito" e clique nos pontos.`, 'ok');
}
function novaReserva(q = quadroPadrao()) {
  const numero = proximoNumero(q);
  const c = { id: store.uid('C'), numero, nome: `C${numero} Reserva`, tipo: 'RESERVA', potencia: 1000, tensao: store.project.eletrica.tensaoFN, quadroId: q?.id || null, fase: 'auto', dr: 'nao' };
  store.commit('Circuito reserva', () => store.project.circuitos.push(c));
  renderGerenciador();
  log(`${c.nome} (1000 VA) criado.`, 'ok');
}
function toggleCentro() {
  store.settings.centroCargas = !store.settings.centroCargas;
  renderRibbon(); plan.render();
  const cc = store.ele.centros.find((x) => x.pav === store.floor);
  if (store.settings.centroCargas && cc?.x != null) log(`Centro de cargas do ${store.floor.nome}: X ${fmt(cc.x)} Y ${fmt(cc.y)} (${fmt(cc.P, 0)} VA). O quadro deve ficar o mais perto possível.`, 'ok');
}
function localizarCircuito(c) {
  const itens = [];
  for (const pv of store.project.pavimentos) for (const e of pv.elementos) if (e.circuitoId === c.id && pv === store.floor) itens.push({ kind: 'elemento', ref: e });
  store.activeCircuitId = c.id;
  store.selectMany(itens, false);
  syncCircuitSelect(); plan.render();
  log(`${c.nome}: ${itens.length} ponto(s) neste pavimento.`);
}

// nomes de ambientes reconhecidos pelos textos do desenho de referência
const PALAVRAS = [[/sala|estar|living|jantar/i, 'sala'], [/quarto|dorm|su[ií]te/i, 'quarto'], [/cozinha|copa|gourmet/i, 'cozinha'], [/servi[cç]o|lavand/i, 'servico'],
  [/banh|wc|lavabo|sanit/i, 'banheiro'], [/varanda|sacada|terra[cç]o|[aá]rea ext/i, 'varanda'], [/garagem|abrigo/i, 'garagem'], [/circ|corredor|hall/i, 'circulacao'], [/escrit|office/i, 'escritorio']];
function reconhecerAmbientes() {
  const f = store.floor;
  if (!f.paredes.length) return log('Desenhe ou importe as paredes primeiro.', 'warn');
  const rs = detectarAmbientes(f);
  const textos = f.fundo ? f.fundo.t.filter((t) => f.fundo.camadas[t.l]?.vis !== false) : [];
  const anotacoes = f.desenho.filter((d) => d.t === 'texto').map((d) => ({ x: d.x, y: d.y, t: d.texto }));
  let n = 0;
  store.commit('Ambientes', () => {
    const antigos = f.ambientes;
    f.ambientes = rs.map((r) => {
      const igual = antigos.find((a) => Math.abs(a.x1 - r.x1) < 0.05 && Math.abs(a.y1 - r.y1) < 0.05 && Math.abs(a.x2 - r.x2) < 0.05 && Math.abs(a.y2 - r.y2) < 0.05);
      if (igual) return igual;
      const dentro = [...textos, ...anotacoes].filter((t) => t.x >= r.x1 && t.x <= r.x2 && t.y >= r.y1 && t.y <= r.y2);
      const rotulo = dentro.map((t) => t.t).find((t) => PALAVRAS.some(([re]) => re.test(t))) || dentro[0]?.t;
      const tipo = (rotulo && PALAVRAS.find(([re]) => re.test(rotulo))?.[1]) || 'outro';
      n++;
      return { id: store.uid('A'), nome: rotulo ? rotulo.trim().replace(/\s+/g, ' ').slice(0, 40) : `Ambiente ${n}`, tipo, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };
    });
  });
  log(`${f.ambientes.length} ambiente(s) no ${f.nome} (${n} novo(s)). Ajuste nome e tipo em Propriedades: o tipo define DR e mínimos da NBR.`, 'ok');
}

function distribuir(tool, amb) {
  const f = store.floor;
  const c = store.activeCircuit;
  if (tool === 'distLuz') {
    const lux = AMBIENTES[amb.tipo]?.lux || 150;
    const ent = { iluminancia: lux, luminaria: LUMINARIAS[3], planoTrabalho: 0.75, alturaLuminaria: f.peDireito, fm: 0.8, refletancias: { teto: 0.7, parede: 0.5, piso: 0.1 }, va: null, substituir: true };
    const op = (id, lista, v) => `<select id="${id}">${lista.map(([val, l]) => `<option value="${val}"${String(val) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    modal(`Distribuir lâmpadas — ${amb.nome}`, `
      <div style="display:grid;grid-template-columns:300px 1fr;gap:18px;align-items:start">
        <table class="props" style="border:1px solid var(--line)">
          <tr><th colspan="2">Parâmetros</th></tr>
          <tr><td>Iluminância (lx)</td><td><input id="dl-lux" type="number" step="25" value="${lux}"></td></tr>
          <tr><td>Luminária</td><td>${op('dl-lum', LUMINARIAS.map((l, i) => [i, `${l.nome} (${l.fluxo} lm)`]), 3)}</td></tr>
          <tr><td>Altura da luminária (m)</td><td><input id="dl-h" type="number" step="0.05" value="${f.peDireito}"></td></tr>
          <tr><td>Plano de trabalho (m)</td><td><input id="dl-pt" type="number" step="0.05" value="0.75"></td></tr>
          <tr><td>Fator de manutenção</td><td>${op('dl-fm', [[0.9, '0,90 (limpo)'], [0.8, '0,80 (normal)'], [0.7, '0,70 (sujo)']], 0.8)}</td></tr>
          <tr><td>Refletância teto</td><td>${op('dl-rt', [[0.8, '80%'], [0.7, '70%'], [0.5, '50%'], [0.3, '30%']], 0.7)}</td></tr>
          <tr><td>Refletância parede</td><td>${op('dl-rp', [[0.7, '70%'], [0.5, '50%'], [0.3, '30%'], [0.1, '10%']], 0.5)}</td></tr>
          <tr><td>Refletância piso</td><td>${op('dl-rpi', [[0.3, '30%'], [0.2, '20%'], [0.1, '10%']], 0.1)}</td></tr>
          <tr><td>Potência p/ carga (VA)</td><td><input id="dl-va" type="number" step="10" placeholder="potência da lâmpada"></td></tr>
          <tr><td>Substituir existentes</td><td><select id="dl-sub"><option value="1">Sim</option><option value="0">Não</option></select></td></tr>
        </table>
        <div><div id="dl-res"></div><p style="color:var(--muted)">Método dos lúmens: K = C·L / (h·(C+L)), N = E·A / (Φ·u·FM). As luminárias entram no circuito ativo${c?.tipo === 'ILUM' ? ` (<b>${esc(c.nome)}</b>)` : ' (nenhum de iluminação selecionado: ficam sem circuito)'} com o comando "${store.settings.comandoAtivo || 'a'}".</p></div>
      </div>`, [{ label: 'Inserir lâmpadas', primary: true, run: () => {
      const { e, r } = calcula();
      closeModal();
      const pos = posicoesLuminarias(amb, r.nx, r.ny);
      const va = Number($('#dl-va')?.value) || null;
      store.commit('Distribuir lâmpadas', () => {
        if (e.substituir) f.elementos = f.elementos.filter((el) => !(el.tipo === 'luz' && dentroDe(amb, el, 0.05)));
        for (const p of pos) f.elementos.push({ id: store.uid('E'), tipo: 'luz', x: p.x, y: p.y, altura: e.alturaLuminaria, descricao: e.luminaria.nome, potencia: va || e.luminaria.potencia, circuitoId: c?.tipo === 'ILUM' ? c.id : null, comando: c?.tipo === 'ILUM' ? store.settings.comandoAtivo || 'a' : null });
        amb.luminotecnico = { entrada: e, resultado: r };
      });
      log(`${pos.length} luminária(s) em ${amb.nome}: ${Math.round(r.Eobtida)} lx (desejado ${e.iluminancia} lx). Relatório em Luminotécnico.`, 'ok');
    } }]);
    const calcula = () => {
      const e = {
        iluminancia: Number($('#dl-lux').value), luminaria: LUMINARIAS[Number($('#dl-lum').value)], alturaLuminaria: Number($('#dl-h').value), planoTrabalho: Number($('#dl-pt').value),
        fm: Number($('#dl-fm').value), refletancias: { teto: Number($('#dl-rt').value), parede: Number($('#dl-rp').value), piso: Number($('#dl-rpi').value) }, substituir: $('#dl-sub').value === '1',
      };
      const r = metodoLumens({ comprimento: amb.x2 - amb.x1, largura: amb.y2 - amb.y1, peDireito: f.peDireito, ...e });
      $('#dl-res').innerHTML = htmlTabela(['Item', 'Valor'], relatorioLuminotecnico(amb, e, r));
      return { e, r };
    };
    $('#modal-body').oninput = calcula;
    $('#modal-body').onchange = calcula;
    calcula();
    return;
  }
  // tomadas
  const pl = planoTomadas(amb);
  const regra = { banheiro: '1 tomada junto ao lavatório (600 VA)', molhada: '1 tomada a cada 3,5 m de perímetro; as 3 primeiras com 600 VA', varanda: '1 tomada', perimetro5: '1 tomada a cada 5 m de perímetro', outros: 'até 6 m²: 1 tomada; acima: 1 a cada 5 m de perímetro' }[pl.regra];
  modal(`Distribuir tomadas — ${amb.nome}`, `
    <p><b>${esc(AMBIENTES[amb.tipo]?.nome || amb.tipo)}</b> · ${fmt(pl.A)} m² · perímetro ${fmt(pl.P)} m</p>
    <p>NBR 5410 (9.5.2.2): ${regra}. Mínimo: <b>${pl.tug} tomada(s)</b>, ${pl.potTug.join(' + ')} VA, a ${fmt(pl.altura)} m do piso.</p>
    <p>As tomadas são distribuídas ao longo do perímetro e entram no circuito ativo${c?.tipo === 'TUG' ? ` (<b>${esc(c.nome)}</b>)` : ' (nenhum de TUG selecionado: ficam sem circuito)'}. Reposicione as que caírem em portas.</p>
    <label><input type="checkbox" id="dt-sub" checked> Substituir TUGs existentes no ambiente</label>`, [{ label: 'Inserir tomadas', primary: true, run: () => {
    const sub = $('#dt-sub').checked;
    closeModal();
    store.commit('Distribuir tomadas', () => {
      if (sub) f.elementos = f.elementos.filter((el) => !(el.tipo === 'tug' && dentroDe(amb, el, 0.05)));
      pl.posicoes.forEach((p, i) => f.elementos.push({ id: store.uid('E'), tipo: 'tug', x: p.x, y: p.y, altura: pl.altura, descricao: '', potencia: pl.potTug[i], circuitoId: c?.tipo === 'TUG' ? c.id : null }));
    });
    log(`${pl.tug} tomada(s) em ${amb.nome}.`, 'ok');
  } }]);
}

// ---------------------------------------------------------------- gerenciador elétrico
function renderGerenciador() {
  const box = $('#gerenciador');
  if (!box || !store.ele) return;
  const quadros = store.ele.quadros;
  const porQ = new Map(quadros.map((q) => [q.quadro, q]));
  const raizes = quadros.filter((q) => !q.quadro.alimentadoPor || !quadros.some((x) => x.quadro.id === q.quadro.alimentadoPor));
  const sw = (id) => `<span class="swatch" style="background:${corCircuito(store.project, id)}"></span>`;
  const nodeQ = (rq) => {
    const q = rq.quadro;
    const filhos = rq.filhos.map((f) => porQ.get(f)).filter(Boolean);
    const circs = rq.circuitos.slice().sort((a, b) => a.circuito.numero - b.circuito.numero).map((r) => {
      const cmd = [...new Set(r.pontos.filter((p) => TIPOS[p.tipo].comandada).map((p) => p.comando || '?'))].sort();
      const temAl = r.avisos.length || r.ok === false;
      return `<li><div class="node${store.activeCircuitId === r.circuito.id ? ' sel' : ''}" draggable="true" data-circ="${esc(r.circuito.id)}">${r.reserva ? ICONS.reserva : sw(r.circuito.id)}<span class="lbl">${esc(r.circuito.nome)}</span>${temAl ? '<span style="color:var(--warn)">⚠</span>' : ''}<span class="badge">${r.fases.join('')} · ${fmt(r.potencia, 0)} VA</span></div>
        ${cmd.length ? `<ul>${cmd.map((l) => `<li><div class="node" data-circ="${esc(r.circuito.id)}" data-cmd="${l}">${ICONS.interruptor}<span class="lbl">Comando ${l}</span></div></li>`).join('')}</ul>` : ''}</li>`;
    }).join('');
    return `<li><div class="node${store.isSelected(q) ? ' sel' : ''}" draggable="true" data-quadro="${esc(q.id)}">${ICONS[q.tipo] || ICONS.qd}<span class="lbl">${esc(store.nomeQuadro(q))} (${esc(rq.pav?.nome || '')})</span><span class="badge">${rq.esquema} · ${fmt(rq.demanda / 1000, 1)} kVA</span></div>
      <ul>${filhos.map(nodeQ).join('')}${circs}</ul></li>`;
  };
  const sem = store.results.filter((r) => !r.quadro);
  box.innerHTML = `<div class="ger-barra">${[['processar', 'Processar', 'dialogoProcessar'], ['renumerar', 'Renumerar circuitos', 'renumerarCircuitos'], ['eliminar', 'Eliminar circuitos não utilizados', 'eliminarNaoUtilizados'], ['unifilar', 'Unifilar geral', 'diagramaUnifilarGeral'], ['demanda', 'Quadro de demanda', 'relatorioDemanda'], ['dimensionar', 'Dimensionar eletrodutos', 'relatorioEletrodutos']].map(([ic, t, f]) => `<button data-ger="${f}" title="${t}">${ICONS[ic]}</button>`).join('')}</div><div class="tree"><ul>${raizes.map(nodeQ).join('') || '<li class="empty">Nenhum quadro. Lance um quadro de distribuição (LANÇAMENTO › Quadro).</li>'}
    ${sem.length ? `<li><div class="node">${ICONS.reserva}<span class="lbl">Sem quadro</span></div><ul>${sem.map((r) => `<li><div class="node" draggable="true" data-circ="${esc(r.circuito.id)}">${sw(r.circuito.id)}<span class="lbl">${esc(r.circuito.nome)}</span></div></li>`).join('')}</ul></li>` : ''}</ul></div>
    <div class="tree-hint">Arraste um quadro sobre outro para definir quem o alimenta; arraste um circuito para outro quadro. Botão direito: mais opções.</div>`;
}
// telas estreitas: a roda do mouse rola a faixa de comandos na horizontal
$('#ribbon').addEventListener('wheel', (e) => {
  const rb = e.currentTarget;
  if (rb.scrollWidth <= rb.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  rb.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });
(function ligarGerenciador() {
  const box = $('#gerenciador');
  let arrasto = null;
  box.addEventListener('dragstart', (e) => { const n = e.target.closest('.node'); arrasto = n ? { q: n.dataset.quadro, c: n.dataset.circ } : null; });
  box.addEventListener('dragover', (e) => { if (e.target.closest('[data-quadro]')) e.preventDefault(); });
  box.addEventListener('drop', (e) => {
    const alvo = e.target.closest('[data-quadro]')?.dataset.quadro;
    if (!arrasto || !alvo) return;
    e.preventDefault();
    const todos = store.project.pavimentos.flatMap((pv) => pv.elementos);
    const destino = todos.find((x) => x.id === alvo);
    if (arrasto.q && arrasto.q !== alvo) {
      const q = todos.find((x) => x.id === arrasto.q);
      if (criaCiclo(q, alvo)) return log('Hierarquia circular não é permitida.', 'err');
      store.commit('Associar quadros', () => { q.alimentadoPor = alvo; });
      log(`${store.nomeQuadro(q)} agora é alimentado por ${store.nomeQuadro(destino)}.`, 'ok');
    } else if (arrasto.c && destino.tipo === 'qd') {
      const c = store.project.circuitos.find((x) => x.id === arrasto.c);
      store.commit('Mover circuito', () => { c.quadroId = alvo; });
      log(`${c.nome} → ${store.nomeQuadro(destino)}.`, 'ok');
    }
    renderGerenciador();
  });
  const ACOES_GER = { dialogoProcessar, renumerarCircuitos, eliminarNaoUtilizados, diagramaUnifilarGeral, relatorioDemanda: () => relatorioDemanda(), relatorioEletrodutos };
  box.addEventListener('click', (e) => {
    const g = e.target.closest('[data-ger]');
    if (g) return ACOES_GER[g.dataset.ger]();
    const n = e.target.closest('.node');
    if (!n) return;
    if (n.dataset.circ) {
      const c = store.project.circuitos.find((x) => x.id === n.dataset.circ);
      store.activeCircuitId = c.id;
      if (n.dataset.cmd) { store.settings.comandoAtivo = n.dataset.cmd; renderRibbon(); }
      store.selection = { kind: 'circuito', ref: c };
      syncCircuitSelect(); renderProps(); plan.render(); renderGerenciador();
    } else if (n.dataset.quadro) {
      const q = store.project.pavimentos.flatMap((pv) => pv.elementos).find((x) => x.id === n.dataset.quadro);
      store.selection = { kind: 'elemento', ref: q };
      renderProps(); plan.render(); renderGerenciador();
    }
  });
  box.addEventListener('contextmenu', (e) => {
    const n = e.target.closest('.node');
    if (!n) return;
    e.preventDefault();
    const todos = store.project.pavimentos.flatMap((pv) => pv.elementos);
    let itens = [];
    if (n.dataset.quadro) {
      const q = todos.find((x) => x.id === n.dataset.quadro);
      itens = [
        { id: 'circuito', label: 'Adicionar circuito', run: () => novoCircuito(q) },
        { id: 'reserva', label: 'Adicionar circuito reserva', run: () => novaReserva(q) },
        { id: 'unifilar', label: 'Diagrama unifilar', run: () => diagramaUnifilar(q) },
        { id: 'multifilar', label: 'Diagrama multifilar', run: () => diagramaMultifilar(q) },
        { id: 'executivo', label: 'Quadro executivo', run: () => quadroExecutivo(q) },
        { id: 'cargas', label: 'Quadro de cargas', run: () => relatorioCargas(q) },
        { id: 'demanda', label: 'Quadro de demanda', run: () => relatorioDemanda(q) },
        { id: 'propriedades', label: 'Propriedades', run: () => { store.select({ kind: 'elemento', ref: q }); mostrarPainel('propriedades'); } },
        { id: 'enquadrar', label: 'Localizar', run: () => { const pi = store.project.pavimentos.findIndex((pv) => pv.elementos.includes(q)); setFloor(pi); store.select({ kind: 'elemento', ref: q }); } },
      ];
    } else if (n.dataset.circ) {
      const c = store.project.circuitos.find((x) => x.id === n.dataset.circ);
      itens = [
        { id: 'atribuir', label: 'Definir circuito (clicar nos pontos)', run: () => { store.activeCircuitId = c.id; syncCircuitSelect(); store.setTool('atribuir'); } },
        { id: 'atribComando', label: 'Definir comando', run: () => { store.activeCircuitId = c.id; syncCircuitSelect(); store.setTool('atribComando'); } },
        { id: 'enquadrar', label: 'Localizar pontos', run: () => localizarCircuito(c) },
        { id: 'propriedades', label: 'Propriedades', run: () => { store.selection = { kind: 'circuito', ref: c }; renderProps(); mostrarPainel('propriedades'); } },
        { id: 'apagar', label: 'Excluir', run: () => acaoProps('delCirc', { kind: 'circuito', ref: c }) },
      ];
    }
    if (!itens.length) return;
    const m = $('#menu');
    m.innerHTML = itens.map((it, i) => `<button data-i="${i}">${ICONS[it.id] || ''}<span>${esc(it.label)}</span></button>`).join('');
    Object.assign(m.style, { left: e.clientX + 'px', top: e.clientY + 'px' });
    m.hidden = false;
    m.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; m.hidden = true; itens[Number(b.dataset.i)].run(); };
  });
})();

// ---------------------------------------------------------------- elétrico: relatórios
async function salvarPdf(titulo, corpo, nome) {
  const css = 'body{font:12px Segoe UI,Arial,sans-serif;color:#1f2933;margin:18mm 14mm}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #c9cdd2;padding:3px 6px;text-align:right}th{background:#eef0f3}td.l{text-align:left}.sub{color:#5f6b77}svg{max-width:100%;height:auto}p{line-height:1.45}';
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(titulo)}</title><style>${css}</style><h1>${esc(titulo)}</h1><p class="sub">${esc(store.project.nome)} · ${esc(store.project.autor || '')} · ${new Date().toLocaleDateString('pt-BR')}</p>${corpo}</html>`;
  if (host.salvarPdf) {
    const r = await host.salvarPdf(html, nome);
    if (r?.erro) log(`PDF: ${r.erro}`, 'err'); else if (r) log(`PDF salvo: ${r.path}`, 'ok');
  } else {
    const p = await host.exportFile(html, nome.replace(/\.pdf$/, '.html'), 'html', 'Página HTML');
    if (p) log(`Exportado: ${p}`, 'ok');
  }
}

function diagramaUnifilar(q) {
  const qds = store.ele.quadros.filter((x) => x.quadro.tipo === 'qd');
  if (!qds.length) return log('Não há quadro de distribuição.', 'warn');
  let rq = q ? qds.find((x) => x.quadro === q) : (store.selection?.kind === 'elemento' && qds.find((x) => x.quadro === store.selection.ref)) || qds[0];
  const desenha = () => {
    $('#uf-svg').innerHTML = svgUnifilar(store.project, rq);
  };
  modal('Diagrama unifilar', `${qds.length > 1 ? `<p>Quadro: <select id="uf-q">${qds.map((x, i) => `<option value="${i}"${x === rq ? ' selected' : ''}>${esc(store.nomeQuadro(x.quadro))} (${esc(x.pav?.nome || '')})</option>`).join('')}</select></p>` : ''}<div id="uf-svg" style="overflow:auto"></div>`, [
    { label: 'Salvar SVG', run: () => host.exportFile(svgUnifilar(store.project, rq), `unifilar-${store.nomeQuadro(rq.quadro)}.svg`, 'svg', 'Imagem SVG').then((p) => p && log(`Exportado: ${p}`, 'ok')) },
    { label: 'Salvar PDF', run: () => salvarPdf(`Diagrama unifilar — ${store.nomeQuadro(rq.quadro)}`, svgUnifilar(store.project, rq), `unifilar-${store.nomeQuadro(rq.quadro)}.pdf`) },
  ]);
  $('#uf-q')?.addEventListener('change', (e) => { rq = qds[Number(e.target.value)]; desenha(); });
  desenha();
}

function tabelaCargasQuadro(rq) {
  const fasesQ = rq.fasesQ;
  const head = ['Nº', 'Descrição', 'Tipo', 'Fases', 'P (VA)', ...fasesQ.map((f) => `${f} (VA)`), 'Ib (A)', 'L (m)', 'Agrup.', 'Seção (mm²)', 'Iz (A)', 'Disj. (A)', 'DR', 'ΔV (%)', 'Situação'];
  const rows = rq.circuitos.slice().sort((a, b) => a.circuito.numero - b.circuito.numero).map((r) => [
    r.circuito.numero, r.circuito.nome.replace(/^C\d+\s*/, ''), r.reserva ? 'RES' : r.circuito.tipo, r.fases.join(''), fmt(r.potencia, 0),
    ...fasesQ.map((f) => (r.fases.includes(f) ? fmt(r.potencia / r.fases.length, 0) : '')),
    fmt(r.ib), r.reserva ? '—' : fmt(r.comprimento, 1), r.reserva ? '—' : `${r.agrupamento} (${fmt(r.fAgr)})`,
    r.reserva ? '—' : fmtSec(r.secao), r.reserva || !r.ok ? '—' : fmt(r.iz, 1), r.reserva ? '—' : r.ok ? `${r.polos}P ${r.disjuntor}` : '—',
    r.dr ? `DR${r.drGrupo || ''}` : '', r.reserva || !r.ok ? '—' : fmt(r.queda), r.reserva ? '' : sit(r.ok, r.avisos),
  ]);
  const foot = ['', 'Total instalado', '', '', fmt(rq.circuitos.reduce((a, r) => a + r.potencia, 0), 0), ...fasesQ.map((f) => fmt(rq.circuitos.reduce((a, r) => a + (r.fases.includes(f) ? r.potencia / r.fases.length : 0), 0), 0)), '', '', '', '', '', '', '', '', ''];
  return { head, rows, foot };
}
function resumoQuadro(rq) {
  return htmlTabela(['Item', 'Valor'], [
    ['Esquema', `${rq.esquema} · ${store.project.eletrica.tensaoFN}/${store.project.eletrica.tensaoFF} V`],
    ['Potência instalada (com quadros a jusante)', `${fmt(rq.instaladaTotal, 0)} VA`],
    ['Demanda iluminação + TUG', `${fmt(rq.dIT, 0)} VA`], ['Demanda TUE', `${fmt(rq.dTUE, 0)} VA`], ['Demanda total', `${fmt(rq.demanda, 0)} VA`],
    ['Desequilíbrio entre fases', `${fmt(rq.deseq * 100, 1)} %`],
    ['Disjuntor geral', rq.disjuntorGeral ? `${rq.fasesQ.length}P ${rq.disjuntorGeral} A` : '—'],
    ['Alimentador', rq.alimentador?.secao ? `${rq.alimentador.condutores} ${fmtSec(rq.alimentador.secao)} mm²${rq.alimentador.pai ? ` · ${fmt(rq.alimentador.L, 1)} m · ΔV ${fmt(rq.alimentador.queda ?? 0)} %` : ''}` : '—'],
    ['Grupos DR', rq.drGrupos.map((g, i) => `DR${i + 1}: ${g.polos}P ${g.nominal} A 30 mA (${g.circuitos.map((id) => store.project.circuitos.find((c) => c.id === id)?.numero).join(', ')})`).join('; ') || '—'],
    ['DPS', rq.dps ? `classe II, ${rq.fasesQ.length + 1} unidades` : 'não'],
    ['Reservas', `${rq.reservas} (mínimo NBR ${rq.reservasMin})`], ['Quadro', `${rq.modulos} módulos → ${rq.tamanho} módulos DIN`],
  ]);
}
function relatorioCargas(q) {
  const qds = store.ele.quadros.filter((x) => x.quadro.tipo === 'qd');
  if (!qds.length) return log('Lance um quadro de distribuição (LANÇAMENTO › Quadro) para dimensionar os circuitos.', 'warn');
  const lista = q ? qds.filter((x) => x.quadro === q) : qds;
  const corpo = lista.map((rq) => { const t = tabelaCargasQuadro(rq); return `<h3>${esc(store.nomeQuadro(rq.quadro))} — ${esc(rq.pav?.nome || '')}</h3>${htmlTabela(t.head, t.rows, t.foot)}${resumoQuadro(rq)}`; }).join('');
  const nota = `Método B1, cobre/PVC 70 °C, temperatura ${store.project.eletrica.temperatura} °C. Comprimento pela rede de eletrodutos; agrupamento pelo maior número de circuitos num mesmo trecho (tab. 42). Queda máxima ${store.project.eletrica.quedaMax}% nos circuitos e ${store.project.eletrica.quedaAlim}% nos alimentadores. Demanda residencial (ilum./TUG por faixa de potência, TUE pelo número de equipamentos). DR obrigatório pelo tipo de ambiente (NBR 5410 5.1.3.2.2).`;
  modal('Quadro de cargas', corpo + `<p style="color:var(--muted)">${nota} Cálculo para pré-dimensionamento; a responsabilidade técnica é do projetista.</p>`, [
    { label: 'Exportar XLSX', run: () => exportarXlsx(lista.map((rq) => { const t = tabelaCargasQuadro(rq); return { nome: store.nomeQuadro(rq.quadro), cabecalho: true, larguras: [5, 34, 7, 7, ...t.head.slice(4).map(() => 11)], linhas: [t.head, ...t.rows.map((r) => r.map(numero)), t.foot.map(numero)] }; }), 'quadro-de-cargas.xlsx') },
    { label: 'Exportar CSV', run: () => { const t = tabelaCargasQuadro(lista[0]); host.exportFile(csv(t.head, t.rows), 'quadro-de-cargas.csv', 'csv', 'CSV').then((p) => p && log(`Exportado: ${p}`, 'ok')); } },
    { label: 'Salvar PDF', run: () => salvarPdf('Quadro de cargas', corpo + `<p class="sub">${nota}</p>`, 'quadro-de-cargas.pdf') },
  ]);
}
function relatorioLuminotecnicoGeral() {
  const amb = store.project.pavimentos.flatMap((pv) => pv.ambientes.filter((a) => a.luminotecnico).map((a) => ({ pv, a })));
  if (!amb.length) return log('Nenhum ambiente calculado. Use "Distribuir lâmpadas" num ambiente.', 'warn');
  const corpo = amb.map(({ pv, a }) => `<h3>${esc(pv.nome)} / ${esc(a.nome)}</h3>${htmlTabela(['Item', 'Valor'], relatorioLuminotecnico(a, a.luminotecnico.entrada, a.luminotecnico.resultado))}`).join('');
  modal('Relatório luminotécnico', corpo, [{ label: 'Salvar PDF', run: () => salvarPdf('Relatório luminotécnico (método dos lúmens)', corpo, 'luminotecnico.pdf') }]);
}
function memorialDescritivo() {
  const p = store.project, cfg = p.eletrica, ce = store.ele.cfg;
  const qds = store.ele.quadros;
  const total = qds.filter((q) => !q.alimentador?.pai).reduce((a, q) => a + q.demanda, 0);
  const cont = (t) => p.pavimentos.reduce((a, pv) => a + pv.elementos.filter((e) => e.tipo === t).length, 0);
  const pavs = htmlTabela(['Pavimento', 'Cota (m)', 'Pé-direito (m)', 'Pontos elétricos'], p.pavimentos.map((pv) => [pv.nome, fmt(pv.cota), fmt(pv.peDireito), pv.elementos.filter((e) => TIPOS[e.tipo]?.disc === 'ele').length]));
  const dim = qds.filter((q) => q.quadro.tipo === 'qd').map((rq) => { const t = tabelaCargasQuadro(rq); return `<h3>${esc(store.nomeQuadro(rq.quadro))} — ${esc(rq.pav?.nome || '')}</h3>${htmlTabela(t.head, t.rows, t.foot)}`; }).join('');
  const mat = listaMateriais(p, store.ele);
  const html = `
    <h2>1. Identificação</h2>${htmlTabela(['Item', 'Valor'], [['Projeto', p.nome], ['Proprietário', p.proprietario || '—'], ['Endereço', p.endereco || '—'], ['Responsável técnico', `${p.autor || '—'}${p.registro ? ` · ${p.registro}` : ''}`], ['Data', new Date().toLocaleDateString('pt-BR')]])}
    <h2>2. Descrição do projeto</h2><p>O projeto consiste na instalação elétrica de baixa tensão de <b>${esc(p.nome)}</b>, com ${p.pavimentos.length} pavimento(s), conforme descrito a seguir.</p>${pavs}
    <h2>3. Objetivo do memorial</h2><p>Apresentar as especificações dos materiais, os critérios de cálculo, o projeto elétrico e os principais resultados do dimensionamento.</p>
    <h2>4. Normas relacionadas</h2><p>ABNT NBR 5410:2004 — Instalações elétricas de baixa tensão; ABNT NBR 5419 — Proteção contra descargas atmosféricas; ABNT NBR 14136 — Plugues e tomadas; ABNT NBR NM 247 — Cabos isolados com PVC; ABNT NBR IEC 60898 — Disjuntores; ABNT NBR 15465 — Sistemas de eletrodutos plásticos; normas da concessionária local.</p>
    <h2>5. Fornecimento</h2><p>Tensões de ${cfg.tensaoFN}/${cfg.tensaoFF} V. Demanda total estimada de <b>${fmt(total / 1000, 2)} kVA</b>. ${qds.filter((q) => q.quadro.tipo !== 'qd').map((q) => `${esc(store.nomeQuadro(q.quadro))}: ${q.esquema}, disjuntor ${q.disjuntorGeral ?? '-'} A.`).join(' ')}</p>
    <h2>6. Quadros de distribuição</h2>${qds.filter((q) => q.quadro.tipo === 'qd').map((q) => `<p><b>${esc(store.nomeQuadro(q.quadro))}</b> (${esc(q.pav?.nome || '')}): esquema ${q.esquema}, ${q.circuitos.length} circuitos (${q.reservas} reservas), disjuntor geral ${q.disjuntorGeral ?? '-'} A, alimentador ${q.alimentador?.secao ? `${q.alimentador.condutores} ${fmtSec(q.alimentador.secao)} mm²` : '-'}, ${q.drGrupos.length} interruptor(es) DR de 30 mA, ${q.dps ? 'DPS classe II' : 'sem DPS'}, caixa de ${q.tamanho} módulos DIN.</p>`).join('')}
    <h2>7. Critérios de dimensionamento</h2><p>Condutores de cobre com isolação PVC 70 °C (750 V nos circuitos terminais), método de instalação B1 (eletroduto embutido), temperatura ambiente de ${cfg.temperatura} °C. Seções mínimas de 1,5 mm² para iluminação e 2,5 mm² para força. A seção atende à capacidade de condução com os fatores de agrupamento e temperatura, à coordenação Ib ≤ In ≤ Iz dos disjuntores (curva C) e à queda de tensão máxima de ${cfg.quedaMax}% nos circuitos terminais e ${cfg.quedaAlim}% nos alimentadores.</p>
    <p>Previsão de cargas pelos mínimos da NBR 5410 (9.5.2): iluminação de 100 VA para os primeiros 6 m² e 60 VA a cada 4 m² inteiros; tomadas de uso geral conforme o perímetro e o uso de cada ambiente; tomadas de uso específico com circuito exclusivo.</p>
    <h2>8. Eletrodutos</h2><p>${esc(ce.material)}, diâmetro mínimo DN ${ce.diametroMin}, taxa de ocupação máxima de ${fmt(ce.ocupacaoMax * 100, 0)}%. Iluminação pelo forro e tomadas baixas ${ce.rotaBaixa === 'piso' ? 'pelo piso' : 'pelo forro'}; circuitos de uso específico em eletroduto exclusivo. Trechos contínuos de no máximo ${ce.trechoMax} m entre caixas, reduzidos de 3 m a cada curva de 90°, com no máximo 3 curvas (NBR 5410 6.2.11.1.6).</p>
    <h2>9. Proteção</h2><p>Proteção contra sobrecorrentes por disjuntores termomagnéticos. Proteção diferencial-residual de alta sensibilidade (30 mA) nos circuitos que atendem banheiros, cozinhas, áreas de serviço, áreas externas e garagens (NBR 5410 5.1.3.2.2). Condutor de proteção (PE) em todos os circuitos. Proteção contra surtos por DPS no quadro de distribuição.</p>
    <h2>10. Relatório de dimensionamento</h2>${dim}
    <h2>11. Quantitativos principais</h2><p>${cont('luz') + cont('arandela')} pontos de luz, ${cont('tug')} tomadas de uso geral, ${cont('tue')} tomadas de uso específico, ${cont('interruptor') + cont('paralelo') + cont('intermediario') + cont('dimmer')} interruptores, ${cont('cp')} caixas de passagem, ${store.ele.segmentos.reduce((a, s) => a + s.comp, 0).toFixed(0)} m de eletrodutos.</p>
    <h2>12. Lista de materiais (elétrico)</h2>${htmlTabela(['Descrição', 'Unidade', 'Quantidade'], mat.map((m) => [m.desc, m.un, fmt(m.qtd, m.un === 'm' ? 1 : 0)]))}
    <h2>13. Observações</h2><p>Antes da execução, conferir as cotas de pontos com o projeto de arquitetura e o padrão de entrada com as exigências da concessionária local. Cálculo para pré-dimensionamento; a responsabilidade técnica é do projetista.</p>`;
  modal('Memorial descritivo — instalações elétricas', html, [{ label: 'Salvar PDF', run: () => salvarPdf('Memorial descritivo — instalações elétricas', html, 'memorial-eletrico.pdf') }]);
}

// ---------------------------------------------------------------- elétrico: processar, gerenciador e eletrodutos
const ORDEM_TIPO = { ILUM: 0, TUG: 1, TUE: 2, RESERVA: 3 };
function quadrosEmOrdem() { return store.project.pavimentos.flatMap((pv) => pv.elementos.filter((e) => e.tipo === 'qd')); }

// fases: circuitos em automático (ou já balanceados antes) são redistribuídos e as fases ficam gravadas no circuito
function balancearFases(projeto) {
  const livres = projeto.circuitos.filter((c) => !c.fase || c.fase === 'auto' || c.faseCalculada);
  for (const c of livres) c.fase = 'auto';
  const calc = calcularEletrica(projeto);
  for (const c of livres) {
    const r = calc.circuitos.find((x) => x.circuito === c);
    if (r?.fases.length) { c.fase = r.fases.join(''); c.faseCalculada = true; }
  }
  return livres.length;
}

// numeração por quadro: iluminação, TUG, TUE e reservas por último
function renumerar(projeto) {
  const qds = quadrosEmOrdem();
  const quadroDe = (c) => store.ele.circuitos.find((r) => r.circuito === c)?.quadro || null;
  const grupos = new Map();
  for (const c of projeto.circuitos) {
    const q = quadroDe(c);
    if (!grupos.has(q)) grupos.set(q, []);
    grupos.get(q).push(c);
  }
  let n = 0;
  const ordemQ = [...grupos.keys()].sort((a, b) => (a ? qds.indexOf(a) : 1e9) - (b ? qds.indexOf(b) : 1e9));
  for (const q of ordemQ) {
    const lista = grupos.get(q).sort((a, b) => (ORDEM_TIPO[a.tipo] ?? 9) - (ORDEM_TIPO[b.tipo] ?? 9) || a.numero - b.numero);
    let k = 0;
    for (const c of lista) {
      k++;
      if (c.numero !== k) n++;
      c.nome = c.nome.replace(/^C\d+\s*/, `C${k} `);
      c.numero = k;
    }
  }
  projeto.circuitos.sort((a, b) => {
    const qa = quadroDe(a), qb = quadroDe(b);
    return (qa ? qds.indexOf(qa) : 1e9) - (qb ? qds.indexOf(qb) : 1e9) || a.numero - b.numero;
  });
  return n;
}
function renumerarCircuitos() {
  let n = 0;
  store.commit('Renumerar circuitos', () => { n = renumerar(store.project); });
  syncCircuitSelect(); renderGerenciador();
  log(n ? `Circuitos renumerados por quadro (iluminação, TUG, TUE e reservas): ${n} número(s) alterado(s).` : 'A numeração já estava em ordem.', 'ok');
}
function eliminarNaoUtilizados() {
  const usados = new Set(store.project.pavimentos.flatMap((pv) => pv.elementos.map((e) => e.circuitoId)).filter(Boolean));
  const sobra = store.project.circuitos.filter((c) => c.tipo !== 'RESERVA' && !usados.has(c.id));
  if (!sobra.length) return log('Não há circuitos sem pontos.', 'ok');
  if (!confirm(`Excluir ${sobra.length} circuito(s) sem pontos?\n${sobra.map((c) => c.nome).join('\n')}`)) return;
  store.commit('Eliminar circuitos não utilizados', () => { store.project.circuitos = store.project.circuitos.filter((c) => !sobra.includes(c)); });
  if (!store.activeCircuit) store.activeCircuitId = store.project.circuitos[0]?.id || null;
  syncCircuitSelect(); renderGerenciador();
  log(`${sobra.length} circuito(s) não utilizado(s) excluído(s).`, 'ok');
}

// caixas de passagem nos trechos acima do comprimento máximo (repetido até resolver ou não haver mais o que dividir)
function inserirCaixasPassagem(segs, silencioso) {
  let total = 0;
  const perto = (pav, x, y) => pav.elementos.some((e) => e.tipo === 'cp' && Math.hypot(e.x - x, e.y - y) < 0.3);
  store.snapshot();
  for (let passo = 0; passo < 6; passo++) {
    const alvo = (passo === 0 && segs ? segs : store.ele.segmentos).filter((s) => s.excede && s.de.pav === s.para.pav);
    let novas = 0;
    for (const s of alvo) {
      const pav = s.para.pav;
      const L = Math.abs(s.para.x - s.de.x) > 0.05 && Math.abs(s.para.y - s.de.y) > 0.05;
      // na quina do trajeto em L (onde fica a curva) ou no meio do trecho reto
      let x = L ? s.para.x : (s.de.x + s.para.x) / 2, y = L ? s.de.y : (s.de.y + s.para.y) / 2;
      if (perto(pav, x, y)) { x = (s.de.x + x) / 2; y = (s.de.y + y) / 2; }
      if (perto(pav, x, y)) continue;
      pav.elementos.push({ id: store.uid('E'), tipo: 'cp', x, y, altura: s.nivel === 'piso' ? 0.3 : Math.round((pav.peDireito - 0.1) * 100) / 100, descricao: '', circuitoId: null });
      novas++;
    }
    if (!novas) break;
    total += novas;
    store.calc();
  }
  if (!total) store.undo.pop();
  store.changed(true);
  const rest = store.ele.segmentos.filter((s) => s.excede).length;
  if (!silencioso || total) log(total ? `${total} caixa(s) de passagem inserida(s).${rest ? ` Ainda há ${rest} trecho(s) acima do máximo: confira o traçado.` : ' Todos os trechos dentro do comprimento máximo.'}` : rest ? 'Não foi possível dividir os trechos longos automaticamente.' : 'Nenhum trecho acima do comprimento máximo entre caixas.', total ? 'ok' : '');
  return total;
}

function dialogoProcessar() {
  const ck = (id, txt, on = true) => `<label class="chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${txt}</label>`;
  modal('Processar', `<div class="processar">
    <p class="sub">O traçado dos eletrodutos e o dimensionamento são recalculados a cada alteração. O processamento grava os resultados que dependem de uma decisão: fases, caixas e numeração.</p>
    <h4>Opções</h4>
    ${ck('pr-fiacao', 'Passar fiação: eletrodutos, condutores e retornos em todos os trechos')}
    ${ck('pr-fases', 'Balancear fases: menor diferença de corrente entre as fases (fases fixadas à mão são mantidas)')}
    ${ck('pr-dim', 'Dimensionar circuitos: seção, disjuntor, DR, queda de tensão e alimentadores')}
    ${ck('pr-cp', 'Inserir caixas de passagem nos trechos acima do comprimento máximo (NBR 5410 6.2.11.1.6)', store.ele.segmentos.some((s) => s.excede))}
    ${ck('pr-ren', 'Renumerar circuitos por quadro (iluminação, TUG, TUE, reservas)', false)}
    ${ck('pr-salvar', 'Salvar o projeto após o processamento', false)}</div>`, [{
    label: 'Processar', primary: true, run: async () => {
      const o = Object.fromEntries(['fases', 'cp', 'ren', 'salvar', 'dim'].map((k) => [k, $(`#pr-${k}`).checked]));
      closeModal();
      let fases = 0, ren = 0, cps = 0;
      if (o.fases || o.ren) store.commit('Processar', () => { if (o.fases) fases = balancearFases(store.project); if (o.ren) ren = renumerar(store.project); });
      if (o.cp) cps = inserirCaixasPassagem(null, true);
      syncCircuitSelect(); renderGerenciador();
      const e = store.ele;
      const erros = e.avisos.filter((a) => a.nivel === 'erro').length, avisos = e.avisos.length - erros;
      const linhas = e.quadros.filter((q) => q.quadro.tipo === 'qd').map((q) => [store.nomeQuadro(q.quadro), q.circuitos.length, q.fasesQ.map((f) => `${f} ${fmt(q.fases[f], 0)}`).join(' · '), `${fmt(q.deseq * 100, 1)} %`, q.disjuntorGeral ? `${q.fasesQ.length}P ${q.disjuntorGeral} A` : '—']);
      modal('Processamento concluído', `<ul class="checks">
        <li><span class="tag ok">OK</span>${e.segmentos.length} trechos de eletroduto, ${fmt(e.segmentos.reduce((a, s) => a + s.comp, 0), 0)} m; ${e.segmentos.reduce((a, s) => a + s.condutores.length, 0)} condutores passados.</li>
        ${o.fases ? `<li><span class="tag ok">OK</span>${fases} circuito(s) com fases balanceadas e gravadas.</li>` : ''}
        ${o.cp ? `<li><span class="tag ${cps ? 'ok' : 'ok'}">OK</span>${cps} caixa(s) de passagem inserida(s).</li>` : ''}
        ${o.ren ? `<li><span class="tag ok">OK</span>${ren} número(s) de circuito alterado(s).</li>` : ''}
        <li><span class="tag ${erros ? 'erro' : avisos ? 'aviso' : 'ok'}">${erros ? 'Erro' : avisos ? 'Aviso' : 'OK'}</span>${erros} erro(s) e ${avisos} aviso(s). Os triângulos na planta mostram onde (passe o mouse sobre eles).</li></ul>
        ${htmlTabela(['Quadro', 'Circuitos', 'Carga por fase (VA)', 'Desequilíbrio', 'Disjuntor geral'], linhas)}`, [
        { label: 'Quadro de cargas', run: () => relatorioCargas() },
        { label: 'Verificações', run: () => relatorioVerificacoes() },
      ]);
      log(`Processado: ${store.results.length} circuito(s), ${e.segmentos.length} trechos de eletroduto, ${erros} erro(s), ${avisos} aviso(s).`, erros ? 'err' : 'ok');
      if (o.salvar) await salvar();
    },
  }]);
}

function tabelaEletrodutos() {
  const nome = (n) => (TIPOS[n.el.tipo]?.quadro ? store.nomeQuadro(n.el) : TIPOS[n.el.tipo]?.sigla || n.el.tipo);
  const head = ['Pavimento', 'Trecho', 'Passa', 'DN', 'Condutores', 'Área cond. (mm²)', 'Área útil (mm²)', 'Ocupação', 'L (m)', 'Curvas', 'Máx. (m)', 'Situação'];
  const rows = store.ele.segmentos.map((s) => [
    s.de.pav === s.para.pav ? s.para.pav.nome : `${s.de.pav.nome} → ${s.para.pav.nome}`, `${nome(s.de)} → ${nome(s.para)}`, s.de.pav !== s.para.pav ? 'prumada' : s.nivel === 'piso' ? 'piso' : 'forro',
    `DN ${s.dn}`, `${s.cont.F}F ${s.cont.N}N ${s.cont.T}T ${s.cont.R}R`, fmt(s.areaOcupada, 1), fmt(s.areaUtil, 1), `${fmt(s.ocupacao * 100, 0)} %`,
    fmt(s.comp, 1), s.curvas, fmt(Math.max(0, s.maxComp), 0), s.excede ? 'Aviso' : 'OK',
  ]);
  return { head, rows };
}
function relatorioEletrodutos() {
  if (!store.ele.segmentos.length) return log('Não há eletrodutos: lance um quadro e pontos com circuito.', 'warn');
  const { head, rows } = tabelaEletrodutos();
  const porDn = new Map();
  for (const s of store.ele.segmentos) porDn.set(s.dn, (porDn.get(s.dn) || 0) + s.comp);
  const resumo = htmlTabela(['Diâmetro', 'Comprimento (m)'], [...porDn].sort((a, b) => a[0] - b[0]).map(([dn, L]) => [`DN ${dn}`, fmt(L * 1.05, 1)]));
  const ce = store.ele.cfg;
  const corpo = `${htmlTabela(head, rows)}<h3>Resumo por diâmetro (com 5% de perdas)</h3>${resumo}`;
  const txt = `${ce.material}; diâmetro mínimo DN ${ce.diametroMin}; taxa de ocupação máxima ${fmt(ce.ocupacaoMax * 100, 0)}% (53% com um condutor, 31% com dois); trecho contínuo máximo de ${ce.trechoMax} m entre caixas, menos 3 m por curva de 90°, no máximo 3 curvas (NBR 5410 6.2.11.1.6). Tomadas baixas ${ce.rotaBaixa === 'piso' ? 'pelo piso' : 'pelo forro'}.`;
  modal('Dimensionamento de eletrodutos', corpo + nota(txt), [
    ...(store.ele.segmentos.some((s) => s.excede) ? [{ label: 'Inserir caixas de passagem', run: () => { closeModal(); inserirCaixasPassagem(); } }] : []),
    btnCsv(head, rows, 'eletrodutos.csv'),
    { label: 'Salvar PDF', run: () => salvarPdf('Dimensionamento de eletrodutos', corpo + `<p class="sub">${txt}</p>`, 'eletrodutos.pdf') },
  ]);
}

function escolherQuadro(q, tipos = ['qd']) {
  const qs = store.ele.quadros.filter((x) => tipos.includes(x.quadro.tipo));
  const sel = store.selection?.kind === 'elemento' ? qs.find((x) => x.quadro === store.selection.ref) : null;
  return { qs, rq: (q && qs.find((x) => x.quadro === q)) || sel || qs[0] };
}
// janela de diagrama em SVG com escolha do quadro
function dialogoDiagrama(titulo, gerar, q, prefixo, tipos) {
  let { qs, rq } = escolherQuadro(q, tipos);
  if (!rq) return log('Não há quadro de distribuição.', 'warn');
  const desenha = () => { $('#dg-svg').innerHTML = gerar(rq); };
  const nomeArq = () => `${prefixo}-${store.nomeQuadro(rq.quadro)}`;
  modal(titulo, `${qs.length > 1 ? `<p>Quadro: <select id="dg-q">${qs.map((x, i) => `<option value="${i}"${x === rq ? ' selected' : ''}>${esc(store.nomeQuadro(x.quadro))} (${esc(x.pav?.nome || '')})</option>`).join('')}</select></p>` : ''}<div id="dg-svg" style="overflow:auto"></div>`, [
    { label: 'Salvar SVG', run: () => host.exportFile(gerar(rq), `${nomeArq()}.svg`, 'svg', 'Imagem SVG').then((p) => p && log(`Exportado: ${p}`, 'ok')) },
    { label: 'Salvar PDF', run: () => salvarPdf(`${titulo} — ${store.nomeQuadro(rq.quadro)}`, gerar(rq), `${nomeArq()}.pdf`) },
  ]);
  $('#dg-q')?.addEventListener('change', (e) => { rq = qs[Number(e.target.value)]; desenha(); });
  desenha();
}
const diagramaMultifilar = (q) => dialogoDiagrama('Diagrama multifilar', (rq) => svgMultifilar(store.project, rq), q, 'multifilar');
const quadroExecutivo = (q) => dialogoDiagrama('Quadro executivo', (rq) => svgQuadroExecutivo(store.project, rq), q, 'quadro-executivo');
function diagramaUnifilarGeral() {
  if (!store.ele.quadros.length) return log('Não há quadros no projeto.', 'warn');
  const svg = svgUnifilarGeral(store.project, store.ele);
  modal('Diagrama unifilar geral', `<div style="overflow:auto">${svg}</div>`, [
    { label: 'Salvar SVG', run: () => host.exportFile(svg, 'unifilar-geral.svg', 'svg', 'Imagem SVG').then((p) => p && log(`Exportado: ${p}`, 'ok')) },
    { label: 'Salvar PDF', run: () => salvarPdf('Diagrama unifilar geral', svg, 'unifilar-geral.pdf') },
  ]);
}
function htmlDemanda(rq) {
  const d = quadroDemanda(store.project, rq);
  return `${htmlTabela(d.head, d.rows, d.foot)}${htmlTabela(['Item', 'Valor'], d.resumo)}`;
}
function relatorioDemanda(q) {
  const lista = q ? store.ele.quadros.filter((x) => x.quadro === q) : store.ele.quadros.filter((x) => x.circuitos.length || x.filhos.length);
  if (!lista.length) return log('Não há quadros com carga.', 'warn');
  const corpo = lista.map((rq) => `<h3>${esc(store.nomeQuadro(rq.quadro))} — ${esc(TIPOS[rq.quadro.tipo].nome)}</h3>${htmlDemanda(rq)}`).join('');
  const txt = 'Demanda residencial: iluminação, TUG e reservas pelo fator da faixa de potência instalada; TUE pelo número de equipamentos; quadros a jusante pela demanda já calculada. Corrente de projeto pela fase mais carregada.';
  modal('Quadro de demanda', corpo + nota(txt), [{ label: 'Salvar PDF', run: () => salvarPdf('Quadro de demanda', corpo + `<p class="sub">${txt}</p>`, 'quadro-de-demanda.pdf') }]);
}

// legenda de fiação: indicações numéricas dos eletrodutos de cada pavimento
function htmlLegendaFiacao(pav) {
  const t = legendaFiacao(store.project, store.ele, pav, indicacoesPavimento(store.ele, pav));
  return t.rows.length ? htmlTabela(t.head, t.rows) : '';
}
function relatorioLegendaFiacao() {
  const corpo = store.project.pavimentos.map((pv) => { const h = htmlLegendaFiacao(pv); return h ? `<h3>${esc(pv.nome)}</h3>${h}` : ''; }).join('');
  if (!corpo) return log('Não há eletrodutos para a legenda.', 'warn');
  modal('Legenda de fiação', corpo + nota('Os números correspondem às indicações dos eletrodutos na planta (OPERAÇÕES › Indicação numérica).'), [
    { label: store.settings.indicacaoNumerica ? 'Voltar às indicações por extenso' : 'Mostrar indicações numéricas na planta', run: () => { toggleSetting('indicacaoNumerica'); closeModal(); } },
    { label: 'Salvar PDF', run: () => salvarPdf('Legenda de fiação', corpo, 'legenda-de-fiacao.pdf') },
  ]);
}

// legenda de símbolos: os símbolos usados, desenhados pelo mesmo código da planta
const _iconeSimb = new Map();
function iconeSimbolo(tipo) {
  if (_iconeSimb.has(tipo)) return _iconeSimb.get(tipo);
  const cv = document.createElement('canvas');
  cv.width = 96; cv.height = 64;
  const fake = Object.assign(Object.create(Plan2D.prototype), { ctx: cv.getContext('2d'), scale: 60, store });
  fake.ctx.setTransform(2, 0, 0, 2, 0, 0);
  const t = TIPOS[tipo];
  fake.drawSymbol(tipo, { x: 24, y: 17 }, t.disc === 'hid' ? '#0f6f80' : t.disc === 'est' ? '#6b4fa0' : '#34404c', { b: t.b || 20, h: t.h || 30 });
  const url = cv.toDataURL('image/png');
  _iconeSimb.set(tipo, url);
  return url;
}
function iconeLinha(estilo) {
  const cv = document.createElement('canvas');
  cv.width = 96; cv.height = 64;
  const c = cv.getContext('2d');
  c.setTransform(2, 0, 0, 2, 0, 0);
  c.lineWidth = 1.6;
  c.strokeStyle = estilo === 'alim' ? '#b05a00' : '#4a5562';
  if (estilo === 'piso') c.setLineDash([7, 4]);
  if (estilo === 'alim') { c.setLineDash([10, 4]); c.lineWidth = 2.4; }
  c.beginPath(); c.moveTo(4, 17); c.lineTo(44, 17); c.stroke();
  if (estilo === 'fiacao') {
    c.setLineDash([]);
    const marca = (x, cor, tipo) => { c.strokeStyle = cor; c.beginPath(); c.moveTo(x - 4, 21); c.lineTo(x + 4, 13); if (tipo === 'N') { c.moveTo(x + 1, 13); c.lineTo(x + 4, 13); } if (tipo === 'T') { c.moveTo(x - 2, 23); c.lineTo(x + 6, 15); } if (tipo === 'R') { c.moveTo(x + 4, 13); c.lineTo(x + 6, 16); } c.stroke(); };
    marca(14, '#2b2f33', 'F'); marca(21, '#1d6fd6', 'N'); marca(28, '#1f9d55', 'T'); marca(35, '#c98a00', 'R');
  }
  return cv.toDataURL('image/png');
}
function linhasSimbolos(pavs, soEle) {
  const cont = new Map();
  for (const pv of pavs) for (const e of pv.elementos) { const t = TIPOS[e.tipo]; if (t && (t.disc === 'ele' || (t.disc === 'hid' && !soEle))) cont.set(e.tipo, (cont.get(e.tipo) || 0) + 1); }
  const ordem = Object.keys(TIPOS);
  const rows = [...cont].sort((a, b) => ordem.indexOf(a[0]) - ordem.indexOf(b[0])).map(([tipo, n]) => {
    const t = TIPOS[tipo];
    return { img: iconeSimbolo(tipo), desc: `${t.nome}${t.disc === 'ele' && !t.quadro && t.altura != null ? ` — h = ${fmt(t.altura)} m` : ''}`, n };
  });
  if (pavs.some((pv) => store.ele.segmentos.some((s) => s.para.pav === pv))) {
    rows.push({ img: iconeLinha('forro'), desc: 'Eletroduto embutido no forro/laje', n: '' }, { img: iconeLinha('piso'), desc: 'Eletroduto embutido no piso', n: '' },
      { img: iconeLinha('fiacao'), desc: 'Condutores: fase, neutro, proteção (terra), retorno', n: '' });
    if (store.ele.alimentadores.length) rows.push({ img: iconeLinha('alim'), desc: 'Alimentador entre quadros', n: '' });
  }
  return rows;
}
function htmlLegendaSimbolos(pavs, compacta) {
  const rows = linhasSimbolos(pavs, compacta);
  if (!rows.length) return '';
  return `<table class="report simbolos"><thead><tr><th>Símbolo</th><th>Descrição</th>${compacta ? '' : '<th>Qtd.</th>'}</tr></thead><tbody>${rows.map((r) => `<tr><td style="text-align:center"><img src="${r.img}" style="width:48px;height:32px"></td><td class="l">${esc(r.desc)}</td>${compacta ? '' : `<td>${r.n}</td>`}</tr>`).join('')}</tbody></table>`;
}
function relatorioSimbolos() {
  const corpo = htmlLegendaSimbolos(store.project.pavimentos);
  if (!corpo) return log('Não há símbolos lançados.', 'warn');
  modal('Legenda de símbolos', corpo, [{ label: 'Salvar PDF', run: () => salvarPdf('Legenda de símbolos', corpo, 'legenda-de-simbolos.pdf') }]);
}

// ---------------------------------------------------------------- entrega: pranchas, IFC
function conteudoPranchas(o) {
  const pranchas = [];
  const temEle = (pv) => pv.elementos.some((e) => TIPOS[e.tipo]?.disc === 'ele');
  const notas = (pv) => `<div style="font-size:2.6mm;line-height:1.35"><b>Notas</b><br>1. Cotas em metros; alturas de instalação conforme a legenda.<br>2. Eletrodutos ${store.ele.cfg.material.toLowerCase()}, DN mínimo ${store.ele.cfg.diametroMin}; tracejado: pelo piso.<br>3. Circuitos e seções conforme o quadro de cargas.<br>4. Conferir com o projeto de arquitetura antes da execução.</div>`;
  const tiposPlanta = o.luzForca ? [['iluminacao', 'Planta de iluminação'], ['tomadas', 'Planta de tomadas']] : [['completa', 'Planta elétrica']];
  for (const pv of store.project.pavimentos.filter(temEle)) {
    for (const [planta, nomeP] of tiposPlanta) {
      const img = renderizarPlanta(store, pv, { escala: o.escala, planta, numerica: o.numerica, fundo: o.fundo });
      const conteudo = [{ tipo: 'img', ...img, hmm: img.hmm + 5, legenda: `${nomeP} — ${pv.nome} — escala 1:${o.escala}` }];
      if (o.simbolos) conteudo.push({ tipo: 'html', html: `<div style="font-size:3mm;font-weight:700;margin-bottom:1mm">Legenda</div>${htmlLegendaSimbolos([pv], true)}`, wmm: 78, hmm: 12 + linhasSimbolos([pv], true).length * 10.6 });
      if (o.numerica) { const h = htmlLegendaFiacao(pv); if (h) conteudo.push({ tipo: 'html', html: `<div style="font-size:3mm;font-weight:700;margin-bottom:1mm">Legenda de fiação</div>${h}`, wmm: 175 }); }
      conteudo.push({ tipo: 'html', html: notas(pv), wmm: 95, hmm: 26 });
      pranchas.push({ titulo: `${nomeP} — ${pv.nome}`, escala: o.escala, conteudo });
    }
  }
  const diag = [];
  const qds = store.ele.quadros.filter((q) => q.quadro.tipo === 'qd');
  if (o.geral && store.ele.quadros.length > 1) diag.push({ tipo: 'svg', svg: svgUnifilarGeral(store.project, store.ele), legenda: 'Diagrama unifilar geral' });
  for (const rq of qds) {
    const n = store.nomeQuadro(rq.quadro);
    if (o.unifilar) diag.push({ tipo: 'svg', svg: svgUnifilar(store.project, rq), legenda: `Diagrama unifilar — ${n}` });
    if (o.cargas) { const t = tabelaCargasQuadro(rq); diag.push({ tipo: 'html', html: `<div style="font-size:3mm;font-weight:700;margin-bottom:1mm">Quadro de cargas — ${esc(n)}</div>${htmlTabela(t.head, t.rows, t.foot)}`, wmm: 265 }); }
    if (o.executivo) diag.push({ tipo: 'svg', svg: svgQuadroExecutivo(store.project, rq), legenda: `Quadro executivo — ${n}` });
    if (o.multifilar) diag.push({ tipo: 'svg', svg: svgMultifilar(store.project, rq), legenda: `Diagrama multifilar — ${n}` });
    if (o.demanda) diag.push({ tipo: 'html', html: `<div style="font-size:3mm;font-weight:700;margin-bottom:1mm">Quadro de demanda — ${esc(n)}</div>${htmlDemanda(rq)}`, wmm: 150 });
  }
  if (diag.length) pranchas.push({ titulo: 'Diagramas e quadros', escala: null, conteudo: diag });
  return pranchas;
}
function infoSelo() {
  const p = store.project;
  return { projeto: p.nome, proprietario: p.proprietario, endereco: p.endereco, autor: p.autor, registro: p.registro, data: new Date().toLocaleDateString('pt-BR'), disciplina: 'Instalações elétricas' };
}
function dialogoPranchas() {
  const ck = (id, txt, on = true) => `<label class="chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${txt}</label>`;
  const escalas = [25, 50, 75, 100, 125];
  modal('Gerar pranchas', `<div class="pranchas-op">
    <div><h4>Folha</h4><p>Formato <select id="pc-papel"><option value="auto">Automático (menor que couber)</option>${Object.keys(FOLHAS).map((f) => `<option>${f}</option>`).join('')}</select></p>
      <p>Escala das plantas <select id="pc-escala">${escalas.map((e) => `<option value="${e}"${e === 50 ? ' selected' : ''}>1:${e}</option>`).join('')}</select></p>
      <p class="sub">Margem e selo com projeto, proprietário, endereço e responsável técnico (edite em ARQUIVO › Configurações).</p></div>
    <div><h4>Plantas</h4>${ck('pc-luzForca', 'Separar plantas de iluminação e de tomadas (luz e força)', false)}${ck('pc-simbolos', 'Legenda de símbolos')}${ck('pc-numerica', 'Indicação numérica com legenda de fiação', false)}${ck('pc-fundo', 'Incluir desenho de referência (DWG/DXF)')}</div>
    <div><h4>Diagramas e quadros</h4>${ck('pc-unifilar', 'Diagramas unifilares')}${ck('pc-cargas', 'Quadros de cargas')}${ck('pc-executivo', 'Quadros executivos')}${ck('pc-geral', 'Unifilar geral (quadros subordinados)')}${ck('pc-demanda', 'Quadros de demanda', false)}${ck('pc-multifilar', 'Diagramas multifilares', false)}</div>
    </div><div id="pc-prev"></div>`, [
    { label: 'Pré-visualizar', run: () => previaPranchas() },
    { label: 'Salvar PDF', primary: true, run: () => salvarPranchas() },
  ]);
}
function opcoesPranchas() {
  const o = { papel: $('#pc-papel').value, escala: Number($('#pc-escala').value) };
  for (const k of ['luzForca', 'simbolos', 'numerica', 'fundo', 'unifilar', 'cargas', 'executivo', 'geral', 'demanda', 'multifilar']) o[k] = $(`#pc-${k}`).checked;
  return o;
}
function montarPranchas(o) { return gerarPranchas({ pranchas: conteudoPranchas(o), papel: o.papel, info: infoSelo() }); }
function previaPranchas() {
  const r = montarPranchas(opcoesPranchas());
  const largura = Math.min(1080, $('#modal-body').clientWidth - 30);
  $('#pc-prev').innerHTML = `<style>${r.css}</style><p class="sub">${r.folhas.length} prancha(s): ${r.folhas.map((f) => `${f.titulo} (${f.folha})`).join(' · ')}</p>` + r.folhas.map((f, i) => {
    const [W, H] = FOLHAS[f.folha];
    const k = largura / (W * 3.7795);
    const sec = r.corpo.split('<section').filter(Boolean)[i];
    return `<div class="prev-folha" style="width:${W * 3.7795 * k}px;height:${H * 3.7795 * k}px"><div style="transform:scale(${k});transform-origin:0 0"><section${sec}</div></div>`;
  }).join('');
}
async function salvarPranchas() {
  const r = montarPranchas(opcoesPranchas());
  if (host.salvarPdf) {
    log(`Gerando ${r.folhas.length} prancha(s)...`);
    const res = await host.salvarPdf(r.html, `${store.project.nome || 'projeto'} - pranchas.pdf`);
    if (res?.erro) log(`PDF: ${res.erro}`, 'err'); else if (res) log(`Pranchas salvas: ${res.path} (${r.folhas.length} folha(s): ${[...new Set(r.folhas.map((f) => f.folha))].join(', ')}).`, 'ok');
  } else {
    const p = await host.exportFile(r.html, 'pranchas.html', 'html', 'Página HTML');
    if (p) log(`Exportado: ${p}`, 'ok');
  }
}
async function exportarModeloIfc() {
  const r = exportarIfc(store.project, { ele: store.ele, hid: store.hid, nomeQuadro: (q) => store.nomeQuadro(q) }, { autor: store.project.autor, app: 'Vértice' });
  const p = await host.exportFile(r.texto, `${store.project.nome || 'projeto'}.ifc`, 'ifc', 'Modelo IFC (BIM)');
  const s = r.resumo;
  if (p) log(`IFC4 exportado: ${p} — ${s.paredes} paredes, ${s.pilares} pilares, ${s.vigas} vigas, ${s.lajes} lajes, ${s.pontos} pontos, ${s.eletrodutos} eletrodutos, ${s.tubos} tubos.`, 'ok');
}
async function exportarXlsx(folhas, nome) {
  const bytes = gerarXlsx(folhas);
  if (!host.exportBinary) return log('Exportação XLSX disponível no aplicativo instalado.', 'warn');
  const p = await host.exportBinary(bytes, nome, 'xlsx', 'Planilha Excel');
  if (p) log(`Planilha salva: ${p}`, 'ok');
}
const numero = (v) => { if (typeof v === 'number') return v; const t = String(v ?? '').trim(); return /^-?[\d.]+(,\d+)?$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : v; };

// ---------------------------------------------------------------- DWG / DXF
async function importarCad() {
  const r = await host.importCad();
  if (!r) return;
  if (r.erro) return log(`Não foi possível abrir o desenho: ${r.erro}`, 'err');
  let dados;
  try { dados = lerDxf(r.content); } catch (e) { return log(`Desenho inválido: ${e.message}`, 'err'); }
  const total = dados.segs.length + dados.circs.length + dados.textos.length;
  if (!total) return log('O desenho não tem linhas, círculos ou textos legíveis no espaço do modelo.', 'warn');
  const unidades = [[0.001, 'milímetros'], [0.01, 'centímetros'], [1, 'metros']];
  const lista = dados.camadas.map((c, i) => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0">
    <input type="checkbox" data-i="${i}" ${c.desligada ? '' : 'checked'}><span class="swatch" style="background:${corAci(c.cor)}"></span>${esc(c.nome)}</label>`).join('');
  const temParedes = dados.camadas.findIndex((c) => /PAR|WALL|ALV/i.test(c.nome));
  modal(`Importar ${r.nome}`, `
    <p>${dados.segs.length} linhas, ${dados.circs.length} círculos e ${dados.textos.length} textos em ${dados.camadas.length} camadas.
    O desenho entra como <b>referência</b> no pavimento <b>${esc(store.floor.nome)}</b>, para lançar os elementos por cima.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <div><b>Unidade do desenho</b>${dados.unidadeAdivinhada ? ' <span class="tag aviso">estimada</span>' : ''}<br>
        <select id="imp-un" style="margin-top:6px">${unidades.map(([f, n]) => `<option value="${f}"${Math.abs(f - dados.fator) < 1e-9 ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <p style="color:var(--muted)">Largura do desenho: <span id="imp-larg"></span></p>
        <b>Paredes</b><br><label style="display:flex;gap:8px;margin-top:6px"><input type="checkbox" id="imp-par" ${temParedes >= 0 ? 'checked' : ''}>Criar paredes a partir de linhas duplas das camadas marcadas abaixo como "paredes"</label>
        <select id="imp-cam-par" multiple size="6" style="width:100%;margin-top:6px">${dados.camadas.map((c, i) => `<option value="${i}"${i === temParedes ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
      </div>
      <div><b>Camadas visíveis</b><div style="max-height:280px;overflow:auto;margin-top:6px">${lista}</div></div>
    </div>`, [{ label: 'Importar', primary: true, run: () => {
    const fator = Number($('#imp-un').value);
    const fundo = paraFundo(dados, r.nome, fator);
    document.querySelectorAll('#modal-body input[data-i]').forEach((cb) => { fundo.camadas[Number(cb.dataset.i)].vis = cb.checked; });
    const camPar = new Set([...$('#imp-cam-par').selectedOptions].map((o) => Number(o.value)));
    const criarParedes = $('#imp-par').checked && camPar.size;
    closeModal();
    let novas = [];
    store.commit('Importar DWG/DXF', () => {
      store.floor.fundo = fundo;
      if (criarParedes) { novas = paredesDeLinhas(fundo, camPar, (p) => store.uid(p)); store.floor.paredes.push(...novas); }
    });
    store.settings.vis.fundo = true;
    plan.zoomExtents();
    log(`Referência "${r.nome}" importada no ${store.floor.nome}.${criarParedes ? ` ${novas.length} paredes reconhecidas.` : ''}`, 'ok');
  } }]);
  const atualiza = () => { $('#imp-larg').textContent = `${fmt((dados.ext.maxX - dados.ext.minX) * Number($('#imp-un').value))} × ${fmt((dados.ext.maxY - dados.ext.minY) * Number($('#imp-un').value))} m`; };
  $('#imp-un').onchange = atualiza;
  atualiza();
}

function dialogoCamadas() {
  const f = store.floor.fundo;
  if (!f) return log('Este pavimento não tem desenho de referência. Use Importar DWG/DXF.', 'warn');
  modal(`Camadas de ${f.arquivo}`, `<div style="columns:2">${f.camadas.map((c, i) => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0;break-inside:avoid">
    <input type="checkbox" data-i="${i}" ${c.vis ? 'checked' : ''}><span class="swatch" style="background:${corAci(c.cor)}"></span>${esc(c.nome)}</label>`).join('')}</div>`, [
    { label: 'Todas', run: () => document.querySelectorAll('#modal-body input').forEach((c) => (c.checked = true)) },
    { label: 'Nenhuma', run: () => document.querySelectorAll('#modal-body input').forEach((c) => (c.checked = false)) },
    { label: 'Aplicar', primary: true, run: () => {
      store.commit('Camadas', () => document.querySelectorAll('#modal-body input[data-i]').forEach((cb) => { f.camadas[Number(cb.dataset.i)].vis = cb.checked; }));
      closeModal();
    } },
  ]);
}

function dialogoParedes() {
  const f = store.floor.fundo;
  if (!f) return log('Importe um DWG/DXF primeiro.', 'warn');
  modal('Paredes a partir do desenho', `<p>Escolha as camadas onde as paredes estão desenhadas (duas linhas paralelas). Cada par com 8 a 40 cm de afastamento vira uma parede no eixo.</p>
    <select id="par-cam" multiple size="10" style="width:100%">${f.camadas.map((c, i) => `<option value="${i}"${/PAR|WALL|ALV/i.test(c.nome) ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>`, [
    { label: 'Criar paredes', primary: true, run: () => {
      const cams = new Set([...$('#par-cam').selectedOptions].map((o) => Number(o.value)));
      closeModal();
      let novas = [];
      store.commit('Paredes do desenho', () => { novas = paredesDeLinhas(f, cams, (p) => store.uid(p)); store.floor.paredes.push(...novas); });
      log(`${novas.length} paredes criadas a partir do desenho.`, novas.length ? 'ok' : 'warn');
    } },
  ]);
}

function removerReferencia() {
  if (!store.floor.fundo) return log('Não há referência neste pavimento.', 'warn');
  store.commit('Remover referência', () => { delete store.floor.fundo; });
  log('Referência removida.');
}

async function exportarCad(todos) {
  const pavs = todos ? store.project.pavimentos : [store.floor];
  const dxf = exportarDxf(store.project, store, pavs);
  const base = (store.project.nome + (todos ? '' : ' - ' + store.floor.nome)).replace(/[\\/:*?"<>|]+/g, '-');
  const r = await host.exportCad(dxf, `${base}.dwg`);
  if (!r) return;
  if (r.erro) return log(`Falha ao exportar: ${r.erro}`, 'err');
  log(`Exportado: ${r.path}`, 'ok');
}

// ---------------------------------------------------------------- arquivos
async function confirmarDescartar() {
  return !store.dirty || confirm('Há alterações não salvas. Descartar?');
}
function carregar(projeto, filePath) {
  if (!projeto?.pavimentos?.length) throw new Error('Arquivo não é um projeto válido.');
  store.project = normalizar(projeto);
  store.floorIdx = 0;
  store.selection = null;
  store.undo = []; store.redo = [];
  store.filePath = filePath;
  store.activeCircuitId = projeto.circuitos[0]?.id || null;
  store.calc();
  docs.lista = [];
  abrirDoc(store.rede || 'ele', store.floor.id);
  docs.lista.push({ id: ++docSeq, tipo: '3d', pavId: null });
  store.changed(true);
  store.dirty = false;
  updateTitle(); renderRibbon();
  requestAnimationFrame(() => plan.zoomExtents());
}
async function novoProjeto() {
  if (!(await confirmarDescartar())) return;
  carregar({ versao: 2, nome: 'Novo projeto', autor: '', seq: 0, circuitos: [
    { id: 'C1', numero: 1, nome: 'C1 Iluminação', tipo: 'ILUM', tensao: 127 },
    { id: 'C2', numero: 2, nome: 'C2 TUG', tipo: 'TUG', tensao: 127 },
  ], pavimentos: [{ id: 'PV1', nome: 'Térreo', cota: 0, peDireito: 2.8, paredes: [], elementos: [] }] }, null);
  abrirDoc('arq', store.floor.id);
  store.setTool('parede');
  currentTab = 'ELEMENTOS'; renderRibbon();
  log('Novo projeto. Desenhe as paredes ou importe um DWG/DXF da arquitetura.', 'ok');
}
async function abrir() {
  if (!(await confirmarDescartar())) return;
  const r = await host.openProject();
  if (!r) return;
  try { carregar(JSON.parse(r.content), r.path); log(`Aberto: ${r.path}`, 'ok'); }
  catch (e) { log(`Não foi possível abrir: ${e.message}`, 'err'); }
}
async function salvar(como) {
  const p = await host.saveProject(JSON.stringify(store.project), como ? null : store.filePath);
  if (!p) return;
  store.filePath = p; store.dirty = false; updateTitle();
  log(`Salvo: ${p}`, 'ok');
}

// ---------------------------------------------------------------- relatórios
function modal(title, body, buttons = []) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  const foot = $('#modal-foot');
  foot.innerHTML = '';
  for (const b of [...buttons, { label: 'Fechar', primary: !buttons.some((x) => x.primary), run: closeModal }]) {
    const el = document.createElement('button');
    el.className = 'btn' + (b.primary ? ' primary' : '');
    el.textContent = b.label;
    el.onclick = b.run;
    foot.appendChild(el);
  }
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });

function htmlTabela(head, rows, foot) {
  return `<table class="report"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, i) => {
    const tag = v === 'OK' ? 'ok' : v === 'Aviso' ? 'aviso' : v === 'Erro' ? 'erro' : '';
    return `<td class="${i === 0 || (typeof v === 'string' && isNaN(v.replace(',', '.')) && !tag) ? 'l' : ''}">${tag ? `<span class="tag ${tag}">${v}</span>` : esc(v)}</td>`;
  }).join('')}</tr>`).join('')}</tbody>${foot ? `<tfoot><tr>${foot.map((v, i) => `<td class="${i === 0 ? 'l' : ''}">${esc(v)}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
}
const csv = (head, rows) => [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
const nota = (t) => `<p style="color:var(--muted);margin-top:10px">${t} Cálculo simplificado para estudo e pré-dimensionamento; a responsabilidade técnica é do projetista.</p>`;
const btnCsv = (head, rows, nome) => ({ label: 'Exportar CSV', run: () => host.exportFile(csv(head, rows), nome, 'csv', 'CSV').then((p) => p && log(`Exportado: ${p}`, 'ok')) });
const sit = (ok, avisos) => (!ok ? 'Erro' : avisos?.length ? 'Aviso' : 'OK');

function tabelaVigas() {
  const head = ['Pavimento', 'Viga', 'b×h (cm)', 'Vão (m)', 'q (kN/m)', 'M (kN·m)', 'V (kN)', 'As (cm²)', 'Armadura', 'Situação'];
  const rows = store.est.vigas.map((r) => [r.pav.nome, `V${r.pav.vigas.indexOf(r.viga) + 1}`, `${r.viga.b}×${r.viga.h}`, fmt(r.L), fmt(r.q), fmt(r.M, 1), fmt(r.V, 1),
    r.As ? fmt(r.As) : '—', r.barras ? `${r.barras.n} φ ${fmtSec(r.barras.phi)}` : '—', sit(r.ok, r.avisos)]);
  return { head, rows };
}
function relatorioVigas() {
  const { head, rows } = tabelaVigas();
  if (!rows.length) return log('Não há vigas. Use Estrutural > Lançamento automático ou a ferramenta Viga.', 'warn');
  const probs = store.est.vigas.filter((r) => r.avisos.length).map((r) => `<li>${esc(r.pav.nome)} V${r.pav.vigas.indexOf(r.viga) + 1}: ${r.avisos.map(esc).join(' ')}</li>`).join('');
  modal('Vigas: pré-dimensionamento', htmlTabela(head, rows) + (probs ? `<ul style="color:var(--danger)">${probs}</ul>` : '')
    + nota('Concreto C25, aço CA-50, vigas biapoiadas, cargas de lajes por charneiras a 45°, alvenaria do pavimento de cima (13 kN/m³) e peso próprio. Armadura de flexão no meio do vão.'),
  [btnCsv(head, rows, 'vigas.csv')]);
}
function tabelaPilares() {
  const head = ['Pavimento', 'Pilar', 'b×h (cm)', 'N (kN)', 'Nd (kN)', 'As (cm²)', 'Armadura', 'Taxa (%)', 'Situação'];
  const rows = store.est.pilares.map((r) => [r.pav.nome, `P${r.pav.elementos.filter((e) => e.tipo === 'pilar').indexOf(r.pilar) + 1}`, `${r.pilar.b}×${r.pilar.h}`,
    fmt(r.N, 1), fmt(r.Nd, 1), fmt(r.As), r.barras ? `${r.barras.n} φ ${fmtSec(r.barras.phi)}` : '—', fmt(r.taxa * 100), sit(r.ok, r.avisos)]);
  return { head, rows };
}
function relatorioPilares() {
  const { head, rows } = tabelaPilares();
  if (!rows.length) return log('Não há pilares.', 'warn');
  modal('Pilares: pré-dimensionamento', htmlTabela(head, rows) + nota('Compressão centrada com acréscimo de 20% para excentricidades, γf = 1,4. Cargas acumuladas do topo para a base.'), [btnCsv(head, rows, 'pilares.csv')]);
}
function tabelaFundacoes() {
  const head = ['Pilar', 'N (kN)', 'Área necessária (m²)', 'Sapata quadrada (m)'];
  const base = store.project.pavimentos[0];
  const rows = store.est.fundacao.map((f) => [`P${base.elementos.filter((e) => e.tipo === 'pilar').indexOf(f.pilar) + 1}`, fmt(f.N, 1), fmt(f.area), `${fmt(f.lado)} × ${fmt(f.lado)}`]);
  return { head, rows };
}
function relatorioFundacoes() {
  const { head, rows } = tabelaFundacoes();
  if (!rows.length) return log('Não há pilares no pavimento mais baixo.', 'warn');
  const tot = store.est.fundacao.reduce((s, f) => s + f.N, 0);
  modal('Cargas na fundação', htmlTabela(head, rows, ['Total', fmt(tot, 1), '', ''])
    + nota(`Tensão admissível do solo: ${store.est.sigma} kPa (altere em Propriedades do projeto). Área = 1,05·N/σadm, lado mínimo 0,60 m.`), [btnCsv(head, rows, 'fundacoes.csv')]);
}

function tabelaAguaFria() {
  const head = ['De', 'Para', 'Pavimento', 'Compr. (m)', 'ΣP', 'Q (L/s)', 'Ø (mm)', 'v (m/s)', 'J (m/m)', 'Perda (mca)'];
  const nome = (n) => (n.el ? `${TIPOS[n.el.tipo].sigla} ${n.el.id}` : '');
  const rows = store.hid.af.segmentos.map((s) => [nome(s.de), nome(s.para), s.para.pav.nome, fmt(s.comp), fmt(s.somaP, 1), fmt(s.q, 3), TUBOS_AF[s.idx][0], fmt(s.v), fmt(s.j, 4), fmt(s.perda, 3)]);
  return { head, rows };
}
function relatorioAguaFria() {
  const { head, rows } = tabelaAguaFria();
  const pts = store.hid.af.pontos.map((p) => [TIPOS[p.no.el.tipo].nome, p.no.pav.nome, fmt(p.no.z, 2), fmt(p.pressao, 2), p.pressao >= 1 ? 'OK' : 'Erro']);
  const av = store.hid.af.avisos.map((a) => `<li>${esc(a.texto)}</li>`).join('');
  modal('Água fria: dimensionamento', (rows.length ? htmlTabela(head, rows) : '<p>Nenhum trecho. Insira um reservatório e aparelhos.</p>')
    + (pts.length ? `<h4>Pressões nos pontos de utilização</h4>${htmlTabela(['Aparelho', 'Pavimento', 'Cota (m)', 'Pressão (mca)', 'Situação'], pts)}` : '')
    + (av ? `<ul style="color:var(--danger)">${av}</ul>` : '')
    + nota('Método dos pesos Q = 0,3·√ΣP, PVC soldável, v ≤ 3 m/s, Fair-Whipple-Hsiao com +20% de perdas localizadas, pressão dinâmica mínima 1 mca. Rede em árvore pelo menor trajeto ortogonal; os diâmetros aumentam automaticamente onde falta pressão.'),
  [btnCsv(head, rows, 'agua-fria.csv')]);
}
function tabelaEsgoto() {
  const head = ['De', 'Para', 'Pavimento', 'Compr. (m)', 'ΣUHC', 'DN', 'Declividade (%)'];
  const nome = (n) => (n.el ? `${TIPOS[n.el.tipo].sigla} ${n.el.id}` : '');
  const rows = store.hid.esg.segmentos.map((s) => [nome(s.para), nome(s.de), s.para.pav.nome, fmt(s.comp), s.uhc, s.dn, s.declividade]);
  return { head, rows };
}
function relatorioEsgoto() {
  const { head, rows } = tabelaEsgoto();
  const av = store.hid.esg.avisos.map((a) => `<li>${esc(a.texto)}</li>`).join('');
  modal('Esgoto sanitário: dimensionamento', (rows.length ? htmlTabela(head, rows) : '<p>Nenhum trecho. Insira uma caixa de inspeção e aparelhos.</p>') + (av ? `<ul style="color:var(--danger)">${av}</ul>` : '')
    + nota('Diâmetro pela soma de UHC a montante e pelo DN mínimo de cada aparelho (bacia DN 100). Declividade mínima 2% até DN 75 e 1% a partir de DN 100.'),
  [btnCsv(head, rows, 'esgoto.csv')]);
}
function relatorioSpda() {
  const s = store.spda;
  if (!s.ativo) return log('SPDA desativado. Aba SPDA > SPDA ativo.', 'warn');
  if (!s.captacao) return log(s.avisos.map((a) => a.texto).join(' '), 'warn');
  const head = ['Item', 'Valor'];
  const rows = [['Nível de proteção', s.nivel], ['Malha de captação', `${s.malha} × ${s.malha} m`], ['Contorno da cobertura', `${fmt(s.contorno.maxX - s.contorno.minX)} × ${fmt(s.contorno.maxY - s.contorno.minY)} m`],
    ['Altura da captação', `${fmt(s.contorno.z)} m`], ['Espaçamento máx. das descidas', `${s.esp} m`], ['Número de descidas', s.descidas.length],
    ['Captação (cabo)', `${fmt(s.comprimentoCaptacao, 1)} m`], ['Anel de aterramento', `${fmt(s.perimetroAnel, 1)} m`]];
  modal('SPDA: método das malhas', htmlTabela(head, rows) + htmlTabela(['Material', 'Un.', 'Qtd.'], materiaisSpda(s).map((m) => [m.desc, m.un, m.qtd]))
    + nota('Referência NBR 5419-3: malha e espaçamento de descidas por nível de proteção, anel de aterramento a 1 m da edificação. Não inclui a análise de risco (NBR 5419-2).'),
  [btnCsv(head, rows, 'spda.csv')]);
}

function todosMateriais() {
  const tag = (d, l) => l.map((m) => [d, m.desc, m.un, m.qtd]);
  return [
    ...tag('Elétrico', listaMateriais(store.project, store.ele)),
    ...tag('Hidrossanitário', materiaisHidraulica(store.project, store.hid)),
    ...tag('Estrutural', materiaisEstrutura(store.project, store.est)),
    ...tag('SPDA', materiaisSpda(store.spda)),
  ];
}
function relatorioMateriais() {
  const head = ['Disciplina', 'Descrição', 'Unidade', 'Quantidade'];
  const rows = todosMateriais();
  const xlsx = () => {
    const porDisc = [...new Set(rows.map((r) => r[0]))].map((d) => ({ nome: d, cabecalho: true, larguras: [62, 10, 12], linhas: [['Descrição', 'Unidade', 'Quantidade'], ...rows.filter((r) => r[0] === d).map((r) => [r[1], r[2], numero(r[3])])] }));
    exportarXlsx([{ nome: 'Todos', cabecalho: true, larguras: [16, 62, 10, 12], linhas: [head, ...rows.map((r) => [r[0], r[1], r[2], numero(r[3])])] }, ...porDisc], 'lista-de-materiais.xlsx');
  };
  modal('Lista de materiais', htmlTabela(head, rows) + nota('Quantidades estimadas a partir do modelo, com 10% de perdas em tubos e cabos de SPDA.'), [
    { label: 'Exportar XLSX', run: xlsx }, btnCsv(head, rows, 'lista-de-materiais.csv'),
    { label: 'Salvar PDF', run: () => salvarPdf('Lista de materiais', htmlTabela(head, rows), 'lista-de-materiais.pdf') }]);
}
function todasVerificacoes() {
  const out = [
    ...store.ele.avisos.map((v) => ({ ...v, d: 'Elétrico' })),
    ...store.hid.avisos.map((v) => ({ ...v, d: 'Hidrossanitário' })),
    ...store.est.avisos.map((v) => ({ ...v, d: 'Estrutural' })),
    ...store.spda.avisos.filter((v) => v.nivel !== 'ok').map((v) => ({ ...v, d: 'SPDA' })),
  ];
  return out.length ? out : [{ nivel: 'ok', texto: 'Nenhum problema encontrado.', d: 'Geral' }];
}
function relatorioVerificacoes() {
  const vs = todasVerificacoes();
  const label = { ok: 'OK', aviso: 'Aviso', erro: 'Erro' };
  modal('Verificações do projeto', `<ul class="checks">${vs.map((v) => `<li><span class="tag ${v.nivel}">${label[v.nivel]}</span><b style="min-width:110px">${esc(v.d)}</b>${esc(v.texto)}</li>`).join('')}</ul>`);
  for (const v of vs) log(`${v.d}: ${v.texto}`, v.nivel === 'ok' ? 'ok' : v.nivel === 'erro' ? 'err' : 'warn');
}
function exportarRelatorioCompleto() {
  const v = tabelaVigas(), p = tabelaPilares(), fd = tabelaFundacoes(), af = tabelaAguaFria(), eg = tabelaEsgoto();
  const css = 'body{font:13px Segoe UI,sans-serif;color:#1f2933;margin:32px}h1{font-size:20px}h2{font-size:15px;margin-top:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6dae0;padding:4px 8px;text-align:right}th{background:#f3f5f8}td.l{text-align:left}';
  const sec = (t, x) => (x.rows.length ? `<h2>${t}</h2>${htmlTabela(x.head, x.rows)}` : '');
  const doc = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(store.project.nome)}</title><style>${css}</style>
<h1>${esc(store.project.nome)}</h1><p>Responsável técnico: ${esc(store.project.autor || '-')} · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
${store.ele.quadros.filter((q) => q.quadro.tipo === 'qd').map((q) => sec(`Elétrico: quadro de cargas ${store.nomeQuadro(q.quadro)}`, tabelaCargasQuadro(q))).join('')}${sec('Estrutural: vigas', v)}${sec('Estrutural: pilares', p)}${sec('Estrutural: cargas na fundação', fd)}
${sec('Hidrossanitário: água fria', af)}${sec('Hidrossanitário: esgoto', eg)}
<h2>Lista de materiais</h2>${htmlTabela(['Disciplina', 'Descrição', 'Unidade', 'Quantidade'], todosMateriais())}
<h2>Verificações</h2><ul>${todasVerificacoes().map((x) => `<li><b>${esc(x.d)}:</b> ${esc(x.texto)}</li>`).join('')}</ul></html>`;
  host.exportFile(doc, 'relatorio-projeto.html', 'html', 'Página HTML').then((x) => x && log(`Exportado: ${x}`, 'ok'));
}

// ---------------------------------------------------------------- comandos de edição
function pedirTexto(titulo, rotulo, valor = '') {
  // o Electron não implementa window.prompt; usa o modal do app
  return new Promise((resolve) => {
    let ok = false;
    modal(titulo, `<label style="display:block;margin-bottom:6px">${esc(rotulo)}</label><input id="pt-in" style="width:100%;height:26px" value="${esc(valor)}">`, [
      { label: 'OK', primary: true, run: () => { ok = true; const v = $('#pt-in').value.trim(); closeModal(); resolve(v || null); } },
    ]);
    const inp = $('#pt-in');
    inp.focus(); inp.select();
    inp.onkeydown = (e) => { if (e.key === 'Enter') { ok = true; const v = inp.value.trim(); closeModal(); resolve(v || null); } };
    const obs = new MutationObserver(() => { if ($('#modal').hidden) { obs.disconnect(); if (!ok) resolve(null); } });
    obs.observe($('#modal'), { attributes: true, attributeFilter: ['hidden'] });
  });
}
store.pedirTexto = pedirTexto;

// rotaciona 90° (anti-horário na tela) ou espelha a seleção em torno do centro dela
function transformar(op) {
  const itens = store.selItens();
  if (!itens.length) return log('Selecione os elementos primeiro (arraste no vazio para selecionar por área).', 'warn');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const { ref: r } of itens) { if ('x' in r) ext(r.x, r.y); else { ext(r.x1, r.y1); ext(r.x2, r.y2); } }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const T = (x, y) => op === 'rot' ? [r3(cx + (y - cy)), r3(cy - (x - cx))] : op === 'espH' ? [r3(2 * cx - x), y] : [x, r3(2 * cy - y)];
  store.commit(op === 'rot' ? 'Rotacionar' : 'Espelhar', () => {
    for (const { kind, ref: r } of itens) {
      if ('x' in r) {
        [r.x, r.y] = T(r.x, r.y);
        if (op === 'rot' && r.tipo === 'pilar') [r.b, r.h] = [r.h, r.b];
      } else {
        [r.x1, r.y1] = T(r.x1, r.y1); [r.x2, r.y2] = T(r.x2, r.y2);
        if (kind === 'laje' || r.t === 'ret') {
          [r.x1, r.x2] = [Math.min(r.x1, r.x2), Math.max(r.x1, r.x2)];
          [r.y1, r.y2] = [Math.min(r.y1, r.y2), Math.max(r.y1, r.y2)];
        }
      }
    }
  });
  log(`${itens.length} elemento(s) ${op === 'rot' ? 'rotacionado(s) 90°' : 'espelhado(s)'}.`, 'ok');
}

function selecionarTudo(soFiltro) {
  const f = store.floor;
  const todos = [...f.elementos.map((ref) => ({ kind: 'elemento', ref })), ...f.paredes.map((ref) => ({ kind: 'parede', ref })),
    ...f.vigas.map((ref) => ({ kind: 'viga', ref })), ...f.lajes.map((ref) => ({ kind: 'laje', ref })), ...f.desenho.map((ref) => ({ kind: 'desenho', ref }))];
  store.selectMany(soFiltro ? todos.filter((it) => plan.passaFiltro(it)) : todos, false);
}

function toggle3d(k) {
  store.settings[k] = !store.settings[k];
  view3d.invalidate();
  renderRibbon();
}

// ---------------------------------------------------------------- atalhos e divisores
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z') { e.preventDefault(); store.doUndo(); }
  else if (e.ctrlKey && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); store.doRedo(); }
  else if (e.ctrlKey && (k === 's' || k === 'b')) { e.preventDefault(); salvar(e.shiftKey); }
  else if (e.key === 'F12') { e.preventDefault(); salvar(true); }
  else if (e.ctrlKey && k === 'o') { e.preventDefault(); abrir(); }
  else if (e.ctrlKey && k === 'n') { e.preventDefault(); novoProjeto(); }
  else if (e.ctrlKey && k === 'c') { e.preventDefault(); store.copy(); }
  else if (e.ctrlKey && k === 'v') { e.preventDefault(); store.paste(); }
  else if (e.ctrlKey && k === 'a') { e.preventDefault(); selecionarTudo(true); }
  else if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else { $('#menu').hidden = true; plan.cancel(); } }
  else if (e.key === 'Delete' && store.selection?.kind === 'eletroduto') acaoProps('soltaTrecho', store.selection);
  else if (e.key === 'Delete' && store.selItens().length) store.remove(store.selection);
  else if (e.key === 'F8') toggleSetting('orto');
  else if (e.key === 'F7') toggleSetting('grid');
  else if (e.key === 'F9') toggleSetting('snap');
});

document.querySelectorAll('.splitter').forEach((sp) => {
  sp.addEventListener('mousedown', (e) => {
    const ws = $('#workspace');
    const start = e.clientX;
    const w0 = $('#right').getBoundingClientRect().width;
    const move = (ev) => ws.style.setProperty('--rw', Math.max(200, Math.min(560, w0 - (ev.clientX - start))) + 'px');
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
});

const QUICK = [['novo', 'Novo (Ctrl+N)', () => novoProjeto()], ['abrir', 'Abrir (Ctrl+O)', () => abrir()], ['salvar', 'Salvar (Ctrl+S)', () => salvar()], null,
  ['importarCad', 'Importar DWG/DXF', () => importarCad()], ['exportarCad', 'Exportar DWG/DXF', () => exportarCad(false)], ['materiais', 'Lista de materiais', () => relatorioMateriais()], null,
  ['desfazer', 'Desfazer (Ctrl+Z)', () => store.doUndo()], ['refazer', 'Refazer (Ctrl+Y)', () => store.doRedo()], null, ['vista3d', 'Visão 3D', () => abrirDoc('3d')]];
$('#quick').innerHTML = QUICK.map((q, i) => (q ? `<button data-i="${i}" title="${q[1]}">${ICONS[q[0]]}</button>` : '<span class="qsep"></span>')).join('');
$('#quick').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) QUICK[Number(b.dataset.i)][2](); });

// ---------------------------------------------------------------- início
const plan = new Plan2D($('#plan'), store);
const view3d = new View3D($('#view3d'), store);
store.onRender = syncEscala;
store.distribuir = distribuir;
store.calc();
store.rede = 'ele';
abrirDoc('ele', store.floor.id);
docs.lista.push({ id: ++docSeq, tipo: '3d', pavId: null });
renderDocTabs();
renderRibbon();
renderStatus();
mostrarPainel('edificacao');
store.setTool('selecionar');
requestAnimationFrame(() => plan.zoomExtents());
log('Vértice pronto. Projeto exemplo com arquitetura, estrutura, elétrico, hidrossanitário e SPDA.', 'ok');
window.__vertice = store; // usado pelos testes automatizados
window.__vertice_api = { exportarDxf: () => exportarDxf(store.project, store, store.project.pavimentos), lerDxf, paraFundo, paredesDeLinhas, abrirDoc, docs, toScreen: (x, y) => plan.toScreen(x, y), projeto: () => JSON.stringify(store.project) };
