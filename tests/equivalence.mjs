// Сравнение оригинального ядра (reference.mjs, вырезан из tray-generator-v31.jsx)
// с модульной версией: buildContainer должен давать бит-в-бит те же solids.
import * as ref from "./reference-v31.mjs";
import { buildContainer } from "../src/model/build.js";
import { layout, getWall, getCellLvl, lineOf, fillAxis } from "../src/model/layout.js";
import { CONN, connGeom, connectorVs, splitRange } from "../src/model/connectors.js";
import { wallProfile } from "../src/geometry/solids.js";
import { solidsVolume } from "../src/geometry/stl.js";

const base = {
  id: 1, gx: 0, gy: 0,
  W: 170, D: 170, H: 30,
  cols: 1, rows: 1,
  gridMode: "count", cellWt: 40, cellDt: 40,
  wall: 1.6, wallOut: CONN.minWall, floor: 1.6,
  walls: {}, cells: {},
  lockOuter: false, lockCell: false, cellW0: 0, cellD0: 0,
};

const noConn = { N: null, S: null, W: null, E: null };

const cases = [
  ["default 1x1", { ...base }, noConn],
  ["grid 3x2", { ...base, cols: 3, rows: 2 }, noConn],
  ["grid by size", { ...base, gridMode: "size", cellWt: 38, cellDt: 52 }, noConn],
  ["hex walls", {
    ...base, cols: 2, rows: 2, H: 40,
    walls: { "v:0:0": { face: "hex", hexSize: 9 }, "o:n:0": { face: "hex" }, "o:e:1": { face: "hex", hexSize: 6, rnd: 1.5 } },
  }, noConn],
  ["lines walls", {
    ...base, cols: 2, rows: 2, H: 45,
    walls: { "h:0:0": { face: "lines", lineStep: 10, seed: 7 }, "o:w:0": { face: "lines", seed: 42 }, "o:s:1": { face: "lines", lineStep: 25 } },
  }, noConn],
  ["drops+round+tilt", {
    ...base, cols: 2, rows: 1, H: 35,
    walls: {
      "v:0:0": { drop: "a", dropH: 5, rnd: 0.8, t1: 20, t2: 35 },
      "o:n:0": { drop: "b", dropH: 8, rnd: 2 },
      "o:e:0": { t1: 30, rnd: 3 },
      "h:0:0": { h: 0 },
    },
  }, noConn],
  ["ladder floors + tilted floors + tower", {
    ...base, cols: 3, rows: 3, H: 50,
    cells: {
      "0:0": { lvl: 12 }, "1:1": { lvl: 6, tiltDir: "e", tiltA: 10 },
      "2:2": { tiltDir: "n", tiltA: 25 }, "0:2": { lvl: 20, tiltDir: "s", tiltA: 5 },
      "1:0": { tiltDir: "w", tiltA: 8 },
    },
    walls: { "v:1:0": { h: 80 }, "h:1:1": { h: 0 } },
  }, noConn],
  ["connectors all sides", { ...base, W: 120, D: 100 }, {
    E: { male: true, vs: connectorVs(100) },
    W: { male: false, vs: connectorVs(100) },
    S: { male: true, vs: connectorVs(120) },
    N: { male: false, vs: connectorVs(120) },
  }],
  ["connectors big + hex + ramps", {
    ...base, W: 170, D: 170, cols: 2, rows: 2, H: 40, wallOut: 4, wall: 2.4,
    walls: { "o:n:0": { face: "hex", t1: 15 }, "v:0:1": { face: "lines", t1: 12, t2: 18, seed: 3 } },
    cells: { "0:0": { lvl: 8 } },
  }, {
    E: { male: true, vs: connectorVs(170) },
    N: { male: false, vs: connectorVs(170) },
    S: null, W: null,
  }],
  ["hex ramp + lines ramp", {
    ...base, cols: 2, rows: 1, H: 60, W: 160, D: 160,
    walls: {
      "o:w:0": { face: "hex", t1: 40, hexSize: 7 },
      "v:0:0": { face: "lines", t1: 45, t2: 45, lineStep: 8, seed: 11 },
      "o:s:0": { face: "hex", t1: 35, drop: "a", dropH: 20 },
    },
  }, noConn],
  ["thin outer no-connect", { ...base, wallOut: 0.8, wall: 0.8, floor: 0.8, H: 12 }, noConn],
];

// Скругление верхних кромок стало включённым по умолчанию (0.8 мм).
// Для сверки ядра с эталоном явно проставляем rnd: 0 всем стенкам,
// которые участвуют в конфигурации.
const sharp = (c) => {
  const L = layout(c);
  const walls = { ...(c.walls || {}) };
  const keys = [];
  for (let i = 0; i < L.nColsAt(0); i++) keys.push(`o:n:${i}`);
  for (let i = 0; i < L.nColsAt(L.nRows - 1); i++) keys.push(`o:s:${i}`);
  for (let j = 0; j < L.nRows; j++) keys.push(`o:w:${j}`, `o:e:${j}`);
  for (let j = 0; j < L.nRows; j++) {
    for (let i = 0; i < L.nColsAt(j) - 1; i++) keys.push(`v:${i}:${j}`);
    if (j < L.nRows - 1) for (let i = 0; i < L.nColsAt(j); i++) keys.push(`h:${j}:${i}`);
  }
  for (const k of keys) walls[k] = { ...(walls[k] || {}), rnd: 0 }; // сверяем ядро с острыми кромками
  return { ...c, walls };
};

