import { ICONS } from './icons.js';
import { Plan2D, corCircuito, fmt } from './plan2d.js';
import { View3D } from './view3d.js';
import { TIPOS, DISCIPLINAS } from './tipos.js';
import { calcularProjeto, verificacoes, listaMateriais, fmtSec, QUEDA_MAX } from './eletrico.js';
import { calcularHidraulica, materiaisHidraulica, TUBOS_AF } from './hidraulico.js';
import { calcularSpda, materiaisSpda, NIVEIS } from './spda.js';
import { calcularEstrutura, materiaisEstrutura, lancamentoAutomatico, cargaLaje } from './estrutural.js';
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
    if (t.disc === 'ele') Object.assign(e, { potencia: t.potencia, circuitoId: null });
    return Object.assign(e, extra);
  };
  const circuitos = [
    { id: 'C1', numero: 1, nome: 'C1 Iluminação', tipo: 'ILUM', tensao: 127 },
    { id: 'C2', numero: 2, nome: 'C2 TUG sala/quartos', tipo: 'TUG', tensao: 127 },
    { id: 'C3', numero: 3, nome: 'C3 TUG cozinha', tipo: 'TUG', tensao: 127 },
    { id: 'C4', numero: 4, nome: 'C4 Chuveiro', tipo: 'TUE', tensao: 220 },
  ];
  const terreo = {
    id: 'PV1', nome: 'Térreo', cota: 0, peDireito: 2.8, vigas: [], lajes: [],
    paredes: [
      W(0, 0, 12, 0), W(12, 0, 12, 9), W(12, 9, 0, 9), W(0, 9, 0, 0),
      W(6, 0, 6, 9), W(0, 5, 6, 5), W(6, 4, 12, 4), W(9, 4, 9, 9),
    ],
    elementos: [
      E('qd', 6.4, 0.4),
      ...[[3, 2.5], [3, 7], [9, 2], [7.5, 6.5], [10.5, 6.5]].map(([x, y]) => E('luz', x, y, { circuitoId: 'C1' })),
      ...[[5.6, 1.2], [5.6, 5.6], [6.4, 4.6]].map(([x, y]) => E('interruptor', x, y, { circuitoId: 'C1' })),
      ...[[0.4, 2.5], [3, 4.6], [0.4, 7], [3, 8.6]].map(([x, y]) => E('tug', x, y, { circuitoId: 'C2' })),
      ...[[11.6, 1.5], [11.6, 3], [8, 0.4]].map(([x, y]) => E('tug', x, y, { circuitoId: 'C3', potencia: 600 })),
      E('tue', 11.6, 7.8, { circuitoId: 'C4', potencia: 5500 }),
      // hidrossanitário: banheiro (9-12 × 4-9), cozinha e área de serviço (6-12 × 0-4)
      E('reservatorio', 10.5, 6.5, { altura: 4.6 }),
      E('chuveiro', 11.3, 8.3), E('bacia', 9.5, 8.4), E('lavatorio', 9.5, 5),
      E('pia', 10, 0.5), E('tanque', 11.5, 0.6), E('mlr', 11.5, 2.2),
      E('ci', 13.5, 10, { altura: -0.4 }),
    ],
  };
  const projeto = {
    versao: 2, nome: 'Residência exemplo', autor: '', pavimentos: [terreo], circuitos,
    spda: { ativo: true, nivel: 'III' }, estrutura: { sigmaSolo: 200 },
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
  p.circuitos ||= [];
  for (const pv of p.pavimentos) { pv.vigas ||= []; pv.lajes ||= []; pv.elementos ||= []; pv.paredes ||= []; }
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
  },
  results: [], hid: null, spda: null, est: null,
  undo: [], redo: [],
  clipboard: null,
  filePath: null,
  dirty: false,

  get floor() { return this.project.pavimentos[this.floorIdx]; },
  get activeCircuit() { return this.project.circuitos.find((c) => c.id === this.activeCircuitId) || null; },

  uid(p) { this.project.seq = (this.project.seq || 0) + 1; return p + this.project.seq; },

  calc() {
    this.results = calcularProjeto(this.project);
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
    return s.kind === 'multi' ? s.itens : ['elemento', 'parede', 'viga', 'laje'].includes(s.kind) ? [s] : [];
  },
  isSelected(ref) { return this.selItens().some((it) => it.ref === ref); },
  select(sel, silent) {
    this.selection = sel;
    if (sel?.kind === 'elemento' && sel.ref.circuitoId && !silent) this.activeCircuitId = sel.ref.circuitoId;
    plan.render(); renderProps(); renderTree(); syncCircuitSelect();
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
        const lista = { elemento: f.elementos, parede: f.paredes, viga: f.vigas, laje: f.lajes }[it.kind];
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
        r.id = this.uid(it.kind === 'elemento' ? 'E' : it.kind === 'parede' ? 'P' : it.kind === 'viga' ? 'V' : 'L');
        if ('x' in r) { r.x += dx; r.y += dy; } else { r.x1 += dx; r.y1 += dy; r.x2 += dx; r.y2 += dy; }
        ({ elemento: f.elementos, parede: f.paredes, viga: f.vigas, laje: f.lajes })[it.kind].push(r);
        novos.push({ kind: it.kind, ref: r });
      }
    });
    this.selectMany(novos, false);
    log(`Bloco colado: ${novos.length} elemento(s).`, 'ok');
  },
  setTool(t) {
    plan.setTool(t);
    document.querySelectorAll('.rb[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    const nome = TIPOS[t]?.nome || RIBBON_LABEL[t] || t;
    $('#st-tool').textContent = 'Comando: ' + nome;
    this.refreshHint();
  },
  refreshHint() { $('#hint').textContent = plan.hint(); },
  setCoord(x, y) { $('#st-coord').textContent = `X ${fmt(x)}  Y ${fmt(y)}`; },
  log: (t, k) => log(t, k),
};

