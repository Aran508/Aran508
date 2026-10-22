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

  // ---- part helpers for the robot (all sizes in mm, in the owning link's frame) ----
  // convex hull of circles [[x, y, r], ...] as a THREE.Shape
  hullShape(circles, n = 28) {
    const pts = [];
    for (const [cx, cy, r] of circles) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    const h = lo.slice(0, -1).concat(hi.slice(0, -1));
    return new THREE.Shape(h.map(([x, y]) => new THREE.Vector2(x, y)));
  }
  // a casting: a hull in the link's XZ plane, extruded across Y from y0 to y1, with rounded edges
  castXZ(circles, y0, y1, m, bevel = 8) {
    const g = new THREE.ExtrudeGeometry(this.hullShape(circles.map(([x, z, r]) => [x, z, r - bevel])), { depth: Math.max(0.5, y1 - y0 - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24 });
    g.rotateX(Math.PI / 2); g.translate(0, y1 - bevel, 0); g.scale(S, S, S);
    const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; return o;
  }
  // a plate: a hull in the XY plane, extruded up from z0 to z1
  castXY(circles, z0, z1, m, bevel = 4) {
    const g = new THREE.ExtrudeGeometry(this.hullShape(circles.map(([x, y, r]) => [x, y, r - bevel])), { depth: Math.max(0.5, z1 - z0 - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 16 });
    g.translate(0, 0, z0 + bevel); g.scale(S, S, S);
    const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; return o;
  }
  // a turned part: profile [[r, h], ...] revolved about an axis "x" | "y" | "z" through (cx, cy, cz)
  turned(profile, axis, c, m, seg = 40) {
    const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r * S, h * S)), seg);
    if (axis === "z") g.rotateX(Math.PI / 2); else if (axis === "x") g.rotateZ(-Math.PI / 2);
    const o = new THREE.Mesh(g, m); o.position.set(c[0] * S, c[1] * S, c[2] * S); o.castShadow = o.receiveShadow = true; return o;
  }
  cylAxis(axis, r, h, m, seg = 32) { return axis === "x" ? this.cylZ(r, h, m, seg).rotateY(Math.PI / 2) : axis === "y" ? this.cylY(r, h, m, seg) : this.cylZ(r, h, m, seg); }
  // bolt heads on a circle, on the face of a part whose axis is "x" | "y" | "z"
  boltCircle(group, axis, c, pcd, n, m, r = 6, h = 5, phase = 0) {
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2, u = Math.cos(a) * pcd / 2, v = Math.sin(a) * pcd / 2;
      const p = axis === "x" ? [c[0], c[1] + u, c[2] + v] : axis === "y" ? [c[0] + u, c[1], c[2] + v] : [c[0] + u, c[1] + v, c[2]];
      group.add(this.at(this.cylAxis(axis, r, h, m, 6), ...p));
    }
  }
  // a servo motor with its encoder cap and power/signal connector, axis along "x" | "y" | "z" from c, length len (+ direction)
  motor(group, axis, c, r, len, mats) {
    const d = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis], at = (t) => [c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t];
    group.add(this.at(this.cylAxis(axis, r + 6, 10, mats.trim), ...at(5)));                     // mounting flange
    group.add(this.at(this.cylAxis(axis, r, len, mats.motor, 6), ...at(10 + len / 2)));        // square-ish servo body
    group.add(this.at(this.cylAxis(axis, r * 0.88, 28, mats.black), ...at(10 + len + 14)));     // encoder cap
    group.add(this.at(this.cylAxis(axis, r * 0.55, 4, mats.black), ...at(10 + len + 30)));
    const up = axis === "z" ? [1, 0, 0] : [0, 0, 1], k = r + 10;
    group.add(this.at(this.boxMesh(axis === "x" ? 36 : 30, axis === "y" ? 36 : 30, axis === "z" ? 36 : 22, mats.black), ...[0, 1, 2].map((i) => at(10 + len * 0.55)[i] + up[i] * k)));
    group.add(this.at(this.cylAxis(axis === "z" ? "x" : "z", 9, 20, mats.chrome, 12), ...[0, 1, 2].map((i) => at(10 + len * 0.55)[i] + up[i] * (k + 18))));
  }

  // robot geometry built per link in its own frame (mm). The kinematics (ARM) are unchanged; this is only
  // what the arm looks like: castings, reducers, servo motors with encoder caps, bolts and a cable dress pack.
  buildRobot(style) {
    if (this.robot) { this.scene.remove(this.robot); }
    const root = new THREE.Group();
    const lm = () => ({
      body: this.mat(style.body, { roughness: 0.42, metalness: 0.1 }),
      trim: this.mat(style.trim, { roughness: 0.6, metalness: 0.25 }),
      motor: this.mat(0x2a2d31, { roughness: 0.5, metalness: 0.35 }),
      black: this.mat(0x16181b, { roughness: 0.7 }),
      chrome: this.mat(0xb7bec5, { metalness: 0.85, roughness: 0.25 }),
      plate: this.mat(0xd9dde1, { roughness: 0.5, metalness: 0.2 }),
    });
    const link = () => { const g = new THREE.Group(); g.matrixAutoUpdate = false; root.add(g); return g; };
    const L = [link(), link(), link(), link(), link(), link(), link()];
    const M = L.map(() => lm()); // own materials per link, so one axis can be highlighted on its own
    this.bodyMat = M[2].body; this.trimMat = M[2].trim;
    if (/collaborative/i.test(style.label || "")) this.buildCobot(L, M);
    else this.buildIndustrial(L, M);
    this.cables = [];
    this.buildEndEffector(L, M[6].trim, M[6].chrome);
    this.links = L;
    this.robot = root;
    this.scene.add(root);
    this.cablesBuilt = false;
    if (this.lastQ) this.setJoints(this.lastQ);
  }

  buildIndustrial(L, M) {
    const { a1, d1, a2, a3, d4, d6 } = ARM;
    // ---- L0 base: floor plate with anchor bolts, turned base casting, connector panel, name plate
    let m = M[0], g = L[0];
    g.add(this.castXY([[-195, -195, 45], [195, -195, 45], [195, 195, 45], [-195, 195, 45]], 0, 26, m.trim, 3));
    for (const [x, y] of [[-195, -195], [195, -195], [195, 195], [-195, 195]]) {
      g.add(this.at(this.cylZ(27, 4, m.chrome, 24), x, y, 28));
      g.add(this.at(this.cylZ(18, 14, m.chrome, 6), x, y, 37));
      g.add(this.at(this.cylZ(9, 6, m.chrome, 12), x, y, 47));
    }
    g.add(this.turned([[0, 0], [188, 0], [188, 12], [180, 22], [172, 150], [166, 172], [166, 186], [0, 186]], "z", [0, 0, 26], m.body, 56));
    g.add(this.at(new THREE.Mesh(new THREE.TorusGeometry(175 * S, 2 * S, 6, 64), m.black), 0, 0, 120));
    g.add(this.at(this.cylZ(160, 12, m.black, 56), 0, 0, 218));                        // J1 bearing seal
    // rear connector panel with two round connectors (power and signal)
    g.add(this.at(this.boxMesh(40, 190, 120, m.trim), -178, 0, 110));
    for (const y of [-48, 48]) { g.add(this.at(this.cylX(26, 8, m.chrome), -202, y, 110)); g.add(this.at(this.cylX(21, 34, m.black), -218, y, 110)); }
    g.add(this.at(this.boxMesh(4, 74, 44, m.plate), 170, 0, 120));                     // name plate, three rule lines
    for (const dz of [-10, 0, 10]) g.add(this.at(this.boxMesh(1, 54, 2, m.black), 172.5, 0, 120 + dz));
    // ---- L1 turret: turned skirt, J1 motor, shoulder tower, J2 reducer and motor
    m = M[1]; g = L[1];
    g.add(this.turned([[0, 0], [162, 0], [162, 30], [150, 44], [0, 44]], "z", [0, 0, 224], m.body, 56));
    this.boltCircle(g, "z", [0, 0, 268], 250, 12, m.chrome, 5, 4);
    g.add(this.castXZ([[a1, d1, 150], [-95, 268, 10], [230, 268, 10], [-60, 330, 40]], -60, 115, m.body, 10));
    this.motor(g, "z", [-110, -110, 268], 52, 120, m);                                  // J1 motor, vertical
    g.add(this.at(this.cylY(122, 22, m.trim, 48), a1, -71, d1));                       // J2 reducer housing
    this.boltCircle(g, "y", [a1, -82, d1], 210, 12, m.chrome, 5, 3);
    this.motor(g, "y", [a1, 115, d1], 60, 105, m);                                      // J2 motor on the far side of the tower
    g.add(this.at(this.boxMesh(14, 120, 160, m.trim), -150, 25, 420));                 // cable bracket on the tower back
    // ---- L2 upper arm: tapered casting beside the tower, hub caps with bolt circles, cable clamps
    m = M[2]; g = L[2];
    g.add(this.castXZ([[0, 0, 132], [0, a2, 100], [0, a2 * 0.5, 104]], -195, -82, m.body, 12));
    g.add(this.castXZ([[0, 150, 52], [0, a2 - 170, 44]], -203, -193, m.body, 3));     // raised stiffening rib
    g.add(this.at(this.cylY(96, 10, m.trim, 48), 0, -201, 0));
    this.boltCircle(g, "y", [0, -206, 0], 150, 10, m.chrome, 5, 3);
    g.add(this.at(this.cylY(76, 10, m.trim, 48), 0, -201, a2));
    this.boltCircle(g, "y", [0, -206, a2], 116, 8, m.chrome, 4, 3);
    for (const z of [250, 460]) g.add(this.at(this.boxMesh(40, 44, 26, m.black), -118, -140, z));
    // ---- L3 elbow housing: J3 reducer, housing that wraps the elbow, J3 motor, J4 motor at the back
    m = M[3]; g = L[3];
    g.add(this.at(this.cylY(94, 18, m.trim, 48), 0, -76, 0));                          // J3 reducer between arm and housing
    g.add(this.castXZ([[0, 0, 108], [-215, a3, 82], [165, a3, 92]], -67, 92, m.body, 10));
    this.motor(g, "y", [0, 92, 0], 62, 95, m);                                          // J3 motor on the axis
    this.motor(g, "x", [-297, 0, a3], 54, 70, m);                                       // J4 motor drives the forearm roll
    g.add(this.at(this.boxMesh(150, 70, 10, m.trim), -120, 0, a3 + 86));                // cable bracket on top
    this.boltCircle(g, "x", [257, 0, a3], 150, 8, m.chrome, 4, 3);
    // ---- L4 forearm (local z along the forearm): roll seal, turned tube, wrist fork
    m = M[4]; g = L[4];
    g.add(this.at(this.cylZ(88, 16, m.black, 48), 0, 0, 266));
    g.add(this.turned([[0, 0], [84, 0], [84, 14], [76, 34], [66, 230], [62, 260], [0, 260]], "z", [0, 0, 274], m.body, 48));
    for (const sy of [-1, 1]) g.add(this.castXZ([[0, d4, 62], [0, d4 - 115, 60]], sy > 0 ? 48 : -70, sy > 0 ? 70 : -48, m.body, 6));
    g.add(this.at(this.cylZ(60, 30, m.body, 40), 0, 0, d4 - 115));
    g.add(this.at(this.boxMesh(10, 90, 70, m.trim), -66, 0, d4 - 160));                 // J5/J6 drive cover
    for (const [y, z] of [[-34, -186], [34, -186], [-34, -134], [34, -134]]) g.add(this.at(this.cylX(4, 4, m.chrome, 6), -72, y, d4 + z));
    for (const sy of [-1, 1]) this.boltCircle(g, "y", [0, sy * 72, d4], 80, 6, m.chrome, 3.5, 3);
    // ---- L5 wrist: J5 hub between the fork plates, turned wrist nose
    m = M[5]; g = L[5];
    g.add(this.at(this.cylY(50, 92, m.trim, 40), 0, 0, 0));
    g.add(this.turned([[0, 0], [48, 0], [48, 34], [42, 58], [40, d6 - 12], [0, d6 - 12]], "z", [0, 0, 0], m.body, 40));
    // ---- L6 tool flange (ISO 9409-1-50-4-M6): four tapped holes and a dowel pin
    m = M[6]; g = L[6];
    g.add(this.at(this.cylZ(40, 12, m.chrome, 48), 0, 0, -6));
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; g.add(this.at(this.cylZ(3.2, 1, m.black, 12), Math.cos(a) * 25, Math.sin(a) * 25, 0.3)); }
    g.add(this.at(this.cylZ(3, 6, m.black, 12), 25, 0, 2));
    // ---- cable dress pack: from the base connector, up the tower and arm, over the elbow, along the forearm
    this.cableSpecs = [{ r: 13, mat: M[0].black, pts: [
      [0, [-236, 0, 110]], [0, [-280, 0, 170]], [1, [-170, 25, 300]], [1, [-165, 25, 470]], [1, [-120, -40, 560]],
      [2, [-118, -140, 250]], [2, [-118, -140, 460]], [2, [-80, -120, 600]], [3, [-120, 0, a3 + 105]], [3, [60, 0, a3 + 100]],
      [4, [-82, 0, 330]], [4, [-76, 0, 470]] ] }];
  }

  // a collaborative arm: round joint housings with coloured caps and round tubes, same kinematics
  buildCobot(L, M) {
    const { a1, d1, a2, a3, d4, d6 } = ARM;
    let m = M[0], g = L[0];
    g.add(this.turned([[0, 0], [120, 0], [120, 16], [96, 30], [92, 200], [0, 200]], "z", [0, 0, 0], m.body, 56));
    this.boltCircle(g, "z", [0, 0, 18], 200, 8, m.chrome, 5, 3);
    const joint = (grp, mm, axis, c, r, len) => {
      grp.add(this.at(this.cylAxis(axis, r, len, mm.body, 48), ...c));
      const d = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis];
      for (const sgn of [-1, 1]) grp.add(this.at(this.cylAxis(axis, r * 0.92, 10, mm.trim, 48), c[0] + d[0] * sgn * (len / 2 + 4), c[1] + d[1] * sgn * (len / 2 + 4), c[2] + d[2] * sgn * (len / 2 + 4)));
    };
    m = M[1]; g = L[1];
    joint(g, m, "z", [0, 0, 260], 92, 110);
    g.add(this.turned([[0, 0], [70, 0], [70, a1 + 10], [0, a1 + 10]], "x", [0, 0, d1], m.body, 40));
    joint(L[1], m, "y", [a1, 0, d1], 90, 170);
    m = M[2]; g = L[2];
    g.add(this.at(this.cylZ(62, a2 - 150, m.body, 40), 0, 0, a2 / 2));
    joint(g, m, "y", [0, 0, a2], 78, 150);
    m = M[3]; g = L[3];
    g.add(this.turned([[0, 0], [58, 0], [58, 260], [0, 260]], "x", [0, 0, a3], m.body, 40));
    g.add(this.at(this.cylZ(58, a3, m.body, 40), 0, 0, a3 / 2));
    m = M[4]; g = L[4];
    g.add(this.at(this.cylZ(54, d4 - 340, m.body, 40), 0, 0, 260 + (d4 - 340) / 2));
    joint(g, m, "z", [0, 0, d4 - 60], 60, 70);
    m = M[5]; g = L[5];
    joint(g, m, "y", [0, 0, 0], 56, 120);
    g.add(this.at(this.cylZ(48, d6 - 30, m.body, 40), 0, 0, (d6 - 30) / 2));
    m = M[6]; g = L[6];
    g.add(this.at(this.cylZ(42, 18, m.trim, 48), 0, 0, -9));
    g.add(this.at(this.cylZ(32, 4, m.chrome, 48), 0, 0, 1));
    this.cableSpecs = [];
  }

  cylX(r, h, m, seg = 32) { return this.cylZ(r, h, m, seg).rotateY(Math.PI / 2); }

  // cables follow the arm: each point is [link, local mm]; rebuilt as a tube every pose
  updateCables(F) {
    if (!this.cableSpecs) return;
    this.cableSpecs.forEach((c, i) => {
      const pts = c.pts.map(([li, p]) => { const w = Vec.add(F[li].p, Mat.mv(F[li].R, p)); return new THREE.Vector3(w[0] * S, w[1] * S, w[2] * S); });
      const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      const geo = new THREE.TubeGeometry(curve, pts.length * 6, c.r * S, 10, false);
      if (!this.cables[i]) { this.cables[i] = new THREE.Mesh(geo, c.mat); this.cables[i].castShadow = true; this.robot.add(this.cables[i]); }
      else { this.cables[i].geometry.dispose(); this.cables[i].geometry = geo; }
    });
  }

  buildEndEffector(L, trim, chrome) {
    const grip = new THREE.Group();
    grip.add(this.at(this.boxMesh(110, 70, 70, trim), 0, 0, 35));
    grip.add(this.at(this.cylZ(18, 14, chrome), 0, 0, 77));
    const fm = this.mat(0x9aa3ab, { metalness: 0.6, roughness: 0.35 });
    this.fingerA = this.at(this.boxMesh(16, 44, 95, fm), 40, 0, 110);
    this.fingerB = this.at(this.boxMesh(16, 44, 95, fm), -40, 0, 110);
    grip.add(this.fingerA, this.fingerB);
    this.tcpDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0x0b7a75 }));
    this.tcpDot.position.set(0, 0, 160 * S);
    grip.add(this.tcpDot);
    L[6].add(grip);
    this.gripper = grip;
  }

  setGripper(gap) { // gap in mm between finger inner faces
    if (!this.fingerA) return;
    this.fingerA.position.x = (gap / 2 + 8) * S; this.fingerB.position.x = -(gap / 2 + 8) * S;
  }

  setJoints(q) {
    if (!this.ok || !this.links.length) return;
    // the pose is set every frame: skip the work while the arm stands still (cables are rebuilt only on motion)
    if (this.lastQ && this.cablesBuilt && q.every((v, i) => v === this.lastQ[i])) return;
    this.lastQ = q.slice();
    const F = fkFrames(q);
    F.forEach((P, i) => {
      const R = P.R, p = P.p;
      this.links[i].matrix.set(R[0], R[1], R[2], p[0] * S, R[3], R[4], R[5], p[1] * S, R[6], R[7], R[8], p[2] * S, 0, 0, 0, 1);
      this.links[i].matrixWorldNeedsUpdate = true;
    });
    this.updateCables(F);
    this.cablesBuilt = true;
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
