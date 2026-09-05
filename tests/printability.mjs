// ── Печатопригодность одного контейнера ──
// Проверяем то, что ломает печать или портит вид модели:
//   • ничего не уходит под стол и не торчит за габарит (кроме рельса замка);
//   • нет тел, висящих в воздухе (лесенка, полы, замки должны на что-то опираться);
//   • нет «летающих» кусков стенок после вырезов под визитницу и замки;
//   • объём и число тел вменяемы, координаты — числа.
import { buildContainer } from "../src/model/build.js";
import { presetContainer, GORKA_DEF } from "../src/model/presets.js";
import { solidsVolume } from "../src/geometry/stl.js";
import { connOf, connectorVs } from "../src/model/connectors.js";
import { cases, base, noConn, bboxOf, bboxAll } from "./fixtures.mjs";

let fail = 0;
const ok = (n, c, extra = "") => { if (!c) { console.log(`FAIL ${n}${extra}`); fail++; } };
const LIM = { maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40 };

// пресеты добавляем к общему набору конфигураций
const extra = {};
for (const kind of ["low", "narrow", "grid6", "booklet", "stairs"]) {
  const c = presetContainer({ ...base, W: 170, D: 170, H: 60, id: 1, gx: 0, gy: 0 }, kind, LIM, GORKA_DEF);
  extra[`пресет ${kind}`] = [c, noConn];
  extra[`пресет ${kind} + замки`] = [c, {
    E: { male: true, vs: connectorVs(c.D) }, W: { male: false, vs: connectorVs(c.D) },
    S: { male: true, vs: connectorVs(c.W) }, N: { male: false, vs: connectorVs(c.W) },
  }];
}
extra["визитница на стенке"] = [
  { ...base, W: 170, D: 120, H: 70, cols: 1, rows: 1, walls: { "o:n:0": { h: 64, cardHooks: true } } }, noConn,
];
extra["визитница + замок на той же стенке"] = [
  { ...base, W: 170, D: 120, H: 70, cols: 1, rows: 1, walls: { "o:n:0": { h: 64, cardHooks: true } } },
  { N: { male: false, vs: connectorVs(170) }, S: null, W: null, E: null },
];
extra["башенка и провал"] = [
  { ...base, H: 40, walls: { "v:0:0": { h: 80 }, "h:0:0": { h: 0 }, "o:n:1": { h: 6 } },
    cells: { "0:0": { lvl: 14 }, "1:1": { lvl: 22, tiltDir: "s", tiltA: 12 } } }, noConn,
];

const all = { ...cases, ...extra };

