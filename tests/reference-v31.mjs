const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function prismSolid(quadA, quadB, tag) {
  const raw = [];
  raw.push([quadA[0], quadA[1], quadA[2]], [quadA[0], quadA[2], quadA[3]]);
  raw.push([quadB[0], quadB[2], quadB[1]], [quadB[0], quadB[3], quadB[2]]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    raw.push([quadA[i], quadA[j], quadB[j]], [quadA[i], quadB[j], quadB[i]]);
  }
  const c = [0, 0, 0];
  for (const p of [...quadA, ...quadB]) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= 8; c[1] /= 8; c[2] /= 8;
  const tris = [];
  for (const [a, b, d] of raw) {
    const n = cross(sub(b, a), sub(d, a));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-7) continue;
    const tc = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3];
    tris.push(dot(n, sub(tc, c)) < 0 ? [a, d, b] : [a, b, d]);
  }
  return { tris, tag };
}

function boxSolid(cx, cy, cz, sx, sy, sz, tag) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  return prismSolid(
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    tag
  );
}

// Пандус (наклон грани стенки внутрь ячейки). Задняя грань заглубляется
// в тело стенки на embed, чтобы пандус сращивался с ней даже при тейпере.
function rampSolid(orient, facePos, dir, s0, s1, yTop, yBot, run, embed, tag) {
  const front = facePos + run * dir;
  const back = facePos - embed * dir;
  let quadA, quadB;
  if (orient === "x") {
    quadA = [[back, yBot, s0], [back, yTop, s0], [facePos, yTop, s0], [front, yBot, s0]];
    quadB = [[back, yBot, s1], [back, yTop, s1], [facePos, yTop, s1], [front, yBot, s1]];
  } else {
    quadA = [[s0, yBot, back], [s0, yTop, back], [s0, yTop, facePos], [s0, yBot, front]];
    quadB = [[s1, yBot, back], [s1, yTop, back], [s1, yTop, facePos], [s1, yBot, front]];
  }
  return prismSolid(quadA, quadB, tag);
}

// Профиль стенки поперёк её оси. Толщина НЕ меняется по высоте; верхняя
// кромка скругляется радиусом rnd — дуга аппроксимируется 7 сегментами
// (стопка выпуклых трапеций). symmetric: у перегородки скругляются оба
// верхних угла (при rnd = толщина/2 получается полный полукруглый валик);
// у внешней стенки скругляется только внутренний угол — наружная плоскость
// остаётся идеально ровной для плотной стыковки и пазов соединителей.
const ARC_SEGS = 7;
function wallProfile(thk, h, rnd, symmetric) {
  const r = Math.max(0, Math.min(rnd, symmetric ? thk / 2 : thk - 0.4, h * 0.9));
  const parts = [];
  if (r < 0.05) {
    if (symmetric) parts.push([[-thk / 2, 0], [thk / 2, 0], [thk / 2, h], [-thk / 2, h]]);
    else parts.push([[0, 0], [thk, 0], [thk, h], [0, h]]);
    return parts;
  }
  const hb = h - r;
  if (symmetric) {
    const h0 = thk / 2, core = h0 - r;
    parts.push([[-h0, 0], [h0, 0], [h0, hb], [-h0, hb]]);
    let prevW = h0, prevY = hb;
    for (let k = 1; k <= ARC_SEGS; k++) {
      const t = (k / ARC_SEGS) * (Math.PI / 2);
      const wHalf = Math.max(core + r * Math.cos(t), 0.05);
      const y = hb + r * Math.sin(t);
      parts.push([[-prevW, prevY], [prevW, prevY], [wHalf, y], [-wHalf, y]]);
      prevW = wHalf; prevY = y;
    }
  } else {
    const core = thk - r;
    parts.push([[0, 0], [thk, 0], [thk, hb], [0, hb]]);
    let prevIn = thk, prevY = hb;
    for (let k = 1; k <= ARC_SEGS; k++) {
      const t = (k / ARC_SEGS) * (Math.PI / 2);
      const inn = core + r * Math.cos(t);
      const y = hb + r * Math.sin(t);
      parts.push([[0, prevY], [prevIn, prevY], [inn, y], [0, y]]);
      prevIn = inn; prevY = y;
    }
  }
  return parts;
}

// ── «Ласточкин хвост» ЦЕЛИКОМ внутри толщины внешней стенки ──
// Паз не выступает ни внутрь ячейки, ни наружу; стенки соседей
// смыкаются вплотную. Требование: внешняя стенка ≥ minWall.
const CONN = { w1: 5.5, w2: 8.5, depth: 1.7, clr: 0.25, back: 0.85, stop: 3, flank: 2.5 };
CONN.dg = CONN.depth + CONN.clr;               // глубина паза
CONN.minWall = CONN.dg + CONN.back;            // 2.8 мм — минимум внешней стенки
CONN.bossW = CONN.w2 + 2 * CONN.clr + 2 * CONN.flank; // ширина зоны соединителя

const connectorVs = (dim) => (dim < 90 ? [0] : [-dim / 4, dim / 4]);

function splitRange(a, b, zones) {
  const out = [];
  let cur = a;
  for (const [z0, z1] of zones) {
    if (z1 <= a || z0 >= b) continue;
    if (z0 > cur) out.push([cur, Math.min(z0, b)]);
    cur = Math.max(cur, z1);
  }
  if (cur < b) out.push([cur, b]);
  return out.filter(([p, q]) => q - p > 0.05);
}

// заполнение оси ячейками целевого размера: последняя забирает остаток
// (от одного до двух целевых размеров), как в логике раскладки
function fillAxis(inner, wall, target) {
  const t = Math.max(10, target);
  const cells = [];
  let remain = inner;
  while (remain >= 2 * t + wall && cells.length < 23) {
    cells.push(t);
    remain -= t + wall;
  }
  cells.push(Math.max(10, remain));
  return cells;
}

