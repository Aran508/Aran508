"use strict";
// KUKA Robot Language (KRL): DEF/END, DECL, aggregates {X 0,Y 0,...}, PTP/LIN/CIRC, $OUT/$IN, $VEL, $APO
(function () {
  const TYPES = ["INT", "REAL", "BOOL", "CHAR", "POS", "E6POS", "FRAME", "AXIS", "E6AXIS"];
  const zeroOf = (T) => (T === "BOOL" ? false : ["POS", "E6POS", "FRAME"].includes(T) ? Pose.identity() : T.endsWith("AXIS") ? Joints.make(KUKA_AXIS.toInternal([0, -90, 90, 0, 0, 0])) : 0);
  const SYS = { "$POS_ACT": { k: "call", name: "cur", args: [] }, "$AXIS_ACT": { k: "call", name: "curj", args: [] }, "$NULLFRAME": { k: "num", v: 0 } };
  const FIELDS = { X: "x", Y: "y", Z: "z", A: "ka", B: "kb", C: "kc", A1: "j0", A2: "j1", A3: "j2", A4: "j3", A5: "j4", A6: "j5" };

  const P = makeExprParser({
    binops: { "+": "+", "-": "-", "*": "*", "/": "/", "==": "==", "<>": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">=", AND: "and", OR: "or", EXOR: "xor" },
    unops: { NOT: "not", "-": "neg" },
    primary(ts, parse) {
      const t = ts.peek();
      if (!t) return undefined;
      if (t.v === "{") { // aggregate {X 1, Y 2, ...}
        ts.next();
        const fields = {};
        if (!ts.is("}")) do {
          const n = ts.id("an aggregate field (X, Y, Z, A, B, C or A1-A6)").u;
          fields[n] = parse(ts);
        } while (ts.accept(","));
        ts.expect("}");
        for (const k of ["S", "T", "E1", "E2", "E3", "E4", "E5", "E6"]) delete fields[k];
        return { k: "agg", fields };
      }
      if (t.t === "id" && (t.u === "$IN" || t.u === "$OUT") && ts.is("[", 1)) {
        ts.next(); ts.next(); const n = parse(ts); ts.expect("]");
        return { k: "call", name: t.u === "$IN" ? "di" : "do", args: [n] };
      }
      if (t.t === "id" && /^\$(VEL|APO|ACC)$/.test(t.u) && ts.is(".", 1)) { ts.next(); ts.next(); const f = ts.id().u; return { k: "var", name: `${t.u}.${f}` }; }
      if (t.t === "id" && (t.u === "TOOL_DATA" || t.u === "BASE_DATA") && ts.is("[", 1)) { ts.next(); ts.next(); const n = parse(ts); ts.expect("]"); return n; }
      return undefined;
    },
    ident(t) {
      if (t.u === "TRUE" || t.u === "FALSE") return { k: "bool", v: t.u === "TRUE" };
      if (t.u in SYS) return SYS[t.u];
      if (t.u === "HOME" || t.u === "XHOME") return { k: "var", name: "XHOME" };
      return { k: "var", name: t.u };
    },
    func(t, args) {
      const map = { SIN: "sind", COS: "cosd", TAN: "tan", ATAN2: "atan2d", SQRT: "sqrt", ABS: "abs" };
      if (!(t.u in map)) return { k: "callproc", name: t.u, args };
      return { k: "call", name: map[t.u], args };
    },
    field(base, t) {
      if (!(t.u in FIELDS)) throw new ParseError(`Unknown field .${t.v}. Use X, Y, Z, A, B, C or A1-A6.`, t.line);
      return { k: "field", base, name: FIELDS[t.u] };
    },
  });
  const exprOf = (toks, line) => {
    const ts = new Toks(toks, line); const e = P(ts); ts.done();
    if (e.k === "callproc") throw new ParseError(`${e.name}() is not a function here.`, line);
    return e;
  };

  function stripComment(s) {
    let q = false;
    for (let i = 0; i < s.length; i++) { if (s[i] === '"') q = !q; else if (s[i] === ";" && !q) return s.slice(0, i); }
    return s;
  }

  function parse(src) {
    const lines = src.split(/\r?\n/);
    const prog = {
      procs: {}, main: null, norm: (s) => s.toUpperCase(),
      globals: { "$VEL.CP": 2, "$APO.CDIS": 0, "$APO.CPTP": 0, "$VEL_PTP": 100, XHOME: Joints.make(KUKA_AXIS.toInternal([0, -90, 90, 0, 0, 0])) },
    };
    let proc = null, B = null, inDat = false;
    for (let i = 0; i < lines.length; i++) {
      const line = i + 1;
      const text = stripComment(lines[i]).trim();
      if (!text || text.startsWith("&")) continue;
      const toks = lex(text, line);
      if (!toks.length) continue;
      let k = 0;
      if (toks[0].u === "GLOBAL") k = 1;
      const head = toks[k].u;
      if (head === "DEFDAT") { inDat = true; continue; }
      if (head === "ENDDAT") { inDat = false; continue; }
      if (head === "DEF") {
        if (proc) throw new ParseError(`DEF ${proc.name} is missing END.`, line);
        const name = toks[k + 1] && toks[k + 1].u;
        if (!name) throw new ParseError("DEF needs a name, e.g. DEF main( )", line);
        proc = { name, body: [], line }; prog.procs[name] = proc; B = new Blocks(proc.body);
        if (!prog.main) prog.main = name;
        continue;
      }
      if (head === "DEFFCT") throw new ParseError("DEFFCT functions are not supported in the simulator. Use DEF subprograms.", line);
      if (head === "END" && toks.length === 1) {
        if (!proc) throw new ParseError("END without DEF.", line);
        B.close(line); proc.endLine = line; proc = null; continue;
      }
      // declarations: DECL [GLOBAL] TYPE name [= value], name2 ...
      let d = k;
      if (toks[d].u === "DECL") d++;
      if (toks[d] && toks[d].u === "GLOBAL") d++;
      if (toks[d] && TYPES.includes(toks[d].u) && toks[d + 1] && toks[d + 1].t === "id") {
        const T = toks[d].u;
        for (const part of splitArgs(toks.slice(d + 1))) {
          const name = part[0].u;
          let init = null;
          if (part[1] && part[1].v === "=") init = exprOf(part.slice(2), line);
          else if (part.length > 1) throw new ParseError("Declaration syntax: DECL TYPE name = value", line);
          if (init && !proc) prog.globals[name] = constValue(init, line);
          else {
            prog.globals[name] = prog.globals[name] !== undefined ? prog.globals[name] : zeroOf(T);
            if (init) B.list.push({ op: "assign", target: { name, path: [] }, expr: init, line });
          }
        }
        continue;
      }
      if (!proc) { if (inDat) continue; throw new ParseError(`"${toks[0].v}" must be inside DEF ... END.`, line); }
      stmt(toks, line, B, text);
    }
    if (proc) throw new ParseError(`DEF ${proc.name} is missing END.`, proc.line);
    if (!prog.main) throw new ParseError("No DEF found. A KRL program starts with DEF name( ).", 1);
    return prog;
  }
  function constValue(e, line) {
    const c = new Controller({}); c.vars = {};
    try { return c.ev(e, line); } catch (err) { throw new ParseError("Initial values in DECL must be constants.", line); }
  }

  function motion(kind, toks, line, B, text) {
    // inline form (ILF) from the pendant: PTP P1 CONT Vel=100 % PDAT1 Tool[1]:Gripper Base[0]
    if (/\bVel\s*=/i.test(text)) {
      const m = text.match(/^(PTP|LIN|CIRC)\s+(\w+)(?:\s+(\w+))?/i);
      const cont = /\bCONT\b/i.test(text);
      const vel = text.match(/Vel\s*=\s*([\d.]+)\s*(%|m\/s)/i);
      const tool = text.match(/Tool\[(\d+)\]/i), base = text.match(/Base\[(\d+)\]/i);
      const ref = (n) => ({ k: "ilf", name: n.toUpperCase() });
      if (tool) B.list.push({ op: "settool", value: { k: "num", v: +tool[1] }, line });
      if (base) B.list.push({ op: "setframe", value: { k: "num", v: +base[1] }, line });
      const s = { op: "move", kind: kind === "PTP" ? "J" : kind === "LIN" ? "L" : "C", line };
      if (kind === "CIRC") { s.via = ref(m[2]); s.target = ref(m[3]); } else s.target = ref(m[2]);
      if (vel) s.speed = vel[2] === "%" ? { pct: { k: "num", v: +vel[1] } } : { mms: { k: "num", v: +vel[1] * 1000 } };
      s.blend = { k: "num", v: cont ? 50 : 0 };
      B.list.push(s); return;
    }
    const rest = toks.slice(1);
    const approx = rest.length && ["C_DIS", "C_PTP", "C_VEL", "C_ORI"].includes(rest[rest.length - 1].u) ? rest.pop().u : null;
    const s = { op: "move", line };
    if (kind === "PTP" || kind === "LIN") {
      s.kind = kind === "PTP" ? "J" : "L";
      s.target = exprOf(rest, line);
    } else if (kind === "CIRC") {
      const parts = splitArgs(rest);
      if (parts.length < 2) throw new ParseError("CIRC needs an auxiliary (via) point and an end point: CIRC pVia, pEnd", line);
      s.kind = "C"; s.via = exprOf(parts[0], line); s.target = exprOf(parts[1], line);
    } else { // PTP_REL / LIN_REL
      let mode = "base";
      if (rest.length && (rest[rest.length - 1].u === "#TOOL" || rest[rest.length - 1].u === "#BASE")) mode = rest.pop().u === "#TOOL" ? "tool" : "base";
      s.kind = kind === "PTP_REL" ? "J" : "L";
      s.target = exprOf(rest, line);
      if (s.target.k === "agg" && mode === "tool") s.target.toolvec = true;
      s.rel = mode;
    }
    s.speed = s.kind === "J" ? { pct: { k: "var", name: "$VEL_PTP" } } : { mms: { k: "bin", op: "*", a: { k: "var", name: "$VEL.CP" }, b: { k: "num", v: 1000 } } };
    s.blend = approx === "C_DIS" || approx === "C_VEL" || approx === "C_ORI" ? { k: "var", name: "$APO.CDIS" } : approx === "C_PTP" ? { k: "var", name: "$APO.CPTP" } : { k: "num", v: 0 };
    B.list.push(s);
  }

  function stmt(toks, line, B, text) {
    const head = toks[0].u;
    const push = (x) => { x.line = line; B.list.push(x); return x; };
    const after = (word) => toks.slice(toks.findIndex((t) => t.u === word) + 1);
    switch (head) {
      case "PTP": case "LIN": case "CIRC": case "PTP_REL": case "LIN_REL": return motion(head, toks, line, B, text);
      case "WAIT": {
        if (toks[1] && toks[1].u === "SEC") return push({ op: "wait", sec: exprOf(toks.slice(2), line) });
        if (toks[1] && toks[1].u === "FOR") return push({ op: "waitcond", cond: exprOf(toks.slice(2), line) });
        throw new ParseError("Use WAIT SEC t or WAIT FOR condition.", line);
      }
      case "IF": {
        const th = toks.findIndex((t) => t.u === "THEN"); if (th < 0) throw new ParseError("IF needs THEN.", line);
        const node = push({ op: "if", cond: exprOf(toks.slice(1, th), line), then: [], else: [] });
        B.push("if", node, node.then, line); return;
      }
      case "ELSE": if (B.top.kind !== "if") throw new ParseError("ELSE without IF.", line); B.top.list = B.top.node.else; return;
      case "ENDIF": B.pop(["if"], line, "ENDIF"); return;
      case "FOR": {
        const eq = toks.findIndex((t) => t.v === "="), to = toks.findIndex((t) => t.u === "TO"), st = toks.findIndex((t) => t.u === "STEP");
        if (eq !== 2 || to < 0) throw new ParseError("FOR needs: FOR i = 1 TO 3", line);
        const node = push({ op: "for", var: toks[1].u, from: exprOf(toks.slice(3, to), line), to: exprOf(toks.slice(to + 1, st > 0 ? st : undefined), line), step: st > 0 ? exprOf(toks.slice(st + 1), line) : null, body: [] });
        B.push("for", node, node.body, line); return;
      }
      case "ENDFOR": B.pop(["for"], line, "ENDFOR"); return;
      case "WHILE": { const node = push({ op: "while", cond: exprOf(toks.slice(1), line), body: [] }); B.push("while", node, node.body, line); return; }
      case "ENDWHILE": B.pop(["while"], line, "ENDWHILE"); return;
      case "LOOP": { const node = push({ op: "loop", body: [] }); B.push("loop", node, node.body, line); return; }
      case "ENDLOOP": B.pop(["loop"], line, "ENDLOOP"); return;
      case "REPEAT": { const node = push({ op: "repeat", body: [], cond: null }); B.push("repeat", node, node.body, line); return; }
      case "UNTIL": { const top = B.pop(["repeat"], line, "UNTIL"); top.node.cond = exprOf(toks.slice(1), line); return; }
      case "EXIT": return push({ op: "exit" });
      case "HALT": return push({ op: "pause" });
      case "RETURN": return push({ op: "return" });
      case "GOTO": return push({ op: "jump", name: toks[1].u });
      case "INI": case "BAS": {
        if (head === "INI") return push({ op: "nop" });
        const inner = text.match(/BAS\s*\(\s*#(\w+)\s*(?:,\s*([\d.]+))?\s*\)/i);
        if (!inner) throw new ParseError("BAS(#VEL_PTP, 100) or BAS(#VEL_CP, 0.5) expected.", line);
        const kind = inner[1].toUpperCase(), val = inner[2] != null ? +inner[2] : null;
        if (kind === "VEL_PTP") return push({ op: "assign", target: { name: "$VEL_PTP", path: [] }, expr: { k: "num", v: val ?? 100 } });
        if (kind === "VEL_CP") return push({ op: "assign", target: { name: "$VEL.CP", path: [] }, expr: { k: "num", v: val ?? 2 } });
        return push({ op: "nop" });
      }
    }
    if (toks.length === 2 && toks[1].v === ":") return push({ op: "label", name: head });
    if (toks.length >= 3 && toks[1].v === "(" && toks[toks.length - 1].v === ")" && !toks.some((t) => t.v === "=")) return push({ op: "call", name: head });
    // assignment
    const eq = toks.findIndex((t) => t.v === "=");
    if (eq > 0) {
      const lhs = toks.slice(0, eq), rhs = toks.slice(eq + 1);
      const L0 = lhs[0].u;
      if (L0 === "$OUT") { const port = exprOf(lhs.slice(2, -1), line); return push({ op: "setdo", port, value: exprOf(rhs, line) }); }
      if (L0 === "$TOOL") { const e = exprOf(rhs, line); if (e.k === "agg") e.tooldata = true; return push({ op: "settool", value: e }); }
      if (L0 === "$BASE") return push({ op: "setframe", value: exprOf(rhs, line) });
      if (L0 === "$VEL_AXIS") return push({ op: "assign", target: { name: "$VEL_PTP", path: [] }, expr: exprOf(rhs, line) });
      if (L0 === "$OV_PRO") return push({ op: "override", value: exprOf(rhs, line) });
      if (/^\$(VEL|APO|ACC)$/.test(L0)) {
        if (!lhs[2]) throw new ParseError(`${lhs[0].v} needs a field, e.g. $VEL.CP`, line);
        const name = `${L0}.${lhs[2].u}`;
        return push({ op: "assign", target: { name, path: [] }, expr: exprOf(rhs, line) });
      }
      if (L0.startsWith("$")) throw new ParseError(`System variable ${lhs[0].v} is not simulated.`, line);
      const path = [];
      for (let j = 1; j < lhs.length; j += 2) {
        if (lhs[j].v !== "." || !lhs[j + 1] || !(lhs[j + 1].u in FIELDS)) throw new ParseError("Use name = value or name.X = value.", line);
        path.push(FIELDS[lhs[j + 1].u]);
      }
      return push({ op: "assign", target: { name: L0, path, decl: false }, expr: exprOf(rhs, line) });
    }
    throw new ParseError(`Unknown KRL statement "${toks[0].v}".`, line);
  }

  // ---------- generator ----------
  const abc = (o) => Rot.toZYX(Mat.mul(Rot.fromFixedXYZ(o[0], o[1], o[2]), Mat.tr(KUKA_TOOL_FIX))).map((v) => +fmt(v, 2));
  const aggPos = (p) => { const [A, B, C] = abc(p.o || [180, 0, 0]); return `{X ${p.x},Y ${p.y},Z ${p.z},A ${A},B ${B},C ${C}}`; };
  function gen(r) {
    const out = ["&ACCESS RVP", "&REL 1"];
    const allOps = [r.main, ...Object.values(r.subs || {})];
    const usesTmp = JSON.stringify(allOps).includes('"d"');
    const genDef = (name, ops, isMain) => {
      const L = [];
      const I = (n) => "  ".repeat(n);
      out.push(`DEF ${name}( )`);
      if (isMain) {
        L.push(`${I(1)};${r.title}`);
        for (const n of Object.keys(r.points)) L.push(`${I(1)}DECL E6POS ${n}`);
        for (const n of Object.keys(r.joints || {})) L.push(`${I(1)}DECL E6AXIS ${n}`);
        if (usesTmp) L.push(`${I(1)}DECL E6POS pTmp`);
        for (const n of Object.keys(r.vars || {})) L.push(`${I(1)}DECL INT ${n}`);
        const loopVars = new Set(); const sc = (ops) => ops.forEach((op) => { if (op[0] === "for" && !(r.vars || {})[op[1]]) loopVars.add(op[1]); [op[2], op[3], op[4]].forEach((x) => Array.isArray(x) && x.length && Array.isArray(x[0]) && sc(x)); });
        allOps.forEach(sc);
        for (const v of loopVars) L.push(`${I(1)}DECL INT ${v}`);
        L.push(`${I(1)};--- initialise ---`);
        L.push(`${I(1)}$TOOL = TOOL_DATA[1]`, `${I(1)}$BASE = $NULLFRAME`);
        for (const [n, p] of Object.entries(r.points)) L.push(`${I(1)}${n} = ${aggPos(p)}${p.frame ? "  ; in BASE_DATA[1] (pallet)" : ""}`);
        for (const [n, j] of Object.entries(r.joints || {})) { const a = KUKA_AXIS.fromInternal(j); L.push(`${I(1)}${n} = {A1 ${a[0]},A2 ${a[1]},A3 ${a[2]},A4 ${a[3]},A5 ${a[4]},A6 ${a[5]}}`); }
        for (const [n, v] of Object.entries(r.vars || {})) L.push(`${I(1)}${n} = ${v}`);
        L.push(`${I(1)};--- program ---`);
      }
      let base = isMain ? 0 : -1, vptp = null, vcp = null, cdis = null;
      const ensureBase = (pt, ind) => { const f = (r.points[pt] && r.points[pt].frame) || 0; if (r.points[pt] && f !== base) { L.push(`${I(ind)}$BASE = ${f ? "BASE_DATA[1]" : "$NULLFRAME"}`); base = f; } };
      const setPtp = (v, ind) => { if (v !== vptp) { L.push(`${I(ind)}BAS(#VEL_PTP, ${Math.round(v)})`); vptp = v; } };
      const setCp = (v, ind) => { if (v !== vcp) { L.push(`${I(ind)}$VEL.CP = ${+(v / 1000).toFixed(3)}`); vcp = v; } };
      const apo = (b, ind) => { if (!b) return ""; if (b !== cdis) { L.push(`${I(ind)}$APO.CDIS = ${b}`); cdis = b; } return " C_DIS"; };
      const target = (pt, off, ind) => {
        if (!off) return pt;
        L.push(`${I(ind)}pTmp = ${pt}`);
        off.d.forEach((v, i) => { if (v === 0) return; const ax = "XYZ"[i]; L.push(`${I(ind)}pTmp.${ax} = pTmp.${ax} + ${typeof v === "number" ? v : `(${v.v}-1)*${v.k}`}`); });
        return "pTmp";
      };
      const kop = (o) => ({ "==": "==", "!=": "<>" }[o] || o);
      const cond = (c) => (c[0] === "di" ? `$IN[${c[1]}] == ${c[2] ? "TRUE" : "FALSE"}` : `${c[0]} ${kop(c[1])} ${c[2]}`);
      const body = (ops, ind) => {
        for (const op of ops) {
          switch (op[0]) {
            case "c": L.push(`${I(ind)};${op[1]}`); break;
            case "tool": L.push(`${I(ind)}$TOOL = ${op[1] ? "TOOL_DATA[1]" : "$NULLFRAME"}`); break;
            case "frame": if (op[1] !== base) { L.push(`${I(ind)}$BASE = ${op[1] ? "BASE_DATA[1]" : "$NULLFRAME"}`); base = op[1]; } break;
            case "j": case "jo": { ensureBase(op[1], ind); setPtp(op[2], ind); const t = target(op[1], op[4], ind); const a = op[3] ? (L.push(`${I(ind)}$APO.CPTP = ${op[3]}`), " C_PTP") : ""; L.push(`${I(ind)}PTP ${t}${a}`); break; }
            case "l": { ensureBase(op[1], ind); setCp(op[2], ind); const t = target(op[1], op[4], ind); const a = apo(op[3], ind); L.push(`${I(ind)}LIN ${t}${a}`); break; }
            case "lrel": { setCp(op[3], ind); const d = op[1]; const v = op[2] === "tool" ? Mat.mv(Mat.ry(Math.PI / 2), d) : d; const f = ["X", "Y", "Z"].map((ax, i) => (Math.abs(v[i]) > 1e-9 ? `${ax} ${+v[i].toFixed(1)}` : null)).filter(Boolean); L.push(`${I(ind)}LIN_REL {${f.join(",")}} ${op[2] === "tool" ? "#TOOL" : "#BASE"}`); break; }
            case "circ": ensureBase(op[2], ind); setCp(op[3], ind); L.push(`${I(ind)}CIRC ${op[1]}, ${op[2]}${apo(op[4], ind)}`); break;
            case "grip": L.push(`${I(ind)}$OUT[1] = ${op[1] ? "TRUE" : "FALSE"}`); break;
            case "setdo": L.push(`${I(ind)}$OUT[${op[1]}] = ${op[2] ? "TRUE" : "FALSE"}`); break;
            case "wait": L.push(`${I(ind)}WAIT SEC ${op[1]}`); break;
            case "waitdi": L.push(`${I(ind)}WAIT FOR $IN[${op[1]}] == ${op[2] ? "TRUE" : "FALSE"}`); break;
            case "set": L.push(`${I(ind)}${op[1]} = ${op[2]}`); break;
            case "inc": L.push(`${I(ind)}${op[1]} = ${op[1]} + 1`); break;
            case "for": L.push(`${I(ind)}FOR ${op[1]} = ${op[2]} TO ${op[3]}`); base = -1; body(op[4], ind + 1); L.push(`${I(ind)}ENDFOR`); base = -1; break;
            case "while": L.push(`${I(ind)}WHILE ${cond(op[1])}`); base = -1; body(op[2], ind + 1); L.push(`${I(ind)}ENDWHILE`); base = -1; break;
            case "if": L.push(`${I(ind)}IF ${cond(op[1])} THEN`); base = -1; body(op[2], ind + 1); if (op[3] && op[3].length) { L.push(`${I(ind)}ELSE`); base = -1; body(op[3], ind + 1); } L.push(`${I(ind)}ENDIF`); base = -1; break;
            case "call": L.push(`${I(ind)}${op[1]}( )`); base = -1; vptp = vcp = cdis = null; break;
            case "msg": L.push(`${I(ind)};MSG: ${op[1]}`); break;
          }
        }
      };
      body(ops, 1);
      out.push(...L, "END", "");
    };
    genDef(r.name, r.main, true);
    for (const [n, ops] of Object.entries(r.subs || {})) genDef(n, ops, false);
    return out.join("\n");
  }

  LANGS.kuka = {
    id: "kuka", brand: "KUKA", lang: "KRL", file: "PickPlace.src",
    robot: { body: "#f07d16", trim: "#2c2c2c", label: "KUKA-style 6-axis arm" },
    jointNames: ["A1", "A2", "A3", "A4", "A5", "A6"],
    jointValues: (q) => KUKA_AXIS.fromInternal(q),
    outName: (n) => `$OUT[${n}]`, inName: (n) => `$IN[${n}]`,
    poseFields(P) { const e = Rot.toZYX(Mat.mul(P.R, Mat.tr(KUKA_TOOL_FIX))); return [["X", fmt(P.p[0])], ["Y", fmt(P.p[1])], ["Z", fmt(P.p[2])], ["A", fmt(e[0])], ["B", fmt(e[1])], ["C", fmt(e[2])]]; },
    teach(name, P) { const e = Rot.toZYX(Mat.mul(P.R, Mat.tr(KUKA_TOOL_FIX))); return `  ${name} = {X ${fmt(P.p[0])},Y ${fmt(P.p[1])},Z ${fmt(P.p[2])},A ${fmt(e[0])},B ${fmt(e[1])},C ${fmt(e[2])}}`; },
    parse, gen,
    syntax: {
      comment: /;.*$/,
      keywords: /\b(DEF|END|DECL|GLOBAL|IF|THEN|ELSE|ENDIF|FOR|TO|STEP|ENDFOR|WHILE|ENDWHILE|LOOP|ENDLOOP|REPEAT|UNTIL|EXIT|HALT|RETURN|GOTO|WAIT|SEC|FOR|AND|OR|NOT|EXOR|TRUE|FALSE|INT|REAL|BOOL|POS|E6POS|FRAME|AXIS|E6AXIS)\b/g,
      motion: /\b(PTP|LIN|CIRC|PTP_REL|LIN_REL|C_DIS|C_PTP|C_VEL|C_ORI)\b/g,
      builtins: /(\$VEL\.CP|\$APO\.CDIS|\$APO\.CPTP|\$TOOL|\$BASE|\$NULLFRAME|TOOL_DATA|BASE_DATA|#TOOL|#BASE|BAS|#VEL_PTP)/g,
      io: /\$(IN|OUT)\[\d+\]/g,
    },
  };
})();
