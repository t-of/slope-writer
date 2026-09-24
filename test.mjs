// node test.mjs — 式の読み取りと、ステージの自己チェック（仕様の 1〜7）。画面は使わない。
import assert from 'node:assert/strict';
import { compile, splitMode, constant } from './parser.js';
import { buildLine, makeWorld, advance, simulate, DT } from './physics.js';
import { STAGES } from './stages.js';

let n = 0;
const test = (name, fn) => { const t = Date.now(); fn(); n++; console.log(`ok ${name}（${((Date.now() - t) / 1000).toFixed(1)} 秒）`); };
const val = (src, x, v = 'x') => { const r = compile(src, v); assert.ok(r.ok, `${src}: ${r.error}`); return r.fn(x); };
const clears = (st, lines) => simulate(st, lines).result === 'clear';

// 想定解の数（係数・定数・範囲）を 1 つずつ ±0.05 ずらしたもの。x の前に数がない式（-x）のために、
// 式全体に ±0.05、y = … では ±0.05x も足す。^ の右の数（指数）はずらさない
function variants(answer) {
  const out = [];
  answer.forEach((l, i) => {
    const put = (nl) => out.push(answer.map((o, j) => (j === i ? nl : o)));
    const re = /(\^)?(\d+\.?\d*|\.\d+)/g;
    let m;
    while ((m = re.exec(l.expr))) {
      if (m[1]) continue;
      for (const d of [0.05, -0.05]) put({ ...l, expr: l.expr.slice(0, m.index) + +(parseFloat(m[2]) + d).toFixed(4) + l.expr.slice(m.index + m[0].length) });
    }
    for (const d of ['+0.05', '-0.05']) put({ ...l, expr: `(${l.expr})${d}` });
    if (l.mode === 'y') for (const d of ['+0.05x', '-0.05x']) put({ ...l, expr: `(${l.expr})${d}` });
    for (const k of ['dmin', 'dmax']) if (l[k] != null) for (const d of [0.05, -0.05]) put({ ...l, [k]: +(l[k] + d).toFixed(4) });
  });
  return out;
}

// ---- 1. 式の読み取り ----
test('読み取り: 答えの表', () => {
  const table = [
    ['2x', 3, 6], ['-x^2', 2, -4], ['2^3^2', 0, 512], ['sin(pi/2)', 0, 1], ['3(x+1)', 1, 6], ['x(x+1)', 2, 6],
    ['2sin(x)', Math.PI / 2, 2], ['-0.5x+1.2', 2, 0.2], ['.5x', 4, 2], ['abs(x)-4', -3, -1], ['sqrt(16)', 0, 4],
    ['min(x, 3)', 5, 3], ['max(x,3)', 5, 5], ['floor(x)', 2.7, 2], ['ln(e)', 0, 1], ['log(100)', 0, 2], ['exp(0)', 0, 1],
    ['2^-1', 0, 0.5], ['-2x', 3, -6], ['x/2/2', 8, 2], ['8-3-2', 0, 3], ['2+3*4', 0, 14], ['(1+2)(3+4)', 0, 21],
    ['xsin(x)', 0, 0], ['pix', 1, Math.PI], ['cos(0)+tan(0)', 0, 1],
    // PC のキーボードから打つ書き方
    ['x²', 3, 9], ['２×３÷４', 0, 1.5], ['2**3', 0, 8], ['－ｘ', 1, -1], ['√(9)', 0, 3], ['2π', 0, 2 * Math.PI], ['3−1', 0, 2],
  ];
  for (const [src, x, want] of table) assert.ok(Math.abs(val(src, x) - want) < 1e-12, `${src} (x=${x}) → ${val(src, x)}、ほしいのは ${want}`);
  assert.equal(val('y+1', 2, 'y'), 3);
  assert.deepEqual(splitMode('ｙ＝－ｘ'), { mode: 'y', expr: '-x' });
  assert.deepEqual(splitMode('x = 4'), { mode: 'x', expr: ' 4' });
  assert.equal(splitMode('2x', 'x').mode, 'x');
  assert.equal(constant('-2.2'), -2.2);
  assert.ok(Number.isNaN(constant('x')));
});

test('読み取り: 読めない式はエラー（短い説明つき）', () => {
  const bad = [
    ['(x', 'かっこが閉じていない'], ['sin(x', 'かっこが閉じていない'], ['x+', '要る'], ['*x', '要る'], ['', '空'],
    ['foo(x)', '知らない関数'], ['x)', ') が多い'], ['sin x', '( が要る'], ['min(1)', '2 つ'], ['sin(1,2)', '1 つ'],
    ['1..2', '数'], ['x=1', '='], ['2#', '使えない字'], ['1,2', '「,」'],
  ];
  for (const [src, msg] of bad) {
    const r = compile(src);
    assert.equal(r.ok, false, `${src} が読めてしまった`);
    assert.ok(r.error.includes(msg), `${src}: 「${r.error}」に「${msg}」がない`);
  }
  assert.equal(compile('x', 'y').ok, false, 'x = … のときの x');
});

