// Пресеты контейнеров: след и место сохраняются, сетка/стенки/уровни
// перезаписываются; горка — ступени к задней стенке, задняя самая
// высокая, глубина ступеней управляется; всё строится без ошибок.
import { presetContainer, PRESETS, GORKA_DEF } from "../src/model/presets.js";
import { buildContainer } from "../src/model/build.js";
import { layout, getWall, getCellLvl } from "../src/model/layout.js";

const limits = { maxW: 170, maxD: 170, maxH: 175 };
const mk = (o = {}) => ({
  id: 7, gx: 2, gy: 3,
  W: 170, D: 170, H: 30, cols: 3, rows: 2, gridMode: "count",
  wall: 1.6, wallOut: 2.9, floor: 1.6,
  walls: { "o:n:0": { h: 5 } }, cells: { "0:0": { lvl: 9 } },
  rowColWs: null, rowDs: null,
  lockedCellW: { "0:0": true }, lockedRows: { 0: true }, cellShares: { "1:0": 2 },
  fixedCells: [{ w: 40, d: 40, anchor: "nw", lvl: 0 }],
  lockOuter: true, ...o,
});
const noConn = { N: null, S: null, W: null, E: null };
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;

// ── общие свойства всех пресетов ──
for (const [kind, title] of PRESETS) {
  const c = mk();
  const p = presetContainer(c, kind, limits, GORKA_DEF);
  ok(`${title}: след и место сохранены`,
    p.W === c.W && p.D === c.D && p.gx === c.gx && p.gy === c.gy && p.id === c.id &&
    p.wall === c.wall && p.wallOut === c.wallOut && p.floor === c.floor);
  ok(`${title}: фиксации и боксы сброшены`,
    Object.keys(p.lockedCellW).length === 0 && p.fixedCells.length === 0 &&
    Object.keys(p.cellShares).length === 0 && !p.lockOuter);
  ok(`${title}: высота в лимите`, p.H <= limits.maxH);
  const s = buildContainer(p, noConn, {});
  const nan = s.some((b) => b.tris.some((t) => t.some((q) => q.some((v) => !Number.isFinite(v)))));
  ok(`${title}: строится (${s.length} тел)`, s.length > 50 && !nan);
}

// ── частные свойства ──
{
  const p = presetContainer(mk(), "low", limits);
  ok("низкий: один отсек и низкие борта", p.cols === 1 && p.rows === 1 && p.H <= 15);
}
{
  const p = presetContainer(mk(), "narrow", limits);
  const L = layout(p);
  ok(`узкий: много узких отсеков (${L.nCols} × ${L.colWs[0].toFixed(1)} мм)`,
    L.nCols >= 4 && L.colWs[0] < 30 && p.rows === 1);
}
{
  const p = presetContainer(mk(), "grid6", limits);
  ok("органайзер: 6 отсеков на широком следе", p.cols * p.rows === 6);
  const pn = presetContainer(mk({ W: 100 }), "grid6", limits);
  ok("органайзер: 4 отсека на узком следе", pn.cols * pn.rows === 4);
}
{
  const p = presetContainer(mk(), "booklet", limits);
  const hs = [getWall(p, "o:n:0").h, getWall(p, "h:0:0").h, getWall(p, "h:1:0").h, getWall(p, "o:s:0").h];
  ok(`буклетница: каскад высот к задней (${hs.map((h) => h.toFixed(0)).join(" < ")})`,
    hs[0] < hs[1] && hs[1] < hs[2] && hs[2] < hs[3] && near(hs[3], p.H));
  ok("буклетница: полы наклонены назад", ["0:0", "0:1", "0:2"].every((k) => p.cells[k]?.tiltDir === "s"));
}

// ── горка ──
{
  const opts = { steps: 4, stepH: 12, depth: 30 };
  const p = presetContainer(mk(), "stairs", limits, opts);
  const L = layout(p);
  ok("горка: ступенек столько, сколько задано", p.rows === 4 && L.nRows === 4);
  // уровни поднимаются к задней стенке с заданным шагом
  const lvls = [0, 1, 2, 3].map((j) => getCellLvl(p, 0, j));
  ok(`горка: уровни ${lvls.join(" → ")}`, lvls.every((v, j) => near(v, j * opts.stepH)));
  // передние ряды держат заданную глубину, задний забирает остаток
  ok(`горка: глубина передних ступеней ${L.rowDs[0].toFixed(1)}`,
    [0, 1, 2].every((j) => near(L.rowDs[j], opts.depth)) && L.rowDs[3] > opts.depth);
  const sumD = L.rowDs.reduce((a, b) => a + b, 0) + (p.rows - 1) * p.wall;
  ok("горка: ступени занимают весь след по глубине", near(sumD, p.D - 2 * p.wallOut, 0.2));
  // задняя стенка самая высокая и равна высоте контейнера
  const hBack = getWall(p, "o:s:0").h;
  const others = [getWall(p, "o:n:0").h, getWall(p, "h:0:0").h, getWall(p, "h:1:0").h, getWall(p, "h:2:0").h,
    getWall(p, "o:w:0").h, getWall(p, "o:w:3").h];
  ok(`горка: задняя стенка самая высокая (${hBack} = H ${p.H})`,
    near(hBack, p.H) && others.every((h) => h < hBack - 1));
  // боковые стенки повторяют лесенку
  const sides = [0, 1, 2, 3].map((j) => getWall(p, "o:w:" + j).h);
  ok(`горка: боковые ступеньками (${sides.join(" → ")})`, sides.every((v, j) => j === 0 || v > sides[j - 1]));
  // перегородка-подступенок выше пола следующей ступени (бортик)
  ok("горка: подступенки с бортиком", [0, 1, 2].every((j) =>
    getWall(p, "h:" + j + ":0").h > lvls[j + 1] + p.floor + 1));

  // слишком глубокие ступени ужимаются, задний ряд не исчезает
  const pd = presetContainer(mk(), "stairs", limits, { steps: 4, stepH: 12, depth: 500 });
  const Ld = layout(pd);
  ok("горка: чрезмерная глубина ступени ужимается", Ld.rowDs.every((d) => d >= 9.9));
  // много ступеней тоже строится
  const pm = presetContainer(mk(), "stairs", limits, { steps: 8, stepH: 8, depth: 18 });
  ok("горка: 8 ступеней строятся", buildContainer(pm, noConn, {}).length > 100);
}

console.log(fail === 0 ? "\nPRESET TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
