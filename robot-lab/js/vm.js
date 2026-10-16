"use strict";
// Common robot virtual machine. Each language parser produces the same
// statement tree; this module compiles it to flat code with jumps and runs it
// against the simulated cell, planning real joint/linear/circular motion.

class RobotError extends Error {
  constructor(msg, line) { super(msg); this.line = line; }
}

// ---------- Value helpers ----------
const isPose = (v) => v && v.type === "pose";
const isJoints = (v) => v && v.type === "joints";
const num = (v, line, what) => {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "number" || !isFinite(v)) throw new RobotError(`${what || "Value"} must be a number.`, line);
  return v;
};
const truthy = (v) => (typeof v === "number" ? v !== 0 : !!v);
const clonePose = (P) => ({ type: "pose", p: P.p.slice(), R: P.R.slice(), frame: P.frame, tool: P.tool, e1: P.e1 });

// KUKA counts A2/A3 from its own zero (arm upright = A2 -90, A3 +90)
const KUKA_AXIS = { toInternal: (a) => [a[0], a[1] + 90, a[2] - 90, a[3], a[4], a[5]], fromInternal: (q) => [q[0], q[1] - 90, q[2] + 90, q[3], q[4], q[5]] };
// KUKA tools point along the flange X axis; the simulator's tools point along Z.
const KUKA_TOOL_FIX = Mat.ry(Math.PI / 2);
const YAS_PULSE_PER_DEG = 1000; // simulator convention, documented in the Yaskawa lessons

const Conv = {
  abb: (v) => Pose.make([v[0], v[1], v[2]], Rot.fromQuat([v[3], v[4], v[5], v[6]])),
  wpr: (v) => Pose.make([v[0], v[1], v[2]], Rot.fromFixedXYZ(v[3], v[4], v[5])),
  ur: (v) => Pose.make([v[0] * 1000, v[1] * 1000, v[2] * 1000], Rot.fromRotVec([v[3], v[4], v[5]])),
  kuka: (f) => Pose.make([f.X || 0, f.Y || 0, f.Z || 0], Mat.mul(Rot.fromZYX(f.A || 0, f.B || 0, f.C || 0), KUKA_TOOL_FIX)),
  kukaToolVec: (f) => Pose.make(Mat.mv(Mat.ry(-Math.PI / 2), [f.X || 0, f.Y || 0, f.Z || 0]), Mat.I()),
  kukaToolData: (f) => Pose.make(Mat.mv(Mat.ry(-Math.PI / 2), [f.X || 0, f.Y || 0, f.Z || 0]), Mat.mul(Mat.mul(Mat.ry(-Math.PI / 2), Rot.fromZYX(f.A || 0, f.B || 0, f.C || 0)), KUKA_TOOL_FIX)),
  jdeg: (v) => Joints.make(v),
  jrad: (v) => Joints.make(v.map((x) => x / DEG)),
  jkuka: (v) => Joints.make(KUKA_AXIS.toInternal(v)),
  jpulse: (v) => Joints.make(v.map((x) => x / YAS_PULSE_PER_DEG)),
};

// Field access used by RAPID (p.trans.x), KRL (p.X), TP (PR[1,3]), URScript (p[2]) and INFORM (SETE)
function getField(v, f, line) {
  if (isJoints(v)) { const i = +f.slice(1); if (f[0] === "j" && i >= 0 && i < 6) return v.q[i]; }
  if (!isPose(v)) {
    if (Array.isArray(v) && /^u\d$/.test(f)) return v[+f[1]];
    throw new RobotError(`Cannot read .${f} of a ${describe(v)}.`, line);
  }
  switch (f) {
    case "x": return v.p[0]; case "y": return v.p[1]; case "z": return v.p[2];
    case "w": case "p": case "r": return Rot.toFixedXYZ(v.R)["wpr".indexOf(f)];
    case "ka": case "kb": case "kc": return Rot.toZYX(Mat.mul(v.R, Mat.tr(KUKA_TOOL_FIX)))[{ ka: 0, kb: 1, kc: 2 }[f]];
    case "u0": case "u1": case "u2": return v.p[+f[1]] / 1000;
    case "u3": case "u4": case "u5": return Rot.toRotVec(v.R)[+f[1] - 3];
  }
  throw new RobotError(`Unknown field ${f}.`, line);
}
function setField(v, f, x, line) {
  if (isJoints(v) && f[0] === "j") { v.q[+f.slice(1)] = x; return; }
  if (!isPose(v)) throw new RobotError(`Cannot set .${f} of a ${describe(v)}.`, line);
  if (f === "x" || f === "y" || f === "z") { v.p["xyz".indexOf(f)] = x; return; }
  if ("wpr".includes(f) && f.length === 1) { const e = Rot.toFixedXYZ(v.R); e["wpr".indexOf(f)] = x; v.R = Rot.fromFixedXYZ(e[0], e[1], e[2]); return; }
  if (f === "ka" || f === "kb" || f === "kc") { const e = Rot.toZYX(Mat.mul(v.R, Mat.tr(KUKA_TOOL_FIX))); e[{ ka: 0, kb: 1, kc: 2 }[f]] = x; v.R = Mat.mul(Rot.fromZYX(e[0], e[1], e[2]), KUKA_TOOL_FIX); return; }
  if (/^u[0-2]$/.test(f)) { v.p[+f[1]] = x * 1000; return; }
  if (/^u[3-5]$/.test(f)) { const r = Rot.toRotVec(v.R); r[+f[1] - 3] = x; v.R = Rot.fromRotVec(r); return; }
  throw new RobotError(`Unknown field ${f}.`, line);
}
function describe(v) {
  if (isPose(v)) return "position"; if (isJoints(v)) return "joint position";
  if (typeof v === "boolean") return "boolean"; if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "list"; return typeof v;
}

