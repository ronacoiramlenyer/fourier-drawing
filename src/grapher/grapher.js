(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const COLORS = ['#ff6b6b', '#5aa9ff', '#5fd38d', '#b48cff', '#ffa94d', '#4fd6c8', '#ff8fd1', '#d9dee8'];
const canvas = $('g-canvas');
const ctx = canvas.getContext('2d');
const stage = $('g-stage');
let W = 0, H = 0, DPR = 1;
const settings = { grid: true, numbers: true, deg: false, autoKP: true };
const isVisible = () => document.body.dataset.view === 'grapher';

// =====================================================================
// Parsing: text → tokens → syntax tree
// =====================================================================
class MathError extends Error {}
const FUNC_ALIASES = { arcsin: 'asin', arccos: 'acos', arctan: 'atan' };
const FUNC_LIST = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'sqrt', 'cbrt', 'abs', 'ln', 'log', 'exp', 'floor', 'ceil', 'round', 'sign', 'min', 'max', 'mod', 'sum'];
const FUNC_SET = new Set(FUNC_LIST);
const WORDS = FUNC_LIST.concat(Object.keys(FUNC_ALIASES), ['pi', 'theta', 'tau']).sort((a, b) => b.length - a.length);
const ARITY = { min: [1, 50], max: [1, 50], mod: [2, 2] };
const BUILTIN_CONSTS = { e: Math.E, pi: Math.PI, tau: 2 * Math.PI };
const GRAPH_VARS = new Set(['x', 'y', 't', 'θ', 'r']);

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Catches misspelled function names such as “sni(x)” before they turn into s·n·i.
function checkWords(src) {
  for (const m of src.matchAll(/[A-Za-z]{3,}(?=\s*\()/g)) {
    const w = m[0];
    if (WORDS.includes(w) || WORDS.some(k => w.endsWith(k))) continue;
    const best = FUNC_LIST.map(f => [f, editDistance(w, f)]).sort((p, q) => p[1] - q[1])[0];
    if (best && best[1] <= 2) throw new MathError(`“${w}” isn’t a function I know. Did you mean ${best[0]}?`);
  }
}
function tokenize(src) {
  checkWords(src);
  if (/[<>≤≥]/.test(src)) throw new MathError('Inequalities (<, >) are not supported yet. Use “=”.');
  src = src.replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/³/g, '^3');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new MathError('A lone “.” is not a number.');
      out.push({ t: 'num', v: parseFloat(m[1]), s: m[1] });
      i += m[1].length;
      continue;
    }
    if (ch === 'π') { out.push({ t: 'id', v: 'pi' }); i++; continue; }
    if (ch === 'θ') { out.push({ t: 'id', v: 'θ' }); i++; continue; }
    if (ch === 'τ') { out.push({ t: 'id', v: 'tau' }); i++; continue; }
    if (/[A-Za-z]/.test(ch)) {
      const w = WORDS.find(w => src.startsWith(w, i));
      if (w) { out.push({ t: 'id', v: w === 'theta' ? 'θ' : (FUNC_ALIASES[w] || w) }); i += w.length; continue; }
      let name = ch; i++;
      const sub = /^_([A-Za-z0-9]+)/.exec(src.slice(i));
      if (sub) { name += '_' + sub[1]; i += sub[0].length; }
      out.push({ t: 'id', v: name });
      continue;
    }
    if ('+-*/^(),=|[]{}'.includes(ch)) {
      const v = (ch === '[' || ch === '{') ? '(' : (ch === ']' || ch === '}') ? ')' : ch;
      out.push({ t: 'op', v });
      i++;
      continue;
    }
    throw new MathError(`The symbol “${ch}” isn’t something I can read.`);
  }
  return out;
}

