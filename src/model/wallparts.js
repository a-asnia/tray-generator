// ══════════════════════════════════════════════════════════════
// Вставные стенки контейнера — как у жестяной коробочки со сдвижной
// крышкой: в основании по линии стенки идёт канавка (наружная губка,
// паз, внутренняя губка), стенка печатается отдельной плоской деталью и
// вставляется в эту канавку.
//
//   разрез поперёк стенки
//        ▓ стенка ▓
//    ┌──┬─────────┬──┐
//    │  │  паз    │  │  ← губки основания, высота «посадка»
//    └──┴─────────┴──┘
//    ══════════════════ дно
//
// Каждая из четырёх стенок включается отдельно. Стенка утоплена от
// наружной плоскости на толщину наружной губки — на этой стороне
// контейнеры уже не сомкнутся вплотную, поэтому замок соединителя там
// не ставится (об этом предупреждает панель).
// ══════════════════════════════════════════════════════════════

export const SIDES = ["n", "s", "w", "e"];
export const SIDE_NAME = { n: "Задняя", s: "Передняя", w: "Левая", e: "Правая" };

export const DEF_WPARTS = {
  n: false, s: false, w: false, e: false,
  thk: 1.6,   // толщина вставной стенки
  clr: 0.2,   // зазор на сторону между стенкой и пазом
  lip: 1.0,   // наружная губка канавки
  seat: 6,    // высота губок над дном — насколько глубоко сидит стенка
};
export const wpartsOf = (c) => ({ ...DEF_WPARTS, ...(c && c.wparts) });
export const wpAny = (c) => SIDES.some((s) => wpartsOf(c)[s]);

// Минимальная внешняя стенка: наружная губка + паз + внутренняя губка
export const wpMinWall = (w) => Math.round((w.lip + w.thk + 2 * w.clr + 1) * 100) / 100;

export function wpGeom(c) {
  const w = wpartsOf(c);
  const cw = w.thk + 2 * w.clr;        // ширина паза
  return { ...w, cw, minWall: wpMinWall(w) };
}

// Сторона включена и соединение помещается в толщину стенки
export function wpOn(c, side) {
  const g = wpGeom(c);
  return !!g[side] && c.wallOut >= g.minWall - 0.001 && c.H > g.seat + 2;
}
export const wpActive = (c) => SIDES.some((s) => wpOn(c, s));

// Пролёт детали вдоль своей стенки. Стенки N/S идут до углов, W/E
// встают между ними — так угол закрыт при любом наборе включённых стенок.
export function wpSpan(c, side) {
  const g = wpGeom(c);
  const along = side === "n" || side === "s";
  const dim = along ? c.W : c.D;
  const endFor = (perp) => {
    if (!wpOn(c, perp)) return c.wallOut + g.clr;         // печатная стенка занимает угол
    return along ? g.lip + g.clr : g.lip + g.cw + g.clr;  // за губкой (и за стенкой N/S)
  };
  const a = endFor(along ? "w" : "n"), b = endFor(along ? "e" : "s");
  return [-dim / 2 + a, dim / 2 - b];
}

// Пролёт канавки в основании — на зазор шире детали с каждой стороны
export function wpSlotSpan(c, side) {
  const [a, b] = wpSpan(c, side);
  const g = wpGeom(c);
  return [a - g.clr, b + g.clr];
}

export function wpSize(c, side) {
  const [a, b] = wpSpan(c, side);
  const g = wpGeom(c);
  const key = `o:${side}:0`;
  const h = (c.walls && c.walls[key] && c.walls[key].h) || c.H;
  return {
    len: Math.round((b - a) * 10) / 10,
    hgt: Math.round((Math.min(h, c.H) - c.floor) * 10) / 10,
    thk: g.thk,
  };
}

// Деталь плашмя для печати: толщина вертикально, высота стенки ложится
// в плоскость стола — печатается со стола без поддержек.
export function wpFlatten(solids, side, c) {
  const g = wpGeom(c);
  const along = side === "n" || side === "s";
  const outer = side === "n" ? -c.D / 2 : side === "s" ? c.D / 2 : side === "w" ? -c.W / 2 : c.W / 2;
  const sgn = side === "n" || side === "w" ? 1 : -1;
  // деталь стоит в контейнере утопленной на губку с зазором — при раскладке
  // этот отступ снимается, иначе деталь висела бы над столом
  const inset = g.lip + g.clr;
  return solids.map((b) => ({
    tag: b.tag,
    tris: b.tris.map((t) =>
      t.map(([x, y, z]) => [along ? x : z, sgn * ((along ? z : x) - outer) - inset, y - c.floor])
    ),
  }));
}
