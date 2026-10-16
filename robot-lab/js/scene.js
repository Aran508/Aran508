"use strict";
// 3D work cell with three.js. World units are metres, Z up; the robot maths is in millimetres.

const S = 0.001; // mm -> m

class Cell3D {
  constructor(canvas, colors) {
    this.canvas = canvas;
    this.ok = typeof THREE !== "undefined";
    if (!this.ok) return;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.02, 50);
    this.camera.up.set(0, 0, 1);
    this.orbit = { target: new THREE.Vector3(0.35, -0.05, 0.45), dist: 3.3, az: -0.95, el: 0.42 };
    this.colors = colors;
    this.links = [];
    this.boxes = [];
    this.buildLights();
    this.buildFloor();
    this.buildCell();
    this.buildTrail();
    this.buildFrames();
    this.applyTheme(colors);
    this.bindOrbit();
  }

  mat(color, opts = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.15 }, opts)); }
  boxMesh(sx, sy, sz, m) { const g = new THREE.BoxGeometry(sx * S, sy * S, sz * S); const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; return o; }
  cylZ(r, h, m, seg = 32) { const g = new THREE.CylinderGeometry(r * S, r * S, h * S, seg); g.rotateX(Math.PI / 2); const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; return o; }
  cylY(r, h, m, seg = 32) { const g = new THREE.CylinderGeometry(r * S, r * S, h * S, seg); const o = new THREE.Mesh(g, m); o.castShadow = true; return o; }
  at(o, x, y, z) { o.position.set(x * S, y * S, z * S); return o; }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.75);
    this.hemi.position.set(0, 0, 1);
    this.scene.add(this.hemi);
    const d = new THREE.DirectionalLight(0xffffff, 0.85);
    d.position.set(1.6, -1.2, 3.2);
    d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048);
    const sc = d.shadow.camera; sc.left = -1.6; sc.right = 1.6; sc.top = 1.6; sc.bottom = -1.6; sc.near = 0.5; sc.far = 7;
    d.shadow.bias = -0.0004;
    this.scene.add(d);
    this.sun = d;
  }

  buildFloor() {
    const g = new THREE.PlaneGeometry(8, 8);
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.95 });
    const f = new THREE.Mesh(g, this.floorMat); f.receiveShadow = true; this.scene.add(f);
    this.grid = new THREE.GridHelper(4, 40, 0x9aa6b0, 0xc4ccd3);
    this.grid.rotation.x = Math.PI / 2; this.grid.position.z = 0.001;
    this.scene.add(this.grid);
    // safety zone markings on the floor
    const ring = new THREE.RingGeometry(1.45, 1.5, 96);
    this.zoneMat = new THREE.MeshBasicMaterial({ color: 0xe0a106, transparent: true, opacity: 0.55 });
    const zr = new THREE.Mesh(ring, this.zoneMat); zr.position.z = 0.002; this.scene.add(zr);
  }

  buildCell() {
    const steel = this.mat(0x7c8790, { metalness: 0.5, roughness: 0.4 });
    const dark = this.mat(0x30363c, { roughness: 0.7 });
    this.steel = steel; this.dark = dark;
    const add = (o) => (this.scene.add(o), o);
    // conveyor: frame, belt, rollers, legs
    const cv = CELL.surfaces[0];
    const cx = (cv.x0 + cv.x1) / 2, cy = (cv.y0 + cv.y1) / 2, w = cv.x1 - cv.x0, l = cv.y1 - cv.y0;
    add(this.at(this.boxMesh(w, l, 40, steel), cx, cy, cv.z - 30));
    this.beltMat = this.mat(0x23272b, { roughness: 0.9 });
    add(this.at(this.boxMesh(w - 30, l, 8, this.beltMat), cx, cy, cv.z - 4));
    for (const lx of [cv.x0 + 20, cv.x1 - 20]) for (const ly of [cv.y0 + 30, cv.y1 - 30]) add(this.at(this.boxMesh(40, 40, cv.z - 50, steel), lx, ly, (cv.z - 50) / 2));
    // belt chevrons so the motion is visible
    this.chevrons = [];
    const chev = this.mat(0x5d666f);
    for (let i = 0; i < 12; i++) { const c = this.boxMesh(w - 40, 8, 2, chev); this.at(c, cx, cv.y0 + i * (l / 12), cv.z + 1); this.chevrons.push(c); add(c); }
    this.beltY0 = cv.y0; this.beltLen = l;
    // part-present sensor
    this.sensorMat = this.mat(0x444b52, { emissive: 0x000000 });
    add(this.at(this.boxMesh(30, 30, 60, dark), cv.x0 - 30, CELL.pickAt[1], cv.z + 30));
    this.sensorLamp = add(this.at(this.cylZ(10, 12, this.sensorMat, 16), cv.x0 - 30, CELL.pickAt[1], cv.z + 66));
    // pallet table and pallet
    const pt = CELL.surfaces[1];
    const tx = (pt.x0 + pt.x1) / 2, ty = (pt.y0 + pt.y1) / 2;
    this.tableMat = this.mat(0xb8c0c7, { roughness: 0.8 });
    add(this.at(this.boxMesh(pt.x1 - pt.x0, pt.y1 - pt.y0, 30, this.tableMat), tx, ty, pt.z - 15));
    for (const lx of [pt.x0 + 25, pt.x1 - 25]) for (const ly of [pt.y0 + 25, pt.y1 - 25]) add(this.at(this.boxMesh(40, 40, pt.z - 30, steel), lx, ly, (pt.z - 30) / 2));
    // pallet outline drawn on the table top (the user frame origin is its corner)
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.28, 0.19, 0.001)), new THREE.LineBasicMaterial({ color: 0x0b7a75 }));
    outline.position.set((400 + 140) * S, (250 + 95) * S, (pt.z + 1) * S); add(outline); this.palletOutline = outline;
    // reject bin
    const b = CELL.surfaces[2];
    this.binMat = this.mat(0xc23b2a, { roughness: 0.6 });
    const bx = (b.x0 + b.x1) / 2, by = (b.y0 + b.y1) / 2, bw = b.x1 - b.x0, bl = b.y1 - b.y0, bh = b.wall - b.z + 20;
    add(this.at(this.boxMesh(bw, bl, 10, this.binMat), bx, by, b.z - 5));
    add(this.at(this.boxMesh(10, bl, bh, this.binMat), b.x0, by, b.z + bh / 2 - 10));
    add(this.at(this.boxMesh(10, bl, bh, this.binMat), b.x1, by, b.z + bh / 2 - 10));
    add(this.at(this.boxMesh(bw, 10, bh, this.binMat), bx, b.y0, b.z + bh / 2 - 10));
    add(this.at(this.boxMesh(bw, 10, bh, this.binMat), bx, b.y1, b.z + bh / 2 - 10));
    for (const lx of [b.x0 + 15, b.x1 - 15]) for (const ly of [b.y0 + 15, b.y1 - 15]) add(this.at(this.boxMesh(20, 20, b.z - 10, steel), lx, ly, (b.z - 10) / 2));
    // fence posts
    const fenceMat = this.mat(0xe0a106, { roughness: 0.5 });
    this.fenceMat = fenceMat;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      if (Math.cos(ang) > 0.2 && Math.abs(Math.sin(ang)) < 0.75) continue; // open side towards the viewer
      add(this.at(this.boxMesh(40, 40, 1100, fenceMat), Math.cos(ang) * 1700, Math.sin(ang) * 1700, 550));
    }
  }

  // robot geometry built per link in its own frame (mm)
  buildRobot(style) {
    if (this.robot) { this.scene.remove(this.robot); }
    const root = new THREE.Group();
    const body = this.mat(style.body, { roughness: 0.45, metalness: 0.1 });
    const trim = this.mat(style.trim, { roughness: 0.6, metalness: 0.25 });
    const chrome = this.mat(0xb7bec5, { metalness: 0.8, roughness: 0.25 });
    this.bodyMat = body; this.trimMat = trim;
    const link = () => { const g = new THREE.Group(); g.matrixAutoUpdate = false; root.add(g); return g; };
    const L = [link(), link(), link(), link(), link(), link(), link()];
    // base
    L[0].add(this.at(this.boxMesh(440, 440, 24, trim), 0, 0, 12));
    L[0].add(this.at(this.cylZ(175, 180, body), 0, 0, 110));
    // turret (J1)
    L[1].add(this.at(this.cylZ(160, 90, trim), 0, 0, 245));
    L[1].add(this.at(this.boxMesh(260, 300, 170, body), 60, 0, 370));
    L[1].add(this.at(this.cylY(125, 320, trim), ARM.a1, 0, ARM.d1));
    L[1].add(this.at(this.cylZ(70, 120, trim), -110, 110, 360));
    // upper arm (J2): along +z
    L[2].add(this.at(this.boxMesh(150, 170, ARM.a2 - 80, body), 0, 0, ARM.a2 / 2));
    L[2].add(this.at(this.cylY(105, 250, trim), 0, 0, ARM.a2));
    L[2].add(this.at(this.cylY(130, 190, body), 0, 0, 0));
    // forearm housing (J3): along +x at height a3
    L[3].add(this.at(this.boxMesh(360, 190, 210, body), 40, 0, ARM.a3 * 0.6));
    L[3].add(this.at(this.cylY(90, 230, body), 0, 0, 0));
    L[3].add(this.at(this.cylZ(65, 120, trim).rotateY(Math.PI / 2), -200, 0, ARM.a3 * 0.6));
    // forearm tube (J4): along local z
    L[4].add(this.at(this.cylZ(78, ARM.d4 - 300, body), 0, 0, 220 + (ARM.d4 - 300) / 2 - 40));
    L[4].add(this.at(this.cylZ(62, 120, trim), 0, 0, ARM.d4 - 110));
    // wrist (J5)
    L[5].add(this.at(this.cylY(64, 150, trim), 0, 0, 0));
    L[5].add(this.at(this.cylZ(52, ARM.d6 - 10, body), 0, 0, (ARM.d6 - 10) / 2));
    // flange + gripper (J6)
    L[6].add(this.at(this.cylZ(46, 16, chrome), 0, 0, -8));
    const grip = new THREE.Group();
    grip.add(this.at(this.boxMesh(110, 70, 70, trim), 0, 0, 35));
    grip.add(this.at(this.cylZ(18, 14, chrome), 0, 0, 77));
    const fm = this.mat(0x9aa3ab, { metalness: 0.6, roughness: 0.35 });
    this.fingerA = this.at(this.boxMesh(16, 44, 95, fm), 40, 0, 110);
    this.fingerB = this.at(this.boxMesh(16, 44, 95, fm), -40, 0, 110);
    grip.add(this.fingerA, this.fingerB);
    // TCP marker
    this.tcpDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0x0b7a75 }));
    this.tcpDot.position.set(0, 0, 160 * S);
    grip.add(this.tcpDot);
    L[6].add(grip);
    this.gripper = grip;
    this.links = L;
    this.robot = root;
    this.scene.add(root);
  }

  setGripper(gap) { // gap in mm between finger inner faces
    if (!this.fingerA) return;
    this.fingerA.position.x = (gap / 2 + 8) * S; this.fingerB.position.x = -(gap / 2 + 8) * S;
  }

  setJoints(q) {
    if (!this.ok || !this.links.length) return;
    const F = fkFrames(q);
    F.forEach((P, i) => {
      const R = P.R, p = P.p;
      this.links[i].matrix.set(R[0], R[1], R[2], p[0] * S, R[3], R[4], R[5], p[1] * S, R[6], R[7], R[8], p[2] * S, 0, 0, 0, 1);
      this.links[i].matrixWorldNeedsUpdate = true;
    });
  }

  // ---- boxes ----
  syncBoxes(list) {
    while (this.boxes.length < list.length) {
      const m = this.boxMesh(CELL.boxSize, CELL.boxSize, CELL.boxSize, this.mat(0xc79a5b, { roughness: 0.85 }));
      const tape = this.boxMesh(CELL.boxSize + 1, 14, 1, this.mat(0xe7d8b8, { roughness: 0.7 })); tape.position.z = CELL.boxSize / 2 * S + 0.0005;
      m.add(tape);
      this.scene.add(m); this.boxes.push(m);
    }
    this.boxes.forEach((m, i) => {
      const b = list[i];
      m.visible = !!b;
      if (!b) return;
      const R = b.R, p = b.p;
      m.matrixAutoUpdate = false;
      m.matrix.set(R[0], R[1], R[2], p[0] * S, R[3], R[4], R[5], p[1] * S, R[6], R[7], R[8], p[2] * S, 0, 0, 0, 1);
      m.matrixWorldNeedsUpdate = true;
    });
  }

  // ---- trail ----
  buildTrail() {
    this.trailMax = 8000;
    const g = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(this.trailMax * 3);
    this.trailCol = new Float32Array(this.trailMax * 3);
    g.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.trailCol, 3));
    g.setDrawRange(0, 0);
    this.trail = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this.trailN = 0;
  }
  clearTrail() { this.trailN = 0; this.trail.geometry.setDrawRange(0, 0); }
  addTrail(p, color) {
    if (!this.ok) return;
    if (this.trailN >= this.trailMax) { // drop the oldest half
      this.trailPos.copyWithin(0, this.trailMax * 1.5, this.trailMax * 3);
      this.trailCol.copyWithin(0, this.trailMax * 1.5, this.trailMax * 3);
      this.trailN = this.trailMax / 2;
    }
    const i = this.trailN * 3;
    if (this.trailN > 0) {
      const dx = this.trailPos[i - 3] - p[0] * S, dy = this.trailPos[i - 2] - p[1] * S, dz = this.trailPos[i - 1] - p[2] * S;
      if (dx * dx + dy * dy + dz * dz < 1e-6) return;
    }
    this.trailPos[i] = p[0] * S; this.trailPos[i + 1] = p[1] * S; this.trailPos[i + 2] = p[2] * S;
    this.trailCol[i] = color.r; this.trailCol[i + 1] = color.g; this.trailCol[i + 2] = color.b;
    this.trailN++;
    const g = this.trail.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.trailN);
  }

  // ---- frames ----
  axes(len) {
    const g = new THREE.Group();
    const mk = (dir, col) => {
      const a = new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(0, 0, 0), len, col, len * 0.22, len * 0.12);
      g.add(a);
    };
    mk([1, 0, 0], 0xd9412b); mk([0, 1, 0], 0x2f9d4b); mk([0, 0, 1], 0x2f6fd1);
    g.matrixAutoUpdate = false;
    this.scene.add(g);
    return g;
  }
  buildFrames() {
    this.fBase = this.axes(0.28);
    this.fTool = this.axes(0.14);
    this.fUser = this.axes(0.16);
    this.setPose(this.fUser, CELL.frames[1].pose);
  }
  setPose(obj, P) {
    const R = P.R, p = P.p;
    obj.matrix.set(R[0], R[1], R[2], p[0] * S, R[3], R[4], R[5], p[1] * S, R[6], R[7], R[8], p[2] * S, 0, 0, 0, 1);
    obj.matrixWorldNeedsUpdate = true;
  }
  showFrames(on) { [this.fBase, this.fTool, this.fUser].forEach((f) => (f.visible = on)); }

  applyTheme(c) {
    if (!this.ok) return;
    this.colors = c;
    this.scene.background = new THREE.Color(c.sky);
    this.floorMat.color.set(c.floor);
    this.grid.material.color && this.grid.material.color.set(c.grid);
  }

  // ---- camera ----
  bindOrbit() {
    const el = this.canvas;
    let drag = null;
    const pts = new Map();
    el.addEventListener("pointerdown", (e) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; });
    el.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { // pinch zoom
        const [a, b] = [...pts.values()]; const other = [...pts.entries()].find(([k]) => k !== e.pointerId)[1];
        const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]), d1 = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d0 > 0) this.orbit.dist = Math.max(1.0, Math.min(8, this.orbit.dist * d0 / d1));
        return;
      }
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      if (drag && drag.pan) {
        const k = this.orbit.dist * 0.0012;
        const right = new THREE.Vector3(Math.cos(this.orbit.az + Math.PI / 2), Math.sin(this.orbit.az + Math.PI / 2), 0);
        this.orbit.target.addScaledVector(right, -dx * k);
        this.orbit.target.z += dy * k;
      } else {
        this.orbit.az -= dx * 0.008;
        this.orbit.el = Math.max(0.05, Math.min(1.45, this.orbit.el + dy * 0.006));
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (!pts.size) drag = null; };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("wheel", (e) => { e.preventDefault(); this.orbit.dist = Math.max(1.0, Math.min(8, this.orbit.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  }
  view(name) {
    const v = { iso: [-0.95, 0.42, 3.3], front: [Math.PI, 0.12, 3.0], side: [-Math.PI / 2, 0.12, 3.0], top: [-Math.PI / 2, 1.45, 3.2] }[name];
    if (!v) return;
    this.orbit.az = v[0]; this.orbit.el = v[1]; this.orbit.dist = v[2]; this.orbit.target.set(0.35, -0.05, 0.45);
  }

  resize(w, h) {
    if (!this.ok) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  project(p) { // mm -> screen px
    const v = new THREE.Vector3(p[0] * S, p[1] * S, p[2] * S).project(this.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z < 1];
  }
  render(beltPhase) {
    if (!this.ok) return;
    const o = this.orbit;
    this.camera.position.set(o.target.x + o.dist * Math.cos(o.el) * Math.cos(o.az), o.target.y + o.dist * Math.cos(o.el) * Math.sin(o.az), o.target.z + o.dist * Math.sin(o.el));
    this.camera.lookAt(o.target);
    if (this.chevrons) this.chevrons.forEach((c, i) => { const y = this.beltY0 + ((i * this.beltLen / 12 + beltPhase) % this.beltLen); c.position.y = y * S; });
    this.renderer.render(this.scene, this.camera);
  }
}
