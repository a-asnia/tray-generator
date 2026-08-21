// Раскладка рядами: ширина у каждого контейнера своя, глубина общая у ряда.
// Проверяем перенос между рядами и внутри ряда, позиции на столе и жёсткую
// рамку стола.
import { moveContainer, fitAssembly, placeContainers, rowsOf, fitToRow, renumber } from "../src/model/laymove.js";
import { layout } from "../src/model/layout.js";

const mk = (o = {}) => ({
  id: o.id ?? 1, gx: 0, gy: 0, W: 170, D: 170, H: 30, cols: 1, rows: 1,
  gridMode: "count", cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 2.9, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [],
  lockOuter: false, lockCell: false, ...o,
});
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;
const at = (cs, id) => cs.find((c) => c.id === id);

// ── ряды со свободными ширинами ──
{
  const cs = [
    mk({ id: 1, gy: 0, gx: 0, W: 160, D: 120 }),
    mk({ id: 2, gy: 0, gx: 1, W: 160, D: 120 }),
    mk({ id: 3, gy: 1, gx: 0, W: 118, D: 161 }),
  ];
  const rows = rowsOf(cs);
  ok("рядов два", rows.length === 2);
  ok("ширина ряда — сумма контейнеров", near(rows[0].width, 320) && near(rows[1].width, 118));
  ok("глубина ряда — максимум по ряду", near(rows[0].depth, 120) && near(rows[1].depth, 161));
  const p = placeContainers(cs);
  ok("сборка 320×281", near(p.totalW, 320) && near(p.totalD, 281));
  ok("порядок items совпадает со списком", p.items.every((it, i) => it.c === cs[i]));
  ok("контейнеры ряда стоят вплотную",
    near(p.items[0].ox + 80, p.items[1].ox - 80));
  ok("ряды выровнены по левому краю",
    near(p.items[0].ox - 80, p.items[2].ox - 59));
  ok("ряды стыкуются по глубине",
    near(p.items[0].oz + 60, p.items[2].oz - 80.5));
  ok("узкий контейнер сохранил ширину (не растянут под соседей)", cs[2].W === 118);
}

// ── перенос между рядами ──
{
  const cs = [
    mk({ id: 1, gy: 0, gx: 0, W: 100, D: 100 }),
    mk({ id: 2, gy: 0, gx: 1, W: 120, D: 100 }),
    mk({ id: 3, gy: 1, gx: 0, W: 90, D: 150 }),
  ];
  const n = moveContainer(cs, 1, 1, 0); // №2 в начало второго ряда
  ok("контейнер сменил ряд", at(n, 2).gy === 1 && at(n, 2).gx === 0);
  ok("сосед по новому ряду сдвинулся", at(n, 3).gx === 1);
  ok("ширина при переносе сохранилась", near(at(n, 2).W, 120));
  ok("глубину взял у нового ряда", near(at(n, 2).D, 150));
  ok("старый ряд перенумерован", at(n, 1).gx === 0 && at(n, 1).gy === 0);
}

// ── перестановка внутри ряда ──
{
  const cs = [
    mk({ id: 1, gy: 0, gx: 0, W: 100, D: 100 }),
    mk({ id: 2, gy: 0, gx: 1, W: 120, D: 100 }),
    mk({ id: 3, gy: 0, gx: 2, W: 60, D: 100 }),
  ];
  const n = moveContainer(cs, 2, 0, 0); // №3 в начало ряда
  ok("порядок в ряду поменялся", at(n, 3).gx === 0 && at(n, 1).gx === 1 && at(n, 2).gx === 2);
  ok("ширины не тронуты", near(at(n, 1).W, 100) && near(at(n, 2).W, 120) && near(at(n, 3).W, 60));
  ok("перенос на своё же место ничего не делает", moveContainer(cs, 1, 0, 1) === cs);
  ok("перенос сразу за собой — тоже", moveContainer(cs, 1, 0, 2) === cs);
}

