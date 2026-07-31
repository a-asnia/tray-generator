// ══════════════════════════════════════════════════════════════
// Раскладка ячеек внутри контейнера и адресация стенок по ключам
// (o:сторона:индекс — внешние, v:i:j / h:j:i — перегородки)
// ══════════════════════════════════════════════════════════════

// заполнение оси ячейками целевого размера: последняя забирает остаток
// (от одного до двух целевых размеров), как в логике раскладки
export function fillAxis(inner, wall, target) {
  const t = Math.max(10, target);
  const cells = [];
  let remain = inner;
  while (remain >= 2 * t + wall && cells.length < 23) {
    cells.push(t);
    remain -= t + wall;
  }
  cells.push(Math.max(10, remain));
  return cells;
}

// Подгонка явных размеров колонок/рядов под внутренний габарит:
// зафиксированные замком не меняются, свободные масштабируются
// (минимум 5 мм); если зафиксированы все — масштабируются все,
// чтобы геометрия оставалась согласованной (UI до этого не доводит)
const MIN_FREE = 5;
export function fitSizes(sizes, locked, total) {
  const out = sizes.slice();
  const freeIdx = out.map((_, k) => k).filter((k) => !locked[k]);
  if (!freeIdx.length) {
    const sum = out.reduce((s, v) => s + v, 0) || 1;
    return Math.abs(sum - total) > 0.01 ? out.map((v) => (v * total) / sum) : out;
  }
  const lockedSum = out.reduce((s, v, k) => (locked[k] ? s + v : s), 0);
  const freeTarget = total - lockedSum;
  for (let pass = 0; pass < 2; pass++) {
    const freeSum = freeIdx.reduce((s, k) => s + out[k], 0) || 1;
    if (Math.abs(freeSum - freeTarget) < 0.01) break;
    const scale = freeTarget / freeSum;
    for (const k of freeIdx) out[k] = Math.max(MIN_FREE, out[k] * scale);
  }
  return out;
}

// замки ширины отдельных ячеек: ключ "i:j" (i — номер ячейки в ряду j)
export const lockedWIn = (c, j) => {
  const out = {};
  for (const k of Object.keys(c.lockedCellW || {})) {
    const [i, jj] = k.split(":");
    if (+jj === j) out[+i] = true;
  }
  return out;
};

// минимальный внешний габарит по оси с учётом замков. Ширина: у каждого
// ряда своя раскладка — берём самый требовательный ряд (зафиксированные
// ячейки + по 10 мм на свободные). Глубина: замки рядов.
export function minOuterDim(c, axis) {
  const L = layout(c);
  if (axis === "D") {
    const locked = c.lockedRows || {};
    let lockedSum = 0, freeN = 0;
    L.rowDs.forEach((s, k) => (locked[k] ? (lockedSum += s) : freeN++));
    let needD = Math.max(30, 2 * c.wallOut + (L.rowDs.length - 1) * c.wall + lockedSum + freeN * 10);
    for (const f of c.fixedCells || [])
      needD = Math.max(needD, 2 * c.wallOut + (f.d || 40) + 2 * c.wall + 5);
    return needD;
  }
  let need = 30;
  for (let j = 0; j < L.nRows; j++) {
    const locked = lockedWIn(c, j);
    const sizes = L.rowCols[j];
    let lockedSum = 0, freeN = 0;
    sizes.forEach((s, k) => (locked[k] ? (lockedSum += s) : freeN++));
    need = Math.max(need, 2 * c.wallOut + (sizes.length - 1) * c.wall + lockedSum + freeN * 10);
  }
  // фиксированные ячейки: контейнер не может стать уже их полостей
  for (const f of c.fixedCells || [])
    need = Math.max(need, 2 * c.wallOut + (f.w || 40) + 2 * c.wall + 5);
  return need;
}

