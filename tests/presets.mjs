// Пресеты контейнеров: след и место сохраняются, сетка/стенки/уровни
// перезаписываются; горка — ступени к задней стенке, задняя самая
// высокая, глубина ступеней управляется; всё строится без ошибок.
import { presetContainer, PRESETS, GORKA_DEF, stairsWalls, applyStairsWalls, fillStairsLevels } from "../src/model/presets.js";
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
  const opts = { steps: 4, stepH: 12 };
  const p = presetContainer(mk(), "stairs", limits, opts);
  const L = layout(p);
  ok("горка: ступенек столько, сколько задано", p.rows === 4 && L.nRows === 4);
  // уровни поднимаются к задней стенке с заданным шагом
  const lvls = [0, 1, 2, 3].map((j) => getCellLvl(p, 0, j));
  ok(`горка: уровни ${lvls.join(" → ")}`, lvls.every((v, j) => near(v, j * opts.stepH)));
  // все ступени равной глубины — без «остатка» последнему ряду
  ok(`горка: ступени равной глубины (${L.rowDs.map((d) => d.toFixed(1)).join("/")})`,
    L.rowDs.every((d) => near(d, L.rowDs[0])));
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

  // много ступеней тоже строится
  const pm = presetContainer(mk(), "stairs", limits, { steps: 8, stepH: 8 });
  ok("горка: 8 ступеней строятся", buildContainer(pm, noConn, {}).length > 100);
}

// ── горка с колонками ──
{
  const p = presetContainer(mk(), "stairs", limits, { steps: 3, stepH: 15, cols: 3 });
  const L = layout(p);
  ok("колонки: сетка 3 колонки × 3 ступени", p.cols === 3 && L.nColsAt(0) === 3);
  ok("колонки: уровни у всех колонок", [0, 1, 2].every((i) => getCellLvl(p, i, 1) === 15 && getCellLvl(p, i, 2) === 30));
  // перегородки между колонками — бортики, а не спинки
  const vHs = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) vHs.push(getWall(p, `v:${i}:${j}`).h);
  ok(`колонки: перегородки-бортики (${vHs.join(", ")})`, vHs.every((h, k) => h < p.H - 5 && near(h, Math.floor(k / 2) * 15 + p.floor + 6)));
  // передняя стенка — бортик у каждой колонки
  ok("колонки: передние сегменты — бортики", [0, 1, 2].every((i) => getWall(p, `o:n:${i}`).h < 12));
  ok("строится", buildContainer(p, noConn, {}).length > 100);
}

// ── живая горка: бортики следуют уровням, новые колонки наследуют ряд ──
{
  const p = presetContainer(mk(), "stairs", limits, { steps: 3, stepH: 15, cols: 2 });
  // пользователь поднял уровень одной ячейки — бортики вокруг неё выросли
  const edited = { ...p, cells: { ...p.cells, "1:1": { lvl: 40 } } };
  const w2 = applyStairsWalls(edited);
  ok("уровень ячейки тянет её бортики", near(w2["v:0:1"].h, 40 + p.floor + 6) && near(w2["o:e:1"].h, 40 + p.floor + 6));
  ok("чужие бортики не тронуты", near(w2["o:w:1"].h, 15 + p.floor + 6));
  // ручное скругление стенки переживает пересчёт
  const styled = { ...edited, walls: { ...edited.walls, "v:0:1": { ...edited.walls["v:0:1"], rnd: 2 } } };
  ok("настройки стенки сохраняются при пересчёте", applyStairsWalls(styled)["v:0:1"].rnd === 2);
  // спинку пересчёт не задаёт
  ok("спинка не переопределяется", stairsWalls(p)["o:s:0"] === undefined);

  // добавили колонку обычным редактором: уровней у неё нет — наследуются
  const grown = { ...p, cols: 3 };
  const filled = fillStairsLevels(grown);
  ok("новая колонка наследует уровень ряда", filled["2:1"]?.lvl === 15 && filled["2:2"]?.lvl === 30);
  // явный ноль уважается
  const zeroed = { ...grown, cells: { ...grown.cells, "2:1": { lvl: 0 } } };
  ok("явный ноль не перетирается", fillStairsLevels(zeroed)["2:1"].lvl === 0);
}

// ── бортик настраивается: глубокие ячейки при низком поле ──
{
  const p = presetContainer(mk(), "stairs", limits, { steps: 3, stepH: 10, cols: 2, lip: 40 });
  ok("бортик хранится на контейнере", p.stairsLip === 40);
  // передняя ячейка: пол на дне, стенки на 40 мм выше — глубокая
  ok(`глубокая передняя ячейка (перед ${getWall(p, "o:n:0").h})`, near(getWall(p, "o:n:0").h, p.floor + 40));
  ok("перегородка колонок тоже глубокая", near(getWall(p, "v:0:0").h, p.floor + 40));
  ok("подступенок выше пола второй ступени на бортик", near(getWall(p, "h:0:0").h, 10 + p.floor + 40));
  // спинка всё ещё выше всех бортиков
  const hs = ["o:n:0", "v:0:0", "h:0:0", "h:1:0", "o:w:2"].map((k) => getWall(p, k).h);
  ok(`спинка выше бортиков (H ${p.H})`, hs.every((h) => h <= p.H - 1));
  ok("строится", buildContainer(p, noConn, {}).length > 100);
  // живой пересчёт уважает бортик: опустили уровень — ячейка стала глубже
  const edited = { ...p, cells: { ...p.cells, "0:1": { lvl: 0 } } };
  const w2 = applyStairsWalls(edited);
  ok("низкий пол + бортик = глубокая ячейка при пересчёте", near(w2["o:w:1"].h, p.floor + 40));
}

// ── шаг уровня ограничен лимитом принтера по высоте ──
{
  const lim2 = { ...limits, maxH: 80 };
  const p = presetContainer(mk(), "stairs", lim2, { steps: 5, stepH: 60 });
  ok(`лесенка влезает в лимит (H ${p.H} ≤ 80)`, p.H <= 80);
  const topLvl = getCellLvl(p, 0, 4);
  ok(`верхняя ступень ниже спинки (${topLvl} ≤ ${p.H - 20})`, topLvl <= p.H - 19.9);
  ok("ступени остаются лесенкой", getCellLvl(p, 0, 1) < getCellLvl(p, 0, 2) && getCellLvl(p, 0, 2) < getCellLvl(p, 0, 3));
}

console.log(fail === 0 ? "\nPRESET TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
