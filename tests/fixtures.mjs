// Набор конфигураций, покрывающих все ветки построения геометрии.
// Используется для отпечатка (tests/fingerprint.mjs): любое изменение
// координат хотя бы в одной конфигурации ломает тест.
export const base = {
  W: 120, D: 100, H: 30, cols: 2, rows: 2, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 3, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, fixedCells: [],
};
export const noConn = { N: null, S: null, W: null, E: null };

const wallsAll = (patch) =>
  Object.fromEntries(
    ["o:n:0", "o:n:1", "o:s:0", "o:s:1", "o:w:0", "o:w:1", "o:e:0", "o:e:1", "v:0:0", "v:0:1", "h:0:0", "h:0:1"]
      .map((k) => [k, { h: 30, ...patch }])
  );

export const cases = {
  "пусто 1×1": [{ ...base, cols: 1, rows: 1 }, noConn],
  "сетка 2×2": [base, noConn],
  "сетка 4×3": [{ ...base, W: 170, D: 170, cols: 4, rows: 3 }, noConn],
  "соты везде": [{ ...base, walls: wallsAll({ face: "hex", hexSize: 8 }) }, noConn],
  "линии везде": [{ ...base, walls: wallsAll({ face: "lines", lineStep: 14, seed: 3 }) }, noConn],
  "соты крупные": [{ ...base, H: 45, walls: wallsAll({ face: "hex", hexSize: 14 }) }, noConn],
  "узкое окно узора": [{ ...base, H: 12, walls: wallsAll({ face: "hex", hexSize: 10 }) }, noConn],
  "пандусы": [{ ...base, walls: wallsAll({ t1: 20, t2: 12 }) }, noConn],
  "соты + пандусы": [{ ...base, walls: wallsAll({ face: "hex", t1: 18 }) }, noConn],
  "линии + пандусы": [{ ...base, walls: wallsAll({ face: "lines", t1: 18, seed: 7 }) }, noConn],
  "спуск кромки": [{ ...base, walls: wallsAll({ drop: "a", dropH: 8 }) }, noConn],
  "спуск + соты": [{ ...base, walls: wallsAll({ drop: "b", dropH: 10, face: "hex" }) }, noConn],
  "без скругления": [{ ...base, walls: wallsAll({ rnd: 0 }) }, noConn],
  "скругление 1.5": [{ ...base, walls: wallsAll({ rnd: 1.5 }) }, noConn],
  "лесенка полов": [{ ...base, cells: { "0:0": { lvl: 6 }, "1:1": { lvl: 12 } } }, noConn],
  "наклонные полы": [{ ...base, cells: { "0:0": { tiltDir: "e", tiltA: 7 }, "1:0": { tiltDir: "n", tiltA: 5 } } }, noConn],
  "кирпичная раскладка": [{ ...base, rowColWs: { 0: [70, 43.8], 1: [40, 73.8] } }, noConn],
  "бокс в углу": [{ ...base, fixedCells: [{ w: 40, d: 30, anchor: "nw", lvl: 0 }] }, noConn],
  "бокс у стенки + пол": [{ ...base, fixedCells: [{ w: 35, d: 30, anchor: "e", lvl: 5 }] }, noConn],
  "два бокса": [{ ...base, W: 170, D: 170, cols: 3, rows: 3, fixedCells: [{ w: 40, d: 30, anchor: "nw" }, { w: 30, d: 40, anchor: "se" }] }, noConn],
  "замки все стороны": [
    base,
    { N: { male: false, vs: [-30, 30] }, S: { male: true, vs: [-30, 30] }, W: { male: false, vs: [-25, 25] }, E: { male: true, vs: [-25, 25] } },
  ],
  "замки + зазор 0.4": [
    { ...base, connClr: 0.4 },
    { N: { male: false, vs: [-30, 30] }, E: { male: true, vs: [-25, 25] }, S: null, W: null },
  ],
  "замки + соты": [
    { ...base, walls: wallsAll({ face: "hex" }) },
    { N: { male: false, vs: [-30, 30] }, S: { male: true, vs: [-30, 30] }, W: null, E: null },
  ],
  "один замок один нет": [
    base,
    { N: { male: false, vs: [-30, 30] }, S: null, W: null, E: { male: true, vs: [-25, 25] } },
  ],
  "тонкие стенки": [{ ...base, wall: 0.8, wallOut: 1.2, floor: 0.8 }, noConn],
  "толстые стенки": [{ ...base, wall: 4, wallOut: 6, floor: 4 }, noConn],
};

// ── Геометрические помощники для проверок печатопригодности ──
// Тела — выпуклые призмы, поэтому «точка внутри» = точка по внутреннюю
// сторону всех граней.
export function bboxOf(solid) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of solid.tris) for (const p of t)
    for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  return { lo, hi };
}
export function bboxAll(solids) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    const b = bboxOf(s);
    for (let k = 0; k < 3; k++) { if (b.lo[k] < lo[k]) lo[k] = b.lo[k]; if (b.hi[k] > hi[k]) hi[k] = b.hi[k]; }
  }
  return { lo, hi };
}
// eps > 0 — «строго внутри на eps»: касание поверхностей не считается
export function insideConvex(solid, p, eps = 0) {
  const c = [0, 0, 0];
  let n = 0;
  for (const t of solid.tris) for (const q of t) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; n++; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  for (const [a, b, d] of solid.tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(nn[0], nn[1], nn[2]);
    if (len < 1e-9) continue;
    nn = nn.map((x) => x / len);
    // нормаль наружу (от центра тела)
    if ((c[0] - a[0]) * nn[0] + (c[1] - a[1]) * nn[1] + (c[2] - a[2]) * nn[2] > 0) nn = nn.map((x) => -x);
    if ((p[0] - a[0]) * nn[0] + (p[1] - a[1]) * nn[1] + (p[2] - a[2]) * nn[2] > -eps) return false;
  }
  return true;
}
// индекс тел по ячейкам сетки — чтобы не проверять все тела на каждую точку
export function solidIndex(solids, cell = 8) {
  const map = new Map();
  const key = (i, j, k) => i + ":" + j + ":" + k;
  solids.forEach((s, idx) => {
    const b = bboxOf(s);
    for (let i = Math.floor(b.lo[0] / cell); i <= Math.floor(b.hi[0] / cell); i++)
      for (let j = Math.floor(b.lo[1] / cell); j <= Math.floor(b.hi[1] / cell); j++)
        for (let k = Math.floor(b.lo[2] / cell); k <= Math.floor(b.hi[2] / cell); k++) {
          const kk = key(i, j, k);
          if (!map.has(kk)) map.set(kk, []);
          map.get(kk).push(idx);
        }
  });
  return {
    at: (p) => map.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell))) || [],
    inside: function (p, eps = 0) {
      for (const idx of this.at(p)) if (insideConvex(solids[idx], p, eps)) return true;
      return false;
    },
  };
}
// точки строго внутри тела: сетка по его габариту с шагом step
export function pointsInside(solid, step = 0.4, eps = 0.05) {
  const { lo, hi } = bboxOf(solid);
  const out = [];
  for (let x = lo[0] + step / 2; x < hi[0]; x += step)
    for (let y = lo[1] + step / 2; y < hi[1]; y += step)
      for (let z = lo[2] + step / 2; z < hi[2]; z += step) {
        const p = [x, y, z];
        if (insideConvex(solid, p, eps)) out.push(p);
      }
  return out;
}
