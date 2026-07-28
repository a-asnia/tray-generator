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
  const pref = (arr) => { const p = [0]; for (const v of arr) p.push(p[p.length - 1] + v); return p; };
  const pw = pref(colWs), pd = pref(rowDs);
  const clampI = (arr, k) => arr[Math.max(0, Math.min(arr.length - 1, k))];
  return {
    innerW, innerD, colWs, rowDs,
    nCols: colWs.length, nRows: rowDs.length,
    cx0: (i) => -innerW / 2 + pw[Math.max(0, Math.min(colWs.length, i))] + i * c.wall,
    cz0: (j) => -innerD / 2 + pd[Math.max(0, Math.min(rowDs.length, j))] + j * c.wall,
    cw: (i) => clampI(colWs, i),
    cd: (j) => clampI(rowDs, j),
    cellW: colWs[0], cellD: rowDs[0],
  };
}

export const defWall = (c) => ({ h: c.H, t1: 0, t2: 0, rnd: 0, drop: "none", dropH: 3, face: "solid", hexSize: 8, lineStep: 14, seed: 1 });
export function getWall(c, key) {
  const w = c.walls[key];
  if (!w) return defWall(c);
  // высота может превышать H контейнера (башенка-ячейка); потолок — лимит принтера
  return { h: w.h ?? c.H, t1: w.t1 ?? 0, t2: w.t2 ?? 0, rnd: w.rnd ?? 0, drop: w.drop ?? "none", dropH: w.dropH ?? 3, face: w.face ?? "solid", hexSize: w.hexSize ?? 8, lineStep: w.lineStep ?? 14, seed: w.seed ?? 1 };
}

// уровень пола ячейки (лесенка), мм от дна контейнера
export const getCellLvl = (c, i, j) => (c.cells && c.cells[i + ":" + j] && c.cells[i + ":" + j].lvl) || 0;

// все сегменты одной линии (для выделения перегородки целиком)
export function lineOf(c, key) {
  const parts = key.split(":");
  const Lc = layout(c);
  if (parts[0] === "o") {
    const side = parts[1];
    const n = side === "n" || side === "s" ? Lc.nCols : Lc.nRows;
    const names = { n: "ближняя", s: "дальняя", w: "левая", e: "правая" };
    return {
      keys: Array.from({ length: n }, (_, k) => `o:${side}:${k}`),
      label: `Внешняя стенка целиком (${names[side]})`,
      outer: true,
    };
  }
  if (parts[0] === "v") {
    const i = +parts[1];
    return {
      keys: Array.from({ length: Lc.nRows }, (_, j) => `v:${i}:${j}`),
      label: `Перегородка целиком (после колонки ${i + 1})`,
      outer: false,
    };
  }
  const j = +parts[1];
  return {
    keys: Array.from({ length: Lc.nCols }, (_, i) => `h:${j}:${i}`),
    label: `Перегородка целиком (после ряда ${j + 1})`,
    outer: false,
  };
}

export function cellKeys(c, i, j) {
  const L = layout(c);
  return [
    { side: "Ближняя", key: j === 0 ? `o:n:${i}` : `h:${j - 1}:${i}`, slot: j === 0 ? "t1" : "t2" },
    { side: "Дальняя", key: j === L.nRows - 1 ? `o:s:${i}` : `h:${j}:${i}`, slot: "t1" },
    { side: "Левая", key: i === 0 ? `o:w:${j}` : `v:${i - 1}:${j}`, slot: i === 0 ? "t1" : "t2" },
    { side: "Правая", key: i === L.nCols - 1 ? `o:e:${j}` : `v:${i}:${j}`, slot: "t1" },
  ];
}

// подписи концов сегмента для спуска кромки (вдоль оси сегмента)
export const endLabels = (key) => {
  const p = key.split(":");
  const t = p[0] === "o" ? p[1] : p[0];
  // сегменты вдоль Z (верт. перегородки, стенки W/E): ближний/дальний край
  if (t === "v" || t === "w" || t === "e") return ["К ближнему краю", "К дальнему краю"];
  return ["Влево", "Вправо"]; // сегменты вдоль X
};

export const wallTitle = (key) => {
  const [t] = key.split(":");
  if (t === "o") return "Внешняя стенка";
  return t === "v" ? "Перегородка (между колонками)" : "Перегородка (между рядами)";
};