function parseTokens(toks, userFns) {
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const show = (t) => t ? (t.t === 'num' ? t.s : t.v) : 'the end';
  const startsOperand = (t) => t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '('));
  function missing() {
    const prev = toks[i - 1], t = peek();
    if (!t) throw new MathError(prev ? `Something is missing after “${show(prev)}”.` : 'Type an expression.');
    if (t.t === 'op' && t.v === ')') throw new MathError('There is an extra “)” or an empty pair of brackets.');
    throw new MathError(`“${show(t)}” can’t go here.`);
  }
  const expr = () => sum();
  function sum() {
    let a = product();
    while (isOp('+') || isOp('-')) { const op = toks[i++].v; a = { type: 'bin', op, a, b: product() }; }
    return a;
  }
  function product() {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) { const op = toks[i++].v; a = { type: 'bin', op, a, b: unary() }; }
      else if (startsOperand(peek())) a = { type: 'bin', op: '*', a, b: power(), implicit: true };
      else return a;
    }
  }
  function unary() {
    if (isOp('-')) { i++; return { type: 'neg', a: unary() }; }
    if (isOp('+')) { i++; return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp('^')) { i++; return { type: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function argList() {
    i++; // (
    const list = [expr()];
    while (isOp(',')) { i++; list.push(expr()); }
    if (!isOp(')')) throw new MathError('A “(” is never closed.');
    i++;
    return list;
  }
  function sumNode() {
    const form = 'Write a sum as sum(k, 1, n, expression).';
    if (!isOp('(')) throw new MathError(form);
    i++;
    const v = peek();
    if (!v || v.t !== 'id' || FUNC_SET.has(v.v)) throw new MathError('The first input of sum is the counting letter, as in sum(k, 1, n, k^2).');
    i++;
    const comma = () => { if (!isOp(',')) throw new MathError(form); i++; };
    comma(); const from = expr();
    comma(); const to = expr();
    comma(); const body = expr();
    if (!isOp(')')) throw new MathError('A “(” is never closed.');
    i++;
    return { type: 'sum', v: v.v, from, to, body };
  }
  function primary() {
    const t = peek();
    if (!t) missing();
    if (t.t === 'num') { i++; return { type: 'num', v: t.v, s: t.s }; }
    if (t.t === 'op' && t.v === '(') {
      i++;
      const a = expr();
      if (isOp(',')) {
        i++;
        const b = expr();
        if (!isOp(')')) throw new MathError('A point needs a closing “)”, like (2, 3).');
        i++;
        return { type: 'point', a, b };
      }
      if (!isOp(')')) throw new MathError('A “(” is never closed.');
      i++;
      return { type: 'group', a };
    }
    if (t.t === 'op' && t.v === '|') {
      i++;
      const a = expr();
      if (!isOp('|')) throw new MathError('An absolute value “|” is never closed.');
      i++;
      return { type: 'call', name: 'abs', args: [a] };
    }
    if (t.t === 'id') {
      i++;
      const name = t.v;
      if (FUNC_SET.has(name)) {
        if (name === 'sum') return sumNode();
        let exp = null;
        if (isOp('^')) { i++; exp = unary(); } // sin^2(x)
        let list;
        if (isOp('(')) list = argList();
        else {
          if (!startsOperand(peek())) throw new MathError(`${name} needs an input, like ${name}(x).`);
          let a = power();
          while (startsOperand(peek()) && !(peek().t === 'id' && FUNC_SET.has(peek().v))) a = { type: 'bin', op: '*', a, b: power(), implicit: true };
          list = [a];
        }
        const [lo, hi] = ARITY[name] || [1, 1];
        if (list.length < lo || list.length > hi) throw new MathError(lo === hi ? `${name} takes ${lo} input${lo > 1 ? 's' : ''}.` : `${name} needs at least ${lo} input.`);
        const node = { type: 'call', name, args: list };
        return exp ? { type: 'bin', op: '^', a: node, b: exp } : node;
      }
      if (userFns.has(name) && isOp('(')) {
        const list = argList();
        if (list.length !== 1) throw new MathError(`${name} takes one input.`);
        return { type: 'ucall', name, arg: list[0] };
      }
      return { type: 'var', name };
    }
    missing();
  }
  const node = expr();
  if (i < toks.length) {
    const t = toks[i];
    if (t.t === 'op' && t.v === ')') throw new MathError('There is an extra “)”.');
    if (t.t === 'op' && t.v === ',') throw new MathError('A comma only belongs inside brackets, like (2, 3).');
    throw new MathError(`“${show(t)}” can’t go here.`);
  }
  return node;
}

function freeVars(n, bound = new Set(), out = new Set()) {
  switch (n.type) {
    case 'var': if (!bound.has(n.name)) out.add(n.name); break;
    case 'bin': freeVars(n.a, bound, out); freeVars(n.b, bound, out); break;
    case 'neg': case 'group': freeVars(n.a, bound, out); break;
    case 'call': n.args.forEach(a => freeVars(a, bound, out)); break;
    case 'ucall': freeVars(n.arg, bound, out); break;
    case 'point': freeVars(n.a, bound, out); freeVars(n.b, bound, out); break;
    case 'sum': {
      freeVars(n.from, bound, out); freeVars(n.to, bound, out);
      const b2 = new Set(bound); b2.add(n.v);
      freeVars(n.body, b2, out);
      break;
    }
  }
  return out;
}
function containsPoint(n) {
  if (!n || typeof n !== 'object') return false;
  if (n.type === 'point') return true;
  return ['a', 'b', 'arg', 'from', 'to', 'body'].some(k => containsPoint(n[k])) || (n.args || []).some(containsPoint);
}

// =====================================================================
// Evaluation: syntax tree → fast JavaScript closures
// =====================================================================
const toRad = (a) => settings.deg ? a * Math.PI / 180 : a;
const fromRad = (a) => settings.deg ? a * 180 / Math.PI : a;
const BUILTINS = {
  sin: a => Math.sin(toRad(a)), cos: a => Math.cos(toRad(a)), tan: a => Math.tan(toRad(a)),
  sec: a => 1 / Math.cos(toRad(a)), csc: a => 1 / Math.sin(toRad(a)), cot: a => 1 / Math.tan(toRad(a)),
  asin: a => fromRad(Math.asin(a)), acos: a => fromRad(Math.acos(a)), atan: a => fromRad(Math.atan(a)),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max, mod: (a, b) => ((a % b) + b) % b,
};
// Real powers: (−8)^(1/3) = −2, as on paper.
function powReal(a, b) {
  if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
  for (let q = 3; q <= 15; q += 2) {
    const p = b * q;
    if (Math.abs(p - Math.round(p)) < 1e-9) { const r = Math.pow(-a, b); return Math.round(p) % 2 === 0 ? r : -r; }
  }
  return NaN;
}

let CONSTS = Object.create(null);  // slider and constant values, plus e and π
let USER = Object.create(null);    // user-defined functions: name → { param, body }
let callDepth = 0;
function callUser(name, x) {
  const def = USER[name];
  if (!def || callDepth > 40) return NaN;
  callDepth++;
  const e = Object.create(CONSTS);
  e[def.param] = x;
  const v = def.body(e);
  callDepth--;
  return v;
}
function compile(n) {
  switch (n.type) {
    case 'num': { const v = n.v; return () => v; }
    case 'group': return compile(n.a);
    case 'var': { const k = n.name; return (e) => { const v = e[k]; return v === undefined ? NaN : v; }; }
    case 'neg': { const a = compile(n.a); return (e) => -a(e); }
    case 'bin': {
      const a = compile(n.a), b = compile(n.b);
      switch (n.op) {
        case '+': return (e) => a(e) + b(e);
        case '-': return (e) => a(e) - b(e);
        case '*': return (e) => a(e) * b(e);
        case '/': return (e) => a(e) / b(e);
        default: return (e) => powReal(a(e), b(e));
      }
    }
    case 'call': {
      const f = BUILTINS[n.name], args = n.args.map(compile);
      if (args.length === 1) { const a = args[0]; return (e) => f(a(e)); }
      if (args.length === 2) { const [a, b] = args; return (e) => f(a(e), b(e)); }
      return (e) => f(...args.map(g => g(e)));
    }
    case 'ucall': { const a = compile(n.arg), nm = n.name; return (e) => callUser(nm, a(e)); }
    case 'sum': {
      const from = compile(n.from), to = compile(n.to), body = compile(n.body), v = n.v;
      return (e) => {
        const lo = Math.round(from(e)), hi = Math.round(to(e));
        if (!isFinite(lo) || !isFinite(hi) || hi - lo > 5000) return NaN;
        const e2 = Object.create(e);
        let s = 0;
        for (let k = lo; k <= hi; k++) { e2[v] = k; s += body(e2); }
        return s;
      };
    }
    case 'point': throw new MathError('A point like (a, b) has to stand on its own, not inside a calculation.');
  }
  throw new MathError('I could not understand this expression.');
}
function fn1(node, v) {
  const f = compile(node);
  const env = Object.create(CONSTS);
  return (x) => { env[v] = x; return f(env); };
}
function fn2(node) {
  const f = compile(node);
  const env = Object.create(CONSTS);
  return (x, y) => { env.x = x; env.y = y; return f(env); };
}

// =====================================================================
// Pretty printing: syntax tree → readable math (HTML)
// =====================================================================
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
const prec = (n) => n.type === 'bin' ? PREC[n.op] : n.type === 'neg' ? 3 : 5;
const strip = (n) => n.type === 'group' ? n.a : n;
function varHTML(name) {
  if (name === 'pi') return 'π';
  if (name === 'tau') return 'τ';
  const [base, sub] = name.split('_');
  return `<i>${base}</i>${sub ? `<sub>${sub}</sub>` : ''}`;
}
function wrap(n, p) { return prec(n) < p ? `(${html(n)})` : html(n); }
function html(n) {
  switch (n.type) {
    case 'num': return n.s;
    case 'var': return varHTML(n.name);
    case 'group': return `(${html(n.a)})`;
    case 'neg': return `−${wrap(n.a, 3)}`;
    case 'bin':
      if (n.op === '/') return `<span class="frac"><span>${html(strip(n.a))}</span><span>${html(strip(n.b))}</span></span>`;
      if (n.op === '^') return `${wrap(n.a, 5)}<sup>${html(strip(n.b))}</sup>`;
      if (n.op === '*') {
        const l = wrap(n.a, 2), r = wrap(n.b, 2);
        return (n.implicit && n.b.type !== 'num') ? `${l}${r}` : `${l}·${r}`;
      }
      return `${wrap(n.a, 1)} ${n.op === '-' ? '−' : '+'} ${wrap(n.b, n.op === '-' ? 2 : 1)}`;
    case 'call':
      if (n.name === 'sqrt') return `√<span class="rad">${html(n.args[0])}</span>`;
      if (n.name === 'abs') return `|${html(n.args[0])}|`;
      return `<span class="fn">${n.name}</span>(${n.args.map(html).join(', ')})`;
    case 'ucall': return `<i>${n.name}</i>(${html(n.arg)})`;
    case 'sum': return `<span class="big">Σ</span><sub>${varHTML(n.v)}=${html(n.from)}</sub><sup>${html(n.to)}</sup> ${wrap(n.body, 2)}`;
    case 'point': return `(${html(n.a)}, ${html(n.b)})`;
  }
  return '';
}

// =====================================================================
// Expressions
// =====================================================================
let rows = [];
let nextId = 1;
let selectedId = null;
const usedColors = () => new Set(rows.map(r => r.color));
function newRow(text = '', opts = {}) {
  const used = usedColors();
  const color = opts.color || COLORS.find(c => !used.has(c)) || COLORS[rows.length % COLORS.length];
  return { id: nextId++, text, color, hidden: !!opts.hidden, slider: opts.slider ? { min: opts.slider[0], max: opts.slider[1], step: opts.slider[2] } : null, range: null, playing: false, dir: 1, a: null };
}

function fmt(v, d = 4) {
  if (!isFinite(v)) return 'undefined';
  if (Math.abs(v) < 1e-10) return '0';
  if (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4) return v.toExponential(2).replace('-', '−');
  return Number(v.toFixed(d)).toString().replace('-', '−');
}
const fmtPt = (x, y) => `(${fmt(x, 3)}, ${fmt(y, 3)})`;

// Splits tokens on "=" outside brackets.
function splitEquals(toks) {
  const parts = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'op' && t.v === '(') depth++;
    if (t.t === 'op' && t.v === ')') depth--;
    if (t.t === 'op' && t.v === '=' && depth === 0) parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  return parts;
}
const isId = (t, v) => t && t.t === 'id' && (v === undefined || t.v === v);
const isOpTok = (t, v) => t && t.t === 'op' && t.v === v;
const definableName = (n) => !GRAPH_VARS.has(n) && !(n in BUILTIN_CONSTS) && !FUNC_SET.has(n);

function analyzeAll() {
  CONSTS = Object.create(null);
  Object.assign(CONSTS, BUILTIN_CONSTS);
  USER = Object.create(null);
  const userFns = new Set();
  const tokenized = rows.map(r => {
    try { return { toks: tokenize(r.text) }; } catch (err) { return { err }; }
  });
  // Pass 1: find function definitions like f(x) = …
  tokenized.forEach((tk) => {
    if (!tk.toks) return;
    const p = splitEquals(tk.toks);
    if (p.length === 2 && p[0].length === 4 && isId(p[0][0]) && /^[a-z]$/i.test(p[0][0].v) && definableName(p[0][0].v) &&
        isOpTok(p[0][1], '(') && isId(p[0][2]) && isOpTok(p[0][3], ')')) userFns.add(p[0][0].v);
  });
  // Pass 2: parse and classify every row
  const defined = new Map(); // constant name → row
  const constDefs = [];
  rows.forEach((row, idx) => {
    const tk = tokenized[idx];
    const a = { kind: 'empty', error: null, needs: [], pretty: '', note: '' };
    row.a = a;
    if (!row.text.trim()) return;
    if (tk.err) { a.kind = 'error'; a.error = tk.err.message; return; }
    try {
      const parts = splitEquals(tk.toks);
      if (parts.length > 2) throw new MathError('Use only one “=” in each row.');
      if (parts.length === 2) {
        const [L, R] = parts;
        if (!L.length) throw new MathError('Something is missing before “=”.');
        if (!R.length) throw new MathError('Something is missing after “=”.');
        // f(x) = …
        if (L.length === 4 && isId(L[0]) && userFns.has(L[0].v) && isOpTok(L[1], '(') && isId(L[2])) {
          const param = L[2].v;
          const body = parseTokens(R, userFns);
          if (containsPoint(body)) throw new MathError('A function’s value has to be a number, not a point.');
          a.kind = 'fdef'; a.name = L[0].v; a.param = param; a.body = body;
          a.pretty = `<i>${a.name}</i>(${varHTML(param)}) = ${html(body)}`;
          if (USER[a.name]) throw new MathError(`${a.name} is defined twice.`);
          USER[a.name] = { param, body: compile(body) };
          a.free = [...freeVars(body, new Set([param]))];
          return;
        }
        const rhs = parseTokens(R, userFns);
        if (containsPoint(rhs)) throw new MathError('A point can’t be on one side of an “=”.');
        // y = …, x = …, r = …
        if (L.length === 1 && isId(L[0])) {
          const name = L[0].v;
          const fv = freeVars(rhs);
          if (name === 'y' && !fv.has('y')) { Object.assign(a, { kind: 'yfx', rhs, pretty: `<i>y</i> = ${html(rhs)}`, free: [...fv].filter(v => v !== 'x') }); return; }
          if (name === 'x' && !fv.has('x')) { Object.assign(a, { kind: 'xfy', rhs, pretty: `<i>x</i> = ${html(rhs)}`, free: [...fv].filter(v => v !== 'y') }); return; }
          if (name === 'r' && !fv.has('x') && !fv.has('y')) { Object.assign(a, { kind: 'polar', rhs, pretty: `<i>r</i> = ${html(rhs)}`, free: [...fv].filter(v => v !== 'θ') }); return; }
          if (definableName(name)) {
            if (fv.has('x') || fv.has('y') || fv.has('t') || fv.has('θ')) {
              throw new MathError(`${name} is a number, so it can’t depend on ${['x', 'y', 't', 'θ'].find(v => fv.has(v))}. To graph a formula, start the row with y =.`);
            }
            if (defined.has(name)) throw new MathError(`${name} is already defined in another row.`);
            defined.set(name, row);
            const literal = rhs.type === 'num' || (rhs.type === 'neg' && rhs.a.type === 'num');
            Object.assign(a, { kind: literal ? 'slider' : 'const', name, rhs, pretty: `${varHTML(name)} = ${html(rhs)}`, free: [...fv] });
            constDefs.push(row);
            return;
          }
        }
        // Any other equation in x and y
        const lhs = parseTokens(L, userFns);
        if (containsPoint(lhs)) throw new MathError('A point can’t be on one side of an “=”.');
        const fv = new Set([...freeVars(lhs), ...freeVars(rhs)]);
        if (!fv.has('x') && !fv.has('y')) throw new MathError('This equation has no x or y, so there is nothing to graph. To make a slider, use a single letter on the left, like a = 2.');
        Object.assign(a, { kind: 'implicit', lhs, rhs, pretty: `${html(lhs)} = ${html(rhs)}`, free: [...fv].filter(v => v !== 'x' && v !== 'y') });
        return;
      }
      // No "=": a point, a parametric curve, a graph of x, or a calculation
      const node = parseTokens(parts[0], userFns);
      const fv = freeVars(node);
      if (node.type === 'point') {
        if (containsPoint(node.a) || containsPoint(node.b)) throw new MathError('Points can’t be nested inside points.');
        if (fv.has('x') || fv.has('y')) throw new MathError('A point’s coordinates must be numbers. For a moving point use t, as in (cos(t), sin(t)).');
        if (fv.has('t')) { Object.assign(a, { kind: 'param', node, pretty: html(node), free: [...fv].filter(v => v !== 't') }); return; }
        Object.assign(a, { kind: 'point', node, pretty: html(node), free: [...fv] });
        return;
      }
      if (containsPoint(node)) throw new MathError('A point like (a, b) has to stand on its own.');
      if (fv.has('y') && !fv.has('x')) throw new MathError('To graph in terms of y, write x = … at the start.');
      if (fv.has('y')) throw new MathError('This uses both x and y. Write it as an equation, like x^2 + y^2 = 9.');
      if (fv.has('θ')) throw new MathError('For a polar graph, start the row with r =, as in r = cos(3θ).');
      if (fv.has('x')) { Object.assign(a, { kind: 'yfx', rhs: node, implied: true, pretty: `<i>y</i> = ${html(node)}`, free: [...fv].filter(v => v !== 'x') }); return; }
      Object.assign(a, { kind: 'value', node, pretty: html(node), free: [...fv] });
    } catch (err) {
      if (!(err instanceof MathError)) console.error(err);
      a.kind = 'error';
      a.error = err instanceof MathError ? err.message : 'I could not understand this expression.';
    }
  });

  // Resolve constants in dependency order
  let pending = constDefs.slice();
  for (let pass = 0; pass < constDefs.length + 1 && pending.length; pass++) {
    const still = [];
    for (const row of pending) {
      const a = row.a;
      if (a.free.every(v => v in CONSTS)) {
        try { a.value = compile(a.rhs)(Object.create(CONSTS)); CONSTS[a.name] = a.value; }
        catch (err) { a.kind = 'error'; a.error = err.message; }
      } else still.push(row);
    }
    pending = still;
  }
  for (const row of pending) {
    const a = row.a;
    const miss = a.free.filter(v => !(v in CONSTS) && !defined.has(v));
    if (miss.length) a.needs = miss;
    else { a.kind = 'error'; a.error = 'These constants depend on each other in a circle.'; }
  }

  // Compile graphs and check for undefined letters
  for (const row of rows) {
    const a = row.a;
    if (!a || a.kind === 'error' || a.kind === 'empty' || a.kind === 'slider' || a.kind === 'const') continue;
    const bound = a.kind === 'fdef' ? [] : [];
    const miss = (a.free || []).filter(v => !(v in CONSTS) && !bound.includes(v) && !(a.kind === 'fdef' && v === a.param));
    if (miss.length) { a.needs = miss; continue; }
    try {
      if (a.kind === 'yfx') a.f = fn1(a.rhs, 'x');
      else if (a.kind === 'fdef' && a.param === 'x') a.f = fn1(a.body, 'x');
      else if (a.kind === 'xfy') a.f = fn1(a.rhs, 'y');
      else if (a.kind === 'polar') a.f = fn1(a.rhs, 'θ');
      else if (a.kind === 'param') { a.fx = fn1(a.node.a, 't'); a.fy = fn1(a.node.b, 't'); }
      else if (a.kind === 'implicit') { const L = fn2(a.lhs), R = fn2(a.rhs); a.F = (x, y) => L(x, y) - R(x, y); }
      else if (a.kind === 'point') { const e = Object.create(CONSTS); a.px = compile(a.node.a)(e); a.py = compile(a.node.b)(e); }
      else if (a.kind === 'value') a.value = compile(a.node)(Object.create(CONSTS));
      if (a.kind === 'param' || a.kind === 'polar') {
        const rg = rangeOf(row);
        a.tmin = rg.min; a.tmax = rg.max;
      }
    } catch (err) { a.kind = 'error'; a.error = err.message; }
  }
  for (const row of rows) row.a.note = describe(row);
}
function rangeOf(row) {
  const defMax = settings.deg ? '360' : '2π';
  const r = row.range || { min: '0', max: defMax };
  const ev = (s, fallback) => {
    try { const v = compile(parseTokens(tokenize(s), new Set()))(Object.create(CONSTS)); return isFinite(v) ? v : fallback; } catch { return fallback; }
  };
  return { min: ev(r.min, 0), max: ev(r.max, settings.deg ? 360 : 2 * Math.PI), minText: r.min, maxText: r.max };
}

// =====================================================================
// Plain-language descriptions
// =====================================================================
function classify(f) {
  const xs = [-3, -2, -1.3, -1, -0.5, 0, 0.5, 1, 1.7, 2, 3];
  const ys = xs.map(f);
  if (ys.some(v => !isFinite(v))) return { type: 'gaps' };
  const scale = 1 + Math.max(...ys.map(Math.abs));
  const tol = 1e-7 * scale;
  const y0 = f(0), y1 = f(1), ym = f(-1);
  const m = (y1 - ym) / 2;
  if (xs.every((x, i) => Math.abs(ys[i] - (m * x + y0)) < tol)) return Math.abs(m) < tol ? { type: 'const', c: y0 } : { type: 'line', m, b: y0 };
  const A = (y1 + ym - 2 * y0) / 2;
  if (xs.every((x, i) => Math.abs(ys[i] - (A * x * x + m * x + y0)) < tol)) {
    const h = -m / (2 * A);
    return { type: 'parabola', A, h, k: f(h), c: y0 };
  }
  const out = { type: 'curve' };
  if (xs.every((x) => Math.abs(f(-x) - f(x)) < tol)) out.even = true;
  else if (xs.every((x) => Math.abs(f(-x) + f(x)) < tol)) out.odd = true;
  const full = settings.deg ? 360 : 2 * Math.PI;
  for (let k = 8; k >= 1; k--) {
    const P = full / k;
    if (xs.every((x) => Math.abs(f(x + P) - f(x)) < 1e-6 * scale) && xs.some(x => Math.abs(f(x + P / 2) - f(x)) > 1e-6 * scale)) { out.period = P; break; }
  }
  return out;
}
const piText = (P) => {
  if (settings.deg) return `${fmt(P, 2)}°`;
  const k = P / Math.PI;
  const r = Math.round(k * 4) / 4;
  if (Math.abs(k - r) < 1e-9) return r === 1 ? 'π' : r === 2 ? '2π' : `${fmt(r, 2)}π`;
  return fmt(P, 3);
};
function describe(row) {
  const a = row.a;
  if (a.kind === 'empty') return '';
  if (a.kind === 'error') return a.error;
  if (a.needs && a.needs.length) return '';
  switch (a.kind) {
    case 'slider': return `Slider: drag it, or press play. Every graph that uses ${a.name} updates.`;
    case 'const': return `${a.name} = ${fmt(a.value)}. Other rows can use ${a.name}.`;
    case 'value': return `= ${fmt(a.value, 8)}`;
    case 'point': {
      if (!isFinite(a.px) || !isFinite(a.py)) return 'This point is undefined for the current values.';
      const q = a.px > 0 && a.py > 0 ? ' in quadrant I (top right)' : a.px < 0 && a.py > 0 ? ' in quadrant II (top left)' : a.px < 0 && a.py < 0 ? ' in quadrant III (bottom left)' : a.px > 0 && a.py < 0 ? ' in quadrant IV (bottom right)' : ' on an axis';
      const drag = dragAxes(row);
      return `Point at ${fmtPt(a.px, a.py)}${q}.${drag && (drag.xs || drag.ys) ? ' Drag it on the graph.' : ''}`;
    }
    case 'param': return `Parametric curve: as t runs from ${fmt(a.tmin, 3)} to ${fmt(a.tmax, 3)}, the point (x(t), y(t)) traces this path.`;
    case 'polar': return `Polar curve: r is the distance from the origin at each angle θ, for θ from ${fmt(a.tmin, 3)} to ${fmt(a.tmax, 3)}.`;
    case 'implicit': return 'Equation in x and y: the curve is every point where both sides are equal.';
    case 'xfy': {
      const c = classify(a.f);
      if (c.type === 'const') return `Vertical line: every point has x = ${fmt(c.c)}.`;
      return 'Sideways graph: for each height y, the formula gives how far right the point is.';
    }
    case 'fdef':
      if (a.param !== 'x') return `Defines ${a.name}(${a.param}). Use it in other rows, for example y = ${a.name}(x).`;
      // fall through to describe the graph
    case 'yfx': {
      const c = classify(a.f);
      const pre = a.kind === 'fdef' ? `Defines ${a.name}, which you can reuse, as in y = ${a.name}(x − 2). ` : '';
      if (c.type === 'const') return pre + `Horizontal line at height ${fmt(c.c)}: y is the same for every x.`;
      if (c.type === 'line') return pre + `Straight line. Slope ${fmt(c.m, 3)}: it ${c.m > 0 ? 'rises' : 'falls'} ${fmt(Math.abs(c.m), 3)} for every 1 step to the right. Crosses the y-axis at (0, ${fmt(c.b, 3)}).`;
      if (c.type === 'parabola') return pre + `Parabola opening ${c.A > 0 ? 'upward' : 'downward'}. Its ${c.A > 0 ? 'lowest' : 'highest'} point (vertex) is ${fmtPt(c.h, c.k)}. Crosses the y-axis at (0, ${fmt(c.c, 3)}).`;
      const bits = [];
      if (c.type === 'gaps') bits.push('Curve that is not defined everywhere: it has gaps or stops at some x values');
      else bits.push('Curve');
      if (c.even) bits.push('mirror-symmetric across the y-axis');
      if (c.odd) bits.push('symmetric through the origin');
      if (c.period) bits.push(`repeats every ${piText(c.period)}`);
      return pre + bits.join(', ') + '. Click it to see its key points.';
    }
  }
  return '';
}

// =====================================================================
// View
// =====================================================================
const V = { cx: 0, cy: 0, scale: 40, ready: false };
let homeRange = { x0: -10, x1: 10, cy: 0 };
function setRange(r) {
  homeRange = r;
  if (!W) { V.ready = false; return; }
  V.scale = W / (r.x1 - r.x0);
  const hRange = H / V.scale;
  if (r.y0 !== undefined && r.y1 !== undefined && (r.y1 - r.y0) > hRange) V.scale = H / (r.y1 - r.y0);
  V.cx = (r.x0 + r.x1) / 2;
  V.cy = r.cy !== undefined ? r.cy : (r.y0 !== undefined ? (r.y0 + r.y1) / 2 : 0);
  V.ready = true;
  dirty = true;
}
const sx = (x) => W / 2 + (x - V.cx) * V.scale;
const sy = (y) => H / 2 - (y - V.cy) * V.scale;
const wx = (px) => V.cx + (px - W / 2) / V.scale;
const wy = (py) => V.cy - (py - H / 2) / V.scale;
function zoomAt(f, px = W / 2, py = H / 2) {
  const x = wx(px), y = wy(py);
  V.scale = Math.min(1e7, Math.max(1e-4, V.scale * f));
  V.cx = x - (px - W / 2) / V.scale;
  V.cy = y + (py - H / 2) / V.scale;
  dirty = true;
}

function resize() {
  const r = stage.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  const firstTime = !W;
  W = r.width; H = r.height;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  if (firstTime || !V.ready) setRange(homeRange);
  dirty = true;
}
new ResizeObserver(resize).observe(stage);

// =====================================================================
// Drawing
// =====================================================================
let dirty = true;
let curves = [];        // { row, pts: [x, y, …] in screen px } for hover
let keyPoints = [];     // for the selected graph
let hover = null;       // { kind: 'curve'|'kp', … }
let pinned = new Set(); // pinned key-point labels (by key)
let mouse = null;

function niceStep(minPx) {
  const raw = minPx / V.scale;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return { step: m * p, minor: m === 2 ? 4 : 5 };
  return { step: 10 * p, minor: 5 };
}
function tickLabel(v, step) {
  if (Math.abs(v) < step * 1e-6) return '0';
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4)) return v.toExponential(1).replace('-', '−');
  return v.toFixed(d).replace('-', '−');
}
function drawGrid() {
  const { step, minor } = niceStep(90);
  const ms = step / minor;
  const x0 = wx(0), x1 = wx(W), y0 = wy(H), y1 = wy(0);
  ctx.lineWidth = 1;
  if (settings.grid) {
    ctx.strokeStyle = 'rgba(140, 165, 215, 0.05)';
    ctx.beginPath();
    for (let x = Math.ceil(x0 / ms) * ms; x <= x1; x += ms) { const p = Math.round(sx(x)) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
    for (let y = Math.ceil(y0 / ms) * ms; y <= y1; y += ms) { const p = Math.round(sy(y)) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140, 165, 215, 0.13)';
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const p = Math.round(sx(x)) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const p = Math.round(sy(y)) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
  }
  // Axes
  const ax = Math.round(sx(0)) + 0.5, ay = Math.round(sy(0)) + 0.5;
  ctx.strokeStyle = 'rgba(214, 222, 240, 0.55)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  if (ax > 0 && ax < W) { ctx.moveTo(ax, 0); ctx.lineTo(ax, H); }
  if (ay > 0 && ay < H) { ctx.moveTo(0, ay); ctx.lineTo(W, ay); }
  ctx.stroke();
  if (!settings.numbers) return;
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(178, 188, 208, 0.85)';
  const labelY = Math.min(H - 6, Math.max(14, ay + 15));
  ctx.textAlign = 'center';
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    if (Math.abs(x) < step * 1e-6) continue;
    const p = sx(x);
    if (p < 14 || p > W - 14) continue;
    ctx.fillText(tickLabel(x, step), p, labelY);
  }
  ctx.textAlign = 'right';
  const labelX = Math.min(W - 6, Math.max(34, ax - 6));
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    if (Math.abs(y) < step * 1e-6) continue;
    const p = sy(y);
    if (p < 10 || p > H - 10) continue;
    ctx.fillText(tickLabel(y, step), labelX, p + 4);
  }
  if (ax > 0 && ax < W && ay > 0 && ay < H) ctx.fillText('0', ax - 6, ay + 15);
  ctx.textAlign = 'left';
  // Axis names
  ctx.font = 'italic 15px "STIX Two Text", Cambria, serif';
  ctx.fillStyle = 'rgba(214, 222, 240, 0.8)';
  if (ay > 0 && ay < H) ctx.fillText('x', W - 16, ay - 8);
  if (ax > 0 && ax < W) ctx.fillText('y', ax + 8, 16);
}

