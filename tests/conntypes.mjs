// Типы соединителей и высота замка.
// 1) Замок следует высоте СВОЕЙ стенки: понизили стенку — паз, задний
//    слой, щёчки и рельс понизились вместе с ней, ступеньки по высоте нет.
// 2) Слишком низкая стенка — зона не режется, замок не ставится.
// 3) «Выступы» (pins): шип наружу на male-стороне, глухой карман на
//    female-стороне; наружная плоскость female ровная, карман не сквозной.
import { buildContainer } from "../src/model/build.js";
import { connOf, connGeom, connectorVs, lockMinH, PIN } from "../src/model/connectors.js";

const mk = (o = {}) => ({
  W: 120, D: 100, H: 30, cols: 1, rows: 1, gridMode: "count",
  wall: 1.6, wallOut: 2.75, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [], ...o,
});
const noConn = { N: null, S: null, W: null, E: null };
const vs = [0];
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;

const bbox = (b) => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of b.tris) for (const p of t) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
  }
  return { lo, hi };
};
// точка внутри выпуклого тела (все грани смотрят наружу)
const inside = (b, p, eps = 1e-4) => {
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const t of b.tris) for (const q of t) { cx += q[0]; cy += q[1]; cz += q[2]; n++; }
  cx /= n; cy /= n; cz /= n;
  for (const [a, b2, d] of b.tris) {
    const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]];
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if ((p[0] - a[0]) * nn[0] + (p[1] - a[1]) * nn[1] + (p[2] - a[2]) * nn[2] > eps * Math.hypot(...nn)) return false;
  }
  return true;
};
const anyInside = (solids, p) => solids.some((b) => inside(b, p));

// ── dove: замок следует высоте стенки ──
{
  const hLow = 16;
  const c = mk({ walls: { "o:n:0": { h: hLow } } });
  const s = buildContainer(c, { ...noConn, N: { male: false, vs } }, { fillets: false });
  const conns = s.filter((b) => b.tag === "conn");
  ok("female на пониженной стенке ставится", conns.length > 0);
  let top = -1e9;
  for (const b of conns) top = Math.max(top, bbox(b).hi[1]);
  ok(`паз не выше стенки (${top.toFixed(1)} ≈ ${hLow})`, near(top, hLow, 0.1));
  // ничего в зоне замка не торчит выше пониженной стенки
  let over = false;
  for (const b of s) {
    const bb = bbox(b);
    if (bb.lo[2] < -c.D / 2 + c.wallOut && bb.hi[1] > hLow + 0.1 && bb.lo[0] < 8 && bb.hi[0] > -8) over = true;
  }
  ok("над замком нет ступеньки из старой высоты", !over);

  // male: рельс следует высоте
  const cm = mk({ walls: { "o:s:0": { h: hLow } } });
  const sm = buildContainer(cm, { ...noConn, S: { male: true, vs } }, { fillets: false });
  let railTop = -1e9, wallTop = -1e9;
  for (const b of sm.filter((x) => x.tag === "conn")) {
    const bb = bbox(b);
    if (bb.hi[2] > cm.D / 2 + 0.05) railTop = Math.max(railTop, bb.hi[1]); // сам рельс
    else wallTop = Math.max(wallTop, bb.hi[1]);
  }
  const g = connOf(cm);
  ok(`рельс кончается ниже кромки своей стенки (${railTop.toFixed(1)} = ${hLow - g.top})`, near(railTop, hLow - g.top));
  ok(`стенка зоны замка той же высоты (${wallTop.toFixed(1)} ≈ ${hLow})`, near(wallTop, hLow, 0.1));
}

// ── слишком низкая стенка: зона не режется, замок не ставится ──
{
  const g = connGeom(0.2);
  const hTiny = g.lockMin - 1;
  const c = mk({ walls: { "o:n:0": { h: hTiny } } });
  const s = buildContainer(c, { ...noConn, N: { male: false, vs } }, { fillets: false });
  ok("замок на низкой стенке не ставится", !s.some((b) => b.tag === "conn"));
  // стенка цела по всей зоне (материал на середине толщины)
  const holes = [];
  for (let y = 0.4; y < hTiny - 0.4; y += 0.5)
    if (!anyInside(s, [0, y, -c.D / 2 + c.wallOut / 2])) holes.push(y);
  ok("стенка в зоне цела и ровная", holes.length === 0, holes.length ? ` → дыры на y=${holes.join(",")}` : "");
  // male-сторона так же
  const sm = buildContainer(mk({ walls: { "o:s:0": { h: hTiny } } }), { ...noConn, S: { male: true, vs } }, { fillets: false });
  ok("рельс на низкой стенке не ставится", !sm.some((b) => b.tag === "conn"));
}

