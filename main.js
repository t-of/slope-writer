// SLOPE WRITER 本体。式の読み取りは parser.js、線と物理は physics.js、ステージは stages.js。ここは画面・操作・描画・音・保存。
import { compile, constant, splitMode, normalize } from './parser.js';
import { buildLine, makeWorld, advance, X0, Y1, DT, BALL_R, GOAL_R } from './physics.js';
import { STAGES } from './stages.js';

WebAppKit.init({ title: 'SLOPE WRITER', text: '式を入れると、そのグラフが坂になる。ボールを転がして、浮かんだ点を全部拾わせるパズル。' });

// https と localhost（開発・audit）で登録する
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// ---- 保存（localStorage はほかのアプリと共有されるので、キーは 'slope-writer.' で始める） ----
const storage = (() => { try { return localStorage; } catch { return null; } })();
const KEY = { settings: 'slope-writer.settings', progress: 'slope-writer.progress', work: 'slope-writer.work' };
function read(k) { try { const v = storage?.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function write(k, v) { try { storage?.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ } }

// 読めない・形の合わない値は捨てて、はじめの値にする
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function cleanLine(l) {
  if (!l || (l.mode !== 'y' && l.mode !== 'x') || typeof l.expr !== 'string' || l.expr.length > 200) return null;
  if (!compile(l.expr, l.mode === 'x' ? 'y' : 'x').ok) return null;
  return { mode: l.mode, expr: l.expr, dmin: isNum(l.dmin) ? l.dmin : null, dmax: isNum(l.dmax) ? l.dmax : null };
}
const settings = (() => { const s = read(KEY.settings); return { v: 1, sound: s?.v === 1 && typeof s.sound === 'boolean' ? s.sound : true }; })();
const progress = (() => {
  const p = read(KEY.progress), out = { v: 1, cleared: {} };
  if (p?.v !== 1 || typeof p.cleared !== 'object' || !p.cleared) return out;
  for (const st of STAGES) {
    const c = p.cleared[st.n];
    if (c && Number.isInteger(c.fns) && c.fns > 0 && [1, 2, 3].includes(c.stars)) out.cleared[st.n] = { fns: c.fns, stars: c.stars };
  }
  return out;
})();
const work = (() => {
  const w = read(KEY.work), out = { v: 1 };
  if (w?.v !== 1) return out;
  for (const st of STAGES) {
    if (!Array.isArray(w[st.n])) continue;
    const ls = w[st.n].map(cleanLine).filter(Boolean).slice(0, st.maxFns);
    if (ls.length) out[st.n] = ls;
  }
  return out;
})();

// ---- 音（Web Audio で作る。音声ファイルは使わない） ----
// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
const sfx = {
  ctx: null,
  // 触ったときに呼ぶ（ブラウザは触る前の音を止める）
  unlock() {
    if (!settings.sound) return;
    setAudioSession(true);
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.1, to } = {}) {
    if (!settings.sound || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.03);
  },
  key() { this.tone(1500, { dur: 0.02, type: 'triangle', gain: 0.035 }); },
  ui() { this.tone(900, { dur: 0.018, type: 'triangle', gain: 0.03 }); },
  bad() { this.tone(150, { dur: 0.08, type: 'square', gain: 0.05 }); },
  draw() { this.tone(420, { dur: 0.12, to: 1100, gain: 0.07 }); },
  start() { this.tone(700, { dur: 0.08, type: 'triangle', gain: 0.1, to: 520 }); },
  hit(v) { this.tone(260, { dur: 0.04, type: 'triangle', gain: Math.min(0.1, 0.02 + v * 0.006) }); },
  goal(n) { const f = 1046 * 1.12 ** (n - 1); this.tone(f, { dur: 0.18, gain: 0.09 }); this.tone(f * 2, { dur: 0.1, gain: 0.03 }); },
  fail() { this.tone(330, { dur: 0.14, type: 'triangle', gain: 0.07 }); this.tone(220, { at: 0.14, dur: 0.16, type: 'triangle', gain: 0.07 }); },
  clear(stars) {
    [523, 659, 784].forEach((f, i) => this.tone(f, { at: i * 0.12, dur: 0.2, gain: 0.08 }));
    if (stars === 3) this.tone(1568, { at: 0.38, dur: 0.25, gain: 0.06 });
  },
  allClear() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, { at: i * 0.16, dur: i === 4 ? 0.4 : 0.2, gain: 0.08 })); },
};
addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