export function layout(c) {
  const innerW = c.W - 2 * c.wallOut;
  const innerD = c.D - 2 * c.wallOut;
  let colWs, rowDs;
  if (c.gridMode === "size") {
    colWs = fillAxis(innerW, c.wall, c.cellWt || 40);
    rowDs = fillAxis(innerD, c.wall, c.cellDt || 40);
  } else {
    colWs = Array.from({ length: c.cols }, () => (innerW - (c.cols - 1) * c.wall) / c.cols);
    rowDs = Array.from({ length: c.rows }, () => (innerD - (c.rows - 1) * c.wall) / c.rows);
  }
  // явные размеры рядов (появляются при замке ряда) фиксируют сетку рядов
  if (c.rowDs && c.rowDs.length) rowDs = fitSizes(c.rowDs, c.lockedRows || {}, innerD - (c.rowDs.length - 1) * c.wall);
  const nRows = rowDs.length;
  // «кирпичная» раскладка: у каждого ряда СВОИ ширины ячеек — вертикальные
  // перегородки разных рядов не обязаны совпадать. rowColWs[j] — явные
  // ширины ряда j (появляются при замке или ручном размере ячейки);
  // без них ряд делится равномерно по colWs
  const rowCols = [];
  for (let j = 0; j < nRows; j++) {
    const explicit = c.rowColWs && c.rowColWs[j] && c.rowColWs[j].length ? c.rowColWs[j] : colWs;
    const lockedJ = {};
    for (const k of Object.keys(c.lockedCellW || {})) {
      const [ii, jj] = k.split(":");
      if (+jj === j) lockedJ[+ii] = true;
    }
    rowCols.push(fitSizes(explicit, lockedJ, innerW - (explicit.length - 1) * c.wall));
  }
  // Фиксированные ячейки — «контейнер внутри контейнера»: жёсткий размер
  // (полость w×d) и якорь к углу или стенке, без точных координат; бокс
  // скользит вместе со стенками при изменении габаритов. Стороны, не
  // прижатые к внешней стенке, получают собственную перегородку (wall).
  const fixed = (c.fixedCells || []).map((f, k) => {
    const w = Math.min(f.w || 40, innerW - 1), d = Math.min(f.d || 40, innerD - 1);
    const a = f.anchor || "nw";
    const sameWall = (c.fixedCells || []).filter((g) => (g.anchor || "nw") === a);
    const slot = sameWall.indexOf(f), m = sameWall.length;
    let x0, z0;
    // углы: прижат к двум стенкам, последующие с тем же якорем — вдоль стенки
    if (a === "nw") { x0 = -innerW / 2 + slot * (w + c.wall); z0 = -innerD / 2; }
    else if (a === "ne") { x0 = innerW / 2 - w - slot * (w + c.wall); z0 = -innerD / 2; }
    else if (a === "sw") { x0 = -innerW / 2 + slot * (w + c.wall); z0 = innerD / 2 - d; }
    else if (a === "se") { x0 = innerW / 2 - w - slot * (w + c.wall); z0 = innerD / 2 - d; }
    // стенки: прижат к стенке, вдоль неё распределение поровну
    else if (a === "n") { x0 = -innerW / 2 + (innerW * (slot + 1)) / (m + 1) - w / 2; z0 = -innerD / 2; }
    else if (a === "s") { x0 = -innerW / 2 + (innerW * (slot + 1)) / (m + 1) - w / 2; z0 = innerD / 2 - d; }
    else if (a === "w") { x0 = -innerW / 2; z0 = -innerD / 2 + (innerD * (slot + 1)) / (m + 1) - d / 2; }
    else { x0 = innerW / 2 - w; z0 = -innerD / 2 + (innerD * (slot + 1)) / (m + 1) - d / 2; }
    x0 = Math.max(-innerW / 2, Math.min(x0, innerW / 2 - w));
    z0 = Math.max(-innerD / 2, Math.min(z0, innerD / 2 - d));
    const own = {
      n: z0 > -innerD / 2 + 0.01, s: z0 + d < innerD / 2 - 0.01,
      w: x0 > -innerW / 2 + 0.01, e: x0 + w < innerW / 2 - 0.01,
    };
    return {
      k, anchor: a, x0, z0, x1: x0 + w, z1: z0 + d, own,
      // footprint: полость + собственные стенки — зона, которую обтекает сетка
      fx0: x0 - (own.w ? c.wall : 0), fz0: z0 - (own.n ? c.wall : 0),
      fx1: x0 + w + (own.e ? c.wall : 0), fz1: z0 + d + (own.s ? c.wall : 0),
    };
  });

  const pref = (arr) => { const p = [0]; for (const v of arr) p.push(p[p.length - 1] + v); return p; };
  const pd = pref(rowDs);
  const pws = rowCols.map(pref);
  const clampI = (arr, k) => arr[Math.max(0, Math.min(arr.length - 1, k))];
  const clampJ = (j) => Math.max(0, Math.min(nRows - 1, j));
  const cx0 = (i, j = 0) => {
    const jj = clampJ(j);
    return -innerW / 2 + pws[jj][Math.max(0, Math.min(rowCols[jj].length, i))] + i * c.wall;
  };
  const cw = (i, j = 0) => clampI(rowCols[clampJ(j)], i);
  return {
    innerW, innerD, rowDs, rowCols, fixed,
    colWs: rowCols[0], // совместимость: колонки первого ряда
    nCols: rowCols[0].length, nRows,
    nColsAt: (j) => rowCols[clampJ(j)].length,
    cx0,
    cz0: (j) => -innerD / 2 + pd[Math.max(0, Math.min(nRows, j))] + j * c.wall,
    cw,
    cd: (j) => clampI(rowDs, j),
    // ячейка ряда j, накрывающая координату x (для стыковки рядов)
    cellIndexAt: (j, x) => {
      const jj = clampJ(j);
      let best = 0;
      for (let i = 0; i < rowCols[jj].length; i++) {
        if (x >= cx0(i, jj) - c.wall) best = i;
      }
      return best;
    },
    cellW: rowCols[0][0], cellD: rowDs[0],
  };
}

