// 線と物理。画面に触らない。main.js（ブラウザ）と test.mjs（node）の両方から読む。
// 物理は決まった刻み（DT）で進めるので、画面の大きさや速さで結果が変わらない。
import { compile, constant } from './parser.js';

// ---- 調整つまみ（長さは世界の座標。場は横 −10〜10、縦 −7〜7） ----
export const X0 = -10, X1 = 10, Y0 = -7, Y1 = 7;
export const DT = 1 / 480;
export const GRAVITY = -20;
export const BALL_R = 0.36;
export const REST = 0.24;          // 反発
export const REST_CUT = 0.8;       // これより遅く当たったときは跳ねない（小刻みに震えないように）
export const MU = 0.06;            // 摩擦
export const AIR = 0.03;           // 空気抵抗（1 秒あたり）
export const MAXV = 34;
export const LINE_PAD = 0.07;      // 線の太さの半分
export const GOAL_R = 0.32;        // ゴールにふれたとみなす距離 = BALL_R + GOAL_R。線がちょうど点を通るとき、余裕は 0.25
export const STILL_V = 0.25;       // これより遅いと「止まっている」
export const STILL_T = 0.8;        // 全部のボールがこの秒数止まったら失敗
export const HIT_V = 3;            // これより強く当たったら「トッ」と鳴らす
const SAMPLES = 140;               // 1 あたりの点の数（画面の大きさで変えない）
const OUT = { x0: X0 - 2.5, x1: X1 + 2.5, y0: Y0 - 2.5 };   // ここを出たボールは落ちた

// 引いた線 1 本 = { mode: 'y' | 'x', expr, dmin, dmax }（dmin / dmax は数か null）。
// 折れ線（描く用）と線分（当たり判定用）にする。読めなければ { error }
export function buildLine(line) {
  const v = line.mode === 'x' ? 'y' : 'x';
  const r = compile(line.expr, v);
  if (!r.ok) return { error: r.error };
  let lo = line.mode === 'x' ? Y0 : X0, hi = line.mode === 'x' ? Y1 : X1;
  const dmin = num(line.dmin), dmax = num(line.dmax);
  if (dmin != null) lo = Math.max(lo, Math.min(dmin, dmax ?? dmin));
  if (dmax != null) hi = Math.min(hi, Math.max(dmax, dmin ?? dmax));
  const paths = [], ends = [];
  const pt = (t) => {
    const u = r.fn(t);
    if (!Number.isFinite(u)) return null;
    const [x, y] = line.mode === 'x' ? [u, t] : [t, u];
    return x >= X0 - 1 && x <= X1 + 1 && y >= Y0 - 1 && y <= Y1 + 1 ? [x, y] : null;
  };
  if (hi > lo) {
    const n = Math.max(2, Math.round((hi - lo) * SAMPLES));
    let cur = null;
    for (let i = 0; i <= n; i++) {
      const p = pt(i === n ? hi : lo + (hi - lo) * i / n);
      if (!p) { cur = null; continue; }
      if (!cur) paths.push(cur = []);
      cur.push(p[0], p[1]);
    }
    for (const d of [dmin, dmax]) if (d != null && d >= lo && d <= hi) { const p = pt(d); if (p) ends.push(p); }
  }
  // 値が大きく飛ぶ所（tan の漸近線など）は線をつながない
  const cut = [];
  for (const path of paths) {
    let cur = [path[0], path[1]];
    for (let i = 2; i < path.length; i += 2) {
      if (Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]) > 1.5) { cut.push(cur); cur = []; }
      cur.push(path[i], path[i + 1]);
    }
    cut.push(cur);
  }
  const segs = [];
  for (const p of cut) for (let i = 0; i + 3 < p.length; i += 2) segs.push([p[i], p[i + 1], p[i + 2], p[i + 3], LINE_PAD]);
  return { paths: cut.filter((p) => p.length >= 4), ends, segs };
}
const num = (v) => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : Number.isFinite(constant(v)) ? constant(v) : null);

// 障害物: { a: [x, y], b: [x, y], w } の線か、{ box: [x, y, w, h] } の箱（辺が当たり判定）
export function wallSegs(walls = []) {
  const out = [];
  for (const w of walls) {
    if (w.box) {
      const [x, y, bw, bh] = w.box, p = 0.02;
      out.push([x, y, x + bw, y, p], [x + bw, y, x + bw, y + bh, p], [x + bw, y + bh, x, y + bh, p], [x, y + bh, x, y, p]);
    } else out.push([w.a[0], w.a[1], w.b[0], w.b[1], (w.w ?? 0.4) / 2]);
  }
  return out;
}

