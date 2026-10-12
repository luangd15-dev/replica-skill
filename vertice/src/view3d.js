import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { corCircuito } from './plan2d.js';

const COR_TIPO = { luz: 0xf2c94c, tug: 0x2f80ed, tue: 0xd0453a, interruptor: 0x6b7785, qd: 0x34404c };

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
    this.renderer.setClearColor(0xf4f6f9);
    this.el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
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
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.ready = true;
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.visible) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize() {
    if (!this.ready) return;
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

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
    const { project, results } = this.store;
    for (const ch of [...this.model.children]) {
      this.model.remove(ch);
      ch.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    }
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.9 });
    const curMat = new THREE.MeshStandardMaterial({ color: 0xdfe9f7, roughness: 0.9 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xcfd5dc, roughness: 1 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a96a3 });
    const box = new THREE.Box3();

    for (const pav of project.pavimentos) {
      const cur = pav === this.store.floor;
      const y0 = pav.cota;
      for (const w of pav.paredes) {
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        if (!len) continue;
        const g = new THREE.BoxGeometry(len + w.esp, pav.peDireito, w.esp);
        const m = new THREE.Mesh(g, cur ? curMat : wallMat);
        m.position.set((w.x1 + w.x2) / 2, y0 + pav.peDireito / 2, (w.y1 + w.y2) / 2);
        m.rotation.y = -Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
        this.model.add(m);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
        e.position.copy(m.position); e.rotation.copy(m.rotation);
        this.model.add(e);
        box.expandByObject(m);
      }
      // laje: retângulo envolvente das paredes do pavimento
      if (pav.paredes.length) {
        const xs = pav.paredes.flatMap((w) => [w.x1, w.x2]), zs = pav.paredes.flatMap((w) => [w.y1, w.y2]);
        const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
        const slab = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX + 0.3, 0.1, maxZ - minZ + 0.3), slabMat);
        slab.position.set((minX + maxX) / 2, y0 - 0.05, (minZ + maxZ) / 2);
        this.model.add(slab);
      }
      for (const el of pav.elementos) {
        const g = el.tipo === 'luz' ? new THREE.SphereGeometry(0.12, 16, 12)
          : el.tipo === 'qd' ? new THREE.BoxGeometry(0.4, 0.55, 0.1)
          : new THREE.BoxGeometry(0.12, 0.12, 0.06);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: COR_TIPO[el.tipo], emissive: el.tipo === 'luz' ? 0x6b5410 : 0 }));
        m.position.set(el.x, y0 + Math.min(el.altura, pav.peDireito - 0.1), el.y);
        this.model.add(m);
      }
    }

    // fiação pelo forro
    for (const r of results) {
      if (!r.qd) continue;
      const pav = project.pavimentos.find((p) => p.elementos.includes(r.qd));
      if (!pav) continue;
      const yc = pav.cota + pav.peDireito - 0.05;
      const pts = [new THREE.Vector3(r.qd.x, pav.cota + r.qd.altura, r.qd.y), new THREE.Vector3(r.qd.x, yc, r.qd.y)];
      for (const e of r.rota) {
        pts.push(new THREE.Vector3(e.x, yc, e.y));
        if (e.altura < pav.peDireito - 0.2) { pts.push(new THREE.Vector3(e.x, pav.cota + e.altura, e.y), new THREE.Vector3(e.x, yc, e.y)); }
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: corCircuito(project, r.circuito.id) }));
      this.model.add(line);
    }

    if (frame && !box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
      this.controls.target.copy(c);
      this.camera.position.set(c.x + size * 0.7, c.y + size * 0.6, c.z + size * 0.8);
      this.grid.position.set(Math.round(c.x), 0, Math.round(c.z));
    }
  }
}
