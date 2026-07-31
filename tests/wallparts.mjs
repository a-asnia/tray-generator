// Вставные стенки контейнера: в основании канавка (наружная губка, паз,
// внутренняя губка), стенка — отдельная плоская деталь, вставляется в паз.
// Включается по каждой стороне отдельно.
import { buildContainer } from "../src/model/build.js";
import { wpGeom, wpOn, wpSpan, wpSize, wpFlatten, SIDES } from "../src/model/wallparts.js";

const mk = (wp, o = {}) => ({
  W: 80, D: 50, H: 18, cols: 1, rows: 1, gridMode: "count",
  wall: 1.6, wallOut: 4, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, fixedCells: [],
  wparts: { n: false, s: false, w: false, e: false, thk: 1.6, clr: 0.2, lip: 1, seat: 6, ...wp },
  ...o,
});
const noConn = { N: null, S: null, W: null, E: null };
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.02) => Math.abs(a - b) < e;
const bbox = (b) => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of b.tris) for (const p of t) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
  }
  return { lo, hi };
};

// ── включение по сторонам ──
{
  ok("по умолчанию всё выключено", SIDES.every((sd) => !wpOn(mk({}), sd)));
  const one = mk({ n: true });
  ok("включена только одна сторона", wpOn(one, "n") && !wpOn(one, "s") && !wpOn(one, "w") && !wpOn(one, "e"));
  const s = buildContainer(one, noConn, {});
  const parts = new Set(s.map((b) => b.part).filter(Boolean));
  ok("деталь ровно одна", parts.size === 1 && parts.has("wall:n"), ` → ${[...parts]}`);
  const all = buildContainer(mk({ n: true, s: true, w: true, e: true }), noConn, {});
  ok("все четыре — четыре детали", new Set(all.map((b) => b.part).filter(Boolean)).size === 4);
}

// ── канавка: губки и паз ──
{
  const c = mk({ n: true });
  const g = wpGeom(c);
  const s = buildContainer(c, noConn, {});
  const base = s.filter((b) => !b.part).map(bbox)
    .filter((b) => b.lo[2] < -c.D / 2 + c.wallOut + 0.01 && b.hi[1] < g.seat + 0.5 && b.hi[1] > 1);
  const lipOut = base.find((b) => near(b.lo[2], -c.D / 2) && b.hi[2] < -c.D / 2 + g.lip + 0.01);
  ok("наружная губка на габарите", !!lipOut, lipOut ? ` (толщина ${(lipOut.hi[2] - lipOut.lo[2]).toFixed(2)} = ${g.lip})` : "");
  const lipIn = base.find((b) => b.lo[2] > -c.D / 2 + g.lip + g.cw - 0.01);
  ok("внутренняя губка есть", !!lipIn);
  if (lipOut && lipIn) {
    ok(`паз = толщина + два зазора (${(lipIn.lo[2] - lipOut.hi[2]).toFixed(2)} = ${g.cw.toFixed(2)})`, near(lipIn.lo[2] - lipOut.hi[2], g.cw));
    ok(`губки высотой ${g.seat} мм`, near(Math.max(lipOut.hi[1], lipIn.hi[1]), g.seat, 0.05));
  }
  // деталь стоит в пазу с зазором и опирается на дно
  const plate = s.filter((b) => b.part === "wall:n").map(bbox);
  const pz0 = Math.min(...plate.map((b) => b.lo[2])), pz1 = Math.max(...plate.map((b) => b.hi[2]));
  ok(`стенка в пазу с зазором ${g.clr} мм на сторону`, near(pz0 - (lipOut ? lipOut.hi[2] : 0), g.clr) && near((lipIn ? lipIn.lo[2] : 0) - pz1, g.clr), ` (${pz0.toFixed(2)}…${pz1.toFixed(2)})`);
  ok(`толщина стенки ${(pz1 - pz0).toFixed(2)} = ${g.thk}`, near(pz1 - pz0, g.thk));
  ok("стенка стоит на дне", near(Math.min(...plate.map((b) => b.lo[1])), c.floor));
  ok("стенка доходит до верха", near(Math.max(...plate.map((b) => b.hi[1])), c.H, 0.05));
}