let fail = 0;
// узоры (соты/линии) изменены намеренно: рамка вокруг узора теперь
// в две толщины стенки — такие кейсы сверяем не побайтово, а на
// валидность (геометрия строится, объём сопоставим)
const patterned = (c) => JSON.stringify(c.walls || {}).match(/"face":"(hex|lines)"/);
// соединители: рельс теперь заканчивается на 2 мм ниже верхней кромки
for (const [name, c, conn] of cases) {
  // зазор соединителя вынесен в настройку; для сверки берём прежний 0.25
  const cc = sharp({ ...c, connClr: 0.25 });
  const a = ref.buildContainer(cc, conn);
  const b = buildContainer(cc, conn, { fillets: false }); // галтели — новое поведение, сверяем ядро без них
  const hasConn = Object.values(conn).some(Boolean);
  if (patterned(c) || hasConn) {
    const va = ref.solidsVolume(a), vb = solidsVolume(b);
    const okp = b.length > 0 && vb > 0 && Math.abs(va - vb) / va < 0.25;
    console.log(`${okp ? "OK " : "FAIL"} ${name}: намеренно изменено — тел ${a.length}/${b.length}, vol ${va.toFixed(1)}/${vb.toFixed(1)}`);
    if (!okp) fail++;
    continue;
  }
  // раскладка стала пер-рядной: порядок эмиссии тел изменился, геометрия
  // должна совпадать как МНОЖЕСТВО тел — сравниваем отсортированно
  // координаты округляем: изменился порядок арифметики, различия ~1e-14 мм
  const canon = (s) => s
    .map((x) => JSON.stringify(x, (k, v) => (typeof v === "number" ? +v.toFixed(6) : v)))
    .sort().join("|");
  const sa = canon(a), sb = canon(b);
  const va = ref.solidsVolume(a), vb = solidsVolume(b);
  // объём — сумма по телам; порядок слагаемых изменился, поэтому допуск
  const ok = sa === sb && Math.abs(va - vb) < 1e-6;
  console.log(`${ok ? "OK " : "FAIL"} ${name}: solids ${a.length}/${b.length}, tris ${a.reduce((s, x) => s + x.tris.length, 0)}/${b.reduce((s, x) => s + x.tris.length, 0)}, vol ${va.toFixed(3)}/${vb.toFixed(3)}`);
  if (!ok) fail++;
}

// вспомогательные функции
const cfg = { ...base, cols: 3, rows: 2, gridMode: "count" };
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const aux = [
  ["layout", (() => {
    // решатель считает те же размеры другой арифметикой — сравнение с
    // допуском на последний знак float
    const pick = (L) => [L.innerW, L.innerD, ...L.colWs, ...L.rowDs, L.nCols, L.nRows, L.cellW, L.cellD];
    const close = (A, B) => A.length === B.length && A.every((v, i) => Math.abs(v - B[i]) < 1e-9);
    return close(pick(ref.layout(cfg)), pick(layout(cfg))) &&
      close(pick(ref.layout({ ...cfg, gridMode: "size" })), pick(layout({ ...cfg, gridMode: "size" })));
  })()],
  // дефолт скругления изменён намеренно (0 → 0.8), остальные поля те же
  ["getWall (кроме нового дефолта rnd)", (() => {
    const drop = (w) => { const { rnd, ...rest } = w; return rest; };
    const cfg2 = { ...cfg, walls: { "v:0:0": { h: 5, face: "hex" } } };
    return eq(drop(ref.getWall(cfg, "v:0:0")), drop(getWall(cfg, "v:0:0"))) &&
      eq(drop(ref.getWall(cfg2, "v:0:0")), drop(getWall(cfg2, "v:0:0"))) &&
      getWall(cfg, "v:0:0").rnd === 0.8;
  })()],
  ["getCellLvl", ref.getCellLvl({ ...cfg, cells: { "1:1": { lvl: 7 } } }, 1, 1) === getCellLvl({ ...cfg, cells: { "1:1": { lvl: 7 } } }, 1, 1)],
  ["lineOf", ["o:n:0", "o:e:1", "v:1:0", "h:0:2"].every((k) => {
    const A = ref.lineOf(cfg, k), B = lineOf(cfg, k); // подписи изменились намеренно — сравниваем состав
    return eq(A.keys, B.keys) && A.outer === B.outer;
  })],
  ["wallProfile", eq(ref.wallProfile(1.6, 30, 0.8, true), wallProfile(1.6, 30, 0.8, true)) && eq(ref.wallProfile(2.8, 30, 2, false), wallProfile(2.8, 30, 2, false))],
  ["splitRange", eq(ref.splitRange(-50, 50, [[-10, 10]]), splitRange(-50, 50, [[-10, 10]]))],
  ["fillAxis", eq(ref.fillAxis(160, 1.6, 40), fillAxis(160, 1.6, 40))],
  ["connectorVs", eq(ref.connectorVs(80), connectorVs(80)) && eq(ref.connectorVs(120), connectorVs(120))],
  // зазор стал настройкой: при прежнем 0.25 все производные размеры совпадают
  ["CONN при зазоре 0.25", (() => {
    const g = connGeom(0.25);
    return Object.keys(ref.CONN).every((k) => Math.abs(ref.CONN[k] - g[k]) < 1e-9);
  })()],
];
for (const [n, ok] of aux) { console.log(`${ok ? "OK " : "FAIL"} aux ${n}`); if (!ok) fail++; }

console.log(fail === 0 ? "\nALL EQUIVALENT" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
