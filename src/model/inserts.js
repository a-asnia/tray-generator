// ══════════════════════════════════════════════════════════════
// Вставные стенки: контейнер печатается с направляющими на внутренних
// гранях, сами перегородки печатаются отдельно и вдвигаются сверху.
//
// Направляющая — пара вертикальных рёбер НА грани стенки, а не выборка
// в ней: внутри толщины внешней стенки живёт паз соединителя («ласточкин
// хвост»), и канавка бы его срезала. Рёбра ничего не ослабляют и работают
// при любой толщине стенки.
//
// Печатные стенки ПОПЕРЁК вставки ей не помеха: над каждой в детали
// делается вырез снизу, и вставка седлает стенку (решётка egg-crate).
// Низ детали повторяет лесенку полов, верх не выступает над кромкой.
// Если поперечная стенка почти в высоту контейнера, над вырезом не
// остаётся сплошной полосы — такое место непригодно и пропускается.
// ══════════════════════════════════════════════════════════════

import { boxSolid } from "../geometry/solids.js";
import { layout, getWall, getCellLvl } from "./layout.js";

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

// Минимальная сплошная полоса над вырезом: тоньше — деталь складывается
// в руках и не ведёт себя как одна перегородка.
export const MIN_WEB = 5;

// Все геометрические места под вставку — от центра наружу с шагом step.
// Центр всегда есть: одна перегородка посередине нужна чаще всего.
// Крайние места отбрасываются, если вставка встанет слишком близко к стенке.
export function insertSlotsAll(c, axis) {
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

// Пригодные места: где вставка может оседлать все поперечные стенки
export function insertSlots(c, axis) {
  return insertSlotsAll(c, axis).filter((u) => insertProfile(c, axis, u) !== null);
}

// Профиль вставки на месте u — прямоугольники {s0, s1, y0, y1} в
// координатах (s — вдоль пролёта, y — высота от стола). Низ каждого
// участка сидит на полу своей ячейки (лесенка), над поперечными печатными
// стенками — вырез до верха стенки с запасом. null — место непригодно:
// поперечная стенка не оставляет сплошной полосы MIN_WEB над вырезом.
export function insertProfile(c, axis, u) {
  const ins = insertsOf(c);
  const L = layout(c);
  const yTop = Math.max(4, c.H - 0.3); // верх чуть ниже кромки
  const span = (axis === "x" ? c.D : c.W) - 2 * c.wallOut;
  const sEnd = span / 2 - ins.clr;
  const lvlOf = (i, j) => Math.min(getCellLvl(c, i, j), c.H - 4);
  // ячейки вдоль пролёта и поперечные стенки между ними
  const cells = []; // {s0, s1, lvl}
  const walls = []; // {sMid, h} — h ≤ 0.3 означает «стенки нет»
  if (axis === "x") {
    // вставка идёт вдоль Z и пересекает все ряды
    for (let j = 0; j < L.nRows; j++) {
      const i = L.cellIndexAt(j, u);
      cells.push({ s0: L.cz0(j), s1: L.cz0(j) + L.cd(j), lvl: lvlOf(i, j) });
      if (j < L.nRows - 1)
        walls.push({ sMid: L.cz0(j) + L.cd(j) + c.wall / 2, h: getWall(c, `h:${j}:${i}`).h });
    }
  } else {
    // вставка идёт вдоль X внутри одного ряда — того, где стоит
    let j = 0, best = -1e9;
    for (let jj = 0; jj < L.nRows; jj++) {
      const d = Math.min(u - L.cz0(jj), L.cz0(jj) + L.cd(jj) - u);
      if (d > best) { best = d; j = jj; }
    }
    for (let i = 0; i < L.nColsAt(j); i++) {
      cells.push({ s0: L.cx0(i, j), s1: L.cx0(i, j) + L.cw(i, j), lvl: lvlOf(i, j) });
      if (i < L.nColsAt(j) - 1)
        walls.push({ sMid: L.cx0(i, j) + L.cw(i, j) + c.wall / 2, h: getWall(c, `v:${i}:${j}`).h });
    }
  }
  // высокая поперечная стенка: вырез съел бы деталь — места нет
  for (const w of walls) if (w.h > 0.3 && yTop - (w.h + 0.5) < MIN_WEB) return null;

  const cutW = c.wall / 2 + ins.clr; // полуширина выреза над стенкой
  const rects = [];
  const push = (s0, s1, y0) => {
    const a = Math.max(s0, -sEnd), b = Math.min(s1, sEnd);
    if (b - a > 0.05 && yTop - y0 > 0.5) rects.push({ s0: a, s1: b, y0, y1: yTop });
  };
  for (let k = 0; k < cells.length; k++) {
    const a = k === 0 ? -sEnd : walls[k - 1].sMid + cutW;
    const b = k === cells.length - 1 ? sEnd : walls[k].sMid - cutW;
    push(a, b, c.floor + cells[k].lvl);
  }
  for (let k = 0; k < walls.length; k++) {
    // над стыком: выше поперечной стенки и выше плит пола, заходящих под неё
    const yFloor = c.floor + Math.max(cells[k].lvl, cells[k + 1].lvl);
    const y0 = Math.max(walls[k].h > 0.3 ? walls[k].h + 0.5 : 0, yFloor);
    push(walls[k].sMid - cutW, walls[k].sMid + cutW, y0);
  }
  return rects;
}

// Габариты вставной стенки для оси axis (для подписи и имени файла):
// длина — по внутреннему пролёту поперёк неё, высота — от самого низкого
// участка низа до верха. u — самое центральное пригодное место.
export function insertSize(c, axis) {
  const ins = insertsOf(c);
  const span = (axis === "x" ? c.D : c.W) - 2 * c.wallOut;
  const slots = insertSlots(c, axis);
  const u = slots.length ? slots.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)) : 0;
  const rects = insertProfile(c, axis, u);
  const yMin = rects && rects.length ? Math.min(...rects.map((r) => r.y0)) : c.floor;
  return {
    len: Math.round((span - 2 * ins.clr) * 10) / 10,
    hgt: Math.round(Math.max(4, c.H - 0.3 - yMin) * 10) / 10,
    thk: ins.thk,
    u,
  };
}