function renderSound() {
  $('soundBtn').textContent = settings.sound ? '音 オン' : '音 オフ';
  $('soundBtn').setAttribute('aria-pressed', String(settings.sound));
}
$('soundBtn').addEventListener('click', () => {
  settings.sound = !settings.sound;
  setAudioSession(settings.sound);
  write(KEY.settings, settings);
  renderSound();
  if (settings.sound) { sfx.unlock(); sfx.ui(); }
});

// ---- 画面の切り替え ----
function show(id) {
  for (const s of ['title', 'play']) $(s).hidden = s !== id;
  if (id === 'title') { renderTitle(); scrollTo(0, 0); }
}

// ---- タイトル ----
const unlocked = () => Math.min(STAGES.length, Math.max(0, ...Object.keys(progress.cleared).map(Number)) + 1);
const nextStage = () => STAGES.find((s) => s.n <= unlocked() && !progress.cleared[s.n])?.n ?? 1;
const LOCK_SVG = '<svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><rect x="1" y="7" width="12" height="9" rx="2" fill="currentColor"/><path d="M4 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

function renderTitle() {
  const box = $('stages');
  box.textContent = '';
  const next = nextStage();
  for (const st of STAGES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'st';
    const c = progress.cleared[st.n];
    if (st.n > unlocked()) {
      b.classList.add('st--lock');
      b.disabled = true;
      b.innerHTML = LOCK_SVG;
      b.setAttribute('aria-label', `ステージ ${st.n}（まだ遊べない）`);
    } else {
      b.textContent = st.n;
      if (c) { const s = document.createElement('small'); s.textContent = '★'.repeat(c.stars) + '☆'.repeat(3 - c.stars); b.append(s); }
      if (st.n === next && !c) b.classList.add('st--next');
      b.addEventListener('click', () => { sfx.ui(); openStage(st.n); });
    }
    box.append(b);
  }
  $('continue').textContent = `つづきから（ステージ ${next}）`;
}
$('continue').addEventListener('click', () => { sfx.ui(); openStage(nextStage()); });

// ---- 遊ぶ: 状態 ----
const PALETTE = ['#9b8cff', '#4fe3ff', '#ff8ad8'];   // 自分の線。赤は障害物に使うので入れない
const CIRCLED = ['①', '②', '③', '④'];
const closedHints = new Set();
let stage = STAGES[0];
let lines = [];          // { mode, expr, dmin, dmax }
let built = [];          // lines を buildLine したもの
let editing = null;      // チップから呼び戻して直している式の番号
let mode = 'y';          // 'y'（y = f(x)）か 'x'（x = g(y)、縦の線）
let rangeOn = false;
let fnKeys = false;      // キーパッドの下 2 段が関数キーか
let active = 'expr';     // キーが入る欄
const fields = { expr: { c: [], i: 0 }, min: { c: [], i: 0 }, max: { c: [], i: 0 } };
let draft = null;
let world = null;        // 走らせている（走らせた）世界。null なら、ボールははじめの位置
let running = false;
let fails = 0, usedAnswer = false;
let trails = [], pops = [], lastHit = 0;
let toastTimer = 0, resetTimer = 0;

function openStage(n) {
  stage = STAGES[n - 1];
  lines = (work[n] || []).map((l) => ({ ...l }));
  built = lines.map(buildLine);
  editing = null; mode = 'y'; rangeOn = false; fnKeys = false; active = 'expr';
  for (const f of Object.values(fields)) { f.c = []; f.i = 0; }
  fails = 0; usedAnswer = false;
  stopRun(true);
  $('stageName').textContent = `ステージ ${n}`;
  $('answerBtn').hidden = true;
  $('hintText').textContent = stage.hint;
  $('hint').hidden = closedHints.has(n);
  $('err').textContent = '';
  hideToast();
  $('clear').hidden = true;
  show('play');
  renderAll();
  resize();
  focusKb();
}

