import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { corCircuito } from './plan2d.js';
import { TIPOS } from './tipos.js';

const COR_TIPO = {
  luz: 0xf2c94c, tug: 0x2f80ed, tue: 0xd0453a, interruptor: 0x6b7785, qd: 0x34404c,
  reservatorio: 0x5aa9c9, ci: 0x8a5a2b, bacia: 0xf4f6f8, lavatorio: 0xf4f6f8, chuveiro: 0x9fb3c2, pia: 0xb8c2cc, tanque: 0xd9dee3, mlr: 0xe8ecef,
};

export class View3D {
  constructor(container, store) {
    this.el = container;
    this.store = store;
    this.ready = false;
    this.visible = false;
    this.dirty = true;
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setClearColor(this.fundo || 0xf4f6f9);
    this.renderer.localClippingEnabled = true;
    this.el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.perspectiva = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.orto = new THREE.OrthographicCamera(-10, 10, 10, -10, -1000, 5000);
    this.camera = this.perspectiva;
    this.camera.position.set(18, 16, 22);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0ca, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(20, 40, 15);
    this.scene.add(sun);
    this.grid = new THREE.GridHelper(200, 200, 0xd3d8de, 0xe6e9ee);
    this.scene.add(this.grid);
    this.model = new THREE.Group();
    this.scene.add(this.model);
    this.initBoxSelect();
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.ready = true;
    this.setCorte(this.corte ?? null);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.visible) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  // seleção em área no 3D: Shift + arrastar
  initBoxSelect() {
    const dom = this.renderer.domElement;
    const rect = document.createElement('div');
    rect.style.cssText = 'position:absolute;border:1px solid #1d6fd6;background:rgba(29,111,214,.08);pointer-events:none;display:none';
    this.el.appendChild(rect);
    let start = null;
    dom.addEventListener('pointerdown', (e) => {
      if (!e.shiftKey || e.button !== 0) return;
      this.controls.enabled = false;
      const r = dom.getBoundingClientRect();
      start = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    window.addEventListener('pointermove', (e) => {
      if (!start) return;
      const r = dom.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      Object.assign(rect.style, { display: 'block', left: Math.min(x, start.x) + 'px', top: Math.min(y, start.y) + 'px', width: Math.abs(x - start.x) + 'px', height: Math.abs(y - start.y) + 'px' });
    });
    window.addEventListener('pointerup', (e) => {
      if (!start) return;
      const r = dom.getBoundingClientRect();
      const end = { x: e.clientX - r.left, y: e.clientY - r.top };
      const [x0, x1] = [Math.min(start.x, end.x), Math.max(start.x, end.x)], [y0, y1] = [Math.min(start.y, end.y), Math.max(start.y, end.y)];
      start = null;
      rect.style.display = 'none';
      this.controls.enabled = true;
      const itens = [];
      const v = new THREE.Vector3();
      for (const o of this.model.children) {
        if (!o.userData.ref) continue;
        o.getWorldPosition(v).project(this.camera);
        const sx = ((v.x + 1) / 2) * r.width, sy = ((1 - v.y) / 2) * r.height;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && v.z < 1) itens.push(o.userData);
      }
      this.store.selectMany(itens.filter((it) => it.pav === this.store.floor).map(({ kind, ref }) => ({ kind, ref })), false);
      this.store.log(`${itens.length} elemento(s) na área (${itens.filter((it) => it.pav === this.store.floor).length} no pavimento atual).`);
    });
  }

  resize() {
    if (!this.ready) return;
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height);
    this.perspectiva.aspect = r.width / r.height;
    this.perspectiva.updateProjectionMatrix();
    this.ajustaOrto();
  }

  ajustaOrto() {
    const r = this.el.getBoundingClientRect();
    if (!r.width) return;
    const d = this.perspectiva.position.distanceTo(this.controls.target) * 0.42;
    const a = r.width / r.height;
    Object.assign(this.orto, { left: -d * a, right: d * a, top: d, bottom: -d });
    this.orto.updateProjectionMatrix();
  }

