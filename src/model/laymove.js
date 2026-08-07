// ── Перенос контейнеров по раскладке (перетаскивание мышью) ──
// Раскладка — сетка клеток: ширину колонки задаёт самый широкий контейнер
// в ней, глубину ряда — самый глубокий. Поэтому переехавший контейнер
// подгоняется под габарит НОВОЙ клетки, а не тащит свой размер с собой:
// иначе колонка расползается, соседи остаются прежними, и сборка расходится
// щелями — а «ласточкины хвосты» соединителей повисают в воздухе.

import { minOuterDim } from "./layout.js";

const mvR1 = (v) => Math.round(v * 10) / 10;

// габариты клеток сетки: ширины колонок по gx и глубины рядов по gy
export function gridDims(containers) {
  const colW = {}, rowD = {};
  for (const c of containers) {
    colW[c.gx] = Math.max(colW[c.gx] ?? 0, c.W);
    rowD[c.gy] = Math.max(rowD[c.gy] ?? 0, c.D);
  }
  return { colW, rowD };
}

// Подгонка контейнера под клетку. Меньше своих замков (зафиксированные
// ячейки, фиксированные боксы) он стать не может — тогда под него
// расширится сама клетка. Габарит «намертво» (lockOuter) не трогается.
export function fitToCell(c, W, D) {
  if (c.lockOuter) return c;
  const W2 = mvR1(Math.max(30, W ?? c.W, minOuterDim(c, "W")));
  const D2 = mvR1(Math.max(30, D ?? c.D, minOuterDim(c, "D")));
  if (Math.abs(W2 - c.W) < 0.05 && Math.abs(D2 - c.D) < 0.05) return c;
  // внутренние размеры (ряды, ширины ячеек) не переписываем: решатель
  // раскладки сам растянет свободные пропорционально новому пролёту
  return { ...c, W: W2, D: D2 };
}

// Схлопывание опустевших колонок и рядов и сдвиг сетки к началу координат.
// Ссылки на неизменившиеся контейнеры сохраняются — кэш геометрии живёт.
export function compactGrid(containers) {
  const xs = [...new Set(containers.map((c) => c.gx))].sort((a, b) => a - b);
  const ys = [...new Set(containers.map((c) => c.gy))].sort((a, b) => a - b);
  const mx = new Map(xs.map((v, i) => [v, i]));
  const my = new Map(ys.map((v, i) => [v, i]));
  return containers.map((c) => {
    const gx = mx.get(c.gx), gy = my.get(c.gy);
    return gx === c.gx && gy === c.gy ? c : { ...c, gx, gy };
  });
}

// Выравнивание габаритов в затронутых колонках и рядах: все контейнеры
// колонки одной ширины, ряда — одной глубины (клетка держит размер).
function tidyAt(containers, cols, rows) {
  const { colW, rowD } = gridDims(containers);
  return containers.map((c) =>
    fitToCell(c, cols.has(c.gx) ? colW[c.gx] : c.W, rows.has(c.gy) ? rowD[c.gy] : c.D)
  );
}

// Перенос контейнера idx в клетку (gx, gy). Клетка занята — контейнеры
// меняются местами (каждый берёт габарит клетки, в которую приехал).
// Возвращает новый список; если двигать нечего — прежний (та же ссылка).
export function moveContainer(containers, idx, tgx, tgy) {
  const src = containers[idx];
  if (!src || !Number.isFinite(tgx) || !Number.isFinite(tgy)) return containers;
  if (src.gx === tgx && src.gy === tgy) return containers;
  const { colW, rowD } = gridDims(containers);
  const dst = containers.findIndex((c, i) => i !== idx && c.gx === tgx && c.gy === tgy);
  // габариты клеток берём ДО переноса: обе стороны обмена целятся в
  // размеры, которые клетки имели в исходной раскладке
  const place = (c, gx, gy) => ({ ...fitToCell(c, colW[gx], rowD[gy]), gx, gy });
  const next = containers.slice();
  next[idx] = place(src, tgx, tgy);
  if (dst >= 0) next[dst] = place(containers[dst], src.gx, src.gy);
  const packed = compactGrid(next);
  const cols = new Set([packed[idx].gx]), rows = new Set([packed[idx].gy]);
  // при обмене вторая клетка тоже затронута; при простом переезде колонка
  // источника могла только сузиться — выравнивать там нечего
  if (dst >= 0) { cols.add(packed[dst].gx); rows.add(packed[dst].gy); }
  return tidyAt(packed, cols, rows);
}

// Лимит раскладки — жёсткая рамка стола: сборка не вылезает за него
// никогда. Если сумма ширин колонок (глубин рядов) вышла за лимит —
// например, добавили контейнер в заполненную раскладку или уменьшили сам
// лимит, — лишнее снимается пропорционально, но не ниже 30 мм и не с
// контейнеров с зафиксированным намертво габаритом. Идемпотентно:
// на уже помещающейся сборке возвращает null.
export function fitAssembly(containers, limits) {
  if (!containers || !containers.length || !limits) return null;
  let out = containers;
  for (const ax of [
    { pos: "gx", dim: "W", total: (limits.layW || 0) * 10 },
    { pos: "gy", dim: "D", total: (limits.layD || 0) * 10 },
  ]) {
    if (!(ax.total > 0)) continue;
    const gs = [...new Set(out.map((c) => c[ax.pos]))].sort((a, b) => a - b);
    const size = new Map(gs.map((g) => [g, Math.max(30, ...out.filter((c) => c[ax.pos] === g).map((c) => c[ax.dim]))]));
    const frozen = new Set(gs.filter((g) => out.some((c) => c[ax.pos] === g && c.lockOuter)));
    let excess = [...size.values()].reduce((s, v) => s + v, 0) - ax.total;
    if (excess <= 0.05) continue;
    for (let pass = 0; pass < 6 && excess > 0.05; pass++) {
      const open = gs.filter((g) => !frozen.has(g) && size.get(g) > 30.05);
      const room = open.reduce((s, g) => s + size.get(g) - 30, 0);
      if (room <= 0.05) break;
      const take = Math.min(excess, room);
      for (const g of open) {
        const v = mvR1(Math.max(30, size.get(g) - (take * (size.get(g) - 30)) / room));
        excess = mvR1(excess - (size.get(g) - v));
        size.set(g, v);
      }
    }
    // ужимаем только то, что перестало влезать: контейнеры уже, чем
    // колонка (магнит соседей выключен), остаются как были
    out = out.map((c) => (!c.lockOuter && c[ax.dim] > size.get(c[ax.pos]) + 0.05
      ? { ...c, [ax.dim]: size.get(c[ax.pos]) } : c));
  }
  return out === containers ? null : out;
}
