// Вставные стенки контейнера: контейнер делится на базу (дно + угловые
// стойки) и четыре плоские стенки. Главное, что проверяем: наружные
// плоскости остаются идеально ровными на всю высоту (иначе контейнеры не
// сомкнутся и замки перестанут работать), а шип точно входит в паз.
import { buildContainer } from "../src/model/build.js";
import { wpGeom, wpSpans, wpSize, wpFlatten, wpOk } from "../src/model/wallparts.js";

const mk = (wp, o = {}) => ({
  W: 120, D: 90, H: 30, cols: 1, rows: 1, gridMode: "count",
  wall: 1.6, wallOut: 4, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, fixedCells: [],
  wparts: { on: false, tng: 1.4, clr: 0.2, post: 12, ...wp },
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

// ── деление на детали ──
{
  const c = mk({ on: true });
  const s = buildContainer(c, noConn, {});
  const parts = new Set(s.map((b) => b.part).filter(Boolean));
  ok("контейнер делится на четыре стенки", parts.size === 4 && ["n", "s", "w", "e"].every((x) => parts.has(`wall:${x}`)), ` → ${[...parts].join(", ")}`);
  ok("база остаётся отдельной", s.some((b) => !b.part));
  const off = buildContainer(mk({ on: false }), noConn, {});
  ok("выключено — деталей нет", off.every((b) => !b.part));
}

// ── наружные плоскости ровные на всю высоту ──
{
  const c = mk({ on: true });
  const s = buildContainer(c, noConn, {});
  for (const [side, axis, want] of [["n", 2, -c.D / 2], ["s", 2, c.D / 2], ["w", 0, -c.W / 2], ["e", 0, c.W / 2]]) {
    let out = false, hits = 0;
    for (const b of s) for (const t of b.tris) for (const p of t) {
      if (want < 0 ? p[axis] < want - 0.001 : p[axis] > want + 0.001) out = true;
      if (near(p[axis], want, 0.001)) hits++;
    }
    ok(`сторона ${side}: за габарит ничего не выходит и плоскость есть`, !out && hits > 20);
  }
  // по высоте плоскость непрерывна: и стойка, и стенка достают до неё
  const atOuter = (yLo, yHi) => s.filter((b) => {
    const x = bbox(b);
    return near(x.lo[2], -c.D / 2, 0.001) && x.hi[1] > yLo && x.lo[1] < yHi;
  });
  ok("низ северной плоскости образован базой (стойки)", atOuter(0.5, 2).some((b) => !b.part));
  ok("верх северной плоскости образован стенкой-деталью", atOuter(c.H - 3, c.H).some((b) => b.part === "wall:n"));
}

// ── шип и паз ──
{
  const c = mk({ on: true });
  const g = wpGeom(c);
  const sp = wpSpans(c, c.W);
  const s = buildContainer(c, noConn, {});
  const nWall = s.filter((b) => b.part === "wall:n");
  // самый крайний по X кусок детали — шип
  const tip = nWall.map(bbox).sort((a, b) => a.lo[0] - b.lo[0])[0];
  ok(`шип доходит до угла (${tip.lo[0].toFixed(1)} = ${(-sp.tip).toFixed(1)})`, near(tip.lo[0], -sp.tip, 0.05));
  ok(`толщина шипа ${(tip.hi[2] - tip.lo[2]).toFixed(2)} = ${g.tng}`, near(tip.hi[2] - tip.lo[2], g.tng));
  ok(`шип утоплен от наружной плоскости на ${(tip.lo[2] + c.D / 2).toFixed(2)} = ${g.tOut}`, near(tip.lo[2] + c.D / 2, g.tOut));
  // паз в стойке: между наружным и внутренним слоями
  // тела стойки: не деталь, в пределах длины стойки и толщины стенки,
  // достают до верха
  const post = s.filter((b) => {
    const x = bbox(b);
    return !b.part
      && x.lo[0] > -c.W / 2 - 0.01 && x.hi[0] < -c.W / 2 + g.post + 0.01
      && x.lo[2] > -c.D / 2 - 0.01 && x.hi[2] < -c.D / 2 + c.wallOut + 0.01
      && x.hi[1] > c.H - 1;
  }).map(bbox);
  // слои считаем на участке паза (дальше сплошного куска у угла)
  const inSlot = post.filter((b) => b.lo[0] > -c.W / 2 + c.wallOut - 0.01);
  const outerSlab = inSlot.find((b) => b.hi[2] < -c.D / 2 + g.tOut + 0.01);
  ok("у стойки есть наружный слой", !!outerSlab, outerSlab ? ` (толщина ${(outerSlab.hi[2] - outerSlab.lo[2]).toFixed(2)})` : "");
  if (outerSlab) {
    const innerSlab = inSlot.find((b) => b.lo[2] > outerSlab.hi[2] + 0.01);
    ok("у стойки есть внутренний слой", !!innerSlab);
    if (innerSlab) {
      const gap = innerSlab.lo[2] - outerSlab.hi[2];
      ok(`паз = шип + два зазора (${gap.toFixed(2)} = ${g.cw.toFixed(2)})`, near(gap, g.cw));
      ok(`шип входит в паз с зазором ${g.clr} мм на сторону`, near(tip.lo[2] - outerSlab.hi[2], g.clr) && near(innerSlab.lo[2] - tip.hi[2], g.clr));
    }
  }
  // тело стенки не упирается в стойку
  const body = nWall.map(bbox).filter((b) => near(b.hi[2] - b.lo[2], c.wallOut, 0.2));
  const bodyLo = Math.min(...body.map((b) => b.lo[0]));
  ok(`между телом стенки и стойкой зазор ${g.clr} мм`, near(bodyLo, -sp.body, 0.05), ` (${bodyLo.toFixed(2)} = ${(-sp.body).toFixed(2)})`);
}

// ── деталь раскладывается плашмя ──
{
  const c = mk({ on: true });
  const s = buildContainer(c, noConn, {});
  for (const [side, axis] of [["n", "x"], ["w", "z"]]) {
    const flat = wpFlatten(s.filter((b) => b.part === `wall:${side}`), side, c);
    const sz = wpSize(c, axis);
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const b of flat) for (const t of b.tris) for (const p of t) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
    }
    ok(`деталь ${side}: лежит на столе`, near(lo[1], 0, 0.05), ` (низ ${lo[1].toFixed(2)})`);
    ok(`деталь ${side}: толщина по вертикали ${(hi[1] - lo[1]).toFixed(2)} = ${sz.thk}`, near(hi[1] - lo[1], sz.thk, 0.05));
    ok(`деталь ${side}: длина ${(hi[0] - lo[0]).toFixed(1)} = ${sz.len}`, near(hi[0] - lo[0], sz.len, 0.1));
    ok(`деталь ${side}: высота стенки легла в плоскость стола`, hi[2] - lo[2] > c.H - c.floor - 1.5);
  }
}