  // ---- comandos da aba 3D
  setOrtografica(on) {
    if (!this.ready) this.init();
    const de = this.camera, para = on ? this.orto : this.perspectiva;
    if (de === para) return;
    para.position.copy(de.position);
    para.quaternion.copy(de.quaternion);
    if (on) this.ajustaOrto();
    this.camera = para;
    this.controls.object = para;
    this.controls.update();
  }
  vista(qual) {
    if (!this.ready) this.init();
    const t = this.controls.target, d = Math.max(10, this.camera.position.distanceTo(t));
    const pos = { topo: [0, d, 0.001], frente: [0, 0, d], lateral: [d, 0, 0], iso: [d * 0.6, d * 0.55, d * 0.6] }[qual];
    this.camera.position.set(t.x + pos[0], t.y + pos[1], t.z + pos[2]);
    this.camera.lookAt(t);
    this.controls.update();
  }
  setFundo(cor) {
    this.fundo = cor;
    if (this.ready) this.renderer.setClearColor(cor);
  }
  setCorte(h) {
    // corte horizontal: esconde o que está acima de h (m)
    this.corte = h;
    if (!this.ready) return;
    this.renderer.clippingPlanes = h == null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), h)];
  }
  enquadrar() { if (this.ready) this.rebuild(true); }

  show() {
    if (!this.ready) this.init();
    this.visible = true;
    this.resize();
    if (this.dirty) this.rebuild(true);
  }

  hide() { this.visible = false; }

  invalidate() {
    this.dirty = true;
    if (this.visible) this.rebuild(false);
  }

  rebuild(frame) {
    this.dirty = false;
    const { project, results, hid, spda, settings } = this.store;
    const vis = (d) => settings.vis[d] !== false;
    for (const ch of [...this.model.children]) {
      this.model.remove(ch);
      ch.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    }
    const add = (o, data) => { if (data) o.userData = data; this.model.add(o); return o; };
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.9, transparent: true, opacity: vis('est') ? 0.55 : 1 });
    const curMat = new THREE.MeshStandardMaterial({ color: 0xdfe9f7, roughness: 0.9, transparent: true, opacity: vis('est') ? 0.55 : 1 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xcfd5dc, roughness: 1 });
    const concreto = new THREE.MeshStandardMaterial({ color: 0xb7aed0, roughness: 0.85 });
    const lajeMat = new THREE.MeshStandardMaterial({ color: 0xcfc6e6, roughness: 0.9, transparent: true, opacity: 0.6 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a96a3 });
    const box = new THREE.Box3();
    const caixa = (w, h, d, mat, x, y, z, rotY = 0, data) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      return add(m, data);
    };

    const atual = project.pavimentos.indexOf(this.store.floor);
    for (const [pi, pav] of project.pavimentos.entries()) {
      if (settings.so3dAteAtual && pi > atual) continue;
      const cur = pav === this.store.floor;
      if (settings.planos3d) {
        const xs = pav.paredes.flatMap((w) => [w.x1, w.x2]), zs = pav.paredes.flatMap((w) => [w.y1, w.y2]);
        if (xs.length) {
          const g = new THREE.PlaneGeometry(Math.max(...xs) - Math.min(...xs) + 4, Math.max(...zs) - Math.min(...zs) + 4);
          const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: cur ? 0x6fa8ff : 0x9aa7b5, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
          m.rotation.x = -Math.PI / 2;
          m.position.set((Math.max(...xs) + Math.min(...xs)) / 2, pav.cota + 0.01, (Math.max(...zs) + Math.min(...zs)) / 2);
          add(m);
        }
      }
      const y0 = pav.cota;
      if (vis('arq')) for (const w of pav.paredes) {
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        if (!len) continue;
        const m = caixa(len + w.esp, pav.peDireito, w.esp, cur ? curMat : wallMat, (w.x1 + w.x2) / 2, y0 + pav.peDireito / 2, (w.y1 + w.y2) / 2,
          -Math.atan2(w.y2 - w.y1, w.x2 - w.x1), { kind: 'parede', ref: w, pav });
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat);
        e.position.copy(m.position); e.rotation.copy(m.rotation);
        add(e);
        box.expandByObject(m);
      }
      // piso do térreo
      if (pi === 0 && pav.paredes.length && vis('arq')) {
        const xs = pav.paredes.flatMap((w) => [w.x1, w.x2]), zs = pav.paredes.flatMap((w) => [w.y1, w.y2]);
        const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
        caixa(maxX - minX + 0.3, 0.1, maxZ - minZ + 0.3, slabMat, (minX + maxX) / 2, y0 - 0.05, (minZ + maxZ) / 2);
      }
      if (vis('est')) {
        const topo = y0 + pav.peDireito;
        for (const l of pav.lajes || []) {
          const m = caixa(l.x2 - l.x1, l.h / 100, l.y2 - l.y1, lajeMat, (l.x1 + l.x2) / 2, topo - l.h / 200, (l.y1 + l.y2) / 2, 0, { kind: 'laje', ref: l, pav });
          box.expandByObject(m);
        }
        for (const v of pav.vigas || []) {
          const len = Math.hypot(v.x2 - v.x1, v.y2 - v.y1);
          if (!len) continue;
          caixa(len, v.h / 100, v.b / 100, concreto, (v.x1 + v.x2) / 2, topo - v.h / 200, (v.y1 + v.y2) / 2, -Math.atan2(v.y2 - v.y1, v.x2 - v.x1), { kind: 'viga', ref: v, pav });
        }
        for (const p of pav.elementos.filter((e) => e.tipo === 'pilar')) {
          const m = caixa(p.b / 100, pav.peDireito, p.h / 100, concreto, p.x, y0 + pav.peDireito / 2, p.y, 0, { kind: 'elemento', ref: p, pav });
          box.expandByObject(m);
        }
      }
      for (const el of pav.elementos) {
        const t = TIPOS[el.tipo];
        if (!t || el.tipo === 'pilar' || !vis(t.disc)) continue;
        if (t.quadro) {
          // quadro: caixa laranja com moldura clara
          const grp = new THREE.Group();
          grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.12), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 })));
          const fundo = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.7, 0.13), new THREE.MeshStandardMaterial({ color: 0xd9823b, roughness: 0.7 }));
          grp.add(fundo);
          for (let k = 0; k < 2; k++) {
            const trilho = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.15), new THREE.MeshStandardMaterial({ color: 0xe8e8e8 }));
            trilho.position.y = 0.14 - k * 0.24;
            grp.add(trilho);
          }
          grp.position.set(el.x, y0 + el.altura, el.y);
          add(grp, { kind: 'elemento', ref: el, pav });
          continue;
        }
        const g = el.tipo === 'luz' ? new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8)
          : t.disc === 'ele' ? new THREE.BoxGeometry(0.1, 0.12, 0.06)
          : el.tipo === 'reservatorio' ? new THREE.CylinderGeometry(0.6, 0.55, 0.9, 24)
          : el.tipo === 'ci' ? new THREE.BoxGeometry(0.6, 0.4, 0.6)
          : t.disc === 'hid' ? new THREE.BoxGeometry(0.35, 0.25, 0.35)
          : new THREE.BoxGeometry(0.12, 0.12, 0.06);
        const cor = t.disc === 'ele' ? 0xf5c518 : COR_TIPO[el.tipo] ?? 0x888888;
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: cor, roughness: 0.55 }));
        m.position.set(el.x, y0 + el.altura, el.y);
        add(m, { kind: 'elemento', ref: el, pav });
      }
    }

    // eletrodutos: tubos amarelos pelo forro, descendo até cada ponto
    const eletroduto = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.45 });
    const tuboReto = (p, q, raio, mat) => {
      const L = p.distanceTo(q);
      if (L < 0.01) return;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(raio, raio, L, 10), mat);
      m.position.copy(p).add(q).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize());
      add(m);
    };
    if (vis('ele') && this.store.ele) {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const visivel = (pav) => !(settings.so3dAteAtual && project.pavimentos.indexOf(pav) > atual);
      for (const sg of this.store.ele.segmentos) {
        const a = sg.de, b = sg.para;
        if (!visivel(a.pav) || !visivel(b.pav)) continue;
        const raio = Math.max(0.01, sg.dn / 2000);
        if (a.pav === b.pav) {
          const yc = a.pav.cota + a.pav.peDireito - 0.12;
          const pA = V(a.x, Math.min(a.z, yc), a.y), pB = V(b.x, Math.min(b.z, yc), b.y);
          const topoA = V(a.x, yc, a.y), quina = V(b.x, yc, a.y), topoB = V(b.x, yc, b.y);
          tuboReto(pA, topoA, raio, eletroduto); tuboReto(topoA, quina, raio, eletroduto); tuboReto(quina, topoB, raio, eletroduto); tuboReto(topoB, pB, raio, eletroduto);
        } else {
          tuboReto(V(a.x, a.z, a.y), V(b.x, a.z, a.y), raio, eletroduto);
          tuboReto(V(b.x, a.z, a.y), V(b.x, b.z, b.y), raio, eletroduto);
        }
      }
      const alim = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.5 });
      for (const al of this.store.ele.alimentadores) {
        const pa = project.pavimentos.find((pv) => pv.elementos.includes(al.de)), pb = project.pavimentos.find((pv) => pv.elementos.includes(al.para));
        if (!pa || !pb || !visivel(pa) || !visivel(pb)) continue;
        const A = V(al.de.x, pa.cota + 0.3, al.de.y), B = V(al.para.x, pb.cota + 0.3, al.para.y), M = V(al.para.x, pa.cota + 0.3, al.de.y);
        tuboReto(A, M, 0.025, alim); tuboReto(M, B, 0.025, alim);
      }
    }

    // tubulações: tubos de verdade, com o diâmetro calculado
    const tubo = (a, b, raio, cor) => {
      const pts = [new THREE.Vector3(a.x, a.z, a.y), new THREE.Vector3(b.x, a.z, a.y), new THREE.Vector3(b.x, a.z, b.y), new THREE.Vector3(b.x, b.z, b.y)];
      const mat = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.5 });
      for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i], q = pts[i + 1];
        const L = p.distanceTo(q);
        if (L < 0.01) continue;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(raio, raio, L, 10), mat);
        m.position.copy(p).add(q).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize());
        add(m);
      }
    };
    if (vis('hid') && hid) {
      for (const s of hid.af.segmentos) tubo(s.de, s.para, Math.max(0.02, s.de_mm / 2000), 0x1593a6);
      for (const s of hid.esg.segmentos) tubo(s.de, s.para, Math.max(0.03, s.dn / 2000), 0x8a5a2b);
    }

    // SPDA
    if (vis('spda') && spda?.ativo && spda.captacao) {
      const mat = new THREE.LineBasicMaterial({ color: 0x2e8b57 });
      const seg = (a, b) => add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
      const z = spda.contorno.z;
      for (const l of spda.captacao) seg(new THREE.Vector3(l.x1, z, l.y1), new THREE.Vector3(l.x2, z, l.y2));
      for (const d of spda.descidas) seg(new THREE.Vector3(d.x, z, d.y), new THREE.Vector3(d.x, -0.5, d.y));
      const a = spda.anel;
      const ring = [[a.minX, a.minY], [a.maxX, a.minY], [a.maxX, a.maxY], [a.minX, a.maxY], [a.minX, a.minY]].map(([x, y]) => new THREE.Vector3(x, -0.5, y));
      add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat));
      // mini-captores nos nós
      const capt = new THREE.MeshStandardMaterial({ color: 0x2e8b57 });
      for (const l of spda.captacao) for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), capt);
        m.position.set(x, z + 0.15, y);
        add(m);
      }
    }

    if (frame && !box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
      this.controls.target.copy(c);
      this.camera.position.set(c.x + size * 0.7, c.y + size * 0.6, c.z + size * 0.8);
      this.grid.position.set(Math.round(c.x), 0, Math.round(c.z));
    }
  }
}