function layout(c) {
  const innerW = c.W - 2 * c.wallOut;
  const innerD = c.D - 2 * c.wallOut;
  let colWs, rowDs;
  if (c.gridMode === "size") {
    colWs = fillAxis(innerW, c.wall, c.cellWt || 40);
    rowDs = fillAxis(innerD, c.wall, c.cellDt || 40);
  } else {
    colWs = Array.from({ length: c.cols }, () => (innerW - (c.cols - 1) * c.wall) / c.cols);
    rowDs = Array.from({ length: c.rows }, () => (innerD - (c.rows - 1) * c.wall) / c.rows);
  }
  const pref = (arr) => { const p = [0]; for (const v of arr) p.push(p[p.length - 1] + v); return p; };
  const pw = pref(colWs), pd = pref(rowDs);
  const clampI = (arr, k) => arr[Math.max(0, Math.min(arr.length - 1, k))];
  return {
    innerW, innerD, colWs, rowDs,
    nCols: colWs.length, nRows: rowDs.length,
    cx0: (i) => -innerW / 2 + pw[Math.max(0, Math.min(colWs.length, i))] + i * c.wall,
    cz0: (j) => -innerD / 2 + pd[Math.max(0, Math.min(rowDs.length, j))] + j * c.wall,
    cw: (i) => clampI(colWs, i),
    cd: (j) => clampI(rowDs, j),
    cellW: colWs[0], cellD: rowDs[0],
  };
}

const defWall = (c) => ({ h: c.H, t1: 0, t2: 0, rnd: 0, drop: "none", dropH: 3, face: "solid", hexSize: 8, lineStep: 14, seed: 1 });
function getWall(c, key) {
  const w = c.walls[key];
  if (!w) return defWall(c);
  // высота может превышать H контейнера (башенка-ячейка); потолок — лимит принтера
  return { h: w.h ?? c.H, t1: w.t1 ?? 0, t2: w.t2 ?? 0, rnd: w.rnd ?? 0, drop: w.drop ?? "none", dropH: w.dropH ?? 3, face: w.face ?? "solid", hexSize: w.hexSize ?? 8, lineStep: w.lineStep ?? 14, seed: w.seed ?? 1 };
}

// уровень пола ячейки (лесенка), мм от дна контейнера
const getCellLvl = (c, i, j) => (c.cells && c.cells[i + ":" + j] && c.cells[i + ":" + j].lvl) || 0;

// все сегменты одной линии (для выделения перегородки целиком)
function lineOf(c, key) {
  const parts = key.split(":");
  const Lc = layout(c);
  if (parts[0] === "o") {
    const side = parts[1];
    const n = side === "n" || side === "s" ? Lc.nCols : Lc.nRows;
    const names = { n: "ближняя", s: "дальняя", w: "левая", e: "правая" };
    return {
      keys: Array.from({ length: n }, (_, k) => `o:${side}:${k}`),
      label: `Внешняя стенка целиком (${names[side]})`,
      outer: true,
    };
  }
  if (parts[0] === "v") {
    const i = +parts[1];
    return {
      keys: Array.from({ length: Lc.nRows }, (_, j) => `v:${i}:${j}`),
      label: `Перегородка целиком (после колонки ${i + 1})`,
      outer: false,
    };
  }
  const j = +parts[1];
  return {
    keys: Array.from({ length: Lc.nCols }, (_, i) => `h:${j}:${i}`),
    label: `Перегородка целиком (после ряда ${j + 1})`,
    outer: false,
  };
}

// Соединительные узлы одной стороны. male: рельс, выступающий наружу и
// входящий в паз соседа. female: паз, вырезанный ВНУТРИ толщины внешней
// стенки (упор снизу + задний слой + две щёчки-ласточки). Внутренняя грань
// стенки не меняется — ячейки остаются ровно заданного размера, а наружные
// плоскости соседей смыкаются вплотную по всей длине.
function addConnUnits(solids, c, side, vs) {
  const { W, D, H, wallOut } = c;
  const dg = CONN.dg;
  const axis = side === "E" || side === "W" ? "x" : "z";
  const s = side === "E" || side === "S" ? 1 : -1;
  const p = axis === "x" ? (s * W) / 2 : (s * D) / 2;
  const male = side === "E" || side === "S";
  const mk = (u, y, v) => (axis === "x" ? [u, y, v] : [v, y, u]);

  for (const vc of vs) {
    if (male) {
      const u0 = p - s * 0.6, u1 = p + s * CONN.depth;
      const q = (y) => [
        mk(u0, y, vc - CONN.w1 / 2), mk(u0, y, vc + CONN.w1 / 2),
        mk(u1, y, vc + CONN.w2 / 2), mk(u1, y, vc - CONN.w2 / 2),
      ];
      solids.push(prismSolid(q(CONN.stop + CONN.clr), q(H), "conn"));
    } else {
      const uAt = (t) => p - s * t; // t — глубина от наружной плоскости внутрь стенки
      const pushBox = (t0, t1, y0, y1, v0, v1) => {
        const cu = (uAt(t0) + uAt(t1)) / 2, su = Math.abs(t1 - t0);
        const cv = (v0 + v1) / 2, sv = v1 - v0;
        if (axis === "x") solids.push(boxSolid(cu, (y0 + y1) / 2, cv, su, y1 - y0, sv, "conn"));
        else solids.push(boxSolid(cv, (y0 + y1) / 2, cu, sv, y1 - y0, su, "conn"));
      };
      pushBox(0, wallOut, 0, CONN.stop, vc - CONN.bossW / 2, vc + CONN.bossW / 2); // упор снизу
      pushBox(dg, wallOut, CONN.stop, H, vc - CONN.bossW / 2, vc + CONN.bossW / 2); // задний слой (дно паза)
      const cw1 = CONN.w1 / 2 + CONN.clr, cw2 = CONN.w2 / 2 + CONN.clr;
      for (const sg of [-1, 1]) {
        const q = (y) => [
          mk(uAt(0), y, vc + (sg * CONN.bossW) / 2),
          mk(uAt(dg), y, vc + (sg * CONN.bossW) / 2),
          mk(uAt(dg), y, vc + sg * cw2),
          mk(uAt(0), y, vc + sg * cw1),
        ];
        solids.push(prismSolid(q(CONN.stop), q(H), "conn"));
      }
    }
  }
}