// ---------- Compiler: structured statements -> flat code ----------
function compileProgram(prog) {
  const out = { procs: {}, main: prog.main, globals: prog.globals || {}, norm: prog.norm || ((s) => s) };
  for (const name in prog.procs) {
    const code = [], labels = {}, fix = [];
    const loopStack = [];
    const emit = (ins) => { code.push(ins); return code.length - 1; };
    const walk = (stmts) => {
      for (const s of stmts) {
        switch (s.op) {
          case "if": {
            const jz = emit({ t: "jz", cond: s.cond, line: s.line });
            walk(s.then);
            if (s.else && s.else.length) {
              const jend = emit({ t: "jmp", line: s.line });
              code[jz].to = code.length; walk(s.else); code[jend].to = code.length;
            } else code[jz].to = code.length;
            break;
          }
          case "while": {
            const top = code.length, jz = emit({ t: "jz", cond: s.cond, line: s.line });
            loopStack.push([]); walk(s.body);
            emit({ t: "jmp", to: top, line: s.line }); code[jz].to = code.length;
            loopStack.pop().forEach((i) => (code[i].to = code.length));
            break;
          }
          case "loop": {
            const top = code.length; loopStack.push([]); walk(s.body);
            emit({ t: "jmp", to: top, line: s.line });
            loopStack.pop().forEach((i) => (code[i].to = code.length));
            break;
          }
          case "repeat": { // body runs, then exits when cond is true
            const top = code.length; loopStack.push([]); walk(s.body);
            emit({ t: "jz", cond: s.cond, to: top, line: s.line });
            loopStack.pop().forEach((i) => (code[i].to = code.length));
            break;
          }
          case "for": {
            emit({ t: "stmt", s: { op: "assign", target: { name: s.var, path: [] }, expr: s.from, line: s.line }, line: s.line });
            const top = code.length;
            const step = s.step || { k: "num", v: 1 };
            const cond = { k: "forcond", v: { k: "var", name: s.var }, to: s.to, step };
            const jz = emit({ t: "jz", cond, line: s.line });
            loopStack.push([]); walk(s.body);
            emit({ t: "stmt", s: { op: "assign", target: { name: s.var, path: [] }, expr: { k: "bin", op: "+", a: { k: "var", name: s.var }, b: step }, line: s.line }, line: s.line });
            emit({ t: "jmp", to: top, line: s.line }); code[jz].to = code.length;
            loopStack.pop().forEach((i) => (code[i].to = code.length));
            break;
          }
          case "exit": {
            if (!loopStack.length) throw new RobotError("EXIT is only allowed inside a loop.", s.line);
            loopStack[loopStack.length - 1].push(emit({ t: "jmp", line: s.line }));
            break;
          }
          case "label": labels[s.name] = code.length; break;
          case "jump": fix.push(emit({ t: s.cond ? "jnz" : "jmp", cond: s.cond, label: s.name, line: s.line })); break;
          default: emit({ t: "stmt", s, line: s.line });
        }
      }
    };
    walk(prog.procs[name].body);
    for (const i of fix) {
      const ins = code[i];
      if (!(ins.label in labels)) throw new RobotError(`Jump target ${ins.label} is not defined in ${name}.`, ins.line);
      ins.to = labels[ins.label];
    }
    out.procs[name] = { code, line: prog.procs[name].line, endLine: prog.procs[name].endLine };
  }
  if (!out.procs[out.main]) throw new RobotError(`No main routine "${out.main}" found.`, 1);
  return out;
}

