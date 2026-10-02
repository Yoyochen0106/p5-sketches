// Expression parser: parseExpression(str) -> def(A, x), usable with realAlg, complexAlg and
// seriesAlg(n, center). Hand-written tokenizer + precedence-climbing parser (no eval / Function).
//
// Grammar (lowest to highest precedence):
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | '/' | <implicit>) unary)*      implicit: next token is an identifier or '('
//   unary  := ('+' | '-') unary | power                      so -x^2 = -(x^2)
//   power  := primary ('^' unary)?                           right associative, 2^-x allowed
//   primary:= number | x | pi | e | func '(' expr ')' | '(' expr ')'

const FUNCS = new Set([
  'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'sqrt', 'atan', 'abs',
  'sec', 'csc', 'cot', 'asin', 'acos', 'asinh',
]);
const CONSTS = { pi: Math.PI, e: Math.E };

// Real-valued folding of functions applied to constants (used to detect constant exponents).
const FOLD = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log, sqrt: Math.sqrt, atan: Math.atan, abs: Math.abs,
};

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`Invalid number at position ${i + 1}`);
      toks.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      // A letter glued to a number like "1.2.3" is caught by the parser as unexpected token.
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i));
      toks.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if ('+-*/^()'.includes(c)) { toks.push({ t: c, pos: i }); i++; continue; }
    throw new Error(`Unexpected character '${c}' at position ${i + 1}`);
  }
  toks.push({ t: 'end', pos: src.length });
  return toks;
}

function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const describe = (tok) => (tok.t === 'end' ? 'end of input' : `'${tok.t === 'num' ? tok.v : tok.t === 'id' ? tok.v : tok.t}'`);
  const fail = (tok, msg) => { throw new Error(`${msg} at position ${tok.pos + 1}`); };

  function expr() {
    let left = term();
    while (peek().t === '+' || peek().t === '-') {
      const op = toks[p++].t;
      left = { k: 'bin', op, a: left, b: term() };
    }
    return left;
  }

  function term() {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok.t === '*' || tok.t === '/') {
        p++;
        left = { k: 'bin', op: tok.t, a: left, b: unary() };
      } else if (tok.t === 'id' || tok.t === '(') {
        left = { k: 'bin', op: '*', a: left, b: power() }; // implicit multiplication
      } else if (tok.t === 'num') {
        fail(tok, `Unexpected number ${tok.v} (missing operator?)`);
      } else break;
    }
    return left;
  }

  function unary() {
    const tok = peek();
    if (tok.t === '-') { p++; return { k: 'neg', a: unary() }; }
    if (tok.t === '+') { p++; return unary(); }
    return power();
  }

  function power() {
    const base = primary();
    if (peek().t === '^') {
      p++;
      return { k: 'pow', a: base, b: unary() };
    }
    return base;
  }

  function primary() {
    const tok = toks[p];
    if (tok.t === 'num') { p++; return { k: 'num', v: tok.v }; }
    if (tok.t === '(') {
      p++;
      const inner = expr();
      if (peek().t !== ')') fail(peek(), `Expected ')' (opened at position ${tok.pos + 1}) but found ${describe(peek())}`);
      p++;
      return inner;
    }
    if (tok.t === 'id') {
      p++;
      const name = tok.v;
      if (name === 'x') return { k: 'x' };
      if (name in CONSTS) return { k: 'num', v: CONSTS[name], name };
      if (FUNCS.has(name)) {
        if (peek().t !== '(') fail(peek(), `Function '${name}' must be followed by '(' but found ${describe(peek())}`);
        const open = toks[p++];
        const arg = expr();
        if (peek().t !== ')') fail(peek(), `Expected ')' (opened at position ${open.pos + 1}) but found ${describe(peek())}`);
        p++;
        return { k: 'fn', name, a: arg };
      }
      if (name === 'i') fail(tok, "The imaginary unit 'i' is not supported");
      fail(tok, `Unknown identifier '${name}'`);
    }
    if (tok.t === ')') fail(tok, "Unbalanced ')'");
    fail(tok, `Unexpected ${describe(tok)}`);
  }

  if (toks.length === 1) throw new Error('Empty expression');
  const ast = expr();
  if (peek().t !== 'end') {
    fail(peek(), peek().t === ')' ? "Unbalanced ')'" : `Unexpected ${describe(peek())}`);
  }
  return ast;
}