for (const [name, [c, conn]] of Object.entries(all)) {
  const solids = buildContainer(c, conn);
  const tag = ` [${name}]`;
  ok("геометрия построена", solids.length > 0, tag);

  // 1. координаты — конечные числа
  let bad = 0;
  for (const s of solids) for (const t of s.tris) for (const p of t)
    if (!p.every((v) => Number.isFinite(v))) bad++;
  ok("координаты конечны", bad === 0, `${tag} → ${bad} точек`);

  // 2. ничего не уходит под стол
  const bb = bboxAll(solids);
  ok("ничего не ниже стола", bb.lo[1] > -0.01, `${tag} → y=${bb.lo[1].toFixed(2)}`);

  // 3. за габарит выступает только рельс замка (и только там, где он есть)
  const g = connOf(c);
  const railX = conn && ((conn.E && conn.E.male) || (conn.W && conn.W.male)) ? g.depth : 0;
  const railZ = conn && ((conn.S && conn.S.male) || (conn.N && conn.N.male)) ? g.depth : 0;
  let out = [];
  for (const s of solids) {
    const b = bboxOf(s);
    const allow = s.tag === "conn";
    const limX = c.W / 2 + (allow ? railX : 0) + 0.02;
    const limZ = c.D / 2 + (allow ? railZ : 0) + 0.02;
    if (b.hi[0] > limX || b.lo[0] < -limX || b.hi[2] > limZ || b.lo[2] < -limZ)
      out.push(`${s.tag}@${b.hi[0].toFixed(2)}/${b.hi[2].toFixed(2)}`);
  }
  ok("за габарит ничего не торчит", out.length === 0, `${tag} → ${out.slice(0, 3).join(", ")}`);

  // 4. модель — одно целое, стоящее на столе: тела, соприкасающиеся
  //    габаритами, объединяются, и каждая группа обязана доставать до стола.
  //    Именно так ловится «стенка развалилась на куски» — кусок, повисший
  //    в воздухе, оказывается отдельной группой.
  const bbs = solids.map(bboxOf);
  const touch = (a, b) => {
    for (let k = 0; k < 3; k++) if (a.lo[k] > b.hi[k] + 0.06 || b.lo[k] > a.hi[k] + 0.06) return false;
    return true;
  };
  const par = solids.map((_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const uni = (i, j) => { const a = find(i), b = find(j); if (a !== b) par[a] = b; };
  // соседей ищем через грубую сетку: полный перебор на 3000 телах — минуты
  const CELL = 12, buckets = new Map();
  bbs.forEach((b, i) => {
    for (let x = Math.floor(b.lo[0] / CELL); x <= Math.floor(b.hi[0] / CELL); x++)
      for (let y = Math.floor(b.lo[1] / CELL); y <= Math.floor(b.hi[1] / CELL); y++)
        for (let z = Math.floor(b.lo[2] / CELL); z <= Math.floor(b.hi[2] / CELL); z++) {
          const k = `${x}:${y}:${z}`;
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(i);
        }
  });
  for (const list of buckets.values())
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++)
        if (touch(bbs[list[a]], bbs[list[b]])) uni(list[a], list[b]);
  const grounded = new Set();
  bbs.forEach((b, i) => { if (b.lo[1] < 0.05) grounded.add(find(i)); });
  const air = [];
  bbs.forEach((b, i) => { if (!grounded.has(find(i))) air.push(`${solids[i].tag}@y${b.lo[1].toFixed(1)}`); });
  ok("нет кусков, висящих в воздухе", air.length === 0, `${tag} → ${air.length}: ${[...new Set(air)].slice(0, 4).join(", ")}`);

  // 4b. перекрытия (проёмы под визитницу, спуски кромки) не длиннее
  //     мостика, который печатается без поддержек
  const BRIDGE = 22;
  const bridges = [];
  bbs.forEach((b, i) => {
    if (b.lo[1] < 0.05) return;
    const rests = bbs.some((o, j) => j !== i &&
      o.hi[1] >= b.lo[1] - 0.06 && o.lo[1] <= b.lo[1] - 0.001 &&
      o.hi[0] > b.lo[0] + 0.01 && o.lo[0] < b.hi[0] - 0.01 &&
      o.hi[2] > b.lo[2] + 0.01 && o.lo[2] < b.hi[2] - 0.01);
    if (rests) return;
    const span = Math.min(b.hi[0] - b.lo[0], b.hi[2] - b.lo[2]);
    if (span > BRIDGE) bridges.push(`${solids[i].tag}@y${b.lo[1].toFixed(1)} пролёт ${span.toFixed(1)}`);
  });
  ok("нависания короче мостика", bridges.length === 0, `${tag} → ${bridges.slice(0, 3).join("; ")}`);

  // 4c. нет вырожденных тел: тело без объёма даёт в STL дырявую сетку.
  //     Тонкие ступеньки дуги скругления (сотые доли мм) — не в счёт:
  //     они сращены со стенкой и режутся как одно тело.
  const flat = solids.filter((s, i) => {
    const b = bbs[i];
    const d = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
    return s.tris.length < 4 || Math.min(...d) < 0.005;
  });
  ok("нет вырожденных тел", flat.length === 0, `${tag} → ${flat.length}`);

  // 5. объём вменяем: не ноль и не больше габаритного куба
  const vol = solidsVolume(solids);
  const boxVol = (bb.hi[0] - bb.lo[0]) * (bb.hi[1] - bb.lo[1]) * (bb.hi[2] - bb.lo[2]);
  ok("объём положительный", vol > 0, `${tag} → ${vol}`);
  ok("объём меньше габаритного куба", vol < boxVol, `${tag} → ${vol.toFixed(0)} / ${boxVol.toFixed(0)}`);
}

console.log(fail === 0
  ? `PRINTABILITY OK (${Object.keys(all).length} конфигураций)`
  : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