// ---------------------------------------------------------------- mensagens
function log(texto, kind = '') {
  const d = document.createElement('div');
  const h = new Date().toLocaleTimeString('pt-BR');
  d.innerHTML = `<span class="t">${h}</span><span class="${kind}">${esc(texto)}</span>`;
  $('#log').appendChild(d);
  $('#log').scrollTop = 1e9;
}

function updateTitle() {
  const nome = store.filePath ? store.filePath.split(/[\\/]/).pop() : store.project.nome;
  const t = `${nome}${store.dirty ? ' *' : ''}`;
  $('#doc-title').textContent = t;
  host.setTitle(`${t} - Vértice`);
  $('#floor-label').textContent = `Pavimento: ${store.floor.nome}${store.floor.intermediario ? ' (nível intermediário)' : ''}  ·  cota ${fmt(store.floor.cota)} m`;
  const v = [...new Set(store.project.circuitos.map((c) => c.tensao))].join('/');
  $('#st-volt').textContent = `Tensões: ${v || '-'} V`;
}

// ---------------------------------------------------------------- ribbon
const tool = (id, label) => ({ id, label, tool: true });
const RIBBON = [
  { tab: 'Início', groups: [
    { label: 'Histórico', items: [
      { id: 'desfazer', label: 'Desfazer', run: () => store.doUndo() },
      { id: 'refazer', label: 'Refazer', run: () => store.doRedo() },
    ] },
    { label: 'Edição', items: [
      tool('selecionar', 'Selecionar'), tool('apagar', 'Apagar'),
      { id: 'copiar', label: 'Copiar bloco', run: () => store.copy() },
      { id: 'colar', label: 'Colar bloco', run: () => store.paste() },
    ] },
    { label: 'Exibição', items: [
      { id: 'zoom', label: 'Zoom extensão', run: () => plan.zoomExtents() },
      { id: 'vista2d', label: 'Planta 2D', run: () => setView('2d') },
      { id: 'vista3d', label: 'Vista 3D', run: () => setView('3d') },
    ] },
  ] },
  { tab: 'Arquitetura', groups: [
    { label: 'Elementos', items: [tool('parede', 'Parede')] },
    { label: 'Edificação', items: [
      { id: 'pavimento', label: 'Novo pavimento', run: () => novoPavimento() },
      { id: 'nivel', label: 'Nível intermediário', run: () => novoNivelIntermediario() },
    ] },
    { label: 'Referência DWG/DXF', items: [
      { id: 'importarCad', label: 'Importar DWG/DXF', run: () => importarCad() },
      { id: 'camadas', label: 'Camadas', run: () => dialogoCamadas() },
      { id: 'paredesRef', label: 'Paredes do desenho', run: () => dialogoParedes() },
      { id: 'removerRef', label: 'Remover referência', run: () => removerReferencia() },
    ] },
  ] },
  { tab: 'Estrutural', groups: [
    { label: 'Lançamento', items: [{ id: 'lancamento', label: 'Lançamento automático', run: () => lancarEstrutura() }] },
    { label: 'Elementos', items: [tool('pilar', 'Pilar'), tool('viga', 'Viga'), tool('laje', 'Laje')] },
    { label: 'Cálculo', items: [
      { id: 'calcEst', label: 'Vigas', run: () => relatorioVigas() },
      { id: 'pilar', label: 'Pilares', run: () => relatorioPilares() },
      { id: 'fundacao', label: 'Fundações', run: () => relatorioFundacoes() },
    ] },
  ] },
  { tab: 'Elétrico', groups: [
    { label: 'Quadros', items: [tool('qd', 'Quadro')] },
    { label: 'Pontos', items: [tool('luz', 'Ponto de luz'), tool('interruptor', 'Interruptor'), tool('tug', 'Tomada TUG'), tool('tue', 'Tomada TUE')] },
    { label: 'Circuitos', items: [
      { id: 'circuito', label: 'Novo circuito', run: () => novoCircuito() },
      tool('atribuir', 'Atribuir circuito'),
      { field: 'circuito-ativo' },
    ] },
    { label: 'Cálculo', items: [
      { id: 'dimensionar', label: 'Dimensionar', run: () => relatorioCargas() },
      { id: 'verificar', label: 'Verificar projeto', run: () => relatorioVerificacoes() },
    ] },
  ] },
  { tab: 'Hidrossanitário', groups: [
    { label: 'Origem e destino', items: [tool('reservatorio', 'Reservatório'), tool('ci', 'Caixa de inspeção')] },
    { label: 'Aparelhos', items: [tool('bacia', 'Bacia'), tool('lavatorio', 'Lavatório'), tool('chuveiro', 'Chuveiro'), tool('pia', 'Pia'), tool('tanque', 'Tanque'), tool('mlr', 'Máq. lavar')] },
    { label: 'Cálculo', items: [
      { id: 'hidro', label: 'Água fria', run: () => relatorioAguaFria() },
      { id: 'esgoto', label: 'Esgoto', run: () => relatorioEsgoto() },
    ] },
  ] },
  { tab: 'SPDA', groups: [
    { label: 'Proteção', items: [
      { id: 'spda', label: 'SPDA ativo', run: () => toggleSpda(), active: () => store.project.spda.ativo },
      { field: 'spda-nivel' },
    ] },
    { label: 'Cálculo', items: [{ id: 'malha', label: 'Relatório SPDA', run: () => relatorioSpda() }] },
  ] },
  { tab: 'Visualizar', groups: [
    { label: 'Janelas', items: [
      { id: 'vista2d', label: 'Planta 2D', run: () => setView('2d') },
      { id: 'vista3d', label: 'Vista 3D', run: () => setView('3d') },
      { id: 'zoom', label: 'Zoom extensão', run: () => plan.zoomExtents() },
    ] },
    { label: 'Auxílios', items: [
      { id: 'grade', label: 'Grade', run: () => toggleSetting('grid'), active: () => store.settings.grid },
      { id: 'orto', label: 'Ortogonal', run: () => toggleSetting('orto'), active: () => store.settings.orto },
    ] },
    { label: 'Disciplinas visíveis', items: Object.entries({ arq: 'parede', est: 'pilar', ele: 'raio', hid: 'hidro', spda: 'spda', fundo: 'camadas' }).map(([d, ic]) => ({
      id: ic, label: DISCIPLINAS[d].replace('Referência DWG/DXF', 'Referência'), run: () => toggleVis(d), active: () => store.settings.vis[d],
    })) },
    { label: 'Linhas de chamada', items: [{ field: 'chamadas' }] },
  ] },
  { tab: 'Relatórios', groups: [
    { label: 'Geral', items: [
      { id: 'materiais', label: 'Lista de materiais', run: () => relatorioMateriais() },
      { id: 'verificar', label: 'Verificações', run: () => relatorioVerificacoes() },
    ] },
    { label: 'Disciplinas', items: [
      { id: 'cargas', label: 'Quadro de cargas', run: () => relatorioCargas() },
      { id: 'calcEst', label: 'Vigas', run: () => relatorioVigas() },
      { id: 'pilar', label: 'Pilares', run: () => relatorioPilares() },
      { id: 'hidro', label: 'Água fria', run: () => relatorioAguaFria() },
      { id: 'esgoto', label: 'Esgoto', run: () => relatorioEsgoto() },
      { id: 'malha', label: 'SPDA', run: () => relatorioSpda() },
    ] },
  ] },
];
const ARQUIVO = [
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
  { label: 'Relatórios', items: [{ id: 'exportar', label: 'Relatório HTML', run: () => exportarRelatorioCompleto() }] },
];
const RIBBON_LABEL = Object.fromEntries(RIBBON.flatMap((t) => t.groups.flatMap((g) => g.items.filter((i) => i.tool).map((i) => [i.id, i.label]))));
let currentTab = 'Elétrico';