// ---------- Motion planning ----------
function easeProfile(T, accIn, decOut) {
  const ta = Math.min(0.32, T * 0.5);
  const a1 = accIn ? ta : 0, a2 = decOut ? ta : 0, vc = 1 / T;
  const tc = T - (a1 + a2) / 2, total = a1 + tc + a2;
  return {
    total,
    at(t) {
      if (t <= 0) return 0; if (t >= total) return 1;
      if (t < a1) return vc * t * t / (2 * a1);
      if (t < a1 + tc) return vc * a1 / 2 + vc * (t - a1);
      const r = total - t; return 1 - (a2 ? vc * r * r / (2 * a2) : vc * r);
    },
  };
}

function circleThrough(P0, P1, P2) {
  const a = Vec.sub(P1, P0), b = Vec.sub(P2, P0);
  const n = Vec.cross(a, b), nn = Vec.dot(n, n);
  if (nn < 1e-6) return null;
  const c = Vec.add(P0, Vec.scale(Vec.add(Vec.scale(Vec.cross(n, a), Vec.dot(b, b)), Vec.scale(Vec.cross(b, n), Vec.dot(a, a))), 1 / (2 * nn)));
  const u = Vec.norm(Vec.sub(P0, c)), nrm = Vec.norm(n), v = Vec.cross(nrm, u), r = Vec.len(Vec.sub(P0, c));
  const ang = (P) => { const d = Vec.sub(P, c); let t = Math.atan2(Vec.dot(d, v), Vec.dot(d, u)); if (t < 0) t += 2 * Math.PI; return t; };
  const th2 = ang(P2);
  return { c, u, v, r, th: th2, point: (t) => Vec.add(c, Vec.add(Vec.scale(u, r * Math.cos(t)), Vec.scale(v, r * Math.sin(t)))) };
}

