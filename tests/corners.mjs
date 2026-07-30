// Верхние кромки в углах корпуса: скруглённый валик должен обходить угол
// непрерывно. Раньше квадратный торец одной стенки вылезал «зубчиком» из
// скругления перпендикулярной, а у стороны с замком — уступом на всю
// толщину. Наружные плоскости сторон с замками при этом остаются ровными.
import { buildContainer } from "../src/model/build.js";

const mk = (o) => ({
  W: 100, D: 100, H: 30, cols: 1, rows: 1, gridMode: "count",
  wall: 1.6, wallOut: 3, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, fixedCells: [], ...o,
});
const noConn = { N: null, S: null, W: null, E: null };
const lock = (vs = [-25, 25]) => ({ male: false, vs });

// точка внутри хотя бы одного тела (все тела — выпуклые призмы)
const inSolids = (solids, pt) => {
  for (const s of solids) {
    const cen = [0, 0, 0];
    let n = 0;
    for (const t of s.tris) for (const p of t) { cen[0] += p[0]; cen[1] += p[1]; cen[2] += p[2]; n++; }
    cen[0] /= n; cen[1] /= n; cen[2] /= n;
    let inside = true;
    for (const t of s.tris) {
      const [a, b, c] = t;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const d = (p) => nr[0] * (p[0] - a[0]) + nr[1] * (p[1] - a[1]) + nr[2] * (p[2] - a[2]);
      const dc = d(cen);
      if (Math.abs(dc) < 1e-9) continue;
      if (Math.sign(d(pt)) !== Math.sign(dc) && Math.abs(d(pt)) > 1e-6) { inside = false; break; }
    }
    if (inside) return true;
  }
  return false;
};

// фактический отступ наружной кромки на высоте y, измеренный в СЕРЕДИНЕ
// стенки (далеко от углов) — это эталон, которому должен подчиняться угол
const insetMid = (solids, y, axis) => {
  let t = -50;
  while (t < -46 && !inSolids(solids, axis === "x" ? [t, y, 0] : [0, y, t])) t += 0.01;
  return t + 50;
};

let fail = 0;
const check = (label, c, conn) => {
  const solids = buildContainer(c, conn, { fillets: false });
  const y = c.H - 0.02;
  const insW = insetMid(solids, y, "x"); // западная стенка (отступ по X)
  const insN = insetMid(solids, y, "z"); // северная стенка (отступ по Z)
  let extra = 0;
  for (let x = -50; x <= -46.5; x += 0.05)
    for (let z = -50; z <= -46.5; z += 0.05) {
      if (!inSolids(solids, [x, y, z])) continue;
      if (x < -50 + insW - 0.02 || z < -50 + insN - 0.02) extra++;
    }
  const ok = extra === 0;
  console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(22)} отступ W=${insW.toFixed(2)} N=${insN.toFixed(2)}, лишних точек ${extra}`);
  if (!ok) fail++;
};

check("без замков", mk(), noConn);
check("замок на N", mk(), { ...noConn, N: lock() });
check("замок на W", mk(), { ...noConn, W: lock() });
check("замки N+W", mk(), { ...noConn, N: lock(), W: lock() });
check("замки со всех сторон", mk(), { N: lock(), S: { male: true, vs: [-25, 25] }, W: lock(), E: { male: true, vs: [-25, 25] } });
check("сетка 3×3", mk({ cols: 3, rows: 3 }), noConn);
check("узор соты", mk({ walls: { "o:n:0": { h: 30, face: "hex" }, "o:w:0": { h: 30, face: "hex" } } }), noConn);
check("узор линии", mk({ walls: { "o:n:0": { h: 30, face: "lines" }, "o:w:0": { h: 30, face: "lines" } } }), noConn);
check("скругление 1.4", mk({ walls: { "o:n:0": { h: 30, rnd: 1.4 }, "o:w:0": { h: 30, rnd: 1.4 } } }), noConn);
check("без скругления", mk({ walls: { "o:n:0": { h: 30, rnd: 0 }, "o:w:0": { h: 30, rnd: 0 } } }), noConn);
check("толстые стенки", mk({ wall: 4, wallOut: 6, floor: 4 }), noConn);

console.log(fail === 0 ? "\nCORNER TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
