// ── Пресеты контейнеров ──
// Пресет настраивает ВЫБРАННЫЙ контейнер под типовую задачу одним
// нажатием: след по нижней части (Ш×Г), место в раскладке, толщины
// стенок и дна остаются прежними, а сетка, высоты стенок, уровни полов
// и фиксации перезаписываются. Дальше всё правится обычными редакторами:
// ступеньки горки — это ряды, их ширина — глубина ряда, уровни — уровень
// пола ячейки.

import { layout, getCellLvl } from "./layout.js";

// настройки «Горки» по умолчанию: ступенек, шаг уровня, колонок (делят
// ступени на отсеки), бортик (высота стенок над полом — большой бортик
// при низком поле даёт глубокие ячейки). Ступени равной глубины, колонки
// равной ширины — никакого «остатка» последнему ряду.
export const GORKA_DEF = { steps: 3, stepH: 15, cols: 1, lip: 6, base: 0 };

// бортик над полом своей ступени по умолчанию
const LIP = 6;

// ── Горка — «живой» пресет ──
// Бортики горки не хранятся, а ПРОИЗВОДЯТСЯ от фактических уровней полов:
// уровень любой ячейки и число колонок можно менять как угодно — стенки
// пересчитываются и следуют лесенке. Задняя стенка (спинка) не задаётся
// и остаётся высотой контейнера.

// Высоты всех стенок-сегментов горки по текущим уровням полов
export function stairsWalls(c) {
  const L = layout(c);
  const lip = c.stairsLip ?? LIP; // хранится на контейнере (параметр «Бортик»)
  const lvl = (i, j) => Math.min(getCellLvl(c, i, j), c.H - 4);
  const h = (v) => r1(Math.min(c.H, v + c.floor + lip));
  const walls = {};
  for (let i = 0; i < L.nColsAt(0); i++) walls["o:n:" + i] = { h: h(lvl(i, 0)) };
  for (let j = 0; j < L.nRows; j++) {
    walls["o:w:" + j] = { h: h(lvl(0, j)) };
    walls["o:e:" + j] = { h: h(lvl(L.nColsAt(j) - 1, j)) };
    // перегородки между колонками — бортик по более высокой соседке
    for (let i = 0; i < L.nColsAt(j) - 1; i++)
      walls["v:" + i + ":" + j] = { h: h(Math.max(lvl(i, j), lvl(i + 1, j))) };
    // подступенки: бортик над полом верхней из смежных ступеней
    if (j < L.nRows - 1)
      for (let i = 0; i < L.nColsAt(j); i++) {
        const x = L.cx0(i, j) + L.cw(i, j) / 2;
        walls["h:" + j + ":" + i] = { h: h(Math.max(lvl(i, j), lvl(L.cellIndexAt(j + 1, x), j + 1))) };
      }
  }
  return walls;
}

// Слияние производных высот с ручными настройками стенок: высота — от
// лесенки, остальное (скругление, узор, наклон) — как настроил пользователь;
// ключи вне лесенки (например спинка o:s) сохраняются как есть
export function applyStairsWalls(c) {
  const derived = stairsWalls(c);
  const merged = {};
  for (const [k, w] of Object.entries(derived)) merged[k] = { ...(c.walls && c.walls[k]) || {}, h: w.h };
  for (const [k, w] of Object.entries(c.walls || {})) if (!merged[k]) merged[k] = w;
  return merged;
}

// Недостающие уровни (новая колонка появилась без записей cells) наследуют
// уровень своего ряда — лесенка не рвётся. Явно заданные уровни, включая
// ноль, не трогаются.
export function fillStairsLevels(c) {
  const L = layout(c);
  const cells = { ...(c.cells || {}) };
  for (let j = 0; j < L.nRows; j++) {
    let rowLvl = 0;
    for (let i = 0; i < L.nColsAt(j); i++) {
      const e = cells[i + ":" + j];
      if (e && e.lvl !== undefined) rowLvl = Math.max(rowLvl, e.lvl);
    }
    if (rowLvl <= 0) continue;
    for (let i = 0; i < L.nColsAt(j); i++) {
      const k = i + ":" + j;
      if (!cells[k] || cells[k].lvl === undefined) cells[k] = { ...(cells[k] || {}), lvl: rowLvl };
    }
  }
  return cells;
}

export const PRESETS = [
  ["low", "Низкий большой"],
  ["narrow", "Узкий с делениями"],
  ["grid6", "Органайзер 4–6"],
  ["booklet", "Буклетница"],
  ["stairs", "Горка"],
];

