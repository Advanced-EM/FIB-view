// 3D reconstruction of a slice & view stack: the slice images are segmented into phases (the same thresholds as the
// phase fractions), and the surfaces of the chosen phases are drawn as voxels with three.js, in true proportions.
// It renders into its own offscreen canvas, which the detector view copies; drag to rotate, scroll to zoom.
import * as THREE from 'three';

const COLORS = {
  chip: [0x30363f, 0x7c858f, 0xff9a4d], nmc: [0x30363f, 0x8a929c, 0x6fa8ff], hpf: [0x5d7fa0, 0x7fa7c9, 0xffd27f],
};
const MAX = 90000; // voxels drawn at most

export class Recon3D {
  constructor() { this.az = 0.8; this.el = 0.42; this.dist = 7.5; this.spin = true; this.key = ''; this.builtK = -1; this.n = 0; }
  init() {
    if (this.r) return true;
    if (this.failed) return false;
    try {
      this.cv = document.createElement('canvas');
      this.r = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, preserveDrawingBuffer: true });
    } catch { this.failed = true; return false; }
    this.r.setPixelRatio(1);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x06080b);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    this.scene.add(new THREE.HemisphereLight(0xe6eeff, 0x1a1f28, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fd6ff, 0.5); rim.position.set(-4, 1, -3); this.scene.add(rim);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }), MAX);
    this.mesh.count = 0; this.group.add(this.mesh);
    this.box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.45 }));
    this.group.add(this.box);
    return true;
  }
  // segment the stack and place one voxel on every boundary of the phases to show ('2', '1' or 'both')
  build(sim, S) {
    const sv = sim.sv;
    if (!sv?.k || !this.init()) return;
    const key = `${S.spec}|${S.svDet}|${S.svShow}|${sv.W}|${sv.s}`;
    // rebuild as the stack grows: every few slices while milling, and at the end
    if (key === this.key && (sv.k === this.builtK || (sv.k > this.builtK && sv.k - this.builtK < 3 && !sv.done))) return;
    this.key = key; this.builtK = sv.k;
    const { t1, t2 } = sim.svSegmentation(), bx = 2, bz = 2, bs = Math.max(1, Math.ceil(sv.k / 120));
    const nx = Math.floor(sv.nx / bx), nz = Math.floor(sv.nz / bz), ns = Math.floor(sv.k / bs);
    const cls = new Uint8Array(nx * nz * ns);
    for (let t = 0; t < ns; t++) {
      const img = sv.stack[t * bs];
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const v = img[(j * bz + 1) * sv.nx + i * bx + 1];
        cls[(t * nz + j) * nx + i] = v < t1 ? 0 : v < t2 ? 1 : 2;
      }
    }
    const show = S.svShow === 'both' ? [1, 2] : [S.svShow === '1' ? 1 : 2];
    const dx = (sv.W / sv.nx) * bx, dz = (sv.Hz / sv.nz) * bz, ds = sv.s * bs, L = ns * ds;
    const scale = 2.6 / Math.max(sv.W, sv.Hz, L), pal = COLORS[S.spec] ?? COLORS.nmc;
    const m = new THREE.Matrix4(), col = new THREE.Color(), at = (i, j, t) => (i < 0 || j < 0 || t < 0 || i >= nx || j >= nz || t >= ns ? 255 : cls[(t * nz + j) * nx + i]);
    let n = 0;
    for (let t = 0; t < ns && n < MAX; t++) for (let j = 0; j < nz && n < MAX; j++) for (let i = 0; i < nx && n < MAX; i++) {
      const c = cls[(t * nz + j) * nx + i];
      if (!show.includes(c)) continue;
      // only voxels on a surface of their phase (or on the cut faces of the block) are visible
      if (at(i - 1, j, t) === c && at(i + 1, j, t) === c && at(i, j - 1, t) === c && at(i, j + 1, t) === c && at(i, j, t - 1) === c && at(i, j, t + 1) === c) continue;
      m.makeScale(dx * scale, dz * scale, ds * scale);
      m.setPosition(((i + 0.5) * dx - sv.W / 2) * scale, (sv.Hz / 2 - (j + 0.5) * dz) * scale, ((t + 0.5) * ds - L / 2) * scale);
      this.mesh.setMatrixAt(n, m);
      // a little shading by depth, so the stack reads as a volume
      col.setHex(pal[c]).multiplyScalar(0.8 + 0.25 * (1 - j / nz));
      this.mesh.setColorAt(n, col);
      n++;
    }
    this.mesh.count = n; this.n = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.box.scale.set(sv.W * scale, sv.Hz * scale, Math.max(L, ds) * scale);
    this.dims = { W: sv.W, H: sv.Hz, L, voxel: [dx, dz, ds] };
  }
  // render at w × h device pixels; returns the canvas (or null without WebGL)
  render(sim, S, w, h, dt = 0) {
    this.build(sim, S);
    if (!this.r) return null;
    if (this.spin) this.az += dt * 0.35;
    if (this.cv.width !== w || this.cv.height !== h) this.r.setSize(w, h, false);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    const ce = Math.cos(this.el);
    this.cam.position.set(this.dist * ce * Math.sin(this.az), this.dist * Math.sin(this.el), this.dist * ce * Math.cos(this.az));
    this.cam.lookAt(0, 0, 0);
    this.r.render(this.scene, this.cam);
    return this.cv;
  }
  drag(dx, dy) { this.spin = false; this.az -= dx * 0.01; this.el = Math.max(-1.4, Math.min(1.4, this.el + dy * 0.01)); }
  zoom(f) { this.dist = Math.max(3, Math.min(16, this.dist * f)); }
  reset() { this.key = ''; this.builtK = -1; }
}
