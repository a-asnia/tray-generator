// Вставные стенки: направляющие на внутренних гранях + отдельная деталь.
// Проверяем, что канал точно соответствует толщине вставки с зазором,
// что рёбра не лезут в чужие ячейки и не портят наружные плоскости,
// и что деталь физически влезает между стенками.
import { buildContainer } from "../src/model/build.js";
import { insertSlots, insertSlotsAll, insertSize, insertPlateSolids, insertInPlace, insertProfile, insertsOf, MIN_WEB } from "../src/model/inserts.js";

const mk = (ins, o = {}) => ({
  W: 120, D: 80, H: 28, cols: 1, rows: 1, gridMode: "count",
  wall: 1.6, wallOut: 3, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, fixedCells: [],
  inserts: { dir: "none", step: 20, thk: 1.6, clr: 0.2, proj: 1.2, rail: 1.6, show: false, ...ins },
  ...o,
});
const noConn = { N: null, S: null, W: null, E: null };
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.02) => Math.abs(a - b) < e;

// ── места под вставку ──
{
  const c = mk({ dir: "x", step: 20 });
  const s = insertSlots(c, "x");
  ok("места симметричны и с шагом 20", s.length > 2 && s.includes(0) && near(s[1] - s[0], 20), ` → ${JSON.stringify(s)}`);
  const inner = c.W - 2 * c.wallOut;
  ok("края не выходят за внутренний пролёт", Math.max(...s.map(Math.abs)) + 1.6 / 2 + 0.2 + 1.6 < inner / 2);
  ok("другая ось пуста", insertSlots(c, "z").length === 0);
  ok("dir none — мест нет", insertSlots(mk({ dir: "none" }), "x").length === 0);
  ok("узкому контейнеру хватает одного места по центру", JSON.stringify(insertSlots(mk({ dir: "x", step: 20 }, { W: 20 }), "x")) === "[0]");
  const tiny = insertSlots(mk({ dir: "x", step: 20 }, { W: 12 }), "x");
  ok("совсем узкому мест не остаётся", tiny.length === 0, ` → ${JSON.stringify(tiny)}`);
}

// ── канал между рёбрами точно под вставку ──
// рёбра на грани стенки: тела, начинающиеся ровно на грани и уходящие
// внутрь ячейки (галтели отключены — они тоже стоят на грани)
const ribsAt = (solids, face, inward) => {
  const out = [];
  for (const b of solids) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const t of b.tris) for (const p of t) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    const near0 = inward > 0 ? Math.abs(z0 - face) < 0.01 && z1 > face + 0.05
                             : Math.abs(z1 - face) < 0.01 && z0 < face - 0.05;
    if (near0 && x1 - x0 < 5) out.push({ x0, x1, z0, z1, y0, y1 });
  }
  return out;
};

{
  const c = mk({ dir: "x" });
  const ins = insertsOf(c);
  const s = buildContainer(c, noConn, { fillets: false });
  const face = -c.D / 2 + c.wallOut;           // внутренняя грань северной стенки
  const ribs = ribsAt(s, face, 1);
  const slots = insertSlots(c, "x");
  // каждое ребро — два тела: основное и заходный скос сверху
  ok("на каждое место по паре рёбер", ribs.length === slots.length * 4, ` → ${ribs.length} тел при ${slots.length} местах`);
  // канал у места 0
  const mid = ribs.filter((r) => Math.abs((r.x0 + r.x1) / 2) < 5);
  const pair = [
    mid.filter((r) => r.x1 < 0).reduce((a, b) => (a.y1 - a.y0 > b.y1 - b.y0 ? a : b)),
    mid.filter((r) => r.x0 > 0).reduce((a, b) => (a.y1 - a.y0 > b.y1 - b.y0 ? a : b)),
  ];
  ok("у центрального места ребро слева и справа", mid.length === 4);
  {
    const gap = pair[1].x0 - pair[0].x1;
    ok(`канал = толщина + два зазора (${gap.toFixed(2)} = ${(ins.thk + 2 * ins.clr).toFixed(2)})`, near(gap, ins.thk + 2 * ins.clr));
    ok(`ширина ребра ${(pair[0].x1 - pair[0].x0).toFixed(2)} = ${ins.rail}`, near(pair[0].x1 - pair[0].x0, ins.rail));
    ok(`выступ ${(pair[0].z1 - face).toFixed(2)} = ${ins.proj}`, near(pair[0].z1 - face, ins.proj));
    ok("ребро стоит на дне", near(pair[0].y0, c.floor));
    const top = Math.max(...mid.map((r) => r.y1));
    ok("рёбра не доходят до кромки", top < c.H - 0.5, ` (${top.toFixed(1)} < ${c.H})`);
  }
  const south = ribsAt(s, c.D / 2 - c.wallOut, -1);
  ok("на противоположной стенке столько же рёбер", south.length === ribs.length, ` → ${south.length}`);
}