const clampS = (v) => Math.max(-1e5, Math.min(1e5, v));
function strokeSeq(pts, color, width) {
  // pts: flat array with NaN pairs as breaks
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x !== x) { pen = false; continue; }
    if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
  }
  ctx.stroke();
}
function sampleYfx(f) {
  const pts = [];
  let prev = null;
  for (let px = -2; px <= W + 2; px += 1) {
    const x = wx(px), y = f(x);
    if (!isFinite(y)) { if (prev) pts.push(NaN, NaN); prev = null; continue; }
    const p = sy(y);
    if (prev && Math.abs(p - prev.p) > H * 0.5) {
      const ym = f((x + prev.x) / 2);
      if (!(isFinite(ym) && ym >= Math.min(y, prev.y) - 1e-9 && ym <= Math.max(y, prev.y) + 1e-9)) pts.push(NaN, NaN);
    }
    pts.push(px, clampS(p));
    prev = { x, y, p };
  }
  return pts;
}
function sampleXfy(f) {
  const pts = [];
  let prev = null;
  for (let py = -2; py <= H + 2; py += 1) {
    const y = wy(py), x = f(y);
    if (!isFinite(x)) { if (prev) pts.push(NaN, NaN); prev = null; continue; }
    const p = sx(x);
    if (prev && Math.abs(p - prev.p) > W * 0.5) {
      const xm = f((y + prev.y) / 2);
      if (!(isFinite(xm) && xm >= Math.min(x, prev.x) - 1e-9 && xm <= Math.max(x, prev.x) + 1e-9)) pts.push(NaN, NaN);
    }
    pts.push(clampS(p), py);
    prev = { y, x, p };
  }
  return pts;
}
function sampleParam(fx, fy, t0, t1, N = 1600) {
  const pts = [];
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const t = t0 + (t1 - t0) * i / N;
    const x = fx(t), y = fy(t);
    if (!isFinite(x) || !isFinite(y)) { if (prev) pts.push(NaN, NaN); prev = null; continue; }
    const px = clampS(sx(x)), py = clampS(sy(y));
    if (prev && Math.hypot(px - prev[0], py - prev[1]) > Math.max(W, H)) pts.push(NaN, NaN);
    pts.push(px, py);
    prev = [px, py];
  }
  return pts;
}
function polarXY(f) {
  const k = settings.deg ? Math.PI / 180 : 1;
  return [(th) => f(th) * Math.cos(th * k), (th) => f(th) * Math.sin(th * k)];
}
// Marching squares on a coarse grid of screen cells.
function sampleImplicit(F) {
  const cs = 5;
  const nx = Math.ceil(W / cs) + 1, ny = Math.ceil(H / cs) + 1;
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) { const y = wy(j * cs); for (let i = 0; i < nx; i++) v[j * nx + i] = F(wx(i * cs), y); }
  const segs = [];
  const lerp = (a, b) => a / (a - b);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = v[j * nx + i], b = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) continue;
    const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const x = i * cs, y = j * cs;
    const top = [x + cs * lerp(a, b), y], right = [x + cs, y + cs * lerp(b, c)];
    const bottom = [x + cs * lerp(d, c), y + cs], left = [x, y + cs * lerp(a, d)];
    // Skip sign changes caused by a pole rather than a zero
    const big = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
    const mid = F(wx(x + cs / 2), wy(y + cs / 2));
    if (isFinite(mid) && Math.abs(mid) > big * 2) continue;
    const push = (p, q) => segs.push(p[0], p[1], q[0], q[1], NaN, NaN);
    switch (code) {
      case 1: case 14: push(left, top); break;
      case 2: case 13: push(top, right); break;
      case 3: case 12: push(left, right); break;
      case 4: case 11: push(right, bottom); break;
      case 6: case 9: push(top, bottom); break;
      case 7: case 8: push(left, bottom); break;
      case 5: case 10: {
        const centerPos = (mid > 0) === (code === 5);
        if (centerPos) { push(left, bottom); push(top, right); } else { push(left, top); push(right, bottom); }
        break;
      }
    }
  }
  return segs;
}

