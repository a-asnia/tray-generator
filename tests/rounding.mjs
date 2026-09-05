// Скругление верхних кромок по умолчанию: у стенки БЕЗ замка кромка
// скруглена с обеих сторон, у стенки С замком — только внутри, наружная
// плоскость остаётся строго ровной (инвариант стыковки и пазов).
import { buildContainer } from "../src/model/build.js";
import { getWall, DEFAULT_RND } from "../src/model/layout.js";
import { connectorVs } from "../src/model/connectors.js";

const base = {
  W: 120, D: 100, H: 30, cols: 2, rows: 2, gridMode: "count",
  cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 3, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null, lockedCellW: {}, lockedRows: {}, fixedCells: [],
};
const noConn = { N: null, S: null, W: null, E: null };

let fail = 0;
const ok = (n, c) => { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; };
const near = (a, b, e = 0.02) => Math.abs(a - b) < e;

ok(`скругление включено по умолчанию (${DEFAULT_RND} мм)`, DEFAULT_RND > 0.1 && getWall(base, "o:n:0").rnd === DEFAULT_RND);
ok("у перегородок тоже", getWall(base, "v:0:0").rnd === DEFAULT_RND);

// у стенки: смотрим ширину тела у самого верха (кромка) и у середины
const wallSpanAtTop = (c, conn, tag, axis) => {
  const s = buildContainer(c, conn, { fillets: false }).filter((x) => x.tag === tag);
  const at = (yLo, yHi) => {
    let lo = 1e9, hi = -1e9;
    for (const b of s) for (const t of b.tris) for (const p of t)
      if (p[1] > yLo && p[1] < yHi) { lo = Math.min(lo, p[axis]); hi = Math.max(hi, p[axis]); }
    return { lo, hi };
  };
  return { top: at(c.H - 0.05, c.H + 0.05), mid: at(-0.05, 0.05) }; // mid = у дна, там полная толщина
};

// ── северная стенка БЕЗ замка: сужается с обеих сторон
{
  const r = wallSpanAtTop(base, noConn, "o:n:0", 2);
  const outer = -base.D / 2;
  ok(`без замка: наружная кромка отошла внутрь (${r.top.lo.toFixed(2)} > ${outer})`, r.top.lo > outer + 0.2);
  ok(`без замка: внутренняя кромка тоже скруглена (${r.top.hi.toFixed(2)} < ${r.mid.hi.toFixed(2)})`, r.top.hi < r.mid.hi - 0.2);
  ok(`без замка: тело стенки в габарите (${r.mid.lo.toFixed(2)} = ${outer})`, near(r.mid.lo, outer));
}

// ── северная стенка С замком: наружная плоскость строго ровная
{
  const conn = { ...noConn, N: { male: false, vs: connectorVs(base.W) } };
  const r = wallSpanAtTop(base, conn, "o:n:0", 2);
  const outer = -base.D / 2;
  ok(`с замком: наружная плоскость ровная до верха (${r.top.lo.toFixed(2)} = ${outer})`, near(r.top.lo, outer));
  ok(`с замком: внутренняя кромка скруглена (${r.top.hi.toFixed(2)} < ${r.mid.hi.toFixed(2)})`, r.top.hi < r.mid.hi - 0.2);
}

// ── то же для восточной стенки (ось X) с male-замком
{
  const conn = { ...noConn, E: { male: true, vs: connectorVs(base.D) } };
  const r = wallSpanAtTop(base, conn, "o:e:0", 0);
  ok(`восточная с замком: наружная плоскость ровная (${r.top.hi.toFixed(2)} = ${base.W / 2})`, near(r.top.hi, base.W / 2));
  const r2 = wallSpanAtTop(base, noConn, "o:e:0", 0);
  ok(`восточная без замка: кромка отошла (${r2.top.hi.toFixed(2)} < ${base.W / 2})`, r2.top.hi < base.W / 2 - 0.2);
}

// ── перегородки скруглены с двух сторон, дно не изменилось
{
  const s = buildContainer(base, noConn, { fillets: false }).filter((x) => x.tag === "v:0:0");
  let topLo = 1e9, topHi = -1e9, botLo = 1e9, botHi = -1e9;
  for (const b of s) for (const t of b.tris) for (const p of t) {
    if (p[1] > base.H - 0.05) { topLo = Math.min(topLo, p[0]); topHi = Math.max(topHi, p[0]); }
    if (p[1] < 0.05) { botLo = Math.min(botLo, p[0]); botHi = Math.max(botHi, p[0]); }
  }
  ok(`перегородка: верх уже низа (${(topHi - topLo).toFixed(2)} < ${(botHi - botLo).toFixed(2)})`, topHi - topLo < botHi - botLo - 0.3);
  ok(`толщина перегородки у дна = ${base.wall}`, near(botHi - botLo, base.wall));
}

// ── ручное отключение скругления работает
{
  const c = { ...base, walls: { "o:n:0": { h: 30, rnd: 0 } } };
  const r = wallSpanAtTop(c, noConn, "o:n:0", 2);
  ok(`rnd=0 — кромка острая (${(r.top.hi - r.top.lo).toFixed(2)} = ${base.wallOut})`, near(r.top.hi - r.top.lo, base.wallOut));
}

console.log(fail === 0 ? "\nROUNDING TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
