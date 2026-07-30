// «Вся перегородка» собирает сегменты, лежащие на ОДНОЙ ЛИНИИ,
// а не сегменты с тем же индексом в других рядах.
import { layout, lineOf } from "../src/model/layout.js";

const base = {
  W: 170, D: 170, H: 30, cols: 3, rows: 3, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 2.8, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null, lockedCellW: {}, lockedRows: {}, fixedCells: [],
};

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? "OK " : "FAIL"} ${name}`); if (!cond) fail++; };
const xAt = (L, c, i, j) => L.cx0(i, j) + L.cw(i, j) + c.wall / 2;

// ── ровная сетка: линия = все ряды, как раньше
{
  const L = layout(base);
  const r = lineOf(base, "v:0:0");
  ok(`ровная сетка: 3 сегмента (${r.keys.join(", ")})`, r.keys.length === 3 &&
    r.keys.every((k) => k.startsWith("v:0:")));
}

// ── кирпичная раскладка: ряды 0 и 2 имеют перегородку на x=−25.2,
// ряд 1 — на другой позиции. Выбор должен взять только ряды 0 и 2.
{
  const c = { ...base, rowColWs: { 0: [60, 50, 51.4], 1: [90, 71.4], 2: [60, 40, 61.4] } };
  const L = layout(c);
  const x00 = xAt(L, c, 0, 0), x02 = xAt(L, c, 0, 2), x01 = xAt(L, c, 0, 1);
  ok(`подготовка: ряд0 и ряд2 на одной линии (${x00.toFixed(1)} = ${x02.toFixed(1)}), ряд1 в стороне (${x01.toFixed(1)})`,
    Math.abs(x00 - x02) < 0.05 && Math.abs(x00 - x01) > 5);
  const r = lineOf(c, "v:0:0");
  ok(`выбрана линия из 2 сегментов: ${r.keys.join(", ")}`,
    r.keys.length === 2 && r.keys.includes("v:0:0") && r.keys.includes("v:0:2"));
  ok("сегмент другого ряда с тем же индексом НЕ попал", !r.keys.includes("v:0:1"));
  // все выбранные действительно на одной линии
  const allSame = r.keys.every((k) => {
    const [, ii, jj] = k.split(":").map(Number);
    return Math.abs(xAt(L, c, ii, jj) - x00) < 0.05;
  });
  ok("все выбранные сегменты на одной прямой", allSame);
}

// ── выбор среднего сегмента ряда 1 (одиночная линия)
{
  const c = { ...base, rowColWs: { 0: [60, 50, 51.4], 1: [90, 71.4], 2: [60, 40, 61.4] } };
  const r = lineOf(c, "v:0:1");
  ok(`одиночная перегородка ряда 1: ${r.keys.join(", ")}`, r.keys.length === 1 && r.keys[0] === "v:0:1");
}

// ── линия по второй перегородке: ряды 0 и 2 имеют вторую перегородку
// в разных местах (110 и 100) → каждая сама по себе
{
  const c = { ...base, rowColWs: { 0: [60, 50, 51.4], 1: [90, 71.4], 2: [60, 40, 61.4] } };
  const L = layout(c);
  const r = lineOf(c, "v:1:0");
  const x10 = xAt(L, c, 1, 0), x12 = xAt(L, c, 1, 2);
  ok(`вторые перегородки в разных местах (${x10.toFixed(1)} ≠ ${x12.toFixed(1)}) → сегмент один`,
    Math.abs(x10 - x12) > 5 && r.keys.length === 1);
}

// ── горизонтальная перегородка: все сегменты ряда (они на одной линии)
{
  const c = { ...base, rowColWs: { 0: [60, 50, 51.4], 1: [90, 71.4] } };
  const r = lineOf(c, "h:0:1");
  ok(`горизонталь ряда 0: ${r.keys.length} сегм.`, r.keys.length === 3 && r.keys.every((k) => k.startsWith("h:0:")));
}

// ── стенка фиксированного бокса не собирается в линию
{
  const c = { ...base, fixedCells: [{ w: 40, d: 40, anchor: "nw" }] };
  const r = lineOf(c, "fw:0:e");
  ok(`стенка бокса — одиночная (${r.keys.join(", ")})`, r.keys.length === 1 && r.keys[0] === "fw:0:e");
}

console.log(fail === 0 ? "\nLINE TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