// ---------- Key points ----------
function bisect(g, a, b, ga) {
  for (let k = 0; k < 60; k++) {
    const m = (a + b) / 2, gm = g(m);
    if (!isFinite(gm)) return NaN;
    if ((gm > 0) === (ga > 0)) { a = m; ga = gm; } else b = m;
  }
  return (a + b) / 2;
}
function findRoots(g, x0, x1, N = 700) {
  const out = [];
  const dx = (x1 - x0) / N;
  let xa = x0, ga = g(xa);
  for (let i = 1; i <= N; i++) {
    const xb = x0 + i * dx, gb = g(xb);
    if (isFinite(ga) && isFinite(gb)) {
      if (ga === 0) out.push(xa);
      else if ((ga > 0) !== (gb > 0) && gb !== 0) {
        const r = bisect(g, xa, xb, ga);
        const gr = g(r);
        if (isFinite(r) && Math.abs(gr) < 1e-6 * (1 + Math.min(Math.abs(ga), Math.abs(gb)))) out.push(r);
      }
    }
    xa = xb; ga = gb;
  }
  return out;
}
function refineExtremum(f, a, c, isMax) {
  const s = isMax ? 1 : -1;
  const gr = (Math.sqrt(5) - 1) / 2;
  let x1 = c - gr * (c - a), x2 = a + gr * (c - a);
  let f1 = s * f(x1), f2 = s * f(x2);
  for (let k = 0; k < 80; k++) {
    if (f1 > f2) { c = x2; x2 = x1; f2 = f1; x1 = c - gr * (c - a); f1 = s * f(x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + gr * (c - a); f2 = s * f(x2); }
  }
  return (a + c) / 2;
}
function findExtrema(f, x0, x1, N = 700) {
  const out = [];
  const dx = (x1 - x0) / N;
  const ys = [];
  for (let i = 0; i <= N; i++) ys.push(f(x0 + i * dx));
  for (let i = 1; i < N; i++) {
    const a = ys[i - 1], b = ys[i], c = ys[i + 1];
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) continue;
    const isMax = b > a && b >= c, isMin = b < a && b <= c;
    if (!isMax && !isMin) continue;
    const xm = refineExtremum(f, x0 + (i - 1) * dx, x0 + (i + 1) * dx, isMax);
    const ym = f(xm), h = dx / 40;
    const yl = f(xm - h), yr = f(xm + h);
    if (!isFinite(ym) || !isFinite(yl) || !isFinite(yr)) continue;
    // A real turning point: smooth, strictly higher (or lower) than both neighbours, and not a pole
    const tol = 1e-3 * (1 + Math.abs(ym));
    if (Math.abs(yl - ym) > tol || Math.abs(yr - ym) > tol) continue;
    if (isMax ? !(ym > yl && ym > yr) : !(ym < yl && ym < yr)) continue;
    if (Math.abs(ym) > 4 * Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) + 1e-9) continue;
    out.push({ x: xm, y: ym, max: isMax });
  }
  return out;
}
function computeKeyPoints() {
  keyPoints = [];
  const row = rows.find(r => r.id === selectedId);
  if (!row || row.hidden || !settings.autoKP) return;
  const a = row.a;
  if (!a.f || !(a.kind === 'yfx' || (a.kind === 'fdef' && a.param === 'x'))) return;
  const f = a.f, x0 = wx(0), x1 = wx(W), y0 = wy(H), y1 = wy(0);
  const inView = (x, y) => y >= y0 - 1e-9 && y <= y1 + 1e-9 && x >= x0 && x <= x1;
  const list = [];
  const y0v = f(0);
  if (0 >= x0 && 0 <= x1 && isFinite(y0v)) list.push({ x: 0, y: y0v, type: 'yint', text: 'Crosses the y-axis' });
  for (const r of findRoots(f, x0, x1)) list.push({ x: r, y: 0, type: 'root', text: 'Crosses the x-axis (a root)' });
  for (const e of findExtrema(f, x0, x1)) list.push({ x: e.x, y: e.y, type: e.max ? 'max' : 'min', text: e.max ? 'Peak (local maximum)' : 'Valley (local minimum)' });
  for (const other of rows) {
    if (other === row || other.hidden || !other.a || !other.a.f) continue;
    if (!(other.a.kind === 'yfx' || (other.a.kind === 'fdef' && other.a.param === 'x'))) continue;
    const g = other.a.f;
    for (const r of findRoots((x) => f(x) - g(x), x0, x1)) list.push({ x: r, y: f(r), type: 'int', text: 'Meets', other, color: other.color });
  }
  const seen = [];
  for (const p of list) {
    if (!inView(p.x, p.y)) continue;
    const px = sx(p.x), py = sy(p.y);
    if (seen.some(q => q.type === p.type && Math.hypot(q.px - px, q.py - py) < 3)) continue;
    p.px = px; p.py = py; p.key = `${p.type}:${fmt(p.x, 3)}`;
    seen.push(p);
    if (seen.length >= 40) break;
  }
  keyPoints = seen;
}

