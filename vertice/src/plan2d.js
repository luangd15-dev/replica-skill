import { TIPOS } from './tipos.js';
import { corAci } from './dxf.js';

export const CORES_CIRCUITO = ['#1d6fd6', '#d0453a', '#1f9d55', '#c98a00', '#8e44ad', '#0f8c9c', '#d35400', '#5b6b7d', '#b0306b', '#3f7d20'];
export const corCircuito = (projeto, id) => {
  const i = projeto.circuitos.findIndex((c) => c.id === id);
  return i < 0 ? '#8a96a3' : CORES_CIRCUITO[i % CORES_CIRCUITO.length];
};
export const COR = {
  af: '#1593a6', esg: '#8a5a2b', hid: '#0f6f80', est: '#6b4fa0', estFill: '#d9cff0', viga: '#7d63b0',
  laje: '#b9a8de', spda: '#2e8b57', parede: '#4a5562', paredeFill: '#c4cad1', sel: '#1d6fd6',
};

export const DESENHO = ['linha', 'retangulo', 'circulo', 'texto', 'medir'];
// identificação estável de um trecho de eletroduto (entre dois elementos)
export const chaveSeg = (sg) => `${sg.de.el.id}|${sg.para.el.id}`;
// numeração das indicações de eletrodutos de um pavimento (legenda de fiação)
export function indicacoesPavimento(ele, pav) {
  const m = new Map();
  let n = 0;
  for (const sg of ele?.segmentos || []) if (sg.de.pav === pav && sg.para.pav === pav) m.set(sg, ++n);
  return m;
}
const GRUPO_TIPO = Object.fromEntries(Object.entries(TIPOS).filter(([, t]) => t.disc === 'ele' && t.grupo).map(([k, t]) => [k, t.grupo]));
const COMANDOS = ['interruptor', 'paralelo', 'intermediario', 'dimmer', 'sensor', 'pulsador'];

export class Plan2D {
  constructor(canvas, store) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.scale = 42; // px por metro
    this.ox = 80;
    this.oy = 80;
    this.tool = 'selecionar';
    this.mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    this.start = null; // 1º ponto de parede, viga ou laje
    this.drag = null;
    this.box = null;
    this.pan = null;
    this.hover = null;
    this.space = false;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', () => this.finishChain());
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { this.space = true; e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
  }

