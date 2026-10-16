"use strict";
// Universal Robots URScript: def/end, while/if/elif/else, movej/movel/movec, p[x,y,z,rx,ry,rz] in metres and radians
(function () {
  const P = makeExprParser({
    binops: { "+": "+", "-": "-", "*": "*", "/": "/", "%": "mod", "==": "==", "!=": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">=", and: "and", or: "or", AND: "and", OR: "or" },
    unops: { not: "not", NOT: "not", "-": "neg" },
    primary(ts, parse) {
      const t = ts.peek();
      if (t && t.t === "id" && t.v === "p" && ts.is("[", 1)) { // pose literal
        ts.next(); ts.next();
        const items = [];
        do { items.push(parse(ts)); } while (ts.accept(","));
        ts.expect("]");
        if (items.length !== 6) throw new ParseError("A pose needs 6 values: p[x, y, z, rx, ry, rz] (metres, radians).", ts.line);
        return { k: "posebuild", conv: "ur", items };
      }
      return undefined;
    },
    ident(t) {
      if (t.v === "True" || t.v === "False") return { k: "bool", v: t.v === "True" };
      if (t.v === "pi") return { k: "num", v: Math.PI };
      return { k: "var", name: t.v };
    },
    func(t, args, ts, named) {
      const map = {
        pose_trans: "pose_trans", pose_add: "pose_add", pose_inv: "pose_inv", get_actual_tcp_pose: "cur", get_target_tcp_pose: "cur",
        get_actual_joint_positions: "curj", get_target_joint_positions: "curj", sin: "sin", cos: "cos", tan: "tan", atan2: "atan2", sqrt: "sqrt",
        norm: "norm", floor: "floor", round: "round", d2r: "d2r", r2d: "r2d", to_str: "str", str_cat: "strcat", pose_dist: "dist",
      };
      if (t.v === "get_digital_in" || t.v === "get_standard_digital_in") return { k: "call", name: "di", args: [{ k: "bin", op: "+", a: args[0], b: { k: "num", v: 1 } }] };
      if (t.v === "get_digital_out" || t.v === "get_standard_digital_out") return { k: "call", name: "do", args: [{ k: "bin", op: "+", a: args[0], b: { k: "num", v: 1 } }] };
      if (t.v === "get_inverse_kin") return args[0];
      if (t.v === "abs") return { k: "call", name: "abs", args };
      if (t.v === "str_cat") return { k: "bin", op: "+", a: { k: "call", name: "str", args: [args[0]] }, b: { k: "call", name: "str", args: [args[1]] } };
      if (t.v === "pose_dist") return { k: "bin", op: "/", a: { k: "call", name: "dist", args }, b: { k: "num", v: 1000 } };
      if (t.v in map) return { k: "call", name: map[t.v], args };
      return { k: "callproc", name: t.v, args, named };
    },
    index: true,
  });
  const exprOf = (toks, line) => { const ts = new Toks(toks, line); const e = P(ts); ts.done(); return e; };
  const noProc = (e, line) => { if (e.k === "callproc") throw new ParseError(`${e.name}() does not return a value here.`, line); return e; };

  function stripComment(s) {
    let q = false;
    for (let i = 0; i < s.length; i++) { if (s[i] === '"') q = !q; else if (s[i] === "#" && !q) return s.slice(0, i); }
    return s;
  }

  function parse(src) {
    const lines = src.split(/\r?\n/);
    const prog = { procs: {}, main: null, globals: {}, norm: (s) => s };
    const top = { name: "__top__", body: [], line: 1 };
    const B = new Blocks(top.body);
    const defStack = [];
    const procParams = {};
    for (let i = 0; i < lines.length; i++) {
      const line = i + 1;
      const text = stripComment(lines[i]).trim();
      if (!text) continue;
      const toks = lex(text, line);
      const head = toks[0].v;
      const push = (x) => { x.line = line; B.list.push(x); return x; };
      if (head === "def") {
        const name = toks[1] && toks[1].v;
        if (!name || !toks[2] || toks[2].v !== "(" || toks[toks.length - 1].v !== ":") throw new ParseError("Function syntax: def name():", line);
        const params = toks.slice(3, toks.length - 2).filter((t) => t.t === "id").map((t) => t.v);
        const proc = { name, body: [], line, params };
        if (prog.procs[name]) throw new ParseError(`Function ${name} is defined twice.`, line);
        prog.procs[name] = proc; procParams[name] = params;
        defStack.push({ proc, outer: B.stack.slice() });
        B.stack = [{ kind: "def", list: proc.body, line }];
        continue;
      }
      if (head === "thread" || head === "run" || head === "kill") throw new ParseError("Threads are not supported in the simulator.", line);
      if (head === "end" && toks.length === 1) {
        const t = B.top;
        if (t.kind === "def") { const d = defStack.pop(); d.proc.endLine = line; B.stack = d.outer; continue; }
        if (t.kind === "root") throw new ParseError("end without a matching def, while or if.", line);
        B.stack.pop(); continue;
      }
      if (head === "while" || head === "if" || head === "elif") {
        if (toks[toks.length - 1].v !== ":") throw new ParseError(`${head} line must end with ':'`, line);
        const cond = noProc(exprOf(toks.slice(1, -1), line), line);
        if (head === "while") { const n = push({ op: "while", cond, body: [] }); B.push("while", n, n.body, line); continue; }
        if (head === "if") { const n = push({ op: "if", cond, then: [], else: [] }); B.push("if", n, n.then, line); continue; }
        const t = B.top; if (t.kind !== "if") throw new ParseError("elif without if.", line);
        const n = { op: "if", cond, then: [], else: [], line }; t.node.else = [n]; t.node = n; t.list = n.then; continue;
      }
      if (head === "else") { const t = B.top; if (t.kind !== "if") throw new ParseError("else without if.", line); t.list = t.node.else; continue; }
      if (head === "for") throw new ParseError("URScript has no for loop. Use a counter with while.", line);
      if (head === "break") { push({ op: "exit" }); continue; }
      if (head === "return") { push({ op: "return" }); continue; }
      if (head === "halt") { push({ op: "halt" }); continue; }
      // assignment
      let k = 0;
      if (head === "global" || head === "local") k = 1;
      const eq = toks.findIndex((t) => t.v === "=");
      if (eq > k && !toks.slice(k, eq).some((t) => t.v === "(")) {
        const lhs = toks.slice(k, eq);
        const name = lhs[0].v;
        const target = { name, path: [] };
        if (lhs.length === 4 && lhs[1].v === "[" && lhs[3].v === "]" && lhs[2].t === "num") target.path = ["u" + lhs[2].v];
        else if (lhs.length !== 1) throw new ParseError("Assignment needs a simple name on the left.", line);
        if (target.path.length) target.path = [lhs[2].v]; // list element
        push({ op: "assign", target, expr: noProc(exprOf(toks.slice(eq + 1), line), line), uridx: target.path.length ? lhs[2].v : undefined });
        continue;
      }
      // function-call statement
      const e = exprOf(toks, line);
      if (e.k !== "callproc") throw new ParseError("Statement does nothing. Did you mean to call a function?", line);
      callStmt(e, line, push, procParams);
    }
    if (defStack.length) throw new ParseError(`def ${defStack[defStack.length - 1].proc.name} is missing end.`, defStack[defStack.length - 1].proc.line);
    B.close(lines.length);
    if (top.body.length) { prog.procs.__top__ = top; prog.main = "__top__"; }
    else {
      const first = Object.keys(prog.procs)[0];
      if (!first) throw new ParseError("No program found. Wrap your code in def main(): ... end", 1);
      prog.main = first;
    }
    return prog;
  }

  function callStmt(e, line, push, procParams) {
    const a = e.args, n = e.named || {};
    const arg = (i, name) => (n[name] !== undefined ? n[name] : a[i]);
    switch (e.name) {
      case "movej": case "movel": case "movep": {
        const s = { op: "move", kind: e.name === "movej" ? "J" : "L", target: { k: "call", name: "urq", args: [a[0]] } };
        const v = arg(2, "v"), r = arg(4, "r");
        if (s.kind === "J") s.speed = { pct: v ? { k: "bin", op: "*", a: v, b: { k: "num", v: 100 / Math.PI } } : { k: "num", v: 1.05 * 100 / Math.PI } };
        else s.speed = { mms: v ? { k: "bin", op: "*", a: v, b: { k: "num", v: 1000 } } : { k: "num", v: 250 } };
        s.blend = r ? { k: "bin", op: "*", a: r, b: { k: "num", v: 1000 } } : { k: "num", v: 0 };
        if (!a[0]) throw new ParseError(`${e.name} needs a target.`, line);
        return push(s);
      }
      case "movec": {
        if (a.length < 2) throw new ParseError("movec(pose_via, pose_to, a, v, r) needs a via and an end pose.", line);
        const v = arg(3, "v"), r = arg(4, "r");
        return push({ op: "move", kind: "C", via: a[0], target: a[1], speed: { mms: v ? { k: "bin", op: "*", a: v, b: { k: "num", v: 1000 } } : { k: "num", v: 250 } }, blend: r ? { k: "bin", op: "*", a: r, b: { k: "num", v: 1000 } } : { k: "num", v: 0 } });
      }
      case "set_digital_out": case "set_standard_digital_out":
        return push({ op: "setdo", port: { k: "bin", op: "+", a: a[0], b: { k: "num", v: 1 } }, value: a[1] });
      case "sleep": return push({ op: "wait", sec: a[0] });
      case "sync": return push({ op: "wait", sec: { k: "num", v: 0.008 } });
      case "textmsg": case "popup": return push({ op: "msg", expr: a.length > 1 && e.name === "textmsg" ? { k: "bin", op: "+", a: { k: "call", name: "str", args: [a[0]] }, b: { k: "call", name: "str", args: [a[1]] } } : a[0] });
      case "set_tcp": return push({ op: "settool", value: a[0] });
      case "stopj": case "stopl": return push({ op: "nop" });
    }
    return push({ op: "call", name: e.name, args: a, params: procParams[e.name] || [] });
  }

  // ---------- generator ----------
  const m = (v) => +(v / 1000).toFixed(4);
  const rv = (o) => Rot.toRotVec(Rot.fromFixedXYZ(o[0], o[1], o[2])).map((v) => +v.toFixed(4));
  function gen(r) {
    const L = [];
    const I = (n) => "  ".repeat(n);
    L.push(`def ${r.name.toLowerCase()}():`);
    L.push(`${I(1)}# ${r.title}`);
    L.push(`${I(1)}set_tcp(p[0, 0, 0.16, 0, 0, 0])  # gripper fingertips 160 mm from the flange`);
    const usesPallet = Object.values(r.points).some((p) => p.frame === 1);
    if (usesPallet) L.push(`${I(1)}pallet = p[0.4, 0.25, 0.4, 0, 0, 0]  # pallet corner, as a feature/plane`);
    for (const [n, p] of Object.entries(r.points)) {
      const lit = `p[${m(p.x)}, ${m(p.y)}, ${m(p.z)}, ${rv(p.o || [180, 0, 0]).join(", ")}]`;
      L.push(`${I(1)}${n} = ${p.frame === 1 ? `pose_trans(pallet, ${lit})` : lit}`);
    }
    for (const [n, j] of Object.entries(r.joints || {})) L.push(`${I(1)}${n} = [${j.map((v) => +(v * DEG).toFixed(4)).join(", ")}]`);
    for (const [n, v] of Object.entries(r.vars || {})) L.push(`${I(1)}${n} = ${v}`);
    const target = (pt, off) => {
      if (!off) return pt;
      const d = off.d.map((v) => (typeof v === "number" ? String(m(v)) : `(${v.v}-1)*${m(v.k)}`));
      const lit = `p[${d.join(", ")}, 0, 0, 0]`;
      if (off.mode === "tool") return `pose_trans(${pt}, ${lit})`;
      if (r.points[pt] && r.points[pt].frame === 1) return `pose_trans(pallet, pose_add(pose_trans(pose_inv(pallet), ${pt}), ${lit}))`;
      return `pose_add(${pt}, ${lit})`;
    };
    const cond = (c) => (c[0] === "di" ? `get_digital_in(${c[1] - 1}) == ${c[2] ? "True" : "False"}` : `${c[0]} ${c[1]} ${c[2]}`);
    const rr = (b) => (b ? `, r=${m(b)}` : "");
    const body = (ops, ind) => {
      for (const op of ops) {
        switch (op[0]) {
          case "c": L.push(`${I(ind)}# ${op[1]}`); break;
          case "tool": L.push(`${I(ind)}set_tcp(p[0, 0, ${op[1] ? 0.16 : 0}, 0, 0, 0])`); break;
          case "frame": break;
          case "j": case "jo": L.push(`${I(ind)}movej(${target(op[1], op[4])}, a=1.4, v=${+(op[2] / 100 * Math.PI).toFixed(2)}${rr(op[3])})`); break;
          case "l": L.push(`${I(ind)}movel(${target(op[1], op[4])}, a=1.2, v=${m(op[2])}${rr(op[3])})`); break;
          case "lrel": { const d = `p[${op[1].map(m).join(", ")}, 0, 0, 0]`; L.push(`${I(ind)}movel(${op[2] === "tool" ? `pose_trans(get_actual_tcp_pose(), ${d})` : `pose_add(get_actual_tcp_pose(), ${d})`}, a=1.2, v=${m(op[3])})`); break; }
          case "circ": L.push(`${I(ind)}movec(${op[1]}, ${op[2]}, a=1.2, v=${m(op[3])}${rr(op[4])})`); break;
          case "grip": L.push(`${I(ind)}set_digital_out(0, ${op[1] ? "True" : "False"})`); break;
          case "setdo": L.push(`${I(ind)}set_digital_out(${op[1] - 1}, ${op[2] ? "True" : "False"})`); break;
          case "wait": L.push(`${I(ind)}sleep(${op[1]})`); break;
          case "waitdi": L.push(`${I(ind)}while get_digital_in(${op[1] - 1}) != ${op[2] ? "True" : "False"}:`, `${I(ind + 1)}sync()`, `${I(ind)}end`); break;
          case "set": L.push(`${I(ind)}${op[1]} = ${op[2]}`); break;
          case "inc": L.push(`${I(ind)}${op[1]} = ${op[1]} + 1`); break;
          case "for": L.push(`${I(ind)}${op[1]} = ${op[2]}`, `${I(ind)}while ${op[1]} <= ${op[3]}:`); body(op[4], ind + 1); L.push(`${I(ind + 1)}${op[1]} = ${op[1]} + 1`, `${I(ind)}end`); break;
          case "while": L.push(`${I(ind)}while ${cond(op[1])}:`); body(op[2], ind + 1); L.push(`${I(ind)}end`); break;
          case "if": L.push(`${I(ind)}if ${cond(op[1])}:`); body(op[2], ind + 1); if (op[3] && op[3].length) { L.push(`${I(ind)}else:`); body(op[3], ind + 1); } L.push(`${I(ind)}end`); break;
          case "call": L.push(`${I(ind)}${op[1].toLowerCase()}()`); break;
          case "msg": L.push(`${I(ind)}textmsg("${op[1]}"${op[2] ? `, ${op[2]}` : ""})`); break;
        }
      }
    };
    for (const [n, ops] of Object.entries(r.subs || {})) { L.push("", `${I(1)}def ${n.toLowerCase()}():`); body(ops, 2); L.push(`${I(1)}end`); }
    L.push("", `${I(1)}# --- main program ---`);
    body(r.main, 1);
    L.push("end", "");
    return L.join("\n");
  }

  LANGS.ur = {
    id: "ur", brand: "Universal Robots", lang: "URScript", file: "pick_place.script",
    robot: { body: "#cfd6dc", trim: "#2f7fc1", label: "UR-style collaborative arm" },
    jointNames: ["Base", "Shoulder", "Elbow", "Wrist 1", "Wrist 2", "Wrist 3"],
    jointValues: (q) => q,
    outName: (n) => `DO ${n - 1}`, inName: (n) => `DI ${n - 1}`,
    poseFields(P) { const r = Rot.toRotVec(P.R); return [["X", fmt(P.p[0] / 1000, 4) + " m"], ["Y", fmt(P.p[1] / 1000, 4) + " m"], ["Z", fmt(P.p[2] / 1000, 4) + " m"], ["RX", fmt(r[0], 4)], ["RY", fmt(r[1], 4)], ["RZ", fmt(r[2], 4)]]; },
    teach(name, P) { const r = Rot.toRotVec(P.R); return `  ${name} = p[${fmt(P.p[0] / 1000, 4)}, ${fmt(P.p[1] / 1000, 4)}, ${fmt(P.p[2] / 1000, 4)}, ${fmt(r[0], 4)}, ${fmt(r[1], 4)}, ${fmt(r[2], 4)}]`; },
    parse, gen,
    syntax: {
      comment: /#.*$/,
      keywords: /\b(def|end|while|if|elif|else|return|break|global|local|and|or|not|True|False|pi)\b/g,
      motion: /\b(movej|movel|movep|movec)\b/g,
      builtins: /\b(pose_trans|pose_add|pose_inv|get_actual_tcp_pose|get_actual_joint_positions|set_tcp|sleep|sync|textmsg|popup|halt|d2r|r2d|p(?=\[))\b/g,
      io: /\b(set_digital_out|get_digital_in|set_standard_digital_out|get_standard_digital_in)\b/g,
    },
  };
})();