function drawLabel(text, x, y, color) {
  ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
  const w = ctx.measureText(text).width + 12, h = 22;
  let lx = x + 10, ly = y - h - 8;
  if (lx + w > W - 4) lx = x - w - 10;
  if (ly < 4) ly = y + 10;
  ctx.fillStyle = 'rgba(21, 28, 41, 0.94)';
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(lx, ly, w, h, 6); else ctx.rect(lx, ly, w, h);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e3e8f2';
  ctx.fillText(text, lx + 6, ly + 15);
}
function dot(x, y, r, fill, stroke) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function render() {
  if (!W) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0b0f18';
  ctx.fillRect(0, 0, W, H);
  drawGrid();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  curves = [];
  const pointsToDraw = [];
  for (const row of rows) {
    const a = row.a;
    if (!a || row.hidden || (a.needs && a.needs.length)) continue;
    const width = row.id === selectedId ? 3.4 : 2.5;
    let pts = null;
    try {
      if ((a.kind === 'yfx' || (a.kind === 'fdef' && a.param === 'x')) && a.f) pts = sampleYfx(a.f);
      else if (a.kind === 'xfy' && a.f) pts = sampleXfy(a.f);
      else if (a.kind === 'param' && a.fx) pts = sampleParam(a.fx, a.fy, a.tmin, a.tmax);
      else if (a.kind === 'polar' && a.f) { const [fx, fy] = polarXY(a.f); pts = sampleParam(fx, fy, a.tmin, a.tmax, 2400); }
      else if (a.kind === 'implicit' && a.F) pts = sampleImplicit(a.F);
      else if (a.kind === 'point' && isFinite(a.px) && isFinite(a.py)) pointsToDraw.push(row);
    } catch (err) { console.error(err); }
    if (pts) {
      if (row.id === selectedId) strokeSeq(pts, row.color + '40', 9);
      strokeSeq(pts, row.color, width);
      curves.push({ row, pts });
    }
  }
  // Key points of the selected graph
  computeKeyPoints();
  for (const p of keyPoints) {
    dot(p.px, p.py, 5, '#c9d1e0', '#0b0f18');
  }
  // Points
  for (const row of pointsToDraw) {
    const a = row.a, px = sx(a.px), py = sy(a.py);
    const draggable = dragAxes(row);
    if (draggable && (draggable.xs || draggable.ys)) dot(px, py, 11, row.color + '33');
    dot(px, py, 6, row.color, '#0b0f18');
    ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = row.color;
    ctx.fillText(fmtPt(a.px, a.py), px + 10, py - 10);
  }
  // Labels: pinned key points, then hover
  for (const p of keyPoints) if (pinned.has(p.key)) drawLabel(`${fmtPt(p.x, p.y)}`, p.px, p.py, '#c9d1e0');
  if (hover && hover.kind === 'kp') {
    drawLabel(`${hover.p.text.replace(' (a root)', '')}: ${fmtPt(hover.p.x, hover.p.y)}`, hover.p.px, hover.p.py, '#c9d1e0');
  } else if (hover && hover.kind === 'curve') {
    dot(hover.px, hover.py, 5, hover.row.color, '#0b0f18');
    drawLabel(fmtPt(hover.x, hover.y), hover.px, hover.py, hover.row.color);
  }
}

