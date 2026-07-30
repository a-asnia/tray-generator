// Набор конфигураций, покрывающих все ветки построения геометрии.
// Используется для отпечатка (tests/fingerprint.mjs): любое изменение
// координат хотя бы в одной конфигурации ломает тест.
export const base = {
  W: 120, D: 100, H: 30, cols: 2, rows: 2, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 3, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, fixedCells: [],
};
export const noConn = { N: null, S: null, W: null, E: null };

const wallsAll = (patch) =>
  Object.fromEntries(
    ["o:n:0", "o:n:1", "o:s:0", "o:s:1", "o:w:0", "o:w:1", "o:e:0", "o:e:1", "v:0:0", "v:0:1", "h:0:0", "h:0:1"]
      .map((k) => [k, { h: 30, ...patch }])
  );

export const cases = {
  "пусто 1×1": [{ ...base, cols: 1, rows: 1 }, noConn],
  "сетка 2×2": [base, noConn],
  "сетка 4×3": [{ ...base, W: 170, D: 170, cols: 4, rows: 3 }, noConn],
  "соты везде": [{ ...base, walls: wallsAll({ face: "hex", hexSize: 8 }) }, noConn],
  "линии везде": [{ ...base, walls: wallsAll({ face: "lines", lineStep: 14, seed: 3 }) }, noConn],
  "соты крупные": [{ ...base, H: 45, walls: wallsAll({ face: "hex", hexSize: 14 }) }, noConn],
  "узкое окно узора": [{ ...base, H: 12, walls: wallsAll({ face: "hex", hexSize: 10 }) }, noConn],
  "пандусы": [{ ...base, walls: wallsAll({ t1: 20, t2: 12 }) }, noConn],
  "соты + пандусы": [{ ...base, walls: wallsAll({ face: "hex", t1: 18 }) }, noConn],
  "линии + пандусы": [{ ...base, walls: wallsAll({ face: "lines", t1: 18, seed: 7 }) }, noConn],
  "спуск кромки": [{ ...base, walls: wallsAll({ drop: "a", dropH: 8 }) }, noConn],
  "спуск + соты": [{ ...base, walls: wallsAll({ drop: "b", dropH: 10, face: "hex" }) }, noConn],
  "без скругления": [{ ...base, walls: wallsAll({ rnd: 0 }) }, noConn],
  "скругление 1.5": [{ ...base, walls: wallsAll({ rnd: 1.5 }) }, noConn],
  "лесенка полов": [{ ...base, cells: { "0:0": { lvl: 6 }, "1:1": { lvl: 12 } } }, noConn],
  "наклонные полы": [{ ...base, cells: { "0:0": { tiltDir: "e", tiltA: 7 }, "1:0": { tiltDir: "n", tiltA: 5 } } }, noConn],
  "кирпичная раскладка": [{ ...base, rowColWs: { 0: [70, 43.8], 1: [40, 73.8] } }, noConn],
  "бокс в углу": [{ ...base, fixedCells: [{ w: 40, d: 30, anchor: "nw", lvl: 0 }] }, noConn],
  "бокс у стенки + пол": [{ ...base, fixedCells: [{ w: 35, d: 30, anchor: "e", lvl: 5 }] }, noConn],
  "два бокса": [{ ...base, W: 170, D: 170, cols: 3, rows: 3, fixedCells: [{ w: 40, d: 30, anchor: "nw" }, { w: 30, d: 40, anchor: "se" }] }, noConn],
  "замки все стороны": [
    base,
    { N: { male: false, vs: [-30, 30] }, S: { male: true, vs: [-30, 30] }, W: { male: false, vs: [-25, 25] }, E: { male: true, vs: [-25, 25] } },
  ],
  "замки + зазор 0.4": [
    { ...base, connClr: 0.4 },
    { N: { male: false, vs: [-30, 30] }, E: { male: true, vs: [-25, 25] }, S: null, W: null },
  ],
  "замки + соты": [
    { ...base, walls: wallsAll({ face: "hex" }) },
    { N: { male: false, vs: [-30, 30] }, S: { male: true, vs: [-30, 30] }, W: null, E: null },
  ],
  "один замок один нет": [
    base,
    { N: { male: false, vs: [-30, 30] }, S: null, W: null, E: { male: true, vs: [-25, 25] } },
  ],
  "тонкие стенки": [{ ...base, wall: 0.8, wallOut: 1.2, floor: 0.8 }, noConn],
  "толстые стенки": [{ ...base, wall: 4, wallOut: 6, floor: 4 }, noConn],
};
