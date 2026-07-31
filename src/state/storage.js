// ══════════════════════════════════════════════════════════════
// Контейнеры и автосохранение в localStorage
// ══════════════════════════════════════════════════════════════

import { CONN } from "../model/connectors.js";
import { DEF_INSERTS } from "../model/inserts.js";
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
  // вставные стенки: направляющие на внутренних гранях, сами перегородки
  // печатаются отдельно и вдвигаются сверху
  inserts: { ...DEF_INSERTS },
});

// ── Приведение чисел к разумным пределам ──
// Файл проекта можно открыть чужой, битый или отредактированный руками.
// Одно значение вида rows: 0 или W: null роняло построение геометрии, и
// поскольку состояние сразу уходит в автосохранение, приложение оставалось
// сломанным и после перезагрузки. Поэтому каждое число проверяется.
const num = (v, def, lo, hi) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const ANCHORS = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

const sanitizeWall = (w) => {
  const o = obj(w), out = {};
  // сохраняем только заданные поля: остальное берётся из defWall
  if (o.h !== undefined) out.h = num(o.h, 30, 0, 400);
  if (o.t1 !== undefined) out.t1 = num(o.t1, 0, 0, 60);
  if (o.t2 !== undefined) out.t2 = num(o.t2, 0, 0, 60);
  if (o.rnd !== undefined) out.rnd = num(o.rnd, 0, 0, 10);
  if (o.dropH !== undefined) out.dropH = num(o.dropH, 3, 0, 400);
  if (o.hexSize !== undefined) out.hexSize = num(o.hexSize, 8, 2, 100);
  if (o.lineStep !== undefined) out.lineStep = num(o.lineStep, 14, 2, 100);
  if (o.seed !== undefined) out.seed = int(o.seed, 1, 0, 1e9);
  if (["none", "a", "b"].includes(o.drop)) out.drop = o.drop;
  if (["solid", "hex", "lines"].includes(o.face)) out.face = o.face;
  return out;
};

const sanitizeContainer = (c0) => {
  const c = { ...c0 };
  c.gx = int(c.gx, 0, -999, 999);
  c.gy = int(c.gy, 0, -999, 999);
  c.W = num(c.W, 170, 10, 2000);
  c.D = num(c.D, 170, 10, 2000);
  c.H = num(c.H, 30, 1, 500);
  c.cols = int(c.cols, 1, 1, 60);
  c.rows = int(c.rows, 1, 1, 60);
  c.cellWt = num(c.cellWt, 40, 2, 2000);
  c.cellDt = num(c.cellDt, 40, 2, 2000);
  c.wall = num(c.wall, 1.6, 0.2, 40);
  c.wallOut = num(c.wallOut, CONN.minWall, 0.2, 40);
  c.floor = num(c.floor, 1.6, 0.2, 40);
  c.gridMode = c.gridMode === "size" ? "size" : "count";
  c.walls = Object.fromEntries(Object.entries(obj(c.walls)).map(([k, w]) => [k, sanitizeWall(w)]));
  c.cells = Object.fromEntries(
    Object.entries(obj(c.cells)).map(([k, v]) => {
      const o = obj(v), out = {};
      if (o.lvl !== undefined) out.lvl = num(o.lvl, 0, 0, 500);
      if (["n", "s", "w", "e"].includes(o.tiltDir)) out.tiltDir = o.tiltDir;
      if (o.tiltA !== undefined) out.tiltA = num(o.tiltA, 5, 0, 60);
      return [k, out];
    })
  );
  c.fixedCells = (Array.isArray(c.fixedCells) ? c.fixedCells : [])
    .map((f) => ({
      w: num(f?.w, 30, 1, 2000),
      d: num(f?.d, 30, 1, 2000),
      anchor: ANCHORS.includes(f?.anchor) ? f.anchor : "nw",
      lvl: num(f?.lvl, 0, 0, 500),
    }));
  const ci = obj(c.inserts);
  c.inserts = {
    dir: ["x", "z"].includes(ci.dir) ? ci.dir : "none",
    step: num(ci.step, 20, 6, 200),
    thk: num(ci.thk, 1.6, 0.6, 10),
    clr: num(ci.clr, 0.2, 0, 1),
    proj: num(ci.proj, 1.2, 0.4, 6),
    rail: num(ci.rail, 1.6, 0.6, 6),
    show: !!ci.show,
  };
  c.lockedCellW = obj(c.lockedCellW);
  c.lockedRows = obj(c.lockedRows);
  // явные размеры по рядам: только конечные положительные числа
  const sizes = (v) => {
    if (!v || typeof v !== "object") return null;
    const out = {};
    for (const [k, arr] of Object.entries(v))
      if (Array.isArray(arr) && arr.length) out[k] = arr.map((x) => num(x, 10, 0.5, 2000));
    return Object.keys(out).length ? out : null;
  };
  c.rowColWs = sizes(c.rowColWs);
  c.rowDs = Array.isArray(c.rowDs) ? c.rowDs.map((x) => num(x, 10, 0.5, 2000)) : sizes(c.rowDs);
  if (c.connClr !== undefined) c.connClr = num(c.connClr, 0.2, 0, 1);
  return c;
};