// =====================================================================
// Expression list UI
// =====================================================================
const list = $('g-list');
function rowEl(id) { return list.querySelector(`[data-id="${id}"]`); }
function renderList(focusId) {
  list.innerHTML = '';
  rows.forEach((row, i) => {
    const el = document.createElement('div');
    el.className = 'g-row';
    el.dataset.id = row.id;
    el.style.setProperty('--c', row.color);
    el.innerHTML = `
      <button class="g-swatch" aria-pressed="${!row.hidden}" title="Show or hide this graph" aria-label="Show or hide row ${i + 1}"></button>
      <div class="g-body">
        <input class="g-input" id="g-in-${row.id}" value="" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Expression ${i + 1}" placeholder="Type an expression, like y = x^2">
        <div class="g-pretty"></div>
        <div class="g-note"></div>
        <div class="g-extra"></div>
      </div>
      <button class="icon-btn g-del" aria-label="Delete row ${i + 1}" title="Delete row">
        <svg viewBox="0 0 16 16" width="13" height="13"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>`;
    const input = el.querySelector('.g-input');
    input.value = row.text;
    input.addEventListener('input', () => { row.text = input.value; refresh(); });
    input.addEventListener('focus', () => select(row.id, false));
    input.addEventListener('keydown', (e) => {
      const idx = rows.indexOf(row);
      if (e.key === 'Enter') { e.preventDefault(); const r = newRow(''); rows.splice(idx + 1, 0, r); renderList(r.id); refresh(); }
      else if (e.key === 'Backspace' && input.value === '' && rows.length > 1) { e.preventDefault(); rows.splice(idx, 1); const prev = rows[Math.max(0, idx - 1)]; renderList(prev.id); refresh(); }
      else if (e.key === 'ArrowUp' && idx > 0) { e.preventDefault(); $('g-in-' + rows[idx - 1].id).focus(); }
      else if (e.key === 'ArrowDown' && idx < rows.length - 1) { e.preventDefault(); $('g-in-' + rows[idx + 1].id).focus(); }
    });
    el.querySelector('.g-swatch').addEventListener('click', () => { row.hidden = !row.hidden; refresh(); });
    el.querySelector('.g-del').addEventListener('click', () => {
      rows = rows.filter(r => r !== row);
      if (!rows.length) rows.push(newRow(''));
      if (selectedId === row.id) selectedId = null;
      renderList(); refresh();
    });
    list.appendChild(el);
  });
  if (focusId) { const inp = $('g-in-' + focusId); if (inp) inp.focus(); }
}
function sliderValueText(v, step) {
  const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  return Number(v.toFixed(d)).toString();
}
function setSliderValue(row, v, fromRange = false) {
  const s = row.slider;
  v = Math.round(v / s.step) * s.step;
  row.text = `${row.a.name} = ${sliderValueText(v, s.step)}`;
  const inp = $('g-in-' + row.id);
  if (inp) inp.value = row.text;
  if (!fromRange) { const rg = rowEl(row.id)?.querySelector('input[type=range]'); if (rg) rg.value = String(v); }
  refresh();
}
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z" fill="currentColor"/></svg>';
function renderExtras(row, el) {
  const a = row.a;
  const box = el.querySelector('.g-extra');
  let key = '';
  if (a.kind === 'slider') key = 'slider:' + a.name;
  else if (a.kind === 'param' || a.kind === 'polar') key = 'range:' + a.kind + ':' + settings.deg;
  if (box.dataset.key === key) {
    if (a.kind === 'slider') {
      const s = row.slider;
      const rg = box.querySelector('input[type=range]');
      if (document.activeElement !== rg) rg.value = String(a.value);
      box.querySelector('.g-play').innerHTML = row.playing ? PAUSE : PLAY;
      box.querySelector('[data-k=min]').value = String(s.min);
      box.querySelector('[data-k=max]').value = String(s.max);
    }
    return;
  }
  box.dataset.key = key;
  box.innerHTML = '';
  if (a.kind === 'slider') {
    if (!row.slider) {
      const v = a.value;
      const span = Math.max(10, Math.ceil(Math.abs(v) * 2));
      row.slider = { min: v >= 0 && Number.isInteger(v) && v <= 10 ? -10 : -span, max: v <= 10 ? 10 : span, step: Number.isInteger(v) ? 0.1 : 0.01 };
    }
    const s = row.slider;
    if (a.value < s.min) s.min = a.value;
    if (a.value > s.max) s.max = a.value;
    box.innerHTML = `<div class="g-slider">
      <button class="icon-btn g-play" aria-label="Play ${a.name}" title="Animate ${a.name}">${row.playing ? PAUSE : PLAY}</button>
      <input class="g-mini" data-k="min" value="${s.min}" aria-label="Lowest value of ${a.name}">
      <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${a.value}" aria-label="${a.name}">
      <input class="g-mini" data-k="max" value="${s.max}" aria-label="Highest value of ${a.name}"></div>`;
    const rg = box.querySelector('input[type=range]');
    rg.addEventListener('input', () => setSliderValue(row, Number(rg.value), true));
    box.querySelector('.g-play').addEventListener('click', () => { row.playing = !row.playing; refresh(); });
    box.querySelectorAll('.g-mini').forEach(inp => inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!isFinite(v)) { inp.value = String(s[inp.dataset.k]); return; }
      s[inp.dataset.k] = v;
      if (s.min >= s.max) { if (inp.dataset.k === 'min') s.max = s.min + 1; else s.min = s.max - 1; }
      rg.min = String(s.min); rg.max = String(s.max);
      box.dataset.key = ''; refresh();
    }));
  } else if (a.kind === 'param' || a.kind === 'polar') {
    const v = a.kind === 'param' ? 't' : 'θ';
    const rg = rangeOf(row);
    box.innerHTML = `<div class="g-range"><span><i>${v}</i> from</span><input class="g-mini" data-k="min" value="${rg.minText}" aria-label="${v} from"><span>to</span><input class="g-mini" data-k="max" value="${rg.maxText}" aria-label="${v} to"></div>`;
    box.querySelectorAll('.g-mini').forEach(inp => inp.addEventListener('input', () => {
      const cur = row.range || { min: rg.minText, max: rg.maxText };
      cur[inp.dataset.k] = inp.value;
      row.range = cur;
      refresh();
    }));
  }
}
function updateRowsUI() {
  rows.forEach((row) => {
    const el = rowEl(row.id);
    if (!el || !row.a) return;
    const a = row.a;
    el.classList.toggle('selected', row.id === selectedId);
    el.classList.toggle('is-error', a.kind === 'error');
    const sw = el.querySelector('.g-swatch');
    const graphable = !['slider', 'const', 'value', 'error', 'empty'].includes(a.kind) && !(a.kind === 'fdef' && a.param !== 'x');
    sw.classList.toggle('no-graph', !graphable);
    sw.setAttribute('aria-pressed', String(!row.hidden));
    sw.disabled = !graphable;
    el.querySelector('.g-pretty').innerHTML = a.kind === 'error' ? '' : a.pretty;
    const note = el.querySelector('.g-note');
    note.classList.toggle('err', a.kind === 'error');
    if (a.needs && a.needs.length) {
      const names = a.needs;
      const fnLike = names.find(n => new RegExp(`(^|[^A-Za-z])${n}\\s*\\(`).test(row.text));
      note.innerHTML = (fnLike ? `To use ${fnLike}(…) as a function, define it in another row, like ${fnLike}(x) = x^2. ` : '') +
        `${names.map(n => `<b>${n}</b>`).join(', ')} ${names.length > 1 ? 'are' : 'is'} not defined yet. A slider lets you choose ${names.length > 1 ? 'their values' : 'its value'}.<br>` +
        names.map(n => `<button class="btn" data-add="${n}">Add slider for ${n}</button>`).join('') +
        (names.length > 1 ? `<button class="btn" data-add="*">Add all</button>` : '');
      note.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
        const idx = rows.indexOf(row);
        const add = b.dataset.add === '*' ? names : [b.dataset.add];
        add.forEach((n, k) => rows.splice(idx + 1 + k, 0, newRow(`${n} = 1`)));
        renderList(); refresh();
      }));
    } else note.textContent = a.note || '';
    renderExtras(row, el);
  });
}
function renderInsights() {
  const box = $('g-insights');
  const row = rows.find(r => r.id === selectedId);
  const forEl = $('g-insight-for');
  forEl.textContent = '';
  if (!row || !row.a || !(row.a.kind === 'yfx' || (row.a.kind === 'fdef' && row.a.param === 'x')) || !row.a.f) {
    box.innerHTML = `<p class="note">${row && row.a && row.a.kind !== 'empty' && row.a.kind !== 'error'
      ? 'Key points are listed for graphs written as y = … .'
      : 'Click a graph, or a row that starts with y =, to list where it crosses the axes, its peaks and valleys, and where it meets other graphs.'}</p>`;
    return;
  }
  if (row.hidden) { box.innerHTML = '<p class="note">This graph is hidden. Click its colored dot to show it.</p>'; return; }
  if (!settings.autoKP) { box.innerHTML = '<p class="note">Key points are switched off in Settings.</p>'; return; }
  forEl.innerHTML = `for row ${rows.indexOf(row) + 1}`;
  if (!keyPoints.length) { box.innerHTML = '<p class="note">No key points in view. Zoom out to search a wider area.</p>'; return; }
  box.innerHTML = '';
  for (const p of keyPoints) {
    const b = document.createElement('button');
    b.className = 'g-kp';
    b.setAttribute('aria-pressed', String(pinned.has(p.key)));
    const label = p.type === 'int' ? `Meets row ${rows.indexOf(p.other) + 1}` : p.text;
    b.innerHTML = `<span>${label}</span><b>${fmtPt(p.x, p.y)}</b>`;
    b.addEventListener('click', () => { if (pinned.has(p.key)) pinned.delete(p.key); else pinned.add(p.key); dirty = true; insightsDirty = true; });
    box.appendChild(b);
  }
}
let insightsDirty = true;
function select(id, scroll = true) {
  if (selectedId === id) return;
  selectedId = id;
  pinned.clear();
  if (scroll && id) rowEl(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  updateRowsUI();
  dirty = true; insightsDirty = true;
}
function refresh() {
  analyzeAll();
  updateRowsUI();
  dirty = true; insightsDirty = true;
}

// =====================================================================
// Canvas interaction
// =====================================================================
function dragAxes(row) {
  const a = row.a;
  if (!a || a.kind !== 'point') return null;
  const sliderFor = (n) => {
    const m = strip(n);
    if (m.type !== 'var') return null;
    return rows.find(r => r.a && r.a.kind === 'slider' && r.a.name === m.name) || null;
  };
  return { xs: sliderFor(a.node.a), ys: sliderFor(a.node.b) };
}
function nearest(px, py) {
  // Key points first, then draggable points, then curves
  for (const p of keyPoints) if (Math.hypot(p.px - px, p.py - py) < 9) return { kind: 'kp', p };
  for (const row of rows) {
    const a = row.a;
    if (row.hidden || !a || a.kind !== 'point' || !isFinite(a.px)) continue;
    if (Math.hypot(sx(a.px) - px, sy(a.py) - py) < 12) return { kind: 'point', row };
  }
  let best = null, bd = 14;
  for (const c of curves) {
    const a = c.row.a;
    if ((a.kind === 'yfx' || (a.kind === 'fdef' && a.param === 'x')) && a.f) {
      const x = wx(px), y = a.f(x);
      if (isFinite(y)) { const d = Math.abs(sy(y) - py); if (d < bd) { bd = d; best = { kind: 'curve', row: c.row, x, y, px, py: sy(y) }; } }
      continue;
    }
    const p = c.pts;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] !== p[i]) continue;
      const d = Math.hypot(p[i] - px, p[i + 1] - py);
      if (d < bd) { bd = d; best = { kind: 'curve', row: c.row, x: wx(p[i]), y: wy(p[i + 1]), px: p[i], py: p[i + 1] }; }
    }
  }
  return best;
}
const pointers = new Map();
let gesture = null;
function local(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
canvas.addEventListener('pointerdown', (e) => {
  const [px, py] = local(e);
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [px, py]);
  if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    gesture = { type: 'pinch', d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), mid: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2] };
    return;
  }
  const hit = nearest(px, py);
  if (hit && hit.kind === 'point') {
    const ax = dragAxes(hit.row);
    if (ax && (ax.xs || ax.ys)) { gesture = { type: 'point', row: hit.row, ax }; canvas.classList.add('dragging-point'); select(hit.row.id); return; }
  }
  gesture = { type: 'pan', sx: px, sy: py, cx: V.cx, cy: V.cy, moved: false, hit };
  canvas.classList.add('panning');
});
canvas.addEventListener('pointermove', (e) => {
  const [px, py] = local(e);
  mouse = [px, py];
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [px, py]);
  if (gesture && gesture.type === 'pinch' && pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    if (gesture.d > 0) zoomAt(d / gesture.d, mid[0], mid[1]);
    V.cx -= (mid[0] - gesture.mid[0]) / V.scale;
    V.cy += (mid[1] - gesture.mid[1]) / V.scale;
    gesture.d = d; gesture.mid = mid;
    return;
  }
  if (gesture && gesture.type === 'point') {
    const { xs, ys } = gesture.ax;
    if (xs) setSliderValue(xs, wx(px));
    if (ys) setSliderValue(ys, wy(py));
    return;
  }
  if (gesture && gesture.type === 'pan') {
    if (Math.hypot(px - gesture.sx, py - gesture.sy) > 3) gesture.moved = true;
    if (gesture.moved) {
      V.cx = gesture.cx - (px - gesture.sx) / V.scale;
      V.cy = gesture.cy + (py - gesture.sy) / V.scale;
      hover = null; dirty = true; insightsDirty = true;
      return;
    }
  }
  const h = nearest(px, py);
  hover = h && (h.kind === 'curve' || h.kind === 'kp') ? h : null;
  canvas.classList.toggle('over-curve', !!(h && h.kind === 'curve'));
  canvas.classList.toggle('over-point', !!(h && (h.kind === 'kp' || h.kind === 'point')));
  $('g-readout').innerHTML = `x <b>${fmt(wx(px), 3)}</b> · y <b>${fmt(wy(py), 3)}</b>`;
  dirty = true;
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (gesture && gesture.type === 'pan' && !gesture.moved) {
    const h = gesture.hit;
    if (h && h.kind === 'kp') { if (pinned.has(h.p.key)) pinned.delete(h.p.key); else pinned.add(h.p.key); insightsDirty = true; }
    else if (h && h.kind === 'curve') select(h.row.id);
    else if (!h) select(null);
    dirty = true;
  }
  if (pointers.size === 0) gesture = null;
  else if (gesture && gesture.type === 'pinch') gesture = null;
  canvas.classList.remove('panning', 'dragging-point');
  insightsDirty = true;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!gesture) { hover = null; dirty = true; } });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [px, py] = local(e);
  zoomAt(Math.exp(-e.deltaY * 0.0015), px, py);
  insightsDirty = true;
}, { passive: false });
$('g-zoom-in').addEventListener('click', () => { zoomAt(1.4); insightsDirty = true; });
$('g-zoom-out').addEventListener('click', () => { zoomAt(1 / 1.4); insightsDirty = true; });
$('g-home').addEventListener('click', () => { setRange(homeRange); insightsDirty = true; });

