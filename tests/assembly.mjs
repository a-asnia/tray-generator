// ── Сборка из нескольких контейнеров ──
// Главное правило раскладки: соседи стоят вплотную и НЕ лезут друг в друга.
// Через плоскость стыка проходит только рельс замка, и он обязан попадать
// в паз соседа, не задевая его материал (иначе контейнеры не соединить —
// или, наоборот, из соседа торчит стенка).
import { buildContainer } from "../src/model/build.js";
import { presetContainer, GORKA_DEF } from "../src/model/presets.js";
import { connectorVs, connGeom } from "../src/model/connectors.js";
import { pairVs } from "../src/model/build.js";
import { moveContainer, gridDims } from "../src/model/laymove.js";
import { bboxOf, insideConvex, solidIndex, pointsInside } from "./fixtures.mjs";

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const LIM = { maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40 };
const CG = connGeom();

const mk = (o = {}) => ({
  id: 1, gx: 0, gy: 0, W: 120, D: 120, H: 40, cols: 1, rows: 1, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: CG.minWall, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [],
  lockOuter: false, lockCell: false, ...o,
});

// раскладка как в приложении: клетки по максимуму колонки/ряда, gap = 0
const railCarrier = (a, b) => {
  const aS = a.preset === "stairs", bS = b.preset === "stairs";
  return aS === bS ? true : aS;
};
function place(containers) {
  const { colW, rowD } = gridDims(containers);
  const gxs = containers.map((c) => c.gx), gys = containers.map((c) => c.gy);
  const gx0 = Math.min(...gxs), gx1 = Math.max(...gxs);
  const gy0 = Math.min(...gys), gy1 = Math.max(...gys);
  const colX = {}, rowZ = {};
  let acc = 0;
  for (let g = gx0; g <= gx1; g++) { colX[g] = acc + (colW[g] || 30) / 2; acc += colW[g] || 30; }
  const totalW = acc;
  acc = 0;
  for (let g = gy0; g <= gy1; g++) { rowZ[g] = acc + (rowD[g] || 30) / 2; acc += rowD[g] || 30; }
  const totalD = acc;
  const at = (gx, gy) => containers.find((c) => c.gx === gx && c.gy === gy);
  return containers.map((c) => {
    const E = at(c.gx + 1, c.gy), Wn = at(c.gx - 1, c.gy), S = at(c.gx, c.gy + 1), N = at(c.gx, c.gy - 1);
    const conn = {
      E: E ? { male: railCarrier(c, E), vs: pairVs(c, "E", E, "W", connectorVs(Math.min(c.D, E.D))) } : null,
      W: Wn ? { male: !railCarrier(Wn, c), vs: pairVs(c, "W", Wn, "E", connectorVs(Math.min(c.D, Wn.D))) } : null,
      S: S ? { male: railCarrier(c, S), vs: pairVs(c, "S", S, "N", connectorVs(Math.min(c.W, S.W))) } : null,
      N: N ? { male: !railCarrier(N, c), vs: pairVs(c, "N", N, "S", connectorVs(Math.min(c.W, N.W))) } : null,
    };
    const ox = colX[c.gx] - totalW / 2, oz = rowZ[c.gy] - totalD / 2;
    const solids = buildContainer(c, conn).map((s) => ({
      tag: s.tag,
      tris: s.tris.map((t) => t.map(([x, y, z]) => [x + ox, y, z + oz])),
    }));
    return { c, ox, oz, conn, solids };
  });
}

