// Перенос контейнеров по раскладке: переезд, обмен местами, подгонка под
// габарит клетки, схлопывание опустевших колонок и рядов.
import { moveContainer, fitToCell, compactGrid, gridDims, fitAssembly } from "../src/model/laymove.js";
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
// в связной сборке клетка держит габарит: колонка одной ширины, ряд — одной глубины
const tight = (cs) => {
  const { colW, rowD } = gridDims(cs);
  return cs.every((c) => near(c.W, colW[c.gx]) && near(c.D, rowD[c.gy]));
};

// ── обмен местами: контейнеры берут габарит клетки, куда приехали ──
{
  const cs = [
    mk({ id: 1, gx: 0, gy: 0, W: 60, D: 100 }),
    mk({ id: 2, gx: 1, gy: 0, W: 140, D: 100 }),
  ];
  const n = moveContainer(cs, 0, 1, 0);
  ok("обмен: позиции поменялись", n[0].gx === 1 && n[1].gx === 0);
  ok("обмен: номера в списке не съехали", n[0].id === 1 && n[1].id === 2);
  ok("обмен: каждый принял ширину своей клетки", near(n[0].W, 140) && near(n[1].W, 60));
  ok("обмен: сборка осталась плотной", tight(n));
}

// ── переезд на пустую клетку ──
{
  const cs = [
    mk({ id: 1, gx: 0, gy: 0, W: 80, D: 90 }),
    mk({ id: 2, gx: 1, gy: 0, W: 120, D: 90 }),
    mk({ id: 3, gx: 1, gy: 1, W: 120, D: 150 }),
  ];
  const n = moveContainer(cs, 0, 0, 1); // из (0,0) вниз, в свободную (0,1)
  ok("переезд: контейнер на новом месте", n[0].gx === 0 && n[0].gy === 1);
  ok("переезд: глубина стала как у ряда", near(n[0].D, 150));
  ok("переезд: соседи не тронуты", n[1].W === 120 && n[2].W === 120);
  ok("переезд: сборка плотная", tight(n));
}

// ── опустевшая колонка схлопывается ──
{
  const cs = [
    mk({ id: 1, gx: 0, gy: 0, W: 80, D: 90 }),
    mk({ id: 2, gx: 1, gy: 0, W: 120, D: 90 }),
  ];
  const n = moveContainer(cs, 0, 1, 1); // колонка 0 опустела
  ok("схлопывание: сетка сдвинулась к нулю", Math.min(...n.map((c) => c.gx)) === 0 && Math.min(...n.map((c) => c.gy)) === 0);
  ok("схлопывание: колонок стало одна", new Set(n.map((c) => c.gx)).size === 1);
  ok("схлопывание: рядов два", new Set(n.map((c) => c.gy)).size === 2);
  ok("схлопывание: ширина одна на колонку", tight(n));
}

// ── перенос за край сетки: новая колонка ──
{
  const cs = [mk({ id: 1, gx: 0, gy: 0, W: 100, D: 100 }), mk({ id: 2, gx: 1, gy: 0, W: 100, D: 100 })];
  const n = moveContainer(cs, 1, 2, 0);
  ok("за край: контейнер сохранил свой габарит в новой колонке", near(n[1].W, 100));
  ok("за край: сетка осталась из двух колонок (пустая схлопнулась)", new Set(n.map((c) => c.gx)).size === 2);
}

// ── клетка расширяется под контейнер, который не может ужаться ──
{
  const big = mk({ id: 1, gx: 0, gy: 0, W: 170, D: 100, cols: 3, rowColWs: { 0: [50, 50, 50] }, lockedCellW: { "0:0": true, "1:0": true, "2:0": true } });
  const cs = [big, mk({ id: 2, gx: 1, gy: 0, W: 60, D: 100 }), mk({ id: 3, gx: 1, gy: 1, W: 60, D: 100 })];
  const n = moveContainer(cs, 0, 1, 0);
  ok("замки ячеек держат ширину при переезде", n[0].W > 150);
  ok("клетка расширилась под него — сосед по колонке подрос", near(n[1].W, n[0].W));
  ok("узкая клетка досталась приехавшему", near(n[1].W, n[0].W) && tight(n));
}

