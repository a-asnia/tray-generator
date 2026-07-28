// ══════════════════════════════════════════════════════════════
// ГЕОМЕТРИЯ: выпуклые призмы, обход граней ориентируется наружу
// ══════════════════════════════════════════════════════════════

import { sub, cross, dot } from "./vec.js";

export function prismSolid(quadA, quadB, tag) {
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

export function boxSolid(cx, cy, cz, sx, sy, sz, tag) {
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
export function rampSolid(orient, facePos, dir, s0, s1, yTop, yBot, run, embed, tag) {
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
export function wallProfile(thk, h, rnd, symmetric) {
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
