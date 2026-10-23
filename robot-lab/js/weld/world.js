"use strict";
// Simulated welding cell: robot + positioner state, safety chain, alarms, arc process, weld quality,
// clamp fixture and the cell PLC. The VM drives it through the same interface as the pick-and-place cell.

const ALARMS = {
  "SRVO-001": { text: "Operator panel E-stop", servo: true, cause: "The E-stop on the controller cabinet is pressed.", fix: "Find out why it was pressed, make the cell safe, twist to release the button, then press RESET." },
  "SRVO-002": { text: "Teach pendant E-stop", servo: true, cause: "The E-stop on the teach pendant is pressed.", fix: "Twist to release the pendant E-stop, then press RESET." },
  "SRVO-003": { text: "Deadman switch released", servo: true, cause: "The pendant is ON but the enabling (deadman) switch is not held in the middle position.", fix: "Hold the enabling switch in the middle position and press RESET. To run in AUTO, turn the pendant OFF." },
  "SRVO-004": { text: "Fence open", servo: true, cause: "The safety fence door was opened while the controller was in AUTO.", fix: "Close the door. If it is closed, check the door switch and its wiring at the PLC input. Then press RESET." },
  "SRVO-007": { text: "External emergency stops", servo: true, cause: "An external safety device (here the light curtain at the load station) tripped in AUTO.", fix: "Clear the light curtain, find out who reached in, then press RESET." },
  "SRVO-050": { text: "Collision Detection alarm", servo: true, cause: "The motors felt an unexpected load: the torch hit the part or fixture.", fix: "Jog clear in T1, inspect the torch and neck for damage, run a TCP check, then fix the point that caused the crash." },
  "SRVO-065": { text: "BLAL alarm (Battery low)", servo: false, cause: "The pulse-coder backup battery is low. If it goes flat with power off, the robot loses its position (mastering).", fix: "Replace the batteries WITH CONTROLLER POWER ON so the encoder counts are kept. Then press RESET." },
  "MOTN-017": { text: "Limit error", servo: false, cause: "A target needs an axis beyond its software limit.", fix: "Re-teach the point with a different wrist posture, or add an intermediate point." },
  "MOTN-018": { text: "Position not reachable", servo: false, cause: "The target is outside the arm's reach.", fix: "Re-teach the point inside the work envelope, or move the part/positioner." },
  "MOTN-023": { text: "In singularity", servo: false, cause: "A linear move passes axis 5 through 0 degrees.", fix: "Change the torch orientation or use a joint move through that region." },
  "ARC-013": { text: "Arc Start failed", servo: false, cause: "No arc was detected within the start time: no current is flowing.", fix: "Check the earth (ground) clamp, the wire feed and the contact tip. Cut the wire to the right stickout and retry." },
  "ARC-018": { text: "Lost arc detect", servo: false, cause: "The arc went out during the weld, usually from too much stickout or the torch leaving the part.", fix: "Check the torch-to-work distance along the whole seam and re-teach the weld points." },
  "INTP-": { text: "", servo: false },
};

