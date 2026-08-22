// ── Случайные сценарии раскладки ──
// Гоняем случайные последовательности операций (перенос, магниты, лимиты,
// пресеты, деление сетки) и после каждой проверяем инварианты: клетки не
// дублируются, габариты в пределах принтера, сборка внутри лимита стола,
// геометрия строится и не содержит мусорных координат.
// ГПСЧ детерминированный: упавший сценарий воспроизводится по номеру.
import { buildContainer } from "../src/model/build.js";
import { layout, remapCells } from "../src/model/layout.js";
import { moveContainer, fitAssembly, resizeBox, boxOf, overlaps, bounds } from "../src/model/laymove.js";
import { assemble } from "../src/model/assembly.js";
import { snapLayout } from "../src/model/laymagnet.js";
import { presetContainer, PRESETS, GORKA_DEF } from "../src/model/presets.js";
import { normalizeProject } from "../src/state/storage.js";

let fail = 0;
const bad = (n, extra = "") => { console.log(`FAIL ${n}${extra}`); fail++; };
const noConn = { N: null, S: null, W: null, E: null };
const LIM = { maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40 };

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

let nid = 1;
const mk = (r, px, pz) => ({
  id: nid++, px, pz,
  W: 40 + Math.round(r() * 130), D: 40 + Math.round(r() * 130), H: 15 + Math.round(r() * 100),
  cols: 1 + Math.floor(r() * 4), rows: 1 + Math.floor(r() * 4),
  gridMode: r() < 0.2 ? "size" : "count", cellWt: 20 + Math.round(r() * 30), cellDt: 20 + Math.round(r() * 30),
  wall: 1.2 + r() * 2, wallOut: 2.9 + r() * 2, floor: 1.2 + r() * 2,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [],
  lockOuter: r() < 0.1, lockCell: false,
});

const invariants = (label, cs, limits) => {
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++)
      if (overlaps(boxOf(cs[i]), boxOf(cs[j])))
        bad(`${label}: контейнеры пересеклись`, ` → №${i + 1} и №${j + 1}`);
  for (const c of cs) {
    if (!(c.W >= 29.9 && (c.lockOuter || c.W <= limits.maxW + 0.01))) bad(`${label}: ширина вне лимита`, ` → ${c.W}`);
    if (!(c.D >= 29.9 && (c.lockOuter || c.D <= limits.maxD + 0.01))) bad(`${label}: глубина вне лимита`, ` → ${c.D}`);
    if (!Number.isFinite(c.px) || !Number.isFinite(c.pz)) bad(`${label}: битая позиция`);
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
  // рамка жёсткая для всех, кто стоит внутри; не поместившиеся физически
  // паркуются ЦЕЛИКОМ снаружи (px за правым краем) — это допустимо
  const limW = limits.layW * 10, limD = limits.layD * 10;
  for (const c of cs) {
    if (c.lockOuter) continue;
    if (c.px >= limW - 0.05) continue; // припаркован за рамкой
    if (c.px + c.W > limW + 0.05 || c.pz + c.D > limD + 0.05 || c.px < -0.05 || c.pz < -0.05)
      bad(`${label}: контейнер торчит из рамки`, ` → ${c.px},${c.pz} ${c.W}×${c.D} при ${limW}×${limD}`);
  }
};

// сборка строится и соседи стыкуются без разъездов
const assembles = (label, cs) => {
  let a;
  try { a = assemble(cs, true); }
  catch (e) { bad(`${label}: сборка упала`, ` → ${e.message}`); return; }
  if (a.items.length !== cs.length) bad(`${label}: потеряны контейнеры при сборке`);
  for (const it of a.items) {
    if (!Number.isFinite(it.ox) || !Number.isFinite(it.oz)) bad(`${label}: битая позиция`);
    for (const side of ["N", "S", "W", "E"]) {
      const g = it.conn[side];
      if (g && !Array.isArray(g)) bad(`${label}: описание стороны не список`);
      if (g) for (const gr of g) if (!gr.vs.every(Number.isFinite)) bad(`${label}: битые позиции замков`);
    }
  }
};

const RUNS = 60;
for (let run = 0; run < RUNS; run++) {
  const r = rng(run * 7919 + 13);
  const n = 1 + Math.floor(r() * 5);
  let cs = [];
  for (let k = 0; k < n; k++) cs.push(mk(r, (k % 3) * 171, Math.floor(k / 3) * 171));
  cs = fitAssembly(cs, LIM) || cs;
  let limits = { ...LIM, layW: 20 + Math.round(r() * 30), layD: 20 + Math.round(r() * 30) };
  const label = `сценарий ${run}`;

  for (let step = 0; step < 8; step++) {
    const op = Math.floor(r() * 7);
    if (op === 0) {
      const i = Math.floor(r() * cs.length);
      cs = moveContainer(cs, i, r() * 500, r() * 500, limits);
    } else if (op === 1) {
      cs = fitAssembly(cs, limits) || cs;
    } else if (op === 2) {
      cs = snapLayout(cs, limits) || cs;
    } else if (op === 3) {
      const i = Math.floor(r() * cs.length);
      const kind = PRESETS[Math.floor(r() * PRESETS.length)][0];
      cs = cs.map((c, k) => (k === i ? presetContainer(c, kind, limits, GORKA_DEF) : c));
    } else if (op === 6) { // изменение размера с приклейкой
      const i = Math.floor(r() * cs.length);
      cs = resizeBox(cs, i, { W: 40 + Math.round(r() * 130) }, limits, r() < 0.5);
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
  assembles(label, cs);

  // и пережить сохранение-загрузку проекта
  const proj = normalizeProject(JSON.parse(JSON.stringify({ containers: cs, limits })));
  if (!proj || proj.containers.length !== cs.length) bad(`${label}: проект не пережил сохранение`);
  else invariants(`${label}/после загрузки`, proj.containers, proj.limits || limits);
}

console.log(fail === 0 ? `FUZZ OK (${RUNS} сценариев × 8 шагов)` : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