// Builds a motion from joint position q0. Returns { dur, sample(t)->q, kind, endQ, blended }.
function planMotion(spec, ctl) {
  const { kind, line } = spec;
  const q0 = ctl.world.q.slice();
  const tool = ctl.world.toolPose();
  const toolInv = Pose.inv(tool);
  const tcp0 = Pose.mul(fkFlange(q0), tool);
  const ik = (tcpWorld, ref) => ikFlange(Pose.mul(tcpWorld, toolInv), ref);
  const fail = (r, where) => {
    const what = r.error === "reach" ? "Target is out of reach" : r.error === "limit" ? "Joint limit" : "Singularity";
    throw new RobotError(`${what}${where ? " " + where : ""}. ${r.detail}`, line);
  };
  let qs = null, endQ, Tbase, lengthMM = 0;
  // optional external axis (positioner) moving with the robot, in degrees
  const e10 = ctl.world.e1 || 0;
  const e11 = spec.target && spec.target.e1 != null ? spec.target.e1 : e10;
  const coordMM = Math.abs(e11 - e10) * DEG * (ctl.world.coordRadius || 0);
  const cap = ctl.world.speedCap || Infinity; // T1 limits TCP speed to 250 mm/s

  if (kind === "J") {
    if (isJoints(spec.target)) {
      endQ = spec.target.q.slice();
      const bad = endQ.findIndex((v, i) => v < ARM.limits[i][0] || v > ARM.limits[i][1]);
      if (bad >= 0) throw new RobotError(`Joint limit. Axis ${bad + 1} target ${endQ[bad].toFixed(1)}° is outside ${ARM.limits[bad][0]}° to ${ARM.limits[bad][1]}°.`, line);
    } else {
      const r = ik(spec.target, q0);
      if (r.error) fail(r);
      endQ = r.q;
    }
    const pct = Math.max(1, Math.min(100, spec.pct || 50)) / 100;
    Tbase = Math.max(0.15, Math.max(...endQ.map((v, i) => Math.abs(v - q0[i]) / (ARM.vmax[i] * pct))));
    const tcp1 = Pose.mul(fkFlange(endQ), tool);
    lengthMM = Vec.len(Vec.sub(tcp1.p, tcp0.p));
    Tbase = Math.max(Tbase, Math.abs(e11 - e10) / (90 * pct), lengthMM / cap);
  } else {
    // Cartesian path: sample it, solve IK at each step, and reject paths that leave the workspace
    let pointAt, R1;
    const endCheck = ik(spec.target, q0);
    if (endCheck.error) fail(endCheck);
    if (kind === "L") {
      const P1 = spec.target.p; R1 = spec.target.R;
      lengthMM = Vec.len(Vec.sub(P1, tcp0.p));
      pointAt = (f) => Vec.lerp(tcp0.p, P1, f);
    } else {
      const arc = circleThrough(tcp0.p, spec.via.p, spec.target.p);
      if (!arc) throw new RobotError("Circular move needs three distinct, non-collinear points (start, via, end).", line);
      R1 = spec.target.R;
      lengthMM = arc.r * arc.th;
      pointAt = (f) => arc.point(arc.th * f);
    }
    const rotDeg = Rot.angleBetween(tcp0.R, R1);
    const n = Math.max(12, Math.ceil(Math.max(lengthMM / 4, rotDeg / 1.5)));
    qs = [q0];
    let ref = q0;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const r = ik({ p: pointAt(f), R: Rot.slerp(tcp0.R, R1, f) }, ref);
      if (r.error) fail(r, `${Math.round(f * 100)}% of the way along the ${kind === "L" ? "linear" : "circular"} path`);
      const jump = Math.max(...r.q.map((v, k) => Math.abs(v - ref[k])));
      if (jump > 20 || Math.abs(r.q[4]) < 1) throw new RobotError(`Wrist singularity ${Math.round(f * 100)}% along the path: axis 5 passes through 0° and axes 4 and 6 would spin. Add a joint move or change the tool orientation.`, line);
      qs.push(r.q); ref = r.q;
    }
    endQ = qs[n];
    const v = Math.min(cap, Math.max(1, spec.mms || 250));
    const jointT = Math.max(...qs.slice(1).map((q, i) => Math.max(...q.map((x, k) => Math.abs(x - qs[i][k]) / ARM.vmax[k])))) * n;
    Tbase = Math.max(0.1, (lengthMM + coordMM) / v, rotDeg / 120, jointT, Math.abs(e11 - e10) / 90);
  }

  // Blending: finish early by the zone radius when the path is long enough, without stopping.
  const blend = spec.blend || 0;
  const endFrac = blend > 0 && lengthMM > 2 * blend ? 1 - blend / lengthMM : 1;
  const profile = easeProfile(Tbase * endFrac, !ctl.lastBlended, endFrac === 1);
  const qAt = (f) => {
    if (!qs) return q0.map((v, i) => v + (endQ[i] - v) * f);
    const x = f * (qs.length - 1), i = Math.min(qs.length - 2, Math.floor(x)), t = x - i;
    return qs[i].map((v, k) => v + (qs[i + 1][k] - v) * t);
  };
  return {
    kind, line, dur: profile.total, profile, endFrac, blended: endFrac < 1, hasE1: e11 !== e10,
    sample(t) { return qAt(profile.at(t) * endFrac); },
    e1At(t) { return e10 + (e11 - e10) * profile.at(t) * endFrac; },
  };
}

// ---------- Controller ----------
class Controller {
  constructor(world) {
    this.world = world;
    this.prog = null;
    this.state = "idle"; // idle | running | paused | waiting | done | error
    this.cycle = 0; this.vars = {};
  }
  load(prog) {
    this.prog = compileProgram(prog);
    this.reset();
  }
  reset() {
    this.vars = {};
    if (this.prog) for (const k in this.prog.globals) this.vars[k] = this.copy(this.prog.globals[k]);
    this.stack = [];
    this.frame = this.prog ? { proc: this.prog.main, pc: 0 } : null;
    this.motion = null; this.mt = 0; this.waitUntil = null; this.waitDI = null; this.extWait = null;
    this.lastBlended = false; this.defaults = { pct: 50, mms: 250, blend: 0 };
    this.shift = null; this.cycle = 0; this.line = this.prog ? this.prog.procs[this.prog.main].line : 0;
    this.state = this.prog ? "idle" : "idle"; this.stepMode = false; this.error = null;
  }
  copy(v) { if (isPose(v)) return clonePose(v); if (isJoints(v)) return Joints.make(v.q); if (Array.isArray(v)) return v.slice(); return v; }

