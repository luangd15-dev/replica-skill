import { ICONS } from './icons.js';
import { Plan2D, corCircuito, fmt } from './plan2d.js';
import { View3D } from './view3d.js';
import { TIPOS, calcularProjeto, verificacoes, listaMateriais, fmtSec, QUEDA_MAX } from './eletrico.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const host = window.host || {
  // permite abrir o index.html direto no navegador durante o desenvolvimento
  openProject: async () => null, saveProject: async () => null, exportFile: async () => null, setTitle: (t) => (document.title = t),
};

// ---------------------------------------------------------------- projeto exemplo
function projetoExemplo() {
  let n = 0;
  const id = (p) => p + ++n;
  const W = (x1, y1, x2, y2, esp = 0.15) => ({ id: id('P'), x1, y1, x2, y2, esp });
  const E = (tipo, x, y, circuitoId, potencia) => ({ id: id('E'), tipo, x, y, circuitoId, potencia: potencia ?? TIPOS[tipo].potencia, altura: TIPOS[tipo].altura, descricao: '' });
  const circuitos = [
    { id: 'C1', numero: 1, nome: 'C1 Iluminação', tipo: 'ILUM', tensao: 127 },
    { id: 'C2', numero: 2, nome: 'C2 TUG sala/quartos', tipo: 'TUG', tensao: 127 },
    { id: 'C3', numero: 3, nome: 'C3 TUG cozinha', tipo: 'TUG', tensao: 127 },
    { id: 'C4', numero: 4, nome: 'C4 Chuveiro', tipo: 'TUE', tensao: 220 },
  ];
  const terreo = {
    id: 'PV1', nome: 'Térreo', cota: 0, peDireito: 2.8,
    paredes: [
      W(0, 0, 12, 0), W(12, 0, 12, 9), W(12, 9, 0, 9), W(0, 9, 0, 0),
      W(6, 0, 6, 9), W(0, 5, 6, 5), W(6, 4, 12, 4), W(9, 4, 9, 9),
    ],
    elementos: [
      E('qd', 6.4, 0.4, null),
      E('luz', 3, 2.5, 'C1'), E('luz', 3, 7, 'C1'), E('luz', 9, 2, 'C1'), E('luz', 7.5, 6.5, 'C1'), E('luz', 10.5, 6.5, 'C1'),
      E('interruptor', 5.6, 1.2, 'C1'), E('interruptor', 5.6, 5.6, 'C1'), E('interruptor', 6.4, 4.6, 'C1'),
      E('tug', 0.4, 2.5, 'C2'), E('tug', 3, 4.6, 'C2'), E('tug', 0.4, 7, 'C2'), E('tug', 3, 8.6, 'C2'),
      E('tug', 11.6, 1.5, 'C3', 600), E('tug', 11.6, 3, 'C3', 600), E('tug', 8, 0.4, 'C3', 600),
      E('tue', 11.6, 7.8, 'C4', 5500),
    ],
  };
  return { versao: 1, nome: 'Residência exemplo', autor: '', pavimentos: [terreo], circuitos, seq: n };
}