// острые верхние кромки скругляются по умолчанию (радиус в мм);
// у стенок с замком скругляется только внутренняя сторона — наружная
// плоскость остаётся ровной для стыковки и пазов
export const DEFAULT_RND = 0.8;
// Скругление наружных вертикальных углов по плану. Должно быть заметно
// больше скругления кромки: иначе у самой кромки радиус угла обнуляется
// и угол вырождается в остриё.
export const DEFAULT_CORNER_R = 2;
export const defWall = (c) => ({ h: c.H, t1: 0, t2: 0, rnd: DEFAULT_RND, drop: "none", dropH: 3, face: "solid", hexSize: 8, lineStep: 14, seed: 1 });
export function getWall(c, key) {
  const w = c.walls[key];
  if (!w) return defWall(c);
  // высота может превышать H контейнера (башенка-ячейка); потолок — лимит принтера
  return { h: w.h ?? c.H, t1: w.t1 ?? 0, t2: w.t2 ?? 0, rnd: w.rnd ?? DEFAULT_RND, drop: w.drop ?? "none", dropH: w.dropH ?? 3, face: w.face ?? "solid", hexSize: w.hexSize ?? 8, lineStep: w.lineStep ?? 14, seed: w.seed ?? 1 };
}

// уровень пола ячейки (лесенка), мм от дна контейнера
export const getCellLvl = (c, i, j) => (c.cells && c.cells[i + ":" + j] && c.cells[i + ":" + j].lvl) || 0;