// =====================================================================
// Lessons
// =====================================================================
const TWO_PI = 2 * Math.PI;
const LESSONS = [
  { id: 'lines', title: 'Lines: slope and intercept', blurb: 'What m and b do in y = mx + b.',
    rows: [['y = mx + b'], ['m = 1', [-5, 5, 0.1]], ['b = 0', [-5, 5, 0.1]]],
    view: { x0: -10, x1: 10 },
    steps: [
      'This row graphs y = mx + b. The letters m and b are sliders: change them and the line responds straight away.',
      'Drag the m slider. m is the slope, how much the line rises for every 1 step to the right. Positive m tilts up, negative m tilts down, and m = 0 is flat.',
      'Now drag b. The line slides up and down without tilting: b is where it crosses the y-axis (the vertical axis).',
      'Click the line on the graph. Key points lists where it crosses each axis. Can you make the line pass through (2, 5)?',
      'Challenge: type y = 2x + 1 in a new row (press Enter in the last row first). Move the sliders until your line sits exactly on top of it.',
    ] },
  { id: 'parabola', title: 'Parabolas: vertex form', blurb: 'Stretch, flip and move y = a(x − h)² + k.',
    rows: [['y = a(x - h)^2 + k'], ['a = 1', [-3, 3, 0.1]], ['h = 0', [-6, 6, 0.1]], ['k = 0', [-6, 6, 0.1]]],
    view: { x0: -10, x1: 10 },
    steps: [
      'This parabola is written in vertex form. Its turning point, the vertex, sits at (h, k).',
      'Drag a. A bigger a makes the parabola narrower, a between 0 and 1 makes it wider, and a negative a flips it upside down.',
      'Drag h. The parabola moves right as h grows. That surprises many people: the formula says x − h, so h = 3 means “moved 3 to the right”.',
      'Drag k to move the parabola up and down.',
      'Click the parabola. Its vertex shows up in Key points as a valley or a peak, and its roots show up where it crosses the x-axis.',
    ] },
  { id: 'sine', title: 'Sine waves', blurb: 'Amplitude, period and shifts of a wave.',
    rows: [['y = A sin(B(x - C)) + D'], ['A = 1', [0, 4, 0.1]], ['B = 1', [0.1, 4, 0.1]], ['C = 0', [-3.1, 3.1, 0.1]], ['D = 0', [-3, 3, 0.1]]],
    view: { x0: -2.2 * TWO_PI / 2, x1: 2.2 * TWO_PI / 2 },
    link: true,
    steps: [
      'y = sin(x) is a wave that repeats forever. This one has four sliders: A, B, C and D.',
      'A is the amplitude: the height of each peak above the middle line. Drag A and watch the peaks grow and shrink.',
      'B squeezes the wave. One full wave takes 2π ÷ B along the x-axis, so B = 2 fits two waves where there used to be one. The description under the first row tells you the exact repeat length.',
      'C slides the wave sideways (to the right for positive C), and D lifts the whole wave up or down.',
      'A sine wave is what a rotating circle looks like from the side. Fourier Circle Studio adds many rotating circles together to draw shapes.',
    ] },
  { id: 'exp', title: 'Exponential growth and decay', blurb: 'Multiplying by b each step in y = a·bˣ.',
    rows: [['y = a b^x'], ['a = 1', [0.1, 5, 0.1]], ['b = 2', [0.1, 4, 0.05]]],
    view: { x0: -6, x1: 6, cy: 3 },
    steps: [
      'y = a·b^x multiplies by b every time x goes up by 1. With b = 2 the value doubles each step.',
      'Drag b. When b is bigger than 1 the graph grows faster and faster. When b is between 0 and 1 it shrinks toward zero: that is decay. b = 1 gives a flat line.',
      'Drag a. The graph always crosses the y-axis at y = a, because b^0 = 1.',
      'Notice the graph never touches the x-axis: b^x is always positive. A line a graph approaches but never reaches is called an asymptote.',
    ] },
  { id: 'circle', title: 'Circles three ways', blurb: 'The same circle as an equation, a path and a polar curve.',
    rows: [['x^2 + y^2 = k^2'], ['(k cos(t), k sin(t))', null, true], ['r = k', null, true], ['k = 3', [0.5, 8, 0.1]]],
    view: { x0: -12, x1: 12 },
    steps: [
      'x² + y² = k² describes every point at distance k from the origin, by Pythagoras’ theorem. That is a circle of radius k. Drag k.',
      'Click the colored dot of row 2 to show it. It draws the same circle as a path: as t runs from 0 to 2π, the point (k cos t, k sin t) walks around it.',
      'Show row 3 too. In polar form, r = k means “stay at distance k from the origin at every angle θ”. Same circle again.',
      'Edit row 2 to (k cos(t), 2 sin(t)). The circle squashes into an ellipse.',
    ] },
  { id: 'fourier', title: 'A square wave from sines', blurb: 'Fourier’s idea: add waves to build any shape.',
    rows: [['y = (4/π) sum(k, 1, n, sin((2k - 1)x) / (2k - 1))'], ['n = 1', [1, 40, 1]], ['y = sign(sin(x))', null, false, '#d9dee8']],
    view: { x0: -9.5, x1: 9.5 },
    link: true,
    steps: [
      'Row 1 adds n sine waves: sin(x) + sin(3x)/3 + sin(5x)/5 + …, scaled by 4/π. Row 3 is the square wave it is trying to copy.',
      'Drag n upward from 1, or press play. Each extra wave sharpens the corners and flattens the tops.',
      'Even with many waves there is a small overshoot next to each jump, about 9% of the jump. This is called the Gibbs phenomenon, and it never goes away.',
      'This is Fourier’s big idea: complicated shapes are sums of simple waves. Fourier Circle Studio turns each wave into a rotating circle.',
    ] },
  { id: 'rose', title: 'Polar roses', blurb: 'Flowers from r = cos(nθ).',
    rows: [['r = cos(nθ)'], ['n = 3', [1, 9, 1]]],
    view: { x0: -2, x1: 2 },
    link: true,
    steps: [
      'In polar form, r is the distance from the origin at each angle θ. r = cos(nθ) traces a flower.',
      'Drag n. An odd n gives n petals; an even n gives 2n petals.',
      'Type n = 2.5 in row 2. The curve does not close: change the θ range in row 1 to run up to 4π.',
      'Fourier Circle Studio’s “Flower” preset draws the 8-petal rose r = cos 4θ with just two rotating circles.',
    ] },
];
let lesson = null, lessonStep = 0, undoSnapshot = null;
function snapshot() { return { rows: rows.map(r => ({ ...r, a: null, slider: r.slider ? { ...r.slider } : null })), selectedId, lesson: lesson && lesson.id, lessonStep, homeRange }; }
function restore(s) {
  rows = s.rows; selectedId = s.selectedId;
  lesson = LESSONS.find(l => l.id === s.lesson) || null; lessonStep = s.lessonStep;
  setRange(s.homeRange);
  renderList(); refresh(); renderLesson(); renderLessonCards();
}
function loadLesson(id, { undoable = true } = {}) {
  const L = LESSONS.find(l => l.id === id);
  if (undoable) undoSnapshot = snapshot();
  rows = [];
  for (const [text, slider, hidden, color] of L.rows) rows.push(newRow(text, { slider, hidden, color }));
  selectedId = rows[0].id;
  lesson = L; lessonStep = 0;
  pinned.clear();
  setRange(L.view);
  renderList(); refresh(); renderLesson(); renderLessonCards();
  if (undoable) toast(`Loaded “${L.title}”`, true);
  $('g-lesson').scrollIntoView?.({ block: 'nearest' });
}
function renderLesson() {
  const box = $('g-lesson');
  box.hidden = !lesson;
  if (!lesson) return;
  $('g-lesson-title').textContent = lesson.title;
  $('g-lesson-step').textContent = lesson.steps[lessonStep];
  $('g-lesson-count').textContent = `${lessonStep + 1} / ${lesson.steps.length}`;
  $('g-lesson-prev').disabled = lessonStep === 0;
  const last = lessonStep === lesson.steps.length - 1;
  $('g-lesson-next').textContent = last ? 'Finish' : 'Next';
  $('g-lesson-link').hidden = !(lesson.link && last);
}
function renderLessonCards() {
  const box = $('g-lessons');
  box.innerHTML = '';
  for (const L of LESSONS) {
    const b = document.createElement('button');
    b.className = 'g-lesson-card';
    b.setAttribute('aria-pressed', String(lesson && lesson.id === L.id));
    b.innerHTML = `<strong>${L.title}</strong><span>${L.blurb}</span>`;
    b.addEventListener('click', () => loadLesson(L.id));
    box.appendChild(b);
  }
}
$('g-lesson-prev').addEventListener('click', () => { if (lessonStep > 0) { lessonStep--; renderLesson(); } });
$('g-lesson-next').addEventListener('click', () => {
  if (lessonStep < lesson.steps.length - 1) { lessonStep++; renderLesson(); }
  else { lesson = null; renderLesson(); renderLessonCards(); toast('Lesson finished. Your graphs stay here to explore.'); }
});
$('g-lesson-close').addEventListener('click', () => { lesson = null; renderLesson(); renderLessonCards(); });
$('g-lesson-link').addEventListener('click', () => { if (window.Suite) window.Suite.show('fourier'); });