// ── Полная сборка контейнера. conn = {N,S,W,E: {male, vs} | null} ──
function buildContainer(c, conn) {
  const { W, D, H, cols, rows, wall, wallOut, floor } = c;
  const L = layout(c);
  const solids = [];
  const tan = (deg) => Math.tan((deg * Math.PI) / 180);

  const zonesOf = (side) =>
    conn[side]
      ? conn[side].vs
          .map((vc) => [vc - CONN.bossW / 2, vc + CONN.bossW / 2])
          .sort((a, b) => a[0] - b[0])
      : [];
  const zN = zonesOf("N"), zS = zonesOf("S"), zW = zonesOf("W"), zE = zonesOf("E");

  const addRamp = (orient, facePos, dir, s0, s1, h, tilt, cellSize, embed, thk, wc, yBase, tag) => {
    if (tilt < 0.5 || h <= yBase + 0.3) return;
    const run = Math.min((h - yBase) * tan(tilt), cellSize * 0.45);
    if (run < 0.15) return;
    if (wc.face === "hex") buildHexRamp(orient, facePos, dir, s0, s1, h, yBase, run, thk, wc.hexSize, embed, tag);
    else if (wc.face === "lines") buildLinesRamp(orient, facePos, dir, s0, s1, h, yBase, run, thk, wc, embed, tag);
    else solids.push(rampSolid(orient, facePos, dir, s0, s1, h, yBase, run, embed, tag));
  };

  // экструзия профиля стенки вдоль отрезка s0..s1; mapFn(смещение, y, s) → точка
  const pushProfiled = (parts, mapFn, s0, s1, tag) => {
    for (const quad of parts) {
      const qa = quad.map(([o, y]) => mapFn(o, y, s0));
      const qb = quad.map(([o, y]) => mapFn(o, y, s1));
      solids.push(prismSolid(qa, qb, tag));
    }
  };

  // высота кромки в точке frac (0..1) вдоль сегмента: спуск четверть-эллипсом —
  // горизонтальный старт на высоком конце, почти вертикальный финиш (как дуга,
  // нарисованная пользователем)
  const heightAt = (frac, h, drop, dropH) => {
    if (drop === "none") return h;
    const t = drop === "b" ? frac : 1 - frac; // t=0 — высокий конец
    return h - (h - dropH) * (1 - Math.cos((t * Math.PI) / 2));
  };

  // тело стенки с учётом спуска кромки: сегмент режется на ломтики вдоль
  // длины, каждый ломтик — призма между профилями двух соседних высот.
  // S0..S1 — полный пролёт сегмента (для непрерывности дуги через вырезы зон)
  const pushWallBody = (key, wc, thk, sym, s0, s1, S0, S1, mapFn) => {
    const dropH = Math.min(wc.dropH, wc.h);
    if (wc.drop === "none" || wc.h - dropH < 0.3) {
      pushProfiled(wallProfile(thk, wc.h, wc.rnd, sym), mapFn, s0, s1, key);
      return;
    }
    const N = 12;
    const span = S1 - S0 || 1;
    for (let k = 0; k < N; k++) {
      const sa = s0 + ((s1 - s0) * k) / N;
      const sb = s0 + ((s1 - s0) * (k + 1)) / N;
      const h0 = Math.max(0.4, heightAt((sa - S0) / span, wc.h, wc.drop, dropH));
      const h1 = Math.max(0.4, heightAt((sb - S0) / span, wc.h, wc.drop, dropH));
      const pa = wallProfile(thk, h0, wc.rnd, sym);
      const pb = wallProfile(thk, h1, wc.rnd, sym);
      for (let q = 0; q < Math.max(pa.length, pb.length); q++) {
        const qa = (pa[q] ?? pa[pa.length - 1]).map(([o, y]) => mapFn(o, y, sa));
        const qb = (pb[q] ?? pb[pb.length - 1]).map(([o, y]) => mapFn(o, y, sb));
        solids.push(prismSolid(qa, qb, key));
      }
    }
  };

  // Сотовая стенка: рамка (низ/верх/бока) + гексагональная решётка из
  // брусков. Гексы вершиной вверх: потолки отверстий — два ската по 60°,
  // печатается вертикально без поддержек. Верхний пояс несёт скругление.
  const buildHexWall = (key, wc, thk, sym, s0, s1, mapFn) => {
    const strut = Math.max(1.2, Math.min(2.2, thk));
    const oA = sym ? -thk / 2 : 0, oB = sym ? thk / 2 : thk;
    const rect = (sa, sb, ya, yb) => {
      const q = [[sa, ya], [sb, ya], [sb, yb], [sa, yb]];
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    };
    const railSide = 2.5;
    const yA = floor + 3;
    const parts = wallProfile(thk, wc.h, wc.rnd, sym);
    const yB = Math.min(wc.h - 3.5, parts.length > 1 ? parts[0][2][1] : wc.h - 3.5);
    const sA = s0 + railSide, sB = s1 - railSide;
    if (sB - sA < wc.hexSize * 0.9 || yB - yA < wc.hexSize * 0.9) {
      // окно слишком маленькое — сплошная стенка
      pushProfiled(parts, mapFn, s0, s1, key);
      return;
    }
    // рамка
    rect(s0, s1, 0, yA); // нижний пояс
    const topParts = parts.map((q, qi) => (qi === 0 ? q.map(([o, y]) => [o, y === 0 ? yB : y]) : q));
    pushProfiled(topParts, mapFn, s0, s1, key); // верхний пояс (со скруглением)
    rect(s0, sA, yA, yB);
    rect(sB, s1, yA, yB); // боковые пояса
    // решётка
    const clipSeg = (P1, P2) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - sA, sB - P1[0], P1[1] - yA, yB - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return [[P1[0] + t0 * dx, P1[1] + t0 * dy], [P1[0] + t1 * dx, P1[1] + t1 * dy]];
    };
    const bar = (P1, P2) => {
      const c2 = clipSeg(P1, P2);
      if (!c2) return;
      const [A, B] = c2;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.4) return;
      const nx = (-dy / len) * (strut / 2), ny = (dx / len) * (strut / 2);
      const q = [[A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny]];
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    };
    const Whex = wc.hexSize;               // ширина соты между вертикальными гранями
    const R = Whex / Math.sqrt(3);         // радиус до вершины
    // только ЦЕЛЫЕ ряды сот по высоте: неполный верхний ряд не рисуется,
    // остаток до верхнего пояса заливается пластиком
    let rows = 0;
    while (yA + R + rows * 1.5 * R + R <= yB + 0.01) rows++;
    if (rows < 1) {
      pushProfiled(parts.map((q, qi) => (qi === 0 ? q.map(([o, y]) => [o, y === 0 ? yA : y]) : q)), mapFn, s0, s1, key);
      return;
    }
    const colsN = Math.ceil((sB - sA) / Whex) + 2;
    for (let r = 0; r < rows; r++) {
      const yc = yA + R + r * 1.5 * R;
      const shift = r % 2 === 1 ? Whex / 2 : 0;
      for (let ci = -1; ci < colsN; ci++) {
        const sc = sA + Whex / 2 + ci * Whex + shift;
        const V = [
          [sc, yc + R], [sc + Whex / 2, yc + R / 2], [sc + Whex / 2, yc - R / 2],
          [sc, yc - R], [sc - Whex / 2, yc - R / 2], [sc - Whex / 2, yc + R / 2],
        ];
        for (let e = 0; e < 6; e++) bar(V[e], V[(e + 1) % 6]);
      }
    }
    // заливка над последним целым рядом: клинья между вершинами + сплошная полоса
    const yTip = yA + R + (rows - 1) * 1.5 * R + R;
    const yValley = yTip - R / 2;
    const shiftN = rows % 2 === 1 ? Whex / 2 : 0;
    const oA2 = sym ? -thk / 2 : 0, oB2 = sym ? thk / 2 : thk;
    for (let ci = -1; ci < colsN + 1; ci++) {
      const sc = sA + Whex / 2 + ci * Whex + shiftN;
      const P = [[sc, yValley], [sc - Whex / 2, yTip], [sc + Whex / 2, yTip]]
        .map(([sv, yv]) => [Math.min(sB, Math.max(sA, sv)), yv]);
      if (Math.max(P[0][0], P[1][0], P[2][0]) - Math.min(P[0][0], P[1][0], P[2][0]) < 0.3) continue;
      const q = [P[0], P[1], P[2], P[2]];
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA2, yv, sv)), q.map(([sv, yv]) => mapFn(oB2, yv, sv)), key));
    }
    if (yB - yTip > 0.05) rect(sA, sB, yTip, yB);
  };

  // Стенка с фоном из изогнутых случайных линий: рамка как у сот + два
  // семейства волнистых диагональных прядей (±45°, печатаются без поддержек).
  // Узор детерминированный: сид зависит от стенки; «перемешать» меняет сид.
  const buildLinesWall = (key, wc, thk, sym, s0, s1, mapFn) => {
    const strut = Math.max(1.2, Math.min(2.2, thk));
    const oA = sym ? -thk / 2 : 0, oB = sym ? thk / 2 : thk;
    const rect = (sa, sb, ya, yb) => {
      const q = [[sa, ya], [sb, ya], [sb, yb], [sa, yb]];
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    };
    const railSide = 2.5;
    const yA = floor + 3;
    const parts = wallProfile(thk, wc.h, wc.rnd, sym);
    const yB = Math.min(wc.h - 3.5, parts.length > 1 ? parts[0][2][1] : wc.h - 3.5);
    const sA = s0 + railSide, sB = s1 - railSide;
    const sp = Math.max(4, wc.lineStep);
    if (sB - sA < sp || yB - yA < sp) {
      pushProfiled(parts, mapFn, s0, s1, key);
      return;
    }
    rect(s0, s1, 0, yA);
    const topParts = parts.map((q, qi) => (qi === 0 ? q.map(([o, y]) => [o, y === 0 ? yB : y]) : q));
    pushProfiled(topParts, mapFn, s0, s1, key);
    rect(s0, sA, yA, yB);
    rect(sB, s1, yA, yB);
    const clipSeg = (P1, P2) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - sA, sB - P1[0], P1[1] - yA, yB - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return [[P1[0] + t0 * dx, P1[1] + t0 * dy], [P1[0] + t1 * dx, P1[1] + t1 * dy]];
    };
    const bar = (P1, P2) => {
      const c2 = clipSeg(P1, P2);
      if (!c2) return;
      const [A, B] = c2;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.4) return;
      const nx = (-dy / len) * (strut / 2), ny = (dx / len) * (strut / 2);
      const q = [[A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny]];
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    };
    // расширенное окно клипа: концы прядей заходят вглубь поясов рамки
    // и сращиваются с ними — без зазоров на стыке
    const ext = 2.3;
    const sAe = sA - ext, sBe = sB + ext;
    const hbTop = parts.length > 1 ? parts[0][2][1] : wc.h;
    const yAe = Math.max(0.4, yA - 2.6);
    const yBe = Math.min(yB + 3, hbTop - 0.15, wc.h - 0.4);
    const clipT = (P1, P2) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - sAe, sBe - P1[0], P1[1] - yAe, yBe - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return { A: [P1[0] + t0 * dx, P1[1] + t0 * dy], B: [P1[0] + t1 * dx, P1[1] + t1 * dy], t0, t1 };
    };
    // жёсткие границы тела стенки: лента (с учётом полуширины!) никогда
    // не выходит за края сегмента, ниже дна и выше начала скругления
    const pushQ = (q0) => {
      const q = q0.map(([sv, yv]) => [
        Math.min(s1 - 0.05, Math.max(s0 + 0.05, sv)),
        Math.min(hbTop - 0.05, Math.max(0.2, yv)),
      ]);
      const area = Math.abs(
        q[0][0] * (q[1][1] - q[3][1]) + q[1][0] * (q[2][1] - q[0][1]) +
        q[2][0] * (q[3][1] - q[1][1]) + q[3][0] * (q[0][1] - q[2][1])
      ) / 2;
      if (area < 0.15) return; // полностью сплющенные о границу — отбрасываем
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    };
    const emitStrand = (pts, hws) => {
      let run = [], rw = [];
      const flush = () => { if (run.length > 1) for (const q of ribbonQuads(run, rw)) pushQ(q); run = []; rw = []; };
      for (let k = 0; k + 1 < pts.length; k++) {
        const c2 = clipT(pts[k], pts[k + 1]);
        if (!c2) { flush(); continue; }
        const wA = hws[k] + (hws[k + 1] - hws[k]) * c2.t0;
        const wB = hws[k] + (hws[k + 1] - hws[k]) * c2.t1;
        if (run.length === 0) { run.push(c2.A); rw.push(wA); }
        run.push(c2.B); rw.push(wB);
        if (c2.t1 < 0.999) flush();
      }
      flush();
    };
    const rng = mulberry32(hashStr(key) ^ Math.imul(wc.seed || 1, 2654435761));
    const hWin = yB - yA;
    for (const f of [1, -1]) {
      let base = sA - (f === 1 ? hWin : 0) - sp + rng() * sp;
      const end = sB + (f === -1 ? hWin : 0) + sp;
      for (; base < end; base += sp * 1.1 + rng() * sp * 0.4) {
        const A1 = sp * (0.25 + rng() * 0.4), l1 = sp * (1.8 + rng() * 1.6), p1 = rng() * 6.283;
        const A2 = sp * 0.18 * rng(), l2 = sp * (0.8 + rng() * 0.9), p2 = rng() * 6.283;
        const wBase = strut * (0.75 + rng() * 0.7);            // своя толщина у каждой пряди
        const lw = sp * (2.2 + rng() * 2), pw = rng() * 6.283; // волна толщины вдоль пряди
        const pts = [], hws = [];
        for (let y = yAe; ; y += 1.2) {
          const yy = Math.min(y, yBe);
          const t = yy - yA;
          const sv = base + f * t + A1 * Math.sin((t * 6.283) / l1 + p1) + A2 * Math.sin((t * 6.283) / l2 + p2);
          pts.push([sv, yy]);
          // градиент: у дна прядь заметно толще, кверху сходит на тонкую
          const grad = 1.45 - 0.75 * ((yy - yAe) / (yBe - yAe || 1));
          hws.push(Math.max(0.55, (wBase / 2) * grad * (1 + 0.35 * Math.sin((t * 6.283) / lw + pw))));
          if (yy >= yBe) break;
        }
        emitStrand(pts, hws);
      }
    }
  };

  // Наклонная сотовая панель: вместо сплошного клина пандуса — тонкая
  // панель вдоль гипотенузы с гекс-решёткой и рамкой (верхний стык со
  // стенкой, нижний пояс у дна, боковые пояса). Толщина по перпендикуляру
  // к наклонной плоскости ≈ толщине стенки.
  const buildHexRamp = (orient, facePos, dir, s0, s1, yTop, yBot0, run, thk, hexSize, embed, tag) => {
    const yBot = yBot0 - 0.6; // слегка утапливаем в дно для сращивания
    const dh = yTop - yBot;
    const Lslope = Math.hypot(run, dh);
    const thkH = Math.min((thk * Lslope) / Math.max(dh, 0.1), thk * 2.2); // горизонтальная толщина
    const toO = (u) => facePos + dir * ((u * run) / Lslope);
    const toY = (u) => yTop - (u * dh) / Lslope;
    const p3 = (o, y, sv) => (orient === "x" ? [o, y, sv] : [sv, y, o]);
    const pushQuadUS = (corners) => {
      // corners: 4 точки [u, s]; передняя грань на наклонной плоскости,
      // задняя — сдвиг по горизонтали внутрь (к стенке)
      const qa = corners.map(([u, sv]) => p3(toO(u), toY(u), sv));
      const qb = corners.map(([u, sv]) => p3(toO(u) - dir * thkH, toY(u), sv));
      solids.push(prismSolid(qa, qb, tag));
    };
    const railSide = 2.5, railTop = 3, railBot = 3.5;
    const uA = railTop, uB = Lslope - railBot;
    const sA = s0 + railSide, sB = s1 - railSide;
    if (sB - sA < hexSize * 0.9 || uB - uA < hexSize * 0.9) {
      solids.push(rampSolid(orient, facePos, dir, s0, s1, yTop, yBot0, run, embed, tag));
      return;
    }
    pushQuadUS([[0, s0], [uA, s0], [uA, s1], [0, s1]]);                 // верхний стык
    pushQuadUS([[uB, s0], [Lslope, s0], [Lslope, s1], [uB, s1]]);       // нижний пояс
    pushQuadUS([[uA, s0], [uB, s0], [uB, sA], [uA, sA]]);               // боковой пояс
    pushQuadUS([[uA, sB], [uB, sB], [uB, s1], [uA, s1]]);               // боковой пояс
    const strut = Math.max(1.2, Math.min(2.2, thk));
    const clipSeg = (P1, P2) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - uA, uB - P1[0], P1[1] - sA, sB - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return [[P1[0] + t0 * dx, P1[1] + t0 * dy], [P1[0] + t1 * dx, P1[1] + t1 * dy]];
    };
    const bar = (P1, P2) => {
      const c2 = clipSeg(P1, P2);
      if (!c2) return;
      const [A, B] = c2;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.4) return;
      const nx = (-dy / len) * (strut / 2), ny = (dx / len) * (strut / 2);
      pushQuadUS([[A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny]]);
    };
    const Whex = hexSize, R = Whex / Math.sqrt(3);
    // только целые ряды; неполный ряд у нижнего края ската заливается
    let rows = 0;
    while (uA + R + rows * 1.5 * R + R <= uB + 0.01) rows++;
    if (rows < 1) {
      pushQuadUS([[uA, s0], [uB, s0], [uB, s1], [uA, s1]]);
      return;
    }
    const colsN = Math.ceil((sB - sA) / Whex) + 2;
    for (let r = 0; r < rows; r++) {
      const uc = uA + R + r * 1.5 * R;
      const shift = r % 2 === 1 ? Whex / 2 : 0;
      for (let ci = -1; ci < colsN; ci++) {
        const sc = sA + Whex / 2 + ci * Whex + shift;
        const V = [
          [uc + R, sc], [uc + R / 2, sc + Whex / 2], [uc - R / 2, sc + Whex / 2],
          [uc - R, sc], [uc - R / 2, sc - Whex / 2], [uc + R / 2, sc - Whex / 2],
        ];
        for (let e = 0; e < 6; e++) bar(V[e], V[(e + 1) % 6]);
      }
    }
    const uTip = uA + R + (rows - 1) * 1.5 * R + R;
    const uValley = uTip - R / 2;
    const shiftN = rows % 2 === 1 ? Whex / 2 : 0;
    for (let ci = -1; ci < colsN + 1; ci++) {
      const sc = sA + Whex / 2 + ci * Whex + shiftN;
      const P = [[uValley, sc], [uTip, sc - Whex / 2], [uTip, sc + Whex / 2]]
        .map(([uv, sv]) => [uv, Math.min(sB, Math.max(sA, sv))]);
      if (Math.max(P[0][1], P[1][1], P[2][1]) - Math.min(P[0][1], P[1][1], P[2][1]) < 0.3) continue;
      pushQuadUS([P[0], P[1], P[2], P[2]]);
    }
    if (uB - uTip > 0.05) pushQuadUS([[uTip, sA], [uB, sA], [uB, sB], [uTip, sB]]);
  };

  // Наклонная панель с линиями: каркас как у сотового пандуса + пряди
  const buildLinesRamp = (orient, facePos, dir, s0, s1, yTop, yBot0, run, thk, wc, embed, tag) => {
    const yBot = yBot0 - 0.6;
    const dh = yTop - yBot;
    const Lslope = Math.hypot(run, dh);
    const thkH = Math.min((thk * Lslope) / Math.max(dh, 0.1), thk * 2.2);
    const toO = (u) => facePos + dir * ((u * run) / Lslope);
    const toY = (u) => yTop - (u * dh) / Lslope;
    const p3 = (o, y, sv) => (orient === "x" ? [o, y, sv] : [sv, y, o]);
    const pushQuadUS = (corners) => {
      const qa = corners.map(([u, sv]) => p3(toO(u), toY(u), sv));
      const qb = corners.map(([u, sv]) => p3(toO(u) - dir * thkH, toY(u), sv));
      solids.push(prismSolid(qa, qb, tag));
    };
    const railSide = 2.5, railTop = 3, railBot = 3.5;
    const uA = railTop, uB = Lslope - railBot;
    const sA = s0 + railSide, sB = s1 - railSide;
    const sp = Math.max(4, wc.lineStep);
    if (sB - sA < sp || uB - uA < sp) {
      solids.push(rampSolid(orient, facePos, dir, s0, s1, yTop, yBot0, run, embed, tag));
      return;
    }
    pushQuadUS([[0, s0], [uA, s0], [uA, s1], [0, s1]]);
    pushQuadUS([[uB, s0], [Lslope, s0], [Lslope, s1], [uB, s1]]);
    pushQuadUS([[uA, s0], [uB, s0], [uB, sA], [uA, sA]]);
    pushQuadUS([[uA, sB], [uB, sB], [uB, s1], [uA, s1]]);
    const strut = Math.max(1.2, Math.min(2.2, thk));
    const clipSeg = (P1, P2) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - uA, uB - P1[0], P1[1] - sA, sB - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return [[P1[0] + t0 * dx, P1[1] + t0 * dy], [P1[0] + t1 * dx, P1[1] + t1 * dy]];
    };
    const bar = (P1, P2) => {
      const c2 = clipSeg(P1, P2);
      if (!c2) return;
      const [A, B] = c2;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.4) return;
      const nx = (-dy / len) * (strut / 2), ny = (dx / len) * (strut / 2);
      pushQuadUS([[A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny]]);
    };
    const ext = 2.3;
    const sAe = sA - ext, sBe = sB + ext;
    const uAe = Math.max(0.3, uA - 2.6);
    const uBe = Math.min(uB + 3, Lslope - 0.3);
    const clipT = (P1, P2) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - uAe, uBe - P1[0], P1[1] - sAe, sBe - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return { A: [P1[0] + t0 * dx, P1[1] + t0 * dy], B: [P1[0] + t1 * dx, P1[1] + t1 * dy], t0, t1 };
    };
    const emitStrand = (pts, hws) => {
      let run = [], rw = [];
      const flush = () => {
        if (run.length > 1)
          for (const q0 of ribbonQuads(run, rw)) {
            const q = q0.map(([uv, sv]) => [
              Math.min(Lslope - 0.05, Math.max(0.05, uv)),
              Math.min(s1 - 0.05, Math.max(s0 + 0.05, sv)),
            ]);
            const area = Math.abs(
              q[0][0] * (q[1][1] - q[3][1]) + q[1][0] * (q[2][1] - q[0][1]) +
              q[2][0] * (q[3][1] - q[1][1]) + q[3][0] * (q[0][1] - q[2][1])
            ) / 2;
            if (area >= 0.15) pushQuadUS(q);
          }
        run = [];
        rw = [];
      };
      for (let k = 0; k + 1 < pts.length; k++) {
        const c2 = clipT(pts[k], pts[k + 1]);
        if (!c2) { flush(); continue; }
        const wA = hws[k] + (hws[k + 1] - hws[k]) * c2.t0;
        const wB = hws[k] + (hws[k + 1] - hws[k]) * c2.t1;
        if (run.length === 0) { run.push(c2.A); rw.push(wA); }
        run.push(c2.B); rw.push(wB);
        if (c2.t1 < 0.999) flush();
      }
      flush();
    };
    const rng = mulberry32(hashStr(tag + "r") ^ Math.imul(wc.seed || 1, 2654435761));
    const wWin = uB - uA;
    for (const f of [1, -1]) {
      let base = sA - (f === 1 ? wWin : 0) - sp + rng() * sp;
      const end = sB + (f === -1 ? wWin : 0) + sp;
      for (; base < end; base += sp * 1.1 + rng() * sp * 0.4) {
        const A1 = sp * (0.25 + rng() * 0.4), l1 = sp * (1.8 + rng() * 1.6), p1 = rng() * 6.283;
        const A2 = sp * 0.18 * rng(), l2 = sp * (0.8 + rng() * 0.9), p2 = rng() * 6.283;
        const wBase = strut * (0.75 + rng() * 0.7);
        const lw = sp * (2.2 + rng() * 2), pw = rng() * 6.283;
        const pts = [], hws = [];
        for (let u = uAe; ; u += 1.2) {
          const uu = Math.min(u, uBe);
          const t = uu - uA;
          const sv = base + f * t + A1 * Math.sin((t * 6.283) / l1 + p1) + A2 * Math.sin((t * 6.283) / l2 + p2);
          pts.push([uu, sv]);
          // низ ската (большие u) — толще, к верхнему стыку — тоньше
          const grad = 0.7 + 0.75 * ((uu - uAe) / (uBe - uAe || 1));
          hws.push(Math.max(0.55, (wBase / 2) * grad * (1 + 0.35 * Math.sin((t * 6.283) / lw + pw))));
          if (uu >= uBe) break;
        }
        emitStrand(pts, hws);
      }
    }
  };

  // диспетчер: узорные заполнения (если нет спуска) либо обычное тело стенки
  const pushWallAuto = (key, wc, thk, sym, s0, s1, S0, S1, mapFn) => {
    if (wc.face === "hex" && wc.drop === "none") buildHexWall(key, wc, thk, sym, s0, s1, mapFn);
    else if (wc.face === "lines" && wc.drop === "none") buildLinesWall(key, wc, thk, sym, s0, s1, mapFn);
    else pushWallBody(key, wc, thk, sym, s0, s1, S0, S1, mapFn);
  };

  // пол — по ячейкам: у каждой свой уровень (лесенка). Плита заходит под
  // окружающие стенки (они и есть «ножки»); под поднятым полом — пустота.
  const cellLvl = (i, j) => Math.min(getCellLvl(c, i, j), H - 4);
  for (let i = 0; i < L.nCols; i++)
    for (let j = 0; j < L.nRows; j++) {
      const lvl = cellLvl(i, j);
      // заход плиты под стенки — строго по толщине конкретной стенки:
      // под внешнюю на wallOut, под перегородку на wall. Ни плита, ни
      // рёбра под ней не пересекают внутренний объём соседней ячейки.
      const xa = Math.max(-W / 2, L.cx0(i) - (i === 0 ? wallOut : wall));
      const xb = Math.min(W / 2, L.cx0(i) + L.cw(i) + (i === L.nCols - 1 ? wallOut : wall));
      const za = Math.max(-D / 2, L.cz0(j) - (j === 0 ? wallOut : wall));
      const zb = Math.min(D / 2, L.cz0(j) + L.cd(j) + (j === L.nRows - 1 ? wallOut : wall));
      const cc = (c.cells && c.cells[i + ":" + j]) || {};
      const fDir = cc.tiltDir || "none";
      const fA = cc.tiltA || 0;
      if (fDir === "none" || fA < 0.5) {
        solids.push(boxSolid((xa + xb) / 2, lvl + floor / 2, (za + zb) / 2, xb - xa, floor, zb - za, "floor"));
      } else {
        // наклонный пол: клин, спускающийся к выбранной стороне; верх высокой
        // кромки ограничен высотой контейнера
        const span = fDir === "w" || fDir === "e" ? L.cw(i) : L.cd(j);
        const rise = Math.min(span * Math.tan((fA * Math.PI) / 180), Math.max(0, H - lvl - floor - 1));
        const yLo = lvl + floor, yHi = lvl + floor + rise;
        let capA, capB;
        if (fDir === "e") {
          // низкая сторона — правая (x+)
          const q = [[xa, lvl], [xb, lvl], [xb, yLo], [xa, yHi]];
          capA = q.map(([x, y]) => [x, y, za]); capB = q.map(([x, y]) => [x, y, zb]);
        } else if (fDir === "w") {
          const q = [[xa, lvl], [xb, lvl], [xb, yHi], [xa, yLo]];
          capA = q.map(([x, y]) => [x, y, za]); capB = q.map(([x, y]) => [x, y, zb]);
        } else if (fDir === "n") {
          // низкая сторона — ближняя (z-)
          const q = [[za, lvl], [zb, lvl], [zb, yHi], [za, yLo]];
          capA = q.map(([z, y]) => [xa, y, z]); capB = q.map(([z, y]) => [xb, y, z]);
        } else {
          const q = [[za, lvl], [zb, lvl], [zb, yLo], [za, yHi]];
          capA = q.map(([z, y]) => [xa, y, z]); capB = q.map(([z, y]) => [xb, y, z]);
        }
        solids.push(prismSolid(capA, capB, "floor"));
      }
      // минимальное заполнение под поднятой плитой: редкая сетка рёбер,
      // печатаются со стола и служат опорой для пола (мосты ≤ ~12 мм)
      if (lvl > 2) {
        const ribT = 1.0, spacing = 12;
        const nAlongX = Math.max(0, Math.floor((zb - za) / spacing));
        for (let k = 1; k <= nAlongX; k++) {
          const z = za + ((zb - za) * k) / (nAlongX + 1);
          solids.push(boxSolid((xa + xb) / 2, (lvl + 0.4) / 2, z, xb - xa, lvl + 0.4, ribT, "floor"));
        }
        const nAlongZ = Math.max(0, Math.floor((xb - xa) / spacing));
        for (let k = 1; k <= nAlongZ; k++) {
          const x = xa + ((xb - xa) * k) / (nAlongZ + 1);
          solids.push(boxSolid(x, (lvl + 0.4) / 2, (za + zb) / 2, ribT, lvl + 0.4, zb - za, "floor"));
        }
      }
    }

  // внешние стенки N/S (сегменты вдоль X), с вырезом под зоны соединителей
  for (let i = 0; i < L.nCols; i++) {
    const x0 = L.cx0(i), x1 = x0 + L.cw(i);
    const bx0 = Math.max(-W / 2, x0 - wallOut), bx1 = Math.min(W / 2, x1 + wallOut);
    for (const [side, zones] of [["n", zN], ["s", zS]]) {
      const key = `o:${side}:${i}`;
      const wc = getWall(c, key);
      if (wc.h > 0.3) {
        const mapFn = side === "n"
          ? (o, y, x) => [x, y, -D / 2 + o]
          : (o, y, x) => [x, y, D / 2 - o];
        for (const [a, b] of splitRange(bx0, bx1, zones)) pushWallAuto(key, wc, wallOut, false, a, b, bx0, bx1, mapFn);
        const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
        addRamp("z", side === "n" ? -D / 2 + wallOut : D / 2 - wallOut, side === "n" ? 1 : -1, x0, x1, hRamp, wc.t1, L.cd(side === "n" ? 0 : L.nRows - 1), wallOut - 0.4, wallOut, wc, floor + cellLvl(i, side === "n" ? 0 : L.nRows - 1), key);
      }
    }
  }
  // внешние стенки W/E (сегменты вдоль Z)
  for (let j = 0; j < L.nRows; j++) {
    const z0 = L.cz0(j), z1 = z0 + L.cd(j);
    const bz0 = Math.max(-D / 2, z0 - wallOut), bz1 = Math.min(D / 2, z1 + wallOut);
    for (const [side, zones] of [["w", zW], ["e", zE]]) {
      const key = `o:${side}:${j}`;
      const wc = getWall(c, key);
      if (wc.h > 0.3) {
        const mapFn = side === "w"
          ? (o, y, z) => [-W / 2 + o, y, z]
          : (o, y, z) => [W / 2 - o, y, z];
        for (const [a, b] of splitRange(bz0, bz1, zones)) pushWallAuto(key, wc, wallOut, false, a, b, bz0, bz1, mapFn);
        const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
        addRamp("x", side === "w" ? -W / 2 + wallOut : W / 2 - wallOut, side === "w" ? 1 : -1, z0, z1, hRamp, wc.t1, L.cw(side === "w" ? 0 : L.nCols - 1), wallOut - 0.4, wallOut, wc, floor + cellLvl(side === "w" ? 0 : L.nCols - 1, j), key);
      }
    }
  }
  // в male-зонах стенка ставится обратно на полную высоту (несёт рельс)
  if (conn.S?.male) for (const [a, b] of zS)
    solids.push(boxSolid((a + b) / 2, H / 2, (D - wallOut) / 2, b - a, H, wallOut, "conn"));
  if (conn.N?.male) for (const [a, b] of zN)
    solids.push(boxSolid((a + b) / 2, H / 2, -(D - wallOut) / 2, b - a, H, wallOut, "conn"));
  if (conn.E?.male) for (const [a, b] of zE)
    solids.push(boxSolid((W - wallOut) / 2, H / 2, (a + b) / 2, wallOut, H, b - a, "conn"));
  if (conn.W?.male) for (const [a, b] of zW)
    solids.push(boxSolid(-(W - wallOut) / 2, H / 2, (a + b) / 2, wallOut, H, b - a, "conn"));

  // вертикальные перегородки
  for (let i = 0; i < L.nCols - 1; i++) {
    const xd = L.cx0(i) + L.cw(i) + wall / 2;
    for (let j = 0; j < L.nRows; j++) {
      const key = `v:${i}:${j}`;
      const wc = getWall(c, key);
      const z0 = L.cz0(j), z1 = z0 + L.cd(j);
      const bz0 = Math.max(-D / 2 + wallOut * 0.5, z0 - wallOut), bz1 = Math.min(D / 2 - wallOut * 0.5, z1 + wallOut);
      if (wc.h > 0.3) {
        pushWallAuto(key, wc, wall, true, bz0, bz1, bz0, bz1, (o, y, z) => [xd + o, y, z]);
        const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
        addRamp("x", xd - wall / 2, -1, z0, z1, hRamp, wc.t1, L.cw(i), wall / 2, wall, wc, floor + cellLvl(i, j), key);
        addRamp("x", xd + wall / 2, 1, z0, z1, hRamp, wc.t2, L.cw(i + 1), wall / 2, wall, wc, floor + cellLvl(i + 1, j), key);
      }
    }
  }
  // горизонтальные перегородки
  for (let j = 0; j < L.nRows - 1; j++) {
    const zd = L.cz0(j) + L.cd(j) + wall / 2;
    for (let i = 0; i < L.nCols; i++) {
      const key = `h:${j}:${i}`;
      const wc = getWall(c, key);
      const x0 = L.cx0(i), x1 = x0 + L.cw(i);
      const bx0 = Math.max(-W / 2 + wallOut * 0.5, x0 - wallOut), bx1 = Math.min(W / 2 - wallOut * 0.5, x1 + wallOut);
      if (wc.h > 0.3) {
        pushWallAuto(key, wc, wall, true, bx0, bx1, bx0, bx1, (o, y, x) => [x, y, zd + o]);
        const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
        addRamp("z", zd - wall / 2, -1, x0, x1, hRamp, wc.t1, L.cd(j), wall / 2, wall, wc, floor + cellLvl(i, j), key);
        addRamp("z", zd + wall / 2, 1, x0, x1, hRamp, wc.t2, L.cd(j + 1), wall / 2, wall, wc, floor + cellLvl(i, j + 1), key);
      }
    }
  }

  // соединители
  for (const side of ["N", "S", "W", "E"])
    if (conn[side]) addConnUnits(solids, c, side, conn[side].vs);

  return solids;
}
function solidsVolume(solids) {
  let v = 0;
  for (const s of solids) for (const [a, b, c] of s.tris) v += dot(a, cross(b, c)) / 6;
  return v / 1000;
}
// детерминированный случайный узор: сид из ключа стенки
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// лента переменной ширины по ломаной: сглаженные стыки (усреднённые
// нормали), возвращает четырёхугольники в 2D-координатах ломаной
function ribbonQuads(pts, halfWidths) {
  const quads = [];
  const n = pts.length;
  if (n < 2) return quads;
  const Lp = [], Rp = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    Lp.push([pts[k][0] + nx * halfWidths[k], pts[k][1] + ny * halfWidths[k]]);
    Rp.push([pts[k][0] - nx * halfWidths[k], pts[k][1] - ny * halfWidths[k]]);
  }
  for (let k = 0; k + 1 < n; k++) quads.push([Lp[k], Lp[k + 1], Rp[k + 1], Rp[k]]);
  return quads;
}
export { buildContainer, layout, getWall, getCellLvl, lineOf, wallProfile, solidsVolume, CONN, connectorVs, splitRange, fillAxis };
