"use strict";
// Teach pendant behaviour: screens, editing, jogging and program control, modelled on FANUC ArcTool.

const OVR_STEPS = ["VFINE", "FINE", 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
const DI_NAMES = ["", "CYCLE START", "CLAMP OK", "PART PRESENT", "ARC DETECT", "GAS OK", "", "", ""];
const DO_NAMES = ["", "IN CYCLE", "WELD DONE", "", "", "", "", "", ""];
const COORDS = ["JOINT", "WORLD", "TOOL", "USER"];
const TEMPLATES = ["J P[] 100% FINE", "J P[] 100% CNT100", "L P[] 100mm/sec FINE", "L P[] 100mm/sec CNT100"];
const JOG_KEYS = { jx1m: [0, -1], jx1p: [0, 1], jy2m: [1, -1], jy2p: [1, 1], jz3m: [2, -1], jz3p: [2, 1], jx4m: [3, -1], jx4p: [3, 1], jy5m: [4, -1], jy5p: [4, 1], jz6m: [5, -1], jz6p: [5, 1] };
const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

class TPController {
  constructor({ world, ctl, view, app }) {
    this.w = world; this.ctl = ctl; this.view = view; this.app = app;
    this.progs = TPStore.defaults(); this.selected = "CYL_WELD";
    this.screen = "edit"; this.hist = []; this.popup = null; this.confirm = null;
    this.cur = { line: 0, field: -1 }; this.num = ""; this.fpage = 0;
    this.coord = "JOINT"; this.group = 1; this.ovrIdx = OVR_STEPS.indexOf(30);
    this.step = false; this.explain = false; this.split = false;
    this.ioType = "DI"; this.ioCur = 0; this.dataType = "R"; this.dataCur = 0; this.posRep = "JNT"; this.selCur = 0; this.almCur = 0; this.almHist = false;
    this.msg = ""; this.msgT = 0; this.template = 2; this.undo = []; this.clip = null; this.jog = null;
    this.version = 1; this.loadedVersion = 0; this.lineMap = null; this.regs = {};
    this.shiftLatch = false; this.shiftKey = false;
    this.applyOverride();
    world.on("override", () => { const v = Math.round(world.override * 100); const i = OVR_STEPS.indexOf(v); if (i >= 0) this.ovrIdx = i; });
  }
  get prog() { return this.progs.find((p) => p.name === this.selected) || this.progs[0]; }
  get shift() { return this.shiftLatch || this.shiftKey; }
  get ovr() { return OVR_STEPS[this.ovrIdx]; }
  applyOverride() { const o = this.ovr; this.w.override = typeof o === "number" ? o / 100 : 0.01; }
  say(m) { this.msg = m; this.msgT = 5; }
  changed() { this.version++; this.app.onProgramsChanged(); }
  loadText(text) {
    const progs = TPStore.parseLS(text);
    if (!progs.length) return false;
    this.progs = progs;
    if (!this.prog || this.prog.name !== this.selected) this.selected = this.progs[0].name;
    this.cur.line = Math.min(this.cur.line, Math.max(0, this.prog.lines.length - 1));
    this.version++;
    return true;
  }
  snapshot() { this.undo.push(JSON.stringify(this.progs)); if (this.undo.length > 40) this.undo.shift(); }

  // ---------------------------------------------------------------- key dispatch
  key(k) {
    if (this.explain && k !== "tpswitch" && k !== "estop" && k !== "deadman" && k !== "shift") { this.app.explainKey(k); this.view.flash(k); return; }
    this.app.onKey && this.app.onKey(k);
    const w = this.w;
    if (JOG_KEYS[k]) { this.startJog(k); return; }
    if (/^n\d$/.test(k) || k === "dot" || k === "minus") return this.digit(k === "dot" ? "." : k === "minus" ? "-" : k[1]);
    switch (k) {
      case "tpswitch": w.tpOn = !w.tpOn; this.say(w.tpOn ? "Teach pendant ON. Hold the enabling switch and press RESET." : "Teach pendant OFF. The robot can run in AUTO."); break;
      case "estop": w.estopTP = !w.estopTP; this.say(w.estopTP ? "Pendant E-stop pressed: servo power is off." : "Pendant E-stop released. Press RESET."); break;
      case "deadman": w.deadman = !w.deadman; this.say(w.deadman ? "Enabling switch held (middle position)." : "Enabling switch released."); break;
      case "shift": this.shiftLatch = !this.shiftLatch; break;
      case "reset": {
        if (this.w.tpOn && !this.w.deadman && this.w.mode !== "AUTO") this.say("SRVO-003 stays: hold the enabling switch, then RESET.");
        const ok = w.resetAlarms();
        if (ok) this.say("Alarms cleared. Servo ON."); else this.say("Some alarms remain: their cause is still present. Check the ALARM screen.");
        break;
      }
      case "prev": if (this.popup) { this.popup = null; break; } if (this.hist.length) { this.screen = this.hist.pop(); } break;
      case "next": this.fpage = (this.fpage + 1) % 2; break;
      case "edit": this.go("edit"); break;
      case "select": this.go("select"); this.selCur = Math.max(0, this.progs.findIndex((p) => p.name === this.selected)); break;
      case "data": this.go("data"); break;
      case "posn": this.go("posn"); break;
      case "io": this.go("io"); break;
      case "status": this.go("status"); break;
      case "disp": this.split = !this.split; break;
      case "menu": this.openMenu(); break;
      case "fctn": this.openFctn(); break;
      case "diag": this.help(); break;
      case "step": this.step = !this.step; this.say(this.step ? "Step mode: each SHIFT+FWD runs one line." : "Continuous mode."); break;
      case "hold": if (this.ctl.running) { this.ctl.pause(); this.say("Paused by HOLD."); } break;
      case "fwd": this.fwd(); break;
      case "bwd": this.bwd(); break;
      case "coord": { const i = COORDS.indexOf(this.coord); this.coord = COORDS[(i + 1) % COORDS.length]; this.say(`Jog coordinate system: ${this.coord}`); break; }
      case "group": this.group = this.group === 1 ? 2 : 1; this.say(this.group === 2 ? "Group 2: positioner. J1 keys turn the part." : "Group 1: robot."); break;
      case "ovrp": this.ovrIdx = Math.min(OVR_STEPS.length - 1, this.shift ? Math.max(this.ovrIdx + 1, [1, 6, 15, 25].find((i) => i > this.ovrIdx) ?? 25) : this.ovrIdx + 1); this.applyOverride(); break;
      case "ovrm": this.ovrIdx = Math.max(0, this.shift ? [25, 15, 6, 1, 0].find((i) => i < this.ovrIdx) ?? 0 : this.ovrIdx - 1); this.applyOverride(); break;
      case "weld": if (!this.shift) { this.say("Hold SHIFT and press WELD ENBL."); break; } w.weldEnable = !w.weldEnable; this.say(w.weldEnable ? "Weld ENABLED: Arc Start will strike an arc." : "Weld DISABLED: Arc Start runs dry."); break;
      case "wirep": case "wirem": if (!this.shift) { this.say("Hold SHIFT and press WIRE+ / WIRE− to inch wire."); break; } this.say(k === "wirep" ? "Inching wire forward (no gas, no arc)." : "Retracting wire."); break;
      case "otf": this.say(w.arc.phase === "on" ? `On-the-fly: ${w.arc.volts.toFixed(1)} V ${w.arc.amps.toFixed(0)} A. Adjust in the DATA weld schedule.` : "OTF works while the arc is on."); break;
      case "bksp": this.num = this.num.slice(0, -1); break;
      case "item": if (this.num && this.screen === "edit") { this.cur.line = Math.max(0, Math.min(this.prog.lines.length - 1, (+this.num | 0) - 1)); this.cur.field = -1; this.num = ""; } break;
      case "enter": this.enter(); break;
      case "up": case "down": this.arrow(k === "up" ? -1 : 1); break;
      case "left": case "right": this.fieldMove(k === "left" ? -1 : 1); break;
      case "f1": case "f2": case "f3": case "f4": case "f5": this.fkey(+k[1]); break;
    }
  }
  keyUp(k) { if (JOG_KEYS[k] && this.jog && this.jog.k === k) this.jog = null; }
  go(s) { if (this.screen !== s) this.hist.push(this.screen); this.screen = s; this.popup = null; this.confirm = null; this.fpage = 0; }
  digit(d) {
    if (this.popup && /\d/.test(d)) { const i = d === "0" ? 9 : +d - 1; if (this.popup.items[i]) { this.popup.sel = i; this.enter(); } return; }
    if (this.num.length < 10) this.num += d;
  }

  // ---------------------------------------------------------------- menus
  openMenu() {
    this.popup = { title: "MENU", sel: 0, items: [
      { label: "UTILITIES  (tutorial)", act: () => this.app.openLearn && this.app.openLearn("pendant") },
      { label: "TEST CYCLE  (weld enable)", act: () => { this.w.weldEnable = !this.w.weldEnable; this.say(`Weld ${this.w.weldEnable ? "ENABLED" : "DISABLED"}.`); } },
      { label: "MANUAL FCTNS  (wire inch)", act: () => this.say("Manual functions: use SHIFT+WIRE+ to inch wire.") },
      { label: "ALARM", act: () => this.go("alarm") },
      { label: "I/O", act: () => this.go("io") },
      { label: "SETUP  (frames)", act: () => this.go("setup") },
      { label: "DATA", act: () => this.go("data") },
      { label: "STATUS", act: () => this.go("status") },
      { label: "POSITION", act: () => this.go("posn") },
      { label: "SELECT", act: () => this.go("select") },
    ] };
  }
  openFctn() {
    this.popup = { title: "FUNCTION", sel: 0, items: [
      { label: "ABORT (ALL)", act: () => { if (this.ctl.prog) { this.ctl.state = "idle"; this.ctl.motion = null; this.w.arcOff(); } this.say("Program aborted."); } },
      { label: "CHANGE GROUP", act: () => this.key("group") },
      { label: "RELEASE WAIT", act: () => { if (this.ctl.waitDI) { this.ctl.waitDI = null; this.ctl.state = "running"; this.say("WAIT released: execution continues."); } else this.say("The program is not waiting."); } },
      { label: "UNSIM ALL I/O", act: () => { this.w.dsim.fill(null); this.say("All simulated inputs released."); } },
      { label: "DISP SPLIT ON/OFF", act: () => (this.split = !this.split) },
    ] };
  }
  openInst() {
    const tmpl = (label, text) => ({ label, act: () => this.insertLine(text) });
    const calls = this.progs.filter((p) => p.name !== this.selected).map((p) => tmpl(`CALL ${p.name}`, `CALL ${p.name}`));
    this.popup = { title: "INSTRUCTION", sel: 0, items: [
      { label: "I/O", sub: [tmpl("DO[3]=ON", "DO[3]=ON"), tmpl("DO[3]=OFF", "DO[3]=OFF"), tmpl("DO[2]=PULSE,1.0sec", "DO[2:WELD DONE]=PULSE,1.0sec"), tmpl("WAIT DI[2]=ON", "WAIT DI[2:CLAMP OK]=ON")] },
      { label: "WAIT", sub: [tmpl("WAIT 1.00(sec)", "WAIT 1.00(sec)"), tmpl("WAIT DI[5]=ON", "WAIT DI[5:GAS OK]=ON")] },
      { label: "Registers", sub: [tmpl("R[1]=0", "R[1:COUNT]=0"), tmpl("R[1]=R[1]+1", "R[1:COUNT]=R[1]+1")] },
      { label: "JMP/LBL", sub: [tmpl("LBL[1]", "LBL[1]"), tmpl("JMP LBL[1]", "JMP LBL[1]"), tmpl("IF R[1]<3,JMP LBL[1]", "IF R[1]<3,JMP LBL[1]")] },
      { label: "CALL", sub: calls.length ? calls : [{ label: "(no other programs)", act: () => {} }] },
      { label: "Arc", sub: [tmpl("Arc Start[1]", "Arc Start[1]"), tmpl("Arc End[1]", "Arc End[1]"), tmpl("Weave Sine[1]", "Weave Sine[1]"), tmpl("Weave End", "Weave End")] },
      { label: "Frames", sub: [tmpl("UFRAME_NUM=0", "UFRAME_NUM=0"), tmpl("UFRAME_NUM=1", "UFRAME_NUM=1"), tmpl("UTOOL_NUM=1", "UTOOL_NUM=1")] },
      { label: "Comment", sub: [tmpl("!comment", "!comment")] },
      { label: "Miscellaneous", sub: [tmpl("OVERRIDE=50%", "OVERRIDE=50%"), tmpl("MESSAGE[text]", "MESSAGE[Check the weld]"), tmpl("PAUSE", "PAUSE"), tmpl("ABORT", "ABORT")] },
    ] };
  }
  openEdcmd() {
    this.popup = { title: "EDIT COMMAND", sel: 0, items: [
      { label: "Insert (blank line)", act: () => this.insertLine("!") },
      { label: "Delete", act: () => this.askDelete() },
      { label: "Copy", act: () => { this.clip = this.prog.lines[this.cur.line]; this.say("Line copied."); } },
      { label: "Paste", act: () => { if (this.clip != null) this.insertLine(this.clip); else this.say("Nothing copied yet."); } },
      { label: "Undo", act: () => { const u = this.undo.pop(); if (u) { this.progs = JSON.parse(u); this.changed(); this.say("Undone."); } else this.say("Nothing to undo."); } },
    ] };
  }
  askDelete() {
    if (!this.prog.lines.length) return;
    this.confirm = { text: `Delete line ${this.cur.line + 1}?`, yes: () => { this.snapshot(); this.prog.lines.splice(this.cur.line, 1); this.cur.line = Math.max(0, Math.min(this.cur.line, this.prog.lines.length - 1)); this.changed(); this.say("Line deleted."); } };
  }
  enter() {
    if (this.popup) {
      const it = this.popup.items[this.popup.sel];
      if (!it) return;
      if (it.sub) { this.popup = { title: it.label, sel: 0, items: it.sub, parent: this.popup }; return; }
      this.popup = null; it.act(); return;
    }
    if (this.screen === "select") { const p = this.progs[this.selCur]; if (p) { this.selected = p.name; this.cur = { line: 0, field: -1 }; this.go("edit"); this.say(`${p.name} selected.`); } return; }
    if (this.screen === "edit" && this.num) { this.commitNumber(); return; }
    if (this.screen === "data" && this.dataType === "R" && this.num) { const n = this.dataCur + 1; const v = +this.num; this.regs[n] = v; if (this.ctl.vars && `R[${n}]` in this.ctl.vars) this.ctl.vars[`R[${n}]`] = v; this.num = ""; this.say(`R[${n}] = ${v}`); }
  }
  arrow(d) {
    if (this.popup) { const n = this.popup.items.length; this.popup.sel = (this.popup.sel + d + n) % n; return; }
    if (this.screen === "edit") { this.cur.line = Math.max(0, Math.min(this.prog.lines.length - 1, this.cur.line + d)); this.cur.field = -1; this.num = ""; }
    if (this.screen === "select") this.selCur = Math.max(0, Math.min(this.progs.length - 1, this.selCur + d));
    if (this.screen === "io") this.ioCur = Math.max(0, Math.min(7, this.ioCur + d));
    if (this.screen === "data") this.dataCur = Math.max(0, Math.min(this.dataType === "R" ? 9 : WELD.schedules.length - 2, this.dataCur + d));
    if (this.screen === "alarm") this.almCur = Math.max(0, this.almCur + d);
  }

  // ---------------------------------------------------------------- line fields
  fields(s) {
    if (/^\s*!/.test(s)) return [];
    const out = [];
    const re = /^[JLC](?=\s)|FINE|CNT\d+|\bON\b|\bOFF\b|\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(s))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: /^[JLC]$/.test(m[0]) ? "motion" : /FINE|CNT/.test(m[0]) ? "term" : /ON|OFF/.test(m[0]) ? "onoff" : "num" });
    return out;
  }
  fieldMove(d) {
    if (this.screen !== "edit") return;
    const f = this.fields(this.prog.lines[this.cur.line] || "");
    if (!f.length) { this.cur.field = -1; return; }
    this.cur.field = Math.max(-1, Math.min(f.length - 1, this.cur.field + d));
  }
  replaceField(text) {
    const s = this.prog.lines[this.cur.line]; const f = this.fields(s)[this.cur.field];
    if (!f) return;
    this.snapshot();
    let ns = s.slice(0, f.start) + text + s.slice(f.end);
    if (f.type === "motion") {
      if (text === "L") ns = ns.replace(/(\d+)%/, "100mm/sec");
      if (text === "J") ns = ns.replace(/(\d+(?:\.\d+)?)mm\/sec|WELD_SPEED/, "100%");
    }
    this.prog.lines[this.cur.line] = ns; this.changed();
  }
  commitNumber() {
    const f = this.fields(this.prog.lines[this.cur.line] || "")[this.cur.field];
    if (!f || f.type !== "num") { this.say("Move the cursor onto a number with ← → first."); return; }
    this.replaceField(String(+this.num)); this.num = ""; this.say("Value changed.");
  }
  choice() {
    const f = this.fields(this.prog.lines[this.cur.line] || "")[this.cur.field];
    if (!f) { this.say("Move the cursor onto a field with ← →."); return; }
    const cyc = { motion: ["J", "L"], term: ["FINE", "CNT0", "CNT50", "CNT100"], onoff: ["ON", "OFF"] }[f.type];
    if (!cyc) { this.say("Type a number and press ENTER to change this value."); return; }
    this.replaceField(cyc[(cyc.indexOf(f.text) + 1) % cyc.length]);
  }

  // ---------------------------------------------------------------- recording points
  nextPoint() { const ks = Object.keys(this.prog.points).map(Number); return ks.length ? Math.max(...ks) + 1 : 1; }
  pointFromRobot(comment) {
    const P = this.w.currentPose();
    const e = Rot.toFixedXYZ(P.R);
    return { comment: comment || "", x: P.p[0], y: P.p[1], z: P.p[2], w: e[0], p: e[1], r: e[2], uf: Math.max(0, this.w.frameIdx), ut: Math.max(0, this.w.toolIdx), e1: this.w.e1 };
  }
  insertLine(text) {
    this.snapshot();
    const at = this.prog.lines.length ? this.cur.line + 1 : 0;
    this.prog.lines.splice(at, 0, text);
    this.cur = { line: at, field: -1 };
    this.changed();
  }
  record(template) {
    const n = this.nextPoint();
    this.snapshot();
    this.prog.points[n] = this.pointFromRobot();
    this.insertLine(template.replace("P[]", `P[${n}]`));
    this.say(`Position recorded to P[${n}].`);
  }
  touchup() {
    const s = this.prog.lines[this.cur.line] || "";
    const m = s.match(/\bP\[(\d+)/);
    if (!m) { this.say("Put the cursor on a motion line to touch up its point."); return; }
    this.snapshot();
    const n = +m[1], old = this.prog.points[n];
    this.prog.points[n] = Object.assign(this.pointFromRobot(old && old.comment), {});
    this.changed();
    this.say(`Position has been recorded to P[${n}].`);
  }

  fkey(n) {
    if (this.confirm) { if (n === 4) { const c = this.confirm; this.confirm = null; c.yes(); } if (n === 5) { this.confirm = null; this.say("Cancelled."); } return; }
    const s = this.screen;
    if (s === "edit") {
      if (this.fpage === 0) {
        if (n === 1) { if (this.shift) this.record(TEMPLATES[this.template]); else this.popup = { title: "POINT: motion template", sel: this.template, items: TEMPLATES.map((t, i) => ({ label: t, act: () => { this.template = i; this.record(t); } })) }; }
        if (n === 2) this.insertLine("Arc Start[1]");
        if (n === 3) this.record("L P[] WELD_SPEED FINE");
        if (n === 4) this.insertLine("Arc End[1]");
        if (n === 5) { if (this.shift) this.touchup(); else this.say("Hold SHIFT and press F5 TOUCHUP."); }
      } else {
        if (n === 1) this.openInst();
        if (n === 2) this.openEdcmd();
        if (n === 4) this.choice();
      }
    } else if (s === "select") {
      if (n === 2) { let k = 1; while (this.progs.some((p) => p.name === "PROG" + k)) k++; this.progs.push({ name: "PROG" + k, comment: "", lines: ["UFRAME_NUM=0", "UTOOL_NUM=1"], points: {} }); this.selCur = this.progs.length - 1; this.changed(); this.say(`PROG${k} created. ENTER to edit it.`); }
      if (n === 3) {
        const p = this.progs[this.selCur];
        if (!p || this.progs.length < 2) { this.say("Cannot delete the last program."); return; }
        this.confirm = { text: `Delete ${p.name}?`, yes: () => { this.progs.splice(this.selCur, 1); if (this.selected === p.name) this.selected = this.progs[0].name; this.selCur = 0; this.changed(); this.say(`${p.name} deleted.`); } };
      }
    } else if (s === "posn") {
      if (n === 1) this.posRep = "JNT"; if (n === 2) this.posRep = "USER"; if (n === 3) this.posRep = "WORLD";
    } else if (s === "io") {
      const idx = this.ioCur + 1;
      if (n === 1) { this.ioType = this.ioType === "DI" ? "DO" : "DI"; return; }
      if (this.ioType === "DI") {
        if (n === 3) { this.w.dsim[idx] = this.w.dsim[idx] == null ? this.w.getDI(idx) : null; this.say(this.w.dsim[idx] == null ? `DI[${idx}] follows the real signal again.` : `DI[${idx}] is SIMULATED: F4/F5 set its value.`); }
        if (n === 4 || n === 5) { if (this.w.dsim[idx] == null) this.say("Input is not simulated. Press F3 SIMULATE first."); else this.w.dsim[idx] = n === 4; }
      } else if (n === 4 || n === 5) {
        if (this.w.mode === "AUTO") this.say("Forcing outputs is only allowed in T1/T2.");
        else { this.w.dout[idx] = n === 4; this.say(`DO[${idx}] forced ${n === 4 ? "ON" : "OFF"}.`); }
      }
    } else if (s === "data") {
      if (n === 1) { this.dataType = this.dataType === "R" ? "SCHED" : "R"; this.dataCur = 0; }
    } else if (s === "alarm") {
      if (n === 1) this.almHist = !this.almHist;
      if (n === 4) this.key("reset");
    }
  }

  help() {
    const s = this.screen;
    if (s === "alarm") {
      const list = this.almHist ? this.w.history : this.w.alarms;
      const a = list[this.almCur];
      if (a) { const d = ALARMS[a.code] || {}; this.popup = { title: `HELP: ${a.code}`, sel: 0, items: [{ label: d.text || a.text, act: () => {} }, { label: "Cause: " + (d.cause || a.extra || "See the manual."), act: () => {} }, { label: "Remedy: " + (d.fix || "See the manual."), act: () => {} }] }; return; }
    }
    const tips = {
      edit: "EDIT: ↑↓ choose a line, ←→ choose a field. F1 POINT records, SHIFT+F5 TOUCHUP re-records. NEXT shows [INST] and [EDCMD]. SHIFT+FWD runs from the cursor.",
      select: "SELECT: ↑↓ choose a program, ENTER opens it. F2 CREATE, F3 DELETE.",
      posn: "POSITION: F1 joint angles, F2 user frame, F3 world frame. E1 is the positioner angle.",
      io: "I/O: F1 switches DI/DO. Inputs: F3 SIMULATE, then F4 ON / F5 OFF. Outputs: F4/F5 force them in T1/T2.",
      data: "DATA: F1 switches registers / weld schedules. Type a number and ENTER to set a register.",
      status: "STATUS: a summary of the controller.",
      setup: "SETUP FRAMES: the tool frame (TCP) and user frames the robot knows.",
      alarm: "ALARM: ↑↓ choose an alarm, DIAG/HELP explains it, F1 shows history, F4 RESET.",
    };
    this.say(tips[s] || "Press MENU for screens.");
  }

  // ---------------------------------------------------------------- jogging
  startJog(k) {
    const w = this.w;
    const why = this.cannotMove(true);
    if (why) { this.say(why); return; }
    const [axis, sign] = JOG_KEYS[k];
    if (this.ovr === "FINE" || this.ovr === "VFINE") { this.jogIncrement(axis, sign, this.ovr === "FINE" ? 1 : 0.1); return; }
    this.jog = { k, axis, sign };
  }
  cannotMove(jogging) {
    const w = this.w;
    if (w.mode === "AUTO") return jogging ? "Jogging is not allowed in AUTO. Turn the mode switch to T1." : "In AUTO the PLC starts the program. Use T1 to run from the pendant.";
    if (!w.tpOn) return "The teach pendant is OFF. Turn it ON (top-left switch).";
    if (!w.deadman) return "Hold the enabling switch (deadman) in the middle position.";
    if (!this.shift) return "Hold SHIFT together with the key.";
    if (!w.servoOn || w.faultActive) return "Servo is OFF or an alarm is active. Clear the cause and press RESET.";
    if (this.ctl.running) return "A program is running. Press HOLD first.";
    return null;
  }
  jogIncrement(axis, sign, size) {
    // FINE / VFINE: one key press = one small step
    this.doJog(axis, sign, null, size);
  }
  tickJog(dt) {
    const j = this.jog; if (!j) return;
    const why = this.cannotMove(true);
    if (why) { this.jog = null; this.say(why); return; }
    this.doJog(j.axis, j.sign, dt, null);
  }
  doJog(axis, sign, dt, step) {
    const w = this.w, ovr = w.override;
    try {
      if (this.group === 2) { if (axis !== 0) { this.say("The positioner has one axis: use the J1 keys."); return; } w.setJoints(w.q, "J", 0, w.e1 + sign * (step != null ? step : 60 * ovr * dt)); return; }
      if (this.coord === "JOINT") {
        const q = w.q.slice(); q[axis] += sign * (step != null ? step / 10 : 60 * ovr * dt);
        const [lo, hi] = ARM.limits[axis];
        if (q[axis] < lo || q[axis] > hi) { this.say(`J${axis + 1} is at its stroke limit.`); this.jog = null; return; }
        w.setJoints(q, "J", 0); return;
      }
      const T = w.tcpTaught();
      const P = { type: "pose", p: T.p.slice(), R: T.R.slice() };
      const frameR = this.coord === "USER" ? w.frame.R : Mat.I();
      if (axis < 3) {
        const d = [0, 0, 0]; d[axis] = sign * (step != null ? step : Math.min(250, 1000 * ovr) * dt);
        P.p = Vec.add(P.p, this.coord === "TOOL" ? Mat.mv(T.R, d) : Mat.mv(frameR, d));
      } else {
        const a = sign * (step != null ? step / 10 : 60 * ovr * dt) * DEG, Rr = [Mat.rx, Mat.ry, Mat.rz][axis - 3](a);
        P.R = this.coord === "TOOL" ? Mat.mul(T.R, Rr) : Mat.mul(Rr, T.R);
      }
      const r = ikFlange(Pose.mul(P, Pose.inv(w.tool)), w.q);
      if (r.error) { this.say(r.error === "reach" ? "MOTN-018 Position not reachable." : r.error === "limit" ? `MOTN-017 Limit error. ${r.detail}` : "MOTN-023 In singularity: jog in JOINT."); this.jog = null; return; }
      if (Math.max(...r.q.map((v, i) => Math.abs(v - w.q[i]))) > 10) { this.say("MOTN-023 In singularity: switch COORD to JOINT to get past it."); this.jog = null; return; }
      w.setJoints(r.q, "L", 0);
    } catch (e) { this.jog = null; this.say(e.message); }
  }

  // ---------------------------------------------------------------- running
  compile() {
    const { text, map } = TPStore.serialize(this.progs);
    const prog = LANGS.fanuc.parse(text);
    prog.main = this.selected;
    this.ctl.load(prog);
    for (const [n, v] of Object.entries(this.regs)) this.ctl.vars[`R[${n}]`] = v;
    this.lineMap = map[this.selected];
    this.allMaps = map;
    this.loadedVersion = this.version;
  }
  runFrom(idx, stepMode) {
    try { this.compile(); }
    catch (e) { this.say(`INTP-? Syntax error: ${e.message}`); this.app.onSyntaxError && this.app.onSyntaxError(e); return false; }
    const line = this.lineMap[idx] != null ? this.lineMap[idx] : this.lineMap[0] || 1;
    this.ctl.startAt(line, stepMode);
    this.app.onRunStart && this.app.onRunStart();
    return true;
  }
  fwd() {
    if (!this.shift) { this.say("Hold SHIFT and press FWD."); return; }
    const why = this.cannotMove(false);
    if (why) { this.say(why); return; }
    if (!this.prog.lines.length) { this.say("The program is empty."); return; }
    const c = this.ctl;
    if (c.prog && c.state === "paused" && this.loadedVersion === this.version) { if (this.step) c.step(); else c.start(); this.say(this.step ? "Step." : "Running."); return; }
    if (this.runFrom(this.cur.line, this.step)) this.say(this.step ? "Step: one line." : "Running from the cursor line.");
  }
  bwd() {
    if (!this.shift) { this.say("Hold SHIFT and press BWD."); return; }
    const why = this.cannotMove(false);
    if (why) { this.say(why); return; }
    for (let i = this.cur.line - 1; i >= 0; i--) {
      if (/^[JLC]\s/.test(this.prog.lines[i])) { this.cur.line = i; this.runFrom(i, true); this.say(`Backward to line ${i + 1}.`); return; }
    }
    this.say("No earlier motion line.");
  }
  // pendant line number (1-based) for a source line of the LS file
  mnLine(src) {
    for (const [name, map] of Object.entries(this.allMaps || {})) { const i = map.indexOf(src); if (i >= 0) return name === this.selected ? i + 1 : `${name}:${i + 1}`; }
    return src;
  }
  // called every frame by the app
  tick(dt) {
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg = ""; }
    this.tickJog(dt);
    const c = this.ctl;
    // T1/T2: motion needs SHIFT + deadman held the whole time
    if (c.running && this.w.mode !== "AUTO" && (!this.shift || !this.w.deadman)) { c.pause(); this.say(!this.shift ? "SHIFT released: program paused." : "Enabling switch released."); }
    // follow the executing line
    if (c.prog && c.state !== "idle" && this.lineMap && this.ctl.prog.main === this.selected) {
      const ln = this.w.line;
      let idx = -1;
      for (let i = 0; i < this.lineMap.length; i++) if (this.lineMap[i] <= ln) idx = i;
      if (idx >= 0 && c.frame && c.frame.proc === this.selected) this.cur.line = idx;
    }
    if (c.vars) for (const k in c.vars) { const m = k.match(/^R\[(\d+)\]$/); if (m) this.regs[m[1]] = c.vars[k]; }
  }

  // ---------------------------------------------------------------- screens
  statusText() {
    const c = this.ctl;
    if (!c.prog || c.state === "idle" || c.state === "done") return "ABORTED";
    if (c.state === "error") return "PAUSED";
    if (c.state === "paused") return "PAUSED";
    return "RUNNING";
  }
  render() {
    const w = this.w, c = this.ctl;
    const run = c.running;
    const leds = { busy: run || !!this.jog, step: this.step, hold: c.state === "paused", fault: w.faultActive, run, io: true, prod: w.mode === "AUTO", tcyc: run && w.mode === "AUTO" };
    const ovr = typeof this.ovr === "number" ? this.ovr + "%" : this.ovr;
    const title = `<span>${escH(this.selected)}</span><span>LINE ${this.cur.line + 1}</span><span class="m${w.mode === "AUTO" ? " auto" : ""}">${w.mode}</span><span>${this.statusText()}</span><span class="inv">${this.group === 2 ? "G2 E1" : this.coord}</span><span class="ovr">${ovr}</span>${w.weldEnable ? '<span class="weld">WELD</span>' : ""}`;
    let body = "", fk = ["", "", "", "", ""];
    const s = this.screen;
    if (s === "edit") {
      const p = this.prog;
      body = `<div class="hd">${escH(p.name)}${p.comment ? "  " + escH(p.comment) : ""}</div>`;
      p.lines.forEach((ln, i) => {
        const isCur = i === this.cur.line;
        let txt = escH(ln.replace(/\n\s*/g, " "));
        if (isCur && this.cur.field >= 0) {
          const f = this.fields(ln)[this.cur.field];
          if (f) txt = escH(ln.slice(0, f.start)) + `<b class="fld">${escH(f.text)}</b>` + escH(ln.slice(f.end));
        }
        const motion = /^[JLC]\s/.test(ln);
        body += `<div class="ln${isCur ? " cur" : ""}"><span class="no">${String(i + 1).padStart(3)}:</span>${motion ? "" : "  "}${txt} ;</div>`;
      });
      body += `<div class="ln end"><span class="no">${String(p.lines.length + 1).padStart(3)}:</span> [End]</div>`;
      if (this.split) body += `<div class="split">${this.posnTable()}</div>`;
      fk = this.fpage === 0 ? ["POINT", "ARCSTRT", "WELD_PT", "ARCEND", "TOUCHUP &gt;"] : ["[INST]", "[EDCMD]", "", "[CHOICE]", "&gt;"];
    } else if (s === "select") {
      body = `<div class="hd">Select program</div>` + this.progs.map((p, i) => `<div class="ln${i === this.selCur ? " cur" : ""}"><span class="no">${String(i + 1).padStart(3)}</span> ${escH(p.name.padEnd(12))} ${escH(p.comment || "")}${p.name === this.selected ? "   *" : ""}</div>`).join("");
      fk = ["[TYPE]", "CREATE", "DELETE", "MONITOR", "[ATTR]"];
    } else if (s === "posn") {
      body = `<div class="hd">Current position · ${this.posRep}</div>` + this.posnTable();
      fk = ["JNT", "USER", "WORLD", "", ""];
    } else if (s === "io") {
      const names = this.ioType === "DI" ? DI_NAMES : DO_NAMES;
      body = `<div class="hd">I/O Digital ${this.ioType === "DI" ? "In" : "Out"}</div><div class="ln head"><span class="no"> #</span> SIM STATUS  COMMENT</div>`;
      for (let i = 1; i <= 8; i++) {
        const v = this.ioType === "DI" ? w.getDI(i) : w.dout[i];
        const sim = this.ioType === "DI" && w.dsim[i] != null;
        body += `<div class="ln${i - 1 === this.ioCur ? " cur" : ""}"><span class="no">${this.ioType}[${i}]</span>  ${sim ? "S" : "U"}   ${v ? "<b class='on'>ON </b>" : "OFF"}   ${escH(names[i] || "")}</div>`;
      }
      fk = this.ioType === "DI" ? ["[TYPE]", "", "SIMULATE", "ON", "OFF"] : ["[TYPE]", "", "", "ON", "OFF"];
    } else if (s === "data") {
      if (this.dataType === "R") {
        body = `<div class="hd">DATA Registers</div>`;
        for (let i = 1; i <= 10; i++) { const v = this.regs[i] ?? 0; body += `<div class="ln${i - 1 === this.dataCur ? " cur" : ""}"><span class="no">R[${String(i).padStart(2)}]</span> = ${escH(String(+(+v).toFixed(3)))}</div>`; }
      } else {
        body = `<div class="hd">DATA Weld schedules</div><div class="ln head"><span class="no"> #</span>  Volts   Amps  Speed  Name</div>`;
        WELD.schedules.slice(1).forEach((sc, i) => { body += `<div class="ln${i === this.dataCur ? " cur" : ""}"><span class="no">${String(i + 1).padStart(2)}</span>  ${sc.volts.toFixed(1).padStart(5)} ${String(sc.amps).padStart(6)} ${sc.speed.toFixed(1).padStart(5)}  ${escH(sc.name)}</div>`; });
      }
      fk = ["[TYPE]", "", "", "", ""];
    } else if (s === "alarm") {
      const list = this.almHist ? w.history : w.alarms;
      this.almCur = Math.min(this.almCur, Math.max(0, list.length - 1));
      body = `<div class="hd">Alarm: ${this.almHist ? "History" : "Active"}</div>` + (list.length ? list.map((a, i) => `<div class="ln${i === this.almCur ? " cur" : ""}"><span class="no">${String(i + 1).padStart(3)}</span> ${escH(a.code)} ${escH(a.text)}${a.line ? ` (line ${this.mnLine(a.line)})` : ""}</div>`).join("") : `<div class="ln">  No ${this.almHist ? "alarm history" : "active alarms"}.</div>`);
      fk = [this.almHist ? "ACTIVE" : "HIST", "", "", "RESET", ""];
    } else if (s === "status") {
      const sc = WELD.schedules[w.arc.sched] || WELD.schedules[1];
      body = `<div class="hd">STATUS</div>` + [
        ["Mode", w.mode], ["Teach pendant", w.tpOn ? "ON" : "OFF"], ["Enabling switch", w.deadman ? "held" : "released"], ["Servo", w.servoOn ? "ON" : "OFF"],
        ["Program", `${this.selected} (${this.statusText()})`], ["Override", ovr], ["Step", this.step ? "ON" : "OFF"], ["Weld enable", w.weldEnable ? "ON" : "OFF"],
        ["Arc", w.arc.phase === "on" ? `${w.arc.volts.toFixed(1)} V ${w.arc.amps.toFixed(0)} A` : w.arc.phase.toUpperCase()], ["Schedule", `${w.arc.sched}: ${sc.name}`],
        ["UTOOL / UFRAME", `${w.toolIdx} / ${w.frameIdx}`], ["Positioner E1", w.e1.toFixed(1) + " deg"],
      ].map(([k, v]) => `<div class="ln"><span class="no">${escH(k.padEnd(15))}</span> ${escH(v)}</div>`).join("");
    } else if (s === "setup") {
      body = `<div class="hd">SETUP Frames</div><div class="ln head">Tool frames (TCP from flange)</div>` +
        WELD.tools.map((t, i) => `<div class="ln"><span class="no">UT ${i}</span> X ${t.tcp.p[0].toFixed(1)} Y ${t.tcp.p[1].toFixed(1)} Z ${t.tcp.p[2].toFixed(1)}  ${escH(t.name)}</div>`).join("") +
        `<div class="ln head">User frames (from world)</div>` + WELD.frames.map((f, i) => `<div class="ln"><span class="no">UF ${i}</span> X ${f.pose.p[0].toFixed(1)} Y ${f.pose.p[1].toFixed(1)} Z ${f.pose.p[2].toFixed(1)}  ${escH(f.name)}</div>`).join("");
    }
    let popup = "";
    if (this.popup) popup = `<div class="hd">${escH(this.popup.title)}</div>` + this.popup.items.map((it, i) => `<div class="ln${i === this.popup.sel ? " cur" : ""}"><span class="no">${i === 9 ? 0 : i + 1}</span> ${escH(it.label)}${it.sub ? " ▸" : ""}</div>`).join("");
    if (this.confirm) { popup = `<div class="hd">${escH(this.confirm.text)}</div>`; fk = ["", "", "", "YES", "NO"]; }
    const prompt = this.num ? `Input: ${escH(this.num)}_` : escH(this.msg);
    this.view.render({ leds, title, body, prompt, fkeys: fk, popup });
    this.view.setKeyState("shift", this.shift);
    this.view.setKeyState("deadman", w.deadman);
    this.view.setKeyState("tpswitch", w.tpOn);
    this.view.setKeyState("estop", w.estopTP);
    this.view.setKeyState("step", this.step);
    this.view.setKeyState("weld", w.weldEnable);
    this.view.setKeyState("group", this.group === 2);
  }
  posnTable() {
    const w = this.w;
    const rep = this.screen === "posn" ? this.posRep : "USER";
    if (rep === "JNT") {
      return `<div class="pt">${w.q.map((v, i) => `<span>J${i + 1} ${v.toFixed(3).padStart(9)}</span>`).join("")}<span>E1 ${w.e1.toFixed(3).padStart(9)}</span></div>`;
    }
    const P = rep === "WORLD" ? w.tcpTaught() : w.currentPose();
    const e = Rot.toFixedXYZ(P.R);
    const f = rep === "WORLD" ? "World" : `UF ${Math.max(0, w.frameIdx)}`;
    return `<div class="pt"><span>Frame ${f}  UT ${w.toolIdx}</span><span></span><span>X ${P.p[0].toFixed(3).padStart(9)}</span><span>W ${e[0].toFixed(3).padStart(9)}</span><span>Y ${P.p[1].toFixed(3).padStart(9)}</span><span>P ${e[1].toFixed(3).padStart(9)}</span><span>Z ${P.p[2].toFixed(3).padStart(9)}</span><span>R ${e[2].toFixed(3).padStart(9)}</span><span>E1 ${w.e1.toFixed(3).padStart(8)}</span><span>CONF N U T</span></div>`;
  }
}
