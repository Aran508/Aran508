"use strict";
// ABB RAPID: MODULE / PROC, robtarget data, MoveJ/MoveL/MoveC/MoveAbsJ, SetDO, WaitDI ...
(function () {
  const SIG_OUT = { DOGRIPPER: 1, DOLAMP: 2, DO3: 3, DO4: 4 };
  const SIG_IN = { DIPARTREADY: 1, DISTART: 2, DIREJECT: 3, DI4: 4 };
  const OUT_NAMES = ["", "doGripper", "doLamp", "do3", "do4"];
  const IN_NAMES = ["", "diPartReady", "diStart", "diReject", "di4"];
  const SPEEDS = [5, 10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000];
  const ZONES = [0, 1, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200];
  const nearest = (arr, v) => arr.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const sigNum = (map, name, line, kind) => {
    const u = name.toUpperCase();
    if (u in map) return map[u];
    const m = u.match(/^D[IO](\d+)$/);
    if (m) return +m[1];
    throw new ParseError(`Unknown ${kind} signal "${name}". Use ${kind === "output" ? "doGripper, doLamp, do3, do4" : "diPartReady, diStart, diReject, di4"}.`, line);
  };

  const exprCfg = {
    binops: { "+": "+", "-": "-", "*": "*", "/": "/", DIV: "div", MOD: "mod", "=": "==", "<>": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">=", AND: "and", OR: "or", XOR: "xor" },
    unops: { NOT: "not", "-": "neg" },
    ident(t) {
      const u = t.u;
      if (u === "TRUE" || u === "FALSE") return { k: "bool", v: u === "TRUE" };
      if (u === "FINE") return { k: "num", v: 0 };
      if (u === "VMAX") return { k: "num", v: 7000 };
      let m = u.match(/^V(\d+)$/); if (m) return { k: "num", v: +m[1] };
      m = u.match(/^Z(\d+)$/); if (m) return { k: "num", v: +m[1] };
      if (u === "TOOL0" || u === "WOBJ0") return { k: "num", v: 0 };
      if (u in SIG_IN || /^DI\d+$/.test(u)) return { k: "call", name: "di", args: [{ k: "num", v: sigNum(SIG_IN, u, t.line, "input") }] };
      if (u in SIG_OUT || /^DO\d+$/.test(u)) return { k: "call", name: "do", args: [{ k: "num", v: sigNum(SIG_OUT, u, t.line, "output") }] };
      return { k: "var", name: u };
    },
    func(t, args) {
      const map = { OFFS: "offs", RELTOOL: "reltool", CROBT: "cur", CJOINTT: "curj", ABS: "abs", SQRT: "sqrt", SIN: "sind", COS: "cosd", TAN: "tan", ATAN2: "atan2d", ROUND: "round", TRUNC: "trunc", DIST: "dist", NUMTOSTR: "str" };
      if (t.u === "DINPUT") return { k: "call", name: "di", args: [{ k: "num", v: sigNum(SIG_IN, unwrapSig(args[0], t.line), t.line, "input") }] };
      if (t.u === "DOUTPUT") return { k: "call", name: "do", args: [{ k: "num", v: sigNum(SIG_OUT, unwrapSig(args[0], t.line), t.line, "output") }] };
      if (!(t.u in map)) throw new ParseError(`Unknown function ${t.v}().`, t.line);
      return { k: "call", name: map[t.u], args: t.u === "NUMTOSTR" ? args.slice(0, 1) : args };
    },
    field(base, t) {
      const u = t.u;
      if (u === "TRANS" || u === "ROBAX") return { k: "pass", base };
      const b = base.k === "pass" ? base.base : base;
      if (u === "X" || u === "Y" || u === "Z") return { k: "field", base: b, name: u.toLowerCase() };
      const m = u.match(/^RAX_([1-6])$/); if (m) return { k: "field", base: b, name: "j" + (m[1] - 1) };
      throw new ParseError(`Field .${t.v} is not supported here.`, t.line);
    },
  };
  function unwrapSig(e, line) {
    if (e && e.k === "call" && (e.name === "di" || e.name === "do")) return (e.name === "di" ? IN_NAMES : OUT_NAMES)[e.args[0].v];
    throw new ParseError("Expected a signal name.", line);
  }
  const P = makeExprParser(exprCfg);
  const expr = (toks, line) => { const ts = new Toks(toks, line); const e = P(ts); ts.done(); return fixPass(e, line); };
  const fixPass = (e, line) => { if (e && e.k === "pass") throw new ParseError("Incomplete field access.", line); return e; };

  // constant evaluation for data declarations
  function constVal(e, line) {
    if (e.k === "num" || e.k === "bool" || e.k === "str") return e.v;
    if (e.k === "list") return e.items.map((x) => constVal(x, line));
    throw new ParseError("Data declarations need constant values.", line);
  }
  function dataValue(type, e, line) {
    const T = type.toUpperCase();
    if (T === "ROBTARGET") {
      const v = constVal(e, line);
      if (!Array.isArray(v) || !Array.isArray(v[0]) || v[0].length !== 3 || !Array.isArray(v[1]) || v[1].length !== 4) throw new ParseError("robtarget needs [[x,y,z],[q1,q2,q3,q4],[cf1,cf4,cf6,cfx],[external axes]].", line);
      return Conv.abb([...v[0], ...v[1]]);
    }
    if (T === "JOINTTARGET") {
      const v = constVal(e, line);
      if (!Array.isArray(v) || !Array.isArray(v[0]) || v[0].length !== 6) throw new ParseError("jointtarget needs [[j1,j2,j3,j4,j5,j6],[external axes]].", line);
      return Conv.jdeg(v[0]);
    }
    if (T === "TOOLDATA") {
      const v = constVal(e, line);
      if (!Array.isArray(v) || !Array.isArray(v[1])) throw new ParseError("tooldata needs [robhold,[[x,y,z],[q1,q2,q3,q4]],loaddata].", line);
      return Conv.abb([...v[1][0], ...v[1][1]]);
    }
    if (T === "WOBJDATA") {
      const v = constVal(e, line);
      if (!Array.isArray(v) || !Array.isArray(v[3])) throw new ParseError("wobjdata needs [robhold,ufprog,ufmec,uframe,oframe].", line);
      const uf = Conv.abb([...v[3][0], ...v[3][1]]), of = v[4] ? Conv.abb([...v[4][0], ...v[4][1]]) : Pose.identity();
      return Pose.mul(uf, of);
    }
    if (T === "SPEEDDATA") { const v = constVal(e, line); return Array.isArray(v) ? v[0] : v; }
    if (T === "ZONEDATA") { const v = constVal(e, line); return Array.isArray(v) ? (v[0] ? 0 : v[1]) : v; }
    return null; // evaluate at run time
  }
  const ZERO = { NUM: 0, DNUM: 0, BOOL: false, STRING: "", ROBTARGET: null, JOINTTARGET: null };

  function parse(src) {
    const lines = src.split(/\r?\n/);
    const prog = { procs: {}, main: "MAIN", globals: {}, norm: (s) => s.toUpperCase() };
    const init = [];
    let proc = null, blocks = null;
    let i = 0;
    while (i < lines.length) {
      const lineNo = i + 1;
      let text = stripComment(lines[i]).trim();
      i++;
      if (!text) continue;
      // join continuation lines for statements that must end with ';'
      while (!/;\s*$/.test(text) && !/^(MODULE|ENDMODULE|PROC|ENDPROC|IF|ELSEIF|ELSE|ENDIF|FOR|ENDFOR|WHILE|ENDWHILE|TEST|ENDTEST|[A-Za-z_]\w*\s*:(?!=))/i.test(text) && i < lines.length) {
        text += " " + stripComment(lines[i]).trim(); i++;
      }
      const toks = lex(text.replace(/;\s*$/, "").replace(/CRobT\s*\([^)]*\)/gi, "CRobT()").replace(/CJointT\s*\([^)]*\)/gi, "CJointT()"), lineNo);
      if (!toks.length) continue;
      const head = toks[0].u;
      if (head === "MODULE" || head === "ENDMODULE") continue;
      if (head === "PROC") {
        if (proc) throw new ParseError(`PROC ${proc.name} is missing ENDPROC.`, lineNo);
        const name = toks[1] ? toks[1].u : "";
        if (!name) throw new ParseError("PROC needs a name.", lineNo);
        proc = { name, body: [], line: lineNo };
        prog.procs[name] = proc; blocks = new Blocks(proc.body);
        continue;
      }
      if (head === "ENDPROC") {
        if (!proc) throw new ParseError("ENDPROC without PROC.", lineNo);
        blocks.close(lineNo); proc.endLine = lineNo; proc = null; continue;
      }
      // data declarations
      const declAt = toks.findIndex((t) => ["CONST", "VAR", "PERS"].includes(t.u));
      if (declAt >= 0 && declAt <= 2 && toks.slice(0, declAt).every((t) => ["LOCAL", "TASK"].includes(t.u))) {
        const ts = new Toks(toks.slice(declAt + 1), lineNo);
        const type = ts.id("a data type").u, name = ts.id("a data name").u;
        let value;
        if (ts.accept(":=")) {
          const e = P(ts); ts.done();
          value = dataValue(type, e, lineNo);
          if (value === null) { value = undefined; init.push({ op: "assign", target: { name, path: [] }, expr: e, line: lineNo }); }
        } else value = ZERO[type] !== undefined ? ZERO[type] : 0;
        if (value !== undefined) prog.globals[name] = value;
        else if (!(name in prog.globals)) prog.globals[name] = 0;
        continue;
      }
      if (!proc) throw new ParseError(`"${toks[0].v}" must be inside a PROC.`, lineNo);
      stmt(toks, lineNo, blocks);
    }
    if (proc) throw new ParseError(`PROC ${proc.name} is missing ENDPROC.`, proc.line);
    if (!prog.procs.MAIN) {
      const first = Object.keys(prog.procs)[0];
      if (!first) throw new ParseError("No PROC found. A RAPID program needs PROC main().", 1);
      prog.main = first;
    }
    prog.procs[prog.main].body.unshift(...init);
    return prog;
  }

  function stripComment(s) {
    let q = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '"') q = !q;
      else if (s[i] === "!" && !q) return s.slice(0, i);
    }
    return s;
  }

  function moveArgs(toks, line) {
    const parts = splitArgs(toks);
    const opt = {};
    const args = parts.map((p) => {
      const k = p.findIndex((t) => t.v === "\\");
      if (k < 0) return p;
      let rest = p.slice(k);
      while (rest.length) { // \WObj:=wPallet  \V:=200
        if (rest[0].v !== "\\" || !rest[1]) throw new ParseError("Bad optional argument.", line);
        const name = rest[1].u; let j = 2;
        if (rest[j] && rest[j].v === ":=") {
          let end = rest.findIndex((t, idx) => idx > j && t.v === "\\"); if (end < 0) end = rest.length;
          opt[name] = expr(rest.slice(j + 1, end), line); rest = rest.slice(end);
        } else { opt[name] = true; rest = rest.slice(2); }
      }
      return p.slice(0, k);
    });
    return { args, opt };
  }

  function stmt(toks, line, B) {
    const head = toks[0].u;
    const ts = new Toks(toks, line);
    const push = (s) => { s.line = line; B.list.push(s); return s; };
    switch (head) {
      case "MOVEJ": case "MOVEL": case "MOVEC": case "MOVEABSJ": {
        const { args, opt } = moveArgs(toks.slice(1), line);
        const circ = head === "MOVEC";
        const need = circ ? 5 : 4;
        if (args.length < need) throw new ParseError(`${toks[0].v} needs ${circ ? "via point, end point, speed, zone and tool" : "target, speed, zone and tool"}.`, line);
        const a = args.map((p) => expr(p, line)).map((e, i) => {
          // inline targets: MoveL [[x,y,z],[q1..q4],[cf],[ext]], ...  (also used for MoveAbsJ joint targets)
          if (e.k !== "list" || i > (circ ? 1 : 0)) return e;
          return { k: "lit", v: dataValue(head === "MOVEABSJ" ? "jointtarget" : "robtarget", e, line) };
        });
        const s = { op: "move", kind: head === "MOVEL" ? "L" : head === "MOVEC" ? "C" : "J" };
        let k = 0;
        if (circ) s.via = a[k++];
        s.target = a[k++];
        const sp = opt.V || a[k++];
        s.speed = s.kind === "J" ? { pct: { k: "bin", op: "/", a: sp, b: { k: "num", v: 30 } } } : { mms: sp };
        s.blend = opt.Z || a[k++];
        s.tool = a[k++];
        s.wobj = opt.WOBJ || { k: "num", v: 0 }; // RAPID: no \WObj means wobj0
        return push(s);
      }
      case "SETDO": { const p = splitArgs(toks.slice(1)); if (p.length !== 2) throw new ParseError("SetDO needs a signal and a value.", line); return push({ op: "setdo", port: { k: "num", v: sigNum(SIG_OUT, p[0][0].v, line, "output") }, value: expr(p[1], line) }); }
      case "SET": case "RESET": { const t = toks[1]; if (!t) throw new ParseError(`${toks[0].v} needs a signal.`, line); return push({ op: "setdo", port: { k: "num", v: sigNum(SIG_OUT, t.v, line, "output") }, value: { k: "bool", v: head === "SET" } }); }
      case "PULSEDO": { const t = toks[toks.length - 1]; return push({ op: "pulse", port: { k: "num", v: sigNum(SIG_OUT, t.v, line, "output") } }); }
      case "WAITTIME": return push({ op: "wait", sec: expr(toks.slice(1).filter((t) => t.v !== "\\" && t.u !== "INPOS"), line) });
      case "WAITDI": {
        const p = splitArgs(toks.slice(1)); if (p.length < 2) throw new ParseError("WaitDI needs a signal and a value.", line);
        const n = sigNum(SIG_IN, p[0][0].v, line, "input");
        return push({ op: "waitcond", cond: { k: "bin", op: "==", a: { k: "call", name: "di", args: [{ k: "num", v: n }] }, b: expr(p[1], line) } });
      }
      case "WAITUNTIL": return push({ op: "waitcond", cond: expr(toks.slice(1), line) });
      case "TPWRITE": {
        const p = splitArgs(toks.slice(1));
        const { args, opt } = moveArgs(toks.slice(1), line);
        let e = expr(args[0], line);
        if (opt.NUM) e = { k: "bin", op: "+", a: e, b: { k: "call", name: "str", args: [opt.NUM] } };
        void p;
        return push({ op: "msg", expr: e });
      }
      case "INCR": case "DECR": {
        const n = toks[1].u;
        return push({ op: "assign", target: { name: n, path: [], decl: false }, expr: { k: "bin", op: head === "INCR" ? "+" : "-", a: { k: "var", name: n }, b: { k: "num", v: 1 } } });
      }
      case "IF": {
        const thenAt = toks.findIndex((t) => t.u === "THEN");
        if (thenAt < 0) { // single-line IF cond statement
          for (let k = 2; k < toks.length; k++) {
            try {
              const cond = expr(toks.slice(1, k), line);
              const node = { op: "if", cond, then: [], else: [], line };
              B.list.push(node);
              const inner = new Blocks(node.then); stmt(toks.slice(k), line, inner);
              return node;
            } catch (e) { if (k === toks.length - 1) throw e; }
          }
          throw new ParseError("IF needs THEN.", line);
        }
        const node = push({ op: "if", cond: expr(toks.slice(1, thenAt), line), then: [], else: [] });
        B.push("if", node, node.then, line); return node;
      }
      case "ELSEIF": {
        const top = B.top; if (top.kind !== "if") throw new ParseError("ELSEIF without IF.", line);
        const thenAt = toks.findIndex((t) => t.u === "THEN");
        if (thenAt < 0) throw new ParseError("ELSEIF needs THEN.", line);
        const node = { op: "if", cond: expr(toks.slice(1, thenAt), line), then: [], else: [], line };
        top.node.else = [node]; top.node = node; top.list = node.then; return node;
      }
      case "ELSE": { const top = B.top; if (top.kind !== "if") throw new ParseError("ELSE without IF.", line); top.list = top.node.else; return; }
      case "ENDIF": B.pop(["if"], line, "ENDIF"); return;
      case "FOR": {
        const v = toks[1].u;
        const fromAt = toks.findIndex((t) => t.u === "FROM"), toAt = toks.findIndex((t) => t.u === "TO"), stepAt = toks.findIndex((t) => t.u === "STEP"), doAt = toks.findIndex((t) => t.u === "DO");
        if (fromAt < 0 || toAt < 0 || doAt < 0) throw new ParseError("FOR needs: FOR i FROM 1 TO 3 DO", line);
        const node = push({ op: "for", var: v, from: expr(toks.slice(fromAt + 1, toAt), line), to: expr(toks.slice(toAt + 1, stepAt > 0 ? stepAt : doAt), line), step: stepAt > 0 ? expr(toks.slice(stepAt + 1, doAt), line) : null, body: [] });
        B.push("for", node, node.body, line); return node;
      }
      case "ENDFOR": B.pop(["for"], line, "ENDFOR"); return;
      case "WHILE": {
        const doAt = toks.findIndex((t) => t.u === "DO"); if (doAt < 0) throw new ParseError("WHILE needs DO.", line);
        const node = push({ op: "while", cond: expr(toks.slice(1, doAt), line), body: [] });
        B.push("while", node, node.body, line); return node;
      }
      case "ENDWHILE": B.pop(["while"], line, "ENDWHILE"); return;
      case "RETURN": return push({ op: "return" });
      case "STOP": return push({ op: "pause" });
      case "EXIT": return push({ op: "halt" });
      case "GOTO": return push({ op: "jump", name: toks[1].u });
    }
    // label:
    if (toks.length === 2 && toks[1].v === ":" && toks[0].t === "id") return push({ op: "label", name: head });
    // assignment
    const asg = toks.findIndex((t) => t.v === ":=");
    if (asg > 0) {
      const lhs = new Toks(toks.slice(0, asg), line);
      const name = lhs.id("a variable").u, path = [];
      while (lhs.accept(".")) { const f = lhs.id("a field").u; if (f === "TRANS" || f === "ROBAX") continue; path.push(/^RAX_[1-6]$/.test(f) ? "j" + (f[4] - 1) : f.toLowerCase()); }
      lhs.done("before :=");
      return push({ op: "assign", target: { name, path, decl: false }, expr: expr(toks.slice(asg + 1), line) });
    }
    // procedure call
    if (toks[0].t === "id" && toks.length === 1) return push({ op: "call", name: head });
    throw new ParseError(`Unknown instruction "${toks[0].v}".`, line);
  }

  // ---------- generator ----------
  function gen(r) {
    const L = [];
    const q = (o) => Rot.toQuat(Rot.fromFixedXYZ(o[0], o[1], o[2])).map((v) => +v.toFixed(5));
    const usesPallet = Object.values(r.points).some((p) => p.frame === 1);
    L.push("MODULE MainModule");
    L.push(`  ! ${r.title}`);
    L.push("  PERS tooldata tGripper := [TRUE,[[0,0,160],[1,0,0,0]],[1.5,[0,0,60],[1,0,0,0],0,0,0]];");
    if (usesPallet) L.push("  TASK PERS wobjdata wPallet := [FALSE,TRUE,\"\",[[400,250,400],[1,0,0,0]],[[0,0,0],[1,0,0,0]]];");
    for (const [n, p] of Object.entries(r.points)) L.push(`  CONST robtarget ${n} := [[${p.x},${p.y},${p.z}],[${q(p.o || [180, 0, 0]).join(",")}],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];`);
    for (const [n, j] of Object.entries(r.joints || {})) L.push(`  CONST jointtarget ${n} := [[${j.join(",")}],[9E9,9E9,9E9,9E9,9E9,9E9]];`);
    for (const [n, v] of Object.entries(r.vars || {})) L.push(`  VAR num ${n} := ${v};`);
    let tool = "tGripper";
    const st = { tool };
    const body = (ops, ind) => {
      for (const op of ops) {
        const I = "  ".repeat(ind);
        const wobj = (pt) => (r.points[pt] && r.points[pt].frame === 1 ? "\\WObj:=wPallet" : "");
        const target = (pt, off) => {
          if (!off) return pt;
          const d = off.d.map((v) => (typeof v === "number" ? String(v) : `(${v.v}-1)*${v.k}`));
          return off.mode === "tool" ? `RelTool(${pt},${d.join(",")})` : `Offs(${pt},${d.join(",")})`;
        };
        const zone = (b) => (b ? "z" + nearest(ZONES, b) : "fine");
        switch (op[0]) {
          case "c": L.push(`${I}! ${op[1]}`); break;
          case "tool": st.tool = op[1] ? "tGripper" : "tool0"; L.push(`${I}! Moves below use ${st.tool}`); break;
          case "frame": break;
          case "j": case "jo":
            if (r.joints && r.joints[op[1]]) L.push(`${I}MoveAbsJ ${op[1]}, v${nearest(SPEEDS, op[2] * 30)}, ${zone(op[3])}, ${st.tool};`);
            else L.push(`${I}MoveJ ${target(op[1], op[4])}, v${nearest(SPEEDS, op[2] * 30)}, ${zone(op[3])}, ${st.tool}${wobj(op[1])};`);
            break;
          case "l": L.push(`${I}MoveL ${target(op[1], op[4])}, v${nearest(SPEEDS, op[2])}, ${zone(op[3])}, ${st.tool}${wobj(op[1])};`); break;
          case "lrel": L.push(`${I}MoveL ${op[2] === "tool" ? "RelTool" : "Offs"}(CRobT(\\Tool:=${st.tool}),${op[1].join(",")}), v${nearest(SPEEDS, op[3])}, fine, ${st.tool};`); break;
          case "circ": L.push(`${I}MoveC ${op[1]}, ${op[2]}, v${nearest(SPEEDS, op[3])}, ${zone(op[4])}, ${st.tool}${wobj(op[2])};`); break;
          case "grip": L.push(`${I}${op[1] ? "Set" : "Reset"} doGripper;`); break;
          case "setdo": L.push(`${I}SetDO ${OUT_NAMES[op[1]]}, ${op[2] ? 1 : 0};`); break;
          case "wait": L.push(`${I}WaitTime ${op[1]};`); break;
          case "waitdi": L.push(`${I}WaitDI ${IN_NAMES[op[1]]}, ${op[2] ? 1 : 0};`); break;
          case "set": L.push(`${I}${op[1]} := ${op[2]};`); break;
          case "inc": L.push(`${I}Incr ${op[1]};`); break;
          case "for": L.push(`${I}FOR ${op[1]} FROM ${op[2]} TO ${op[3]} DO`); body(op[4], ind + 1); L.push(`${I}ENDFOR`); break;
          case "while": L.push(`${I}WHILE ${op[1][0]} ${abbOp(op[1][1])} ${op[1][2]} DO`); body(op[2], ind + 1); L.push(`${I}ENDWHILE`); break;
          case "if": L.push(`${I}IF ${cond(op[1])} THEN`); body(op[2], ind + 1); if (op[3] && op[3].length) { L.push(`${I}ELSE`); body(op[3], ind + 1); } L.push(`${I}ENDIF`); break;
          case "call": L.push(`${I}${op[1]};`); break;
          case "msg": L.push(`${I}TPWrite "${op[1]}"${op[2] ? `\\Num:=${op[2]}` : ""};`); break;
        }
      }
    };
    const abbOp = (o) => ({ "==": "=", "!=": "<>" }[o] || o);
    const cond = (c) => (c[0] === "di" ? `${IN_NAMES[c[1]]} = ${c[2] ? 1 : 0}` : `${c[0]} ${abbOp(c[1])} ${c[2]}`);
    L.push("");
    L.push("  PROC main()");
    body(r.main, 2);
    L.push("  ENDPROC");
    for (const [n, ops] of Object.entries(r.subs || {})) { L.push(""); L.push(`  PROC ${n}()`); st.tool = "tGripper"; body(ops, 2); L.push("  ENDPROC"); }
    L.push("ENDMODULE");
    return L.join("\n") + "\n";
  }

  LANGS.abb = {
    id: "abb", brand: "ABB", lang: "RAPID", file: "MainModule.mod",
    robot: { body: "#e8eaec", trim: "#3a3f45", label: "ABB-style 6-axis arm" },
    jointNames: ["J1", "J2", "J3", "J4", "J5", "J6"],
    jointValues: (q) => q,
    outName: (n) => OUT_NAMES[n] || "do" + n, inName: (n) => IN_NAMES[n] || "di" + n,
    poseFields(P) { const qq = Rot.toQuat(P.R); return [["X", fmt(P.p[0])], ["Y", fmt(P.p[1])], ["Z", fmt(P.p[2])], ["q1", fmt(qq[0], 4)], ["q2", fmt(qq[1], 4)], ["q3", fmt(qq[2], 4)], ["q4", fmt(qq[3], 4)]]; },
    teach(name, P, frame) {
      const qq = Rot.toQuat(P.R).map((v) => +v.toFixed(5));
      return `  CONST robtarget ${name} := [[${fmt(P.p[0])},${fmt(P.p[1])},${fmt(P.p[2])}],[${qq.join(",")}],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];${frame ? " ! taught in wPallet" : ""}`;
    },
    parse, gen,
    syntax: {
      comment: /!.*$/,
      keywords: /\b(MODULE|ENDMODULE|PROC|ENDPROC|CONST|VAR|PERS|TASK|LOCAL|IF|THEN|ELSEIF|ELSE|ENDIF|FOR|FROM|TO|STEP|DO|ENDFOR|WHILE|ENDWHILE|RETURN|EXIT|STOP|GOTO|AND|OR|NOT|XOR|DIV|MOD|TRUE|FALSE)\b/gi,
      motion: /\b(MoveJ|MoveL|MoveC|MoveAbsJ)\b/gi,
      builtins: /\b(SetDO|Set|Reset|PulseDO|WaitDI|WaitTime|WaitUntil|TPWrite|Incr|Decr|Offs|RelTool|CRobT|CJointT|DInput|DOutput|robtarget|jointtarget|tooldata|wobjdata|num|bool|string|fine|v\d+|vmax|z\d+|tool0|wobj0)\b/gi,
      io: /\b(do\w+|di\w+)\b/g,
    },
  };
})();
