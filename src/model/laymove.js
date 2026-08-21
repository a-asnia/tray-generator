// ── Раскладка контейнеров: ряды со свободными ширинами ──
// Сборка — это стопка РЯДОВ. Внутри ряда контейнеры стоят слева направо
// вплотную, и ширина у каждого своя: 160 + 160 в одном ряду и 118 в
// другом — нормальная раскладка, колонки между рядами не связаны.
// Общая для ряда только глубина: иначе между рядами появились бы щели.
//
// Адресация: gy — номер ряда, gx — место в ряду (порядок слева направо).

import { minOuterDim } from "./layout.js";

const mvR1 = (v) => Math.round(v * 10) / 10;
export const MIN_BOX = 30; // минимальный габарит контейнера, мм

// Ряды сборки: [{ gy, list (по порядку gx), depth, width }]
export function rowsOf(containers) {
  const gys = [...new Set(containers.map((c) => c.gy))].sort((a, b) => a - b);
  return gys.map((gy) => {
    const list = containers.filter((c) => c.gy === gy).sort((a, b) => a.gx - b.gx);
    return {
      gy,
      list,
      depth: Math.max(MIN_BOX, ...list.map((c) => c.D)),
      width: list.reduce((s, c) => s + c.W, 0),
      // ряд короче самого широкого прижимается к левому краю или к правому
      align: list[0] && list[0].rowAlign === "right" ? "right" : "left",
    };
  });
}

// Позиции контейнеров на столе: ряды идут от ближнего к дальнему, внутри
// ряда — слева направо вплотную; ряды выровнены по левому краю.
export function placeContainers(containers) {
  const rows = rowsOf(containers);
  const totalD = rows.reduce((s, r) => s + r.depth, 0);
  const totalW = Math.max(0, ...rows.map((r) => r.width));
  const pos = new Map(); // id → { ox, oz, row }
  let z = 0;
  for (const r of rows) {
    let x = r.align === "right" ? totalW - r.width : 0;
    for (const c of r.list) {
      pos.set(c.id, { ox: x + c.W / 2 - totalW / 2, oz: z + r.depth / 2 - totalD / 2, row: r });
      x += c.W;
    }
    z += r.depth;
  }
  // порядок items совпадает с порядком списка контейнеров: номера
  // контейнеров в панели — это индексы в нём
  const items = containers.map((c) => ({ c, ...(pos.get(c.id) || { ox: 0, oz: 0, row: rows[0] }) }));
  return { items, rows, totalW, totalD };
}

// Соседи по сборке: в ряду — предыдущий и следующий (стыкуются полностью),
// между рядами — все, чьи пролёты по X пересекаются. Возвращает по каждой
// стороне список { c, at (позиция в списке items), a, b } — абсолютный
// перехлёст, по которому считаются замки.
export function neighborsOf(placed, idx) {
  const me = placed.items[idx];
  const x0 = me.ox - me.c.W / 2, x1 = me.ox + me.c.W / 2;
  const out = { W: [], E: [], N: [], S: [] };
  placed.items.forEach((o, k) => {
    if (k === idx) return;
    if (o.c.gy === me.c.gy) {
      if (o.c.gx === me.c.gx - 1) out.W.push({ item: o, k });
      if (o.c.gx === me.c.gx + 1) out.E.push({ item: o, k });
      return;
    }
    if (o.c.gy !== me.c.gy - 1 && o.c.gy !== me.c.gy + 1) return;
    const a = Math.max(x0, o.ox - o.c.W / 2), b = Math.min(x1, o.ox + o.c.W / 2);
    if (b - a < 0.5) return; // касание углом — не соседство
    (o.c.gy < me.c.gy ? out.N : out.S).push({ item: o, k, a, b });
  });
  return out;
}

// Подгонка контейнера под ряд: общая только глубина, ширина остаётся своей.
export function fitToRow(c, depth) {
  if (c.lockOuter) return c;
  const D2 = mvR1(Math.max(MIN_BOX, depth ?? c.D, minOuterDim(c, "D")));
  if (Math.abs(D2 - c.D) < 0.05) return c;
  // внутренние размеры не переписываем: решатель растянет ряды сам
  return { ...c, D: D2 };
}

// Нумерация: ряды подряд с нуля, места в ряду — подряд слева направо.
// Ссылки на неизменившиеся контейнеры сохраняются (жив кэш геометрии).
export function renumber(containers) {
  const rows = rowsOf(containers);
  const out = [];
  rows.forEach((r, gy) => {
    r.list.forEach((c, gx) => out.push(c.gy === gy && c.gx === gx ? c : { ...c, gx, gy }));
  });
  // порядок в массиве сохраняем прежним: номера контейнеров не скачут
  return containers.map((c) => out.find((o) => o.id === c.id) || c);
}

// Выравнивание глубины внутри затронутых рядов (клетка ряда держит глубину)
function tidyRows(containers, gys) {
  const depth = new Map(rowsOf(containers).map((r) => [r.gy, r.depth]));
  return containers.map((c) => (gys.has(c.gy) ? fitToRow(c, depth.get(c.gy)) : c));
}