// ---------------------------------------------------------------- estado
const store = {
  project: projetoExemplo(),
  floorIdx: 0,
  selection: null,
  activeCircuitId: 'C1',
  settings: { grid: true, snap: true, orto: true },
  results: [],
  undo: [],
  redo: [],
  filePath: null,
  dirty: false,
  pending: null,

  get floor() { return this.project.pavimentos[this.floorIdx]; },
  get activeCircuit() { return this.project.circuitos.find((c) => c.id === this.activeCircuitId) || null; },

  uid(p) { this.project.seq = (this.project.seq || 0) + 1; return p + this.project.seq; },

  snapshot() {
    this.undo.push(JSON.stringify(this.project));
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
  },
  commit(label, fn) {
    this.snapshot();
    fn();
    this.changed(true, label);
  },
  changed(final = true, label) {
    this.results = calcularProjeto(this.project);
    plan.render();
    if (final) {
      this.dirty = true;
      updateTitle();
      renderTree();
      renderProps();
      view3d.invalidate();
      if (label) this.lastAction = label;
    } else {
      renderProps();
    }
  },
  restore(json) {
    const selId = this.selection?.ref?.id;
    this.project = JSON.parse(json);
    this.floorIdx = Math.min(this.floorIdx, this.project.pavimentos.length - 1);
    this.selection = null;
    if (selId) for (const pv of this.project.pavimentos) {
      const r = pv.elementos.find((e) => e.id === selId) || pv.paredes.find((w) => w.id === selId);
      if (r && pv === this.floor) this.selection = { kind: r.tipo ? 'elemento' : 'parede', ref: r };
    }
    if (!this.activeCircuit) this.activeCircuitId = this.project.circuitos[0]?.id || null;
    this.changed(true);
    renderRibbon();
  },
  doUndo() { if (!this.undo.length) return; this.redo.push(JSON.stringify(this.project)); this.restore(this.undo.pop()); log('Desfeito.'); },
  doRedo() { if (!this.redo.length) return; this.undo.push(JSON.stringify(this.project)); this.restore(this.redo.pop()); log('Refeito.'); },

  select(sel, silent) {
    this.selection = sel;
    if (sel?.kind === 'elemento' && sel.ref.circuitoId && !silent) this.activeCircuitId = sel.ref.circuitoId;
    plan.render();
    renderProps();
    renderTree();
    syncCircuitSelect();
  },
  remove(hit) {
    this.commit('Apagar', () => {
      const f = this.floor;
      if (hit.kind === 'elemento') f.elementos.splice(f.elementos.indexOf(hit.ref), 1);
      else f.paredes.splice(f.paredes.indexOf(hit.ref), 1);
    });
    if (this.selection?.ref === hit.ref) this.select(null);
    log(hit.kind === 'elemento' ? `${TIPOS[hit.ref.tipo].sigla} apagado.` : 'Parede apagada.');
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
  $('#floor-label').textContent = `Pavimento: ${store.floor.nome}  ·  cota ${fmt(store.floor.cota)} m`;
  const v = [...new Set(store.project.circuitos.map((c) => c.tensao))].join('/');
  $('#st-volt').textContent = `Tensões: ${v || '-'} V`;
}

// ---------------------------------------------------------------- ribbon
const RIBBON = [
  { tab: 'Início', groups: [
    { label: 'Área de transferência', items: [
      { id: 'desfazer', label: 'Desfazer', run: () => store.doUndo() },
      { id: 'refazer', label: 'Refazer', run: () => store.doRedo() },
    ] },
    { label: 'Edição', items: [
      { id: 'selecionar', label: 'Selecionar', tool: true },
      { id: 'apagar', label: 'Apagar', tool: true },
    ] },
    { label: 'Exibição', items: [
      { id: 'zoom', label: 'Zoom extensão', run: () => plan.zoomExtents() },
      { id: 'vista2d', label: 'Planta 2D', run: () => setView('2d') },
      { id: 'vista3d', label: 'Vista 3D', run: () => setView('3d') },
    ] },
  ] },
  { tab: 'Arquitetura', groups: [
    { label: 'Elementos', items: [{ id: 'parede', label: 'Parede', tool: true }] },
    { label: 'Edificação', items: [
      { id: 'pavimento', label: 'Novo pavimento', run: () => novoPavimento() },
    ] },
  ] },
  { tab: 'Elétrico', groups: [
    { label: 'Quadros', items: [{ id: 'qd', label: 'Quadro', tool: true }] },
    { label: 'Pontos', items: [
      { id: 'luz', label: 'Ponto de luz', tool: true },
      { id: 'interruptor', label: 'Interruptor', tool: true },
      { id: 'tug', label: 'Tomada TUG', tool: true },
      { id: 'tue', label: 'Tomada TUE', tool: true },
    ] },
    { label: 'Circuitos', items: [
      { id: 'circuito', label: 'Novo circuito', run: () => novoCircuito() },
      { id: 'atribuir', label: 'Atribuir circuito', tool: true },
      { field: 'circuito-ativo' },
    ] },
    { label: 'Cálculo', items: [
      { id: 'dimensionar', label: 'Dimensionar', run: () => relatorioCargas() },
      { id: 'verificar', label: 'Verificar projeto', run: () => relatorioVerificacoes() },
    ] },
  ] },
  { tab: 'Visualizar', groups: [
    { label: 'Janelas', items: [
      { id: 'vista2d', label: 'Planta 2D', run: () => setView('2d') },
      { id: 'vista3d', label: 'Vista 3D', run: () => setView('3d') },
      { id: 'zoom', label: 'Zoom extensão', run: () => plan.zoomExtents() },
    ] },
    { label: 'Auxílios', items: [
      { id: 'grade', label: 'Grade', run: () => toggleSetting('grid') },
      { id: 'orto', label: 'Ortogonal', run: () => toggleSetting('orto') },
    ] },
  ] },
  { tab: 'Relatórios', groups: [
    { label: 'Elétrico', items: [
      { id: 'cargas', label: 'Quadro de cargas', run: () => relatorioCargas() },
      { id: 'materiais', label: 'Lista de materiais', run: () => relatorioMateriais() },
      { id: 'verificar', label: 'Verificações', run: () => relatorioVerificacoes() },
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
  { label: 'Exportar', items: [
    { id: 'exportar', label: 'Relatório HTML', run: () => exportarRelatorioCompleto() },
  ] },
];
const RIBBON_LABEL = Object.fromEntries(RIBBON.flatMap((t) => t.groups.flatMap((g) => g.items.filter((i) => i.id).map((i) => [i.id, i.label]))));
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
  const rb = $('#ribbon');
  rb.innerHTML = '';
  for (const g of groups) {
    const ge = document.createElement('div');
    ge.className = 'group';
    const items = document.createElement('div');
    items.className = 'group-items';
    for (const it of g.items) {
      if (it.field === 'circuito-ativo') {
        const f = document.createElement('div');
        f.className = 'rb-field';
        f.innerHTML = '<label>Circuito ativo</label><select id="sel-circuito"></select><label>Tipo / tensão</label><span id="circ-info" style="color:var(--text)"></span>';
        items.appendChild(f);
        continue;
      }
      const b = document.createElement('button');
      b.className = 'rb';
      b.innerHTML = ICONS[it.id] + `<span>${esc(it.label)}</span>`;
      b.title = it.label;
      if (it.tool) { b.dataset.tool = it.id; if (plan.tool === it.id) b.classList.add('active'); b.onclick = () => store.setTool(it.id); }
      else b.onclick = it.run;
      if (it.id === 'grade' && store.settings.grid) b.classList.add('active');
      if (it.id === 'orto' && store.settings.orto) b.classList.add('active');
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
const collapsed = new Set();
function renderTree() {
  const p = store.project;
  const node = (key, icon, label, opts = {}) => {
    const kids = opts.children;
    const open = kids && !collapsed.has(key);
    return `<li><div class="node${opts.sel ? ' sel' : ''}" data-key="${esc(key)}"${opts.act ? ` data-act="${esc(opts.act)}"` : ''}>
      <span class="tw">${kids ? (open ? '▼' : '▶') : ''}</span>${icon}<span>${esc(label)}</span>${opts.badge != null ? `<span class="badge">${esc(opts.badge)}</span>` : ''}</div>
      ${kids && open ? `<ul>${kids}</ul>` : ''}</li>`;
  };
  const sw = (c) => `<span class="swatch" style="background:${corCircuito(p, c.id)}"></span>`;
  const pavs = p.pavimentos.map((pv, i) => {
    const qtd = (t) => pv.elementos.filter((e) => e.tipo === t).length;
    const kids = [
      node(`pv${i}-par`, ICONS.parede, 'Paredes', { badge: pv.paredes.length, act: `floor:${i}` }),
      ...['qd', 'luz', 'interruptor', 'tug', 'tue'].map((t) => node(`pv${i}-${t}`, ICONS[t], TIPOS[t].nome, { badge: qtd(t), act: `floor:${i}` })),
    ].join('');
    return node(`pv${i}`, ICONS.camada, `${pv.nome} (${fmt(pv.cota)} m)`, { children: kids, sel: i === store.floorIdx, act: `floor:${i}` });
  }).join('');
  const circs = store.results.map((r) => node(`c-${r.circuito.id}`, sw(r.circuito), r.circuito.nome, {
    badge: `${Math.round(r.potencia)} VA`, sel: r.circuito.id === store.activeCircuitId, act: `circ:${r.circuito.id}`,
  })).join('');
  $('#tree').innerHTML = `<div class="tree"><ul>${node('root', ICONS.predio, p.nome, {
    children: node('edif', ICONS.pasta, 'Edificação', { children: pavs }) + node('circ', ICONS.raio, 'Circuitos', { children: circs || '<li class="empty">Nenhum circuito.</li>', badge: p.circuitos.length }),
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
  } else if (key === 'root') { store.selection = { kind: 'projeto' }; renderProps(); }
});

function setFloor(i) {
  store.floorIdx = i;
  store.selection = { kind: 'pavimento', ref: store.floor };
  plan.wallStart = null;
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
  let html = '';

  if (!sel) {
    html = `<div class="empty">Nada selecionado.<br>Use <b>Selecionar</b> e clique num elemento da planta, ou escolha um item na árvore do projeto.</div>`;
  } else if (sel.kind === 'elemento') {
    const e = sel.ref;
    const t = TIPOS[e.tipo];
    const circs = [['', '(sem circuito)'], ...store.project.circuitos.map((c) => [c.id, c.nome])];
    html = `<table class="props"><tr><th colspan="2">${esc(t.nome)}</th></tr>
      ${row('Identificador', ro(e.id))}
      ${row('Descrição', inp('descricao', e.descricao, 'text'))}
      ${row('X (m)', inp('x', e.x))}${row('Y (m)', inp('y', e.y))}
      ${row('Altura de instalação (m)', inp('altura', e.altura))}
      ${e.tipo !== 'qd' && e.tipo !== 'interruptor' ? row(e.tipo === 'tue' ? 'Potência (W)' : 'Potência (VA)', inp('potencia', e.potencia, 'number', '10')) : ''}
      ${e.tipo !== 'qd' ? row('Circuito', opts('circuitoId', e.circuitoId || '', circs)) : ''}
    </table>`;
  } else if (sel.kind === 'parede') {
    const w = sel.ref;
    html = `<table class="props"><tr><th colspan="2">Parede</th></tr>
      ${row('Identificador', ro(w.id))}
      ${row('Comprimento (m)', ro(fmt(Math.hypot(w.x2 - w.x1, w.y2 - w.y1))))}
      ${row('Espessura (m)', inp('esp', w.esp))}
      ${row('X inicial', inp('x1', w.x1))}${row('Y inicial', inp('y1', w.y1))}
      ${row('X final', inp('x2', w.x2))}${row('Y final', inp('y2', w.y2))}
    </table>`;
  } else if (sel.kind === 'pavimento') {
    const pv = sel.ref;
    html = `<table class="props"><tr><th colspan="2">Pavimento</th></tr>
      ${row('Nome', inp('nome', pv.nome, 'text'))}
      ${row('Cota (m)', inp('cota', pv.cota))}
      ${row('Pé-direito (m)', inp('peDireito', pv.peDireito))}
      ${row('Paredes', ro(pv.paredes.length))}${row('Pontos elétricos', ro(pv.elementos.length))}
    </table>`;
  } else if (sel.kind === 'circuito' && sel.ref) {
    const c = sel.ref;
    const r = store.results.find((x) => x.circuito.id === c.id);
    html = `<table class="props"><tr><th colspan="2">Circuito</th></tr>
      ${row('Nome', inp('nome', c.nome, 'text'))}
      ${row('Tipo', opts('tipo', c.tipo, [['ILUM', 'Iluminação'], ['TUG', 'Tomadas de uso geral'], ['TUE', 'Tomada de uso específico']]))}
      ${row('Tensão (V)', opts('tensao', c.tensao, [[127, '127'], [220, '220']]))}
      <tr><th colspan="2">Dimensionamento</th></tr>
      ${r ? `${row('Pontos', ro(r.pontos.length))}${row('Potência', ro(`${Math.round(r.potencia)} VA`))}
      ${row('Corrente de projeto', ro(`${fmt(r.ib)} A`))}${row('Comprimento', ro(`${fmt(r.comprimento, 1)} m`))}
      ${row('Seção do cabo', ro(r.ok ? `${fmtSec(r.secao)} mm²` : '—'))}${row('Disjuntor', ro(r.ok ? `${r.disjuntor} A` : '—'))}
      ${row('Queda de tensão', ro(r.ok ? `${fmt(r.queda)} %` : '—'))}` : ''}
    </table>
    <div style="padding:8px"><button class="btn" id="del-circ">Excluir circuito</button></div>`;
  } else if (sel.kind === 'projeto') {
    html = `<table class="props"><tr><th colspan="2">Projeto</th></tr>
      ${row('Nome', inp('nome', store.project.nome, 'text'))}
      ${row('Responsável técnico', inp('autor', store.project.autor || '', 'text'))}
      ${row('Pavimentos', ro(store.project.pavimentos.length))}${row('Circuitos', ro(store.project.circuitos.length))}
    </table>`;
  }
  box.innerHTML = html;
  const target = sel?.kind === 'projeto' ? store.project : sel?.ref;
  box.querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('change', () => {
      const k = el.dataset.k;
      let v = el.value;
      if (el.type === 'number' || k === 'tensao') v = Number(v);
      if (k === 'circuitoId') v = v || null;
      store.commit('Propriedade', () => { target[k] = v; });
      if (sel.kind === 'circuito' || sel.kind === 'projeto') { syncCircuitSelect(); updateTitle(); }
      if (sel.kind === 'pavimento') updateTitle();
    });
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
  const ativo = store.activeCircuit;
  const tipo = ativo?.tipo || 'TUG';
  const c = { id: store.uid('C'), numero, nome: `C${numero} ${tipo === 'ILUM' ? 'Iluminação' : tipo}`, tipo, tensao: tipo === 'TUE' ? 220 : 127 };
  store.commit('Novo circuito', () => store.project.circuitos.push(c));
  store.activeCircuitId = c.id;
  store.selection = { kind: 'circuito', ref: c };
  syncCircuitSelect(); renderTree(); renderProps(); store.refreshHint();
  log(`${c.nome} criado. Ajuste tipo e tensão em Propriedades e use "Atribuir circuito".`, 'ok');
}

function novoPavimento() {
  const ult = store.project.pavimentos[store.project.pavimentos.length - 1];
  const n = store.project.pavimentos.length;
  store.commit('Novo pavimento', () => {
    store.project.pavimentos.push({
      id: store.uid('PV'), nome: n === 1 ? 'Superior' : `Pavimento ${n + 1}`,
      cota: ult.cota + ult.peDireito + 0.1, peDireito: ult.peDireito,
      // copia as paredes externas como ponto de partida
      paredes: ult.paredes.map((w) => ({ ...w, id: store.uid('P') })), elementos: [],
    });
  });
  setFloor(store.project.pavimentos.length - 1);
  log(`Pavimento "${store.floor.nome}" criado com as paredes do pavimento abaixo.`, 'ok');
}

function toggleSetting(k) {
  store.settings[k] = !store.settings[k];
  $('#st-grid').classList.toggle('on', store.settings.grid);
  $('#st-snap').classList.toggle('on', store.settings.snap);
  $('#st-orto').classList.toggle('on', store.settings.orto);
  renderRibbon();
  plan.render();
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

// ---------------------------------------------------------------- arquivos
async function confirmarDescartar() {
  return !store.dirty || confirm('Há alterações não salvas. Descartar?');
}
function carregar(projeto, filePath) {
  if (!projeto?.pavimentos?.length) throw new Error('Arquivo não é um projeto válido.');
  store.project = projeto;
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
  carregar({ versao: 1, nome: 'Novo projeto', autor: '', seq: 0, circuitos: [
    { id: 'C1', numero: 1, nome: 'C1 Iluminação', tipo: 'ILUM', tensao: 127 },
    { id: 'C2', numero: 2, nome: 'C2 TUG', tipo: 'TUG', tensao: 127 },
  ], pavimentos: [{ id: 'PV1', nome: 'Térreo', cota: 0, peDireito: 2.8, paredes: [], elementos: [] }] }, null);
  store.setTool('parede');
  currentTab = 'Arquitetura'; renderRibbon();
  log('Novo projeto. Comece desenhando as paredes.', 'ok');
}
async function abrir() {
  if (!(await confirmarDescartar())) return;
  const r = await host.openProject();
  if (!r) return;
  try { carregar(JSON.parse(r.content), r.path); log(`Aberto: ${r.path}`, 'ok'); }
  catch (e) { log(`Não foi possível abrir: ${e.message}`, 'err'); }
}
async function salvar(como) {
  const p = await host.saveProject(JSON.stringify(store.project, null, 1), como ? null : store.filePath);
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
  for (const b of [...buttons, { label: 'Fechar', primary: true, run: closeModal }]) {
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

function tabelaCargas() {
  const rs = store.results;
  const head = ['Circuito', 'Tipo', 'Tensão (V)', 'Pontos', 'Potência (VA)', 'Ib (A)', 'Compr. (m)', 'Seção (mm²)', 'Iz (A)', 'Disjuntor (A)', 'ΔV (%)', 'Situação'];
  const rows = rs.map((r) => [
    r.circuito.nome, r.circuito.tipo, r.circuito.tensao, r.pontos.length, Math.round(r.potencia), fmt(r.ib), fmt(r.comprimento, 1),
    r.ok ? fmtSec(r.secao) : '—', r.ok ? fmt(r.iz, 1) : '—', r.ok ? r.disjuntor : '—', r.ok ? fmt(r.queda) : '—', r.ok && !r.avisos.length ? 'OK' : r.ok ? 'Aviso' : 'Erro',
  ]);
  const total = rs.reduce((s, r) => s + r.potencia, 0);
  return { head, rows, total };
}
function htmlTabela(head, rows, foot) {
  return `<table class="report"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, i) => {
    const tag = v === 'OK' ? 'ok' : v === 'Aviso' ? 'aviso' : v === 'Erro' ? 'erro' : '';
    return `<td class="${i === 0 || (typeof v === 'string' && isNaN(v.replace(',', '.')) && !tag) ? 'l' : ''}">${tag ? `<span class="tag ${tag}">${v}</span>` : esc(v)}</td>`;
  }).join('')}</tr>`).join('')}</tbody>${foot ? `<tfoot><tr>${foot.map((v, i) => `<td class="${i === 0 ? 'l' : ''}">${esc(v)}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
}
const csv = (head, rows) => [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');

function relatorioCargas() {
  const { head, rows, total } = tabelaCargas();
  const foot = ['Total', '', '', '', Math.round(total), '', '', '', '', '', '', ''];
  const nota = `<p style="color:var(--muted);margin-top:10px">Método de instalação B1 (eletroduto embutido), cobre/PVC, 2 condutores carregados. Seção mínima: 1,5 mm² (iluminação) e 2,5 mm² (força). Queda de tensão máxima ${QUEDA_MAX}%. Cálculo simplificado para estudo. A responsabilidade técnica é do projetista.</p>`;
  modal('Quadro de cargas', htmlTabela(head, rows, foot) + nota, [
    { label: 'Exportar CSV', run: () => host.exportFile(csv(head, rows), 'quadro-de-cargas.csv', 'csv', 'CSV').then((p) => p && log(`Exportado: ${p}`, 'ok')) },
  ]);
  log(`Dimensionamento concluído: ${rows.length} circuito(s), ${Math.round(total)} VA.`, 'ok');
}
function relatorioMateriais() {
  const itens = listaMateriais(store.project, store.results);
  const head = ['Descrição', 'Unidade', 'Quantidade'];
  const rows = itens.map((i) => [i.desc, i.un, i.qtd]);
  modal('Lista de materiais', htmlTabela(head, rows) + '<p style="color:var(--muted);margin-top:10px">Cabos: comprimento do circuito × 3 condutores (fase, neutro, terra), sem sobra. Some 10% para perdas.</p>', [
    { label: 'Exportar CSV', run: () => host.exportFile(csv(head, rows), 'lista-de-materiais.csv', 'csv', 'CSV').then((p) => p && log(`Exportado: ${p}`, 'ok')) },
  ]);
}
function relatorioVerificacoes() {
  const vs = verificacoes(store.project, store.results);
  const label = { ok: 'OK', aviso: 'Aviso', erro: 'Erro' };
  modal('Verificações do projeto', `<ul class="checks">${vs.map((v) => `<li><span class="tag ${v.nivel}">${label[v.nivel]}</span>${esc(v.texto)}</li>`).join('')}</ul>`);
  for (const v of vs) log(v.texto, v.nivel === 'ok' ? 'ok' : v.nivel === 'erro' ? 'err' : 'warn');
}
function exportarRelatorioCompleto() {
  const { head, rows, total } = tabelaCargas();
  const mat = listaMateriais(store.project, store.results);
  const vs = verificacoes(store.project, store.results);
  const css = 'body{font:13px Segoe UI,sans-serif;color:#1f2933;margin:32px}h1{font-size:20px}h2{font-size:15px;margin-top:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6dae0;padding:4px 8px;text-align:right}th{background:#f3f5f8}td.l{text-align:left}';
  const doc = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(store.project.nome)}</title><style>${css}</style>
<h1>${esc(store.project.nome)}</h1><p>Responsável técnico: ${esc(store.project.autor || '-')} · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
<h2>Quadro de cargas</h2>${htmlTabela(head, rows, ['Total', '', '', '', Math.round(total), '', '', '', '', '', '', ''])}
<h2>Lista de materiais</h2>${htmlTabela(['Descrição', 'Unidade', 'Quantidade'], mat.map((i) => [i.desc, i.un, i.qtd]))}
<h2>Verificações</h2><ul>${vs.map((v) => `<li>${esc(v.texto)}</li>`).join('')}</ul></html>`;
  host.exportFile(doc, 'relatorio-eletrico.html', 'html', 'Página HTML').then((p) => p && log(`Exportado: ${p}`, 'ok'));
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
  else if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else plan.cancel(); }
  else if (e.key === 'Delete' && store.selection && ['elemento', 'parede'].includes(store.selection.kind)) store.remove(store.selection);
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

// ---------------------------------------------------------------- quick access
$('#quick').innerHTML = ['novo', 'abrir', 'salvar', 'desfazer', 'refazer'].map((k) => `<button data-q="${k}" title="${k[0].toUpperCase() + k.slice(1)}">${ICONS[k]}</button>`).join('');
$('#quick').addEventListener('click', (e) => {
  const q = e.target.closest('button')?.dataset.q;
  ({ novo: novoProjeto, abrir, salvar: () => salvar(), desfazer: () => store.doUndo(), refazer: () => store.doRedo() })[q]?.();
});

// ---------------------------------------------------------------- início
const plan = new Plan2D($('#plan'), store);
const view3d = new View3D($('#view3d'), store);
store.results = calcularProjeto(store.project);
renderRibbon();
renderTree();
renderProps();
updateTitle();
store.setTool('selecionar');
requestAnimationFrame(() => plan.zoomExtents());
log('Vértice pronto. Projeto exemplo carregado.', 'ok');
log('Dica: aba Elétrico > Dimensionar mostra o quadro de cargas.');
window.__vertice = store; // usado pelos testes automatizados
