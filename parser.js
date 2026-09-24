// 式の読み取り（字句 → 構文 → 関数）。eval / new Function は使わない。
// main.js（ブラウザ）と test.mjs（node）の両方から読む。

const FUNCS = {
  sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
  sqrt: [1, Math.sqrt], abs: [1, Math.abs], exp: [1, Math.exp],
  ln: [1, Math.log], log: [1, Math.log10], floor: [1, Math.floor],
  min: [2, Math.min], max: [2, Math.max],
};
const CONSTS = { pi: Math.PI, e: Math.E };
// 名前は長いものから当てる（exp を e・x・p に分けない）
const WORDS = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x', 'y'].sort((a, b) => b.length - a.length);

class ParseError extends Error {}

// 全角・記号をそろえる。x² は NFKC だと x2 になるので先に ^2 にする
export function normalize(src) {
  return String(src)
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .normalize('NFKC')
    .replace(/[−–—]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/')
    .replace(/\*\*/g, '^').replace(/π/g, 'pi').replace(/√/g, 'sqrt')
    .toLowerCase();
}

// 「y = …」「x = …」を頭に付けて打ったときは、そちらの向きにする
export function splitMode(src, mode = 'y') {
  const s = normalize(src).trim();
  const m = /^([xy])\s*=(.*)$/.exec(s);
  return m ? { mode: m[1] === 'y' ? 'y' : 'x', expr: m[2] } : { mode, expr: s };
}

function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m || s[i + m[1].length] === '.') throw new ParseError('数の書き方がおかしい');
      out.push({ t: 'num', v: parseFloat(m[1]) });
      i += m[1].length;
      continue;
    }
    if (/[a-z]/.test(c)) {
      const w = WORDS.find((w) => s.startsWith(w, i));
      if (!w) throw new ParseError(`知らない関数「${/^[a-z]+/.exec(s.slice(i))[0]}」`);
      out.push({ t: 'id', v: w });
      i += w.length;
      continue;
    }
    if ('+-*/^(),'.includes(c)) { out.push({ t: c }); i++; continue; }
    if (c === '=') throw new ParseError('= は要らない');
    throw new ParseError(`使えない字「${c}」`);
  }
  return out;
}

// 構文: expr = term (± term)* / term = unary ((*|/)? unary)* / unary = -unary | power / power = atom (^ unary)?
function parseTokens(toks, v) {
  let p = 0;
  const peek = () => toks[p];
  const need = () => { throw new ParseError(`ここに数か ${v} が要る`); };
  const startsAtom = (t) => t && (t.t === 'num' || t.t === 'id' || t.t === '(');

  function expr() {
    let a = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = toks[p++].t, b = term(), l = a;
      a = op === '+' ? (x) => l(x) + b(x) : (x) => l(x) - b(x);
    }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t && (t.t === '*' || t.t === '/')) {
        p++;
        const b = unary(), l = a;
        a = t.t === '*' ? (x) => l(x) * b(x) : (x) => l(x) / b(x);
      } else if (startsAtom(t)) {   // 掛け算の省略（2x、3(x+1)、x sin(x)）
        const b = power(), l = a;
        a = (x) => l(x) * b(x);
      } else return a;
    }
  }
  function unary() {
    const t = peek();
    if (t && t.t === '-') { p++; const a = unary(); return (x) => -a(x); }
    if (t && t.t === '+') { p++; return unary(); }
    return power();
  }
  function power() {
    const a = atom();
    if (peek() && peek().t === '^') {
      p++;
      const b = unary();   // 右から: 2^3^2 = 2^(3^2)
      return (x) => a(x) ** b(x);
    }
    return a;
  }
  function atom() {
    const t = toks[p++];
    if (!t) need();
    if (t.t === 'num') return () => t.v;
    if (t.t === '(') {
      const a = expr();
      if (!peek()) throw new ParseError('かっこが閉じていない');
      if (peek().t !== ')') need();
      p++;
      return a;
    }
    if (t.t === 'id') {
      if (t.v in CONSTS) { const c = CONSTS[t.v]; return () => c; }
      if (t.v === v) return (x) => x;
      if (t.v === 'x' || t.v === 'y') throw new ParseError(`ここでは ${v} を使う`);
      const [n, f] = FUNCS[t.v];
      if (!peek() || peek().t !== '(') throw new ParseError(`${t.v} のあとに ( が要る`);
      p++;
      const args = [expr()];
      while (peek() && peek().t === ',') { p++; args.push(expr()); }
      if (!peek()) throw new ParseError('かっこが閉じていない');
      if (peek().t !== ')') need();
      p++;
      if (args.length !== n) throw new ParseError(n === 1 ? `${t.v} は数を 1 つ` : `${t.v} は「,」で 2 つに分ける`);
      if (n === 1) { const [a] = args; return (x) => f(a(x)); }
      const [a, b] = args;
      return (x) => f(a(x), b(x));
    }
    if (t.t === ')') throw new ParseError(') が多いか、前に数が要る');
    if (t.t === ',') throw new ParseError('「,」は min(a, b) の中だけ');
    need();
  }

  if (!toks.length) throw new ParseError('式が空');
  const f = expr();
  if (p < toks.length) {
    const t = toks[p];
    throw new ParseError(t.t === ')' ? ') が多い' : t.t === ',' ? '「,」は min(a, b) の中だけ' : `ここに数か ${v} が要る`);
  }
  return f;
}

// 式を関数にする。v は変数の名前（'x' か、x = … のときは 'y'）。
// 返り値: { ok: true, fn } か { ok: false, error: '短い説明' }
export function compile(src, v = 'x') {
  try {
    return { ok: true, fn: parseTokens(tokenize(normalize(src)), v) };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message };
    throw e;
  }
}

// 範囲の欄などの、x を含まない式の値（読めなければ NaN）
export function constant(src) {
  const r = compile(src, '_');
  if (!r.ok) return NaN;
  const v = r.fn(0);
  return Number.isFinite(v) ? v : NaN;
}
