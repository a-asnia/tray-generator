// Аудит галтелей: перечисляем ВСЕ внутренние вертикальные рёбра модели
// (углы корпуса, стыки перегородок с корпусом и друг с другом, углы
// полостей фиксированных боксов, стыки перегородок со стенками боксов)
// и проверяем, что в каждом есть галтель.
import { buildContainer } from "../src/model/build.js";
import { layout } from "../src/model/layout.js";
import { splitRange } from "../src/model/connectors.js";

const base = {
  W: 170, D: 170, H: 30, cols: 1, rows: 1, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 2.8, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null, lockedCellW: {}, lockedRows: {}, fixedCells: [],
};
const noConn = { N: null, S: null, W: null, E: null };

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? "OK " : "FAIL"} ${name}`); if (!cond) fail++; };

// галтели = тела, которых нет в сборке с opts.fillets=false
const filletPts = (c) => {
  const withF = buildContainer(c, noConn);
  const without = new Set(buildContainer(c, noConn, { fillets: false }).map((s) => JSON.stringify(s)));
  const pts = [];
  for (const s of withF) if (!without.has(JSON.stringify(s)))
    for (const tri of s.tris) for (const p of tri) pts.push([p[0], p[2]]);
  return pts;
};
const has = (pts, x, z, eps = 0.02) => pts.some((p) => Math.abs(p[0] - x) < eps && Math.abs(p[1] - z) < eps);

const expectedCorners = (c) => {
  const L = layout(c);
  const { W, D, wall, wallOut } = c;
  const ix = W / 2 - wallOut, iz = D / 2 - wallOut;
  const list = [];
  list.push(["угол корпуса СЗ", -ix, -iz], ["угол корпуса СВ", ix, -iz],
            ["угол корпуса ЮЗ", -ix, iz], ["угол корпуса ЮВ", ix, iz]);
  const zonesAtX = (x) => L.fixed.filter((f) => x > f.fx0 - 0.01 && x < f.fx1 + 0.01).map((f) => [f.fz0, f.fz1]).sort((a, b) => a[0] - b[0]);
  const zonesAtZ = (z) => L.fixed.filter((f) => z > f.fz0 - 0.01 && z < f.fz1 + 0.01).map((f) => [f.fx0, f.fx1]).sort((a, b) => a[0] - b[0]);
  // вертикальные перегородки: концы КАЖДОГО сегмента (после обтекания боксов)
  const hasDiv = (j2, x) => {
    if (j2 < 0 || j2 >= L.nRows) return false;
    for (let ii = 0; ii < L.nColsAt(j2) - 1; ii++)
      if (Math.abs(L.cx0(ii, j2) + L.cw(ii, j2) + wall / 2 - x) < 0.01) return true;
    return false;
  };
  for (let j = 0; j < L.nRows; j++)
    for (let i = 0; i < L.nColsAt(j) - 1; i++) {
      const xd = L.cx0(i, j) + L.cw(i, j) + wall / 2;
      const z0 = L.cz0(j), z1 = z0 + L.cd(j);
      const extN = j === 0 || hasDiv(j - 1, xd) ? wallOut : wall;
      const extS = j === L.nRows - 1 || hasDiv(j + 1, xd) ? wallOut : wall;
      const bz0 = Math.max(-D / 2 + wallOut * 0.5, z0 - extN), bz1 = Math.min(D / 2 - wallOut * 0.5, z1 + extS);
      for (const [a, b] of splitRange(bz0, bz1, zonesAtX(xd))) {
        const zA = a <= bz0 + 0.01 ? (j === 0 ? -iz : z0) : a;
        const zB = b >= bz1 - 0.01 ? (j === L.nRows - 1 ? iz : z1) : b;
        list.push([`v:${i}:${j}@${a.toFixed(0)} сев-л`, xd - wall / 2, zA], [`v:${i}:${j} сев-п`, xd + wall / 2, zA],
                  [`v:${i}:${j} юг-л`, xd - wall / 2, zB], [`v:${i}:${j} юг-п`, xd + wall / 2, zB]);
      }
    }
  // горизонтальные перегородки: концы у корпуса и у боксов
  for (let j = 0; j < L.nRows - 1; j++) {
    const zd = L.cz0(j) + L.cd(j) + wall / 2;
    for (let i = 0; i < L.nColsAt(j); i++) {
      const x0 = L.cx0(i, j), x1 = x0 + L.cw(i, j);
      const bx0 = Math.max(-W / 2 + wallOut * 0.5, x0 - wallOut), bx1 = Math.min(W / 2 - wallOut * 0.5, x1 + wallOut);
      for (const [a, b] of splitRange(bx0, bx1, zonesAtZ(zd))) {
        if (i === 0 && a <= bx0 + 0.01) list.push([`h:${j} зап-в`, -ix, zd - wall / 2], [`h:${j} зап-н`, -ix, zd + wall / 2]);
        if (i === L.nColsAt(j) - 1 && b >= bx1 - 0.01) list.push([`h:${j} вост-в`, ix, zd - wall / 2], [`h:${j} вост-н`, ix, zd + wall / 2]);
        if (a > bx0 + 0.01) list.push([`h:${j} бокс-л-в`, a, zd - wall / 2], [`h:${j} бокс-л-н`, a, zd + wall / 2]);
        if (b < bx1 - 0.01) list.push([`h:${j} бокс-п-в`, b, zd - wall / 2], [`h:${j} бокс-п-н`, b, zd + wall / 2]);
      }
    }
  }
  for (const f of L.fixed)
    list.push([`бокс${f.k} СЗ`, f.x0, f.z0], [`бокс${f.k} СВ`, f.x1, f.z0],
              [`бокс${f.k} ЮЗ`, f.x0, f.z1], [`бокс${f.k} ЮВ`, f.x1, f.z1]);
  return list;
};

const audit = (name, c) => {
  const pts = filletPts(c);
  const missing = expectedCorners(c).filter(([, x, z]) => !has(pts, x, z));
  ok(`${name}${missing.length ? " — НЕТ: " + missing.map((m) => m[0]).join(", ") : ""}`, missing.length === 0);
};

audit("пустой контейнер 1×1", base);
audit("сетка 2×2", { ...base, cols: 2, rows: 2 });
audit("сетка 3×3", { ...base, cols: 3, rows: 3 });
audit("кирпичная раскладка", { ...base, cols: 2, rows: 2, rowColWs: { 0: [60, 101.2], 1: [111.4, 49.8] } });
audit("бокс в углу + сетка", { ...base, cols: 2, rows: 2, fixedCells: [{ w: 50, d: 40, anchor: "nw" }] });
audit("бокс у стенки", { ...base, cols: 2, rows: 2, fixedCells: [{ w: 50, d: 40, anchor: "e" }] });
audit("два бокса", { ...base, cols: 3, rows: 3, fixedCells: [{ w: 40, d: 40, anchor: "nw" }, { w: 40, d: 30, anchor: "se" }] });
audit("стенки разной высоты", { ...base, cols: 2, rows: 2, walls: { "v:0:0": { h: 12 }, "o:n:0": { h: 8 } } });

// галтель не должна попадать внутрь чужой полости бокса
{
  const c = { ...base, cols: 2, rows: 2, fixedCells: [{ w: 60, d: 50, anchor: "nw" }] };
  const L = layout(c);
  const pts = filletPts(c);
  // строго внутри полости (не на её границе и не в зоне скругления углов)
  const inside = pts.filter(([x, z]) =>
    L.fixed.some((f) => x > f.x0 + 2.05 && x < f.x1 - 2.05 && z > f.z0 + 2.05 && z < f.z1 - 2.05));
  ok(`галтели не лезут в середину полости бокса (${inside.length} точек)`, inside.length === 0);
}

console.log(fail === 0 ? "\nFILLET AUDIT PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