// все сегменты одной линии (для выделения перегородки целиком)
export function lineOf(c, key) {
  const parts = key.split(":");
  const Lc = layout(c);
  if (parts[0] === "o") {
    const side = parts[1];
    // сегменты N/S идут по ячейкам крайнего ряда (ближнего или дальнего)
    const n = side === "n" ? Lc.nColsAt(0) : side === "s" ? Lc.nColsAt(Lc.nRows - 1) : Lc.nRows;
    const names = { n: "ближняя", s: "дальняя", w: "левая", e: "правая" };
    return {
      keys: Array.from({ length: n }, (_, k) => `o:${side}:${k}`),
      label: `Внешняя стенка целиком (${names[side]})`,
      outer: true,
    };
  }
  if (parts[0] === "v") {
    // Перегородки разных рядов не обязаны совпадать по индексу, поэтому
    // «линия» собирается по ФАКТИЧЕСКОЙ координате: берутся сегменты,
    // лежащие на одной прямой с выбранным (перекрывающиеся по толщине).
    const i = +parts[1], j = +parts[2];
    const xAt = (ii, jj) => Lc.cx0(ii, jj) + Lc.cw(ii, jj) + c.wall / 2;
    const xRef = xAt(i, j);
    const tol = Math.max(0.5, c.wall * 0.5);
    const keys = [];
    for (let jj = 0; jj < Lc.nRows; jj++)
      for (let ii = 0; ii < Lc.nColsAt(jj) - 1; ii++)
        if (Math.abs(xAt(ii, jj) - xRef) < tol) keys.push(`v:${ii}:${jj}`);
    return {
      keys: keys.length ? keys : [key],
      label: `Перегородка целиком (${keys.length} сегм. на одной линии)`,
      outer: false,
    };
  }
  if (parts[0] === "h") {
    // сегменты горизонтальной перегородки ряда j уже лежат на одной линии
    const j = +parts[1];
    return {
      keys: Array.from({ length: Lc.nColsAt(j) }, (_, i) => `h:${j}:${i}`),
      label: `Перегородка целиком (после ряда ${j + 1})`,
      outer: false,
    };
  }
  // стенки фиксированных боксов (fw:k:сторона) линий не образуют
  return { keys: [key], label: "Стенка фиксированной ячейки", outer: false };
}

export function cellKeys(c, i, j) {
  const L = layout(c);
  // сегменты горизонтальной перегородки h:j идут по ячейкам ряда j;
  // для «ближней» стенки ячейки берём сегмент ряда выше, накрывающий её центр
  const xc = L.cx0(i, j) + L.cw(i, j) / 2;
  const nearKey = j === 0 ? `o:n:${i}` : `h:${j - 1}:${L.cellIndexAt(j - 1, xc)}`;
  return [
    { side: "Ближняя", key: nearKey, slot: j === 0 ? "t1" : "t2" },
    { side: "Дальняя", key: j === L.nRows - 1 ? `o:s:${i}` : `h:${j}:${i}`, slot: "t1" },
    { side: "Левая", key: i === 0 ? `o:w:${j}` : `v:${i - 1}:${j}`, slot: i === 0 ? "t1" : "t2" },
    { side: "Правая", key: i === L.nColsAt(j) - 1 ? `o:e:${j}` : `v:${i}:${j}`, slot: "t1" },
  ];
}

// подписи концов сегмента для спуска кромки (вдоль оси сегмента)
export const endLabels = (key) => {
  const p = key.split(":");
  const t = p[0] === "o" ? p[1] : p[0] === "fw" ? p[2] : p[0];
  // сегменты вдоль Z (верт. перегородки, стенки W/E): ближний/дальний край
  if (t === "v" || t === "w" || t === "e") return ["К ближнему краю", "К дальнему краю"];
  return ["Влево", "Вправо"]; // сегменты вдоль X
};

export const wallTitle = (key) => {
  const [t] = key.split(":");
  if (t === "o") return "Внешняя стенка";
  if (t === "fw") return "Стенка фиксированной ячейки";
  return t === "v" ? "Перегородка (между колонками)" : "Перегородка (между рядами)";
};
