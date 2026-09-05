// Замок живёт ВНУТРИ толщины внешней стенки. Если стенка тоньше, чем нужно
// пазу, паз не имеет права прорезать её насквозь: он ужимается, а когда
// ужимать некуда — замок не ставится вовсе. Стенка важнее замка.
import { buildContainer } from "../src/model/build.js";
import { connOf, connectorVs, MIN_DG } from "../src/model/connectors.js";
import { normalizeProject } from "../src/state/storage.js";

const mk = (o = {}) => ({
  W: 120, D: 100, H: 30, cols: 1, rows: 1, gridMode: "count",
  wall: 1.6, wallOut: 2.75, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, fixedCells: [], ...o,
});
const vs = connectorVs(120);
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const bbox = (b) => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of b.tris) for (const p of t) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
  }
  return { lo, hi };
};
// есть ли материал стенки в зоне замка на высоте y
const solidInZone = (c, conn, y) => {
  const s = buildContainer(c, conn, { fillets: false });
  const outer = -c.D / 2, zx = vs[0];
  return s.some((b) => {
    const bb = bbox(b);
    return bb.lo[0] < zx && bb.hi[0] > zx && bb.lo[1] <= y && bb.hi[1] >= y
      && bb.lo[2] < outer + c.wallOut && bb.hi[2] > outer;
  });
};

// ── сквозной дыры в стенке не бывает ни при какой толщине и зазоре ──
for (const wallOut of [3.5, 2.75, 2.4, 2.0, 1.6, 1.2, 0.8]) {
  for (const clr of [0, 0.2, 0.5, 1]) {
    const c = mk({ wallOut, connClr: clr });
    const g = connOf(c);
    const holes = [4, 8, 14, 20, 26].filter((y) => !solidInZone(c, { N: { male: false, vs }, S: null, W: null, E: null }, y));
    ok(`стенка ${wallOut} зазор ${clr}: стенка цела`, holes.length === 0,
      ` (паз ${g.dg.toFixed(2)}, задний слой ${(wallOut - g.dg).toFixed(2)}, замок ${g.fits ? "есть" : "снят"})`);
  }
}

// ── за пазом всегда остаётся задний слой ──
{
  for (const wallOut of [3.5, 2.4, 1.6, 0.8]) {
    const g = connOf(mk({ wallOut }));
    ok(`стенка ${wallOut}: задний слой не меньше ${connOf(mk()).back}`, wallOut - g.dg >= g.back - 0.001 || !g.fits,
      ` (${(wallOut - g.dg).toFixed(2)})`);
  }
}

// ── слишком тонкая стенка: замка нет, но и зон в стенке нет ──
{
  const thin = mk({ wallOut: 1.2 });
  ok("на тонкой стенке замок снят", !connOf(thin).fits);
  const withConn = buildContainer(thin, { N: { male: false, vs }, S: null, W: null, E: null }, { fillets: false });
  // материал вдоль стенки должен идти одним куском, без вырезанных зон
  const runs = (s, y) => {
    const outer = -thin.D / 2;
    const at = (x) => s.some((b) => {
      const bb = bbox(b);
      return bb.lo[0] <= x && bb.hi[0] >= x && bb.lo[1] <= y && bb.hi[1] >= y
        && bb.lo[2] < outer + thin.wallOut && bb.hi[2] > outer;
    });
    let n = 0, prev = false;
    for (let x = -thin.W / 2 + 1; x < thin.W / 2 - 1; x += 0.5) {
      const cur = at(x);
      if (cur && !prev) n++;
      prev = cur;
    }
    return n;
  };
  ok("стенку не режет на куски", runs(withConn, 15) === 1, ` (кусков: ${runs(withConn, 15)})`);
  ok("тел соединителя нет", !withConn.some((b) => b.tag === "conn"));
}

// ── нормальная толщина: замок на месте ──
{
  const c = mk();
  ok("при штатной толщине замок ставится", connOf(c).fits && connOf(c).dg > MIN_DG);
  const s = buildContainer(c, { N: { male: false, vs }, S: null, W: null, E: null }, { fillets: false });
  ok("тела соединителя построены", s.some((b) => b.tag === "conn"));
}

// ── проект с тонкой стенкой чинится при открытии ──
{
  const p = normalizeProject({ containers: [{ wallOut: 1.2 }], connect: true, limits: { connClr: 0.2 } });
  ok("открытый проект подтянул толщину стенки", p.containers[0].wallOut >= connOf(mk()).minWall - 0.001,
    ` → ${p.containers[0].wallOut}`);
  const off = normalizeProject({ containers: [{ wallOut: 1.2 }], connect: false, limits: { connClr: 0.2 } });
  ok("без стыковки тонкая стенка сохраняется", off.containers[0].wallOut === 1.2);
}

console.log(fail === 0 ? "\nCONNECTOR FIT TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
