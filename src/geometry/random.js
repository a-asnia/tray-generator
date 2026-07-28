// детерминированный случайный узор: сид из ключа стенки
export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// лента переменной ширины по ломаной: сглаженные стыки (усреднённые
// нормали), возвращает четырёхугольники в 2D-координатах ломаной
export function ribbonQuads(pts, halfWidths) {
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