function saveWork() {
  if (lines.length) work[stage.n] = lines.map((l) => ({ ...l }));
  else delete work[stage.n];
  write(KEY.work, work);
}

// ---- 入力（「かたまり」で持つ。sin( は 1 つ） ----
const CHUNK = /(?:sin|cos|tan|sqrt|abs|exp|ln|log|floor|min|max)\(|pi|\^2|./g;
const toChunks = (s) => s.replace(/\s+/g, '').match(CHUNK) || [];
const SHOW = { '*': '×', '-': '−', '/': '÷', 'sqrt(': '√(', pi: 'π', '^2': '²' };
const show1 = (c) => SHOW[c] ?? c;
const text = (f) => f.c.join('');
const prettyExpr = (s) => toChunks(s).map(show1).join('');

function insert(s) {
  const f = fields[active];
  f.c.splice(f.i, 0, s); f.i++;
  changed();
}
function backspace() {
  const f = fields[active];
  if (f.i > 0) { f.c.splice(f.i - 1, 1); f.i--; }
  changed();
}
function clearField() { const f = fields[active]; f.c = []; f.i = 0; changed(); }
function moveCaret(d) { const f = fields[active]; f.i = Math.max(0, Math.min(f.c.length, f.i + d)); renderFields(); }
function changed() { $('err').textContent = ''; updateDraft(); renderFields(); }

function rangeValue(k) {
  const s = text(fields[k]);
  return s === '' ? null : constant(s);
}
function updateDraft() {
  draft = null;
  const sm = splitMode(text(fields.expr), mode);
  if (!sm.expr.trim() || !compile(sm.expr, sm.mode === 'x' ? 'y' : 'x').ok) return;
  const dmin = rangeOn ? rangeValue('min') : null, dmax = rangeOn ? rangeValue('max') : null;
  draft = buildLine({ mode: sm.mode, expr: sm.expr, dmin: Number.isNaN(dmin) ? null : dmin, dmax: Number.isNaN(dmax) ? null : dmax });
}

function commit() {
  if (running) return;
  const sm = splitMode(text(fields.expr), mode);   // PC で「y = …」と打ったときは、その向きにする
  const expr = sm.expr.replace(/\s+/g, '');
  const bad = (msg) => { $('err').textContent = msg; sfx.bad(); };
  if (!expr) return bad('式が空');
  const r = compile(expr, sm.mode === 'x' ? 'y' : 'x');
  if (!r.ok) return bad(r.error);
  const dmin = rangeOn ? rangeValue('min') : null, dmax = rangeOn ? rangeValue('max') : null;
  if (Number.isNaN(dmin) || Number.isNaN(dmax)) return bad('範囲が読めない');
  const line = { mode: sm.mode, expr: normalize(expr), dmin, dmax };
  const b = buildLine(line);
  if (!b.paths.length) return bad('この式の線は場の外にある');
  if (editing == null && lines.length >= stage.maxFns) return bad(`引けるのは ${stage.maxFns} 本まで。チップを押して直すか ✕ で消す`);
  if (editing == null) { lines.push(line); built.push(b); } else { lines[editing] = line; built[editing] = b; }
  editing = null; mode = 'y'; rangeOn = false; active = 'expr';
  for (const f of Object.values(fields)) { f.c = []; f.i = 0; }
  draft = null;
  saveWork();
  stopRun(true);
  sfx.draw();
  renderAll();
}

function editLine(i) {
  if (editing === i) {   // もう一度押したら直すのをやめる
    editing = null;
    for (const f of Object.values(fields)) { f.c = []; f.i = 0; }
    rangeOn = false;
  } else {
    const l = lines[i];
    editing = i; mode = l.mode; active = 'expr';
    fields.expr.c = toChunks(l.expr); fields.expr.i = fields.expr.c.length;
    rangeOn = l.dmin != null || l.dmax != null;
    for (const k of ['min', 'max']) {
      const v = l[k === 'min' ? 'dmin' : 'dmax'];
      fields[k].c = v == null ? [] : toChunks(String(+v.toFixed(4))); fields[k].i = fields[k].c.length;
    }
  }
  $('err').textContent = '';
  updateDraft();
  renderAll();
}
function removeLine(i) {
  lines.splice(i, 1); built.splice(i, 1);
  if (editing === i) { editing = null; for (const f of Object.values(fields)) { f.c = []; f.i = 0; } rangeOn = false; updateDraft(); }
  else if (editing != null && editing > i) editing--;
  saveWork();
  stopRun(true);
  renderAll();
}

// ---- キーパッド（7 列 × 4 段） ----
// [入れる字, 表示, 種類]。種類: op（記号）/ fn（関数）/ act（操作）
const K = (v, label = v, kind = '') => ({ v, label, kind });
const ROWS_TOP = [
  [K('7'), K('8'), K('9'), K('/', '÷', 'op'), K('(', '(', 'op'), K(')', ')', 'op'), K('BK', '⌫', 'act')],
  [K('4'), K('5'), K('6'), K('*', '×', 'op'), K('VAR', 'x', 'op'), K('^', '^', 'op'), K('L', '◀', 'act')],
];
const ROWS_NUM = [
  [K('1'), K('2'), K('3'), K('-', '−', 'op'), K('^2', 'x²', 'op'), K('sqrt(', '√', 'fn'), K('R', '▶', 'act')],
  [K('0'), K('.'), K('pi', 'π', 'op'), K('+', '+', 'op'), K('sin(', 'sin', 'fn'), K('cos(', 'cos', 'fn'), K('FN', '関数', 'act')],
];
const ROWS_FN = [
  [K('sin(', 'sin', 'fn'), K('cos(', 'cos', 'fn'), K('tan(', 'tan', 'fn'), K('sqrt(', '√', 'fn'), K('abs(', 'abs', 'fn'), K('exp(', 'exp', 'fn'), K('ln(', 'ln', 'fn')],
  [K('log(', 'log', 'fn'), K('floor(', 'floor', 'fn'), K('min(', 'min', 'fn'), K('max(', 'max', 'fn'), K(',', ',', 'op'), K('e', 'e', 'op'), K('NUM', '123', 'act')],
];
const varName = () => (mode === 'x' ? 'y' : 'x');

function renderKeys() {
  const pad = $('keypad');
  pad.textContent = '';
  for (const row of [...ROWS_TOP, ...(fnKeys ? ROWS_FN : ROWS_NUM)]) {
    for (const k of row) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `key${k.kind ? ` key--${k.kind}` : ''}`;
      b.dataset.k = k.v;
      b.textContent = k.v === 'VAR' ? varName() : k.v === '^2' ? `${varName()}²` : k.label;
      pad.append(b);
    }
  }
}
let skipClick = false;
$('keypad').addEventListener('click', (e) => {
  const b = e.target.closest('.key');
  if (!b || running) return;
  if (skipClick) { skipClick = false; return; }
  const k = b.dataset.k;
  sfx.key();
  if (k === 'BK') backspace();
  else if (k === 'L') moveCaret(-1);
  else if (k === 'R') moveCaret(1);
  else if (k === 'FN' || k === 'NUM') { fnKeys = k === 'FN'; renderKeys(); }
  else if (k === 'VAR') insert(varName());
  else insert(k);
});
// ⌫ の長押しで全部消す
let holdTimer = 0;
$('keypad').addEventListener('pointerdown', (e) => {
  if (e.target.closest('.key')?.dataset.k !== 'BK') return;
  holdTimer = setTimeout(() => { skipClick = true; clearField(); sfx.bad(); }, 500);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('keypad').addEventListener(ev, () => clearTimeout(holdTimer));

// ---- 入力の行・範囲 ----
$('modeBtn').addEventListener('click', () => {
  sfx.ui();
  const from = varName();
  mode = mode === 'y' ? 'x' : 'y';
  // 打ってある変数も入れ替える（-x を x = … にしたら -y）
  fields.expr.c = fields.expr.c.map((c) => (c === from ? varName() : c));
  changed();
  renderAll();
});
$('rangeBtn').addEventListener('click', () => {
  sfx.ui();
  rangeOn = !rangeOn;
  active = rangeOn ? (fields.min.c.length || !fields.expr.c.length ? 'expr' : 'min') : 'expr';
  changed();
  renderAll();
});
for (const el of document.querySelectorAll('.field')) {
  el.addEventListener('click', () => { if (running) return; active = el.dataset.f; renderFields(); });
}

function renderField(el, f, on, ph) {
  el.classList.toggle('is-on', on);
  el.textContent = '';
  const caret = () => { const c = document.createElement('span'); c.className = 'caret'; return c; };
  if (!f.c.length) {
    el.append(caret());
    if (ph) { const p = document.createElement('span'); p.className = 'ph'; p.textContent = ph; el.append(p); }
    return;
  }
  f.c.forEach((c, i) => {
    if (i === f.i) el.append(caret());
    el.append(show1(c));
  });
  if (f.i === f.c.length) el.append(caret());
  el.querySelector('.caret')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
function renderFields() {
  renderField($('exprView'), fields.expr, active === 'expr', editing != null ? `${CIRCLED[editing]} を直す` : '式を入れる');
  renderField($('minView'), fields.min, active === 'min', 'なし');
  renderField($('maxView'), fields.max, active === 'max', 'なし');
}

function renderChips() {
  const box = $('chips');
  box.textContent = '';
  lines.forEach((l, i) => {
    const chip = document.createElement('div');
    chip.className = `chip${editing === i ? ' is-edit' : ''}`;
    chip.style.setProperty('--c', PALETTE[i % PALETTE.length]);
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'chip__main';
    const num = document.createElement('b');
    num.textContent = CIRCLED[i];
    main.append(num, `${l.mode} = ${prettyExpr(l.expr)}`);
    const rl = rangeLabel(l);
    if (rl) { const s = document.createElement('small'); s.textContent = rl; main.append(s); }
    let t = 0, held = false;
    main.addEventListener('pointerdown', () => { held = false; t = setTimeout(() => { held = true; sfx.bad(); removeLine(i); }, 600); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) main.addEventListener(ev, () => clearTimeout(t));
    main.addEventListener('click', () => { if (!held) { sfx.ui(); editLine(i); } });
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip__x';
    x.textContent = '✕';
    x.setAttribute('aria-label', `${CIRCLED[i]} を消す`);
    x.addEventListener('click', () => { sfx.ui(); removeLine(i); });
    chip.append(main, x);
    box.append(chip);
  });
  if (!lines.length) { const p = document.createElement('span'); p.className = 'chips__empty'; p.textContent = '引いた式がここに並ぶ'; box.append(p); }
  $('count').textContent = `${lines.length} / ${stage.maxFns} 本`;
}
function rangeLabel(l) {
  const v = l.mode === 'x' ? 'y' : 'x', f = (n) => String(+n.toFixed(2)).replace('-', '−');
  if (l.dmin != null && l.dmax != null) return `${f(l.dmin)} ≤ ${v} ≤ ${f(l.dmax)}`;
  if (l.dmin != null) return `${v} ≥ ${f(l.dmin)}`;
  if (l.dmax != null) return `${v} ≤ ${f(l.dmax)}`;
  return '';
}

function renderAll() {
  $('modeBtn').textContent = `${mode} =`;
  $('rangeBtn').setAttribute('aria-pressed', String(rangeOn));
  $('rangeRow').hidden = !rangeOn;
  $('rangeVar').textContent = `≤ ${varName()} ≤`;
  $('drawBtn').textContent = editing != null ? `${CIRCLED[editing]} を直す` : 'この式で引く';
  renderKeys();
  renderFields();
  renderChips();
  renderDots();
}
function renderDots() {
  const box = $('dots');
  box.textContent = '';
  stage.goals.forEach((_, i) => { const d = document.createElement('i'); if (world?.goals[i].got) d.className = 'on'; box.append(d); });
}

// ---- 走らせる ----
function startRun() {
  clearTimeout(resetTimer);
  hideToast();
  world = makeWorld(stage, built);
  running = true;
  trails = stage.balls.map(() => []);
  pops = [];
  sfx.start();
  renderRun();
  renderDots();
}
// reset: ボールをはじめの位置に戻す（false なら止めた所で止めておく）
function stopRun(reset) {
  clearTimeout(resetTimer);
  running = false;
  if (reset) { world = null; trails = []; pops = []; }
  renderRun();
  renderDots();
}
function renderRun() {
  $('controls').classList.toggle('is-running', running);
  $('runBtn').textContent = running ? '止める ■' : 'スタート ▶';
  $('runBtn').classList.toggle('is-stop', running);
  $('drawBtn').disabled = running;
}
$('runBtn').addEventListener('click', () => (running ? stopRun(false) : startRun()));
$('resetBtn').addEventListener('click', () => { sfx.ui(); stopRun(true); hideToast(); });
$('drawBtn').addEventListener('click', commit);

const FAIL = { fell: '落ちた', stuck: '止まった', time: '時間切れ' };
function onEnd(result) {
  running = false;
  renderRun();
  if (result === 'clear') { const sec = world.steps * DT; setTimeout(() => showClear(sec), 600); return; }
  fails++;
  sfx.fail();
  toast(FAIL[result] || '');
  if (fails >= 3) $('answerBtn').hidden = false;
  resetTimer = setTimeout(() => { world = null; trails = []; renderDots(); }, 1100);
}
function toast(msg, ms = 1100) {
  clearTimeout(toastTimer);
  $('toast').textContent = msg;
  $('toast').hidden = false;
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; }

$('answerBtn').addEventListener('click', () => {
  sfx.ui();
  lines = stage.answer.map((l) => ({ mode: l.mode, expr: l.expr, dmin: l.dmin ?? null, dmax: l.dmax ?? null }));
  built = lines.map(buildLine);
  editing = null; draft = null; rangeOn = false;
  for (const f of Object.values(fields)) { f.c = []; f.i = 0; }
  usedAnswer = true;
  saveWork();
  stopRun(true);
  renderAll();
  toast('解答例を入れた（クリアしても ★1）', 2000);
});

// ---- クリア ----
function showClear(sec) {
  const fns = lines.length;
  const stars = usedAnswer ? 1 : fns <= stage.par ? 3 : fns === stage.par + 1 ? 2 : 1;
  const old = progress.cleared[stage.n];
  progress.cleared[stage.n] = { fns: Math.min(fns, old?.fns ?? fns), stars: Math.max(stars, old?.stars ?? 0) };
  write(KEY.progress, progress);
  const last = stage.n === STAGES.length;
  $('clearTitle').textContent = last ? '全部クリア' : 'クリア';
  const st = $('clearStars');
  st.textContent = '★'.repeat(stars);
  const dim = document.createElement('span');
  dim.textContent = '★'.repeat(3 - stars);
  st.append(dim);
  st.setAttribute('aria-label', `星 ${stars} つ`);
  $('clearInfo').textContent = `式 ${fns} 本（目標 ${stage.par} 本）・${sec.toFixed(1)} 秒${usedAnswer ? '・解答例を見た' : ''}`;
  $('nextBtn').textContent = last ? 'ステージ一覧' : '次へ';
  $('listBtn').hidden = last;
  shareText = last ? 'SLOPE WRITER 全 12 ステージをクリア' : `SLOPE WRITER ステージ ${stage.n} を ${fns} 本の式でクリア（${'★'.repeat(stars)}）`;
  $('clear').hidden = false;
  // 出た直後は押せない（走りの最後に押していた指で押さないように）
  const btns = $('clear').querySelectorAll('button');
  btns.forEach((b) => { b.disabled = true; });
  setTimeout(() => btns.forEach((b) => { b.disabled = false; }), 400);
  if (last) sfx.allClear(); else sfx.clear(stars);
}
let shareText = '';
$('nextBtn').addEventListener('click', () => {
  sfx.ui();
  $('clear').hidden = true;
  if (stage.n === STAGES.length) show('title'); else openStage(stage.n + 1);
});
$('againBtn').addEventListener('click', () => { sfx.ui(); $('clear').hidden = true; stopRun(true); });
$('shareBtn').addEventListener('click', () => WebAppKit.share({ text: shareText }));
$('listBtn').addEventListener('click', () => { sfx.ui(); $('clear').hidden = true; show('title'); });

// ---- 上の帯・ヒント・遊び方 ----
$('back').addEventListener('click', () => { sfx.ui(); stopRun(true); show('title'); });
$('hintClose').addEventListener('click', () => { closedHints.add(stage.n); $('hint').hidden = true; });
$('helpBtn').addEventListener('click', () => { sfx.ui(); $('help').hidden = false; });
$('helpClose').addEventListener('click', () => { sfx.ui(); $('help').hidden = true; });

// ---- PC のキーボード ----
// 全角や日本語入力の字は keydown では来ないので、見えない欄で受ける。
// スマホで欄にふれると端末のキーボードが出るので、マウスの端末だけで使う
const kb = $('kb');
const finePointer = matchMedia('(pointer: fine)');
const focusKb = () => { if (finePointer.matches && !$('play').hidden) kb.focus({ preventScroll: true }); };
$('play').addEventListener('click', focusKb);
function typeText(str) {
  if (running) return;
  const s = normalize(str);
  if (!/^[0-9a-z.+\-*/^(),= ]+$/.test(s)) return;
  for (const c of s === '^2' ? ['^2'] : s.replace(/ /g, '')) insert(c);
}
function takeKb() { const v = kb.value; kb.value = ''; if (v) typeText(v); }
kb.addEventListener('input', (e) => { if (!e.isComposing) takeKb(); });
kb.addEventListener('compositionend', takeKb);

addEventListener('keydown', (e) => {
  if ($('play').hidden || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  if (!$('help').hidden) { if (e.key === 'Escape') $('help').hidden = true; return; }
  if (!$('clear').hidden) return;
  if (e.key === ' ') {
    e.preventDefault();
    if (!text(fields[active])) $('runBtn').click();   // 打っている途中の空白は無視
    return;
  }
  if (running) return;
  if (e.key === 'Enter') { e.preventDefault(); commit(); }
  else if (e.key === 'Escape') clearField();
  else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
  else if (e.key === 'ArrowLeft') moveCaret(-1);
  else if (e.key === 'ArrowRight') moveCaret(1);
  else if (e.key.length === 1 && document.activeElement !== kb) { e.preventDefault(); typeText(e.key); }
});

// ---- 盤を描く ----
const cv = $('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, k = 1;
const sx = (x) => (x - X0) * k, sy = (y) => (Y1 - y) * k;

function resize() {
  const r = $('board').getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(3, devicePixelRatio || 1);
  W = r.width; H = r.height; k = W / 20;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe($('board'));

function strokePaths(paths, color, width, dash) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of paths) {
    ctx.beginPath();
    ctx.moveTo(sx(p[0]), sy(p[1]));
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(sx(p[i]), sy(p[i + 1]));
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function draw(now) {
  ctx.fillStyle = '#0d1330';
  ctx.fillRect(0, 0, W, H);
  // 方眼（1 ごと）と軸
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(150, 170, 255, 0.09)';
  ctx.beginPath();
  for (let x = -9; x <= 9; x++) { ctx.moveTo(Math.round(sx(x)) + 0.5, 0); ctx.lineTo(Math.round(sx(x)) + 0.5, H); }
  for (let y = -6; y <= 6; y++) { ctx.moveTo(0, Math.round(sy(y)) + 0.5); ctx.lineTo(W, Math.round(sy(y)) + 0.5); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(170, 185, 255, 0.32)';
  ctx.beginPath();
  ctx.moveTo(Math.round(sx(0)) + 0.5, 0); ctx.lineTo(Math.round(sx(0)) + 0.5, H);
  ctx.moveTo(0, Math.round(sy(0)) + 0.5); ctx.lineTo(W, Math.round(sy(0)) + 0.5);
  ctx.stroke();
  ctx.fillStyle = 'rgba(170, 185, 255, 0.45)';
  ctx.font = `${Math.max(9, k * 0.5)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const x of [-5, 5]) ctx.fillText(String(x).replace('-', '−'), sx(x), sy(0) + 3);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const y of [-5, 5]) ctx.fillText(String(y).replace('-', '−'), sx(0) + 4, sy(y));

  // 障害物（赤）
  for (const w of stage.walls) {
    if (w.box) {
      const [x, y, bw, bh] = w.box;
      ctx.fillStyle = 'rgba(255, 77, 94, 0.85)';
      ctx.fillRect(sx(x), sy(y + bh), bw * k, bh * k);
    } else {
      ctx.strokeStyle = 'rgba(255, 77, 94, 0.9)'; ctx.lineWidth = (w.w ?? 0.4) * k; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx(w.a[0]), sy(w.a[1])); ctx.lineTo(sx(w.b[0]), sy(w.b[1])); ctx.stroke();
    }
  }

  // 自分の線と下書き
  const lw = Math.max(2.5, 0.14 * k);
  built.forEach((b, i) => {
    const c = PALETTE[i % PALETTE.length];
    const dim = editing === i && draft;
    ctx.globalAlpha = dim ? 0.25 : 1;
    ctx.shadowColor = c; ctx.shadowBlur = dim ? 0 : 6;
    strokePaths(b.paths, c, lw);
    ctx.shadowBlur = 0;
    ctx.fillStyle = c;
    for (const [x, y] of b.ends) { ctx.beginPath(); ctx.arc(sx(x), sy(y), lw * 1.3, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  });
  if (draft && !running) {
    const c = PALETTE[(editing ?? lines.length) % PALETTE.length];
    ctx.globalAlpha = 0.85;
    strokePaths(draft.paths, c, Math.max(2, lw * 0.8), [7, 6]);
    ctx.globalAlpha = 1;
  }

  // ゴール（丸い点。取ると光ってはじける）
  stage.goals.forEach((g, i) => {
    const x = sx(g.x), y = sy(g.y);
    if (world?.goals[i].got) {
      const t = (now - (pops[i] ?? now)) / 450;
      if (t < 1 && !reduced.matches) {
        ctx.strokeStyle = `rgba(127, 255, 212, ${1 - t})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, GOAL_R * k * (1 + t * 1.6), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(127, 255, 212, 0.25)';
      ctx.beginPath(); ctx.arc(x, y, 0.12 * k, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.strokeStyle = 'rgba(127, 255, 212, 0.45)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, GOAL_R * k, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#7fffd4'; ctx.shadowColor = '#7fffd4'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(x, y, 0.14 * k, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  });

  // ボール（あかりのような玉）と通った跡
  const balls = world ? world.balls : stage.balls;
  trails.forEach((tr) => {
    for (let i = 1; i < tr.length; i++) {
      ctx.strokeStyle = `rgba(255, 211, 92, ${(i / tr.length) * 0.35})`; ctx.lineWidth = BALL_R * k * (i / tr.length);
      ctx.beginPath(); ctx.moveTo(sx(tr[i - 1][0]), sy(tr[i - 1][1])); ctx.lineTo(sx(tr[i][0]), sy(tr[i][1])); ctx.stroke();
    }
  });
  for (const b of balls) {
    if (b.dead) continue;
    const x = sx(b.x), y = sy(b.y), r = BALL_R * k;
    const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.4);
    glow.addColorStop(0, 'rgba(255, 211, 92, 0.45)'); glow.addColorStop(1, 'rgba(255, 211, 92, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
    const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    body.addColorStop(0, '#fff7d6'); body.addColorStop(1, '#ffc93a');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? (now - last) / 1000 : 0;
  last = now;
  if ($('play').hidden || !W) return;
  if (running && world) {
    advance(world, dt);
    for (const ev of world.events) {
      if (ev.type === 'hit' && now - lastHit > 100) { lastHit = now; sfx.hit(ev.v); }
      if (ev.type === 'goal') { pops[ev.i] = now; sfx.goal(ev.n); renderDots(); }
    }
    world.events.length = 0;
    world.balls.forEach((b, i) => { if (!b.dead) { trails[i].push([b.x, b.y]); if (trails[i].length > 24) trails[i].shift(); } });
    if (world.result !== 'running') onEnd(world.result);
  }
  draw(now);
}
requestAnimationFrame(frame);

renderSound();
show('title');
