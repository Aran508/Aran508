"use strict";
// FANUC Teach Pendant (TP) program in its ASCII .LS form: /PROG, /MN, /POS, /END
(function () {
  const REGS = ["R", "PR", "DI", "DO", "RI", "RO", "P", "AR", "UI", "UO", "LBL"];

  function makeExpr(progName, used) {
    return makeExprParser({
      binops: { "+": "+", "-": "-", "*": "*", "/": "/", DIV: "div", MOD: "mod", "=": "==", "<>": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">=", AND: "and", OR: "or" },
      unops: { "!": "not", NOT: "not", "-": "neg" },
      primary(ts, parse) {
        const t = ts.peek();
        if (!t || t.t !== "id" || !REGS.includes(t.u) || !ts.is("[", 1)) return undefined;
        ts.next(); ts.next();
        const n = ts.next();
        if (!n || n.t !== "num") throw new ParseError(`${t.u}[ ] needs a register number.`, ts.line);
        let m = null;
        if (ts.accept(",")) { const mm = ts.next(); if (!mm || mm.t !== "num") throw new ParseError("PR[i,j] needs an element number 1-6.", ts.line); m = mm.v; }
        ts.expect("]");
        return regExpr(t.u, n.v, m, ts.line, progName, used);
      },
      ident(t) {
        if (t.u === "ON") return { k: "bool", v: true };
        if (t.u === "OFF") return { k: "bool", v: false };
        if (t.u === "LPOS") return { k: "call", name: "cur", args: [] };
        if (t.u === "JPOS") return { k: "call", name: "curj", args: [] };
        throw new ParseError(`"${t.v}" is not a register or value TP understands.`, t.line);
      },
      func(t) { throw new ParseError(`TP programs cannot call functions like ${t.v}().`, t.line); },
    });
  }
  function regExpr(kind, n, m, line, progName, used) {
    switch (kind) {
      case "R": used.R.add(n); return { k: "var", name: `R[${n}]` };
      case "PR": used.PR.add(n); return m == null ? { k: "var", name: `PR[${n}]` } : { k: "field", base: { k: "var", name: `PR[${n}]` }, name: "xyzwpr"[m - 1] || "x" };
      case "P": return { k: "var", name: `${progName}:P[${n}]` };
      case "DI": case "RI": case "UI": return { k: "call", name: "di", args: [{ k: "num", v: n }] };
      case "DO": case "RO": case "UO": return { k: "call", name: "do", args: [{ k: "num", v: n }] };
    }
    throw new ParseError(`${kind}[ ] cannot be used here.`, line);
  }

  function parse(src) {
    const lines = src.split(/\r?\n/);
    const prog = { procs: {}, main: null, globals: {}, norm: (s) => s.toUpperCase() };
    const used = { R: new Set(), PR: new Set() };
    let cur = null, section = null, posBuf = "", posLine = 0;
    const startProg = (name, line) => {
      cur = { name: name.toUpperCase(), body: [], line, blocks: null, points: {} };
      cur.blocks = new Blocks(cur.body);
      prog.procs[cur.name] = cur;
      if (!prog.main) prog.main = cur.name;
    };
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const raw = lines[i];
      const t = raw.trim();
      if (!t) continue;
      let m;
      if ((m = t.match(/^\/PROG\s+(\S+)/i))) { startProg(m[1], lineNo); section = "head"; continue; }
      if (/^\/(ATTR|APPL|APPL_END)\b/i.test(t)) { section = "head"; continue; }
      if (/^\/MN\b/i.test(t)) { if (!cur) startProg("MAIN", lineNo); section = "mn"; continue; }
      if (/^\/POS\b/i.test(t)) { section = "pos"; continue; }
      if (/^\/END\b/i.test(t)) { if (cur) { cur.blocks.close(lineNo); cur.endLine = lineNo; } section = null; continue; }
      if (section === "head") continue;
      if (section === "pos") {
        if (!posBuf) posLine = lineNo;
        posBuf += " " + t;
        if (/\}\s*;?\s*$/.test(t)) { parsePoint(posBuf, posLine, cur, prog); posBuf = ""; }
        continue;
      }
      if (!cur) { startProg("MAIN", lineNo); section = "mn"; }
      if (section !== "mn" && section !== null) continue;
      // strip "  12:" line numbers and the trailing ';'
      let s = t.replace(/^\d+\s*:/, "").replace(/;\s*$/, "").trim();
      if (!s) continue;
      if (s.startsWith(":")) throw new ParseError("A ':' continuation line must follow a C (circular) motion line.", lineNo);
      if (/^[C]\s+(P|PR)\[/i.test(s) && !/(mm\/sec|%|cm\/min)/i.test(s)) {
        const nxt = (lines[i + 1] || "").trim().replace(/^\d+\s*:/, "").trim();
        if (nxt.startsWith(":")) { s += " " + nxt.slice(1).replace(/;\s*$/, ""); i++; }
      }
      stmt(s, lineNo, cur, used);
    }
    if (!prog.main) throw new ParseError("No program found. Start with /PROG NAME and /MN.", 1);
    for (const n of used.R) if (!(`R[${n}]` in prog.globals)) prog.globals[`R[${n}]`] = 0;
    for (const n of used.PR) if (!(`PR[${n}]` in prog.globals)) prog.globals[`PR[${n}]`] = Pose.identity();
    for (const p of Object.values(prog.procs)) { if (p.blocks) p.blocks.close(p.line); delete p.blocks; }
    return prog;
  }

  function parsePoint(text, line, cur, prog) {
    const h = text.match(/P\[(\d+)(?:\s*:\s*"?([^"\]]*)"?)?\]\s*\{/i);
    if (!h) throw new ParseError("Position block must start like P[1:\"HOME\"]{", line);
    if (!cur) throw new ParseError("Positions must come after /PROG.", line);
    const gp2At = text.search(/GP2\s*:/i);
    const gp2 = gp2At >= 0 ? text.slice(gp2At) : "";
    if (gp2At >= 0) text = text.slice(0, gp2At);
    const get = (k, unit) => { const m = text.match(new RegExp(`\\b${k}\\s*=\\s*(-?[\\d.]+)\\s*${unit}`, "i")); return m ? +m[1] : null; };
    const uf = (text.match(/UF\s*:\s*(\d+)/i) || [])[1], ut = (text.match(/UT\s*:\s*(\d+)/i) || [])[1];
    let v;
    if (get("J1", "deg") !== null) {
      const j = [1, 2, 3, 4, 5, 6].map((k) => get("J" + k, "deg"));
      if (j.some((x) => x === null)) throw new ParseError("Joint position needs J1 to J6.", line);
      v = Conv.jfanuc(j); // FANUC J1-J6 as shown on the pendant (J3 from the horizontal)
    } else {
      const c = ["X", "Y", "Z"].map((k) => get(k, "mm")).concat(["W", "P", "R"].map((k) => get(k, "deg")));
      if (c.some((x) => x === null)) throw new ParseError(`P[${h[1]}] needs X, Y, Z (mm) and W, P, R (deg).`, line);
      v = Conv.wpr(c);
      v.frame = uf != null ? +uf : 0;
      v.tool = ut != null ? +ut : undefined;
    }
    const e1 = gp2.match(/J1\s*=\s*(-?[\d.]+)\s*deg/i);
    if (e1) v.e1 = +e1[1];
    prog.globals[`${cur.name}:P[${h[1]}]`] = v;
  }

  function speedAndTerm(ts, kind, line, used) {
    const sp = ts.next();
    let speed;
    if (!sp) throw new ParseError("Motion needs a speed, e.g. 500mm/sec or 50%.", line);
    let val;
    if (sp.t === "id" && sp.u === "WELD_SPEED") { speed = { mms: { k: "call", name: "weldspeed", args: [] } }; val = null; }
    else if (sp.t === "num") val = { k: "num", v: sp.v };
    else if (sp.u === "R" && ts.is("[")) { ts.next(); const n = ts.next().v; ts.expect("]"); used.R.add(n); val = { k: "var", name: `R[${n}]` }; }
    else throw new ParseError(`Expected a speed but found "${sp.v}".`, line);
    if (!val) { /* WELD_SPEED: travel speed from the active weld schedule */ }
    else if (ts.accept("%")) { if (kind !== "J") throw new ParseError("Percent speed is only for joint (J) motion. Use mm/sec for L and C.", line); speed = { pct: val }; }
    else if (ts.is("MM")) { ts.next(); ts.expect("/"); ts.expect("SEC", "sec"); speed = { mms: val }; }
    else if (ts.is("CM")) { ts.next(); ts.expect("/"); ts.expect("MIN", "min"); speed = { mms: { k: "bin", op: "/", a: { k: "bin", op: "*", a: val, b: { k: "num", v: 10 } }, b: { k: "num", v: 60 } } }; }
    else throw new ParseError(`Speed unit missing: use ${kind === "J" ? "%" : "mm/sec"}.`, line);
    if (kind === "J" && speed.mms) speed = { pct: { k: "bin", op: "/", a: speed.mms, b: { k: "num", v: 20 } } };
    const term = ts.next();
    if (!term) throw new ParseError("Motion needs FINE or CNTn termination.", line);
    let blend;
    if (term.u === "FINE") blend = { k: "num", v: 0 };
    else if (/^CNT\d+$/.test(term.u)) blend = { k: "num", v: Math.min(100, +term.u.slice(3)) };
    else throw new ParseError(`Expected FINE or CNT0-CNT100 but found "${term.v}".`, line);
    return { speed, blend };
  }

  function posRef(ts, line, cur, used) {
    const t = ts.next();
    if (!t || (t.u !== "P" && t.u !== "PR") || !ts.is("[")) throw new ParseError("Motion needs a position like P[1] or PR[1].", line);
    ts.next(); const n = ts.next(); ts.expect("]");
    if (t.u === "PR") { used.PR.add(n.v); return { k: "var", name: `PR[${n.v}]` }; }
    return { k: "var", name: `${cur.name}:P[${n.v}]`, label: `P[${n.v}]` };
  }

  function stmt(s, line, cur, used) {
    const B = cur.blocks;
    const push = (x) => { x.line = line; B.list.push(x); return x; };
    const P = makeExpr(cur.name, used);
    const expr = (toks) => { const ts = new Toks(toks, line); const e = P(ts); ts.done(); return e; };
    if (s.startsWith("!") || s.startsWith("//")) return push({ op: "nop" });
    let am;
    if ((am = s.match(/^Arc\s+Start\s*\[\s*(\d+)\s*\]$/i))) return push({ op: "ext", kind: "arcstart", sched: +am[1] });
    if ((am = s.match(/^Arc\s+End\s*\[\s*(\d+)\s*\]$/i))) return push({ op: "ext", kind: "arcend", sched: +am[1] });
    if ((am = s.match(/^Weave\s+(Sine|Circle|Figure\s*8)\s*\[\s*(\d+)\s*\]$/i))) return push({ op: "ext", kind: "weave", pattern: am[1], sched: +am[2] });
    if (/^Weave\s+End$/i.test(s)) return push({ op: "ext", kind: "weaveend" });
    if (/^(Arc|Weave)\b/i.test(s)) throw new ParseError("Arc instructions look like: Arc Start[1] ;  Arc End[1] ;  Weave Sine[1] ;  Weave End ;", line);
    let m;
    if ((m = s.match(/^MESSAGE\s*\[(.*)\]$/i))) return push({ op: "msg", expr: { k: "str", v: m[1] } });
    s = s.replace(/\[(\s*\d+)\s*:[^\]]*\]/g, "[$1]"); // drop register comments R[1:count]
    if ((m = s.match(/^([JLC])\s+/i)) && /^(P|PR)\[/i.test(s.slice(m[0].length))) {
      const kind = m[1].toUpperCase();
      const ts = new Toks(lex(s.slice(m[0].length), line), line);
      const node = { op: "move", kind, checkFrame: true };
      if (kind === "C") { node.via = posRef(ts, line, cur, used); }
      node.target = posRef(ts, line, cur, used);
      Object.assign(node, speedAndTerm(ts, kind, line, used));
      while (!ts.atEnd()) {
        const o = ts.next();
        if (o.u === "OFFSET" || o.u === "TOOL_OFFSET") {
          if (!ts.accept(",")) throw new ParseError("Use Offset,PR[n] (OFFSET CONDITION is not supported).", line);
          const pr = posRef(ts, line, cur, used);
          node.offset = { expr: pr, mode: o.u === "OFFSET" ? "base" : "tool" };
        } else if (/^ACC\d+$/.test(o.u) || o.u === "WJNT" || o.u === "PTH") { /* accepted, no effect in the simulator */ }
        else throw new ParseError(`Motion option "${o.v}" is not supported.`, line);
      }
      return push(node);
    }
    const toks = lex(s, line);
    const ts = new Toks(toks, line);
    const head = toks[0].u;
    switch (head) {
      case "UTOOL_NUM": ts.next(); ts.expect("="); return push({ op: "settool", value: expr(ts.rest()) });
      case "UFRAME_NUM": ts.next(); ts.expect("="); return push({ op: "setframe", value: expr(ts.rest()) });
      case "OVERRIDE": { ts.next(); ts.expect("="); const v = ts.next(); ts.accept("%"); return push({ op: "override", value: { k: "num", v: v.v } }); }
      case "WAIT": {
        let rest = toks.slice(1);
        const to = rest.findIndex((t) => t.u === "TIMEOUT"); if (to >= 0) rest = rest.slice(0, to).filter((t, i, a) => !(i === a.length - 1 && t.v === ","));
        if (rest.length >= 2 && rest[0].t === "num" && rest[1].v === "(") return push({ op: "wait", sec: { k: "num", v: rest[0].v } });
        const hasCmp = rest.some((t) => ["=", "<>", "<", ">", "<=", ">="].includes(t.v)) || rest.some((t) => ["DI", "RI", "DO", "RO"].includes(t.u));
        const e = expr(rest);
        return push(hasCmp ? { op: "waitcond", cond: e } : { op: "wait", sec: e });
      }
      case "LBL": { ts.next(); ts.expect("["); const n = ts.next(); ts.expect("]"); return push({ op: "label", name: String(n.v) }); }
      case "JMP": { ts.next(); ts.expect("LBL"); ts.expect("["); const n = ts.next(); ts.expect("]"); return push({ op: "jump", name: String(n.v) }); }
      case "CALL": { ts.next(); return push({ op: "call", name: ts.id("a program name").u }); }
      case "END": return push({ op: "return" });
      case "ABORT": return push({ op: "halt" });
      case "PAUSE": return push({ op: "pause" });
      case "ELSE": { if (B.top.kind !== "if") throw new ParseError("ELSE without IF ... THEN.", line); B.top.list = B.top.node.else; return; }
      case "ENDIF": B.pop(["if"], line, "ENDIF"); return;
      case "ENDFOR": B.pop(["for"], line, "ENDFOR"); return;
      case "FOR": {
        const eq = toks.findIndex((t) => t.v === "="), toAt = toks.findIndex((t) => t.u === "TO" || t.u === "DOWNTO");
        if (eq < 0 || toAt < 0) throw new ParseError("FOR needs: FOR R[1]=1 TO 3", line);
        const v = expr(toks.slice(1, eq));
        if (v.k !== "var") throw new ParseError("FOR counter must be a register R[n].", line);
        const node = push({ op: "for", var: v.name, from: expr(toks.slice(eq + 1, toAt)), to: expr(toks.slice(toAt + 1)), step: { k: "num", v: toks[toAt].u === "DOWNTO" ? -1 : 1 }, body: [] });
        B.push("for", node, node.body, line); return;
      }
      case "IF": {
        if (toks[toks.length - 1].u === "THEN") {
          const node = push({ op: "if", cond: expr(toks.slice(1, -1)), then: [], else: [] });
          B.push("if", node, node.then, line); return;
        }
        const parts = splitArgs(toks.slice(1));
        if (parts.length < 2) throw new ParseError("IF needs an action: IF R[1]<3,JMP LBL[1]", line);
        const cond = expr(parts[0]);
        const action = parts.slice(1).reduce((a, p, i) => a.concat(i ? [{ t: "op", v: ",", u: "," }] : [], p), []);
        const node = push({ op: "if", cond, then: [], else: [] });
        const sub = { blocks: new Blocks(node.then), name: cur.name };
        stmt(action.map((t) => (t.s !== undefined ? t.s : t.v)).join(" ").replace(/\[ /g, "[").replace(/ \]/g, "]"), line, sub, used);
        return;
      }
    }
    // assignments: R[1]=..., PR[1]=..., PR[1,3]=..., DO[1]=ON
    const eq = toks.findIndex((t) => t.v === "=");
    if (eq > 0) {
      const lhs = expr(toks.slice(0, eq));
      const rhsToks = toks.slice(eq + 1);
      if (lhs.k === "call" && lhs.name === "do") {
        if (rhsToks[0] && rhsToks[0].u === "PULSE") {
          const d = rhsToks.find((t) => t.t === "num");
          return push({ op: "pulse", port: lhs.args[0], sec: d ? { k: "num", v: d.v } : null });
        }
        return push({ op: "setdo", port: lhs.args[0], value: expr(rhsToks) });
      }
      if (lhs.k === "var") return push({ op: "assign", target: { name: lhs.name, path: [] }, expr: expr(rhsToks) });
      if (lhs.k === "field") return push({ op: "assign", target: { name: lhs.base.name, path: [lhs.name] }, expr: expr(rhsToks) });
      throw new ParseError("Left side of = must be a register or output.", line);
    }
    throw new ParseError(`Unknown TP instruction "${toks[0].v}".`, line);
  }

  // ---------- generator ----------
  function gen(r) {
    const varNames = [...Object.keys(r.vars || {})];
    const scanVars = (ops) => ops.forEach((op) => { if (op[0] === "for" && !varNames.includes(op[1])) varNames.push(op[1]); ["for", "while", "if"].includes(op[0]) && [op[2], op[3], op[4]].forEach((x) => Array.isArray(x) && x.length && Array.isArray(x[0]) && scanVars(x)); });
    scanVars(r.main); Object.values(r.subs || {}).forEach(scanVars);
    const R = (v) => `R[${varNames.indexOf(v) + 1}:${v}]`;
    const Rn = (v) => `R[${varNames.indexOf(v) + 1}]`;
    // constant offsets become position registers set up once at the start of the main program
    const prs = [];
    const prFor = (off) => {
      const constant = off.d.every((x) => typeof x === "number");
      const key = constant ? off.mode + off.d.join(",") : "var" + off.mode + JSON.stringify(off.d.slice(0, 2));
      let pr = prs.find((p) => p.key === key);
      if (!pr) { pr = { key, n: prs.length + 1, off, constant, name: constant ? (off.mode === "tool" ? "TOOL_OFS" : off.d[2] > 0 ? "APPROACH" : "OFFSET") : "GRID_OFS" }; prs.push(pr); }
      return pr;
    };
    const allOps = [r.main, ...Object.values(r.subs || {})];
    const scanOff = (ops) => ops.forEach((op) => { if ((op[0] === "l" || op[0] === "jo" || op[0] === "j") && op[4]) prFor(op[4]); ["for", "while", "if"].includes(op[0]) && [op[2], op[3], op[4]].forEach((x) => Array.isArray(x) && x.length && Array.isArray(x[0]) && scanOff(x)); });
    allOps.forEach(scanOff);

    const out = [];
    const genProg = (name, ops, isMain) => {
      const pts = [];
      const ptIndex = (n) => { let i = pts.indexOf(n); if (i < 0) { pts.push(n); i = pts.length - 1; } return i + 1; };
      const mn = [];
      let frame = isMain ? 0 : -1;
      const line = (s, motion) => mn.push(motion ? s : "  " + s);
      if (isMain) {
        line(`!${r.title.slice(0, 28)} ;`);
        for (const pr of prs.filter((p) => p.constant)) {
          line(`PR[${pr.n}:${pr.name}]=PR[${pr.n}]-PR[${pr.n}] ;`);
          pr.off.d.forEach((v, i) => { if (v) line(`PR[${pr.n},${i + 1}]=${v} ;`); });
        }
      }
      const ensureFrame = (pt) => { const f = (r.points[pt] && r.points[pt].frame) || 0; if (r.points[pt] && f !== frame) { line(`UFRAME_NUM=${f} ;`); frame = f; } };
      const offTxt = (off) => {
        if (!off) return "";
        const pr = prFor(off);
        if (!pr.constant) {
          line(`PR[${pr.n}:${pr.name}]=PR[${pr.n}]-PR[${pr.n}] ;`);
          off.d.forEach((v, i) => { if (typeof v === "number") { if (v) line(`PR[${pr.n},${i + 1}]=${v} ;`); } else line(`PR[${pr.n},${i + 1}]=(${Rn(v.v)}-1)*${v.k} ;`); });
        }
        return ` ${off.mode === "tool" ? "Tool_Offset" : "Offset"},PR[${pr.n}:${pr.name}]`;
      };
      const term = (b) => (b ? `CNT${Math.min(100, Math.round(b))}` : "FINE");
      const pref = (pt) => `P[${ptIndex(pt)}:${pt.toUpperCase().slice(0, 12)}]`;
      const cond = (c, neg) => {
        if (c[0] === "di") return `DI[${c[1]}]=${(c[2] !== !!neg) ? "ON" : "OFF"}`;
        const inv = { "<": ">=", ">=": "<", ">": "<=", "<=": ">", "==": "<>", "!=": "=" };
        const op = neg ? inv[c[1]] : c[1];
        return `${R(c[0])}${{ "==": "=", "!=": "<>" }[op] || op}${c[2]}`;
      };
      let lbl = isMain ? 1 : 1;
      const body = (ops) => {
        for (const op of ops) {
          switch (op[0]) {
            case "c": line(`!${op[1]} ;`); break;
            case "tool": line(`UTOOL_NUM=${op[1]} ;`); break;
            case "frame": if (op[1] !== frame) { line(`UFRAME_NUM=${op[1]} ;`); frame = op[1]; } break;
            case "j": case "jo": { ensureFrame(op[1]); const o = offTxt(op[4]); line(`J ${pref(op[1])} ${Math.round(op[2])}% ${term(op[3])}${o} ;`, true); break; }
            case "l": { ensureFrame(op[1]); const o = offTxt(op[4]); line(`L ${pref(op[1])} ${Math.round(op[2])}mm/sec ${term(op[3])}${o} ;`, true); break; }
            case "lrel": {
              line("PR[5:REL]=PR[5]-PR[5] ;");
              op[1].forEach((v, i) => { if (v) line(`PR[5,${i + 1}]=${v} ;`); });
              line("PR[6:HERE]=LPOS ;");
              line(`L PR[6:HERE] ${Math.round(op[3])}mm/sec FINE ${op[2] === "tool" ? "Tool_Offset" : "Offset"},PR[5:REL] ;`, true);
              break;
            }
            case "circ": ensureFrame(op[2]); line(`C ${pref(op[1])}`, true); mn.push(`    :  ${pref(op[2])} ${Math.round(op[3])}mm/sec ${term(op[4])} ;`); break;
            case "grip": line(`DO[1:GRIPPER]=${op[1] ? "ON" : "OFF"} ;`); break;
            case "setdo": line(`DO[${op[1]}]=${op[2] ? "ON" : "OFF"} ;`); break;
            case "wait": line(`WAIT ${op[1].toFixed(2)}(sec) ;`); break;
            case "waitdi": line(`WAIT DI[${op[1]}]=${op[2] ? "ON" : "OFF"} ;`); break;
            case "set": line(`${R(op[1])}=${op[2]} ;`); break;
            case "inc": line(`${R(op[1])}=${Rn(op[1])}+1 ;`); break;
            case "for": line(`FOR ${R(op[1])}=${op[2]} TO ${op[3]} ;`); frame = -1; body(op[4]); line("ENDFOR ;"); frame = -1; break;
            case "while": { const a = lbl++, b = lbl++; line(`LBL[${a}] ;`); line(`IF ${cond(op[1], true)},JMP LBL[${b}] ;`); frame = -1; body(op[2]); frame = -1; line(`JMP LBL[${a}] ;`); line(`LBL[${b}] ;`); break; }
            case "if": line(`IF (${cond(op[1])}) THEN ;`); frame = -1; body(op[2]); if (op[3] && op[3].length) { line("ELSE ;"); frame = -1; body(op[3]); } line("ENDIF ;"); frame = -1; break;
            case "call": line(`CALL ${op[1].toUpperCase()} ;`); frame = -1; break;
            case "msg": line(`MESSAGE[${op[1]}] ;`); break;
          }
        }
      };
      body(ops);
      out.push(`/PROG  ${name.toUpperCase()}`, "/ATTR", `COMMENT\t\t= "${isMain ? r.title.slice(0, 16) : "Subprogram"}";`, "/MN");
      mn.forEach((s, i) => out.push(s.startsWith("    :") ? s : `${String(i + 1).padStart(4)}:${s}`));
      out.push("/POS");
      pts.forEach((n, i) => {
        const tag = `P[${i + 1}:"${n.toUpperCase().slice(0, 12)}"]{`;
        out.push(tag, "   GP1:");
        if (r.joints && r.joints[n]) {
          const j = FANUC_AXIS.fromInternal(r.joints[n]);
          out.push("\tUF : 0, UT : 1,");
          out.push(`\tJ1=  ${j[0].toFixed(3)} deg,\tJ2=  ${j[1].toFixed(3)} deg,\tJ3=  ${j[2].toFixed(3)} deg,`);
          out.push(`\tJ4=  ${j[3].toFixed(3)} deg,\tJ5=  ${j[4].toFixed(3)} deg,\tJ6=  ${j[5].toFixed(3)} deg`);
        } else {
          const p = r.points[n], o = p.o || [180, 0, 0];
          out.push(`\tUF : ${p.frame || 0}, UT : 1,\t\tCONFIG : 'N U T, 0, 0, 0',`);
          out.push(`\tX = ${p.x.toFixed(3).padStart(10)}  mm,\tY = ${p.y.toFixed(3).padStart(10)}  mm,\tZ = ${p.z.toFixed(3).padStart(10)}  mm,`);
          out.push(`\tW = ${o[0].toFixed(3).padStart(10)} deg,\tP = ${o[1].toFixed(3).padStart(10)} deg,\tR = ${o[2].toFixed(3).padStart(10)} deg`);
        }
        out.push("};");
      });
      out.push("/END", "");
    };
    genProg(r.name, r.main, true);
    for (const [n, ops] of Object.entries(r.subs || {})) genProg(n, ops, false);
    return out.join("\n");
  }

  LANGS.fanuc = {
    id: "fanuc", brand: "FANUC", lang: "TP", file: "PICK_PLACE.LS",
    robot: { body: "#f2c21b", trim: "#2b2b2b", label: "FANUC-style 6-axis arm" },
    jointNames: ["J1", "J2", "J3", "J4", "J5", "J6"],
    jointValues: (q) => FANUC_AXIS.fromInternal(q),
    jointsToInternal: (f) => FANUC_AXIS.toInternal(f),
    outName: (n) => `DO[${n}]`, inName: (n) => `DI[${n}]`,
    poseFields(P) { const e = Rot.toFixedXYZ(P.R); return [["X", fmt(P.p[0])], ["Y", fmt(P.p[1])], ["Z", fmt(P.p[2])], ["W", fmt(e[0])], ["P", fmt(e[1])], ["R", fmt(e[2])]]; },
    teach(name, P, frame) {
      const e = Rot.toFixedXYZ(P.R);
      return `P[9:"${name.toUpperCase()}"]{\n   GP1:\n\tUF : ${frame || 0}, UT : 1,\t\tCONFIG : 'N U T, 0, 0, 0',\n\tX = ${fmt(P.p[0], 3)}  mm,\tY = ${fmt(P.p[1], 3)}  mm,\tZ = ${fmt(P.p[2], 3)}  mm,\n\tW = ${fmt(e[0], 3)} deg,\tP = ${fmt(e[1], 3)} deg,\tR = ${fmt(e[2], 3)} deg\n};`;
    },
    parse, gen,
    syntax: {
      comment: /!.*$/,
      keywords: /\b(IF|THEN|ELSE|ENDIF|FOR|TO|DOWNTO|ENDFOR|JMP|LBL|CALL|END|ABORT|PAUSE|WAIT|AND|OR|ON|OFF|FINE|UTOOL_NUM|UFRAME_NUM|OVERRIDE|Offset|Tool_Offset|MESSAGE|TIMEOUT)\b|^\/(PROG|ATTR|MN|POS|END|APPL)/gim,
      motion: /^(\s*\d+:)?[JLC](?=\s+P)|\b(CNT\d+)\b/gm,
      builtins: /\b(mm\/sec|deg|mm|sec|UF|UT|CONFIG|GP1|LPOS|JPOS)\b/g,
      io: /\b(DO|DI|RO|RI|R|PR|P)\[[^\]]*\]/g,
    },
  };
})();
