"use strict";
// 3D hydraulic-cylinder welding cell built on the shared Cell3D renderer.

class WeldScene extends Cell3D {
  constructor(canvas, colors) {
    super(canvas, colors);
    if (!this.ok) return;
    this.orbit = { target: new THREE.Vector3(0.45, -0.1, 0.65), dist: 4.4, az: -0.75, el: 0.38 };
    this.highlighted = null;
    this.buildFX();
    this.bindPick();
  }

  // component registry: id -> { group, center }
  comp(id, group, center) {
    this.comps = this.comps || {};
    group.userData.cid = id;
    this.comps[id] = { group, center: center || null };
    return group;
  }
  groupAt(id, x, y, z, center) { const g = new THREE.Group(); g.position.set(x * S, y * S, z * S); this.scene.add(g); return this.comp(id, g, center || [x, y, z]); }

  buildCell() {
    const steel = this.mat(0x7c8790, { metalness: 0.5, roughness: 0.4 });
    const dark = this.mat(0x2b3137, { roughness: 0.7 });
    const add = (g, o) => (g.add(o), o);
    const C = WELD.axisC;

    // ---- positioner: bed, headstock with faceplate, tailstock with pneumatic quill
    const pos = this.groupAt("positioner", 0, 0, 0, [C[0], -560, 500]);
    const posMat = this.mat(0x3d5a73, { roughness: 0.55 });
    add(pos, this.at(this.boxMesh(260, 1300, 120, posMat), C[0], -100, 60));
    add(pos, this.at(this.boxMesh(300, 220, C[2] - 60, posMat), C[0], -650, (C[2] - 60) / 2 + 60));
    add(pos, this.at(this.cylY(120, 120, dark), C[0], -660, C[2]));
    const gnd = this.groupAt("ground", C[0] + 150, -600, C[2] - 140);
    add(gnd, this.at(this.boxMesh(50, 60, 40, this.mat(0xb8743b, { metalness: 0.7, roughness: 0.3 })), 0, 0, 0));
    add(gnd, this.at(this.cylZ(10, 180, dark), 20, 0, -110));
    const tail = this.groupAt("tailstock", 0, 0, 0, [C[0], WELD.tubeY1 + 200, C[2]]);
    // the quill's centre enters the Ø50 bore at the gland end of the tube
    const ty = WELD.tubeY1 + 18;
    add(tail, this.at(this.boxMesh(240, 200, C[2] - 60, posMat), C[0], ty + 230, (C[2] - 60) / 2 + 60));
    add(tail, this.at(this.cylY(70, 140, steel), C[0], ty + 190, C[2]));
    this.quill = new THREE.Group(); tail.add(this.quill);
    add(this.quill, this.at(this.cylY(30, 120, steel), C[0], ty + 80, C[2]));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(30 * S, 50 * S, 24), steel); cone.rotation.x = Math.PI; cone.position.set(C[0] * S, (ty + 5) * S, C[2] * S); cone.castShadow = true;
    add(this.quill, cone);
    this.sensorLamp = this.mat(0x333a40, {});
    add(tail, this.at(this.boxMesh(26, 40, 26, this.sensorLamp), C[0] + 85, ty + 170, C[2] + 60));

