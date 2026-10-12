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
const GRUPO_TIPO = { luz: 'ILUM', interruptor: 'ILUM', tug: 'TUG', tue: 'TUE' };

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
        if (t.disc === 'ele') Object.assign(nova, { potencia: t.potencia, circuitoId: circ });
        if (this.tool === 'pilar') Object.assign(nova, { b: t.b, h: t.h });
        this.floor.elementos.push(nova);
      });
      if (grupo && !circ) s.log(`${t.sigla} inserido sem circuito: o circuito ativo não é do tipo ${grupo}.`, 'warn');
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
    this.hover = ['selecionar', 'apagar', 'atribuir'].includes(this.tool) ? this.hitTest(p.raw) : null;
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
    if (f === 'arq') return it.kind === 'parede';
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
    if (this.vis('est')) for (const v of f.vigas || []) {
      const d = segDist(p, v);
      if (d < v.b / 200 + tolPx && d < bd) { best = { kind: 'viga', ref: v }; bd = d; }
    }
    if (this.vis('arq')) for (const w of f.paredes) {
      const d = segDist(p, w);
      if (d < w.esp / 2 + tolPx && d < bd) { best = { kind: 'parede', ref: w }; bd = d; }
    }
    if (best) return best;
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
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, this.w, this.h);
    if (s.settings.grid) this.drawGrid();
    if (f.fundo && this.vis('fundo')) this.drawFundo(f.fundo);
    this.drawAxes();

    const idx = s.project.pavimentos.indexOf(f);
    const below = s.project.pavimentos[idx - 1];
    if (below && this.vis('arq')) for (const w of below.paredes) this.drawWall(w, '#eef0f3', '#d9dde2');

    this.foco('est');
    if (this.vis('est')) for (const l of f.lajes || []) this.drawLaje(l);
    this.foco('arq');
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
    if (this.vis('ele')) this.drawFiacao();

    this.foco('arq');
    if (this.vis('arq')) for (const d of f.desenho || []) this.drawAnotacao(d);
    for (const el of f.elementos) {
      const d = TIPOS[el.tipo]?.disc;
      if (!this.vis(d)) continue;
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

  drawFiacao() {
    const c = this.ctx, s = this.store;
    for (const r of s.results) {
      if (!r.qd || !this.floor.elementos.includes(r.qd)) continue;
      const col = corCircuito(s.project, r.circuito.id);
      const active = s.activeCircuit && s.activeCircuit.id === r.circuito.id;
      c.save();
      c.strokeStyle = col;
      c.globalAlpha *= active ? 0.95 : 0.55;
      c.lineWidth = active ? 2 : 1.3;
      c.setLineDash(r.circuito.tipo === 'ILUM' ? [6, 4] : []);
      c.beginPath();
      let prev = this.toScreen(r.qd.x, r.qd.y);
      c.moveTo(prev.x, prev.y);
      for (const e of r.rota) {
        if (!this.floor.elementos.includes(e)) continue;
        const q = this.toScreen(e.x, e.y);
        const mx = (prev.x + q.x) / 2, my = (prev.y + q.y) / 2;
        const nx = -(q.y - prev.y) * 0.12, ny = (q.x - prev.x) * 0.12;
        c.quadraticCurveTo(mx + nx, my + ny, q.x, q.y);
        prev = q;
      }
      c.stroke();
      c.restore();
    }
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
    const col = t.disc === 'hid' ? COR.hid : t.disc === 'est' ? COR.est : el.tipo === 'qd' ? '#34404c' : corCircuito(s.project, el.circuitoId);
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
      tag = el.tipo === 'qd' ? 'QD' : circ ? circ.numero + (el.tipo === 'tue' ? ` · ${el.potencia} W` : '') : '?';
      this.chamada(tag, p.x, p.y, el.circuitoId || el.tipo === 'qd' ? col : '#d0453a', 'ele');
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
    const tx = x + off + 8, ty = y - off - 6;
    c.save();
    c.strokeStyle = col;
    c.lineWidth = 0.8;
    c.globalAlpha *= 0.8;
    c.beginPath(); c.moveTo(x + this.symSize() * 0.7, y - this.symSize() * 0.7); c.lineTo(tx - 3, ty + 1); c.stroke();
    c.restore();
    c.save();
    c.font = '600 11px "Segoe UI", system-ui, sans-serif';
    const w = c.measureText(texto).width;
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

  tag(t, x, y, col, align = 'center') {
    if (this.rotulos === false) return;
    const c = this.ctx;
    c.save();
    c.font = '600 11px "Segoe UI", system-ui, sans-serif';
    c.textAlign = align;
    c.textBaseline = 'middle';
    const w = c.measureText(t).width;
    const bx = align === 'left' ? x - 2 : align === 'right' ? x - w - 3 : x - w / 2 - 3;
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