  // ---- expressions ----
  lookup(name, line) {
    if (name in this.vars) return this.vars[name];
    const pt = name.match(/^(\w+):(.+)$/);
    if (pt) throw new RobotError(`Position ${pt[2]} has no data. Add it to the position section of ${pt[1]}.`, line);
    throw new RobotError(`"${name}" is not declared.`, line);
  }
  ev(e, line) {
    switch (e.k) {
      case "num": return e.v;
      case "bool": return e.v;
      case "str": return e.v;
      case "var": return this.lookup(e.name, line);
      case "ilf": { // KUKA inline form: P1 refers to XP1 in the .dat file
        if (("X" + e.name) in this.vars) return this.vars["X" + e.name];
        return this.lookup(e.name, line);
      }
      case "lit": return this.copy(e.v);
      case "list": return e.items.map((x) => this.ev(x, line));
      case "posebuild": {
        const v = e.items.map((x) => num(this.ev(x, line), line, "Position value"));
        const P = Conv[e.conv](v); if (e.frame != null) P.frame = e.frame; return P;
      }
      case "jointbuild": return Conv[e.conv](e.items.map((x) => num(this.ev(x, line), line, "Joint value")));
      case "agg": { // KRL aggregate
        const f = {}; for (const k in e.fields) f[k] = num(this.ev(e.fields[k], line), line, k);
        if ("A1" in f) return Conv.jkuka([1, 2, 3, 4, 5, 6].map((i) => f["A" + i] || 0));
        return e.toolvec ? Conv.kukaToolVec(f) : e.tooldata ? Conv.kukaToolData(f) : Conv.kuka(f);
      }
      case "field": return getField(this.ev(e.base, line), e.name, line);
      case "index": {
        const b = this.ev(e.base, line), i = num(this.ev(e.index, line), line, "Index");
        if (isPose(b)) return getField(b, "u" + i, line);
        if (isJoints(b)) return b.q[i] * DEG;
        if (Array.isArray(b)) { if (i < 0 || i >= b.length) throw new RobotError(`Index ${i} is out of range.`, line); return b[i]; }
        throw new RobotError("Only lists and poses can be indexed.", line);
      }
      case "un": {
        const a = this.ev(e.a, line);
        if (e.op === "not") return !truthy(a);
        if (e.op === "neg") return -num(a, line);
        break;
      }
      case "forcond": {
        const v = num(this.ev(e.v, line), line), to = num(this.ev(e.to, line), line), st = num(this.ev(e.step, line), line);
        return st >= 0 ? v <= to + 1e-9 : v >= to - 1e-9;
      }
      case "bin": return this.bin(e.op, e.a, e.b, line);
      case "call": return this.callFn(e.name, e.args.map((a) => this.ev(a, line)), line);
    }
    throw new RobotError("Cannot evaluate expression.", line);
  }
  bin(op, ea, eb, line) {
    if (op === "and") return truthy(this.ev(ea, line)) && truthy(this.ev(eb, line));
    if (op === "or") return truthy(this.ev(ea, line)) || truthy(this.ev(eb, line));
    const a = this.ev(ea, line), b = this.ev(eb, line);
    if (op === "xor") return truthy(a) !== truthy(b);
    if (isPose(a) && isPose(b) && (op === "+" || op === "-")) { // register arithmetic, component-wise (TP style)
      const s = op === "+" ? 1 : -1, ea2 = Rot.toFixedXYZ(a.R), eb2 = Rot.toFixedXYZ(b.R);
      const P = Pose.make(a.p.map((v, i) => v + s * b.p[i]), Rot.fromFixedXYZ(ea2[0] + s * eb2[0], ea2[1] + s * eb2[1], ea2[2] + s * eb2[2]));
      return P;
    }
    if (op === "==") return isPose(a) || isPose(b) ? false : (typeof a === "boolean" || typeof b === "boolean" ? truthy(a) === truthy(b) : a === b);
    if (op === "!=") return !(typeof a === "boolean" || typeof b === "boolean" ? truthy(a) === truthy(b) : a === b);
    if (typeof a === "string" || typeof b === "string") { if (op === "+") return String(a) + String(b); }
    const x = num(a, line), y = num(b, line);
    switch (op) {
      case "+": return x + y; case "-": return x - y; case "*": return x * y;
      case "/": if (y === 0) throw new RobotError("Division by zero.", line); return x / y;
      case "div": if (y === 0) throw new RobotError("Division by zero.", line); return Math.trunc(x / y);
      case "mod": if (y === 0) throw new RobotError("Division by zero.", line); return x - y * Math.trunc(x / y);
      case "<": return x < y; case ">": return x > y; case "<=": return x <= y; case ">=": return x >= y;
    }
    throw new RobotError(`Unknown operator ${op}.`, line);
  }
  callFn(name, a, line) {
    const P = (v, i) => { if (!isPose(v)) throw new RobotError(`Argument ${i + 1} of ${name} must be a position.`, line); return v; };
    switch (name) {
      case "offs": { const b = P(a[0], 0), r = clonePose(b); r.p = Vec.add(b.p, [num(a[1], line), num(a[2], line), num(a[3], line)]); return r; }
      case "reltool": {
        const b = P(a[0], 0), r = clonePose(b);
        r.p = Vec.add(b.p, Mat.mv(b.R, [num(a[1], line), num(a[2], line), num(a[3], line)]));
        if (a.length > 4) r.R = Mat.mul(b.R, Rot.fromFixedXYZ(num(a[4] || 0, line), num(a[5] || 0, line), num(a[6] || 0, line)));
        return r;
      }
      case "pose_trans": { const r = Pose.mul(P(a[0], 0), P(a[1], 1)); r.frame = a[0].frame; return r; }
      case "pose_add": { const b = P(a[0], 0), d = P(a[1], 1); return Pose.make(Vec.add(b.p, d.p), Mat.mul(d.R, b.R), b.frame); }
      case "pose_inv": { return Pose.inv(P(a[0], 0)); }
      case "cur": return this.world.currentPose();
      case "urq": { // URScript movej accepts a joint list in radians or a pose
        const v = a[0];
        if (Array.isArray(v)) { if (v.length !== 6) throw new RobotError("Joint list needs 6 values (radians).", line); return Conv.jrad(v.map((x) => num(x, line))); }
        return v;
      }
      case "curj": return Joints.make(this.world.q);
      case "di": return this.world.getDI(num(a[0], line), line);
      case "do": return this.world.getDO(num(a[0], line), line);
      case "abs": return Math.abs(num(a[0], line));
      case "sqrt": return Math.sqrt(num(a[0], line));
      case "sind": return Math.sin(num(a[0], line) * DEG);
      case "cosd": return Math.cos(num(a[0], line) * DEG);
      case "sin": return Math.sin(num(a[0], line));
      case "cos": return Math.cos(num(a[0], line));
      case "tan": return Math.tan(num(a[0], line));
      case "atan2": return Math.atan2(num(a[0], line), num(a[1], line));
      case "atan2d": return Math.atan2(num(a[0], line), num(a[1], line)) / DEG;
      case "floor": return Math.floor(num(a[0], line));
      case "round": return Math.round(num(a[0], line));
      case "trunc": return Math.trunc(num(a[0], line));
      case "d2r": return num(a[0], line) * DEG;
      case "r2d": return num(a[0], line) / DEG;
      case "norm": return isPose(a[0]) ? Vec.len(a[0].p) / 1000 : Math.abs(num(a[0], line));
      case "dist": return Vec.len(Vec.sub(P(a[0], 0).p, P(a[1], 1).p));
      case "str": return String(typeof a[0] === "number" ? +a[0].toFixed(3) : a[0]);
    }
    if (this.world.fn) { const r = this.world.fn(name, a, line); if (r !== undefined) return r; }
    throw new RobotError(`Unknown function ${name}().`, line);
  }
  assign(t, value, line) {
    if (!t.path || !t.path.length) {
      if (t.decl === false && !(t.name in this.vars)) throw new RobotError(`"${t.name}" is not declared.`, line);
      this.vars[t.name] = this.copy(value); return;
    }
    if (!(t.name in this.vars)) throw new RobotError(`"${t.name}" is not declared.`, line);
    let obj = this.vars[t.name];
    for (let i = 0; i < t.path.length - 1; i++) obj = obj[t.path[i]];
    const f = t.path[t.path.length - 1];
    if (Array.isArray(obj) && typeof f === "number") obj[f] = value;
    else setField(obj, typeof f === "number" ? "u" + f : f, num(value, line), line);
  }

