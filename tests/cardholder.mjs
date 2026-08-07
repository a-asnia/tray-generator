// Съёмная визитница: пара сквозных окон у верха внешней стенки и
// отдельная печатная деталь с крюками, которые в эти окна входят.
import { buildContainer } from "../src/model/build.js";
import { cardHolderSolids, CARDH } from "../src/model/cardholder.js";
import { remapCells } from "../src/model/layout.js";

const mk = (o = {}) => ({
  W: 170, D: 170, H: 30, cols: 1, rows: 1, gridMode: "count",
  wall: 1.6, wallOut: 2.9, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [], ...o,
});
const noConn = { N: null, S: null, W: null, E: null };
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;

const inside = (b, p, eps = 1e-4) => {
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const t of b.tris) for (const q of t) { cx += q[0]; cy += q[1]; cz += q[2]; n++; }
  for (const [a, b2, d] of b.tris) {
    const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]];
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if ((p[0] - a[0]) * nn[0] + (p[1] - a[1]) * nn[1] + (p[2] - a[2]) * nn[2] > eps * Math.hypot(...nn)) return false;
  }
  return true;
};
const anyInside = (s, p) => s.some((b) => inside(b, p));

// ── окна в стенке ──
{
  const c = mk({ walls: { "o:n:0": { cardHooks: true } } });
  const s = buildContainer(c, noConn, { fillets: false });
  const zMid = -c.D / 2 + c.wallOut / 2;
  const yMid = c.H - CARDH.top - CARDH.hh / 2;
  // окна сквозные на позициях ±sp/2
  ok("окно слева сквозное", !anyInside(s, [-CARDH.sp / 2, yMid, zMid]));
  ok("окно справа сквозное", !anyInside(s, [CARDH.sp / 2, yMid, zMid]));
  // между окнами, под и над ними — материал
  ok("между окнами стенка цела", anyInside(s, [0, yMid, zMid]));
  ok("под окном стенка цела", anyInside(s, [CARDH.sp / 2, c.H - CARDH.top - CARDH.hh - 2, zMid]));
  ok("над окном стенка цела", anyInside(s, [CARDH.sp / 2, c.H - 1.5, zMid]));
  // без галки окон нет
  const s0 = buildContainer(mk(), noConn, { fillets: false });
  ok("без галки стенка сплошная", anyInside(s0, [CARDH.sp / 2, yMid, zMid]));
  // низкая стенка: окна не режутся
  const sLow = buildContainer(mk({ walls: { "o:n:0": { cardHooks: true, h: 15 } } }), noConn, { fillets: false });
  ok("на низкой стенке окон нет", anyInside(sLow, [CARDH.sp / 2, 15 - CARDH.top - CARDH.hh / 2, zMid]));
  // окна дружат с замком на той же стенке
  const sConn = buildContainer(c, { ...noConn, N: { male: false, vs: [-42.5, 42.5] } }, { fillets: false });
  ok("окна и замки вместе строятся", sConn.length > 50 && !anyInside(sConn, [-CARDH.sp / 2, yMid, zMid]));
}

// ── деталь-визитница ──
{
  const c = mk();
  const s = cardHolderSolids(c);
  ok("деталь собрана", s.length >= 7);
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const b of s) for (const t of b.tris) for (const p of t)
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  ok("деталь стоит на столе", near(lo[1], 0));
  ok(`печать лёжа на боку (высота = ширина детали, ${(hi[1] - lo[1]).toFixed(0)} мм)`, near(hi[1] - lo[1], 70));
  // крюки: ширина меньше окна, плечо тоньше окна, шаг совпадает
  const hooks = s.slice(3); // спинка, дно, борт, затем крюки
  ok("крюков четыре тела (2 плеча + 2 носика)", hooks.length === 4);
  // ширина крюка (по вертикали лёжа) уже окна на зазор
  let hookW = 0;
  {
    const b = hooks[0];
    let y0 = 1e9, y1 = -1e9;
    for (const t of b.tris) for (const p of t) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    hookW = y1 - y0;
  }
  ok(`крюк уже окна (${hookW.toFixed(1)} < ${CARDH.hw})`, hookW < CARDH.hw - 1.5);
}

// ── ремап настроек ячеек при делении сетки ──
{
  const c1 = mk({ cells: { "0:0": { lvl: 20, tiltDir: "s", tiltA: 10 } } });
  const c2 = { ...c1, cols: 3, rows: 2 };
  const cells = remapCells(c1, c2);
  ok("деление 1×1 → 3×2: уровень у всех ячеек",
    ["0:0", "1:0", "2:0", "0:1", "1:1", "2:1"].every((k) => cells[k]?.lvl === 20 && cells[k]?.tiltDir === "s"));
  // обратное объединение: уровень остаётся от накрывающей ячейки
  const c3 = mk({ cols: 2, cells: { "0:0": { lvl: 12 }, "1:0": { lvl: 30 } } });
  const merged = remapCells(c3, { ...c3, cols: 1 });
  ok("объединение наследует от накрывающей центр", merged["0:0"]?.lvl !== undefined);
  // пустые настройки не плодятся
  ok("без настроек — пусто", Object.keys(remapCells(mk(), { ...mk(), cols: 4 })).length === 0);
}

console.log(fail === 0 ? "\nCARD HOLDER TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