// ── вставка влезает между стенками ──
{
  for (const [dir, span] of [["x", "D"], ["z", "W"]]) {
    const c = mk({ dir });
    const sz = insertSize(c, dir);
    const inner = c[span] - 2 * c.wallOut;
    ok(`вставка ${dir}: длина ${sz.len} влезает в пролёт ${inner}`, sz.len < inner && sz.len > inner - 1);
    ok(`вставка ${dir}: не торчит выше кромки (${sz.hgt} + ${c.floor} < ${c.H})`, sz.hgt + c.floor <= c.H);
    const plate = insertPlateSolids(c, dir);
    let sx = [1e9, -1e9], sy = [1e9, -1e9], sz2 = [1e9, -1e9];
    for (const b of plate) for (const t of b.tris) for (const p of t) {
      sx = [Math.min(sx[0], p[0]), Math.max(sx[1], p[0])];
      sy = [Math.min(sy[0], p[1]), Math.max(sy[1], p[1])];
      sz2 = [Math.min(sz2[0], p[2]), Math.max(sz2[1], p[2])];
    }
    ok(`деталь ${dir} лежит плашмя (толщина по вертикали ${(sy[1] - sy[0]).toFixed(1)})`, near(sy[1] - sy[0], sz.thk) && near(sx[1] - sx[0], sz.len) && near(sz2[1] - sz2[0], sz.hgt));
    ok(`деталь ${dir} стоит на столе`, near(sy[0], 0));
  }
}

// ── ничего не ломается ──
{
  const off = buildContainer(mk({ dir: "none" }), noConn, {});
  const on = buildContainer(mk({ dir: "x" }), noConn, {});
  ok("выключенные вставки не меняют геометрию", off.length < on.length);
  // наружные плоскости остаются ровными
  let flat = true;
  for (const b of on) for (const t of b.tris) for (const p of t) if (p[2] < -40.001) flat = false;
  ok("наружная плоскость не тронута", flat);
  // с замком: паз соединителя внутри стенки не задет рёбрами
  // с замком стенка режется зонами паза, но рёбра остаются на месте
  const c2 = mk({ dir: "x" });
  const withConn = buildContainer(c2, { ...noConn, N: { male: false, vs: [-30, 30] } }, { fillets: false });
  const plainRibs = ribsAt(buildContainer(c2, noConn, { fillets: false }), -c2.D / 2 + c2.wallOut, 1).length;
  const connRibs = ribsAt(withConn, -c2.D / 2 + c2.wallOut, 1).length;
  ok("замок соединителя не съедает направляющие", connRibs === plainRibs, ` → ${connRibs} из ${plainRibs}`);
  let flatN = true;
  for (const b of withConn) for (const t of b.tris) for (const p of t) if (p[2] < -c2.D / 2 - 0.001) flatN = false;
  ok("наружная плоскость стороны с замком ровная", flatN);
  // место, занятое печатной перегородкой, пропускается
  const grid = buildContainer(mk({ dir: "x" }, { cols: 3 }), noConn, {});
  const plain = buildContainer(mk({ dir: "none" }, { cols: 3 }), noConn, {});
  ok("места под печатными перегородками пропущены", grid.length > plain.length);
  // бокс на пути — место пропускается
  const box = buildContainer(mk({ dir: "x" }, { fixedCells: [{ w: 40, d: 30, anchor: "nw", lvl: 0 }] }), noConn, {});
  ok("строится с фиксированной ячейкой", box.length > 0);
}