  // ---- execution ----
  get running() { return this.state === "running" || this.state === "waiting"; }
  start() { if (!this.prog) return; if (this.state === "done" || this.state === "error") this.restart(); this.state = "running"; this.stepMode = false; }
  restart() { this.reset(); }
  step() { if (!this.prog) return; if (this.state === "done" || this.state === "error") this.restart(); this.state = "running"; this.stepMode = true; this.stepTaken = false; }
  pause() { if (this.running) this.state = "paused"; }
  // start (or continue) execution at the first instruction of the main routine on or after a source line
  startAt(line, stepMode) {
    if (!this.prog) return;
    const code = this.prog.procs[this.prog.main].code;
    let pc = code.findIndex((ins) => ins.line >= line);
    if (pc < 0) pc = code.length;
    this.stack = []; this.frame = { proc: this.prog.main, pc };
    this.motion = null; this.waitUntil = null; this.waitDI = null; this.extWait = null; this.error = null;
    this.state = "running"; this.stepMode = !!stepMode;
  }

  tick(dt) {
    if (this.state !== "running" && this.state !== "waiting") return;
    try {
      this.cycle += dt;
      if (this.motion) {
        this.mt += dt * this.world.speedScale();
        const m = this.motion;
        const q = m.sample(Math.min(this.mt, m.dur));
        this.world.setJoints(q, m.kind, m.line, m.hasE1 ? m.e1At(Math.min(this.mt, m.dur)) : undefined);
        if (this.mt >= m.dur) {
          this.lastBlended = m.blended; this.motion = null; this.mt = 0;
          if (this.stepMode) { this.state = "paused"; return; }
        } else return;
      }
      if (this.waitUntil != null) {
        this.waitUntil -= dt * this.world.speedScale();
        if (this.waitUntil > 0) return;
        this.waitUntil = null; this.state = "running";
        if (this.stepMode) { this.state = "paused"; return; }
      }
      if (this.extWait) { // e.g. arc start waiting for the arc-detect signal
        if (!this.extWait()) { this.state = "waiting"; return; }
        this.extWait = null; this.state = "running";
        if (this.stepMode) { this.state = "paused"; return; }
      }
      if (this.waitDI) {
        if (truthy(this.ev(this.waitDI.cond, this.waitDI.line)) !== true) { this.state = "waiting"; return; }
        this.waitDI = null; this.state = "running";
        if (this.stepMode) { this.state = "paused"; return; }
      }
      this.run();
    } catch (err) {
      this.fault(err);
    }
  }
  fault(err) {
    this.state = "error"; this.motion = null;
    this.error = { msg: err.message, line: err.line || this.line };
    this.world.onError(this.error);
  }

