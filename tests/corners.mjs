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
const ok = (n, cond, extra = "") => { console.log(`${cond ? "OK  " : "FAIL"} ${n}${extra}`); if (!cond) fail++; };
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

// ── Щелей в углу быть не должно ──
// Раньше торцы стенок подрезались каждый по-своему, и между ломтиками
// валика оставались открытые прорези. Проверяем объём тела в квадратике
// угла: он должен совпасть с расчётным (четверть-цилиндра, переходящая
// сверху в сферический сектор). Любая щель или горб сдвинут объём.
{
  const c = mk();
  const solids = buildContainer(c, noConn, { fillets: false });
  const r = 0.8;                       // скругление кромки
  const Rc = 2;                        // скругление угла по плану
  const px = -50 + Rc, pz = -50 + Rc;  // центр скругления угла
  const N = 30, M = 90;                // сетка по плану и по высоте
  let vol = 0;
  const dx = Rc / N, dz = Rc / N, dy = c.H / M;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      for (let k = 0; k < M; k++) {
        const x = -50 + (i + 0.5) * dx, z = -50 + (j + 0.5) * dz, y = (k + 0.5) * dy;
        if (inSolids(solids, [x, y, z])) vol += dx * dz * dy;
      }
  // расчётный объём: ниже hb — четверть круга радиуса r, выше — сектор ρ=r·cos t
  const hb = c.H - r;
  let want = (Math.PI / 4) * Rc * Rc * hb;
  const S = 400;
  for (let k = 0; k < S; k++) {
    const t = ((k + 0.5) / S) * (Math.PI / 2);
    const rho = Rc - r * (1 - Math.cos(t));   // радиус угла убывает на отступ кромки
    want += (Math.PI / 4) * rho * rho * r * Math.cos(t) * (Math.PI / 2 / S);
  }
  const err = Math.abs(vol - want) / want;
  ok(`объём тела угла совпадает с расчётным (${vol.toFixed(3)} ≈ ${want.toFixed(3)} мм³)`, err < 0.05, ` откл. ${(err * 100).toFixed(1)}%`);
}

// ── Скругление угла отключается вместе со скруглением кромок ──
{
  const c = mk({ walls: Object.fromEntries(["o:n:0", "o:s:0", "o:w:0", "o:e:0"].map((k) => [k, { h: 30, rnd: 0 }])) });
  const s = buildContainer(c, noConn, { fillets: false });
  ok("rnd=0 — угол остаётся острым", inSolids(s, [-49.9, 15, -49.9]));
}
// ── Сторона с замком: плоскость ровная до самого угла ──
{
  const c = mk();
  const s = buildContainer(c, { ...noConn, N: lock() }, { fillets: false });
  let flat = true;
  for (let x = -49.5; x < -46; x += 0.25) if (!inSolids(s, [x, 29.9, -49.99])) flat = false;
  ok("замок: наружная плоскость доходит до угла на всей высоте", flat);
}

console.log(fail === 0 ? "\nCORNER TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
