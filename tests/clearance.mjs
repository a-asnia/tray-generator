// Зазор соединителя — настройка: влияет на паз/рельс и на минимальную
// внешнюю стенку. Рамка узоров — две толщины стенки.
import { buildContainer } from "../src/model/build.js";
import { connGeom, connectorVs, DEFAULT_CLR } from "../src/model/connectors.js";

let fail = 0;
const ok = (n, c) => { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; };
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;

// ── производные размеры от зазора
const g1 = connGeom(0.1), g2 = connGeom(0.2), g4 = connGeom(0.4);
ok(`по умолчанию 0,35 мм (по итогам печатных тестов)`, DEFAULT_CLR === 0.35);
ok(`глубина паза растёт с зазором (${g1.dg} < ${g2.dg} < ${g4.dg})`, g1.dg < g2.dg && g2.dg < g4.dg);
ok(`минимальная стенка: 0,1 → ${g1.minWall}, 0,2 → ${g2.minWall}, 0,4 → ${g4.minWall}`,
  near(g1.minWall, 2.65) && near(g2.minWall, 2.75) && near(g4.minWall, 2.95));
ok(`зона соединителя шире при большем зазоре (${g1.bossW} < ${g4.bossW})`, g1.bossW < g4.bossW);

// ── геометрия: рельс (male) тоньше паза (female) ровно на зазор
const base = {
  W: 120, D: 100, H: 30, cols: 1, rows: 1, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 3, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null, lockedCellW: {}, lockedRows: {}, fixedCells: [],
};
const connW = { N: null, S: null, E: { male: true, vs: connectorVs(100) }, W: { male: false, vs: connectorVs(100) } };
const zSpan = (clr) => {
  const s = buildContainer({ ...base, connClr: clr }, connW, { fillets: false }).filter((x) => x.tag === "conn");
  // ширина паза по Z у наружной плоскости западной стенки
  let zmin = 1e9, zmax = -1e9;
  for (const b of s) for (const t of b.tris) for (const p of t)
    if (p[0] < -base.W / 2 + 0.6) { zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]); }
  return +(zmax - zmin).toFixed(2);
};
const s01 = zSpan(0.1), s04 = zSpan(0.4);
ok(`паз шире при большем зазоре (${s01} → ${s04} мм)`, s04 > s01);
ok("тела соединителей строятся при любом зазоре",
  [0.05, 0.1, 0.2, 0.3, 0.5].every((clr) =>
    buildContainer({ ...base, connClr: clr }, connW, { fillets: false }).filter((x) => x.tag === "conn").length > 0));

// ── рамка узора = 2 × толщина стенки: при толстой стенке окно узора
// сжимается, поэтому решётки меньше (или узор становится сплошным)
// у внешней стенки толщина — wallOut, значит рамка = 2 × wallOut
const hexCfg = (wallOut) => ({
  ...base, W: 170, D: 170, H: 40, wallOut,
  walls: { "o:n:0": { h: 40, face: "hex", hexSize: 8 } },
});
const nHex = (wallOut) => buildContainer(hexCfg(wallOut), { N: null, S: null, W: null, E: null }, { fillets: false })
  .filter((x) => x.tag === "o:n:0").length;
const thin = nHex(1.2), thick = nHex(4);
ok(`толстая стенка — рамка шире, брусков меньше (${thin} → ${thick})`, thick < thin);

// ── рельс (male) не доходит до верхней кромки, паз (female) сквозной
{
  const cH = { ...base, H: 30, connClr: 0.2 };
  const male = buildContainer(cH, { N: null, S: null, W: null, E: { male: true, vs: connectorVs(100) } }, { fillets: false })
    .filter((x) => x.tag === "conn");
  let hiMale = -1e9;
  for (const b of male) for (const t of b.tris) for (const p of t)
    if (p[0] > cH.W / 2 + 0.5) hiMale = Math.max(hiMale, p[1]); // только выступающая часть рельса
  ok(`рельс ниже верха контейнера (${hiMale.toFixed(1)} < ${cH.H})`, hiMale < cH.H - 1);
  const female = buildContainer(cH, { N: null, S: null, E: null, W: { male: false, vs: connectorVs(100) } }, { fillets: false })
    .filter((x) => x.tag === "conn");
  let hiFem = -1e9;
  for (const b of female) for (const t of b.tris) for (const p of t) hiFem = Math.max(hiFem, p[1]);
  ok(`паз сквозной до верха (${hiFem.toFixed(1)} = ${cH.H})`, near(hiFem, cH.H, 0.02));
  // на низком контейнере рельс всё равно строится
  const low = buildContainer({ ...base, H: 12 }, { N: null, S: null, W: null, E: { male: true, vs: connectorVs(100) } }, { fillets: false })
    .filter((x) => x.tag === "conn");
  ok("на низком контейнере рельс есть", low.length > 0);
}

console.log(fail === 0 ? "\nCLEARANCE TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