// ── пролёты и углы ──
{
  // печатная соседняя стенка занимает угол
  const c1 = mk({ n: true });
  const [a1] = wpSpan(c1, "n");
  ok("рядом с печатной стенкой деталь начинается за её гранью", near(a1, -c1.W / 2 + c1.wallOut + 0.2), ` (${a1.toFixed(2)})`);
  // если соседняя тоже вставная — N/S идут до углов, W/E встают между ними
  const c2 = mk({ n: true, w: true });
  const [a2] = wpSpan(c2, "n");
  const [b2] = wpSpan(c2, "w");
  const g = wpGeom(c2);
  ok("N доходит до угла за наружную губку", near(a2, -c2.W / 2 + g.lip + g.clr), ` (${a2.toFixed(2)})`);
  ok("W встаёт за стенкой N", near(b2, -c2.D / 2 + g.lip + g.cw + g.clr), ` (${b2.toFixed(2)})`);
  // угол закрыт: на высоте между посадкой и верхом материал есть
  const s = buildContainer(c2, noConn, {});
  const inSolid = (pt) => s.some((b) => {
    const bb = bbox(b);
    return pt.every((v, k) => v > bb.lo[k] - 0.001 && v < bb.hi[k] + 0.001);
  });
  ok("угол не разошёлся", inSolid([-c2.W / 2 + g.lip + 0.5, c2.H - 2, -c2.D / 2 + g.lip + 0.5]));
}

// ── деталь плашмя ──
{
  const c = mk({ n: true, w: true });
  const s = buildContainer(c, noConn, {});
  for (const side of ["n", "w"]) {
    const flat = wpFlatten(s.filter((b) => b.part === `wall:${side}`), side, c);
    const sz = wpSize(c, side);
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const b of flat) for (const t of b.tris) for (const p of t) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
    }
    ok(`деталь ${side}: лежит на столе`, near(lo[1], 0, 0.05));
    ok(`деталь ${side}: толщина по вертикали ${(hi[1] - lo[1]).toFixed(2)} = ${sz.thk}`, near(hi[1] - lo[1], sz.thk, 0.05));
    ok(`деталь ${side}: длина ${(hi[0] - lo[0]).toFixed(1)} = ${sz.len}`, near(hi[0] - lo[0], sz.len, 0.1));
    ok(`деталь ${side}: высота ${(hi[2] - lo[2]).toFixed(1)} = ${sz.hgt}`, near(hi[2] - lo[2], sz.hgt, 0.1));
  }
}

// ── ограничения и совместимость ──
{
  ok("тонкая стенка — сторона не включается", !wpOn(mk({ n: true }, { wallOut: 2 }), "n"));
  ok("низкий контейнер — сторона не включается", !wpOn(mk({ n: true }, { H: 6 }), "n"));
  const thin = buildContainer(mk({ n: true }, { wallOut: 2 }), noConn, {});
  ok("при тонкой стенке контейнер строится целиком", thin.every((b) => !b.part));
  // на вставной стороне замок не ставится, на печатной — остаётся
  const conn = { N: { male: false, vs: [-15, 15] }, S: { male: true, vs: [-15, 15] }, W: null, E: null };
  const s = buildContainer(mk({ n: true }), conn, {});
  let nConn = 0;
  for (const b of s) if (b.tag === "conn") { const bb = bbox(b); if (bb.lo[2] < 0) nConn++; }
  ok("на вставной стороне замка нет", nConn === 0);
  ok("на печатной стороне замок остался", s.some((b) => b.tag === "conn"));
  const grid = buildContainer(mk({ n: true, s: true }, { cols: 3, rows: 2 }), noConn, {});
  ok("работает с сеткой перегородок", grid.some((b) => b.tag.startsWith("v:")) && grid.some((b) => b.part));
  const box = buildContainer(mk({ n: true }, { fixedCells: [{ w: 20, d: 15, anchor: "ne", lvl: 0 }] }), noConn, {});
  ok("работает с фиксированной ячейкой", box.some((b) => b.tag.startsWith("fw:")));
}

console.log(fail === 0 ? "\nWALL PART TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
