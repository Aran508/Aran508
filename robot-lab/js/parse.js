"use strict";
// Shared lexer and expression parser. Each language passes a small config
// describing its operators, literals and special forms.

const LANGS = {};

class ParseError extends Error {
  constructor(msg, line) { super(msg); this.line = line; }
}

const TOKEN_RE = /\s+|(\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)|("(?:[^"\\]|\\.)*")|([A-Za-z_$#][A-Za-z0-9_$#]*)|(:=|==|<>|!=|<=|>=|\*\*|[-+*/<>=(){}\[\],:;.%\\&|!?@*'])/y;

// Tokenise one line. `stripComment(line)` is applied first by the caller.
function lex(text, line) {
  const out = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < text.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(text);
    if (!m || m.index !== pos) throw new ParseError(`Unexpected character "${text[pos]}".`, line);
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1]), line, s: m[1] });
    else if (m[2] !== undefined) out.push({ t: "str", v: JSON.parse(m[2].replace(/\\(?!["\\nt])/g, "\\\\")), line });
    else if (m[3] !== undefined) out.push({ t: "id", v: m[3], u: m[3].toUpperCase(), line });
    else if (m[4] !== undefined) out.push({ t: "op", v: m[4], u: m[4], line });
  }
  return out;
}

class Toks {
  constructor(toks, line) { this.a = toks; this.i = 0; this.line = line; }
  peek(o = 0) { return this.a[this.i + o]; }
  next() { return this.a[this.i++]; }
  atEnd() { return this.i >= this.a.length; }
  is(v, o = 0) { const t = this.a[this.i + o]; return !!t && (t.v === v || t.u === v); }
  accept(v) { if (this.is(v)) { this.i++; return true; } return false; }
  expect(v, what) {
    if (this.is(v)) return this.next();
    const t = this.peek();
    throw new ParseError(`Expected ${what || `"${v}"`}${t ? ` but found "${t.v}"` : " at end of line"}.`, this.line);
  }
  id(what) {
    const t = this.next();
    if (!t || t.t !== "id") throw new ParseError(`Expected ${what || "a name"}${t ? ` but found "${t.v}"` : ""}.`, this.line);
    return t;
  }
  rest() { return this.a.slice(this.i); }
  done(what) { if (!this.atEnd()) throw new ParseError(`Unexpected "${this.peek().v}"${what ? " " + what : ""}.`, this.line); }
}

const PREC = { or: 1, xor: 1, and: 2, "==": 3, "!=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, div: 5, mod: 5 };

function makeExprParser(cfg) {
  // cfg.binops: { tokenKey: canonicalOp }  (word keys upper-case)
  // cfg.unops:  { tokenKey: "not" | "neg" }
  // cfg.primary(ts, parse) -> expr | undefined
  // cfg.ident(tok, ts, parse) -> expr
  // cfg.func(tok, args, ts) -> expr
  // cfg.field(base, tok) -> expr
  const key = (t) => (t.t === "id" ? t.u : t.v);
  function parse(ts, minPrec = 0) {
    let left = unary(ts);
    for (;;) {
      const t = ts.peek();
      if (!t || (t.t !== "op" && t.t !== "id")) break;
      const op = cfg.binops[key(t)];
      if (!op || PREC[op] < minPrec) break;
      ts.next();
      const right = parse(ts, PREC[op] + 1);
      left = { k: "bin", op, a: left, b: right };
    }
    return left;
  }
  function unary(ts) {
    const t = ts.peek();
    if (t && cfg.unops[key(t)]) {
      ts.next();
      const op = cfg.unops[key(t)];
      const a = op === "not" ? parse(ts, PREC["=="]) : unary(ts);
      if (op === "neg" && a.k === "num") return { k: "num", v: -a.v };
      return { k: "un", op, a };
    }
    if (t && t.v === "+") { ts.next(); return unary(ts); }
    return postfix(ts, primary(ts));
  }
  function primary(ts) {
    const hook = cfg.primary && cfg.primary(ts, parse);
    if (hook) return hook;
    const t = ts.next();
    if (!t) throw new ParseError("Expression is incomplete.", ts.line);
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.v === "(") { const e = parse(ts); ts.expect(")"); return e; }
    if (t.v === "[") {
      const items = [];
      if (!ts.is("]")) do { items.push(parse(ts)); } while (ts.accept(","));
      ts.expect("]");
      return { k: "list", items };
    }
    if (t.t === "id") {
      if (ts.is("(")) {
        ts.next();
        const args = [], named = {};
        if (!ts.is(")")) do {
          if (ts.peek() && ts.peek().t === "id" && ts.is("=", 1) && !ts.is("==", 1)) { const n = ts.next().v; ts.next(); named[n] = parse(ts); }
          else args.push(parse(ts));
        } while (ts.accept(","));
        ts.expect(")");
        return cfg.func(t, args, ts, named);
      }
      return cfg.ident(t, ts, parse);
    }
    throw new ParseError(`Unexpected "${t.v}" in expression.`, ts.line);
  }
  function postfix(ts, e) {
    for (;;) {
      if (ts.is(".") && ts.peek(1) && ts.peek(1).t === "id" && cfg.field) { ts.next(); e = cfg.field(e, ts.next(), ts); continue; }
      if (ts.is("[") && cfg.index) { ts.next(); const i = parse(ts); ts.expect("]"); e = { k: "index", base: e, index: i }; continue; }
      return e;
    }
  }
  return parse;
}

// Split a statement list on top-level commas.
function splitArgs(toks) {
  const parts = [[]]; let depth = 0;
  for (const t of toks) {
    if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
    if (t.v === ")" || t.v === "]" || t.v === "}") depth--;
    if (t.v === "," && depth === 0) { parts.push([]); continue; }
    parts[parts.length - 1].push(t);
  }
  return parts;
}

// Block stack helper for languages with IF/ENDIF style blocks.
class Blocks {
  constructor(root) { this.stack = [{ kind: "root", list: root }]; }
  get list() { return this.stack[this.stack.length - 1].list; }
  get top() { return this.stack[this.stack.length - 1]; }
  push(kind, node, list, line) { this.stack.push({ kind, node, list, line }); }
  pop(kinds, line, word) {
    const top = this.top;
    if (!kinds.includes(top.kind)) throw new ParseError(`${word} without a matching ${kinds[0].toUpperCase()}.`, line);
    this.stack.pop();
    return top;
  }
  close(line) {
    if (this.stack.length > 1) { const t = this.top; throw new ParseError(`${t.kind.toUpperCase()} opened here is never closed.`, t.line); }
  }
}

const fmt = (v, d = 1) => {
  const s = (Math.abs(v) < 1e-9 ? 0 : v).toFixed(d);
  return s === "-0." + "0".repeat(d) ? (0).toFixed(d) : s;
};