// проверка пары соседей
function checkPair(name, items, ai, bi, axis) {
  const A = items[ai], B = items[bi];
  const key = axis === "x" ? 0 : 2;
  const aHalf = (axis === "x" ? A.c.W : A.c.D) / 2;
  const bHalf = (axis === "x" ? B.c.W : B.c.D) / 2;
  const aPos = axis === "x" ? A.ox : A.oz, bPos = axis === "x" ? B.ox : B.oz;
  const joint = aPos < bPos ? aPos + aHalf : aPos - aHalf; // общая плоскость
  ok(`${name}: соседи стоят вплотную`,
    Math.abs((aPos < bPos ? bPos - bHalf : bPos + bHalf) - joint) < 0.01,
    ` (зазор ${Math.abs((aPos < bPos ? bPos - bHalf : bPos + bHalf) - joint).toFixed(3)} мм)`);

  const side = aPos < bPos ? 1 : -1; // с какой стороны от стыка стоит B
  const crossers = (item, dirToJoint) => item.solids.filter((s) => {
    const b = bboxOf(s);
    return dirToJoint > 0 ? b.hi[key] > joint + 0.02 : b.lo[key] < joint - 0.02;
  });
  const aCross = crossers(A, side), bCross = crossers(B, -side);
  ok(`${name}: за стык лезет только замок`,
    aCross.every((s) => s.tag === "conn") && bCross.every((s) => s.tag === "conn"),
    ` → ${[...aCross, ...bCross].filter((s) => s.tag !== "conn").map((s) => s.tag).slice(0, 3).join(", ")}`);

  // рельс должен входить в паз, не задевая материал соседа
  const idxB = solidIndex(B.solids), idxA = solidIndex(A.solids);
  let hits = 0, pts = 0;
  for (const [list, idx] of [[aCross, idxB], [bCross, idxA]])
    for (const s of list.filter((x) => x.tag === "conn"))
      for (const p of pointsInside(s, 0.35, 0.06)) {
        pts++;
        if (idx.inside(p, 0.06)) hits++;
      }
  ok(`${name}: рельс входит в паз, не задевая соседа`, hits === 0, ` → ${hits} из ${pts} точек в материале`);
  return pts;
}

// ── конфигурации ──
const gorka = presetContainer(mk({ W: 140, D: 140, H: 60 }), "stairs", LIM, GORKA_DEF);
const configs = [
  ["одинаковые, стык по X", [mk({ id: 1, gx: 0 }), mk({ id: 2, gx: 1 })], [[0, 1, "x"]]],
  ["одинаковые, стык по Z", [mk({ id: 1, gy: 0 }), mk({ id: 2, gy: 1 })], [[0, 1, "z"]]],
  ["разной высоты", [mk({ id: 1, H: 30 }), mk({ id: 2, gx: 1, H: 70 })], [[0, 1, "x"]]],
  ["низкая внешняя стенка у соседа",
    [mk({ id: 1 }), mk({ id: 2, gx: 1, walls: { "o:w:0": { h: 8 } } })], [[0, 1, "x"]]],
  ["горка рядом с обычным", [{ ...gorka, id: 1, gx: 0, gy: 0 }, mk({ id: 2, gx: 1, W: 140, D: 140, H: 60 })], [[0, 1, "x"]]],
  ["визитница на стыке",
    [mk({ id: 1, W: 140, D: 140, H: 70, walls: { "o:e:0": { h: 64, cardHooks: true } } }), mk({ id: 2, gx: 1, W: 140, D: 140, H: 70 })],
    [[0, 1, "x"]]],
  ["сетка 2×2",
    [mk({ id: 1, gx: 0, gy: 0 }), mk({ id: 2, gx: 1, gy: 0 }), mk({ id: 3, gx: 0, gy: 1 }), mk({ id: 4, gx: 1, gy: 1 })],
    [[0, 1, "x"], [0, 2, "z"], [1, 3, "z"], [2, 3, "x"]]],
];

for (const [name, cs, pairs] of configs) {
  const items = place(cs);
  for (const [a, b, axis] of pairs) checkPair(name, items, a, b, axis);
}

// после перетаскивания сборка обязана остаться такой же плотной
{
  const cs = [mk({ id: 1, gx: 0, W: 150, D: 120 }), mk({ id: 2, gx: 1, W: 90, D: 120 })];
  const moved = moveContainer(cs, 0, 1, 0);
  const items = place(moved);
  checkPair("после переноса", items, 0, 1, "x");
}

console.log(fail === 0 ? "\nASSEMBLY TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