function renderRibbon() {
  const tabs = $('#ribbon-tabs');
  tabs.innerHTML = '';
  const fileBtn = document.createElement('button');
  fileBtn.textContent = 'Arquivo';
  fileBtn.className = 'file' + (currentTab === 'Arquivo' ? ' active' : '');
  fileBtn.onclick = () => { currentTab = 'Arquivo'; renderRibbon(); };
  tabs.appendChild(fileBtn);
  for (const t of RIBBON) {
    const b = document.createElement('button');
    b.textContent = t.tab;
    if (t.tab === currentTab) b.className = 'active';
    b.onclick = () => { currentTab = t.tab; renderRibbon(); };
    tabs.appendChild(b);
  }
  const groups = currentTab === 'Arquivo' ? ARQUIVO : RIBBON.find((t) => t.tab === currentTab).groups;
  const foco = { Estrutural: 'est', 'Elétrico': 'ele', 'Hidrossanitário': 'hid', SPDA: 'spda' }[currentTab] || null;
  if (store.settings.foco !== foco) { store.settings.foco = foco; plan.render(); }
  const rb = $('#ribbon');
  rb.innerHTML = '';
  for (const g of groups) {
    const ge = document.createElement('div');
    ge.className = 'group';
    const items = document.createElement('div');
    items.className = 'group-items';
    for (const it of g.items) {
      if (it.field) { items.appendChild(campoRibbon(it.field)); continue; }
      const b = document.createElement('button');
      b.className = 'rb';
      b.innerHTML = ICONS[it.id] + `<span>${esc(it.label)}</span>`;
      b.title = it.label;
      if (it.tool) { b.dataset.tool = it.id; if (plan.tool === it.id) b.classList.add('active'); b.onclick = () => store.setTool(it.id); }
      else b.onclick = it.run;
      if (it.active?.()) b.classList.add('active');
      items.appendChild(b);
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

function campoRibbon(tipo) {
  const f = document.createElement('div');
  f.className = 'rb-field';
  if (tipo === 'circuito-ativo') {
    f.innerHTML = '<label>Circuito ativo</label><select id="sel-circuito"></select><label>Tipo / tensão</label><span id="circ-info" style="color:var(--text)"></span>';
  } else if (tipo === 'spda-nivel') {
    f.innerHTML = `<label>Nível de proteção</label><select id="sel-nivel">${Object.keys(NIVEIS).map((n) => `<option${store.project.spda.nivel === n ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label>Malha / descidas</label><span>${NIVEIS[store.project.spda.nivel].malha} m / ${NIVEIS[store.project.spda.nivel].descidas} m</span>`;
    f.querySelector('select').onchange = (e) => { store.commit('Nível SPDA', () => { store.project.spda.nivel = e.target.value; }); renderRibbon(); };
  } else if (tipo === 'chamadas') {
    const op = (d) => `<select data-d="${d}">${[['simples', 'Simples'], ['circulo', 'Círculo'], ['retangulo', 'Retângulo']].map(([v, l]) => `<option value="${v}"${store.settings.chamada[d] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    f.style.minWidth = '260px';
    f.innerHTML = `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center">
      <label>Elétrico</label>${op('ele')}<label>Hidrossanitário</label>${op('hid')}<label>Estrutural</label>${op('est')}</div>`;
    f.querySelectorAll('select').forEach((s) => (s.onchange = () => { store.settings.chamada[s.dataset.d] = s.value; plan.render(); }));
  }
  return f;
}

function syncCircuitSelect() {
  const sel = $('#sel-circuito');
  if (!sel) return;
  sel.innerHTML = store.project.circuitos.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  sel.value = store.activeCircuitId || '';
  sel.onchange = () => { store.activeCircuitId = sel.value; syncCircuitSelect(); plan.render(); renderTree(); store.refreshHint(); };
  const c = store.activeCircuit;
  $('#circ-info').innerHTML = c ? `<span class="swatch" style="display:inline-block;background:${corCircuito(store.project, c.id)}"></span> ${c.tipo} · ${c.tensao} V` : '-';
}

// ---------------------------------------------------------------- árvore
const collapsed = new Set(['edif-ele', 'edif-hid']);
function renderTree() {
  const p = store.project;
  const node = (key, icon, label, opts = {}) => {
    const kids = opts.children;
    const open = kids && !collapsed.has(key);
    return `<li><div class="node${opts.sel ? ' sel' : ''}" data-key="${esc(key)}"${opts.act ? ` data-act="${esc(opts.act)}"` : ''}>
      <span class="tw">${kids ? (open ? '▼' : '▶') : ''}</span>${icon}<span>${esc(label)}</span>${opts.badge != null ? `<span class="badge">${esc(opts.badge)}</span>` : ''}</div>
      ${kids && open ? `<ul>${kids}</ul>` : ''}</li>`;
  };
  const sw = (cor) => `<span class="swatch" style="background:${cor}"></span>`;
  const pavs = p.pavimentos.map((pv, i) => {
    const qtd = (t) => pv.elementos.filter((e) => e.tipo === t).length;
    const grupo = (k, ic, nome, tipos) => node(`pv${i}-${k}`, ICONS[ic], nome, {
      badge: tipos.reduce((s, t) => s + qtd(t), 0), act: `floor:${i}`,
      children: tipos.filter((t) => qtd(t)).map((t) => node(`pv${i}-${t}`, ICONS[t] || ICONS.camada, TIPOS[t].nome, { badge: qtd(t), act: `floor:${i}` })).join('') || undefined,
    });
    const kids = [
      node(`pv${i}-par`, ICONS.parede, 'Paredes', { badge: pv.paredes.length, act: `floor:${i}` }),
      node(`pv${i}-est`, ICONS.pilar, 'Estrutura', { act: `floor:${i}`, children: [
        node(`pv${i}-pil`, ICONS.pilar, 'Pilares', { badge: qtd('pilar'), act: `floor:${i}` }),
        node(`pv${i}-vig`, ICONS.viga, 'Vigas', { badge: pv.vigas.length, act: `floor:${i}` }),
        node(`pv${i}-laj`, ICONS.laje, 'Lajes', { badge: pv.lajes.length, act: `floor:${i}` }),
      ].join('') }),
      grupo('ele', 'raio', 'Elétrico', ['qd', 'luz', 'interruptor', 'tug', 'tue']),
      grupo('hid', 'hidro', 'Hidrossanitário', ['reservatorio', 'ci', 'bacia', 'lavatorio', 'chuveiro', 'pia', 'tanque', 'mlr']),
      pv.fundo ? node(`pv${i}-ref`, ICONS.camadas, `Ref.: ${pv.fundo.arquivo}`, { badge: pv.fundo.camadas.filter((c) => c.vis).length + '/' + pv.fundo.camadas.length, act: 'camadas' }) : '',
    ].join('');
    return node(`pv${i}`, pv.intermediario ? ICONS.nivel : ICONS.camada, `${pv.nome} (${fmt(pv.cota)} m)`, { children: kids, sel: i === store.floorIdx, act: `floor:${i}` });
  }).join('');
  const circs = store.results.map((r) => node(`c-${r.circuito.id}`, sw(corCircuito(p, r.circuito.id)), r.circuito.nome, {
    badge: `${Math.round(r.potencia)} VA`, sel: r.circuito.id === store.activeCircuitId, act: `circ:${r.circuito.id}`,
  })).join('');
  const hid = store.hid;
  const redes = [
    node('af', sw('#1593a6'), 'Água fria', { badge: `${hid.af.segmentos.length} trechos`, act: 'rel:af' }),
    node('esg', sw('#8a5a2b'), 'Esgoto', { badge: `${hid.esg.segmentos.length} trechos`, act: 'rel:esg' }),
  ].join('');
  const sp = store.spda;
  $('#tree').innerHTML = `<div class="tree"><ul>${node('root', ICONS.predio, p.nome, {
    children: node('edif', ICONS.pasta, 'Edificação', { children: pavs })
      + node('circ', ICONS.raio, 'Circuitos', { children: circs || '<li class="empty">Nenhum circuito.</li>', badge: p.circuitos.length })
      + node('redes', ICONS.hidro, 'Redes hidráulicas', { children: redes })
      + node('spda', ICONS.spda, 'SPDA', { badge: sp.ativo ? `nível ${p.spda.nivel}` : 'desativado', act: 'rel:spda' }),
  })}</ul></div>`;
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
  if (act.startsWith('floor:')) setFloor(Number(act.slice(6)));
  else if (act.startsWith('circ:')) {
    store.activeCircuitId = act.slice(5);
    store.selection = { kind: 'circuito', ref: store.activeCircuit };
    syncCircuitSelect(); plan.render(); renderTree(); renderProps(); store.refreshHint();
  } else if (act === 'rel:af') relatorioAguaFria();
  else if (act === 'rel:esg') relatorioEsgoto();
  else if (act === 'rel:spda') relatorioSpda();
  else if (act === 'camadas') dialogoCamadas();
  else if (key === 'root') { store.selection = { kind: 'projeto' }; renderProps(); }
});

function setFloor(i) {
  store.floorIdx = i;
  store.selection = { kind: 'pavimento', ref: store.floor };
  plan.start = null;
  renderTree(); renderProps(); updateTitle(); plan.render(); view3d.invalidate();
}

// ---------------------------------------------------------------- propriedades
function renderProps() {
  const sel = store.selection;
  const box = $('#props');
  const row = (label, html) => `<tr><td>${esc(label)}</td><td>${html}</td></tr>`;
  const ro = (v) => `<span class="ro">${esc(v)}</span>`;
  const inp = (k, v, type = 'number', step = '0.01') => `<input data-k="${k}" type="${type}" ${type === 'number' ? `step="${step}"` : ''} value="${esc(v)}">`;
  const opts = (k, v, list) => `<select data-k="${k}">${list.map(([val, lab]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  const th = (t) => `<tr><th colspan="2">${esc(t)}</th></tr>`;
  const avisos = (lista) => (lista?.length ? `<tr><td colspan="2" style="color:var(--danger)">${lista.map(esc).join('<br>')}</td></tr>` : '');
  let html = '';

  if (!sel) {
    html = `<div class="empty">Nada selecionado.<br>Use <b>Selecionar</b> e clique num elemento, ou arraste no vazio para <b>selecionar por área</b> (da direita para a esquerda pega o que toca). No 3D: Shift + arrastar.</div>`;
  } else if (sel.kind === 'multi') {
    const cont = {};
    for (const it of sel.itens) {
      const nome = it.kind === 'elemento' ? TIPOS[it.ref.tipo].nome : { parede: 'Parede', viga: 'Viga', laje: 'Laje' }[it.kind];
      cont[nome] = (cont[nome] || 0) + 1;
    }
    html = `<table class="props">${th(`Seleção (${sel.itens.length})`)}${Object.entries(cont).map(([k, v]) => row(k, ro(v))).join('')}</table>
      <div style="padding:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn" id="m-copiar">Copiar bloco</button><button class="btn" id="m-apagar">Apagar</button></div>`;
  } else if (sel.kind === 'elemento') {
    const e = sel.ref;
    const t = TIPOS[e.tipo];
    html = `<table class="props">${th(t.nome)}${row('Identificador', ro(e.id))}${row('Descrição', inp('descricao', e.descricao, 'text'))}
      ${row('X (m)', inp('x', e.x))}${row('Y (m)', inp('y', e.y))}`;
    if (e.tipo === 'pilar') {
      const r = store.est.pilares.find((x) => x.pilar === e);
      html += `${row('Largura b (cm)', inp('b', e.b, 'number', '1'))}${row('Altura h (cm)', inp('h', e.h, 'number', '1'))}
        ${th('Pré-dimensionamento')}${r ? `${row('Carga do pavimento', ro(`${fmt(r.local, 1)} kN`))}${row('Carga de cima', ro(`${fmt(r.deCima, 1)} kN`))}
        ${row('Peso próprio', ro(`${fmt(r.pp, 1)} kN`))}${row('N total (caract.)', ro(`${fmt(r.N, 1)} kN`))}${row('Nd (com excentric.)', ro(`${fmt(r.Nd, 1)} kN`))}
        ${row('As adotada', ro(r.barras ? `${r.barras.n} φ ${fmtSec(r.barras.phi)} mm (${fmt(r.barras.As)} cm²)` : '—'))}${row('Taxa', ro(`${fmt(r.taxa * 100)} %`))}${avisos(r.avisos)}` : ''}`;
    } else {
      html += row('Altura de instalação (m)', inp('altura', e.altura));
      if (t.disc === 'ele') {
        const circs = [['', '(sem circuito)'], ...store.project.circuitos.map((c) => [c.id, c.nome])];
        if (e.tipo !== 'qd' && e.tipo !== 'interruptor') html += row(e.tipo === 'tue' ? 'Potência (W)' : 'Potência (VA)', inp('potencia', e.potencia, 'number', '10'));
        if (e.tipo !== 'qd') html += row('Circuito', opts('circuitoId', e.circuitoId || '', circs));
      } else if (t.disc === 'hid') {
        if (t.peso != null) html += `${row('Peso (água fria)', ro(fmt(t.peso, 1)))}${row('UHC (esgoto)', ro(t.uhc))}${row('DN mínimo esgoto', ro(`${t.dnEsg} mm`))}`;
        const pt = store.hid.af.pontos.find((x) => x.no.el === e);
        if (pt) html += `${th('Água fria')}${row('Pressão dinâmica', `<span class="ro" style="color:${pt.pressao < 1 ? 'var(--danger)' : 'var(--ok)'}">${fmt(pt.pressao, 2)} mca</span>`)}`;
        if (e.tipo === 'reservatorio') html += `<tr><td colspan="2" style="color:var(--muted)">A altura é a cota do fundo do reservatório em relação ao piso do pavimento.</td></tr>`;
      }
    }
    html += '</table>';
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
      ${row('Paredes', ro(pv.paredes.length))}${row('Elementos', ro(pv.elementos.length))}${row('Vigas / lajes', ro(`${pv.vigas.length} / ${pv.lajes.length}`))}
      ${pv.fundo ? row('Referência', ro(pv.fundo.arquivo)) : ''}</table>
      ${store.project.pavimentos.length > 1 ? '<div style="padding:8px"><button class="btn" id="del-pav">Excluir pavimento</button></div>' : ''}`;
  } else if (sel.kind === 'circuito' && sel.ref) {
    const c = sel.ref;
    const r = store.results.find((x) => x.circuito.id === c.id);
    html = `<table class="props">${th('Circuito')}${row('Nome', inp('nome', c.nome, 'text'))}
      ${row('Tipo', opts('tipo', c.tipo, [['ILUM', 'Iluminação'], ['TUG', 'Tomadas de uso geral'], ['TUE', 'Tomada de uso específico']]))}
      ${row('Tensão (V)', opts('tensao', c.tensao, [[127, '127'], [220, '220']]))}
      ${r ? `${th('Dimensionamento')}${row('Pontos', ro(r.pontos.length))}${row('Potência', ro(`${Math.round(r.potencia)} VA`))}
      ${row('Corrente de projeto', ro(`${fmt(r.ib)} A`))}${row('Comprimento', ro(`${fmt(r.comprimento, 1)} m`))}
      ${row('Seção do cabo', ro(r.ok ? `${fmtSec(r.secao)} mm²` : '—'))}${row('Disjuntor', ro(r.ok ? `${r.disjuntor} A` : '—'))}
      ${row('Queda de tensão', ro(r.ok ? `${fmt(r.queda)} %` : '—'))}` : ''}</table>
    <div style="padding:8px"><button class="btn" id="del-circ">Excluir circuito</button></div>`;
  } else if (sel.kind === 'projeto') {
    html = `<table class="props">${th('Projeto')}${row('Nome', inp('nome', store.project.nome, 'text'))}${row('Responsável técnico', inp('autor', store.project.autor || '', 'text'))}
      ${row('Pavimentos', ro(store.project.pavimentos.length))}${row('Circuitos', ro(store.project.circuitos.length))}
      ${th('Estrutura')}<tr><td>Tensão admissível do solo (kPa)</td><td><input data-k="sigmaSolo" data-obj="estrutura" type="number" step="10" value="${store.project.estrutura.sigmaSolo}"></td></tr></table>`;
  }
  box.innerHTML = html;
  const target = sel?.kind === 'projeto' ? store.project : sel?.ref;
  box.querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('change', () => {
      const k = el.dataset.k;
      let v = el.value;
      if (el.type === 'number' || k === 'tensao') v = Number(v);
      if (k === 'circuitoId') v = v || null;
      const obj = el.dataset.obj ? store.project[el.dataset.obj] : target;
      store.commit('Propriedade', () => { obj[k] = v; });
      if (sel.kind === 'pavimento' && k === 'cota') {
        normalizar(store.project);
        store.floorIdx = store.project.pavimentos.indexOf(sel.ref);
        renderTree();
      }
      syncCircuitSelect(); updateTitle();
    });
  });
  $('#m-copiar')?.addEventListener('click', () => store.copy());
  $('#m-apagar')?.addEventListener('click', () => store.remove(sel));
  $('#del-pav')?.addEventListener('click', () => {
    if (!confirm(`Excluir "${sel.ref.nome}" e tudo o que há nele?`)) return;
    store.commit('Excluir pavimento', () => store.project.pavimentos.splice(store.project.pavimentos.indexOf(sel.ref), 1));
    setFloor(Math.min(store.floorIdx, store.project.pavimentos.length - 1));
  });
  $('#del-circ')?.addEventListener('click', () => {
    const c = sel.ref;
    store.commit('Excluir circuito', () => {
      store.project.circuitos.splice(store.project.circuitos.indexOf(c), 1);
      for (const pv of store.project.pavimentos) for (const e of pv.elementos) if (e.circuitoId === c.id) e.circuitoId = null;
    });
    store.activeCircuitId = store.project.circuitos[0]?.id || null;
    store.select(null);
    log(`${c.nome} excluído.`);
  });
}

// ---------------------------------------------------------------- comandos
function novoCircuito() {
  const nums = store.project.circuitos.map((c) => c.numero);
  const numero = (nums.length ? Math.max(...nums) : 0) + 1;
  const tipo = store.activeCircuit?.tipo || 'TUG';
  const c = { id: store.uid('C'), numero, nome: `C${numero} ${tipo === 'ILUM' ? 'Iluminação' : tipo}`, tipo, tensao: tipo === 'TUE' ? 220 : 127 };
  store.commit('Novo circuito', () => store.project.circuitos.push(c));
  store.activeCircuitId = c.id;
  store.selection = { kind: 'circuito', ref: c };
  syncCircuitSelect(); renderTree(); renderProps(); store.refreshHint();
  log(`${c.nome} criado. Ajuste tipo e tensão em Propriedades e use "Atribuir circuito".`, 'ok');
}

function novoPavimento() {
  const pavs = store.project.pavimentos.filter((p) => !p.intermediario);
  const ult = pavs[pavs.length - 1];
  const n = pavs.length;
  store.commit('Novo pavimento', () => {
    store.project.pavimentos.push({
      id: store.uid('PV'), nome: n === 1 ? 'Superior' : `Pavimento ${n + 1}`,
      cota: Math.round((ult.cota + ult.peDireito + 0.12) * 100) / 100, peDireito: ult.peDireito,
      paredes: ult.paredes.map((w) => ({ ...w, id: store.uid('P') })), elementos: [], vigas: [], lajes: [],
    });
    normalizar(store.project);
  });
  setFloor(store.project.pavimentos.length - 1);
  log(`Pavimento "${store.floor.nome}" criado com as paredes do pavimento abaixo.`, 'ok');
}

function novoNivelIntermediario() {
  const base = store.floor;
  const nome = prompt('Nome do nível intermediário:', `Mezanino ${base.nome}`);
  if (!nome) return;
  let novo;
  store.commit('Nível intermediário', () => {
    novo = { id: store.uid('PV'), nome, intermediario: true, cota: Math.round((base.cota + base.peDireito / 2) * 100) / 100,
      peDireito: Math.round((base.peDireito / 2) * 100) / 100, paredes: [], elementos: [], vigas: [], lajes: [] };
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
  $('#st-grid').classList.toggle('on', store.settings.grid);
  $('#st-snap').classList.toggle('on', store.settings.snap);
  $('#st-orto').classList.toggle('on', store.settings.orto);
  renderRibbon();
  plan.render();
}
function toggleVis(d) {
  store.settings.vis[d] = !store.settings.vis[d];
  renderRibbon(); plan.render(); view3d.invalidate();
}
$('#st-grid').onclick = () => toggleSetting('grid');
$('#st-snap').onclick = () => toggleSetting('snap');
$('#st-orto').onclick = () => toggleSetting('orto');

function setView(v) {
  document.querySelectorAll('#view-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#plan').hidden = v !== '2d';
  $('#view3d').hidden = v !== '3d';
  $('#hint').hidden = v !== '2d';
  if (v === '3d') view3d.show(); else { view3d.hide(); plan.resize(); }
}
document.querySelectorAll('#view-tabs button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));

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
  store.setTool('parede');
  currentTab = 'Arquitetura'; renderRibbon();
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

function tabelaCargas() {
  const rs = store.results;
  const head = ['Circuito', 'Tipo', 'Tensão (V)', 'Pontos', 'Potência (VA)', 'Ib (A)', 'Compr. (m)', 'Seção (mm²)', 'Iz (A)', 'Disjuntor (A)', 'ΔV (%)', 'Situação'];
  const rows = rs.map((r) => [
    r.circuito.nome, r.circuito.tipo, r.circuito.tensao, r.pontos.length, Math.round(r.potencia), fmt(r.ib), fmt(r.comprimento, 1),
    r.ok ? fmtSec(r.secao) : '—', r.ok ? fmt(r.iz, 1) : '—', r.ok ? r.disjuntor : '—', r.ok ? fmt(r.queda) : '—', sit(r.ok, r.avisos),
  ]);
  return { head, rows, total: rs.reduce((s, r) => s + r.potencia, 0) };
}
function relatorioCargas() {
  const { head, rows, total } = tabelaCargas();
  modal('Quadro de cargas', htmlTabela(head, rows, ['Total', '', '', '', Math.round(total), '', '', '', '', '', '', ''])
    + nota(`Método B1 (eletroduto embutido), cobre/PVC, 2 condutores carregados. Seção mínima 1,5 mm² (iluminação) e 2,5 mm² (força). Queda de tensão máxima ${QUEDA_MAX}%.`),
  [btnCsv(head, rows, 'quadro-de-cargas.csv')]);
  log(`Dimensionamento elétrico: ${rows.length} circuito(s), ${Math.round(total)} VA.`, 'ok');
}

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
    ...tag('Elétrico', listaMateriais(store.project, store.results)),
    ...tag('Hidrossanitário', materiaisHidraulica(store.project, store.hid)),
    ...tag('Estrutural', materiaisEstrutura(store.project, store.est)),
    ...tag('SPDA', materiaisSpda(store.spda)),
  ];
}
function relatorioMateriais() {
  const head = ['Disciplina', 'Descrição', 'Unidade', 'Quantidade'];
  const rows = todosMateriais();
  modal('Lista de materiais', htmlTabela(head, rows) + nota('Quantidades estimadas a partir do modelo, com 10% de perdas em tubos e cabos de SPDA.'), [btnCsv(head, rows, 'lista-de-materiais.csv')]);
}
function todasVerificacoes() {
  const out = [
    ...verificacoes(store.project, store.results).filter((v) => v.nivel !== 'ok').map((v) => ({ ...v, d: 'Elétrico' })),
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
  const c = tabelaCargas(), v = tabelaVigas(), p = tabelaPilares(), fd = tabelaFundacoes(), af = tabelaAguaFria(), eg = tabelaEsgoto();
  const css = 'body{font:13px Segoe UI,sans-serif;color:#1f2933;margin:32px}h1{font-size:20px}h2{font-size:15px;margin-top:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6dae0;padding:4px 8px;text-align:right}th{background:#f3f5f8}td.l{text-align:left}';
  const sec = (t, x) => (x.rows.length ? `<h2>${t}</h2>${htmlTabela(x.head, x.rows)}` : '');
  const doc = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(store.project.nome)}</title><style>${css}</style>
<h1>${esc(store.project.nome)}</h1><p>Responsável técnico: ${esc(store.project.autor || '-')} · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
${sec('Elétrico: quadro de cargas', c)}${sec('Estrutural: vigas', v)}${sec('Estrutural: pilares', p)}${sec('Estrutural: cargas na fundação', fd)}
${sec('Hidrossanitário: água fria', af)}${sec('Hidrossanitário: esgoto', eg)}
<h2>Lista de materiais</h2>${htmlTabela(['Disciplina', 'Descrição', 'Unidade', 'Quantidade'], todosMateriais())}
<h2>Verificações</h2><ul>${todasVerificacoes().map((x) => `<li><b>${esc(x.d)}:</b> ${esc(x.texto)}</li>`).join('')}</ul></html>`;
  host.exportFile(doc, 'relatorio-projeto.html', 'html', 'Página HTML').then((x) => x && log(`Exportado: ${x}`, 'ok'));
}

// ---------------------------------------------------------------- atalhos e divisores
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z') { e.preventDefault(); store.doUndo(); }
  else if (e.ctrlKey && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); store.doRedo(); }
  else if (e.ctrlKey && k === 's') { e.preventDefault(); salvar(e.shiftKey); }
  else if (e.ctrlKey && k === 'o') { e.preventDefault(); abrir(); }
  else if (e.ctrlKey && k === 'n') { e.preventDefault(); novoProjeto(); }
  else if (e.ctrlKey && k === 'c') { e.preventDefault(); store.copy(); }
  else if (e.ctrlKey && k === 'v') { e.preventDefault(); store.paste(); }
  else if (e.ctrlKey && k === 'a') {
    e.preventDefault();
    const f = store.floor;
    store.selectMany([...f.elementos.map((ref) => ({ kind: 'elemento', ref })), ...f.paredes.map((ref) => ({ kind: 'parede', ref })),
      ...f.vigas.map((ref) => ({ kind: 'viga', ref })), ...f.lajes.map((ref) => ({ kind: 'laje', ref }))], false);
  }
  else if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else plan.cancel(); }
  else if (e.key === 'Delete' && store.selItens().length) store.remove(store.selection);
  else if (e.key === 'F8') toggleSetting('orto');
  else if (e.key === 'F7') toggleSetting('grid');
  else if (e.key === 'F9') toggleSetting('snap');
});

document.querySelectorAll('.splitter').forEach((sp) => {
  sp.addEventListener('mousedown', (e) => {
    const left = sp.dataset.target === 'left';
    const ws = $('#workspace');
    const start = e.clientX;
    const w0 = $(left ? '#left' : '#right').getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(160, Math.min(520, w0 + (left ? 1 : -1) * (ev.clientX - start)));
      ws.style.setProperty(left ? '--lw' : '--rw', w + 'px');
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
});
$('#clear-log').onclick = () => ($('#log').innerHTML = '');

$('#quick').innerHTML = [['novo', 'Novo'], ['abrir', 'Abrir'], ['salvar', 'Salvar'], ['importarCad', 'Importar DWG/DXF'], ['exportarCad', 'Exportar DWG/DXF'], ['desfazer', 'Desfazer'], ['refazer', 'Refazer']]
  .map(([k, t]) => `<button data-q="${k}" title="${t}">${ICONS[k]}</button>`).join('');
$('#quick').addEventListener('click', (e) => {
  const q = e.target.closest('button')?.dataset.q;
  ({ novo: novoProjeto, abrir, salvar: () => salvar(), importarCad, exportarCad: () => exportarCad(false), desfazer: () => store.doUndo(), refazer: () => store.doRedo() })[q]?.();
});

// ---------------------------------------------------------------- início
const plan = new Plan2D($('#plan'), store);
const view3d = new View3D($('#view3d'), store);
store.calc();
renderRibbon();
renderTree();
renderProps();
updateTitle();
store.setTool('selecionar');
requestAnimationFrame(() => plan.zoomExtents());
log('Vértice pronto. Projeto exemplo com arquitetura, estrutura, elétrico, hidrossanitário e SPDA.', 'ok');
log('Dica: Arquivo > Importar DWG/DXF traz a arquitetura como referência; Arquivo > Exportar gera DWG.');
window.__vertice = store; // usado pelos testes automatizados
window.__vertice_api = { exportarDxf: () => exportarDxf(store.project, store, store.project.pavimentos), lerDxf, paraFundo, paredesDeLinhas };
