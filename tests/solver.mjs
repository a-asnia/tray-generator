// Решатель размеров: «эта ячейка всегда такая» (fix), доли при делении
// остатка (share), минимумы и честный ответ «не сходится».
import { solveSizes, MIN_CELL } from "../src/model/solver.js";
import { layout, layoutIssues, fitSizes } from "../src/model/layout.js";

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;
const sum = (a) => a.reduce((s, v) => s + v, 0);

// ── базовые случаи ──
{
  const r = solveSizes([{ size: 40 }, { size: 40 }], 100);
  ok("свободные делят пролёт по своим размерам", near(r.sizes[0], 50) && near(r.sizes[1], 50) && r.ok);
}
{
  const r = solveSizes([{ fix: 60 }, { size: 40 }, { size: 40 }], 120);
  ok("«всегда такая» держит 60, остальные делят 60", near(r.sizes[0], 60) && near(r.sizes[1], 30) && near(r.sizes[2], 30) && r.ok);
}
{
  const r = solveSizes([{ share: 2 }, { share: 1 }], 90);
  ok("доля 2:1 → 60 и 30", near(r.sizes[0], 60) && near(r.sizes[1], 30));
}
{
  const r = solveSizes([{ fix: 50 }, { share: 3 }, { share: 1 }], 130);
  ok("fix + доли вместе", near(r.sizes[0], 50) && near(r.sizes[1], 60) && near(r.sizes[2], 20));
}
{
  const r = solveSizes([{ size: 90 }, { size: 10 }], 40);
  ok("минимум закрепляется, остаток другому", near(r.sizes[1], MIN_CELL) && near(r.sizes[0], 40 - MIN_CELL) && r.ok,
    ` → ${r.sizes.map((v) => v.toFixed(1))}`);
}
{
  const r = solveSizes([], 100);
  ok("пустой список", r.ok && r.sizes.length === 0);
}
{
  const r = solveSizes([{ fix: 40 }, { fix: 60 }], 100);
  ok("все зафиксированы и сходится", r.ok && near(r.sizes[0], 40) && near(r.sizes[1], 60));
}

// ── честный «не сходится» ──
{
  const r = solveSizes([{ fix: 80 }, { fix: 50 }], 100);
  ok("все зафиксированы, не сходится: ok=false", !r.ok && r.shortfall > 0, ` (не хватает ${r.shortfall})`);
  ok("геометрия при этом согласована (сумма = пролёту)", near(sum(r.sizes), 100));
}
{
  const r = solveSizes([{ fix: 95 }, { size: 40 }], 60);
  ok("fix больше пролёта: ok=false и точный дефицит", !r.ok && near(r.shortfall, 95 + MIN_CELL - 60),
    ` (не хватает ${r.shortfall})`);
  ok("сумма всё равно равна пролёту", near(sum(r.sizes), 60));
}
{
  const r = solveSizes([{ size: 10 }, { size: 10 }, { size: 10 }], 9);
  ok("минимумы не помещаются: ok=false", !r.ok && r.shortfall > 0);
}

// ── совместимость fitSizes ──
{
  const f = fitSizes([40, 40, 40], { 1: true }, 100);
  ok("fitSizes: замкнутый 40, свободные делят 60", near(f[1], 40) && near(f[0] + f[2], 60));
  const g = fitSizes([30, 30], {}, 100, { 0: 3, 1: 1 });
  ok("fitSizes с долями 3:1", near(g[0], 75) && near(g[1], 25));
}

// ── интеграция с раскладкой ──
const base = {
  W: 100, D: 100, H: 30, cols: 3, rows: 1, gridMode: "count",
  wall: 1.6, wallOut: 3, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, fixedCells: [],
};
{
  const c = { ...base, cellShares: { "0:0": 2 } };
  const L = layout(c);
  ok("доля в раскладке: первая вдвое шире", near(L.cw(0, 0), 2 * L.cw(1, 0), 0.05),
    ` → ${L.cw(0, 0).toFixed(1)} и ${L.cw(1, 0).toFixed(1)}`);
  ok("конфликтов нет", layoutIssues(c).length === 0);
}
{
  // зафиксированная ячейка шире, чем есть места — решатель сообщает
  const c = { ...base, rowColWs: { 0: [86, 30, 30] }, lockedCellW: { "0:0": true } };
  const issues = layoutIssues(c);
  ok("конфликт обнаружен", issues.length === 1 && issues[0].axis === "w", issues[0] ? ` → ${issues[0].text}` : "");
  const L = layout(c);
  ok("геометрия остаётся согласованной", near(L.cw(0, 0) + L.cw(1, 0) + L.cw(2, 0), c.W - 2 * c.wallOut - 2 * c.wall));
}
{
  // конфликт по глубине
  const c = { ...base, rows: 2, rowDs: [80, 80], lockedRows: { 0: true, 1: true } };
  const issues = layoutIssues(c);
  ok("конфликт по глубине обнаружен", issues.some((i) => i.axis === "d"));
}

console.log(fail === 0 ? "\nSOLVER TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
