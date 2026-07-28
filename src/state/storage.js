// ══════════════════════════════════════════════════════════════
// Контейнеры и автосохранение в localStorage
// ══════════════════════════════════════════════════════════════

import { CONN } from "../model/connectors.js";
import { layout } from "../model/layout.js";

let nextId = 2;
export const setNextId = (v) => { nextId = v; };

export const makeContainer = (src, gx, gy) => ({
  id: nextId++,
  gx, gy,
  W: src?.W ?? 170, D: src?.D ?? 170, H: src?.H ?? 30,
  cols: src?.cols ?? 1, rows: src?.rows ?? 1,
  gridMode: src?.gridMode ?? "count", cellWt: src?.cellWt ?? 40, cellDt: src?.cellDt ?? 40,
  wall: src?.wall ?? 1.6, wallOut: src?.wallOut ?? CONN.minWall, floor: src?.floor ?? 1.6,
  walls: {},
  cells: {},
  lockOuter: false, lockCell: false, cellW0: 0, cellD0: 0,
  // явные размеры колонок/рядов и их замки (фиксация отдельных ячеек)
  colWs: null, rowDs: null, lockedCols: {}, lockedRows: {},
});

// автосохранение в localStorage: на сервере работает всегда; там, где
// хранилище недоступно (песочницы предпросмотра), молча пропускаем
export function loadSaved() {
  try {
    const raw = window.localStorage.getItem("trayGenState");
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.containers) || !d.containers.length) return null;
    d.containers = d.containers.map((c) => ({ ...makeContainer(null, c.gx ?? 0, c.gy ?? 0), ...c }));
    // миграция старых сохранений: режим «размер ячейки» убран из UI —
    // переводим в «количество», сохраняя фактическую сетку
    d.containers = d.containers.map((c) => {
      if (c.gridMode !== "size") return c;
      const L = layout(c);
      return { ...c, gridMode: "count", cols: L.nCols, rows: L.nRows };
    });
    nextId = Math.max(...d.containers.map((c) => c.id || 0), 1) + 1;
    return d;
  } catch (e) {
    return null;
  }
}
export const SAVED = loadSaved();
