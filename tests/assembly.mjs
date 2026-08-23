// ── Сборка из нескольких контейнеров ──
// Главное правило раскладки: соседи стоят вплотную и НЕ лезут друг в друга.
// Через плоскость стыка проходит только рельс замка, и он обязан попадать
// в паз соседа, не задевая его материал (иначе контейнеры не соединить —
// или, наоборот, из соседа торчит стенка).
import { buildContainer } from "../src/model/build.js";
import { presetContainer, GORKA_DEF } from "../src/model/presets.js";
import { connGeom } from "../src/model/connectors.js";
import { assemble } from "../src/model/assembly.js";
import { moveContainer } from "../src/model/laymove.js";
const LIMS = { maxW: 170, maxD: 170, maxH: 175, layW: 60, layD: 60 };
import { bboxOf, solidIndex, pointsInside } from "./fixtures.mjs";

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const LIM = { maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40 };
const CG = connGeom();

const mk = (o = {}) => ({
  id: 1, px: 0, pz: 0, W: 120, D: 120, H: 40, cols: 1, rows: 1, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: CG.minWall, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [],
  lockOuter: false, lockCell: false, ...o,
});

// сборка ровно та же, что в приложении (общий модуль assembly.js)
function place(containers) {
  return assemble(containers, true).items.map((it) => ({
    c: it.c, ox: it.ox, oz: it.oz, conn: it.conn,
    solids: buildContainer(it.c, it.conn).map((s) => ({
      tag: s.tag,
      tris: s.tris.map((t) => t.map(([x, y, z]) => [x + it.ox, y, z + it.oz])),
    })),
  }));
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
  ["одинаковые, стык по X", [mk({ id: 1 }), mk({ id: 2, px: 120 })], [[0, 1, "x"]]],
  ["одинаковые, стык по Z", [mk({ id: 1 }), mk({ id: 2, pz: 120 })], [[0, 1, "z"]]],
  ["разной высоты", [mk({ id: 1, H: 30 }), mk({ id: 2, px: 120, H: 70 })], [[0, 1, "x"]]],
  ["низкая внешняя стенка у соседа",
    [mk({ id: 1 }), mk({ id: 2, px: 120, walls: { "o:w:0": { h: 8 } } })], [[0, 1, "x"]]],
  ["горка рядом с обычным", [{ ...gorka, id: 1, px: 0, pz: 0 }, mk({ id: 2, px: 140, W: 140, D: 140, H: 60 })], [[0, 1, "x"]]],
  ["визитница на стыке",
    [mk({ id: 1, W: 140, D: 140, H: 70, walls: { "o:e:0": { h: 64, cardHooks: true } } }), mk({ id: 2, px: 140, W: 140, D: 140, H: 70 })],
    [[0, 1, "x"]]],
  ["квадрат 2×2",
    [mk({ id: 1 }), mk({ id: 2, px: 120 }), mk({ id: 3, pz: 120 }), mk({ id: 4, px: 120, pz: 120 })],
    [[0, 1, "x"], [0, 2, "z"], [1, 3, "z"], [2, 3, "x"]]],
  // свободная раскладка: 160+160 сзади, 118 в углу спереди
  ["угловая раскладка",
    [mk({ id: 1, px: 0, pz: 0, W: 160, D: 120 }), mk({ id: 2, px: 160, pz: 0, W: 160, D: 120 }),
     mk({ id: 3, px: 0, pz: 120, W: 118, D: 161 })],
    [[0, 1, "x"], [0, 2, "z"]]],
  ["узкий под двумя широкими",
    [mk({ id: 1, px: 0, pz: 0, W: 90, D: 100 }), mk({ id: 2, px: 90, pz: 0, W: 90, D: 100 }),
     mk({ id: 3, px: 0, pz: 100, W: 170, D: 100 })],
    [[0, 1, "x"], [0, 2, "z"], [1, 2, "z"]]],
  // сосед касается лишь частью стенки, со сдвигом
  ["касание со сдвигом",
    [mk({ id: 1, px: 0, pz: 0, W: 150, D: 100 }), mk({ id: 2, px: 60, pz: 100, W: 150, D: 100 })],
    [[0, 1, "z"]]],
];

for (const [name, cs, pairs] of configs) {
  const items = place(cs);
  for (const [a, b, axis] of pairs) checkPair(name, items, a, b, axis);
}

// ── стенка за рельсом цела ──
// Роль узла (рельс/паз) приходит списком групп — регрессия: в male-зоне
// стенка обязана ставиться обратно, иначе в ячейке дыра. Проверяем точку
// В СЕРЕДИНЕ ТОЛЩИНЫ стенки за рельсом: там должен быть материал.
{
  const cs = [
    mk({ id: 1, px: 0, pz: 0, W: 150, D: 120, cols: 3, rows: 2 }),
    mk({ id: 2, px: 150, pz: 0, W: 120, D: 120, cols: 2, rows: 2 }),
    mk({ id: 3, px: 0, pz: 120, W: 270, D: 100, cols: 4 }),
  ];
  const items = place(cs);
  let checked = 0;
  for (const it of items) {
    const idx = solidIndex(it.solids);
    const { W, D, wallOut } = it.c;
    for (const [side, groups] of Object.entries(it.conn)) {
      if (!groups) continue;
      for (const g of groups) {
        if (!g.male) continue;
        for (const vc of g.vs) {
          const p = side === "E" ? [it.ox + W / 2 - wallOut / 2, 6, it.oz + vc]
            : side === "W" ? [it.ox - W / 2 + wallOut / 2, 6, it.oz + vc]
            : side === "S" ? [it.ox + vc, 6, it.oz + D / 2 - wallOut / 2]
            : [it.ox + vc, 6, it.oz - D / 2 + wallOut / 2];
          checked++;
          ok(`стенка за рельсом цела (№${it.c.id} ${side} @${vc.toFixed(1)})`, idx.inside(p, 0));
        }
      }
    }
  }
  ok("рельсы для проверки нашлись", checked >= 3, ` → ${checked}`);
}

// после перетаскивания сборка обязана остаться такой же плотной
{
  const cs = [mk({ id: 1, px: 0, W: 150, D: 120 }), mk({ id: 2, px: 150, W: 90, D: 120 })];
  const moved = moveContainer(cs, 0, 243, 2, LIMS); // №1 прилипает справа от №2
  const items = place(moved);
  checkPair("после переноса", items, 0, 1, "x");
}

console.log(fail === 0 ? "\nASSEMBLY TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