class WeldWorld {
  constructor() {
    this.mode = "T1"; this.tpOn = true; this.deadman = false; this.shift = false;
    this.estopTP = false; this.estopPanel = false;
    this.override = 0.3; this.timeLapse = 1;
    this.weldEnable = false; this.doorClosed = true; this.curtainClear = true;
    this.faults = {};
    this.history = [];
    this.alarms = [];
    this.listeners = {};
    this.reset();
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  reset() {
    this.q = WELD.homeQ.slice(); this.e1 = 0;
    this.tool = WELD.tools[1].tcp; this.toolIdx = 1;
    this.frame = WELD.frames[0].pose; this.frameIdx = 0;
    this.dout = new Array(9).fill(false);
    this.dsim = new Array(9).fill(null); // simulated (forced) inputs
    this.servoOn = true;
    this.arc = { phase: "off", t: 0, sched: 1, volts: 0, amps: 0 };
    this.weave = null;
    this.wireInch = 0;
    this.pulses = [];
    this.part = { loaded: true, clampPos: 0, beads: [], lastLocal: null, travel: 0 };
    this.plc = { X: {}, M: {}, Y: {}, scanT: 1, scans: 0, startEdge: false };
    this.coordRadius = WELD.R;
    this.stepPLC(0);
  }
  newPart() { this.part = { loaded: true, clampPos: 0, beads: [], lastLocal: null, travel: 0 }; this.e1 = 0; this.emit("part"); }

  // ---------------------------------------------------------------- VM interface
  // the controller plans with the taught tool; a bent torch only changes where the real wire tip goes
  toolPose() { return this.tool; }
  physicalTool() {
    if (this.toolIdx === 1 && this.faults.tcpBent) return Pose.mul(this.tool, { type: "pose", p: this.faults.tcpBent, R: Mat.I() });
    return this.tool;
  }
  get speedCap() { return this.mode === "T1" ? WELD.tLimit : Infinity; }
  speedScale() { return this.override * this.timeLapse; }
  frameIndex() { return this.frameIdx; }
  tcpWorld(q = this.q) { return Pose.mul(fkFlange(q), this.physicalTool()); }
  // what the controller *believes* the TCP is (taught tool data, not the bent one)
  tcpTaught(q = this.q) { return Pose.mul(fkFlange(q), this.tool); }
  currentPose() { const P = Pose.mul(Pose.inv(this.frame), this.tcpTaught()); P.e1 = this.e1; return P; }
  toWorld(T) {
    let f = this.frame;
    if (T.frame != null) { if (!WELD.frames[T.frame]) throw new RobotError(`User frame ${T.frame} is not set up (UF 0 world, UF 1 positioner).`, this.line); f = WELD.frames[T.frame].pose; }
    const P = Pose.mul(f, T); P.e1 = T.e1; return P;
  }
  setTool(v, line) {
    if (typeof v === "number") {
      if (!WELD.tools[v]) throw new RobotError(`UTOOL ${v} is not set up. This cell has UT 0 (flange) and UT 1 (torch).`, line);
      this.tool = WELD.tools[v].tcp; this.toolIdx = v;
    } else throw new RobotError("UTOOL_NUM needs a tool number.", line);
  }
  setFrame(v, line) {
    if (typeof v === "number") {
      if (!WELD.frames[v]) throw new RobotError(`UFRAME ${v} is not set up. This cell has UF 0 (world) and UF 1 (positioner).`, line);
      this.frame = WELD.frames[v].pose; this.frameIdx = v;
    } else throw new RobotError("UFRAME_NUM needs a frame number.", line);
  }
  rawDI(n) {
    if (n === 1) return !!this.plc.Y.Y1; // cycle start from PLC
    if (n === 2) return !!this.plc.Y.Y2; // clamp OK from PLC
    if (n === 3) return this.part.loaded; // part present (direct sensor)
    if (n === 4) return this.arc.phase === "on"; // arc detect from the power source
    if (n === 5) return !this.faults.gasEmpty; // gas pressure OK
    return false;
  }
  getDI(n, line) {
    if (n < 1 || n > 8) throw new RobotError(`DI[${n}] is not assigned in this cell (DI[1] to DI[8]).`, line);
    return this.dsim[n] != null ? this.dsim[n] : this.rawDI(n);
  }
  getDO(n, line) { if (n < 1 || n > 8) throw new RobotError(`DO[${n}] is not assigned (DO[1] to DO[8]).`, line); return this.dout[n]; }
  setDO(n, v, line) { if (n < 1 || n > 8) throw new RobotError(`DO[${n}] is not assigned (DO[1] to DO[8]).`, line); this.dout[n] = !!v; }
  pulseDO(n, line, sec) { this.setDO(n, true, line); this.pulses.push({ n, t: sec || 0.5 }); }
  setOverride(pct) { this.override = Math.max(0.01, Math.min(1, pct / 100)); this.emit("override"); }
  fn(name) { if (name === "weldspeed") { const s = WELD.schedules[this.arc.sched] || WELD.schedules[1]; return s.speed; } return undefined; }
  log(m, kind) { this.emit("log", m, kind); }
  onLine(l) { this.line = l; this.emit("line", l); }
  onError(e) { this.emit("fault", e); }
  onDone(t) { this.emit("done", t); }

  partPose(e1 = this.e1) { return Pose.mul(WELD.frames[1].pose, { type: "pose", p: [0, 0, 0], R: Mat.ry(e1 * DEG) }); }

  setJoints(q, kind, line, e1) {
    const ctlE1 = e1 != null ? e1 : this.e1;
    const tcp = this.tcpWorld(q);
    // torch vs part / fixture
    const local = Pose.mul(Pose.inv(this.partPose(ctlE1)), tcp).p;
    const rad = Math.hypot(local[0], local[2]);
    const onPart = local[1] > WELD.seamY - WELD.capT - 10 && local[1] < WELD.tubeY1;
    const surf = WELD.R; // CEC and tube share the Ø65 outside diameter
    if (onPart && rad < surf - 5) this.raise("SRVO-050", line, `Torch tip is ${Math.round(surf - rad)} mm inside the part.`);
    if (tcp.p[2] < 40) this.raise("SRVO-050", line, "Torch hit the floor.");
    this.q = q.slice(); this.e1 = ctlE1;
    this.emit("moved", tcp.p, kind);
  }

  // ---------------------------------------------------------------- arc instructions
  ext(s, ctl) {
    if (s.kind === "arcstart") {
      const sc = WELD.schedules[s.sched];
      if (!sc) throw new RobotError(`Weld schedule ${s.sched} is not defined (1 to ${WELD.schedules.length - 1}).`, s.line);
      this.arc.sched = s.sched;
      if (!this.weldEnable) { this.arc.phase = "dry"; this.log(`Arc Start[${s.sched}]: welding disabled, running dry (no arc).`, "warn"); return false; }
      this.arc = { phase: "preflow", t: 0, sched: s.sched, volts: 0, amps: 0, line: s.line };
      ctl.extWait = () => this.arc.phase === "on";
      return true;
    }
    if (s.kind === "arcend") {
      if (this.arc.phase === "on") { this.arc.phase = "crater"; this.arc.t = 0; ctl.extWait = () => this.arc.phase === "off"; return true; }
      this.arc.phase = "off"; return false;
    }
    if (s.kind === "weave") { const w = WELD.weaves[s.sched]; if (!w) throw new RobotError(`Weave schedule ${s.sched} is not defined.`, s.line); this.weave = w; return false; }
    if (s.kind === "weaveend") { this.weave = null; return false; }
    return false;
  }

  // ---------------------------------------------------------------- alarms
  raise(code, line, extra) {
    const a = ALARMS[code] || { text: "", servo: false };
    const entry = { code, text: a.text, extra: extra || "", line, time: new Date() };
    if (!this.alarms.some((x) => x.code === code)) { this.alarms.push(entry); this.history.unshift(entry); if (this.history.length > 40) this.history.pop(); }
    if (a.servo) this.servoOn = false;
    if (code.startsWith("ARC") || code.startsWith("SRVO-050") || code.startsWith("SRVO-00")) this.arcOff();
    this.emit("alarm", entry);
    throw new RobotError(`${code} ${a.text}${extra ? ". " + extra : ""}`, line);
  }
  // same as raise but for use outside the VM (no throw)
  alarm(code, extra) { try { this.raise(code, this.line, extra); } catch (e) { this.emit("fault", { msg: e.message, line: this.line, code }); } }
  stopCauses() {
    const c = [];
    if (this.estopTP) c.push("SRVO-002");
    if (this.estopPanel) c.push("SRVO-001");
    if (this.tpOn && !this.deadman && this.mode !== "AUTO") c.push("SRVO-003");
    if (this.mode === "AUTO" && !this.doorSignal()) c.push("SRVO-004");
    if (this.mode === "AUTO" && !this.curtainClear) c.push("SRVO-007");
    return c;
  }
  resetAlarms() {
    const causes = this.stopCauses();
    this.alarms = this.alarms.filter((a) => causes.includes(a.code) || (a.code === "SRVO-065" && this.faults.batteryLow));
    if (!this.alarms.some((a) => (ALARMS[a.code] || {}).servo)) this.servoOn = true;
    this.emit("alarm", null);
    return this.alarms.length === 0;
  }
  doorSignal() { return this.doorClosed && !this.faults.doorSwitchBad; }
  get faultActive() { return this.alarms.some((a) => a.code !== "SRVO-065"); }
  arcOff() { if (this.arc.phase !== "off") { this.arc.phase = "off"; this.arc.volts = 0; this.arc.amps = 0; } }

  // ---------------------------------------------------------------- per-frame physics
  step(dt, ctl) {
    this.simT = (this.simT || 0) + dt; // simulated seconds (the path check measures speed with it)
    for (const p of this.pulses) { p.t -= dt; if (p.t <= 0) this.dout[p.n] = false; }
    this.pulses = this.pulses.filter((p) => p.t > 0);
    // safety chain: new stop causes raise alarms immediately
    for (const c of this.stopCauses()) if (!this.alarms.some((a) => a.code === c)) {
      this.alarm(c);
    }
    if (this.faults.batteryLow && !this.alarms.some((a) => a.code === "SRVO-065")) this.alarm("SRVO-065");
    this.stepArc(dt * this.timeLapse);
    this.stepPLC(dt);
    // clamp cylinder travel
    const target = this.plc.Y.Y0 ? 1 : 0;
    this.part.clampPos += Math.sign(target - this.part.clampPos) * Math.min(Math.abs(target - this.part.clampPos), dt / 0.6);
  }

  stepArc(dt) {
    const a = this.arc;
    if (a.phase === "off" || a.phase === "dry") return;
    a.t += dt;
    const sc = WELD.schedules[a.sched];
    if (a.phase === "preflow") {
      if (a.t > 0.15) { a.phase = "strike"; a.t = 0; }
    } else if (a.phase === "strike") {
      const canStrike = !this.faults.groundLoose && !this.faults.wireStuck && this.standoffOK();
      if (canStrike && a.t > 0.08) { a.phase = "on"; a.t = 0; a.volts = sc.volts; a.amps = sc.amps; this.part.lastLocal = null; this.log(`Arc established: ${sc.volts} V, ${sc.amps} A, wire ${sc.wfs} m/min.`, "msg"); }
      else if (a.t > 1.0) { a.phase = "off"; this.alarm("ARC-013", this.faults.groundLoose ? "" : ""); }
    } else if (a.phase === "on") {
      a.volts = sc.volts + (Math.random() - 0.5) * 0.6; a.amps = sc.amps + (Math.random() - 0.5) * 8;
      if (!this.standoffOK(10)) { a.phase = "off"; this.alarm("ARC-018"); return; }
      this.depositBead(dt);
    } else if (a.phase === "crater") {
      if (a.t > 0.35) { a.phase = "off"; a.volts = 0; a.amps = 0; this.log("Arc End: crater filled, wire burnback, gas post-flow.", "info"); }
    }
  }
  seamLocal() {
    const tcp = this.tcpWorld();
    return Pose.mul(Pose.inv(this.partPose()), tcp).p;
  }
  standoffOK(lim = 6) {
    const l = this.seamLocal();
    const rad = Math.hypot(l[0], l[2]);
    return Math.abs(rad - WELD.R) < lim && l[1] > WELD.seamY - 30 && l[1] < WELD.tubeY1;
  }
  depositBead(dt) {
    const l = this.seamLocal();
    const prev = this.part.lastLocal;
    this.part.lastLocal = l;
    if (!prev) return;
    const d = Vec.len(Vec.sub(l, prev));
    const speed = d / Math.max(dt, 1e-6);
    this.arc.speed = speed;
    // lay a bead sample every 0.8 mm of travel (about 1.4° on the Ø65 tube), interpolated along this frame's path
    const STEP = 0.8;
    let s = STEP - this.part.travel;
    while (s <= d) {
      const pt = Vec.lerp(prev, l, d > 0 ? s / d : 1);
      this.addBead(pt, speed);
      s += STEP;
    }
    this.part.travel = (this.part.travel + d) % STEP;
  }
  addBead(l, speed) {
    const ang = ((Math.atan2(l[0], l[2]) / DEG) % 360 + 360) % 360;
    const rad = Math.hypot(l[0], l[2]);
    const lat = l[1] - WELD.seamY, stand = rad - WELD.R;
    const tol = this.weave ? 4.5 : 3;
    const sc = WELD.schedules[this.arc.sched] || WELD.schedules[1];
    let grade = "good", note = "";
    if (this.faults.gasEmpty) { grade = "porosity"; note = "no shielding gas"; }
    else if (Math.abs(lat) > tol) { grade = "lof"; note = `${lat.toFixed(1)} mm off the seam`; }
    else if (Math.abs(lat) > tol / 2) { grade = "undercut"; note = `${lat.toFixed(1)} mm off centre`; }
    else if (speed > sc.speed * 1.6) { grade = "fast"; note = `${speed.toFixed(1)} mm/s travel (schedule ${sc.speed})`; }
    else if (speed < sc.speed * 0.6) { grade = "slow"; note = `${speed.toFixed(1)} mm/s travel${this.override < 0.99 ? ` (override ${Math.round(this.override * 100)}%: weld at 100%)` : ""}`; }
    else if (Math.abs(stand) > 4) { grade = "stickout"; note = `${stand.toFixed(1)} mm stand-off error`; }
    else if (this.arc.sched === 1) {
      // the root pass must fill the U-groove: compare weld metal laid with the groove area
      const fill = WELD.deposit(sc, speed) / WELD.drawing.groove.area;
      if (fill < 0.95) { grade = "underfill"; note = `groove ${Math.round(fill * 100)}% filled: more wire or slower travel`; }
      else if (fill > 1.5) { grade = "overfill"; note = `${Math.round(fill * 100)}% of the groove: excess crown, less wire or faster travel`; }
    }
    const b = { ang, lat, stand, speed, grade, note, width: this.weave ? 10 : 8 };
    this.part.beads.push(b);
    this.emit("bead", b);
  }

  // weld inspection: coverage of the seam and defect list
  inspect() {
    const bins = new Array(180).fill(null);
    for (const b of this.part.beads) { const i = Math.floor(b.ang / 2) % 180; const rank = { good: 3, undercut: 2, fast: 1, slow: 1, stickout: 1, underfill: 1, overfill: 1, lof: 0, porosity: 0 }[b.grade]; if (!bins[i] || rank > bins[i].rank) bins[i] = { rank, grade: b.grade, note: b.note }; }
    const covered = bins.filter((b) => b && b.rank >= 2).length / 180;
    const defects = [];
    let curD = null;
    bins.forEach((b, i) => {
      const g = !b ? "missing" : b.rank >= 3 ? null : b.grade;
      if (g && curD && curD.grade === g && curD.to === i * 2) curD.to = i * 2 + 2;
      else if (g) { curD = { grade: g, from: i * 2, to: i * 2 + 2, note: b ? b.note : "" }; defects.push(curD); }
      else curD = null;
    });
    const fatal = defects.some((d) => ["missing", "porosity", "lof", "underfill"].includes(d.grade));
    return { samples: this.part.beads.length, coverage: covered, defects, pass: this.part.beads.length > 0 && covered > 0.985 && !fatal };
  }

  // ---------------------------------------------------------------- PLC
  get robotReady() { return this.mode === "AUTO" && !this.tpOn && this.servoOn && !this.faultActive; }
  stepPLC(dt) {
    const P = this.plc;
    P.scanT += dt;
    if (P.scanT < 0.02) return; // 20 ms scan
    P.scanT = 0; P.scans++;
    const X = P.X, M = P.M, Y = P.Y;
    // 1. input scan
    X.X0 = this.doorSignal();
    X.X1 = this.curtainClear;
    X.X2 = !!this.btn.clamp;
    X.X3 = this.part.loaded;
    X.X4 = this.part.clampPos > 0.98 && !this.faults.clampSensorBad;
    X.X5 = !!this.btn.start;
    X.X6 = !!this.btn.stop;
    X.X7 = !!this.btn.unclamp;
    X.ESTOP_OK = !this.estopPanel && !this.estopTP;
    X.RDY = this.robotReady; X.RUN = this.dout[1]; X.DONE = this.dout[2]; X.FLT = this.faultActive;
    // 2. logic solve (one pass, top to bottom, like a real scan)
    M.M0 = X.X0 && X.X1 && X.ESTOP_OK;
    M.M2 = X.DONE || X.X7;
    M.M1 = ((X.X2 && X.X3) || M.M1) && !M.M2;
    Y.Y0 = M.M1;
    Y.Y2 = M.M1 && X.X4;
    const prevY1 = Y.Y1;
    Y.Y1 = ((X.X5 && M.M0 && Y.Y2 && X.RDY && !X.RUN) || (Y.Y1 && !X.RUN)) && !X.X6 && M.M0;
    Y.Y3 = X.RUN;
    Y.Y4 = X.RDY && !X.RUN && !X.FLT;
    Y.Y5 = X.FLT || !M.M0;
    // 3. output scan
    P.startEdge = Y.Y1 && !prevY1;
  }
  get btn() { return this._btn || (this._btn = {}); }
}

// ladder diagram description used by the PLC view (rungs read the PLC image above)
const LADDER = [
  { title: "Safety OK", series: [["X0", "Door closed"], ["X1", "Light curtain clear"], ["ESTOP_OK", "No E-stop"]], coil: ["M0", "SAFE"] },
  { title: "Unclamp request", series: [["DONE", "Robot DO[2] weld done"]], branch: [["X7", "Unclamp button"]], coil: ["M2", "UNCLAMP REQ"] },
  { title: "Clamp (latched)", series: [["X2", "Clamp button"], ["X3", "Part present"]], branch: [["M1", "Clamp seal-in"]], after: [["!M2", "Not unclamp req"]], coil: ["M1", "CLAMP"] },
  { title: "Clamp valve", series: [["M1", "CLAMP"]], coil: ["Y0", "Clamp solenoid"] },
  { title: "Clamp OK to robot", series: [["M1", "CLAMP"], ["X4", "Clamped sensor"]], coil: ["Y2", "Robot DI[2]"] },
  { title: "Cycle start to robot", series: [["X5", "Start button"], ["M0", "SAFE"], ["Y2", "Clamp OK"], ["RDY", "Robot ready"], ["!RUN", "Not in cycle"]], branch: [["Y1", "Seal-in"], ["!RUN", "Until robot acks"]], after: [["!X6", "Stop button"], ["M0", "SAFE"]], coil: ["Y1", "Robot START"] },
  { title: "Green light", series: [["RUN", "Robot DO[1] in cycle"]], coil: ["Y3", "Tower green"] },
  { title: "Amber light", series: [["RDY", "Robot ready"], ["!RUN", "Not running"], ["!FLT", "No fault"]], coil: ["Y4", "Tower amber"] },
  { title: "Red light", series: [["FLT", "Robot fault"]], branch: [["!M0", "Not safe"]], coil: ["Y5", "Tower red"] },
];