// ---- 当たりを絞るための格子。線分を、ボールがふれうるます目すべてに入れておく ----
const CELL = 0.5, GX0 = OUT.x0 - 1, GY0 = OUT.y0 - 1;
const NX = Math.ceil((OUT.x1 + 1 - GX0) / CELL), NY = Math.ceil((Y1 + 4 - GY0) / CELL);
function makeGrid(segs) {
  const cells = new Array(NX * NY);
  const cx = (x) => Math.min(NX - 1, Math.max(0, Math.floor((x - GX0) / CELL)));
  const cy = (y) => Math.min(NY - 1, Math.max(0, Math.floor((y - GY0) / CELL)));
  segs.forEach((s, k) => {
    const m = s[4] + BALL_R + 0.02;
    for (let i = cx(Math.min(s[0], s[2]) - m); i <= cx(Math.max(s[0], s[2]) + m); i++) {
      for (let j = cy(Math.min(s[1], s[3]) - m); j <= cy(Math.max(s[1], s[3]) + m); j++) {
        (cells[j * NX + i] ||= []).push(k);
      }
    }
  });
  return (x, y) => cells[cy(y) * NX + cx(x)];
}

// ステージと引いた線から、走らせる世界を作る。lines は buildLine の結果の配列
export function makeWorld(stage, built) {
  const segs = wallSegs(stage.walls);
  for (const b of built) if (b.segs) segs.push(...b.segs);
  return {
    stage, segs, near: makeGrid(segs), steps: 0, acc: 0, events: [], order: [], result: 'running',
    balls: stage.balls.map((b) => ({ x: b.x, y: b.y, vx: b.vx || 0, vy: b.vy || 0, dead: false, still: 0 })),
    goals: stage.goals.map((g) => ({ x: g.x, y: g.y, got: false })),
  };
}

function collide(w, b) {
  const list = w.near(b.x, b.y);
  if (!list) return;
  for (let it = 0; it < 3; it++) {
    let hit = false;
    for (const k of list) {
      const [ax, ay, bx, by, pad] = w.segs[k];
      const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
      let t = l2 > 0 ? ((b.x - ax) * ex + (b.y - ay) * ey) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let dx = b.x - (ax + t * ex), dy = b.y - (ay + t * ey);
      const rr = BALL_R + pad, d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-9) { const l = Math.sqrt(l2) || 1; dx = -ey / l; dy = ex / l; d = 0; }   // 中心が線の上なら、線の法線の向きへ
      else { dx /= d; dy /= d; }
      b.x += dx * (rr - d); b.y += dy * (rr - d);
      const vn = b.vx * dx + b.vy * dy;
      if (vn < 0) {
        if (-vn > HIT_V) w.events.push({ type: 'hit', v: -vn });
        const jn = -(1 + (-vn < REST_CUT ? 0 : REST)) * vn;
        b.vx += jn * dx; b.vy += jn * dy;
        // 接線の向きの摩擦は、押し返した強さに比例して削る
        const vt = -b.vx * dy + b.vy * dx, cutV = Math.min(Math.abs(vt), MU * jn) * Math.sign(vt);
        b.vx += cutV * dy; b.vy -= cutV * dx;
      }
      hit = true;
    }
    if (!hit) return;
  }
}

// 1 刻み進める
export function step(w) {
  if (w.result !== 'running') return;
  w.steps++;
  const damp = 1 - AIR * DT;
  for (const b of w.balls) {
    if (b.dead) continue;
    b.vy += GRAVITY * DT;
    b.vx *= damp; b.vy *= damp;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAXV) { b.vx *= MAXV / sp; b.vy *= MAXV / sp; }
    b.x += b.vx * DT; b.y += b.vy * DT;
    collide(w, b);
    b.still = Math.hypot(b.vx, b.vy) < STILL_V ? b.still + DT : 0;
    for (const [i, g] of w.goals.entries()) {
      if (!g.got && (b.x - g.x) ** 2 + (b.y - g.y) ** 2 < (BALL_R + GOAL_R) ** 2) {
        g.got = true; w.order.push(i); w.events.push({ type: 'goal', i, n: w.order.length });
      }
    }
    if (b.x < OUT.x0 || b.x > OUT.x1 || b.y < OUT.y0) b.dead = true;
  }
  const live = w.balls.filter((b) => !b.dead);
  if (w.goals.every((g) => g.got)) w.result = 'clear';
  else if (!live.length) w.result = 'fell';
  else if (live.every((b) => b.still >= STILL_T)) w.result = 'stuck';
  else if (w.steps * DT >= w.stage.time) w.result = 'time';
}

// 画面の 1 コマ分（dt 秒）進める。刻みは DT のまま、足りない分は次のコマへ持ち越す
export function advance(w, dt) {
  w.acc += Math.min(dt, 0.25);
  while (w.acc >= DT && w.result === 'running') { step(w); w.acc -= DT; }
}

// 線を引いて最後まで走らせる（テスト・ステージ作り用）
export function simulate(stage, lines) {
  const built = lines.map(buildLine);
  if (built.some((b) => b.error)) return { result: 'error', steps: 0, order: [] };
  const w = makeWorld(stage, built);
  while (w.result === 'running') step(w);
  return { result: w.result, steps: w.steps, order: w.order, world: w };
}