// =====================================================================
// Toolbar, settings, export
// =====================================================================
$('g-add').addEventListener('click', () => { const r = newRow(''); rows.push(r); renderList(r.id); refresh(); });
$('g-clear').addEventListener('click', () => {
  undoSnapshot = snapshot();
  rows = [newRow('')]; selectedId = null; lesson = null;
  renderList(rows[0].id); refresh(); renderLesson(); renderLessonCards();
  toast('Cleared all expressions', true);
});
let toastTimer = 0;
function toast(msg, undo = false) {
  const t = $('g-toast');
  $('g-toast-msg').textContent = msg;
  $('g-toast-undo').hidden = !undo;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3000);
}
$('g-toast-undo').addEventListener('click', () => { if (undoSnapshot) { restore(undoSnapshot); undoSnapshot = null; } $('g-toast').hidden = true; });
$('g-grid').addEventListener('change', (e) => { settings.grid = e.target.checked; dirty = true; });
$('g-numbers').addEventListener('change', (e) => { settings.numbers = e.target.checked; dirty = true; });
$('g-deg').addEventListener('change', (e) => { settings.deg = e.target.checked; refresh(); });
$('g-auto-kp').addEventListener('change', (e) => { settings.autoKP = e.target.checked; dirty = true; insightsDirty = true; });
$('g-export').addEventListener('click', async () => {
  hover = null; render();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) { toast('Could not create the image. Try again.'); return; }
  const r = window.Suite ? await window.Suite.saveBlob(blob, 'graph.png') : 'fallback';
  if (r === 'saved') toast('PNG saved');
  else if (r === 'declined') toast('Export cancelled');
});

// =====================================================================
// Loop
// =====================================================================
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (isVisible()) {
    const playing = rows.filter(r => r.playing && r.a && r.a.kind === 'slider');
    for (const row of playing) {
      const s = row.slider;
      // Keep an unrounded value so whole-number sliders keep moving
      if (row.anim === undefined || Math.abs(row.anim - row.a.value) > row.slider.step) row.anim = row.a.value;
      let v = row.anim + row.dir * (s.max - s.min) * dt / 5;
      if (v >= s.max) { v = s.max; row.dir = -1; }
      if (v <= s.min) { v = s.min; row.dir = 1; }
      row.anim = v;
      row.text = `${row.a.name} = ${sliderValueText(Math.round(v / s.step) * s.step, s.step)}`;
      const inp = $('g-in-' + row.id); if (inp) inp.value = row.text;
    }
    if (playing.length) { analyzeAll(); updateRowsUI(); dirty = true; insightsDirty = true; }
    if (dirty) { render(); dirty = false; }
    if (insightsDirty) { renderInsights(); insightsDirty = false; }
  }
  requestAnimationFrame(frame);
}

// ---------- Start ----------
renderLessonCards();
loadLesson('lines', { undoable: false });
requestAnimationFrame((t) => { last = t; frame(t); });
window.addEventListener('suite:view', (e) => { if (e.detail === 'grapher') { resize(); dirty = true; } });

// Test hook: exposes internals for automated checks.
window.__grapher = { rows: () => rows, setRows(texts) { rows = texts.map(t => newRow(t)); renderList(); refresh(); }, analyzeAll, V, keyPoints: () => keyPoints, select, loadLesson, settings, refresh, setRange, tokenize, parseTokens, html };
})();