  run() {
    let budget = 20000;
    while (this.state === "running") {
      if (--budget <= 0) throw new RobotError("The program ran 20,000 instructions without moving. Check for a loop that never ends.", this.line);
      const proc = this.prog.procs[this.frame.proc];
      if (this.frame.pc >= proc.code.length) { // end of routine
        if (this.stack.length) { this.frame = this.stack.pop(); continue; }
        this.line = proc.endLine || this.line;
        this.state = "done"; this.world.onDone(this.cycle); return;
      }
      const ins = proc.code[this.frame.pc++];
      this.line = ins.line; this.world.onLine(ins.line);
      if (ins.t === "jmp") { this.frame.pc = ins.to; continue; }
      if (ins.t === "jz") { if (!truthy(this.ev(ins.cond, ins.line))) this.frame.pc = ins.to; continue; }
      if (ins.t === "jnz") { if (truthy(this.ev(ins.cond, ins.line))) this.frame.pc = ins.to; continue; }
      const blocked = this.exec(ins.s);
      if (blocked) return;
      if (this.stepMode && ins.s.op !== "nop") { this.state = "paused"; return; }
    }
  }

  moveTarget(s) {
    let T = this.ev(s.target, s.line);
    if (s.rel) { // relative move (LIN_REL, IMOV, ...): T is an offset
      const cur = this.world.currentPose();
      if (isJoints(T)) return Joints.make(this.world.q.map((v, i) => v + T.q[i]));
      if (!isPose(T)) throw new RobotError("Relative move needs a position offset.", s.line);
      const P = clonePose(cur);
      if (s.rel === "tool") { P.p = Vec.add(cur.p, Mat.mv(cur.R, T.p)); P.R = Mat.mul(cur.R, s.relRot ? T.R : Mat.I()); }
      else { P.p = Vec.add(cur.p, T.p); }
      T = P;
    }
    if (isJoints(T)) return T;
    if (!isPose(T)) throw new RobotError(`Move target must be a position, not a ${describe(T)}.`, s.line);
    if (s.checkFrame && T.frame != null && T.frame !== this.world.frameIndex()) {
      throw new RobotError(`This point was taught in user frame ${T.frame}, but UFRAME_NUM is ${this.world.frameIndex()}. Set UFRAME_NUM=${T.frame} before the move.`, s.line);
    }
    T = clonePose(T);
    if (s.offset) {
      const off = this.ev(s.offset.expr, s.line);
      if (!isPose(off)) throw new RobotError("Offset must be a position register.", s.line);
      if (s.offset.mode === "tool") { T.p = Vec.add(T.p, Mat.mv(T.R, off.p)); T.R = Mat.mul(T.R, off.R); }
      else { T.p = Vec.add(T.p, off.p); T.R = Mat.mul(off.R, T.R); }
    }
    if (this.shift && !s.rel) {
      const sh = this.shift;
      if (sh.mode === "tool") T.p = Vec.add(T.p, Mat.mv(T.R, sh.pose.p)); else T.p = Vec.add(T.p, sh.pose.p);
    }
    return this.world.toWorld(T);
  }

