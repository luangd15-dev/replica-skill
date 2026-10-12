import { TIPOS } from './eletrico.js';

export const CORES_CIRCUITO = ['#1d6fd6', '#d0453a', '#1f9d55', '#c98a00', '#8e44ad', '#0f8c9c', '#d35400', '#5b6b7d', '#b0306b', '#3f7d20'];
export const corCircuito = (projeto, id) => {
  const i = projeto.circuitos.findIndex((c) => c.id === id);
  return i < 0 ? '#8a96a3' : CORES_CIRCUITO[i % CORES_CIRCUITO.length];
};

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
    this.wallStart = null;
    this.drag = null;
    this.pan = null;
    this.hover = null;
    this.space = false;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', () => this.finishWall());
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { this.space = true; e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
  }

  get floor() { return this.store.floor; }

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
    // pontas de parede têm prioridade sobre a grade
    const tol = 10 / this.scale;
    for (const w of this.floor.paredes) {
      for (const q of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
        if (Math.hypot(q.x - p.x, q.y - p.y) < tol) return { ...q };
      }
    }
    const g = 0.25;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  setTool(t) {
    this.tool = t;
    this.wallStart = null;
    this.render();
  }

  hint() {
    const c = this.store.activeCircuit;
    const H = {
      selecionar: 'Clique para selecionar. Arraste para mover. Del apaga. Roda do mouse: zoom. Botão do meio/direito ou Espaço: deslocar.',
      parede: this.wallStart ? 'Clique o próximo ponto. Duplo clique, Esc ou botão direito encerra.' : 'Clique o ponto inicial da parede.',
      apagar: 'Clique num elemento ou parede para apagar.',
      atribuir: c ? `Clique nos pontos para atribuir ao circuito ${c.nome}.` : 'Crie um circuito primeiro.',
    };
    if (TIPOS[this.tool]) return `Clique para inserir: ${TIPOS[this.tool].nome}.` + (this.tool !== 'qd' && c ? ` Circuito ativo: ${c.nome}.` : '');
    return H[this.tool] || '';
  }

  // ---------- eventos ----------
  onWheel(e) {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.min(400, Math.max(4, this.scale * f));
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
    if (this.tool === 'parede' && this.wallStart && this.store.settings.orto) {
      const dx = Math.abs(p.x - this.wallStart.x), dy = Math.abs(p.y - this.wallStart.y);
      p = dx >= dy ? { x: p.x, y: this.wallStart.y } : { x: this.wallStart.x, y: p.y };
    }
    return { sx, sy, inside: sx >= 0 && sy >= 0 && sx <= r.width && sy <= r.height, ...p };
  }

  onDown(e) {
    const p = this.pointFrom(e);
    if (e.button === 1 || (e.button === 0 && this.space)) {
      this.pan = { sx: p.sx, sy: p.sy, ox: this.ox, oy: this.oy };
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      if (this.tool === 'parede' && this.wallStart) return this.finishWall();
      this.pan = { sx: p.sx, sy: p.sy, ox: this.ox, oy: this.oy, right: true, moved: false };
      return;
    }
    if (e.button !== 0) return;
    const s = this.store;

    if (this.tool === 'selecionar') {
      const hit = this.hitTest(p);
      s.select(hit);
      if (hit && hit.kind === 'elemento') this.drag = { el: hit.ref, x0: hit.ref.x, y0: hit.ref.y, moved: false };
      return;
    }
    if (this.tool === 'parede') {
      if (!this.wallStart) { this.wallStart = { x: p.x, y: p.y }; this.render(); return; }
      if (p.x === this.wallStart.x && p.y === this.wallStart.y) return;
      const a = this.wallStart;
      s.commit('Parede', () => {
        this.floor.paredes.push({ id: s.uid('P'), x1: a.x, y1: a.y, x2: p.x, y2: p.y, esp: 0.15 });
      });
      this.wallStart = { x: p.x, y: p.y };
      return;
    }
    if (this.tool === 'apagar') {
      const hit = this.hitTest(p);
      if (hit) s.remove(hit);
      return;
    }
    if (this.tool === 'atribuir') {
      const hit = this.hitTest(p);
      const c = s.activeCircuit;
      if (!c) return s.log('Crie um circuito antes de atribuir.', 'warn');
      if (hit && hit.kind === 'elemento' && hit.ref.tipo !== 'qd') {
        s.commit('Atribuir circuito', () => { hit.ref.circuitoId = c.id; });
        s.log(`${TIPOS[hit.ref.tipo].sigla} atribuído ao ${c.nome}.`);
      }
      return;
    }
    if (TIPOS[this.tool]) {
      const t = TIPOS[this.tool];
      const c = s.activeCircuit;
      const circ = this.tool !== 'qd' && c && (c.tipo === GRUPO_TIPO[this.tool]) ? c.id : null;
      let nova = null;
      s.commit(t.nome, () => {
        nova = { id: s.uid('E'), tipo: this.tool, x: p.x, y: p.y, potencia: t.potencia, altura: t.altura, circuitoId: circ, descricao: '' };
        this.floor.elementos.push(nova);
      });
      if (this.tool !== 'qd' && !circ) s.log(`${t.sigla} inserido sem circuito: o circuito ativo não é do tipo ${GRUPO_TIPO[this.tool]}.`, 'warn');
      s.select({ kind: 'elemento', ref: nova }, true);
    }
  }

  onMove(e) {
    const p = this.pointFrom(e);
    this.mouse = p;
    if (this.pan) {
      this.ox = this.pan.ox + (p.sx - this.pan.sx);
      this.oy = this.pan.oy + (p.sy - this.pan.sy);
      this.pan.moved = true;
      this.render();
      return;
    }
    if (this.drag) {
      if (!this.drag.moved) { this.store.snapshot(); this.drag.moved = true; }
      this.drag.el.x = p.x;
      this.drag.el.y = p.y;
      this.store.changed(false);
      return;
    }
    if (!p.inside) return;
    this.store.setCoord(p.x, p.y);
    this.hover = this.tool === 'selecionar' || this.tool === 'apagar' || this.tool === 'atribuir' ? this.hitTest(p) : null;
    this.render();
  }

  onUp() {
    if (this.drag) {
      if (this.drag.moved) this.store.changed(true, 'Mover');
      this.drag = null;
    }
    this.pan = null;
  }

  finishWall() {
    if (this.wallStart) { this.wallStart = null; this.render(); this.store.refreshHint(); }
  }

  cancel() {
    if (this.wallStart) return this.finishWall();
    this.store.setTool('selecionar');
  }

  hitTest(p) {
    const tolPx = 9 / this.scale;
    let best = null, bd = Infinity;
    for (const el of this.floor.elementos) {
      const d = Math.hypot(el.x - p.x, el.y - p.y);
      if (d < Math.max(0.25, tolPx * 1.5) && d < bd) { best = { kind: 'elemento', ref: el }; bd = d; }
    }
    if (best) return best;
    for (const w of this.floor.paredes) {
      const d = segDist(p, w);
      if (d < w.esp / 2 + tolPx && d < bd) { best = { kind: 'parede', ref: w }; bd = d; }
    }
    return best;
  }

  zoomExtents() {
    if (!this.w || !this.h) { this.pendingFit = true; return; }
    const pts = [];
    for (const w of this.floor.paredes) pts.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    for (const e of this.floor.elementos) pts.push(e);
    if (!pts.length) { this.scale = 42; this.ox = 80; this.oy = 80; return this.render(); }
    const minX = Math.min(...pts.map((q) => q.x)), maxX = Math.max(...pts.map((q) => q.x));
    const minY = Math.min(...pts.map((q) => q.y)), maxY = Math.max(...pts.map((q) => q.y));
    const pad = 60;
    this.scale = Math.min((this.w - pad * 2) / Math.max(1, maxX - minX), (this.h - pad * 2) / Math.max(1, maxY - minY), 200);
    this.ox = (this.w - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oy = (this.h - (maxY - minY) * this.scale) / 2 - minY * this.scale;
    this.render();
  }

  // ---------- desenho ----------
  render() {
    if (!this.w) return;
    const c = this.ctx, s = this.store;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, this.w, this.h);
    if (s.settings.grid) this.drawGrid();
    this.drawAxes();

    // pavimento de baixo em cinza claro, como referência
    const idx = s.project.pavimentos.indexOf(this.floor);
    const below = s.project.pavimentos[idx - 1];
    if (below) for (const w of below.paredes) this.drawWall(w, '#eef0f3', '#d9dde2');

    for (const w of this.floor.paredes) {
      const sel = s.selection && s.selection.ref === w;
      const hov = this.hover && this.hover.ref === w;
      this.drawWall(w, sel ? '#cfe0f8' : hov ? '#dfe7f1' : '#c4cad1', sel ? '#1d6fd6' : '#4a5562');
      if (sel) this.drawWallDim(w);
    }

    // fiação: rotas dos circuitos
    for (const r of s.results) {
      if (!r.qd || !this.floor.elementos.includes(r.qd)) continue;
      const col = corCircuito(s.project, r.circuito.id);
      const active = s.activeCircuit && s.activeCircuit.id === r.circuito.id;
      c.save();
      c.strokeStyle = col;
      c.globalAlpha = active ? 0.95 : 0.55;
      c.lineWidth = active ? 2 : 1.3;
      c.setLineDash(r.circuito.tipo === 'ILUM' ? [6, 4] : []);
      c.beginPath();
      let prev = this.toScreen(r.qd.x, r.qd.y);
      c.moveTo(prev.x, prev.y);
      for (const e of r.rota) {
        const q = this.toScreen(e.x, e.y);
        // trecho em arco suave, como a fiação costuma ser desenhada em planta
        const mx = (prev.x + q.x) / 2, my = (prev.y + q.y) / 2;
        const nx = -(q.y - prev.y) * 0.12, ny = (q.x - prev.x) * 0.12;
        c.quadraticCurveTo(mx + nx, my + ny, q.x, q.y);
        prev = q;
      }
      c.stroke();
      c.restore();
    }

    for (const el of this.floor.elementos) this.drawElement(el);

    // pré-visualização
    if (this.tool === 'parede' && this.wallStart) {
      const a = this.toScreen(this.wallStart.x, this.wallStart.y), b = this.toScreen(this.mouse.x, this.mouse.y);
      c.save();
      c.strokeStyle = '#1d6fd6';
      c.lineWidth = Math.max(2, 0.15 * this.scale);
      c.globalAlpha = 0.45;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.restore();
      const len = Math.hypot(this.mouse.x - this.wallStart.x, this.mouse.y - this.wallStart.y);
      this.label(fmt(len) + ' m', (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, '#1d6fd6');
    } else if (TIPOS[this.tool] && this.mouse.inside) {
      c.save(); c.globalAlpha = 0.5;
      this.drawSymbol(this.tool, this.toScreen(this.mouse.x, this.mouse.y), '#1d6fd6');
      c.restore();
    }
    if (this.tool !== 'selecionar' && this.mouse.inside) this.drawCursor();
  }

  drawGrid() {
    const c = this.ctx;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    const minor = this.scale > 60 ? 0.25 : this.scale > 25 ? 0.5 : this.scale > 10 ? 1 : 5;
    const major = minor * (minor >= 1 ? 5 : 1 / minor);
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

  drawWall(w, fill, stroke) {
    const c = this.ctx;
    const a = this.toScreen(w.x1, w.y1), b = this.toScreen(w.x2, w.y2);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const h = (w.esp * this.scale) / 2;
    const nx = (-(b.y - a.y) / len) * h, ny = ((b.x - a.x) / len) * h;
    const ex = ((b.x - a.x) / len) * h, ey = ((b.y - a.y) / len) * h; // prolonga meia espessura para fechar cantos
    c.beginPath();
    c.moveTo(a.x - ex + nx, a.y - ey + ny);
    c.lineTo(b.x + ex + nx, b.y + ey + ny);
    c.lineTo(b.x + ex - nx, b.y + ey - ny);
    c.lineTo(a.x - ex - nx, a.y - ey - ny);
    c.closePath();
    c.fillStyle = fill; c.fill();
    c.strokeStyle = stroke; c.lineWidth = 1; c.stroke();
  }

  drawWallDim(w) {
    const a = this.toScreen(w.x1, w.y1), b = this.toScreen(w.x2, w.y2);
    this.label(fmt(Math.hypot(w.x2 - w.x1, w.y2 - w.y1)) + ' m', (a.x + b.x) / 2, (a.y + b.y) / 2 - 14, '#1d6fd6');
  }

  drawElement(el) {
    const s = this.store;
    const p = this.toScreen(el.x, el.y);
    const col = el.tipo === 'qd' ? '#34404c' : corCircuito(s.project, el.circuitoId);
    const sel = s.selection && s.selection.ref === el;
    const hov = this.hover && this.hover.ref === el;
    if (sel || hov) {
      const c = this.ctx;
      c.save();
      c.fillStyle = sel ? 'rgba(29,111,214,.16)' : 'rgba(29,111,214,.08)';
      c.strokeStyle = sel ? '#1d6fd6' : '#9cc0ef';
      c.beginPath(); c.arc(p.x, p.y, this.symSize() + 7, 0, Math.PI * 2); c.fill(); c.stroke();
      c.restore();
    }
    this.drawSymbol(el.tipo, p, col);
    const circ = s.project.circuitos.find((ci) => ci.id === el.circuitoId);
    const tag = el.tipo === 'qd' ? 'QD' : circ ? circ.numero + (el.tipo === 'tue' ? ` · ${el.potencia} W` : '') : '?';
    this.label(tag, p.x + this.symSize() + 4, p.y - this.symSize() - 2, el.circuitoId || el.tipo === 'qd' ? col : '#d0453a', 'left');
  }

  symSize() { return Math.max(5, Math.min(11, this.scale * 0.18)); }

  drawSymbol(tipo, p, col) {
    const c = this.ctx, r = this.symSize();
    c.save();
    c.lineWidth = 1.6;
    c.strokeStyle = col;
    c.fillStyle = '#fff';
    c.beginPath();
    if (tipo === 'luz') {
      c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      const d = r * 0.7;
      c.beginPath(); c.moveTo(p.x - d, p.y - d); c.lineTo(p.x + d, p.y + d); c.moveTo(p.x + d, p.y - d); c.lineTo(p.x - d, p.y + d); c.stroke();
    } else if (tipo === 'tug' || tipo === 'tue') {
      c.moveTo(p.x, p.y - r); c.lineTo(p.x + r, p.y + r * 0.8); c.lineTo(p.x - r, p.y + r * 0.8); c.closePath();
      if (tipo === 'tue') { c.fillStyle = col; }
      c.fill(); c.stroke();
    } else if (tipo === 'interruptor') {
      c.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x + r * 0.4, p.y - r * 0.4); c.lineTo(p.x + r * 1.2, p.y - r * 1.2); c.stroke();
    } else if (tipo === 'qd') {
      c.rect(p.x - r * 1.2, p.y - r * 0.7, r * 2.4, r * 1.4); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x - r * 1.2, p.y - r * 0.7); c.lineTo(p.x + r * 1.2, p.y + r * 0.7); c.lineTo(p.x - r * 1.2, p.y + r * 0.7); c.closePath();
      c.fillStyle = col; c.fill();
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

  label(t, x, y, col, align = 'center') {
    const c = this.ctx;
    c.save();
    c.font = '600 11px "Segoe UI", system-ui, sans-serif';
    c.textAlign = align;
    c.textBaseline = 'middle';
    const w = c.measureText(t).width;
    const bx = align === 'left' ? x - 2 : x - w / 2 - 3;
    c.fillStyle = 'rgba(255,255,255,.88)';
    c.fillRect(bx, y - 7, w + 6, 14);
    c.fillStyle = col;
    c.fillText(t, align === 'left' ? x + 1 : x, y);
    c.restore();
  }
}

function segDist(p, w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / l2));
  return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
}

export const fmt = (n, d = 2) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
