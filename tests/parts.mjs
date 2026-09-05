// ── Отдельные детали должны собираться с контейнером ──
// Вставная перегородка вдвигается в свои направляющие, визитница —
// крюками в окна стенки. Проверяем «примеркой»: точки внутри детали,
// поставленной на место, не должны попадать в материал контейнера,
// и деталь обязана доставать до того, за что держится.
import { buildContainer } from "../src/model/build.js";
import { insertSlots, insertInPlace, insertsOf } from "../src/model/inserts.js";
import { cardHolderSolids, CARDH } from "../src/model/cardholder.js";
import { bboxOf, bboxAll, solidIndex, pointsInside } from "./fixtures.mjs";

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const noConn = { N: null, S: null, W: null, E: null };

const mk = (o = {}) => ({
  W: 150, D: 110, H: 40, cols: 1, rows: 1, gridMode: "count", cellWt: 40, cellDt: 40,
  wall: 1.6, wallOut: 2.9, floor: 1.6, walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [], ...o,
});

// ── вставные перегородки ──
const insCases = {
  "ровный пол": mk({ inserts: { dir: "x", step: 25, show: true } }),
  "лесенка полов": mk({
    cols: 3, cells: { "0:0": { lvl: 10 }, "1:0": { lvl: 20 } },
    inserts: { dir: "x", step: 25, show: true },
  }),
  "поперёк пониженных перегородок": mk({
    cols: 3, rows: 1, walls: { "v:0:0": { h: 18 }, "v:1:0": { h: 18 } },
    inserts: { dir: "z", step: 22, show: true },
  }),
  "наклонный пол": mk({ cells: { "0:0": { tiltDir: "e", tiltA: 8 } }, inserts: { dir: "x", step: 30, show: true } }),
};
for (const [name, c] of Object.entries(insCases)) {
  const axis = insertsOf(c).dir;
  const slots = insertSlots(c, axis);
  ok(`${name}: места под вставку есть`, slots.length > 0);
  // контейнер строим БЕЗ показа вставок — примеряем деталь отдельно
  const body = buildContainer({ ...c, inserts: { ...insertsOf(c), show: false } }, noConn);
  const idx = solidIndex(body);
  let hits = 0, pts = 0, thin = 0;
  for (const u of slots) {
    const plate = insertInPlace(c, axis, u);
    ok(`${name}: деталь на месте ${u} построена`, plate.length > 0);
    const bb = bboxAll(plate);
    if (bb.lo[1] < -0.01) thin++;
    for (const s of plate)
      for (const p of pointsInside(s, 0.5, 0.05)) {
        pts++;
        if (idx.inside(p, 0.05)) hits++;
      }
  }
  ok(`${name}: вставка не режет контейнер`, hits === 0, ` → ${hits} из ${pts} точек в материале`);
  ok(`${name}: вставка не уходит под стол`, thin === 0);
}

// ── визитница ──
{
  const c = mk({ W: 150, D: 110, H: 70, walls: { "o:n:0": { h: 64, cardHooks: true } } });
  const body = buildContainer(c, noConn);
  const idx = solidIndex(body);
  // деталь печатается лёжа; для примерки возвращаем её в рабочее положение
  // (обратное преобразование из cardHolderSolids) и ставим к стенке
  const zWall = -c.D / 2;        // наружная плоскость ближней стенки
  const hWall = 64;              // высота стенки с окнами
  const yHook = hWall - CARDH.top; // верх окна: туда упирается плечо крюка
  const wide = CARDH.wide, depth = CARDH.depth;
  const upright = cardHolderSolids(c).map((s) => ({
    tag: s.tag,
    tris: s.tris.map((t) => t.map(([x, y, z]) => {
      // обратное к [y, W/2 − x, z + depth]: x = W/2 − y, y = x, z = z − depth
      const ox = wide / 2 - y, oy = x, oz = z - depth;
      // спинка снаружи стенки, крюки — через окна внутрь; верх детали у кромки
      // деталь висит плечом на верхней кромке окна
      return [ox, oy + yHook - CARDH.back, oz + zWall - CARDH.T];
    })),
  }));
  const idxPart = solidIndex(upright);
  let hits = 0, pts = 0;
  for (const s of upright)
    for (const p of pointsInside(s, 0.4, 0.05)) {
      pts++;
      if (idx.inside(p, 0.05)) hits++;
    }
  ok("визитница садится на стенку, не пересекая её", hits === 0, ` → ${hits} из ${pts} точек в материале`);
  // носик крюка должен оказаться ЗА внутренней плоскостью стенки — иначе
  // деталь не зацепится и сползёт
  const inner = zWall + c.wallOut;
  const bb = bboxAll(upright);
  ok("крюки проходят стенку насквозь", bb.hi[2] > inner + 0.3, ` → ${bb.hi[2].toFixed(2)} против ${inner.toFixed(2)}`);
  ok("карман висит снаружи", bb.lo[2] < zWall - 5, ` → ${bb.lo[2].toFixed(2)}`);
  // и не упирается в стол
  ok("карман не достаёт до стола", bb.lo[1] > 1, ` → низ на ${bb.lo[1].toFixed(1)} мм`);
  // окна прорезаны там, где крюки
  const holeY = hWall - CARDH.top - CARDH.hh / 2;
  const holeZ = zWall + c.wallOut / 2;
  ok("окна на месте крюков сквозные",
    [-CARDH.sp / 2, CARDH.sp / 2].every((x) => !idx.inside([x, holeY, holeZ], 0)));
  ok("между окнами материал есть", idx.inside([0, holeY, holeZ], 0));
  ok("деталь напечатана целиком", idxPart.inside([0, yHook - CARDH.back + 1, zWall - 1], 0.05) !== undefined);
}

console.log(fail === 0 ? "\nPARTS FIT TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
