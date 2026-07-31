// ══════════════════════════════════════════════════════════════
// Вставные стенки: контейнер печатается с направляющими на внутренних
// гранях, сами перегородки печатаются отдельно и вдвигаются сверху.
//
// Направляющая — пара вертикальных рёбер НА грани стенки, а не выборка
// в ней: внутри толщины внешней стенки живёт паз соединителя («ласточкин
// хвост»), и канавка бы его срезала. Рёбра ничего не ослабляют и работают
// при любой толщине стенки.
// ══════════════════════════════════════════════════════════════

import { boxSolid } from "../geometry/solids.js";

// dir: "none" — выключено; "x" — вставки делят ширину (пазы на передней и
// задней стенках); "z" — делят глубину (пазы на боковых стенках).
export const DEF_INSERTS = {
  dir: "none",
  step: 20,   // шаг мест под вставку, мм
  thk: 1.6,   // толщина вставной стенки
  clr: 0.2,   // зазор на сторону между вставкой и направляющей
  proj: 1.2,  // насколько ребро выступает от грани внутрь ячейки
  rail: 1.6,  // ширина каждого ребра
  show: false, // показывать вставки в превью
};
export const insertsOf = (c) => ({ ...DEF_INSERTS, ...(c && c.inserts) });

// Полуширина канала: от оси вставки до внешнего края ребра
export const railHalf = (ins) => ins.thk / 2 + ins.clr + ins.rail;

// Места под вставку — от центра наружу с шагом step. Центр всегда есть:
// одна перегородка посередине нужна чаще всего. Крайние места отбрасываются,
// если вставка встанет слишком близко к стенке.
export function insertSlots(c, axis) {
  const ins = insertsOf(c);
  if (ins.dir !== axis) return [];
  const inner = (axis === "x" ? c.W : c.D) - 2 * c.wallOut;
  const edge = railHalf(ins) + 2; // минимальный отступ оси от грани стенки
  const step = Math.max(6, ins.step);
  const n = Math.floor((inner / 2 - edge) / step);
  if (n < 0) return [];
  const out = [];
  for (let k = -n; k <= n; k++) out.push(k * step);
  return out;
}

// Габариты вставной стенки для оси axis: длина — по внутреннему пролёту
// поперёк неё, высота — от дна до кромки (чуть ниже, чтобы не торчала).
export function insertSize(c, axis) {
  const ins = insertsOf(c);
  const span = (axis === "x" ? c.D : c.W) - 2 * c.wallOut;
  return {
    len: Math.round((span - 2 * ins.clr) * 10) / 10,
    hgt: Math.round(Math.max(4, c.H - c.floor - 0.3) * 10) / 10,
    thk: ins.thk,
  };
}

// Вставная стенка как отдельная деталь, лежащая плашмя: длина по X,
// высота по Z, толщина вертикально — печатается с стола без поддержек.
export function insertPlateSolids(c, axis) {
  const s = insertSize(c, axis);
  return [boxSolid(0, s.thk / 2, 0, s.len, s.thk, s.hgt, "insert")];
}

// Вставная стенка на своём месте внутри контейнера (только для превью).
// u — координата вдоль оси деления, yBot — верх дна.
export function insertInPlace(c, axis, u, yBot) {
  const s = insertSize(c, axis);
  const y = yBot + s.hgt / 2;
  return axis === "x"
    ? boxSolid(u, y, 0, s.thk, s.hgt, s.len, "insert")
    : boxSolid(0, y, u, s.len, s.hgt, s.thk, "insert");
}