// ── Перенос контейнера ──
// gy — ряд назначения (может быть новым: −1 перед первым, n после последнего),
// pos — место в ряду (0…длина). Возвращает новый список либо прежний.
export function moveContainer(containers, idx, gy, pos) {
  const src = containers[idx];
  if (!src || !Number.isFinite(gy) || !Number.isFinite(pos)) return containers;
  const rows = rowsOf(containers);
  const row = rows.find((r) => r.gy === gy);
  const sameRow = src.gy === gy;
  if (sameRow && row) {
    const cur = row.list.indexOf(src);
    if (pos === cur || pos === cur + 1) return containers; // ничего не меняется
  }
  const depth = row ? row.depth : src.D;
  // порядок в новом ряду: вынимаем контейнер и вставляем на место pos
  const target = (row ? row.list.filter((c) => c !== src) : []);
  const at = Math.max(0, Math.min(target.length, sameRow && row && row.list.indexOf(src) < pos ? pos - 1 : pos));
  target.splice(at, 0, src);
  const orderIn = new Map(target.map((c, k) => [c.id, k]));
  // старый ряд ужимается: места пересчитываются подряд
  const restOld = rows.find((r) => r.gy === src.gy);
  const oldOrder = new Map((restOld ? restOld.list.filter((c) => c !== src) : []).map((c, k) => [c.id, k]));
  let next = containers.map((c) => {
    if (c.id === src.id) return { ...fitToRow(c, depth), gx: orderIn.get(c.id), gy };
    if (c.gy === gy) return { ...c, gx: orderIn.get(c.id) };
    if (c.gy === src.gy) return { ...c, gx: oldOrder.get(c.id) };
    return c;
  });
  next = renumber(next);
  const touched = new Set([next[idx].gy]);
  return tidyRows(next, touched);
}

// ── Жёсткая рамка стола ──
// Лимит раскладки не превышается никогда: ряд шире рамки ужимается по
// ширине (пропорционально, но не ниже 30 мм и не за счёт контейнеров с
// замком габарита), стопка рядов глубже рамки — по глубине.
// Идемпотентно: на помещающейся сборке возвращает null.
export function fitAssembly(containers, limits) {
  if (!containers || !containers.length || !limits) return null;
  let out = containers;
  const shrink = (sizes, frozen, total) => {
    // sizes: Map key→размер; frozen: Set ключей, которые не ужимаются
    let excess = mvR1([...sizes.values()].reduce((s, v) => s + v, 0) - total);
    if (excess <= 0.05) return null;
    const next = new Map(sizes);
    for (let pass = 0; pass < 6 && excess > 0.05; pass++) {
      const open = [...next.keys()].filter((k) => !frozen.has(k) && next.get(k) > MIN_BOX + 0.05);
      const room = open.reduce((s, k) => s + next.get(k) - MIN_BOX, 0);
      if (room <= 0.05) break;
      const take = Math.min(excess, room);
      for (const k of open) {
        const v = mvR1(Math.max(MIN_BOX, next.get(k) - (take * (next.get(k) - MIN_BOX)) / room));
        excess = mvR1(excess - (next.get(k) - v));
        next.set(k, v);
      }
    }
    while (excess > 0.05) {
      const open = [...next.keys()].filter((k) => !frozen.has(k) && next.get(k) > MIN_BOX + 0.05);
      if (!open.length) break;
      const k = open.reduce((a, b) => (next.get(b) > next.get(a) ? b : a));
      const v = mvR1(Math.max(MIN_BOX, next.get(k) - excess));
      excess = mvR1(excess - (next.get(k) - v));
      next.set(k, v);
    }
    return next;
  };

  // 1. ширина: каждый ряд отдельно
  const limW = (limits.layW || 0) * 10;
  if (limW > 0) {
    for (const r of rowsOf(out)) {
      const sizes = new Map(r.list.map((c) => [c.id, c.W]));
      const frozen = new Set(r.list.filter((c) => c.lockOuter).map((c) => c.id));
      const fixed = shrink(sizes, frozen, limW);
      if (!fixed) continue;
      out = out.map((c) => (fixed.has(c.id) && c.W > fixed.get(c.id) + 0.05 ? { ...c, W: fixed.get(c.id) } : c));
    }
  }
  // 2. глубина: стопка рядов
  const limD = (limits.layD || 0) * 10;
  if (limD > 0) {
    const rows = rowsOf(out);
    const sizes = new Map(rows.map((r) => [r.gy, r.depth]));
    const frozen = new Set(rows.filter((r) => r.list.some((c) => c.lockOuter)).map((r) => r.gy));
    const fixed = shrink(sizes, frozen, limD);
    if (fixed)
      out = out.map((c) => (!c.lockOuter && c.D > fixed.get(c.gy) + 0.05 ? { ...c, D: fixed.get(c.gy) } : c));
  }
  return out === containers ? null : out;
}

// совместимость: габариты «клеток» (ширина по месту в ряду, глубина ряда)
export function gridDims(containers) {
  const colW = {}, rowD = {};
  for (const c of containers) {
    colW[c.gx] = Math.max(colW[c.gx] ?? 0, c.W);
    rowD[c.gy] = Math.max(rowD[c.gy] ?? 0, c.D);
  }
  return { colW, rowD };
}
