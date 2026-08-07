// ── Случайные сценарии раскладки ──
// Гоняем случайные последовательности операций (перенос, магниты, лимиты,
// пресеты, деление сетки) и после каждой проверяем инварианты: клетки не
// дублируются, габариты в пределах принтера, сборка внутри лимита стола,
// геометрия строится и не содержит мусорных координат.
// ГПСЧ детерминированный: упавший сценарий воспроизводится по номеру.
import { buildContainer } from "../src/model/build.js";
import { layout, remapCells } from "../src/model/layout.js";
import { moveContainer, fitAssembly, gridDims } from "../src/model/laymove.js";
import { snapLayout } from "../src/model/laymagnet.js";
import { presetContainer, PRESETS, GORKA_DEF } from "../src/model/presets.js";
import { normalizeProject } from "../src/state/storage.js";

let fail = 0;
const bad = (n, extra = "") => { console.log(`FAIL ${n}${extra}`); fail++; };
const noConn = { N: null, S: null, W: null, E: null };
const LIM = { maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40 };

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const mk = (r, gx, gy) => ({
  id: gx * 10 + gy + 1, gx, gy,
  W: 40 + Math.round(r() * 130), D: 40 + Math.round(r() * 130), H: 15 + Math.round(r() * 100),
  cols: 1 + Math.floor(r() * 4), rows: 1 + Math.floor(r() * 4),
  gridMode: r() < 0.2 ? "size" : "count", cellWt: 20 + Math.round(r() * 30), cellDt: 20 + Math.round(r() * 30),
  wall: 1.2 + r() * 2, wallOut: 2.9 + r() * 2, floor: 1.2 + r() * 2,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [],
  lockOuter: r() < 0.1, lockCell: false,
});

const invariants = (label, cs, limits) => {
  const seen = new Set();
  for (const c of cs) {
    const k = `${c.gx},${c.gy}`;
    if (seen.has(k)) bad(`${label}: две коробки в одной клетке ${k}`);
    seen.add(k);
    if (!(c.W >= 29.9 && c.W <= limits.maxW + 0.01)) bad(`${label}: ширина вне лимита`, ` → ${c.W}`);
    if (!(c.D >= 29.9 && c.D <= limits.maxD + 0.01)) bad(`${label}: глубина вне лимита`, ` → ${c.D}`);
    if (!Number.isFinite(c.gx) || !Number.isFinite(c.gy)) bad(`${label}: битые координаты клетки`);
    const L = layout(c);
    const sumW = L.rowCols[0].reduce((s, v) => s + v, 0) + (L.rowCols[0].length - 1) * c.wall + 2 * c.wallOut;
    if (Math.abs(sumW - c.W) > 0.5) bad(`${label}: ряд не сходится с шириной`, ` → ${sumW.toFixed(2)} против ${c.W}`);
    if (L.rowDs.some((v) => v < 4.9)) bad(`${label}: ряд тоньше минимума`, ` → ${L.rowDs.join()}`);
  }
};

const geometryOk = (label, cs) => {
  for (const c of cs) {
    let solids;
    try { solids = buildContainer(c, noConn); }
    catch (e) { bad(`${label}: построение упало`, ` → ${e.message}`); return; }
    if (!solids.length) { bad(`${label}: пустая геометрия`); return; }
    let lo = Infinity;
    for (const s of solids) for (const t of s.tris) for (const p of t) {
      if (!p.every(Number.isFinite)) { bad(`${label}: NaN в координатах`); return; }
      if (p[1] < lo) lo = p[1];
    }
    if (lo < -0.01) bad(`${label}: геометрия ниже стола`, ` → ${lo}`);
  }
};

const fits = (label, cs, limits) => {
  const { colW, rowD } = gridDims(cs);
  const sw = Object.values(colW).reduce((s, v) => s + v, 0);
  const sd = Object.values(rowD).reduce((s, v) => s + v, 0);
  // колонка с замком габарита не ужимается — ниже этой суммы не опуститься
  const froz = (key, dim, map) => Object.keys(map).reduce((s, g) =>
    s + (cs.some((c) => String(c[key]) === g && c.lockOuter) ? map[g] : 30), 0);
  const minW = froz("gx", "W", colW), minD = froz("gy", "D", rowD);
  if (sw > limits.layW * 10 + 0.05 && sw > minW + 0.05) bad(`${label}: сборка шире лимита`, ` → ${sw} > ${limits.layW * 10}`);
  if (sd > limits.layD * 10 + 0.05 && sd > minD + 0.05) bad(`${label}: сборка глубже лимита`, ` → ${sd} > ${limits.layD * 10}`);
};

const RUNS = 60;
for (let run = 0; run < RUNS; run++) {
  const r = rng(run * 7919 + 13);
  const n = 1 + Math.floor(r() * 5);
  let cs = [];
  for (let k = 0; k < n; k++) cs.push(mk(r, k % 3, Math.floor(k / 3)));
  let limits = { ...LIM, layW: 20 + Math.round(r() * 30), layD: 20 + Math.round(r() * 30) };
  const label = `сценарий ${run}`;

  for (let step = 0; step < 8; step++) {
    const op = Math.floor(r() * 6);
    if (op === 0) {
      const i = Math.floor(r() * cs.length);
      cs = moveContainer(cs, i, Math.floor(r() * 4) - 1, Math.floor(r() * 3) - 1);
    } else if (op === 1) {
      cs = fitAssembly(cs, limits) || cs;
    } else if (op === 2) {
      cs = snapLayout(cs, limits) || cs;
    } else if (op === 3) {
      const i = Math.floor(r() * cs.length);
      const kind = PRESETS[Math.floor(r() * PRESETS.length)][0];
      cs = cs.map((c, k) => (k === i ? presetContainer(c, kind, limits, GORKA_DEF) : c));
    } else if (op === 4) {
      const i = Math.floor(r() * cs.length);
      cs = cs.map((c, k) => {
        if (k !== i) return c;
        const next = { ...c, cols: 1 + Math.floor(r() * 5), rows: 1 + Math.floor(r() * 4) };
        return { ...next, cells: remapCells(c, next) };
      });
    } else {
      limits = { ...limits, layW: 12 + Math.round(r() * 30), layD: 12 + Math.round(r() * 30) };
      cs = fitAssembly(cs, limits) || cs;
    }
    invariants(`${label}/${step}`, cs, limits);
  }
  // сборка обязана влезать в лимит после нормализации
  cs = fitAssembly(cs, limits) || cs;
  fits(label, cs, limits);
  geometryOk(label, cs);

  // и пережить сохранение-загрузку проекта
  const proj = normalizeProject(JSON.parse(JSON.stringify({ containers: cs, limits })));
  if (!proj || proj.containers.length !== cs.length) bad(`${label}: проект не пережил сохранение`);
  else invariants(`${label}/после загрузки`, proj.containers, proj.limits || limits);
}

console.log(fail === 0 ? `FUZZ OK (${RUNS} сценариев × 8 шагов)` : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
