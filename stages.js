// ステージ。想定解（answer）で実際に転がして、通った所にゴールを置いた（test.mjs で確かめる）。
// balls: はじめの位置 / goals: 点 / walls: 赤い障害物（physics.js の wallSegs）/ time: 制限時間（秒）
// maxFns: 引ける本数 / par: 目標の本数（★3）/ noLine: 直線 1 本では解けない（test.mjs で総当たり）
const FLOOR_L = { a: [-10, -6], b: [-1, -6] }, FLOOR_R = { a: [8, -6], b: [10, -6] }, ROOF = { box: [0, -1, 10, 0.5] };

export const STAGES = [
  {
    n: 1, name: 'はじめの坂', maxFns: 1, par: 1, time: 20,
    hint: '下のキーで -x と入れて「この式で引く」、それから「スタート」。',
    balls: [{ x: -5, y: 6.5 }], walls: [],
    goals: [{ x: -1.1, y: 1.5 }, { x: 4, y: -3.6 }],
    answer: [{ mode: 'y', expr: '-x' }],
  },
  {
    n: 2, name: '台地の上', maxFns: 2, par: 1, time: 22,
    hint: '台地にぶつからない傾きで。x の前の数が傾き。',
    balls: [{ x: -6, y: 5.5 }], walls: [{ box: [-10, -6, 9, 4] }],
    goals: [{ x: -3, y: 1.1 }, { x: 0.9, y: -1.2 }, { x: 5.1, y: -3.8 }],
    answer: [{ mode: 'y', expr: '-0.6x-1' }],
  },
  {
    n: 3, name: '壁をこえる', maxFns: 2, par: 1, time: 24,
    hint: '赤い壁の上を通る高さに。うしろに足す数（切片）で線が上下する。',
    balls: [{ x: -7, y: 6 }], walls: [{ a: [-3, -6], b: [-3, 1] }],
    goals: [{ x: -4.9, y: 3.2 }, { x: -0.1, y: -0.2 }, { x: 5.2, y: -3.9 }],
    answer: [{ mode: 'y', expr: '-0.7x-0.6' }],
  },
  {
    n: 4, name: 'すき間へ', maxFns: 2, par: 1, time: 24,
    hint: '「範囲」で坂を途中で終わらせて、2 本の壁のあいだへ落とそう。',
    balls: [{ x: -7, y: 5.5 }], walls: [{ a: [1, -6], b: [1, 0] }, { a: [4, -6], b: [4, 0] }],
    goals: [{ x: -3, y: 3 }, { x: 2.5, y: -3.8 }],
    answer: [{ mode: 'y', expr: '-0.5x+1.2', dmax: 2.2 }],
  },
  {
    n: 5, name: '点を通す', maxFns: 2, par: 1, time: 26,
    hint: '線が点の近くを通れば取れる。2 つの点を通る坂は？',
    balls: [{ x: -8, y: 5.5 }], walls: [],
    goals: [{ x: -0.9, y: -0.8 }, { x: 6, y: -4.2 }],
    answer: [{ mode: 'y', expr: '-0.5x-1.5' }],
  },
  {
    n: 6, name: 'ふたつのボール', maxFns: 2, par: 1, time: 26,
    hint: 'ボールが 2 つ。abs(x) は左右対称の V の字。',
    balls: [{ x: -6, y: 5 }, { x: 6, y: 5 }], walls: [],
    goals: [{ x: -4, y: 0.4 }, { x: -1.5, y: -2.1 }, { x: 1.5, y: -2.1 }, { x: 4, y: 0.4 }],
    answer: [{ mode: 'y', expr: 'abs(x)-4' }],
  },
  {
    n: 7, name: '波の道', maxFns: 2, par: 1, time: 30, noLine: true,
    hint: '直線では全部は通れない。sin(x) を足すと坂が波打つ。',
    balls: [{ x: -8.5, y: 6.3 }], walls: [],
    goals: [{ x: -7.1, y: 4.2 }, { x: -4.5, y: 4.1 }, { x: -1.4, y: 0.7 }, { x: 1.5, y: -0.8 }],
    answer: [{ mode: 'y', expr: 'sin(x)-0.8x-1' }],
  },
  {
    n: 8, name: 'すりばち', maxFns: 2, par: 1, time: 28, noLine: true,
    hint: '谷で勢いをつけて、向こう側の高い点まで登らせよう。x² の出番。',
    balls: [{ x: -6, y: 5.5 }], walls: [{ a: [2.5, 7], b: [2.5, 0.5] }],
    goals: [{ x: -2, y: -3.7 }, { x: 5.1, y: 1.7 }],
    answer: [{ mode: 'y', expr: '0.22x^2-5' }],
  },
  {
    n: 9, name: '縦の線', maxFns: 2, par: 2, time: 26,
    hint: '左の「y =」を押すと「x =」になる。x = 4 は縦の線。飛んだボールを受け止めよう。',
    balls: [{ x: -8, y: 6.8 }], walls: [{ a: [-10, -6], b: [4.4, -6] }, { a: [0, -6], b: [0, 1.5] }],
    goals: [{ x: -4, y: 3.8 }, { x: 3.3, y: -0.1 }, { x: 1.4, y: -5.3 }],
    answer: [{ mode: 'y', expr: '-0.42x+1.9', dmax: 2 }, { mode: 'x', expr: '4', dmin: -6, dmax: 2 }],
  },
  {
    n: 10, name: '天井の下', maxFns: 3, par: 2, time: 28,
    hint: '天井の下はすき間。手前で高さを下げて、もう 1 本で渡ろう。',
    balls: [{ x: -8, y: 5.5 }], walls: [FLOOR_L, FLOOR_R, ROOF],
    goals: [{ x: -6.9, y: 3.3 }, { x: -5.5, y: 1.9 }, { x: 2.9, y: -2.8 }, { x: 8.3, y: -4.7 }],
    answer: [{ mode: 'y', expr: '-x-4', dmax: -4 }, { mode: 'y', expr: '-0.35x-2', dmin: -5 }],
  },
  {
    n: 11, name: 'わかれ道', maxFns: 3, par: 2, time: 28,
    hint: 'ボールを左右へ。範囲で終わらせた坂を 2 本。坂の先で落とす。',
    balls: [{ x: -2, y: 5.5 }, { x: 2, y: 5.5 }], walls: [{ a: [0, 3], b: [0, -6] }],
    goals: [{ x: -3.3, y: -1.1 }, { x: -6.7, y: -4.9 }, { x: 3.1, y: -2.3 }, { x: 6.6, y: -4.6 }],
    answer: [{ mode: 'y', expr: 'x+1', dmin: -4, dmax: -0.6 }, { mode: 'y', expr: '-0.5x-1', dmin: 0.6, dmax: 3.5 }],
  },
  {
    n: 12, name: 'おりかえし', maxFns: 3, par: 2, time: 32,
    hint: '右へ転がして、下の坂で左へ折り返そう。坂を範囲で終わらせるのがこつ。',
    balls: [{ x: -8, y: 6.5 }], walls: [],
    goals: [{ x: -5, y: 2.7 }, { x: 1.4, y: 0.4 }, { x: 5, y: -1.8 }, { x: -4, y: -5.3 }],
    answer: [{ mode: 'y', expr: '-0.3x+1', dmax: -1 }, { mode: 'y', expr: '0.4x-4', dmin: -6, dmax: 9 }],
  },
];