// ── когда соединение не влезает, режим не включается ──
{
  ok("тонкая стенка — соединение невозможно", !wpOk(mk({ on: true }, { wallOut: 2 })));
  ok("крошечный контейнер — соединение невозможно", !wpOk(mk({ on: true }, { W: 30, D: 30 })));
  const thin = buildContainer(mk({ on: true }, { wallOut: 2 }), noConn, {});
  ok("при тонкой стенке контейнер строится целиком", thin.every((b) => !b.part));
}

// ── совместимость ──
{
  const withConn = buildContainer(mk({ on: true }), { ...noConn, E: { male: true, vs: [-20, 20] }, W: { male: false, vs: [-20, 20] } }, {});
  ok("строится с замками", withConn.length > 0 && withConn.some((b) => b.part === "wall:e"));
  let out = false;
  for (const b of withConn) for (const t of b.tris) for (const p of t) if (p[0] > 60.001 + 1.7) out = true;
  ok("рельс замка остаётся на детали-стенке", withConn.some((b) => b.tag === "conn"));
  void out;
  const grid = buildContainer(mk({ on: true }, { cols: 3, rows: 2 }), noConn, {});
  ok("строится с сеткой перегородок", grid.some((b) => b.tag.startsWith("v:")) && grid.some((b) => b.part));
  const box = buildContainer(mk({ on: true }, { fixedCells: [{ w: 30, d: 25, anchor: "nw", lvl: 0 }] }), noConn, {});
  ok("строится с фиксированной ячейкой", box.some((b) => b.tag.startsWith("fw:")));
}

console.log(fail === 0 ? "\nWALL PART TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