    // ---- rotating faceplate + part
    this.rotor = new THREE.Group(); this.rotor.position.set(C[0] * S, C[1] * S, C[2] * S); this.scene.add(this.rotor);
    this.comp("faceplate", this.rotor, [C[0], -560, C[2]]);
    add(this.rotor, this.at(this.cylY(120, 30, this.mat(0x5d6b78, { metalness: 0.4 })), 0, -560, 0));
    // sy is the joint line (tube face = CEC face); the U-groove is centred on it and the wire aims there
    const D = WELD.drawing, sy = WELD.seamY, pinY = sy - D.pinFromSeam;
    // clevis fixture: a fork on the faceplate and a locating pin through the CEC's Ø19.6 hole
    for (const sx of [-1, 1]) add(this.rotor, this.at(this.boxMesh(10, -545 - pinY + 26, 58, steel), sx * (D.clevisW / 2 + 7), (-545 + pinY - 26) / 2, 0));
    const pin = this.cylY(D.pinHole / 2 - 0.3, D.clevisW + 34, steel, 20); pin.rotation.z = Math.PI / 2; pin.position.set(0, pinY * S, 0); this.rotor.add(pin);
    this.part = new THREE.Group(); this.rotor.add(this.part);
    this.comp("part", this.part, [C[0], sy + 60, C[2]]);
    const tubeMat = this.mat(0xb4bcc3, { metalness: 0.25, roughness: 0.45, side: THREE.DoubleSide });
    const capMat = this.mat(0x98a1a9, { metalness: 0.25, roughness: 0.5, side: THREE.DoubleSide });
    const lathe = (pts, mat) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * S, y * S)), 64); const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m; };
    const Ro = WELD.R, Rb = WELD.bore, Rc = D.counterbore / 2, cd = D.counterboreDepth, g = D.groove;
    // J prep (half of the U-groove) on a member, mirrored by side: +1 tube, -1 CEC.
    // Root land up to r = bore + 3.1, R3 arc centred on the joint line, then a 2° wall to the OD.
    const rootR = Rb + g.land, rc = rootR + g.rootR, half = g.includedDeg / 2 * DEG;
    const jprep = (side) => {
      const pts = [[rootR, sy]];
      for (let i = 1; i <= 10; i++) { const t = (i / 10) * Math.PI / 2; pts.push([rc - g.rootR * Math.cos(t), sy + side * g.rootR * Math.sin(t)]); }
      pts.push([Ro, sy + side * (g.rootR + (Ro - rc) * Math.tan(half))]);
      return pts;
    };
    // tube Ø65 x Ø50: Ø51 counterbore for the CEC spigot, root land, J prep
    this.part.add(lathe([[Rc, sy], ...jprep(1), [Ro, WELD.tubeY1], [Rb, WELD.tubeY1], [Rb, sy + cd], [Rc, sy + cd], [Rc, sy]], tubeMat));
    // CEC: spigot in the counterbore, root land on the tube face, J prep, body Ø65
    this.part.add(lathe([[0, sy + cd - 0.2], [Rc - 0.2, sy + cd - 0.2], [Rc - 0.2, sy], ...jprep(-1), [Ro, sy - D.cecBody + 1], [Ro - 1, sy - D.cecBody], [0, sy - D.cecBody]], capMat));
    // dark root of the open groove, so it reads before welding
    const groove = lathe([[rootR + 0.25, sy + 1.6], [rootR + 0.25, sy - 1.6]], this.mat(0x2a2d30, { roughness: 0.9, side: THREE.DoubleSide }));
    this.part.add(groove); this.groove = groove;
    // clevis tongue (31.75 wide, R19 eye) with the Ø19.6 pin hole
    const tongue = this.at(this.boxMesh(D.clevisW, D.pinFromSeam - D.cecBody, D.eyeR * 2, capMat), 0, sy - (D.cecBody + D.pinFromSeam) / 2, 0); this.part.add(tongue);
    const eye = this.cylY(D.eyeR, D.clevisW, capMat, 32); eye.rotation.z = Math.PI / 2; eye.position.set(0, pinY * S, 0); this.part.add(eye);
    // gland end: M54x2 thread stub and a service port boss 67 mm from the CEC end of the tube
    const thread = lathe([[Rb, WELD.tubeY1], [27, WELD.tubeY1], [27, WELD.tubeY1 + 18], [Rb, WELD.tubeY1 + 18]], this.mat(0x8d969e, { metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide }));
    this.part.add(thread);
    const boss = this.at(this.cylZ(9, 10, capMat), 0, sy + 67, Ro + 4); this.part.add(boss);
    // weld bead as instanced spheres in part coordinates
    this.beadMax = 1200;
    this.bead = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.35 }), this.beadMax);
    this.bead.count = 0; this.bead.castShadow = true;
    this.part.add(this.bead);

    // ---- controller cabinet with pendant and mode switch
    const ctrl = this.groupAt("controller", -720, -700, 0, [-720, -700, 600]);
    add(ctrl, this.at(this.boxMesh(560, 480, 1150, this.mat(0xd8d2c4, { roughness: 0.7 })), 0, 0, 575));
    add(ctrl, this.at(this.boxMesh(10, 300, 200, dark), 285, -60, 900));
    const ms = this.groupAt("modeswitch", -720 + 290, -700 + 120, 1000);
    add(ms, this.at(this.cylY(22, 14, this.mat(0x111111)).rotateZ(Math.PI / 2), 0, 0, 0));
    add(ms, this.at(this.cylY(24, 16, this.mat(0xe0261c)).rotateZ(Math.PI / 2), 0, 50, -80));
    const tp = this.groupAt("pendant", -720 + 300, -700 - 140, 820);
    add(tp, this.at(this.boxMesh(50, 260, 330, this.mat(0x262a2f)), 0, 0, 0));
    add(tp, this.at(this.boxMesh(8, 190, 140, this.mat(0x2d6bc0, { emissive: 0x16345e })), 28, 0, 60));
    // ---- welding power source and wire drum
    const ps = this.groupAt("powersource", -720, -100, 0, [-720, -100, 450]);
    add(ps, this.at(this.boxMesh(420, 560, 820, this.mat(0x2f6f9e, { roughness: 0.6 })), 0, 0, 410));
    add(ps, this.at(this.boxMesh(10, 300, 120, this.mat(0x0d1a12, { emissive: 0x0b3a1c })), 215, 0, 650));
    const drum = this.groupAt("wiredrum", -700, 480, 0, [-700, 480, 300]);
    add(drum, this.at(this.cylZ(260, 520, this.mat(0x6b4f2f, { roughness: 0.8 }), 40), 0, 0, 260));
    add(drum, this.at(this.cylZ(60, 160, dark), 0, 0, 600));
    const gas = this.groupAt("gas", -380, 820, 0, [-380, 820, 800]);
    add(gas, this.at(this.cylZ(115, 1400, this.mat(0x4c8a55, { roughness: 0.5 }), 32), 0, 0, 700));
    add(gas, this.at(this.cylZ(60, 120, steel), 0, 0, 1460));
    add(gas, this.at(this.boxMesh(80, 60, 60, this.mat(0xc9b037, { metalness: 0.6 })), 70, 0, 1500));
    // ---- torch cleaning station (reamer)
    const ream = this.groupAt("reamer", 300, 760, 0, [300, 760, 500]);
    add(ream, this.at(this.boxMesh(260, 260, 900, this.mat(0x5b5f66)), 0, 0, 450));
    add(ream, this.at(this.cylZ(40, 60, dark), 0, 0, 930));
    // ---- fume hood
    const hood = this.groupAt("fume", C[0], -150, 1700, [C[0], -150, 1700]);
    add(hood, this.at(this.boxMesh(700, 1100, 90, this.mat(0xb7bec4, { metalness: 0.3 })), 0, 0, 0));
    add(hood, this.at(this.cylZ(140, 600, this.mat(0xb7bec4, { metalness: 0.3 })), 0, 0, 340));
    // ---- fence, door, light curtain
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xe0a106, roughness: 0.6 });
    const meshMat = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
    const fence = this.groupAt("fence", 0, 0, 0, [400, 1100, 900]);
    const panel = (x0, y0, x1, y1) => {
      const L = Math.hypot(x1 - x0, y1 - y0), g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.PlaneGeometry(L * S, 1800 * S), meshMat);
      m.rotation.x = Math.PI / 2; g.add(m); m.position.z = 900 * S;
      g.position.set((x0 + x1) / 2 * S, (y0 + y1) / 2 * S, 0); g.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      const top = this.boxMesh(L, 30, 30, fenceMat); top.position.z = 1800 * S; g.add(top);
      return g;
    };
    const posts = [[-1050, -1150], [-1050, 1150], [1550, 1150], [1550, -1150]];
    posts.forEach(([x, y]) => fence.add(this.at(this.boxMesh(50, 50, 1820, fenceMat), x, y, 910)));
    fence.add(panel(-1050, -1150, -1050, 1150), panel(-1050, 1150, 1550, 1150), panel(-1050, -1150, 1550, -1150), panel(1550, 500, 1550, 1150));
    // door on the front-left
    this.doorPivot = new THREE.Group(); this.doorPivot.position.set(1550 * S, -1150 * S, 0); this.scene.add(this.doorPivot);
    this.comp("door", this.doorPivot, [1550, -820, 900]);
    const door = panel(0, 0, 0, 650); this.doorPivot.add(door);
    door.add(this.at(this.boxMesh(40, 40, 80, this.mat(0x222222)), 0, 600, 1000));
    // light curtain on the load opening
    const cur = this.groupAt("curtain", 1550, 0, 0, [1550, 50, 800]);
    cur.add(this.at(this.boxMesh(50, 50, 1500, this.mat(0x2b2b2b)), 0, -460, 750));
    cur.add(this.at(this.boxMesh(50, 50, 1500, this.mat(0x2b2b2b)), 0, 470, 750));
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.35 });
    for (let z = 250; z <= 1450; z += 120) cur.add(this.at(this.boxMesh(4, 920, 4, this.beamMat), 0, 5, z));
    // ---- operator station: panel, tower light, PLC
    const op = this.groupAt("panel", 1850, -700, 0, [1850, -700, 1000]);
    op.add(this.at(this.boxMesh(80, 80, 1000, steel), 0, 0, 500));
    op.add(this.at(this.boxMesh(260, 360, 260, this.mat(0xd8d2c4)), 0, 0, 1130));
    this.btnMesh = {};
    [["start", 0x2fbf5f, -110], ["stop", 0xe0261c, -40], ["clamp", 0x2d7fd1, 40], ["unclamp", 0xe0a106, 110]].forEach(([n, c, y]) => {
      const b = this.at(this.cylY(22, 20, this.mat(c, { emissive: 0x000000 })).rotateZ(Math.PI / 2), -135, y, 1160);
      op.add(b); this.btnMesh[n] = b;
    });
    const tower = this.groupAt("tower", 1850, -700, 1260, [1850, -700, 1450]);
    this.tower = {};
    [["red", 0xe0261c, 0], ["amber", 0xe0a106, 1], ["green", 0x2fbf5f, 2]].forEach(([n, c, i]) => {
      const m = this.mat(c, { emissive: 0x000000, transparent: true, opacity: 0.9 });
      tower.add(this.at(this.cylZ(45, 80, m), 0, 0, 340 - i * 84 + 40)); this.tower[n] = { m, c };
    });
    tower.add(this.at(this.cylZ(20, 160, steel), 0, 0, 80));
    const plc = this.groupAt("plc", 1850, -1000, 0, [1850, -1000, 900]);
    plc.add(this.at(this.boxMesh(300, 220, 500, this.mat(0x9aa3ab)), 0, 0, 900));
    for (let i = 0; i < 6; i++) plc.add(this.at(this.boxMesh(14, 28, 200, this.mat(i === 0 ? 0x2d7fd1 : 0x3a3f45)), -155, (i - 2.5) * 34, 900));
  }

  buildFrames() {
    this.fBase = this.axes(0.3);
    this.fTool = this.axes(0.12);
    this.fUser = this.axes(0.2);
    this.setPose(this.fUser, WELD.frames[1].pose);
  }

  buildRobot(style) {
    super.buildRobot(style);
    const ids = ["base", "axis1", "axis2", "axis3", "axis4", "axis5", "axis6"];
    this.links.forEach((L, i) => {
      L.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); }); // own materials so one axis can glow alone
      this.comp(ids[i], L, null);
    });
    // wire feeder rides on the forearm housing
    const feeder = new THREE.Group();
    feeder.add(this.at(this.boxMesh(200, 130, 150, this.mat(0x2f6f9e)), -150, 0, ARM.a3 + 170));
    feeder.add(this.at(this.cylY(55, 40, this.mat(0x6b4f2f)), -150, 80, ARM.a3 + 170));
    this.links[3].add(feeder);
    this.comp("feeder", feeder, null);
    this.feederGroup = feeder;
  }

  buildEndEffector(L, trim, chrome) {
    const torch = new THREE.Group();
    const body = this.mat(0x2b2f33, { roughness: 0.55 });
    torch.add(this.at(this.cylZ(24, 180, body), 0, 0, 90));
    torch.add(this.at(this.boxMesh(70, 90, 50, trim), 0, 0, 25)); // anti-collision mount
    const neck = new THREE.Group(); neck.position.set(0, 0, 180 * S); neck.rotation.y = 30 * DEG;
    const copper = this.mat(0xc27a3f, { metalness: 0.85, roughness: 0.3 });
    neck.add(this.at(this.cylZ(14, 105, this.mat(0x3a3f45, { metalness: 0.4 })), 0, 0, 52));
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(9 * S, 15 * S, 32 * S, 24), copper); nozzle.rotation.x = Math.PI / 2; nozzle.position.z = 121 * S; neck.add(nozzle);
    neck.add(this.at(this.cylZ(4, 10, this.mat(0xd9a066, { metalness: 0.9 })), 0, 0, 138));
    neck.add(this.at(this.cylZ(0.9, 15, this.mat(0xd8dde2, { metalness: 0.9, roughness: 0.2 })), 0, 0, 142.5));
    this.tip = new THREE.Object3D(); this.tip.position.z = 150 * S; neck.add(this.tip);
    this.tcpDot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0x35b6ad }));
    this.tip.add(this.tcpDot);
    torch.add(neck);
    L[6].add(torch);
    this.comp("torch", torch, null);
    this.gripper = torch;
  }

  buildFX() {
    this.arcLight = new THREE.PointLight(0x9fc7ff, 0, 2.5, 2);
    this.scene.add(this.arcLight);
    this.arcGlow = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.arcGlow);
    const n = 160;
    this.sparkPos = new Float32Array(n * 3); this.sparkVel = new Float32Array(n * 3); this.sparkLife = new Float32Array(n);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffb347, size: 0.008, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
  }

  // ---- per-frame state from the world ----
  update(world, dt, t) {
    if (!this.ok) return;
    this.setJoints(world.q);
    this.rotor.rotation.y = world.e1 * DEG;
    this.quill.position.y = (60 - 60 * world.part.clampPos) * S;
    this.doorPivot.rotation.z = world.doorClosed ? 0 : -1.25;
    this.beamMat.opacity = world.curtainClear ? 0.25 : 0.85;
    this.beamMat.color.set(world.curtainClear ? 0xff3b30 : 0xffe14d);
    this.sensorLamp.emissive.set(world.plc.X.X4 ? 0x2fbf5f : 0x000000);
    const Y = world.plc.Y;
    for (const [n, on] of [["red", Y.Y5], ["amber", Y.Y4], ["green", Y.Y3]]) this.tower[n].m.emissive.set(on ? this.tower[n].c : 0x000000);
    for (const n of ["start", "stop", "clamp", "unclamp"]) this.btnMesh[n].material.emissive.set(world.btn[n] ? 0x666666 : 0x000000);
    this.part.visible = world.part.loaded;
    // arc
    const on = world.arc.phase === "on" || world.arc.phase === "strike" || world.arc.phase === "crater";
    const tipW = new THREE.Vector3(); this.tip.getWorldPosition(tipW);
    this.arcGlow.position.copy(tipW); this.arcLight.position.copy(tipW);
    const flick = on ? 0.75 + Math.random() * 0.5 : 0;
    this.arcLight.intensity = (world.arc.phase === "on" ? 3.2 : on ? 1.4 : 0) * flick;
    this.arcGlow.material.opacity = on ? 0.6 + Math.random() * 0.4 : 0;
    this.arcGlow.scale.setScalar(on ? 1 + Math.random() * 0.8 : 1);
    // sparks
    const P = this.sparkPos, V = this.sparkVel, Lf = this.sparkLife;
    for (let i = 0; i < Lf.length; i++) {
      if (Lf[i] <= 0) {
        if (world.arc.phase === "on" && Math.random() < 0.25) {
          Lf[i] = 0.3 + Math.random() * 0.5;
          P[i * 3] = tipW.x; P[i * 3 + 1] = tipW.y; P[i * 3 + 2] = tipW.z;
          V[i * 3] = (Math.random() - 0.5) * 1.6; V[i * 3 + 1] = (Math.random() - 0.5) * 1.6; V[i * 3 + 2] = Math.random() * 1.4;
        } else { P[i * 3 + 2] = -10; continue; }
      }
      Lf[i] -= dt; V[i * 3 + 2] -= 9.8 * dt;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 2] < 0) Lf[i] = 0;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.setPose(this.fTool, world.tcpTaught());
    if (this.highlighted) {
      const k = 0.35 + 0.35 * Math.sin(t * 6);
      this.eachMat(this.highlighted, (m) => m.emissive && m.emissive.setRGB(0.05 * k, 0.55 * k, 0.5 * k));
    }
  }

  syncBeads(beads) {
    if (!this.ok) return;
    const cols = { good: 0xc9b9a0, undercut: 0xd9a35a, fast: 0xa9b6c4, slow: 0x8f6b4a, stickout: 0x9a8a6a, lof: 0x6a7480, porosity: 0x3b3b3b, underfill: 0x7d8a96, overfill: 0xb08a50 };
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const start = this.bead.count, n = Math.min(beads.length, this.beadMax);
    if (n < start) this.bead.count = 0;
    for (let i = this.bead.count; i < n; i++) {
      const b = beads[i];
      const r = (WELD.R - 0.8) * S, a = b.ang * DEG, w = b.width / 2 * S;
      m.compose(new THREE.Vector3(Math.sin(a) * r, (WELD.seamY + b.lat) * S, Math.cos(a) * r), new THREE.Quaternion(), new THREE.Vector3(w, w * (b.grade === "fast" ? 0.6 : 1), w * 0.7));
      this.bead.setMatrixAt(i, m);
      this.bead.setColorAt(i, c.set(cols[b.grade] || 0xcccccc));
    }
    this.bead.count = n;
    this.bead.instanceMatrix.needsUpdate = true;
    if (this.bead.instanceColor) this.bead.instanceColor.needsUpdate = true;
  }

  // ---- picking and highlighting ----
  bindPick() {
    const el = this.canvas;
    let down = null;
    el.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = el.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
      const hits = rc.intersectObjects(this.scene.children, true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.cid) o = o.parent;
        if (!o || o.userData.cid === "fence") continue;
        if (this.onPick) this.onPick(o.userData.cid);
        return;
      }
    });
  }
  eachMat(id, fn) {
    const c = this.comps[id]; if (!c) return;
    c.group.traverse((o) => { if (o.isMesh && o.material && o !== this.bead) fn(o.material); });
  }
  highlight(id) {
    if (this.highlighted) this.eachMat(this.highlighted, (m) => m.emissive && m.emissive.set(m.userData.baseEmissive ?? 0x000000));
    this.highlighted = id && this.comps[id] ? id : null;
    if (this.highlighted) this.eachMat(id, (m) => { if (m.userData.baseEmissive == null && m.emissive) m.userData.baseEmissive = m.emissive.getHex(); });
  }
  centerOf(id) {
    const c = this.comps[id]; if (!c) return null;
    if (c.center) return c.center;
    const v = new THREE.Vector3(); new THREE.Box3().setFromObject(c.group).getCenter(v);
    return [v.x / S, v.y / S, v.z / S];
  }
  focus(id, dist) {
    const p = this.centerOf(id); if (!p) return;
    const c = this.comps[id];
    if (c) { const sz = new THREE.Vector3(); new THREE.Box3().setFromObject(c.group).getSize(sz); const big = Math.max(sz.x, sz.y, sz.z); if (isFinite(big) && big > 0) dist = Math.max(dist || 0, Math.min(5, big * 2.6 + 0.8)); }
    this.anim = { from: { t: this.orbit.target.clone(), d: this.orbit.dist }, to: { t: new THREE.Vector3(p[0] * S, p[1] * S, p[2] * S), d: dist || 2.2 }, k: 0 };
  }
  render(phase) {
    if (this.anim) {
      const a = this.anim; a.k = Math.min(1, a.k + 0.04);
      const e = a.k * a.k * (3 - 2 * a.k);
      this.orbit.target.lerpVectors(a.from.t, a.to.t, e);
      this.orbit.dist = a.from.d + (a.to.d - a.from.d) * e;
      if (a.k >= 1) this.anim = null;
    }
    // keep the whole cell in frame when the view is tall and narrow (phones, side panels)
    const asp = this.camera.aspect || 1.5, k = asp < 1.3 ? Math.min(2.2, 1.3 / asp) : 1;
    const d = this.orbit.dist; this.orbit.dist = d * k;
    super.render(phase || 0);
    this.orbit.dist = d;
  }
  view(name) {
    if (name === "iso") { this.orbit = { target: new THREE.Vector3(0.45, -0.1, 0.65), dist: 4.4, az: -0.75, el: 0.38 }; return; }
    if (name === "weld") { const C = WELD.axisC; this.orbit = { target: new THREE.Vector3(C[0] * S - 0.02, (WELD.seamY + 20) * S, (C[2] + 40) * S), dist: 0.6, az: 0.35, el: 0.55 }; return; }
    if (name === "joint") { const C = WELD.axisC; this.orbit = { target: new THREE.Vector3(C[0] * S, (WELD.seamY + 10) * S, C[2] * S), dist: 0.26, az: 0.75, el: 0.5 }; return; }
    super.view(name);
  }
}