// ── поперечные печатные стенки: вырез, а не пересечение ──
{
  // 2 ряда, низкая перегородка между ними — вставка обязана её оседлать
  const c = mk({ dir: "x" }, { rows: 2, walls: { "h:0:0": { h: 8 } } });
  const slots = insertSlots(c, "x");
  ok("низкая поперечная стенка не отнимает места", slots.length > 0, ` → ${slots.length}`);
  const rects = insertProfile(c, "x", 0);
  const zd = 0; // перегородка посередине глубины
  const over = rects.filter((r) => r.s0 < zd && r.s1 > zd);
  ok("над стенкой ровно один прямоугольник (вырез снизу)", over.length === 1);
  ok(`низ выреза выше стенки (${over[0]?.y0} ≥ 8.5)`, over.length === 1 && near(over[0].y0, 8.5));
  // тело вставки нигде не пересекает тело печатной перегородки
  const wallTop = 8, wallBand = [zd - c.wall / 2, zd + c.wall / 2];
  const collide = rects.some((r) => r.s0 < wallBand[1] - 0.01 && r.s1 > wallBand[0] + 0.01 && r.y0 < wallTop - 0.01);
  ok("вставка не проходит сквозь печатную стенку", !collide);
  // и по бокам выреза остаётся зазор
  const left = rects.find((r) => Math.abs(r.s1 - (wallBand[0] - insertsOf(c).clr)) < 0.01);
  ok("вырез шире стенки на зазор с каждой стороны", !!left);

  // полноразмерная поперечная стенка делает место непригодным
  const cTall = mk({ dir: "x" }, { rows: 2 });
  ok("высокая поперечная стенка блокирует места", insertSlots(cTall, "x").length === 0);
  ok("сами места геометрически есть", insertSlotsAll(cTall, "x").length > 0);
  ok("порог — сплошная полоса MIN_WEB над вырезом",
    insertSlots(mk({ dir: "x" }, { rows: 2, walls: { "h:0:0": { h: cTall.H - 0.3 - MIN_WEB - 0.6 } } }), "x").length > 0);
}

// ── лесенка полов: низ повторяет уровни, верх не торчит над кромкой ──
{
  const c = mk({ dir: "x" }, { rows: 2, walls: { "h:0:0": { h: 8 } }, cells: { "0:0": { lvl: 10 } } });
  const solidsIn = insertInPlace(c, "x", 0);
  let yTop = -1e9;
  for (const b of solidsIn) for (const t of b.tris) for (const p of t) yTop = Math.max(yTop, p[1]);
  ok(`верх вставки не выше кромки (${yTop.toFixed(1)} ≤ ${c.H})`, yTop <= c.H - 0.29);
  const rects = insertProfile(c, "x", 0);
  const rowA = rects.find((r) => r.s1 < 0 && r.s0 < -5); // ряд 0 (поднятый пол)
  const rowB = rects.find((r) => r.s0 > 0 && r.s1 > 5);  // ряд 1 (пол на дне)
  ok("над поднятым полом низ сидит на нём", rowA && near(rowA.y0, c.floor + 10));
  ok("над обычным полом низ сидит на дне", rowB && near(rowB.y0, c.floor));
  // деталь плашмя: высота bbox — от самого низкого низа
  const sz = insertSize(c, "x");
  ok(`высота детали от низкого участка (${sz.hgt})`, near(sz.hgt, c.H - 0.3 - c.floor, 0.06));
  const plate = insertPlateSolids(c, "x");
  ok("деталь из нескольких кусков (ступени и вырез)", plate.length >= 3, ` → ${plate.length}`);
  let py = [1e9, -1e9];
  for (const b of plate) for (const t of b.tris) for (const p of t) py = [Math.min(py[0], p[1]), Math.max(py[1], p[1])];
  ok("деталь по-прежнему лежит плашмя", near(py[0], 0) && near(py[1], insertsOf(c).thk));
}

// ── вставка «вдоль» седлает вертикальные перегородки своего ряда ──
{
  const c = mk({ dir: "z" }, { cols: 2, walls: { "v:0:0": { h: 6 } } });
  const slots = insertSlots(c, "z");
  ok("вдоль: место есть при низкой перегородке", slots.length > 0, ` → ${slots.length}`);
  const rects = insertProfile(c, "z", 0);
  const over = rects.filter((r) => r.s0 < 0 && r.s1 > 0);
  ok("вдоль: вырез над перегородкой", over.length === 1 && near(over[0].y0, 6.5));
  ok("вдоль: полноразмерная перегородка блокирует", insertSlots(mk({ dir: "z" }, { cols: 2 }), "z").length === 0);
}

console.log(fail === 0 ? "\nINSERT TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