// Вставная стенка как отдельная деталь, лежащая плашмя: длина по X,
// высота по Z, толщина вертикально — печатается со стола без поддержек.
export function insertPlateSolids(c, axis) {
  const ins = insertsOf(c);
  const sz = insertSize(c, axis);
  const rects = insertProfile(c, axis, sz.u) || [];
  if (!rects.length) return [boxSolid(0, ins.thk / 2, 0, sz.len, ins.thk, sz.hgt, "insert")];
  const yMin = Math.min(...rects.map((r) => r.y0));
  const yMax = Math.max(...rects.map((r) => r.y1));
  const zOf = (y) => y - (yMin + yMax) / 2; // высота детали центрируется по Z
  return rects.map((r) =>
    boxSolid((r.s0 + r.s1) / 2, ins.thk / 2, (zOf(r.y0) + zOf(r.y1)) / 2, r.s1 - r.s0, ins.thk, r.y1 - r.y0, "insert")
  );
}

// Вставная стенка на своём месте внутри контейнера (только для превью).
// u — координата вдоль оси деления.
export function insertInPlace(c, axis, u) {
  const ins = insertsOf(c);
  const rects = insertProfile(c, axis, u) || [];
  return rects.map((r) => axis === "x"
    ? boxSolid(u, (r.y0 + r.y1) / 2, (r.s0 + r.s1) / 2, ins.thk, r.y1 - r.y0, r.s1 - r.s0, "insert")
    : boxSolid((r.s0 + r.s1) / 2, (r.y0 + r.y1) / 2, u, r.s1 - r.s0, r.y1 - r.y0, ins.thk, "insert"));
}