const r1 = (v) => Math.round(v * 10) / 10;

// c — текущий контейнер, kind — ключ пресета, limits — лимиты принтера,
// opts — параметры горки {steps, stepH, depth}. Возвращает НОВЫЙ объект
// контейнера с тем же id/местом/следом.
export function presetContainer(c, kind, limits, opts = {}) {
  const innerW = c.W - 2 * c.wallOut;
  const innerD = c.D - 2 * c.wallOut;
  const maxH = limits?.maxH ?? 500;
  const base = {
    ...c,
    cols: 1, rows: 1, gridMode: "count",
    walls: {}, cells: {}, rowColWs: null, rowDs: null,
    lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [],
    lockOuter: false, lockCell: false,
    preset: kind, // метка: настройки горки применяются вживую только к горке
  };

  // низкий большой: один отсек на весь след, невысокие борта
  if (kind === "low") return { ...base, H: Math.min(maxH, 14) };

  // узкий с делениями: один ряд длинных узких отсеков (под ручки, свёрла)
  if (kind === "narrow")
    return { ...base, H: Math.min(maxH, 30), cols: Math.max(3, Math.round(innerW / 28)) };

  // органайзер на 4–6 отсеков: 3×2, а на узком следе 2×2
  if (kind === "grid6")
    return { ...base, H: Math.min(maxH, 30), cols: innerW / 3 >= 40 ? 3 : 2, rows: 2 };

  // буклетница: три кармана каскадом — задняя стенка самая высокая,
  // каждый следующий карман ниже (видно все буклеты), полы наклонены
  // назад, чтобы буклеты опирались на стенку своего кармана
  if (kind === "booklet") {
    const H = Math.min(maxH, 110);
    const fr = r1(H * 0.35), st = (H - fr) / 3;
    return {
      ...base, H, rows: 3,
      // боковые стенки повторяют каскад карманов — силуэт лесенкой,
      // буклеты видно и сбоку
      walls: {
        "o:n:0": { h: fr },
        "h:0:0": { h: r1(fr + st) },
        "h:1:0": { h: r1(fr + 2 * st) },
        "o:w:0": { h: r1(fr + st) }, "o:e:0": { h: r1(fr + st) },
        "o:w:1": { h: r1(fr + 2 * st) }, "o:e:1": { h: r1(fr + 2 * st) },
      },
      cells: {
        "0:0": { tiltDir: "s", tiltA: 12 },
        "0:1": { tiltDir: "s", tiltA: 12 },
        "0:2": { tiltDir: "s", tiltA: 12 },
      },
    };
  }

  // горка: ступени поднимаются к задней стенке, задняя стенка — самая
  // высокая (равна высоте контейнера и следует за ней). Ступенька — ряд;
  // все ряды равной глубины, все колонки равной ширины. Бортики
  // производятся от уровней полов (stairsWalls) и следуют за правками.
  if (kind === "stairs") {
    const n = Math.max(2, Math.min(12, Math.round(opts.steps ?? GORKA_DEF.steps)));
    const nCols = Math.max(1, Math.min(8, Math.round(opts.cols ?? GORKA_DEF.cols)));
    const lip = Math.max(2, Math.min(120, opts.lip ?? GORKA_DEF.lip));
    // общий уровень пола: вся лесенка приподнята на эту высоту
    const lvl0 = Math.max(0, Math.min(200, opts.base ?? GORKA_DEF.base));
    // спинка должна возвышаться и над верхней ступенью, и над её бортиком
    const head = Math.max(20, lip + 2);
    // шаг уровня ужимается так, чтобы вся лесенка со спинкой влезла в
    // лимит принтера по высоте — слайдером её не задрать выше maxH
    const maxStep = Math.max(3, (maxH - c.floor - head - lvl0) / Math.max(1, n - 1));
    const stepH = Math.max(3, Math.min(60, opts.stepH ?? GORKA_DEF.stepH, maxStep));
    const H = Math.min(maxH, r1(lvl0 + (n - 1) * stepH + c.floor + Math.max(head, stepH)));
    const cells = {};
    for (let j = 0; j < n; j++)
      for (let i = 0; i < nCols; i++)
        if (lvl0 + j * stepH > 0) cells[i + ":" + j] = { lvl: r1(lvl0 + j * stepH) };
    const next = { ...base, H, rows: n, cols: nCols, cells, stairsLip: lip, stairsBase: lvl0 };
    next.walls = applyStairsWalls(next);
    return next;
  }

  return base;
}