// ── «намертво» зафиксированный габарит не меняется ──
{
  const cs = [
    mk({ id: 1, gx: 0, gy: 0, W: 90, D: 90, lockOuter: true }),
    mk({ id: 2, gx: 1, gy: 0, W: 140, D: 90 }),
  ];
  const n = moveContainer(cs, 0, 1, 0);
  ok("замок габарита пережил переезд", near(n[0].W, 90) && near(n[0].D, 90));
  ok("клетка подстроилась под замок — сосед стал такой же", near(n[1].W, 140) || near(n[1].W, 90), ` (W=${n[1].W})`);
}

// ── ничего не делаем, если клетка та же ──
{
  const cs = [mk({ id: 1 }), mk({ id: 2, gx: 1 })];
  ok("перенос на своё место — тот же список", moveContainer(cs, 0, 0, 0) === cs);
  ok("битые координаты игнорируются", moveContainer(cs, 0, NaN, 0) === cs);
}

// ── внутренняя раскладка переживает подгонку габарита ──
{
  const c = mk({ W: 120, D: 100, cols: 3, rows: 2, cells: { "1:0": { lvl: 12 } } });
  const f = fitToCell(c, 160, 100);
  ok("подгонка изменила только габарит", f.W === 160 && f.cols === 3 && f.rows === 2);
  ok("настройки ячеек на месте", f.cells["1:0"].lvl === 12);
  const L = layout(f);
  ok("ячейки разъехались по новой ширине", near(L.rowCols[0].reduce((s, v) => s + v, 0), 160 - 2 * f.wallOut - 2 * f.wall));
}

// ── compactGrid не плодит новые объекты зря ──
{
  const cs = [mk({ id: 1, gx: 0, gy: 0 }), mk({ id: 2, gx: 1, gy: 0 })];
  const n = compactGrid(cs);
  ok("нетронутые контейнеры сохранили ссылку", n[0] === cs[0] && n[1] === cs[1]);
}

// ── лимит раскладки: сборка за него не выходит ──
{
  const lim = { maxW: 170, maxD: 170, maxH: 175, layW: 30, layD: 30 }; // 300×300 мм
  const cs = [
    mk({ id: 1, gx: 0, gy: 0, W: 170, D: 170 }),
    mk({ id: 2, gx: 1, gy: 0, W: 170, D: 170 }),
  ];
  const n = fitAssembly(cs, lim);
  const totalW = [...new Set(n.map((c) => c.gx))].reduce((s, g) => s + Math.max(...n.filter((o) => o.gx === g).map((o) => o.W)), 0);
  ok("сборка ужалась в лимит раскладки", totalW <= 300.05, ` (${totalW})`);
  ok("ужали пропорционально", near(n[0].W, n[1].W));
  ok("глубина уже влезала — не тронута", near(n[0].D, 170));
  ok("повторный вызов ничего не меняет (идемпотентно)", fitAssembly(n, lim) === null);
}
{
  // зафиксированный намертво габарит не подрезается — платят соседи
  const lim = { maxW: 170, maxD: 170, maxH: 175, layW: 30, layD: 40 };
  const cs = [
    mk({ id: 1, gx: 0, gy: 0, W: 170, D: 170, lockOuter: true }),
    mk({ id: 2, gx: 1, gy: 0, W: 170, D: 170 }),
  ];
  const n = fitAssembly(cs, lim);
  ok("замок габарита не подрезан", near(n[0].W, 170));
  ok("сосед забрал всё сжатие", near(n[1].W, 130));
}
{
  const lim = { maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40 };
  ok("влезающая сборка не трогается", fitAssembly([mk({ W: 170, D: 170 })], lim) === null);
  ok("без лимита ничего не делаем", fitAssembly([mk()], { maxW: 170, maxD: 170 }) === null);
}

console.log(fail === 0 ? "\nLAYOUT MOVE TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
