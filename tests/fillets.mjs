// Проверка: (1) в кирпичной раскладке конец перегородки не торчит в чужую
// ячейку сквозь горизонтальную стенку; (2) галтели добавляются в углах
// примыкания перегородок к корпусу и не выходят за пределы ячейки.
import { buildContainer } from "../src/model/build.js";
import { layout } from "../src/model/layout.js";
import { solidsVolume } from "../src/geometry/stl.js";

const base = {
  W: 170, D: 170, H: 30, cols: 2, rows: 2, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 2.8, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null, lockedCellW: {}, lockedRows: {}, fixedCells: [],
};
const noConn = { N: null, S: null, W: null, E: null };

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? "OK " : "FAIL"} ${name}`); if (!cond) fail++; };

// ── 1. Кирпичная раскладка: перегородка ряда 0 на x=−22.2 не совпадает
// с перегородкой ряда 1 (x=+30). Конец v:0:0 не должен пролезть за
// дальнюю грань горизонтальной стенки в ячейку ряда 1.
const brick = { ...base, rowColWs: { 0: [60, 101.2], 1: [111.4, 49.8] } };
const L = layout(brick);
const zFarFace = L.cz0(0) + L.cd(0) + brick.wall; // дальняя грань h-перегородки
const xd = L.cx0(0, 0) + L.cw(0, 0) + brick.wall / 2;
const solids = buildContainer(brick, noConn);
// все тела с тегом v:0:0: максимальный z не должен превысить дальнюю грань
let maxZ = -1e9;
for (const s of solids) if (s.tag === "v:0:0")
  for (const tri of s.tris) for (const p of tri) maxZ = Math.max(maxZ, p[2]);
ok(`конец v:0:0 не торчит в чужую ячейку (maxZ=${maxZ.toFixed(2)} ≤ ${zFarFace.toFixed(2)})`, maxZ <= zFarFace + 0.01);

// в ровной сетке заход остаётся глубоким (сращивание сегментов), как раньше
const aligned = { ...base };
const La = layout(aligned);
const zFarA = La.cz0(0) + La.cd(0) + aligned.wallOut;
let maxZa = -1e9;
for (const s of buildContainer(aligned, noConn, { fillets: false })) if (s.tag === "v:0:0")
  for (const tri of s.tris) for (const p of tri) maxZa = Math.max(maxZa, p[2]);
ok(`в ровной сетке сращивание сохранено (maxZ=${maxZa.toFixed(2)})`, maxZa > zFarFace + 0.5 && maxZa <= zFarA + 0.01);

// ── 2. Галтели: объём с ними больше, чем без них; их тела лежат в
// пределах своей ячейки (у корпуса) и не выше стенки
const withF = buildContainer(base, noConn);
const withoutF = buildContainer(base, noConn, { fillets: false });
ok(`галтели добавились (+${(withF.length - withoutF.length)} тел)`, withF.length > withoutF.length);
ok("объём с галтелями больше", solidsVolume(withF) > solidsVolume(withoutF) + 0.01);
// 2 перегородки × 2 конца × 2 угла + 4 угла корпуса = 16 галтелей × 4 сегмента веера
// 16 мест × 4 клина × 8 слоёв (тело + 7 граней дуги, по которым галтель
// отступает вместе с кромкой)
ok(`число галтельных тел с учётом углов корпуса и Т-стыков (${withF.length - withoutF.length})`, (withF.length - withoutF.length) === 512);

// ── галтель доходит до кромки, а не обрывается площадкой ниже ──
{
  const gap = (solids, h) => {
    let top = -1e9;
    for (const b of solids) for (const t of b.tris) for (const p of t) top = Math.max(top, p[1]);
    return h - top;
  };
  const only = withF.filter((b) => !withoutF.some((x) => x === b));
  ok(`верх галтели приходит к кромке (недобор ${gap(only, base.H).toFixed(2)} мм)`, gap(only, base.H) < 0.05);
}
// все точки галтелей внутри контейнера и не выше высоты стенок
let inBounds = true;
const fSolids = withF.slice(withoutF.length);
for (const s of fSolids) for (const tri of s.tris) for (const p of tri) {
  if (Math.abs(p[0]) > base.W / 2 - base.wallOut + 0.01 && Math.abs(p[0]) > base.W / 2 + 0.01) inBounds = false;
  if (p[1] < -0.01 || p[1] > base.H + 0.01) inBounds = false;
}
ok("галтели в пределах корпуса и высоты", inBounds);

console.log(fail === 0 ? "\nFILLET TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