/** Real value of a variable-free subtree, or null if it depends on x / cannot be folded. */
function constValue(n) {
  switch (n.k) {
    case 'num': return n.v;
    case 'x': return null;
    case 'neg': { const a = constValue(n.a); return a === null ? null : -a; }
    case 'bin': {
      const a = constValue(n.a);
      const b = constValue(n.b);
      if (a === null || b === null) return null;
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : a / b;
    }
    case 'pow': {
      const a = constValue(n.a);
      const b = constValue(n.b);
      if (a === null || b === null) return null;
      const r = Math.pow(a, b);
      return Number.isFinite(r) ? r : null;
    }
    case 'fn': {
      const a = constValue(n.a);
      if (a === null || !FOLD[n.name] || n.name === 'abs') return null;
      const r = FOLD[n.name](a);
      return Number.isFinite(r) ? r : null;
    }
    default: return null;
  }
}

function evaluate(n, A, x) {
  const ev = (m) => evaluate(m, A, x);
  switch (n.k) {
    case 'num': return A.const(n.v);
    case 'x': return x;
    case 'neg': return A.neg(ev(n.a));
    case 'bin':
      return A[{ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' }[n.op]](ev(n.a), ev(n.b));
    case 'pow': {
      const base = ev(n.a);
      const p = constValue(n.b);
      if (p !== null) {
        if (Number.isInteger(p) && Math.abs(p) <= 4096) return powInt(A, base, p);
        return A.pow(base, p);
      }
      return A.exp(A.mul(ev(n.b), A.log(base)));
    }
    case 'fn': return callFn(A, n.name, ev(n.a));
    default: throw new Error(`Internal error: unknown node ${n.k}`);
  }
}

function powInt(A, base, p) {
  if (p === 0) return A.const(1);
  if (p < 0) return A.div(A.const(1), powInt(A, base, -p));
  let result = null;
  let b = base;
  let e = p;
  while (e > 0) {
    if (e & 1) result = result === null ? b : A.mul(result, b);
    e = Math.floor(e / 2);
    if (e > 0) b = A.mul(b, b);
  }
  return result;
}

function callFn(A, name, v) {
  const one = () => A.const(1);
  switch (name) {
    case 'sin': case 'cos': case 'tan': case 'sinh': case 'cosh': case 'tanh':
    case 'exp': case 'atan': case 'sqrt':
      return A[name](v);
    case 'ln': case 'log': return A.log(v);
    case 'abs':
      if (typeof A.abs !== 'function') {
        throw new Error(`abs() is not analytic and is only supported in the real algebra (not '${A.name || 'this algebra'}')`);
      }
      return A.abs(v);
    case 'sec': return A.div(one(), A.cos(v));
    case 'csc': return A.div(one(), A.sin(v));
    case 'cot': return A.div(A.cos(v), A.sin(v));
    case 'asin': // atan(v / sqrt(1 - v^2))
      return A.atan(A.div(v, A.sqrt(A.sub(one(), A.mul(v, v)))));
    case 'acos': // pi/2 - asin(v)
      return A.sub(A.const(Math.PI / 2), callFn(A, 'asin', v));
    case 'asinh': // ln(v + sqrt(v^2 + 1))
      return A.log(A.add(v, A.sqrt(A.add(A.mul(v, v), one()))));
    default: throw new Error(`Unknown function '${name}'`);
  }
}

/** Parse `str` once (throws on syntax errors) and return def(A, x). */
export function parseExpression(str) {
  if (typeof str !== 'string') throw new Error('Expression must be a string');
  const ast = parse(str);
  return (A, x) => evaluate(ast, A, x);
}