// Приведение сохранённого/импортированного проекта к текущей модели:
// добавляет недостающие поля, чинит невозможные значения и мигрирует
// старые форматы. Возвращает null, если данные не похожи на проект.
export function normalizeProject(d) {
  try {
    if (!d || !Array.isArray(d.containers) || !d.containers.length) return null;
    d = { ...d };
    d.containers = d.containers.map((c) =>
      sanitizeContainer({ ...makeContainer(null, c?.gx ?? 0, c?.gy ?? 0), ...obj(c) })
    );
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
    // лимиты принтера и раскладки — тоже из файла, тоже проверяем
    const lim = obj(d.limits);
    d.limits = {
      maxW: num(lim.maxW, 170, 30, 2000),
      maxD: num(lim.maxD, 170, 30, 2000),
      maxH: num(lim.maxH, 175, 5, 2000),
      layW: num(lim.layW, 40, 3, 500),
      layD: num(lim.layD, 40, 3, 500),
      connClr: num(lim.connClr, 0.2, 0, 1),
    };
    // габариты не могут превышать лимиты принтера — приложение держит этот
    // инвариант при смене лимитов, файл проекта тоже обязан ему подчиняться
    d.containers = d.containers.map((c) => ({
      ...c,
      W: Math.min(c.W, d.limits.maxW),
      D: Math.min(c.D, d.limits.maxD),
      H: Math.min(c.H, d.limits.maxH),
      walls: Object.fromEntries(
        Object.entries(c.walls).map(([k, w]) => [k, w.h === undefined ? w : { ...w, h: Math.min(w.h, d.limits.maxH) }])
      ),
    }));
    nextId = Math.max(...d.containers.map((c) => c.id || 0), 1) + 1;
    return d;
  } catch (e) {
    return null;
  }
}

// автосохранение в localStorage: на сервере работает всегда; там, где
// хранилище недоступно (песочницы предпросмотра), молча пропускаем
export function loadSaved() {
  try {
    const raw = window.localStorage.getItem("trayGenState");
    return raw ? normalizeProject(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}
export const SAVED = loadSaved();

// ── Проект в файл и обратно ──
export const PROJECT_FORMAT = "tray-generator-project";

export function exportProject(state) {
  const data = { format: PROJECT_FORMAT, version: 1, ...state };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  link.href = url;
  link.download = `tray-project-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Читает файл проекта. onDone(project | null) — null, если файл
// не является проектом генератора
export function importProject(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result));
      onDone(normalizeProject(raw));
    } catch (e) {
      onDone(null);
    }
  };
  reader.onerror = () => onDone(null);
  reader.readAsText(file);
}