  exec(s) {
    const w = this.world, L = s.line;
    switch (s.op) {
      case "nop": return false;
      case "move": {
        if (s.tool) w.setTool(this.ev(s.tool, L), L);
        if (s.wobj) w.setFrame(this.ev(s.wobj, L), L);
        const target = this.moveTarget(s);
        const via = s.via ? w.toWorld(this.ev(s.via, L)) : null;
        const mms = s.speed && s.speed.mms ? num(this.ev(s.speed.mms, L), L, "Speed") : this.defaults.mms;
        const pct = s.speed && s.speed.pct ? num(this.ev(s.speed.pct, L), L, "Speed") : this.defaults.pct;
        const blend = s.blend ? num(this.ev(s.blend, L), L, "Zone") : this.defaults.blend;
        let kind = s.kind;
        if (kind !== "J" && isJoints(target)) kind = "J";
        this.motion = planMotion({ kind, target, via, mms, pct, blend, line: L }, this);
        this.mt = 0;
        return true;
      }
      case "setdo": w.setDO(num(this.ev(s.port, L), L), truthy(this.ev(s.value, L)), L); return false;
      case "ext": return w.ext ? w.ext(s, this) === true : false;
      case "pulse": if (w.pulseDO) w.pulseDO(num(this.ev(s.port, L), L), L, s.sec ? num(this.ev(s.sec, L), L) : 0.5); else w.setDO(num(this.ev(s.port, L), L), true, L); return false;
      case "wait": {
        const t = num(this.ev(s.sec, L), L, "Wait time");
        this.waitUntil = t; this.state = "waiting"; return true;
      }
      case "waitcond": this.waitDI = { cond: s.cond, line: L }; this.state = "waiting"; return true;
      case "assign": this.assign(s.target, this.ev(s.expr, L), L); return false;
      case "decl": if (!(s.name in this.vars)) this.vars[s.name] = s.init ? this.copy(this.ev(s.init, L)) : s.zero; return false;
      case "call": {
        const name = this.prog.norm(s.name);
        if (!this.prog.procs[name]) throw new RobotError(`Routine "${s.name}" is not defined.`, L);
        if (this.stack.length > 40) throw new RobotError("Too many nested calls (recursion?).", L);
        this.stack.push(this.frame); this.frame = { proc: name, pc: 0 };
        if (s.args && s.args.length) { // URScript-style parameters
          s.params.forEach((p, i) => (this.vars[p] = this.ev(s.args[i], L)));
        }
        return false;
      }
      case "return":
        if (this.stack.length) { this.frame = this.stack.pop(); return false; }
        this.state = "done"; w.onDone(this.cycle); return true;
      case "halt": this.state = "done"; w.log("Program stopped by instruction.", "info"); w.onDone(this.cycle); return true;
      case "pause": this.state = "paused"; w.log("Paused by program. Press Run to continue.", "info"); return true;
      case "msg": w.log(String(this.ev(s.expr, L)), "msg"); return false;
      case "settool": w.setTool(this.ev(s.value, L), L); return false;
      case "setframe": w.setFrame(this.ev(s.value, L), L); return false;
      case "speed": if (s.mms) this.defaults.mms = num(this.ev(s.mms, L), L); if (s.pct) this.defaults.pct = num(this.ev(s.pct, L), L); return false;
      case "zone": this.defaults.blend = num(this.ev(s.blend, L), L); return false;
      case "override": w.setOverride(num(this.ev(s.value, L), L)); return false;
      case "shift":
        if (!s.value) { this.shift = null; return false; }
        { const v = this.ev(s.value, L); if (!isPose(v)) throw new RobotError("Shift needs a position variable.", L); this.shift = { pose: v, mode: s.mode || "base" }; }
        return false;
    }
    throw new RobotError(`Unsupported statement (${s.op}).`, L);
  }
}