// ── новый ряд и схлопывание пустого ──
{
  const cs = [
    mk({ id: 1, gy: 0, gx: 0, W: 100, D: 100 }),
    mk({ id: 2, gy: 0, gx: 1, W: 100, D: 100 }),
  ];
  const n = moveContainer(cs, 1, 1, 0); // во второй (новый) ряд
  ok("создан второй ряд", rowsOf(n).length === 2);
  const back = moveContainer(n, 1, 0, 1); // и обратно
  ok("пустой ряд схлопнулся", rowsOf(back).length === 1);
  ok("нумерация подряд", back.every((c) => c.gy === 0) && [0, 1].every((k) => back.some((c) => c.gx === k)));
}

// ── глубина ряда и замки ──
{
  const cs = [
    mk({ id: 1, gy: 0, gx: 0, W: 100, D: 100, lockOuter: true }),
    mk({ id: 2, gy: 1, gx: 0, W: 100, D: 150 }),
  ];
  const n = moveContainer(cs, 0, 1, 0);
  ok("замок габарита пережил перенос", near(at(n, 1).D, 100) && near(at(n, 1).W, 100));
  ok("незамкнутый сосед по ряду тоже не тронут (ряд держит максимум)", near(at(n, 2).D, 150));
  ok("подгонка под ряд не трогает замкнутый", fitToRow(cs[0], 200) === cs[0]);
}

// ── жёсткая рамка стола ──
{
  const lim = { maxW: 170, maxD: 170, maxH: 175, layW: 30, layD: 30 }; // 300×300
  const cs = [
    mk({ id: 1, gy: 0, gx: 0, W: 170, D: 170 }),
    mk({ id: 2, gy: 0, gx: 1, W: 170, D: 170 }),
    mk({ id: 3, gy: 1, gx: 0, W: 100, D: 170 }),
  ];
  const n = fitAssembly(cs, lim);
  const rows = rowsOf(n);
  ok("широкий ряд ужат в рамку", rows[0].width <= 300.05, ` (${rows[0].width})`);
  ok("узкий ряд не тронут", near(at(n, 3).W, 100));
  ok("глубина стопки в рамке", rows.reduce((s, r) => s + r.depth, 0) <= 300.05);
  ok("идемпотентно", fitAssembly(n, lim) === null);
}
{
  const lim = { maxW: 170, maxD: 170, maxH: 175, layW: 20, layD: 40 };
  const cs = [
    mk({ id: 1, gy: 0, gx: 0, W: 170, D: 100, lockOuter: true }),
    mk({ id: 2, gy: 0, gx: 1, W: 170, D: 100 }),
  ];
  const n = fitAssembly(cs, lim);
  ok("замок габарита не подрезан", near(at(n, 1).W, 170));
  ok("сжатие забрал сосед", near(at(n, 2).W, 30));
}

// ── внутренняя раскладка переживает подгонку ──
{
  const c = mk({ W: 120, D: 100, cols: 3, rows: 2, cells: { "1:0": { lvl: 12 } } });
  const f = fitToRow(c, 140);
  ok("подгонка изменила только глубину", f.D === 140 && f.W === 120 && f.rows === 2);
  ok("настройки ячеек на месте", f.cells["1:0"].lvl === 12);
  const L = layout(f);
  ok("ряды разъехались по новой глубине",
    near(L.rowDs.reduce((s, v) => s + v, 0), 140 - 2 * f.wallOut - f.wall));
}

// ── renumber не плодит новые объекты зря ──
{
  const cs = [mk({ id: 1, gy: 0, gx: 0 }), mk({ id: 2, gy: 0, gx: 1 })];
  const n = renumber(cs);
  ok("нетронутые контейнеры сохранили ссылку", n[0] === cs[0] && n[1] === cs[1]);
}

console.log(fail === 0 ? "\nLAYOUT ROWS TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