test('線: 値が出ない所で切れる、範囲で終わる、x = … は縦の線', () => {
  const s = buildLine({ mode: 'y', expr: 'sqrt(x)' });
  assert.ok(s.paths.length === 1 && s.paths[0][0] >= 0, 'sqrt は x ≥ 0 だけ');
  assert.ok(buildLine({ mode: 'y', expr: '1/x' }).paths.length === 2, '1/x は 0 で切れる');
  assert.ok(buildLine({ mode: 'y', expr: 'tan(x)' }).paths.length >= 6, 'tan は漸近線で切れる');
  const r = buildLine({ mode: 'y', expr: 'x', dmin: -1, dmax: 2 });
  assert.deepEqual([r.paths[0][0], r.paths[0].at(-2)], [-1, 2]);
  assert.equal(r.ends.length, 2);
  const v = buildLine({ mode: 'x', expr: '4', dmin: -6, dmax: 2 });
  assert.ok(v.paths[0].every((c, i) => i % 2 || c === 4));
  assert.ok(buildLine({ mode: 'y', expr: 'x+' }).error);
  // 点の密度は世界の座標で決まっている（画面の大きさを渡していない）
  assert.equal(buildLine({ mode: 'y', expr: '0' }).segs.length, 20 * 140);
});

// ---- 2〜4. ステージ ----
test('2. 全ステージが想定解でクリアできる', () => {
  for (const st of STAGES) assert.ok(clears(st, st.answer), `ステージ ${st.n}: ${simulate(st, st.answer).result}`);
});

test('3. 想定解の数を ±0.05 ずらしてもクリアできる', () => {
  for (const st of STAGES) {
    for (const v of variants(st.answer)) {
      assert.ok(clears(st, v), `ステージ ${st.n}: ${JSON.stringify(v)} → ${simulate(st, v).result}`);
    }
  }
});

test('4. 何も引かないとクリアできない、ゴールははじめの位置から 2.2 以上', () => {
  for (const st of STAGES) {
    assert.notEqual(simulate(st, []).result, 'clear', `ステージ ${st.n}`);
    for (const g of st.goals) for (const b of st.balls) assert.ok(Math.hypot(g.x - b.x, g.y - b.y) >= 2.2, `ステージ ${st.n} の (${g.x}, ${g.y})`);
    assert.ok(st.answer.length <= st.maxFns && st.par <= st.maxFns, `ステージ ${st.n} の本数`);
  }
});

// ---- 5. 直線ではいけないステージ ----
test('5. noLine のステージは、直線 1 本（傾き −3〜3・切片 −8〜8、0.1 刻み）では解けない', () => {
  const list = STAGES.filter((s) => s.noLine);
  assert.ok(list.length >= 2);
  for (const st of list) {
    for (let a = -30; a <= 30; a++) {
      for (let b = -80; b <= 80; b++) {
        const expr = `${a / 10}x+${b / 10}`;
        assert.ok(!clears(st, [{ mode: 'y', expr }]), `ステージ ${st.n} が y = ${expr} で解けた`);
      }
    }
  }
});

// ---- 6. 目標 2 本のステージは 1 本では解けない ----
function samples() {
  const out = [];
  const y = (expr, dmin = null, dmax = null) => out.push({ mode: 'y', expr, dmin, dmax });
  for (const a of [-2, -1.5, -1, -0.7, -0.5, -0.4, -0.3, -0.2, -0.1, 0.1, 0.3, 0.5, 1]) {
    for (const b of [-6, -4, -3, -2, -1, 0, 1, 2, 4]) {
      y(`${a}x+${b}`);
      if (a < 0 && b > -4) for (const d of [-4, 0, 2]) y(`${a}x+${b}`, null, d);
    }
  }
  for (const a of [0.05, 0.1, 0.2, -0.05, -0.1]) for (const b of [-1, -0.5, 0, 0.5]) for (const c of [-5, -3, -1, 1]) y(`${a}x^2+${b}x+${c}`);
  for (const a of [0.5, 1, -0.5, -1]) for (const h of [-4, 0, 4]) for (const c of [-4, -2, 0, 2]) y(`${a}abs(x-${h})+${c}`);
  for (const a of [0.5, 1, 2]) for (const m of [-0.8, -0.5, -0.3]) for (const c of [-3, -1, 1]) y(`${a}sin(x)+${m}x+${c}`);
  for (let k = -8; k <= 8; k += 2) out.push({ mode: 'x', expr: `${k}` });
  return out;
}

test('6. 目標 2 本のステージは、代表的な式 1 本では解けない', () => {
  const list = samples();
  assert.ok(list.length >= 300, `式は ${list.length} 通り`);
  for (const st of STAGES.filter((s) => s.par >= 2)) {
    for (const l of list) assert.ok(!clears(st, [l]), `ステージ ${st.n} が ${JSON.stringify(l)} 1 本で解けた`);
  }
});

// ---- 7. 画面の速さで変わらない ----
test('7. 30 / 60 / 120Hz で進めても、クリアの時刻とゴールの順番が同じ', () => {
  for (const st of STAGES) {
    const want = simulate(st, st.answer);
    for (const hz of [30, 60, 120, 144]) {
      const w = makeWorld(st, st.answer.map(buildLine));
      while (w.result === 'running') advance(w, 1 / hz);
      assert.equal(w.result, 'clear', `ステージ ${st.n} ${hz}Hz`);
      assert.equal(w.steps, want.steps, `ステージ ${st.n} ${hz}Hz の時刻`);
      assert.deepEqual(w.order, want.order, `ステージ ${st.n} ${hz}Hz の順番`);
    }
    // コマの長さがばらばらでも同じ
    const w = makeWorld(st, st.answer.map(buildLine));
    let k = 0;
    while (w.result === 'running') advance(w, [1 / 30, 1 / 97, 1 / 240, 0.05][k++ % 4]);
    assert.equal(w.steps, want.steps);
    assert.ok(want.steps * DT <= st.time);
  }
});

console.log(`\n${n} 件すべて通った`);
