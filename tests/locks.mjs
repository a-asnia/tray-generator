// Тесты пер-ячеечных замков («кирпичная» раскладка): замок держит только
// свою ячейку, ряды независимы, минимальный габарит, вырожденные случаи.
import { layout, minOuterDim, fitSizes } from "../src/model/layout.js";

const base = {
  W: 170, D: 170, H: 30, cols: 3, rows: 2, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 2.8, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null, lockedCellW: {}, lockedRows: {},
};

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? "OK " : "FAIL"} ${name}`); if (!cond) fail++; };
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;
const sum = (a) => a.reduce((s, v) => s + v, 0);

// база: без явных размеров все ряды равномерные и одинаковые
const L0 = layout(base);
ok("без замков: 3 равные ячейки в каждом ряду",
  L0.rowCols.length === 2 && L0.rowCols.every((r) => r.length === 3 && near(r[0], r[2])));

// замок ячейки (0,0) на 60 мм, W ужали до 150: держится ТОЛЬКО она,
// соседи по её ряду ужались, а ряд 1 остался равномерным (независимым)
const cL = { ...base, rowColWs: { 0: [60, 50.6, 50.6] }, lockedCellW: { "0:0": true } };
const L1 = layout({ ...cL, W: 150 });
const innerTotal = 150 - 2 * 2.8 - 2 * 1.6;
ok("замкнутая ячейка (0,0) держит 60 мм", near(L1.rowCols[0][0], 60));
ok("свободные ячейки её ряда ужались поровну", near(L1.rowCols[0][1], L1.rowCols[0][2]) && L1.rowCols[0][1] < 50.6);
ok("сумма ячеек ряда 0 = внутренней ширине", near(sum(L1.rowCols[0]), innerTotal));
ok("ряд 1 независим: равномерный", near(L1.rowCols[1][0], L1.rowCols[1][2]) && near(sum(L1.rowCols[1]), innerTotal));

// рост W: свободные растут, замкнутая стоит
const L2 = layout({ ...cL, W: 200 });
ok("при росте W замкнутая держит 60 мм", near(L2.rowCols[0][0], 60) && L2.rowCols[0][1] > 50.6);

// перегородки рядов не обязаны совпадать: у ряда 1 свои размеры
const brick = { ...base, rowColWs: { 0: [60, 50.6, 50.6], 1: [40, 80, 41.2] } };
const L3 = layout(brick);
ok("кирпичная раскладка: ряды с разными перегородками",
  near(L3.rowCols[0][0], 60) && near(L3.rowCols[1][0], 40) && near(L3.rowCols[1][1], 80));

// у рядов может быть разное ЧИСЛО ячеек
const diffN = { ...base, rowColWs: { 1: [80, 81.2] } };
const L4 = layout(diffN);
ok("разное число ячеек в рядах", L4.nColsAt(0) === 3 && L4.nColsAt(1) === 2);

// замок ряда (глубина)
const rL = { ...base, rowDs: [90, 71.2], lockedRows: { 0: true } };
const L5 = layout({ ...rL, D: 140 });
ok("замкнутый ряд держит 90 мм глубины", near(L5.rowDs[0], 90) && near(sum(L5.rowDs), 140 - 5.6 - 1.6));

// минимальный габарит: самый требовательный ряд (замок 60 + 2×10 + стенки)
const mo = minOuterDim(cL, "W");
ok(`minOuterDim W = ${mo.toFixed(1)} (60 + 2×10 + стенки)`, near(mo, 2 * 2.8 + 2 * 1.6 + 60 + 20));

// весь ряд замкнут, габарит принудительно меньше: масштабируются все
const allL = layout({ ...base, W: 100, rowColWs: { 0: [60, 50.6, 50.6] }, lockedCellW: { "0:0": true, "1:0": true, "2:0": true } });
ok("весь ряд замкнут + принудительное ужатие: сумма сходится", near(sum(allL.rowCols[0]), 100 - 5.6 - 3.2));

// fitSizes: точное распределение
const f = fitSizes([40, 40, 40], { 1: true }, 100);
ok("fitSizes: замкнутый 40, свободные делят 60", near(f[1], 40) && near(f[0] + f[2], 60));

// геометрия согласована: правые края обоих рядов на внутренней грани
const Lb = layout(brick);
ok("правый край последней ячейки ряда 0 = внутренняя грань",
  near(Lb.cx0(2, 0) + Lb.cw(2, 0), (170 - 2 * 2.8) / 2));
ok("правый край последней ячейки ряда 1 = внутренняя грань",
  near(Lb.cx0(2, 1) + Lb.cw(2, 1), (170 - 2 * 2.8) / 2));

console.log(fail === 0 ? "\nLOCK TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
