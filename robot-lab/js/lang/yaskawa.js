"use strict";
// Yaskawa Motoman INFORM job (.JBI): /JOB, //POS with C##### points, //INST with MOVJ/MOVL/MOVC, DOUT, WAIT, JUMP
(function () {
  const PL_MM = [0, 10, 25, 50, 75, 100, 150, 200, 250];
  const isVar = (u) => /^(I|B|D|R|P|LI|LD|LR|LP)\d{3}$/.test(u);

  function makeP(job) {
    return makeExprParser({
      binops: { "=": "==", "<>": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">=", "+": "+", "-": "-", "*": "*", "/": "/", AND: "and", OR: "or" },
      unops: { "-": "neg", NOT: "not" },
      ident(t) {
        if (t.u === "ON") return { k: "bool", v: true };
        if (t.u === "OFF") return { k: "bool", v: false };
        if (/^C\d{5}$/.test(t.u)) return { k: "var", name: `${job}:${t.u}` };
        if (isVar(t.u)) return { k: "var", name: t.u };
        throw new ParseError(`"${t.v}" is not an INFORM variable. Use I000, B000, D000, R000 or P000 style names.`, t.line);
      },
      func(t, args) {
        if (t.u === "IN#" || t.u === "IG#") return { k: "call", name: "di", args };
        if (t.u === "OT#" || t.u === "OG#") return { k: "call", name: "do", args };
        throw new ParseError(`Unknown signal ${t.v}( ).`, t.line);
      },
    });
  }

  function parse(src) {
    const lines = src.split(/\r?\n/);
    const prog = { procs: {}, main: null, globals: {}, norm: (s) => s.toUpperCase() };
    const used = new Set();
    let job = null, section = null, pt = { frame: 0, pulse: false };
    const startJob = (name, line) => {
      job = { name: name.toUpperCase(), body: [], line, tool: null };
      prog.procs[job.name] = job; if (!prog.main) prog.main = job.name;
      pt = { frame: 0, pulse: false };
    };
    for (let i = 0; i < lines.length; i++) {
      const line = i + 1;
      const t = lines[i].trim();
      if (!t) continue;
      let m;
      if (/^\/JOB\b/i.test(t)) { job = null; section = "head"; continue; }
      if ((m = t.match(/^\/\/NAME\s+(\S+)/i))) { startJob(m[1], line); continue; }
      if (/^\/\/POS\b/i.test(t)) { if (!job) startJob("MAIN", line); section = "pos"; continue; }
      if (/^\/\/INST\b/i.test(t)) { if (!job) startJob("MAIN", line); section = "inst"; continue; }
      if (t.startsWith("///")) {
        if (section === "pos") {
          if ((m = t.match(/^\/\/\/TOOL\s+(\d+)/i))) job.tool = +m[1];
          else if ((m = t.match(/^\/\/\/USER\s+(\d+)/i))) pt.user = +m[1];
          else if ((m = t.match(/^\/\/\/POSTYPE\s+(\w+)/i))) { const k = m[1].toUpperCase(); pt.pulse = k === "PULSE"; pt.frame = k === "USER" ? (pt.user || 1) : 0; }
          else if (/^\/\/\/PULSE/i.test(t)) pt.pulse = true;
          else if (/^\/\/\/RECTAN/i.test(t)) pt.pulse = false;
        }
        continue;
      }
      if (t.startsWith("//")) continue;
      if (section === "pos") {
        if ((m = t.match(/^(C\d{5})\s*=\s*(.*)$/i))) {
          const v = m[2].split(",").map((x) => +x.trim());
          if (v.some((x) => !isFinite(x)) || v.length < 6) throw new ParseError(`${m[1]} needs six numbers.`, line);
          const val = pt.pulse ? Conv.jpulse(v.slice(0, 6)) : Conv.wpr(v.slice(0, 6));
          if (!pt.pulse) val.frame = pt.frame;
          prog.globals[`${job.name}:${m[1].toUpperCase()}`] = val;
        } else if (!/^(BC|EC|P)\d+/i.test(t)) throw new ParseError("Position lines look like C00000=x,y,z,rx,ry,rz", line);
        continue;
      }
      if (!job) { startJob("MAIN", line); section = "inst"; }
      if (section !== "inst") continue;
      stmt(t, line, job, used);
    }
    if (!prog.main) throw new ParseError("No job found. Start with /JOB, //NAME and //INST.", 1);
    for (const v of used) if (!(v in prog.globals)) prog.globals[v] = v[0] === "P" || v.startsWith("LP") ? Pose.identity() : 0;
    for (const j of Object.values(prog.procs)) {
      groupCircles(j.body);
      if (j.tool != null) j.body.unshift({ op: "settool", value: { k: "num", v: j.tool }, line: j.line });
    }
    return prog;
  }

  function groupCircles(body) {
    for (let i = 0; i < body.length; i++) {
      if (!(body[i].op === "move" && body[i].kind === "Cseq")) continue;
      let j = i; while (j < body.length && body[j].op === "move" && body[j].kind === "Cseq") j++;
      const run = body.slice(i, j);
      const outRun = [Object.assign(run[0], { kind: "L" })];
      for (let k = 1; k + 1 < run.length; k += 2) {
        outRun.push({ op: "nop", line: run[k].line });
        outRun.push(Object.assign(run[k + 1], { kind: "C", via: run[k].target }));
      }
      if (run.length % 2 === 0) outRun.push(Object.assign(run[run.length - 1], { kind: "L" }));
      body.splice(i, run.length, ...outRun);
      i += outRun.length - 1;
    }
  }

  function stmt(text, line, job, used) {
    const push = (x) => { x.line = line; job.body.push(x); return x; };
    if (text.startsWith("'")) return push({ op: "nop" });
    if (text.startsWith("*")) return push({ op: "label", name: text.slice(1).trim().toUpperCase() });
    const P = makeP(job.name);
    let toks = lex(text, line);
    toks.forEach((t) => { if (t.t === "id" && isVar(t.u)) used.add(t.u); });
    const head = toks[0].u;
    // trailing "IF cond" on JUMP / CALL / PAUSE / RET
    let cond = null;
    const ifAt = toks.findIndex((t) => t.u === "IF");
    if (ifAt > 0 && ["JUMP", "CALL", "PAUSE", "RET"].includes(head)) { cond = exprOf(P, toks.slice(ifAt + 1), line); toks = toks.slice(0, ifAt); }
    const wrap = (s) => (cond ? push({ op: "if", cond, then: [Object.assign(s, { line })], else: [] }) : push(s));
    const val = (tk) => exprOf(P, tk, line);
    const target = (tok) => {
      if (!tok) throw new ParseError("Move needs a position, e.g. C00001 or P001.", line);
      if (/^C\d{5}$/.test(tok.u)) return { k: "var", name: `${job.name}:${tok.u}` };
      if (/^P\d{3}$/.test(tok.u)) return { k: "var", name: tok.u };
      throw new ParseError(`"${tok.v}" is not a position. Use C00000-style points or P000 variables.`, line);
    };
    const opts = (from) => {
      const o = {};
      for (let k = from; k < toks.length; k++) {
        const t = toks[k];
        if (["VJ", "V", "VR", "PL", "T", "ACC", "DEC"].includes(t.u) && toks[k + 1] && toks[k + 1].v === "=") { o[t.u] = toks[k + 2]; k += 2; continue; }
        if (["BF", "RF", "TF", "NWAIT"].includes(t.u)) { o[t.u] = true; continue; }
        if (t.u === "UF#") { k += 3; o.UF = true; continue; }
        throw new ParseError(`Unexpected "${t.v}" on a move line.`, line);
      }
      return o;
    };
    const numOrVar = (tok) => (tok.t === "num" ? { k: "num", v: tok.v } : { k: "var", name: tok.u });
    switch (head) {
      case "NOP": return push({ op: "nop" });
      case "END": return push({ op: "return" });
      case "RET": return wrap({ op: "return" });
      case "PAUSE": return wrap({ op: "pause" });
      case "MOVJ": case "MOVL": case "MOVC": case "MOVS": {
        const o = opts(2);
        const s = { op: "move", kind: head === "MOVJ" ? "J" : head === "MOVC" ? "Cseq" : "L", target: target(toks[1]) };
        if (head === "MOVJ") s.speed = { pct: o.VJ ? numOrVar(o.VJ) : { k: "num", v: 25 } };
        else s.speed = { mms: o.V ? numOrVar(o.V) : { k: "num", v: 250 } };
        if (head === "MOVJ" && o.V) throw new ParseError("MOVJ uses VJ= (percent). V= is for MOVL/MOVC.", line);
        if (head !== "MOVJ" && o.VJ) throw new ParseError(`${head} uses V= (mm/s). VJ= is for MOVJ.`, line);
        s.blend = { k: "num", v: o.PL ? PL_MM[Math.max(0, Math.min(8, o.PL.v))] : 0 };
        return push(s);
      }
      case "IMOV": {
        const o = opts(2);
        const v = toks[1] && toks[1].u;
        if (!v || !/^P\d{3}$/.test(v)) throw new ParseError("IMOV needs a P variable holding the increment: IMOV P000 V=100 BF", line);
        return push({ op: "move", kind: "L", target: { k: "var", name: v }, rel: o.TF ? "tool" : "base", speed: { mms: o.V ? numOrVar(o.V) : { k: "num", v: 250 } }, blend: { k: "num", v: o.PL ? PL_MM[o.PL.v] || 0 : 0 } });
      }
      case "DOUT": case "PULSE": {
        if (!toks[1] || toks[1].u !== "OT#") throw new ParseError(`${head} needs an output like OT#(1).`, line);
        const port = val(toks.slice(3, 4));
        if (head === "PULSE") return push({ op: "pulse", port });
        return push({ op: "setdo", port, value: val(toks.slice(5)) });
      }
      case "WAIT": {
        const tAt = toks.findIndex((t) => t.u === "T" && toks[toks.indexOf(t) + 1] && toks[toks.indexOf(t) + 1].v === "=");
        return push({ op: "waitcond", cond: val(toks.slice(1, tAt > 0 ? tAt : undefined)) });
      }
      case "TIMER": { const eq = toks.findIndex((t) => t.v === "="); if (eq < 0) throw new ParseError("TIMER T=0.50", line); return push({ op: "wait", sec: val(toks.slice(eq + 1)) }); }
      case "SET": case "ADD": case "SUB": case "MUL": case "DIV": {
        const a = toks[1], rest = toks.slice(2);
        if (!a || !isVar(a.u)) throw new ParseError(`${head} needs a variable first, e.g. ${head} I000 1`, line);
        const rhs = val(rest);
        if (head === "SET") return push({ op: "assign", target: { name: a.u, path: [] }, expr: rhs });
        const op = { ADD: "+", SUB: "-", MUL: "*", DIV: "div" }[head];
        return push({ op: "assign", target: { name: a.u, path: [] }, expr: { k: "bin", op: head === "DIV" && a.u[0] === "R" ? "/" : op, a: { k: "var", name: a.u }, b: rhs } });
      }
      case "INC": case "DEC": {
        const a = toks[1].u;
        return push({ op: "assign", target: { name: a, path: [] }, expr: { k: "bin", op: head === "INC" ? "+" : "-", a: { k: "var", name: a }, b: { k: "num", v: 1 } } });
      }
      case "SETE": case "GETE": {
        // SETE P000 (3) 100000      GETE D000 P000 (3)
        const pv = head === "SETE" ? toks[1].u : toks[2].u;
        const nAt = toks.findIndex((t) => t.v === "(");
        const n = toks[nAt + 1].v;
        const f = "xyzwpr"[n - 1];
        if (!f) throw new ParseError("Element number must be 1-6.", line);
        const scale = n <= 3 ? 1000 : 10000; // INFORM units: micrometres and 0.0001 degree
        if (head === "SETE") return push({ op: "assign", target: { name: pv, path: [f] }, expr: { k: "bin", op: "/", a: val(toks.slice(nAt + 3)), b: { k: "num", v: scale } } });
        return push({ op: "assign", target: { name: toks[1].u, path: [] }, expr: { k: "call", name: "round", args: [{ k: "bin", op: "*", a: { k: "field", base: { k: "var", name: pv }, name: f }, b: { k: "num", v: scale } }] } });
      }
      case "JUMP": {
        const l = toks[1];
        if (l && l.v === "*") return wrap({ op: "jump", name: toks[2].u, cond: null });
        throw new ParseError("JUMP *LABEL [IF condition]", line);
      }
      case "CALL": {
        if (!toks[1] || toks[1].u !== "JOB" || !toks[2] || toks[2].v !== ":") throw new ParseError("CALL JOB:NAME", line);
        return wrap({ op: "call", name: toks[3].u });
      }
      case "SFTON": {
        const v = toks[1] && toks[1].u;
        if (!v || !/^P\d{3}$/.test(v)) throw new ParseError("SFTON needs a P variable: SFTON P000", line);
        return push({ op: "shift", value: { k: "var", name: v }, mode: toks.some((t) => t.u === "TF") ? "tool" : "base" });
      }
      case "SFTOF": return push({ op: "shift", value: null });
      case "CNVRT": case "CLEAR": case "MSG": return push({ op: "nop" });
    }
    throw new ParseError(`Unknown INFORM instruction "${toks[0].v}".`, line);
  }
  const exprOf = (P, toks, line) => { const ts = new Toks(toks, line); const e = P(ts); ts.done(); return e; };

  // ---------- generator ----------
  function gen(r) {
    const out = [];
    const varNames = [...Object.keys(r.vars || {})];
    const scanVars = (ops) => ops.forEach((op) => { if (op[0] === "for" && !varNames.includes(op[1])) varNames.push(op[1]); [op[2], op[3], op[4]].forEach((x) => Array.isArray(x) && x.length && Array.isArray(x[0]) && scanVars(x)); });
    scanVars(r.main); Object.values(r.subs || {}).forEach(scanVars);
    const I = (v) => `I${String(varNames.indexOf(v)).padStart(3, "0")}`;
    const pv = (n) => `P${String(n).padStart(3, "0")}`;
    const consts = [];
    const offVar = (off) => {
      if (off.d.every((x) => typeof x === "number")) {
        const key = off.mode + off.d.join(",");
        let c = consts.find((x) => x.key === key);
        if (!c) { c = { key, n: consts.length, off }; consts.push(c); }
        return { name: pv(c.n), setup: [] };
      }
      const n = 10;
      const setup = [`SUB ${pv(n)} ${pv(n)}`];
      off.d.forEach((v, i) => {
        if (typeof v === "number") { if (v) setup.push(`SETE ${pv(n)} (${i + 1}) ${Math.round(v * 1000)}`); }
        else setup.push(`SET D000 ${I(v.v)}`, "SUB D000 1", `MUL D000 ${Math.round(v.k * 1000)}`, `SETE ${pv(n)} (${i + 1}) D000`);
      });
      return { name: pv(n), setup };
    };
    const scanOff = (ops) => ops.forEach((op) => { if (["j", "jo", "l"].includes(op[0]) && op[4]) offVar(op[4]); [op[2], op[3], op[4]].forEach((x) => Array.isArray(x) && x.length && Array.isArray(x[0]) && scanOff(x)); });
    [r.main, ...Object.values(r.subs || {})].forEach(scanOff);
    const plOf = (b) => { if (!b) return ""; let best = 0; PL_MM.forEach((v, i) => { if (Math.abs(v - b) < Math.abs(PL_MM[best] - b)) best = i; }); return ` PL=${best}`; };

    const genJob = (name, ops, isMain) => {
      const pts = [];
      const cref = (n) => { let i = pts.indexOf(n); if (i < 0) { pts.push(n); i = pts.length - 1; } return i; };
      const inst = [];
      let lbl = 0;
      const L = (s) => inst.push(s);
      if (isMain) {
        L(`'${r.title}`);
        for (const c of consts) {
          L(`SUB ${pv(c.n)} ${pv(c.n)}`);
          c.off.d.forEach((v, i) => { if (v) L(`SETE ${pv(c.n)} (${i + 1}) ${Math.round(v * 1000)}`); });
        }
      }
      const neg = (c) => {
        if (c[0] === "di") return `IN#(${c[1]})=${c[2] ? "OFF" : "ON"}`;
        const inv = { "<": ">=", ">=": "<", ">": "<=", "<=": ">", "==": "<>", "!=": "=" };
        return `${I(c[0])}${inv[c[1]]}${c[2]}`;
      };
      const posLabel = (n) => { const i = cref(n); return `C${String(i).padStart(5, "0")}`; };
      const moveWith = (op, kind) => {
        const off = op[4] ? offVar(op[4]) : null;
        if (off) { off.setup.forEach(L); L(`SFTON ${off.name}${op[4].mode === "tool" ? " TF" : ""}`); }
        last = off ? null : op[1];
        if (kind === "J") L(`MOVJ ${posLabel(op[1])} VJ=${op[2].toFixed(2)}${plOf(op[3])}`);
        else L(`MOVL ${posLabel(op[1])} V=${op[2].toFixed(1)}${plOf(op[3])}`);
        if (off) L("SFTOF");
      };
      let last = null, prevOp = null;
      const body = (ops) => {
        for (const op of ops) {
          const was = prevOp; prevOp = op[0] === "c" ? was : op[0];
          if (op[0] !== "circ" && op[0] !== "c") prevOp = op[0];
          switch (op[0]) {
            case "c": L(`'${op[1]}`); break;
            case "msg": L(`'${op[1]}`); break;
            case "tool": case "frame": break;
            case "j": case "jo": moveWith(op, "J"); break;
            case "l": moveWith(op, "L"); break;
            case "lrel": {
              L(`SUB P011 P011`);
              op[1].forEach((v, i) => { if (v) L(`SETE P011 (${i + 1}) ${Math.round(v * 1000)}`); });
              L(`IMOV P011 V=${op[3].toFixed(1)} ${op[2] === "tool" ? "TF" : "BF"}`); break;
            }
            case "circ":
              if (was !== "circ") { if (!last) throw new Error("A circle must start from a taught point."); L(`MOVC ${posLabel(last)} V=${op[3].toFixed(1)}`); }
              last = op[2];
              L(`MOVC ${posLabel(op[1])} V=${op[3].toFixed(1)}`); L(`MOVC ${posLabel(op[2])} V=${op[3].toFixed(1)}${plOf(op[4])}`); break;
            case "grip": L(`DOUT OT#(1) ${op[1] ? "ON" : "OFF"}`); break;
            case "setdo": L(`DOUT OT#(${op[1]}) ${op[2] ? "ON" : "OFF"}`); break;
            case "wait": L(`TIMER T=${op[1].toFixed(2)}`); break;
            case "waitdi": L(`WAIT IN#(${op[1]})=${op[2] ? "ON" : "OFF"}`); break;
            case "set": L(`SET ${I(op[1])} ${op[2]}`); break;
            case "inc": L(`INC ${I(op[1])}`); break;
            case "for": { const a = `L${lbl++}`; L(`SET ${I(op[1])} ${op[2]}`); L(`*${a}`); body(op[4]); L(`INC ${I(op[1])}`); L(`JUMP *${a} IF ${I(op[1])}<=${op[3]}`); break; }
            case "while": { const a = `W${lbl}`, b = `WE${lbl++}`; L(`*${a}`); L(`JUMP *${b} IF ${neg(op[1])}`); body(op[2]); L(`JUMP *${a}`); L(`*${b}`); break; }
            case "if": {
              const e = `ELSE${lbl}`, f = `ENDIF${lbl++}`;
              L(`JUMP *${e} IF ${neg(op[1])}`); body(op[2]); L(`JUMP *${f}`); L(`*${e}`); body(op[3] || []); L(`*${f}`); break;
            }
            case "call": L(`CALL JOB:${op[1].toUpperCase()}`); break;
          }
        }
      };
      body(ops);
      // a circle needs the robot to arrive at the first MOVC point: the recipes always place a MOVL to it first
      const world = pts.filter((n) => r.points[n] && !r.points[n].frame), user = pts.filter((n) => r.points[n] && r.points[n].frame), joint = pts.filter((n) => r.joints && r.joints[n]);
      out.push("/JOB", `//NAME ${name.toUpperCase()}`, "//POS", `///NPOS ${pts.length},0,0,${isMain ? consts.length : 0},0,0`, "///TOOL 1");
      const line = (n) => {
        const i = pts.indexOf(n), c = `C${String(i).padStart(5, "0")}`;
        if (r.joints && r.joints[n]) return `${c}=${r.joints[n].map((v) => Math.round(v * YAS_PULSE_PER_DEG)).join(",")}`;
        const p = r.points[n], o = p.o || [180, 0, 0];
        return `${c}=${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)},${o[0].toFixed(2)},${o[1].toFixed(2)},${o[2].toFixed(2)}`;
      };
      if (joint.length) { out.push("///POSTYPE PULSE", "///PULSE"); joint.forEach((n) => out.push(line(n))); }
      if (world.length) { out.push("///POSTYPE ROBOT", "///RECTAN", "///RCONF 0,0,0,0,0,0,0,0"); world.forEach((n) => out.push(line(n))); }
      if (user.length) { out.push("///USER 1", "///POSTYPE USER", "///RECTAN", "///RCONF 0,0,0,0,0,0,0,0"); user.forEach((n) => out.push(line(n))); }
      out.push("//INST", "///DATE 2026/10/16 09:00", "///ATTR SC,RW", "///GROUP1 RB1", "NOP", ...inst, "END", "");
    };
    genJob(r.name, r.main, true);
    for (const [n, ops] of Object.entries(r.subs || {})) genJob(n, ops, false);
    return out.join("\n");
  }

  LANGS.yaskawa = {
    id: "yaskawa", brand: "Yaskawa", lang: "INFORM", file: "PICK_PLACE.JBI",
    robot: { body: "#2f6db3", trim: "#e9edf2", label: "Motoman-style 6-axis arm" },
    jointNames: ["S", "L", "U", "R", "B", "T"],
    jointValues: (q) => q,
    outName: (n) => `OT#(${n})`, inName: (n) => `IN#(${n})`,
    poseFields(P) { const e = Rot.toFixedXYZ(P.R); return [["X", fmt(P.p[0], 3)], ["Y", fmt(P.p[1], 3)], ["Z", fmt(P.p[2], 3)], ["Rx", fmt(e[0], 2)], ["Ry", fmt(e[1], 2)], ["Rz", fmt(e[2], 2)]]; },
    teach(name, P) { const e = Rot.toFixedXYZ(P.R); return `C00009=${fmt(P.p[0], 3)},${fmt(P.p[1], 3)},${fmt(P.p[2], 3)},${fmt(e[0], 2)},${fmt(e[1], 2)},${fmt(e[2], 2)}   '${name}`; },
    parse, gen,
    syntax: {
      comment: /'.*$/,
      keywords: /\b(NOP|END|RET|JUMP|IF|CALL|JOB|PAUSE|SET|ADD|SUB|MUL|DIV|INC|DEC|SETE|GETE|TIMER|WAIT|SFTON|SFTOF|ON|OFF)\b|^\/+\w+/gm,
      motion: /\b(MOVJ|MOVL|MOVC|MOVS|IMOV|VJ|V|PL)\b/g,
      builtins: /\b([IBDRP]\d{3}|C\d{5})\b/g,
      io: /\b(OT#|IN#)\(\d+\)|\bDOUT\b/g,
    },
  };
})();