// ── pins: шип и карман ──
{
  const cM = mk({ connType: "pins" });
  const g = connOf(cM);
  ok("pins: геометрия помещается в стенку 2.75", g.fits && g.type === "pins");
  const sM = buildContainer(cM, { ...noConn, S: { male: true, vs } }, { fillets: false });
  let maxZ = -1e9;
  for (const b of sM) maxZ = Math.max(maxZ, bbox(b).hi[2]);
  ok(`шип выступает наружу на ${g.pin.prot} (${(maxZ - cM.D / 2).toFixed(2)})`, near(maxZ - cM.D / 2, g.pin.prot));
  // шип в своей вертикальной полосе
  const bump = sM.filter((b) => bbox(b).hi[2] > cM.D / 2 + 0.05);
  ok("шип один на замок", bump.length === 1);
  const bb = bbox(bump[0]);
  ok(`шип в полосе y ${g.pin.y0}..${g.pin.y0 + g.pin.h}`, near(bb.lo[1], g.pin.y0) && near(bb.hi[1], g.pin.y0 + g.pin.h));

  const cF = mk({ connType: "pins" });
  const sF = buildContainer(cF, { ...noConn, N: { male: false, vs } }, { fillets: false });
  let minZ = 1e9;
  for (const b of sF) minZ = Math.min(minZ, bbox(b).lo[2]);
  ok("female: наружная плоскость ровная, ничего не торчит", minZ >= -cF.D / 2 - 0.001);
  // карман: пустота на глубине шипа, дно кармана — материал
  const yc = g.pin.y0 + g.pin.h / 2;
  const zOut = -cF.D / 2;
  ok("карман открыт к соседу", !anyInside(sF, [0, yc, zOut + g.dg / 2]));
  ok("дно кармана на месте (не сквозной)", anyInside(sF, [0, yc, zOut + (g.dg + cF.wallOut) / 2]));
  ok("над карманом стенка есть", anyInside(sF, [0, g.pin.y0 + g.pin.h + 2, zOut + g.dg / 2]));
  ok("под карманом стенка есть", anyInside(sF, [0, 2, zOut + g.dg / 2]));
  ok("сбоку от кармана стенка есть", anyInside(sF, [g.pin.w / 2 + g.clr + 1, yc, zOut + g.dg / 2]));
  // карман шире шипа на зазор
  ok("зазор кармана на сторону", !anyInside(sF, [g.pin.w / 2 + g.clr - 0.05, yc, zOut + g.dg / 2]));

  // низкая стенка — pins не ставятся, стенка цела
  const hTiny = g.lockMin - 1;
  const sLow = buildContainer(mk({ connType: "pins", walls: { "o:n:0": { h: hTiny } } }), { ...noConn, N: { male: false, vs } }, { fillets: false });
  ok("pins на низкой стенке не ставятся", !sLow.some((b) => b.tag === "conn"));

  // тонкая стенка — шип ужимается, а совсем тонкая отключает замок
  const gThin = connOf(mk({ connType: "pins", wallOut: 2.0 }));
  ok(`тонкая стенка ужимает шип (${gThin.pin.prot})`, gThin.pin.prot < PIN.prot && gThin.fits);
  const gNone = connOf(mk({ connType: "pins", wallOut: 1.6 }));
  ok("совсем тонкая стенка отключает pins", !gNone.fits);
  const sNone = buildContainer(mk({ connType: "pins", wallOut: 1.6 }), { ...noConn, N: { male: false, vs } }, { fillets: false });
  ok("при отключённых pins стенка цела", !sNone.some((b) => b.tag === "conn"));
}

// ── два замка на широкой стенке, разные высоты сегментов ──
{
  // 2 колонки: левый сегмент понижен — левый замок следует ему,
  // правый остаётся на полной высоте
  const c = mk({ W: 200, cols: 2, walls: { "o:n:0": { h: 14 } } });
  const vw = connectorVs(200);
  const s = buildContainer(c, { ...noConn, N: { male: false, vs: vw } }, { fillets: false });
  let topL = -1e9, topR = -1e9;
  for (const b of s.filter((x) => x.tag === "conn")) {
    const bb = bbox(b);
    if (bb.hi[0] < 0) topL = Math.max(topL, bb.hi[1]);
    else if (bb.lo[0] > 0) topR = Math.max(topR, bb.hi[1]);
  }
  ok(`левый замок по левой стенке (${topL.toFixed(1)} ≈ 14)`, near(topL, 14, 0.1));
  ok(`правый замок по правой стенке (${topR.toFixed(1)} ≈ 30)`, near(topR, 30, 0.1));
}

console.log(fail === 0 ? "\nCONNECTOR TYPE TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
