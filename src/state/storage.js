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
  // «кирпичная» раскладка: явные ширины ячеек по рядам (rowColWs[j]),
  // замки ширины отдельных ячеек ("i:j") и замки глубины рядов
  rowColWs: null, rowDs: null, lockedCellW: {}, lockedRows: {},
  // фиксированные ячейки: «контейнер внутри контейнера» с якорем к углу
  // или стенке ({w, d, anchor, lvl}); сетка обтекает их
  fixedCells: [],
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
    // переводим в «количество», сохраняя фактическую сетку; глобальный
    // замок ячейки убран вместе с кнопкой — снимаем, чтобы не заклинило
    d.containers = d.containers.map((c) => {
      let base = c.lockCell ? { ...c, lockCell: false } : c;
      if (base.gridMode === "size") {
        const L = layout(base);
        base = { ...base, gridMode: "count", cols: L.nCols, rows: L.nRows };
      }
      // старые общеколоночные размеры/замки (colWs/lockedCols) переводим
      // в пер-рядные: те же ширины в каждом ряду, замок — в каждом ряду
      if (base.colWs && base.colWs.length) {
        const L = layout(base);
        const rowColWs = { ...(base.rowColWs || {}) };
        const lockedCellW = { ...(base.lockedCellW || {}) };
        for (let j = 0; j < L.nRows; j++) {
          if (!rowColWs[j]) rowColWs[j] = base.colWs.slice();
          for (const i of Object.keys(base.lockedCols || {})) lockedCellW[i + ":" + j] = true;
        }
        base = { ...base, rowColWs, lockedCellW, colWs: null, lockedCols: {} };
      }
      return base;
    });
    nextId = Math.max(...d.containers.map((c) => c.id || 0), 1) + 1;
    return d;
  } catch (e) {
    return null;
  }
}
export const SAVED = loadSaved();