  get floor() { return this.store.floor; }
  vis(d) { return this.store.settings.vis[d] !== false; }
  // foco: a aba ativa destaca a sua disciplina; as outras ficam esmaecidas e sem rótulos
  foco(d) {
    const f = this.store.settings.foco;
    this.ctx.globalAlpha = !f || f === d || d === 'arq' ? 1 : 0.28;
    this.rotulos = !f || f === d;
  }

  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.max(1, r.width * dpr);
    this.cv.height = Math.max(1, r.height * dpr);
    this.w = r.width;
    this.h = r.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.pendingFit && this.w && this.h) { this.pendingFit = false; return this.zoomExtents(); }
    this.render();
  }

  toWorld(sx, sy) { return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale }; }
  toScreen(x, y) { return { x: x * this.scale + this.ox, y: y * this.scale + this.oy }; }

  snap(p) {
    if (!this.store.settings.snap) return p;
    const tol = 10 / this.scale;
    const cands = [];
    for (const w of this.floor.paredes) cands.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    for (const v of this.floor.vigas || []) cands.push({ x: v.x1, y: v.y1 }, { x: v.x2, y: v.y2 });
    for (const e of this.floor.elementos) if (e.tipo === 'pilar') cands.push(e);
    // pontas de linhas do desenho de referência
    const f = this.floor.fundo;
    if (f && this.vis('fundo')) for (let i = 0; i < f.s.length; i += 5) if (f.camadas[f.s[i]]?.vis) cands.push({ x: f.s[i + 1], y: f.s[i + 2] }, { x: f.s[i + 3], y: f.s[i + 4] });
    let best = null, bd = tol;
    for (const q of cands) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
    if (best) return { x: best.x, y: best.y };
    const g = 0.05 * Math.max(1, Math.round(5 / Math.max(1, this.scale / 10)));
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  setTool(t) {
    this.tool = t;
    this.start = null;
    this.render();
  }

  hint() {
    const c = this.store.activeCircuit;
    const H = {
      selecionar: 'Clique para selecionar · arraste no vazio para selecionar por área · Ctrl+C / Ctrl+V copia blocos · Del apaga · roda: zoom · botão do meio/direito: deslocar.',
      parede: this.start ? 'Clique o próximo ponto. Duplo clique, Esc ou botão direito encerra.' : 'Clique o ponto inicial da parede.',
      viga: this.start ? 'Clique o próximo apoio. Duplo clique, Esc ou botão direito encerra.' : 'Clique o primeiro apoio da viga (snap em pilares).',
      laje: this.start ? 'Clique o canto oposto da laje.' : 'Clique o primeiro canto da laje.',
      apagar: 'Clique num elemento para apagar.',
      linha: this.start ? 'Clique o próximo ponto (Esc encerra).' : 'Clique o ponto inicial da linha.',
      retangulo: this.start ? 'Clique o canto oposto.' : 'Clique o primeiro canto.',
      circulo: this.start ? 'Clique um ponto do contorno.' : 'Clique o centro.',
      texto: 'Clique onde o texto começa.',
      medir: this.start ? 'Clique o segundo ponto.' : 'Clique o primeiro ponto da medição.',
      atribuir: c ? `Clique nos pontos para atribuir ao circuito ${c.nome}.` : 'Crie um circuito primeiro.',
      eletroduto: this.start ? 'Clique o ponto, caixa ou quadro de chegada. O traçado automático passa a usar este eletroduto (clicar de novo no mesmo par remove).' : 'Clique o ponto, caixa ou quadro de saída do eletroduto.',
    };
    if (TIPOS[this.tool]) return `Clique para inserir: ${TIPOS[this.tool].nome}.` + (GRUPO_TIPO[this.tool] && c ? ` Circuito ativo: ${c.nome}.` : '');
    return H[this.tool] || '';
  }

  // ---------- eventos ----------
  onWheel(e) {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.min(600, Math.max(0.5, this.scale * f));
    const r = this.cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const wpt = this.toWorld(sx, sy);
    this.scale = ns;
    this.ox = sx - wpt.x * ns;
    this.oy = sy - wpt.y * ns;
    this.render();
  }

  pointFrom(e) {
    const r = this.cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    let p = this.snap(this.toWorld(sx, sy));
    if (['parede', 'viga', 'linha', 'medir'].includes(this.tool) && this.start && this.store.settings.orto) {
      const dx = Math.abs(p.x - this.start.x), dy = Math.abs(p.y - this.start.y);
      p = dx >= dy ? { x: p.x, y: this.start.y } : { x: this.start.x, y: p.y };
    }
    return { sx, sy, inside: sx >= 0 && sy >= 0 && sx <= r.width && sy <= r.height, ...p, raw: this.toWorld(sx, sy) };
  }

  onDown(e) {
    const p = this.pointFrom(e);
    if (e.button === 1 || (e.button === 0 && this.space)) {
      this.pan = { sx: p.sx, sy: p.sy, ox: this.ox, oy: this.oy };
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      if (this.start) return this.finishChain();
      this.pan = { sx: p.sx, sy: p.sy, ox: this.ox, oy: this.oy };
      return;
    }
    if (e.button !== 0) return;
    const s = this.store;

    if (this.tool === 'selecionar') {
      const hit = this.hitTest(p.raw);
      if (hit?.kind === 'eletroduto') return s.select(hit);
      if (hit) {
        if (e.shiftKey || e.ctrlKey) return s.toggleSelect(hit);
        if (!s.isSelected(hit.ref)) s.select(hit);
        const itens = s.selection?.kind === 'multi' ? s.selection.itens : [hit];
        this.drag = { itens, x0: p.x, y0: p.y, orig: itens.map((it) => ({ ...it.ref })), moved: false };
      } else {
        this.box = { x0: p.raw.x, y0: p.raw.y, x1: p.raw.x, y1: p.raw.y, add: e.shiftKey || e.ctrlKey };
      }
      return;
    }
    if (this.tool === 'parede' || this.tool === 'viga') {
      if (!this.start) { this.start = { x: p.x, y: p.y }; this.render(); s.refreshHint(); return; }
      if (p.x === this.start.x && p.y === this.start.y) return;
      const a = this.start;
      if (this.tool === 'parede') {
        s.commit('Parede', () => this.floor.paredes.push({ id: s.uid('P'), x1: a.x, y1: a.y, x2: p.x, y2: p.y, esp: 0.15 }));
      } else {
        s.commit('Viga', () => { (this.floor.vigas ||= []).push({ id: s.uid('V'), x1: a.x, y1: a.y, x2: p.x, y2: p.y, b: 15, h: 40 }); });
      }
      this.start = { x: p.x, y: p.y };
      return;
    }
    if (this.tool === 'laje') {
      if (!this.start) { this.start = { x: p.x, y: p.y }; this.render(); s.refreshHint(); return; }
      const a = this.start;
      if (Math.abs(p.x - a.x) < 0.3 || Math.abs(p.y - a.y) < 0.3) return;
      s.commit('Laje', () => { (this.floor.lajes ||= []).push({ id: s.uid('L'), x1: Math.min(a.x, p.x), y1: Math.min(a.y, p.y), x2: Math.max(a.x, p.x), y2: Math.max(a.y, p.y), h: 10, sc: 1.5, rev: 1.0 }); });
      this.start = null;
      s.refreshHint();
      return;
    }
    if (DESENHO.includes(this.tool)) return this.desenhoClique(p);
    if (this.tool === 'apagar') {
      const hit = this.hitTest(p.raw);
      if (hit) s.remove(hit);
      return;
    }
    if (this.tool === 'distLuz' || this.tool === 'distTom') {
      const amb = (this.floor.ambientes || []).find((a) => p.raw.x >= a.x1 && p.raw.x <= a.x2 && p.raw.y >= a.y1 && p.raw.y <= a.y2);
      if (!amb) return s.log('Clique dentro de um ambiente. Use "Ambientes" para reconhecê-los a partir das paredes.', 'warn');
      return s.distribuir(this.tool, amb);
    }
    if (this.tool === 'eletroduto') {
      const hit = this.hitTest(p.raw);
      const el = hit?.kind === 'elemento' && TIPOS[hit.ref.tipo]?.disc === 'ele' ? hit.ref : null;
      if (!el) return s.log('Clique num ponto elétrico, caixa de passagem ou quadro.', 'warn');
      if (!this.start) { this.start = { x: el.x, y: el.y, el }; s.refreshHint(); return this.render(); }
      const a = this.start.el;
      this.start = null;
      if (a === el) return s.refreshHint();
      const lista = (this.floor.eletrodutos ||= []);
      const i = lista.findIndex((m) => (m.a === a.id && m.b === el.id) || (m.a === el.id && m.b === a.id));
      if (i >= 0) { s.commit('Remover eletroduto', () => lista.splice(i, 1)); s.log('Eletroduto lançado removido; o traçado volta a ser automático.'); }
      else { s.commit('Eletroduto', () => lista.push({ id: s.uid('M'), a: a.id, b: el.id })); s.log(`Eletroduto lançado: ${TIPOS[a.tipo].sigla} → ${TIPOS[el.tipo].sigla}. O traçado automático passa por ele.`, 'ok'); }
      s.refreshHint();
      return;
    }
    if (this.tool === 'atribComando') {
      const hit = this.hitTest(p.raw);
      const L = s.settings.comandoAtivo || 'a';
      if (!hit || hit.kind !== 'elemento') return;
      const el = hit.ref;
      if (TIPOS[el.tipo].comandada) s.commit('Comando', () => { el.comando = L; });
      else if (COMANDOS.includes(el.tipo)) s.commit('Comando', () => {
        const cs = new Set(el.comandos || []);
        cs.has(L) ? cs.delete(L) : cs.add(L);
        el.comandos = [...cs].sort();
      });
      else return;
      s.log(`${TIPOS[el.tipo].sigla}: comando ${TIPOS[el.tipo].comandada ? `"${L}"` : `"${(el.comandos || []).join(', ') || '-'}"`}.`);
      return;
    }
    if (this.tool === 'atribuir') {
      const hit = this.hitTest(p.raw);
      const c = s.activeCircuit;
      if (!c) return s.log('Crie um circuito antes de atribuir.', 'warn');
      if (hit && hit.kind === 'elemento' && GRUPO_TIPO[hit.ref.tipo]) {
        s.commit('Atribuir circuito', () => { hit.ref.circuitoId = c.id; });
        s.log(`${TIPOS[hit.ref.tipo].sigla} atribuído ao ${c.nome}.`);
      }
      return;
    }
    if (TIPOS[this.tool]) {
      const t = TIPOS[this.tool];
      const c = s.activeCircuit;
      const grupo = GRUPO_TIPO[this.tool];
      const circ = grupo && c && c.tipo === grupo ? c.id : null;
      let nova = null;
      s.commit(t.nome, () => {
        nova = { id: s.uid('E'), tipo: this.tool, x: p.x, y: p.y, altura: this.tool === 'pilar' ? 0 : s.settings.altura ?? t.altura, descricao: '' };
        if (t.disc === 'ele') {
          Object.assign(nova, { potencia: t.potencia, circuitoId: t.quadro || this.tool === 'cp' ? null : circ });
          if (t.comandada && circ) nova.comando = s.settings.comandoAtivo || 'a';
          if (COMANDOS.includes(this.tool) && this.tool !== 'pulsador') nova.comandos = circ ? [s.settings.comandoAtivo || 'a'] : [];
          if (t.quadro) Object.assign(nova, { esquema: this.tool === 'qd' ? '2F+N' : '3F+N', dps: this.tool === 'qd' });
          if (t.quadro) delete nova.potencia;
        }
        if (this.tool === 'pilar') Object.assign(nova, { b: t.b, h: t.h });
        this.floor.elementos.push(nova);
      });
      if (grupo && !circ && !t.quadro) s.log(`${t.sigla} inserido sem circuito: o circuito ativo não é do tipo ${grupo}.`, 'warn');
      s.select({ kind: 'elemento', ref: nova }, true);
    }
  }

  onMove(e) {
    const p = this.pointFrom(e);
    this.mouse = p;
    if (this.pan) {
      this.ox = this.pan.ox + (p.sx - this.pan.sx);
      this.oy = this.pan.oy + (p.sy - this.pan.sy);
      this.render();
      return;
    }
    if (this.drag) {
      const dx = p.x - this.drag.x0, dy = p.y - this.drag.y0;
      if (!this.drag.moved && (dx || dy)) { this.store.snapshot(); this.drag.moved = true; }
      this.drag.itens.forEach((it, i) => {
        const o = this.drag.orig[i];
        if ('x' in o) { it.ref.x = o.x + dx; it.ref.y = o.y + dy; }
        else { it.ref.x1 = o.x1 + dx; it.ref.y1 = o.y1 + dy; it.ref.x2 = o.x2 + dx; it.ref.y2 = o.y2 + dy; }
      });
      this.store.changed(false);
      return;
    }
    if (this.box) {
      this.box.x1 = p.raw.x;
      this.box.y1 = p.raw.y;
      this.render();
      return;
    }
    if (!p.inside) return;
    this.store.setCoord(p.x, p.y);
    this.hover = ['selecionar', 'apagar', 'atribuir', 'atribComando', 'eletroduto'].includes(this.tool) ? this.hitTest(p.raw) : null;
    this.cv.title = this.dicaEm(p.raw);
    this.render();
  }

  onUp() {
    if (this.drag) {
      if (this.drag.moved) this.store.changed(true, 'Mover');
      this.drag = null;
    }
    if (this.box) {
      const b = this.box;
      this.box = null;
      const minX = Math.min(b.x0, b.x1), maxX = Math.max(b.x0, b.x1), minY = Math.min(b.y0, b.y1), maxY = Math.max(b.y0, b.y1);
      if ((maxX - minX) * this.scale < 4 && (maxY - minY) * this.scale < 4) { this.store.select(null); return; }
      // da esquerda para a direita: só o que está inteiro dentro; da direita para a esquerda: o que toca
      const cruzando = b.x1 < b.x0;
      const dentro = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
      const segOk = (o) => cruzando ? segRect(o, minX, minY, maxX, maxY) : dentro(o.x1, o.y1) && dentro(o.x2, o.y2);
      const itens = [];
      const f = this.floor;
      for (const d of f.desenho || []) {
        const ok = d.t === 'linha' || d.t === 'ret' ? segOk(d) : dentro(d.x, d.y);
        if (ok && this.vis('arq')) itens.push({ kind: 'desenho', ref: d });
      }
      for (const el of f.elementos) if (this.vis(TIPOS[el.tipo]?.disc) && dentro(el.x, el.y)) itens.push({ kind: 'elemento', ref: el });
      if (this.vis('arq')) for (const w of f.paredes) if (segOk(w)) itens.push({ kind: 'parede', ref: w });
      if (this.vis('est')) {
        for (const v of f.vigas || []) if (segOk(v)) itens.push({ kind: 'viga', ref: v });
        for (const l of f.lajes || []) if (cruzando ? !(l.x2 < minX || l.x1 > maxX || l.y2 < minY || l.y1 > maxY) : dentro(l.x1, l.y1) && dentro(l.x2, l.y2)) itens.push({ kind: 'laje', ref: l });
      }
      this.store.selectMany(itens.filter((it) => this.passaFiltro(it)), b.add);
    }
    this.pan = null;
    this.render();
  }

  finishChain() {
    if (this.start) { this.start = null; this.render(); this.store.refreshHint(); }
  }

  cancel() {
    if (this.start) return this.finishChain();
    this.store.setTool('selecionar');
  }

  // filtro de seleção (Desenhos > Filtro de seleção)
  passaFiltro(it) {
    const f = this.store.settings.filtro || 'todos';
    if (f === 'todos' || !it) return true;
    if (f === 'arq') return it.kind === 'parede' || it.kind === 'ambiente';
    if (f === 'est') return it.kind === 'viga' || it.kind === 'laje' || it.ref.tipo === 'pilar';
    if (f === 'desenho') return it.kind === 'desenho';
    return it.kind === 'elemento' && TIPOS[it.ref.tipo]?.disc === f;
  }

  hitTest(p) {
    const r = this.hitBruto(p);
    return r && this.passaFiltro(r) ? r : null;
  }

  hitBruto(p) {
    const tolPx = 9 / this.scale;
    for (const d of this.floor.desenho || []) {
      let dist = Infinity;
      if (d.t === 'linha') dist = segDist(p, d);
      else if (d.t === 'ret') dist = Math.min(...[[d.x1, d.y1, d.x2, d.y1], [d.x2, d.y1, d.x2, d.y2], [d.x2, d.y2, d.x1, d.y2], [d.x1, d.y2, d.x1, d.y1]].map(([a, b, c, e]) => segDist(p, { x1: a, y1: b, x2: c, y2: e })));
      else if (d.t === 'circ') dist = Math.abs(Math.hypot(p.x - d.x, p.y - d.y) - d.r);
      else if (d.t === 'texto') dist = p.x >= d.x - tolPx && p.x <= d.x + d.texto.length * d.h * 0.6 && p.y <= d.y + tolPx && p.y >= d.y - d.h - tolPx ? 0 : Infinity;
      if (dist < tolPx) return { kind: 'desenho', ref: d };
    }
    const f = this.floor;
    let best = null, bd = Infinity;
    for (const el of f.elementos) {
      if (!this.vis(TIPOS[el.tipo]?.disc)) continue;
      let d = Math.hypot(el.x - p.x, el.y - p.y);
      if (el.tipo === 'pilar' && Math.abs(el.x - p.x) <= el.b / 200 && Math.abs(el.y - p.y) <= el.h / 200) d = 0;
      if (d < Math.max(0.25, tolPx * 1.5) && d < bd) { best = { kind: 'elemento', ref: el }; bd = d; }
    }
    if (best) return best;
    const sg = this.segmentoEm(p, tolPx);
    if (sg) return { kind: 'eletroduto', ref: sg, chave: chaveSeg(sg) };
    if (this.vis('est')) for (const v of f.vigas || []) {
      const d = segDist(p, v);
      if (d < v.b / 200 + tolPx && d < bd) { best = { kind: 'viga', ref: v }; bd = d; }
    }
    if (this.vis('arq')) for (const w of f.paredes) {
      const d = segDist(p, w);
      if (d < w.esp / 2 + tolPx && d < bd) { best = { kind: 'parede', ref: w }; bd = d; }
    }
    if (best) return best;
    if (this.vis('est') && this.store.settings.foco === 'est') for (const l of f.lajes || []) {
      if (p.x >= l.x1 && p.x <= l.x2 && p.y >= l.y1 && p.y <= l.y2) return { kind: 'laje', ref: l };
    }
    if (this.vis('arq')) for (const a of f.ambientes || []) {
      if (p.x >= a.x1 && p.x <= a.x2 && p.y >= a.y1 && p.y <= a.y2) return { kind: 'ambiente', ref: a };
    }
    if (this.vis('est')) for (const l of f.lajes || []) {
      if (p.x >= l.x1 && p.x <= l.x2 && p.y >= l.y1 && p.y <= l.y2) return { kind: 'laje', ref: l };
    }
    return null;
  }

  async desenhoClique(p) {
    const s = this.store;
    const f = this.floor;
    const add = (nome, obj) => s.commit(nome, () => { (f.desenho ||= []).push({ id: s.uid('D'), ...obj }); });
    if (this.tool === 'texto') {
      const t = await s.pedirTexto('Texto', 'Digite o texto:', '');
      if (t) add('Texto', { t: 'texto', x: p.x, y: p.y, h: Math.max(0.1, (s.settings.escala || 50) * 0.0025), texto: t });
      return;
    }
    if (!this.start) { this.start = { x: p.x, y: p.y }; s.refreshHint(); return this.render(); }
    const a = this.start;
    if (this.tool === 'medir') {
      const dx = p.x - a.x, dy = p.y - a.y;
      s.log(`Distância: ${fmt(Math.hypot(dx, dy), 3)} m  (ΔX ${fmt(dx, 3)}  ΔY ${fmt(dy, 3)}  ângulo ${fmt((Math.atan2(-dy, dx) * 180) / Math.PI, 1)}°)`, 'ok');
      this.start = null;
    } else if (this.tool === 'linha') {
      if (p.x !== a.x || p.y !== a.y) add('Linha', { t: 'linha', x1: a.x, y1: a.y, x2: p.x, y2: p.y });
      this.start = { x: p.x, y: p.y };
    } else if (this.tool === 'retangulo') {
      add('Retângulo', { t: 'ret', x1: Math.min(a.x, p.x), y1: Math.min(a.y, p.y), x2: Math.max(a.x, p.x), y2: Math.max(a.y, p.y) });
      this.start = null;
    } else if (this.tool === 'circulo') {
      const r = Math.hypot(p.x - a.x, p.y - a.y);
      if (r > 0.01) add('Círculo', { t: 'circ', x: a.x, y: a.y, r });
      this.start = null;
    }
    s.refreshHint();
    this.render();
  }

  drawAnotacao(d) {
    const c = this.ctx, sel = this.store.isSelected(d), hov = this.hover?.ref === d;
    c.save();
    c.strokeStyle = sel ? COR.sel : hov ? '#5c8fd6' : '#2b2f33';
    c.fillStyle = c.strokeStyle;
    c.lineWidth = sel ? 1.8 : 1.1;
    c.beginPath();
    if (d.t === 'linha') { const a = this.toScreen(d.x1, d.y1), b = this.toScreen(d.x2, d.y2); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    else if (d.t === 'ret') { const a = this.toScreen(d.x1, d.y1), b = this.toScreen(d.x2, d.y2); c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    else if (d.t === 'circ') { const a = this.toScreen(d.x, d.y); c.arc(a.x, a.y, d.r * this.scale, 0, Math.PI * 2); c.stroke(); }
    else if (d.t === 'texto') {
      const a = this.toScreen(d.x, d.y);
      const px = d.h * this.scale;
      if (px >= 4) { c.font = `${px}px "Segoe UI", sans-serif`; c.textBaseline = 'alphabetic'; c.fillText(d.texto, a.x, a.y); }
    }
    c.restore();
  }

  // escala de exibição 1:N (tela a 96 dpi)
  get escala() { return Math.round(3779.5 / this.scale); }
  setEscala(n) {
    const cx = this.w / 2, cy = this.h / 2;
    const w = this.toWorld(cx, cy);
    this.scale = 3779.5 / n;
    this.ox = cx - w.x * this.scale;
    this.oy = cy - w.y * this.scale;
    this.render();
  }
  zoomPor(f) {
    const cx = this.w / 2, cy = this.h / 2, w = this.toWorld(cx, cy);
    this.scale = Math.min(600, Math.max(0.5, this.scale * f));
    this.ox = cx - w.x * this.scale; this.oy = cy - w.y * this.scale;
    this.render();
  }

  zoomExtents() {
    if (!this.w || !this.h) { this.pendingFit = true; return; }
    const pts = [];
    const f = this.floor;
    for (const w of f.paredes) pts.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    for (const e of f.elementos) pts.push(e);
    if (f.fundo && this.vis('fundo')) {
      for (let i = 0; i < f.fundo.s.length; i += 5) pts.push({ x: f.fundo.s[i + 1], y: f.fundo.s[i + 2] });
    }
    if (!pts.length) { this.scale = 42; this.ox = 80; this.oy = 80; return this.render(); }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of pts) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
    const pad = 60;
    this.scale = Math.min((this.w - pad * 2) / Math.max(1, maxX - minX), (this.h - pad * 2) / Math.max(1, maxY - minY), 200);
    this.ox = (this.w - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oy = (this.h - (maxY - minY) * this.scale) / 2 - minY * this.scale;
    this.render();
  }

  // ---------- desenho ----------
  render() {
    if (!this.w) return;
    this.store.onRender?.();
    const c = this.ctx, s = this.store, f = this.floor;
    // otimização das indicações: os rótulos evitam os símbolos e os outros rótulos
    this.ocup = [];
    this.otimizar = s.settings.otimizar !== false;
    if (this.otimizar) {
      const r = this.symSize() + 2;
      for (const el of f.elementos) {
        if (el.tipo === 'pilar') continue;
        const P = this.toScreen(el.x, el.y);
        if (P.x > -50 && P.y > -50 && P.x < this.w + 50 && P.y < this.h + 50) this.ocup.push([P.x - r, P.y - r, P.x + r, P.y + r]);
      }
    }
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, this.w, this.h);
    if (s.settings.grid) this.drawGrid();
    if (f.fundo && this.vis('fundo')) this.drawFundo(f.fundo);
    if (!this.impressao) this.drawAxes();

    const idx = s.project.pavimentos.indexOf(f);
    const below = s.project.pavimentos[idx - 1];
    if (below && this.vis('arq')) for (const w of below.paredes) this.drawWall(w, '#eef0f3', '#d9dde2');

    this.foco('est');
    if (this.vis('est')) for (const l of f.lajes || []) this.drawLaje(l);
    this.foco('arq');
    if (this.vis('arq')) for (const a of f.ambientes || []) this.drawAmbiente(a);
    if (this.vis('arq')) {
      for (const w of f.paredes) {
        const sel = s.isSelected(w);
        const hov = this.hover && this.hover.ref === w;
        this.drawWall(w, sel ? '#cfe0f8' : hov ? '#dfe7f1' : COR.paredeFill, sel ? COR.sel : COR.parede);
        if (sel && s.selection.kind !== 'multi') this.drawDim(w);
      }
    }
    this.foco('est');
    if (this.vis('est')) for (const v of f.vigas || []) this.drawViga(v);
    this.foco('spda');
    if (this.vis('spda')) this.drawSpda();
    this.foco('hid');
    if (this.vis('hid')) this.drawRedesHid();
    this.foco('ele');
    if (this.vis('ele')) this.drawEletrodutos();

    this.foco('arq');
    if (this.vis('arq')) for (const d of f.desenho || []) this.drawAnotacao(d);
    for (const el of f.elementos) {
      const d = TIPOS[el.tipo]?.disc;
      if (!this.vis(d)) continue;
      if (d === 'ele' && !this.elementoNaPlanta(el)) continue;
      this.foco(d);
      this.drawElement(el);
    }
    this.ctx.globalAlpha = 1;
    this.rotulos = true;

    // pré-visualização
    if ((this.tool === 'parede' || this.tool === 'viga') && this.start) {
      const a = this.toScreen(this.start.x, this.start.y), b = this.toScreen(this.mouse.x, this.mouse.y);
      c.save();
      c.strokeStyle = this.tool === 'viga' ? COR.viga : COR.sel;
      c.lineWidth = Math.max(2, 0.15 * this.scale);
      c.globalAlpha = 0.45;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.restore();
      const len = Math.hypot(this.mouse.x - this.start.x, this.mouse.y - this.start.y);
      this.tag(fmt(len) + ' m', (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, COR.sel);
    } else if (this.tool === 'laje' && this.start) {
      const a = this.toScreen(this.start.x, this.start.y), b = this.toScreen(this.mouse.x, this.mouse.y);
      c.save(); c.fillStyle = 'rgba(185,168,222,.25)'; c.strokeStyle = COR.est; c.setLineDash([6, 4]);
      c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); c.restore();
      this.tag(`${fmt(Math.abs(this.mouse.x - this.start.x))} × ${fmt(Math.abs(this.mouse.y - this.start.y))} m`, (a.x + b.x) / 2, (a.y + b.y) / 2, COR.est);
    } else if (DESENHO.includes(this.tool) && this.start) {
      const a = this.start, m = this.mouse;
      const c2 = this.ctx;
      c2.save(); c2.strokeStyle = COR.sel; c2.setLineDash([6, 4]); c2.lineWidth = 1.2;
      const A = this.toScreen(a.x, a.y), B = this.toScreen(m.x, m.y);
      c2.beginPath();
      if (this.tool === 'retangulo') c2.rect(A.x, A.y, B.x - A.x, B.y - A.y);
      else if (this.tool === 'circulo') c2.arc(A.x, A.y, Math.hypot(B.x - A.x, B.y - A.y), 0, Math.PI * 2);
      else { c2.moveTo(A.x, A.y); c2.lineTo(B.x, B.y); }
      c2.stroke(); c2.restore();
      const L = Math.hypot(m.x - a.x, m.y - a.y);
      this.tag(this.tool === 'circulo' ? `R = ${fmt(L)} m` : this.tool === 'retangulo' ? `${fmt(Math.abs(m.x - a.x))} × ${fmt(Math.abs(m.y - a.y))} m` : `${fmt(L)} m`, (A.x + B.x) / 2, (A.y + B.y) / 2 - 12, COR.sel);
    } else if (this.tool === 'eletroduto' && this.start) {
      const a = this.toScreen(this.start.x, this.start.y), b = this.toScreen(this.mouse.x, this.mouse.y);
      c.save(); c.strokeStyle = '#c98a00'; c.lineWidth = 2.5; c.setLineDash([8, 4]);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.restore();
    } else if (TIPOS[this.tool] && this.mouse.inside) {
      c.save(); c.globalAlpha = 0.5;
      this.drawSymbol(this.tool, this.toScreen(this.mouse.x, this.mouse.y), COR.sel, { b: TIPOS[this.tool].b, h: TIPOS[this.tool].h });
      c.restore();
    }
    if (this.box) {
      const a = this.toScreen(this.box.x0, this.box.y0), b = this.toScreen(this.box.x1, this.box.y1);
      const cruz = this.box.x1 < this.box.x0;
      c.save();
      c.fillStyle = cruz ? 'rgba(31,157,85,.08)' : 'rgba(29,111,214,.08)';
      c.strokeStyle = cruz ? '#1f9d55' : COR.sel;
      if (cruz) c.setLineDash([5, 4]);
      c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      c.restore();
    }
    if (this.tool !== 'selecionar' && this.mouse.inside) this.drawCursor();
  }

  drawGrid() {
    const c = this.ctx;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    let minor = 0.25;
    while (minor * this.scale < 9) minor *= minor < 1 ? 2 : 5;
    const major = minor * 5;
    for (const [step, col] of [[minor, '#f1f3f6'], [major, '#e2e6eb']]) {
      c.strokeStyle = col;
      c.lineWidth = 1;
      c.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { const sx = Math.round(this.toScreen(x, 0).x) + 0.5; c.moveTo(sx, 0); c.lineTo(sx, this.h); }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) { const sy = Math.round(this.toScreen(0, y).y) + 0.5; c.moveTo(0, sy); c.lineTo(this.w, sy); }
      c.stroke();
    }
  }

  drawAxes() {
    const c = this.ctx, o = this.toScreen(0, 0);
    c.save();
    c.lineWidth = 1.5;
    c.strokeStyle = '#d0453a'; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x + 28, o.y); c.stroke();
    c.strokeStyle = '#1f9d55'; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x, o.y + 28); c.stroke();
    c.restore();
  }

  drawFundo(fd) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = 0.6;
    c.lineWidth = 1;
    const byLayer = new Map();
    for (let i = 0; i < fd.s.length; i += 5) {
      const l = fd.s[i];
      if (!fd.camadas[l]?.vis) continue;
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l).push(i);
    }
    for (const [l, idxs] of byLayer) {
      c.strokeStyle = corAci(fd.camadas[l].cor);
      c.beginPath();
      for (const i of idxs) {
        c.moveTo(fd.s[i + 1] * this.scale + this.ox, fd.s[i + 2] * this.scale + this.oy);
        c.lineTo(fd.s[i + 3] * this.scale + this.ox, fd.s[i + 4] * this.scale + this.oy);
      }
      c.stroke();
    }
    for (let i = 0; i < fd.c.length; i += 4) {
      const l = fd.c[i];
      if (!fd.camadas[l]?.vis) continue;
      c.strokeStyle = corAci(fd.camadas[l].cor);
      c.beginPath(); c.arc(fd.c[i + 1] * this.scale + this.ox, fd.c[i + 2] * this.scale + this.oy, fd.c[i + 3] * this.scale, 0, Math.PI * 2); c.stroke();
    }
    if (this.scale > 12) {
      c.textBaseline = 'alphabetic';
      for (const t of fd.t) {
        if (!fd.camadas[t.l]?.vis) continue;
        const px = Math.max(1, t.h * this.scale);
        if (px < 5) continue;
        c.fillStyle = corAci(fd.camadas[t.l].cor);
        c.font = `${px}px "Segoe UI", sans-serif`;
        c.save(); c.translate(t.x * this.scale + this.ox, t.y * this.scale + this.oy); c.rotate((-t.r * Math.PI) / 180); c.fillText(t.t, 0, 0); c.restore();
      }
    }
    c.restore();
  }

  wallPoly(w, esp, ext = true) {
    const a = this.toScreen(w.x1, w.y1), b = this.toScreen(w.x2, w.y2);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const h = (esp * this.scale) / 2;
    const nx = (-(b.y - a.y) / len) * h, ny = ((b.x - a.x) / len) * h;
    const ex = ext ? ((b.x - a.x) / len) * h : 0, ey = ext ? ((b.y - a.y) / len) * h : 0;
    return [[a.x - ex + nx, a.y - ey + ny], [b.x + ex + nx, b.y + ey + ny], [b.x + ex - nx, b.y + ey - ny], [a.x - ex - nx, a.y - ey - ny]];
  }

  drawWall(w, fill, stroke) {
    const c = this.ctx, q = this.wallPoly(w, w.esp);
    c.beginPath();
    q.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = fill; c.fill();
    c.strokeStyle = stroke; c.lineWidth = 1; c.stroke();
  }

  drawViga(v) {
    const c = this.ctx, s = this.store;
    const sel = s.isSelected(v), hov = this.hover?.ref === v;
    const q = this.wallPoly(v, v.b / 100, false);
    c.save();
    c.setLineDash([7, 4]);
    c.strokeStyle = sel ? COR.sel : COR.viga;
    c.lineWidth = sel || hov ? 2 : 1.2;
    c.beginPath(); c.moveTo(...q[0]); c.lineTo(...q[1]); c.moveTo(...q[2]); c.lineTo(...q[3]); c.stroke();
    c.restore();
    const r = s.est?.vigas.find((x) => x.viga === v);
    if (this.scale > 14) {
      const a = this.toScreen((v.x1 + v.x2) / 2, (v.y1 + v.y2) / 2);
      const n = (s.floor.vigas || []).indexOf(v) + 1;
      this.chamada(`V${n} ${v.b}x${v.h}`, a.x, a.y, r && !r.ok ? '#d0453a' : COR.viga, 'est');
    }
    if (sel && s.selection.kind !== 'multi') this.drawDim(v);
  }

  drawLaje(l) {
    const c = this.ctx, s = this.store;
    const a = this.toScreen(l.x1, l.y1), b = this.toScreen(l.x2, l.y2);
    const sel = s.isSelected(l), hov = this.hover?.ref === l;
    c.save();
    c.fillStyle = sel ? 'rgba(29,111,214,.10)' : hov ? 'rgba(185,168,222,.22)' : 'rgba(185,168,222,.13)';
    c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    c.strokeStyle = sel ? COR.sel : COR.laje;
    c.lineWidth = 1;
    c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    // diagonal de laje
    c.setLineDash([3, 4]);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    c.restore();
    if (this.scale > 10) {
      const n = (s.floor.lajes || []).indexOf(l) + 1;
      const r = s.est?.lajes.find((x) => x.laje === l);
      this.tag(`L${n}  h=${l.h} cm`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 8, r && !r.ok ? '#d0453a' : COR.est);
      if (r) this.tag(`${fmt(r.p, 1)} kN/m²`, (a.x + b.x) / 2, (a.y + b.y) / 2 + 8, '#7d6e9c');
    }
  }

  // eletrodutos calculados (árvore por quadro), alimentadores e centro de cargas
  drawEletrodutos() {
    const c = this.ctx, s = this.store, f = this.floor;
    const ele = s.ele;
    if (!ele) return;
    const L = (a, b) => { const A = this.toScreen(a.x, a.y), B = this.toScreen(b.x, b.y); c.moveTo(A.x, A.y); c.lineTo(B.x, A.y); c.lineTo(B.x, B.y); return [A, B]; };
    const ativo = s.activeCircuit?.id;
    const selChave = s.selection?.kind === 'eletroduto' ? s.selection.chave : null;
    const planta = this.tipoPlanta();
    const numerica = s.settings.indicacaoNumerica;
    const indic = numerica ? indicacoesPavimento(ele, f) : null;
    if (planta !== 'alimentacao') for (const sg of ele.segmentos) {
      const aqui = sg.de.pav === f, la = sg.para.pav === f;
      if (!aqui && !la) continue;
      if (!this.passaPlanta(sg)) continue;
      const circs = [...sg.circuitos].filter((id) => this.circuitoNaPlanta(id));
      if (aqui && la) {
        const um = circs.length === 1 ? circs[0] : null;
        const destaque = ativo && sg.circuitos.has(ativo);
        const sel = selChave === chaveSeg(sg);
        c.save();
        c.strokeStyle = sel ? COR.sel : sg.excede ? '#d0453a' : um ? corCircuito(s.project, um) : '#4a5562';
        c.lineWidth = (sel ? 3.4 : destaque ? 2.6 : 1.5) + (sg.manual ? 0.8 : 0);
        // eletroduto pelo piso: tracejado (convenção de projeto)
        if (sg.nivel === 'piso') c.setLineDash([7, 4]);
        if (ativo && !destaque && !sel) c.globalAlpha *= 0.45;
        c.beginPath();
        const [A, B] = L(sg.de, sg.para);
        c.stroke();
        c.restore();
        if ((this.scale > 26 || numerica) && Math.abs(B.x - A.x) + Math.abs(B.y - A.y) > (numerica ? 24 : 46)) {
          const longoX = Math.abs(B.x - A.x) >= Math.abs(B.y - A.y);
          const mx = longoX ? (A.x + B.x) / 2 : B.x, my = longoX ? A.y : (A.y + B.y) / 2;
          if (numerica) this.indicacao(indic.get(sg), mx, my, sg.excede ? '#d0453a' : '#4a5562');
          else {
            const nums = circs.map((id) => s.project.circuitos.find((x) => x.id === id)?.numero).filter(Boolean).sort((x, y) => x - y);
            this.tag(`${nums.join(',')} · Ø${sg.dn}`, mx, my - 9, sg.excede ? '#d0453a' : '#4a5562', 'center', longoX);
            if (this.scale > 45) this.fiacao(mx, my + 1, sg.cont, longoX);
          }
        }
      } else {
        // prumada: chega ou sai deste pavimento
        const n = aqui ? sg.de : sg.para;
        const P = this.toScreen(n.x, n.y);
        const sobe = (aqui ? sg.para.z : sg.de.z) > n.z;
        this.tag(`${sobe ? '↑' : '↓'} Ø${sg.dn}`, P.x + 14, P.y + 12, '#4a5562', 'left');
      }
    }
    if (planta === 'completa' || planta === 'alimentacao') for (const al of ele.alimentadores) {
      const pa = al.de, pd = al.para;
      const fa = s.project.pavimentos.find((pv) => pv.elementos.includes(pa)), fb = s.project.pavimentos.find((pv) => pv.elementos.includes(pd));
      if (fa === f && fb === f) {
        c.save(); c.strokeStyle = '#b05a00'; c.lineWidth = 2.4; c.setLineDash([10, 4]);
        c.beginPath(); const [A, B] = L(pa, pd); c.stroke(); c.restore();
        if (this.scale > 14) this.tag(`Alimentador ${al.condutores} ${String(al.secao ?? '-').replace('.', ',')} mm²`, (A.x + B.x) / 2, A.y - 10, '#b05a00');
      }
    }
    const cc = ele.centros.find((x) => x.pav === f);
    if (s.settings.centroCargas && cc?.x != null) {
      const P = this.toScreen(cc.x, cc.y);
      c.save(); c.strokeStyle = '#d0453a'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(P.x, P.y, 12, 0, Math.PI * 2); c.moveTo(P.x - 18, P.y); c.lineTo(P.x + 18, P.y); c.moveTo(P.x, P.y - 18); c.lineTo(P.x, P.y + 18); c.stroke();
      c.restore();
      this.rotulos = true;
      this.tag(`Centro de cargas · ${Math.round(cc.P)} VA`, P.x + 16, P.y - 16, '#d0453a', 'left');
    }
  }

  // indicação numérica do eletroduto (o conteúdo vai para a legenda de fiação)
  indicacao(n, x, y, col) {
    if (this.rotulos === false || n == null) return;
    const c = this.ctx;
    const r = 8;
    const p = this.livre([[0, -r - 3], [0, r + 3], [-r * 2.4, 0], [r * 2.4, 0], [0, -2 * r - 6], [0, 2 * r + 6]].map(([dx, dy]) => [x + dx - r, y + dy - r, x + dx + r, y + dy + r]));
    const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2;
    c.save();
    c.fillStyle = '#fff'; c.strokeStyle = col; c.lineWidth = 1.1;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = col; c.font = '700 10px "Segoe UI", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(n), cx, cy + 0.5);
    c.restore();
  }

  // escolhe a primeira posição candidata (retângulos de tela) que não colide com o que já foi desenhado
  livre(cands) {
    let esc = cands[0];
    if (this.otimizar) {
      const bate = (r) => this.ocup.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
      esc = cands.find((r) => !bate(r)) || cands[0];
    }
    this.ocup?.push(esc);
    return esc;
  }

  // marcas de fiação no trecho: fases, neutro, terra e retornos
  fiacao(x, y, cont, horizontal) {
    const c = this.ctx;
    const marcas = [...Array(cont.F).fill('F'), ...Array(cont.N).fill('N'), ...Array(cont.T).fill('T'), ...Array(cont.R).fill('R')];
    const passo = 5, ini = -((marcas.length - 1) * passo) / 2;
    c.save();
    c.lineWidth = 1.2;
    marcas.forEach((m, i) => {
      const d = ini + i * passo;
      const px = horizontal ? x + d : x, py = horizontal ? y : y + d;
      c.strokeStyle = { F: '#2b2f33', N: '#1d6fd6', T: '#1f9d55', R: '#c98a00' }[m];
      c.beginPath();
      if (m === 'T') { c.moveTo(px - 4, py + 4); c.lineTo(px + 4, py - 4); c.moveTo(px - 2, py + 6); c.lineTo(px + 6, py - 2); }
      else if (m === 'N') { c.moveTo(px - 4, py + 4); c.lineTo(px + 4, py - 4); c.moveTo(px + 1, py - 4); c.lineTo(px + 4, py - 4); }
      else { c.moveTo(px - 4, py + 4); c.lineTo(px + 4, py - 4); }
      if (m === 'R') { c.moveTo(px + 4, py - 4); c.lineTo(px + 6, py - 1); }
      c.stroke();
    });
    c.restore();
  }

  drawAmbiente(a) {
    const c = this.ctx, s = this.store;
    const A = this.toScreen(a.x1, a.y1), B = this.toScreen(a.x2, a.y2);
    const sel = s.isSelected(a), hov = this.hover?.ref === a;
    if (sel || hov) {
      c.save(); c.fillStyle = sel ? 'rgba(29,111,214,.08)' : 'rgba(29,111,214,.04)';
      c.fillRect(A.x, A.y, B.x - A.x, B.y - A.y);
      c.strokeStyle = sel ? COR.sel : '#9cc0ef'; c.setLineDash([6, 4]); c.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y); c.restore();
    }
    if (this.scale < 12) return;
    const cx = (A.x + B.x) / 2, cy = A.y + Math.min(26, (B.y - A.y) * 0.18);
    c.save();
    c.textAlign = 'center';
    c.fillStyle = '#6b7785';
    c.font = '600 11.5px "Segoe UI", sans-serif';
    c.fillText(a.nome, cx, cy);
    c.font = '10.5px "Segoe UI", sans-serif';
    c.fillText(`${fmt((a.x2 - a.x1) * (a.y2 - a.y1))} m²`, cx, cy + 13);
    c.restore();
    const al = s.ele?.alertas.get(a.id);
    if (al) this.drawAlerta(cx + c.measureText(a.nome).width / 2 + 14, cy - 4, al);
  }

  drawAlerta(x, y, lista) {
    const c = this.ctx;
    const erro = lista.some((a) => a.nivel === 'erro');
    c.save();
    c.globalAlpha = Math.max(c.globalAlpha, 0.85);
    c.fillStyle = erro ? '#d0453a' : '#f2b705';
    c.strokeStyle = erro ? '#8f241b' : '#9a7400';
    c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 6, y + 5); c.lineTo(x - 6, y + 5); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = '700 8px sans-serif'; c.textAlign = 'center'; c.fillText('!', x, y + 4);
    c.restore();
  }

  // trecho de eletroduto deste pavimento sob o ponto (trajeto em L)
  segmentoEm(p, tol = 6 / this.scale) {
    const s = this.store;
    if (!s.ele || !this.vis('ele')) return null;
    for (const sg of s.ele.segmentos) {
      if (sg.de.pav !== this.floor || sg.para.pav !== this.floor) continue;
      if (!this.passaPlanta(sg)) continue;
      const d = Math.min(segDist(p, { x1: sg.de.x, y1: sg.de.y, x2: sg.para.x, y2: sg.de.y }), segDist(p, { x1: sg.para.x, y1: sg.de.y, x2: sg.para.x, y2: sg.para.y }));
      if (d <= tol) return sg;
    }
    return null;
  }

  // plantas por rede (luz e força): o que aparece em cada uma
  tipoPlanta() { return this.store.settings.planta || 'completa'; }
  circuitoNaPlanta(cid) {
    const pl = this.tipoPlanta();
    if (pl === 'completa') return true;
    if (pl === 'alimentacao') return false;
    const t = this.store.project.circuitos.find((c) => c.id === cid)?.tipo;
    return pl === 'iluminacao' ? t === 'ILUM' : t === 'TUG' || t === 'TUE';
  }
  passaPlanta(sg) { return this.tipoPlanta() === 'completa' || [...sg.circuitos].some((id) => this.circuitoNaPlanta(id)); }
  elementoNaPlanta(el) {
    const t = TIPOS[el.tipo];
    if (t?.disc !== 'ele' || this.tipoPlanta() === 'completa' || t.quadro) return true;
    if (el.tipo === 'cp') return this.tipoPlanta() !== 'alimentacao';
    return this.circuitoNaPlanta(el.circuitoId);
  }

  // texto da dica (title) para o ponto sob o mouse: alertas do elemento ou composição do eletroduto
  dicaEm(p) {
    const s = this.store;
    const hit = this.hitBruto(p);
    if (hit && (hit.kind === 'elemento' || hit.kind === 'ambiente')) {
      const al = s.ele?.alertas.get(hit.ref.id);
      if (al?.length) return al.map((a) => `${a.nivel === 'erro' ? '⛔' : '⚠'} ${a.texto}`).join('\n');
      if (hit.kind === 'elemento') {
        const t = TIPOS[hit.ref.tipo];
        const circ = s.project.circuitos.find((ci) => ci.id === hit.ref.circuitoId);
        return `${t.nome}${circ ? ` · ${circ.nome}` : ''}${hit.ref.potencia ? ` · ${hit.ref.potencia} VA` : ''}`;
      }
      return '';
    }
    const sg = this.segmentoEm(p);
    if (!sg) return '';
    const nums = [...sg.circuitos].map((id) => s.project.circuitos.find((x) => x.id === id)?.nome).join(', ');
    const secs = [...new Set(sg.condutores.map((k) => String(k.secao).replace('.', ',')))].join(' / ');
    return `Eletroduto DN ${sg.dn} pelo ${sg.nivel === 'piso' ? 'piso' : 'forro'}${sg.manual ? ' (lançado)' : ''} · ${fmt(sg.comp)} m · ${sg.curvas} curva(s), máx. ${fmt(sg.maxComp, 0)} m · ocupação ${Math.round(sg.ocupacao * 100)}%`
      + `${sg.excede ? '\n⚠ Acima do comprimento máximo entre caixas: insira uma caixa de passagem.' : ''}\n${sg.cont.F} fase · ${sg.cont.N} neutro · ${sg.cont.T} terra · ${sg.cont.R} retorno (${secs} mm²)\n${nums}`;
  }

  drawRedesHid() {
    const s = this.store, c = this.ctx, f = this.floor;
    if (!s.hid) return;
    const desenha = (segs, cor, rot, dash) => {
      for (const sg of segs) {
        // só os trechos deste pavimento (ou que chegam nele)
        if (sg.para.pav !== f && sg.de.pav !== f) continue;
        const a = this.toScreen(sg.de.x, sg.de.y), b = this.toScreen(sg.para.x, sg.para.y);
        c.save();
        c.strokeStyle = cor;
        c.lineWidth = 2;
        if (dash) c.setLineDash(dash);
        c.beginPath();
        // trajeto ortogonal: primeiro em x, depois em y
        c.moveTo(a.x, a.y); c.lineTo(b.x, a.y); c.lineTo(b.x, b.y);
        c.stroke();
        c.restore();
        if (this.scale > 18 && Math.hypot(b.x - a.x, b.y - a.y) > 30) this.tag(rot(sg), (a.x + b.x) / 2, a.y - 9, cor);
        if (sg.de.pav !== sg.para.pav) this.tag(sg.de.pav === f ? '↓' : '↑', b.x + 10, b.y + 10, cor);
      }
    };
    // vista Hidráulico destaca água fria; vista Sanitário destaca esgoto
    const sub = s.settings.subrede;
    const base = c.globalAlpha, rot = this.rotulos;
    const camada = (qual, fn) => {
      const apaga = sub && sub !== qual;
      c.globalAlpha = apaga ? base * 0.3 : base;
      this.rotulos = rot && !apaga;
      fn();
    };
    camada('af', () => desenha(s.hid.af.segmentos, COR.af, (sg) => `Ø${sg.de_mm}`));
    camada('esg', () => desenha(s.hid.esg.segmentos, COR.esg, (sg) => `DN${sg.dn} i=${sg.declividade}%`, [8, 3, 2, 3]));
    c.globalAlpha = base;
    this.rotulos = rot;
  }

  drawSpda() {
    const s = this.store, c = this.ctx;
    const sp = s.spda;
    if (!sp?.ativo || !sp.captacao) return;
    const topo = sp.contorno.pav === this.floor;
    c.save();
    c.strokeStyle = COR.spda;
    if (topo) {
      c.lineWidth = 1.5;
      c.setLineDash([10, 4]);
      c.beginPath();
      for (const l of sp.captacao) { const a = this.toScreen(l.x1, l.y1), b = this.toScreen(l.x2, l.y2); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
      c.stroke();
    }
    if (this.store.project.pavimentos.indexOf(this.floor) === 0) {
      const a = this.toScreen(sp.anel.minX, sp.anel.minY), b = this.toScreen(sp.anel.maxX, sp.anel.maxY);
      c.setLineDash([2, 4]);
      c.lineWidth = 1.2;
      c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    c.setLineDash([]);
    for (const d of sp.descidas) {
      const p = this.toScreen(d.x, d.y);
      c.fillStyle = COR.spda;
      c.beginPath(); c.arc(p.x, p.y, 4.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(p.x, p.y, 1.8, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    if (topo && this.scale > 8) {
      const a = this.toScreen(sp.contorno.maxX, sp.contorno.minY);
      this.tag(`SPDA nível ${sp.nivel} · malha ${sp.malha}×${sp.malha} m`, a.x, a.y - 16, COR.spda, 'right');
    }
  }

  drawDim(w) {
    const a = this.toScreen(w.x1, w.y1), b = this.toScreen(w.x2, w.y2);
    this.tag(fmt(Math.hypot(w.x2 - w.x1, w.y2 - w.y1)) + ' m', (a.x + b.x) / 2, (a.y + b.y) / 2 - 14, COR.sel);
  }

  drawElement(el) {
    const s = this.store;
    const t = TIPOS[el.tipo];
    const p = this.toScreen(el.x, el.y);
    const col = t.disc === 'hid' ? COR.hid : t.disc === 'est' ? COR.est : t.quadro || el.tipo === 'cp' ? '#34404c' : corCircuito(s.project, el.circuitoId);
    const sel = s.isSelected(el);
    const hov = this.hover && this.hover.ref === el;
    if (sel || hov) {
      const c = this.ctx;
      c.save();
      c.fillStyle = sel ? 'rgba(29,111,214,.16)' : 'rgba(29,111,214,.08)';
      c.strokeStyle = sel ? COR.sel : '#9cc0ef';
      const rr = el.tipo === 'pilar' ? Math.max(el.b, el.h) / 200 * this.scale + 6 : this.symSize() + 7;
      c.beginPath(); c.arc(p.x, p.y, rr, 0, Math.PI * 2); c.fill(); c.stroke();
      c.restore();
    }
    this.drawSymbol(el.tipo, p, col, el);
    let tag;
    if (t.disc === 'ele') {
      const circ = s.project.circuitos.find((ci) => ci.id === el.circuitoId);
      if (t.quadro || el.tipo === 'cp') tag = s.nomeQuadro ? s.nomeQuadro(el) : t.sigla;
      else if (!circ) tag = '?';
      else if (t.comandada) tag = `${circ.numero}${el.comando || '-'} · ${el.potencia}W`;
      else if (COMANDOS.includes(el.tipo)) tag = `${circ.numero} ${(el.comandos || []).join('')}`.trim();
      else if (el.tipo === 'tue') tag = `${circ.numero} · ${el.potencia} W`;
      else if (el.tipo === 'tug') tag = `${circ.numero}${el.potencia > 100 ? ` · ${el.potencia}VA` : ''}${el.dupla ? ' ×2' : ''}`;
      else tag = `${circ.numero}`;
      this.chamada(tag, p.x, p.y, circ || t.quadro || el.tipo === 'cp' ? col : '#d0453a', 'ele');
      const al = s.ele?.alertas.get(el.id);
      if (al) this.drawAlerta(p.x - this.symSize() - 4, p.y - this.symSize() - 2, al);
    } else if (t.disc === 'hid') {
      const pt = s.hid?.af.pontos.find((x) => x.no.el === el);
      tag = t.sigla + (pt ? ` ${fmt(pt.pressao, 1)} mca` : '');
      this.chamada(tag, p.x, p.y, pt && pt.pressao < 1 ? '#d0453a' : col, 'hid');
    } else if (el.tipo === 'pilar') {
      const n = s.floor.elementos.filter((e) => e.tipo === 'pilar').indexOf(el) + 1;
      const r = s.est?.pilares.find((x) => x.pilar === el);
      if (this.scale > 12) this.chamada(`P${n} ${el.b}x${el.h}`, p.x, p.y, r && !r.ok ? '#d0453a' : col, 'est');
    }
  }

  symSize() { return Math.max(5, Math.min(11, this.scale * 0.18)); }

  drawSymbol(tipo, p, col, el = {}) {
    const c = this.ctx, r = this.symSize();
    c.save();
    c.lineWidth = 1.6;
    c.strokeStyle = col;
    c.fillStyle = '#fff';
    c.beginPath();
    const t = TIPOS[tipo];
    if (tipo === 'luz') {
      c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      const d = r * 0.7;
      c.beginPath(); c.moveTo(p.x - d, p.y - d); c.lineTo(p.x + d, p.y + d); c.moveTo(p.x + d, p.y - d); c.lineTo(p.x - d, p.y + d); c.stroke();
    } else if (tipo === 'tug' || tipo === 'tue') {
      c.moveTo(p.x, p.y - r); c.lineTo(p.x + r, p.y + r * 0.8); c.lineTo(p.x - r, p.y + r * 0.8); c.closePath();
      if (tipo === 'tue') c.fillStyle = col;
      c.fill(); c.stroke();
    } else if (tipo === 'interruptor') {
      c.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x + r * 0.4, p.y - r * 0.4); c.lineTo(p.x + r * 1.2, p.y - r * 1.2); c.stroke();
    } else if (tipo === 'arandela') {
      c.arc(p.x, p.y, r * 0.85, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x - r * 0.5, p.y - r * 0.6); c.lineTo(p.x + r * 0.5, p.y); c.moveTo(p.x + r * 0.5, p.y - r * 0.6); c.lineTo(p.x - r * 0.5, p.y); c.stroke();
    } else if (tipo === 'ventilador') {
      c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath();
      for (let k = 0; k < 3; k++) { const a = (k * 2 * Math.PI) / 3; c.moveTo(p.x, p.y); c.quadraticCurveTo(p.x + Math.cos(a + 0.6) * r, p.y + Math.sin(a + 0.6) * r, p.x + Math.cos(a) * r * 0.9, p.y + Math.sin(a) * r * 0.9); }
      c.stroke();
    } else if (tipo === 'paralelo' || tipo === 'intermediario' || tipo === 'dimmer') {
      c.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath();
      c.moveTo(p.x + r * 0.4, p.y - r * 0.4); c.lineTo(p.x + r * 1.2, p.y - r * 1.2);
      if (tipo !== 'dimmer') { c.moveTo(p.x - r * 0.4, p.y + r * 0.4); c.lineTo(p.x - r * 1.2, p.y + r * 1.2); }
      if (tipo === 'intermediario') { c.moveTo(p.x - r * 0.4, p.y - r * 0.4); c.lineTo(p.x - r * 1.2, p.y - r * 1.2); c.moveTo(p.x + r * 0.4, p.y + r * 0.4); c.lineTo(p.x + r * 1.2, p.y + r * 1.2); }
      if (tipo === 'dimmer') { c.moveTo(p.x + r * 0.8, p.y - r * 1.2); c.lineTo(p.x + r * 1.2, p.y - r * 1.2); c.lineTo(p.x + r * 1.2, p.y - r * 0.8); }
      c.stroke();
    } else if (tipo === 'sensor') {
      c.arc(p.x, p.y, r * 0.8, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.arc(p.x, p.y, r * 1.3, -2.4, -0.7); c.moveTo(p.x + Math.cos(2.4) * r * 1.3, p.y + Math.sin(2.4) * r * 1.3); c.arc(p.x, p.y, r * 1.3, 2.4, 0.7, true); c.stroke();
      c.fillStyle = col; c.font = `700 ${Math.max(6, r * 0.7)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SP', p.x, p.y + 0.5);
    } else if (tipo === 'campainha') {
      c.moveTo(p.x - r, p.y + r * 0.5); c.quadraticCurveTo(p.x - r, p.y - r, p.x, p.y - r); c.quadraticCurveTo(p.x + r, p.y - r, p.x + r, p.y + r * 0.5); c.closePath(); c.fill(); c.stroke();
    } else if (tipo === 'pulsador') {
      c.rect(p.x - r * 0.6, p.y - r * 0.6, r * 1.2, r * 1.2); c.fill(); c.stroke();
      c.beginPath(); c.fillStyle = col; c.arc(p.x, p.y, r * 0.25, 0, Math.PI * 2); c.fill();
    } else if (tipo === 'cp') {
      c.rect(p.x - r * 0.8, p.y - r * 0.8, r * 1.6, r * 1.6); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x - r * 0.8, p.y); c.lineTo(p.x + r * 0.8, p.y); c.stroke();
    } else if (tipo === 'qm' || tipo === 'es') {
      c.rect(p.x - r * 1.2, p.y - r * 0.8, r * 2.4, r * 1.6); c.fill(); c.stroke();
      c.fillStyle = col; c.font = `700 ${Math.max(6, r * 0.8)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(tipo === 'qm' ? 'M' : 'ES', p.x, p.y + 0.5);
    } else if (tipo === 'qd') {
      c.rect(p.x - r * 1.2, p.y - r * 0.7, r * 2.4, r * 1.4); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x - r * 1.2, p.y - r * 0.7); c.lineTo(p.x + r * 1.2, p.y + r * 0.7); c.lineTo(p.x - r * 1.2, p.y + r * 0.7); c.closePath();
      c.fillStyle = col; c.fill();
    } else if (tipo === 'pilar') {
      const bw = Math.max(4, ((el.b || 20) / 100) * this.scale), bh = Math.max(4, ((el.h || 30) / 100) * this.scale);
      c.fillStyle = col;
      c.save(); c.globalAlpha *= 0.85; c.fillRect(p.x - bw / 2, p.y - bh / 2, bw, bh); c.restore();
      c.strokeRect(p.x - bw / 2, p.y - bh / 2, bw, bh);
    } else if (tipo === 'reservatorio' || tipo === 'ci') {
      const k = r * 1.3;
      c.rect(p.x - k, p.y - k, 2 * k, 2 * k); c.fill(); c.stroke();
      c.beginPath();
      if (tipo === 'ci') { c.moveTo(p.x - k, p.y - k); c.lineTo(p.x + k, p.y + k); c.moveTo(p.x + k, p.y - k); c.lineTo(p.x - k, p.y + k); }
      else { c.moveTo(p.x - k, p.y); c.lineTo(p.x + k, p.y); }
      c.stroke();
    } else if (t?.disc === 'hid') {
      c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = col;
      c.font = `700 ${Math.max(6, r * 0.75)}px "Segoe UI", sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(t.sigla.slice(0, 3), p.x, p.y + 0.5);
    }
    c.restore();
  }

  drawCursor() {
    const c = this.ctx, p = this.toScreen(this.mouse.x, this.mouse.y);
    c.save();
    c.strokeStyle = 'rgba(29,111,214,.6)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(p.x - 10, p.y); c.lineTo(p.x + 10, p.y); c.moveTo(p.x, p.y - 10); c.lineTo(p.x, p.y + 10); c.stroke();
    c.strokeRect(p.x - 3, p.y - 3, 6, 6);
    c.restore();
  }

  // linha de chamada: estilo configurável por disciplina (simples, círculo, retângulo)
  chamada(texto, x, y, col, disc) {
    if (this.rotulos === false) return;
    const estilo = this.store.settings.chamada?.[disc] || 'simples';
    const c = this.ctx;
    const off = this.symSize() + 6;
    c.save();
    c.font = '600 11px "Segoe UI", system-ui, sans-serif';
    const w = c.measureText(texto).width;
    c.restore();
    // quadrantes candidatos para o texto (otimização das indicações)
    const cands = [[1, -1], [1, 1], [-1, -1], [-1, 1], [1.9, -1.9], [-1.9, -1.9], [1.9, 1.9], [-1.9, 1.9]].map(([sx, sy]) => {
      const tx = sx > 0 ? x + off * sx + 8 : x + off * sx - 8 - w, ty = y + (off + 6) * sy;
      return [tx - 5, ty - 9, tx + w + 5, ty + 9, sx, sy];
    });
    const esc = this.livre(cands);
    const tx = esc[0] + 5, ty = esc[1] + 9, sx = esc[4] ?? 1, sy = esc[5] ?? -1;
    c.save();
    c.strokeStyle = col;
    c.lineWidth = 0.8;
    c.globalAlpha *= 0.8;
    const ax = sx > 0 ? tx - 3 : tx + w + 3;
    c.beginPath(); c.moveTo(x + this.symSize() * 0.7 * Math.sign(sx), y + this.symSize() * 0.7 * Math.sign(sy)); c.lineTo(ax, ty + 1); c.stroke();
    c.restore();
    c.save();
    c.font = '600 11px "Segoe UI", system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.strokeStyle = col;
    c.lineWidth = 1;
    if (estilo === 'circulo') {
      const rr = Math.max(9, w / 2 + 5);
      c.beginPath(); c.ellipse(tx + w / 2, ty, rr, 9, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    } else if (estilo === 'retangulo') {
      c.fillRect(tx - 4, ty - 8, w + 8, 16); c.strokeRect(tx - 4, ty - 8, w + 8, 16);
    } else {
      c.fillRect(tx - 2, ty - 7, w + 4, 14);
      c.beginPath(); c.moveTo(tx - 3, ty + 7); c.lineTo(tx + w + 2, ty + 7); c.stroke();
    }
    c.fillStyle = col;
    c.textBaseline = 'middle';
    c.fillText(texto, tx, ty);
    c.restore();
  }

  tag(t, x, y, col, align = 'center', horizontal = true) {
    if (this.rotulos === false) return;
    const c = this.ctx;
    c.save();
    c.font = '600 11px "Segoe UI", system-ui, sans-serif';
    c.textAlign = align;
    c.textBaseline = 'middle';
    const w = c.measureText(t).width;
    const bx0 = align === 'left' ? x - 2 : align === 'right' ? x - w - 3 : x - w / 2 - 3;
    // posições alternativas: acima/abaixo (trecho horizontal) ou ao lado (vertical)
    const desl = horizontal ? [[0, 0], [0, 19], [0, -15], [0, 34], [w * 0.6, 0], [-w * 0.6, 0]] : [[0, 0], [w / 2 + 10, 9], [-w / 2 - 10, 9], [0, -16], [0, 16]];
    const [r0] = [this.livre(desl.map(([dx, dy]) => [bx0 + dx, y + dy - 7, bx0 + dx + w + 6, y + dy + 7]))];
    const bx = r0[0];
    x += bx - bx0; y = r0[1] + 7;
    c.fillStyle = 'rgba(255,255,255,.88)';
    c.fillRect(bx, y - 7, w + 6, 14);
    c.fillStyle = col;
    c.fillText(t, align === 'left' ? x + 1 : x, y);
    c.restore();
  }
}

export function segDist(p, w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / l2));
  return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
}

function segRect(s, minX, minY, maxX, maxY) {
  // o segmento toca o retângulo?
  const dentro = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (dentro(s.x1, s.y1) || dentro(s.x2, s.y2)) return true;
  const lados = [[minX, minY, maxX, minY], [maxX, minY, maxX, maxY], [maxX, maxY, minX, maxY], [minX, maxY, minX, minY]];
  return lados.some(([a, b, c, d]) => cruza(s.x1, s.y1, s.x2, s.y2, a, b, c, d));
}

function cruza(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (!d) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export const fmt = (n, d = 2) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// planta de um pavimento renderizada fora da tela, em escala real, para as pranchas.
// pxmm: resolução (px por mm de papel); k: ampliação de símbolos e textos (k px de saída por px de tela)
export function renderizarPlanta(store, pav, { escala = 50, pxmm = 8, k = 2.1, planta = 'completa', numerica = false, fundo = true, folga = 0.9 } = {}) {
  const pts = [];
  for (const w of pav.paredes) pts.push([w.x1, w.y1], [w.x2, w.y2]);
  for (const e of pav.elementos) pts.push([e.x, e.y]);
  for (const a of pav.ambientes || []) pts.push([a.x1, a.y1], [a.x2, a.y2]);
  if (fundo && pav.fundo) for (let i = 0; i < pav.fundo.s.length; i += 5) pts.push([pav.fundo.s[i + 1], pav.fundo.s[i + 2]], [pav.fundo.s[i + 3], pav.fundo.s[i + 4]]);
  if (!pts.length) pts.push([0, 0], [5, 5]);
  const minX = Math.min(...pts.map((p) => p[0])) - folga, maxX = Math.max(...pts.map((p) => p[0])) + folga;
  const minY = Math.min(...pts.map((p) => p[1])) - folga, maxY = Math.max(...pts.map((p) => p[1])) + folga;
  const wmm = ((maxX - minX) * 1000) / escala, hmm = ((maxY - minY) * 1000) / escala;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(wmm * pxmm));
  cv.height = Math.max(1, Math.round(hmm * pxmm));
  const pl = Object.create(Plan2D.prototype);
  // prancha elétrica: arquitetura e elétrico; estrutura esmaecida e sem rótulos; hidráulica e SPDA ocultas
  const settings = { ...store.settings, grid: false, foco: 'ele', planta, indicacaoNumerica: numerica, centroCargas: false, vis: { ...store.settings.vis, hid: false, spda: false, fundo: fundo && store.settings.vis.fundo !== false } };
  pl.store = Object.create(store, {
    floor: { get: () => pav }, settings: { value: settings }, selection: { value: null },
    activeCircuit: { get: () => null }, activeCircuitId: { value: null }, isSelected: { value: () => false }, onRender: { value: null },
  });
  Object.assign(pl, { cv, ctx: cv.getContext('2d'), tool: 'selecionar', mouse: { inside: false, x: 0, y: 0 }, start: null, box: null, hover: null, drag: null, impressao: true });
  pl.ctx.setTransform(k, 0, 0, k, 0, 0);
  pl.w = cv.width / k;
  pl.h = cv.height / k;
  pl.scale = ((1000 / escala) * pxmm) / k;
  pl.ox = -minX * pl.scale;
  pl.oy = -minY * pl.scale;
  pl.render();
  return { src: cv.toDataURL('image/png'), wmm, hmm };
}
