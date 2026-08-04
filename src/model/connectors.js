// ── Соединитель контейнеров: «ласточкин хвост» ──
// Рельс вдвигается в паз соседа сверху и держит контейнеры на отрыв.
// Паз живёт ЦЕЛИКОМ внутри толщины внешней стенки: ничего не выступает
// внутрь ячейки, стенки соседей смыкаются вплотную (наружу торчит только
// рельс, входящий в паз соседа).

import { prismSolid, boxSolid, wallProfile } from "../geometry/solids.js";

// Зазор — на сторону, между рельсом и пазом. 0,35 мм выбран по итогам
// печатных тестов: вставляется без усилия и при этом не болтается.
export const DEFAULT_CLR = 0.35;
// top — насколько рельс не доходит до верхней кромки стенки: сверху
// остаётся ровная полоска, замок не выглядывает наружу и не цепляется
// при сборке. Паз при этом сквозной — иначе рельс не вдвинуть.
export const CONN = { w1: 5.5, w2: 8.5, depth: 1.7, clr: DEFAULT_CLR, back: 0.85, stop: 3, flank: 2.5, top: 2 };

// Производные размеры (зазор параметром — для проверок; приложение
// всегда использует DEFAULT_CLR)
export function connGeom(clr) {
  const g = { ...CONN, clr: clr ?? DEFAULT_CLR };
  g.dg = g.depth + g.clr;                     // глубина паза
  g.bossW = g.w2 + 2 * g.clr + 2 * g.flank;   // ширина зоны соединителя
  g.minWall = Math.round((g.dg + g.back) * 100) / 100; // минимум внешней стенки
  g.lockMin = Math.round(lockMinH(g) * 10) / 10; // минимальная высота стенки под замок
  return g;
}
// Геометрия замка для конкретного контейнера. За пазом обязан оставаться
// задний слой (back). Если стенка тоньше — паз ужимается, а когда ужимать
// уже некуда, замок на этой стороне не ставится вовсе: лучше без замка,
// чем дыра в стенке (в такое состояние можно попасть, выключив стыковку,
// утоньшив стенку и включив обратно, или открыв старый проект).
export const MIN_DG = 0.9; // мельче этого «ласточкин хвост» не держит
export const connOf = (c) => {
  const g = connGeom(c && c.connClr);
  const wallOut = c && Number.isFinite(c.wallOut) ? c.wallOut : Infinity;
  const maxDg = wallOut - g.back;
  if (maxDg < g.dg) {
    g.dg = Math.max(0, maxDg);
    g.depth = Math.max(0, g.dg - g.clr);
  }
  g.fits = g.dg >= MIN_DG;
  return g;
};
// Минимальная высота стенки, на которой замок имеет смысл: ниже неё зона
// не режется и замок не ставится — стенка остаётся целой.
export const lockMinH = (g) => g.stop + g.top + 5;
// значения по умолчанию (совместимость со старым кодом)
Object.assign(CONN, connGeom(DEFAULT_CLR));

export const connectorVs = (dim) => (dim < 90 ? [0] : [-dim / 4, dim / 4]);

export function splitRange(a, b, zones) {
  const out = [];
  let cur = a;
  for (const [z0, z1] of zones) {
    if (z1 <= a || z0 >= b) continue;
    if (z0 > cur) out.push([cur, Math.min(z0, b)]);
    cur = Math.max(cur, z1);
  }
  if (cur < b) out.push([cur, b]);
  return out.filter(([p, q]) => q - p > 0.05);
}

// Соединительные узлы одной стороны. units — по одному на замок:
// {vc — позиция вдоль стенки, h — высота стенки в этой зоне, rnd —
// скругление её кромки}. Замок следует высоте СВОЕЙ стенки: понизили
// стенку — паз, задний слой и рельс понизились вместе с ней.
//
// male: рельс, выступающий наружу и входящий в паз соседа.
// female: паз ВНУТРИ толщины стенки (упор снизу + задний слой + две
//   щёчки-ласточки), сквозной сверху — иначе рельс не вдвинуть.
// Внутренняя грань стенки не меняется — ячейки остаются ровно заданного
// размера, а наружные плоскости соседей смыкаются вплотную по всей длине.
export function addConnUnits(solids, c, side, units, ov) {
  const { W, D, H, wallOut } = c;
  const CONN = connOf(c);
  if (!CONN.fits) return; // стенка слишком тонкая — замок не ставим
  const dg = CONN.dg;
  const axis = side === "E" || side === "W" ? "x" : "z";
  const s = side === "E" || side === "S" ? 1 : -1;
  const p = axis === "x" ? (s * W) / 2 : (s * D) / 2;
  // male/female — из описания стороны; по умолчанию (как в раскладке
  // приложения) male смотрит на восток и юг
  const male = ov && ov.male !== undefined ? !!ov.male : side === "E" || side === "S";
  const mk = (u, y, v) => (axis === "x" ? [u, y, v] : [v, y, u]);
  const pushBox = (t0, t1, y0, y1, v0, v1) => {
    const cu = p - s * ((t0 + t1) / 2), su = Math.abs(t1 - t0);
    const cv = (v0 + v1) / 2, sv = v1 - v0;
    if (axis === "x") solids.push(boxSolid(cu, (y0 + y1) / 2, cv, su, y1 - y0, sv, "conn"));
    else solids.push(boxSolid(cv, (y0 + y1) / 2, cu, sv, y1 - y0, su, "conn"));
  };

  for (const { vc, h, rnd } of units) {
    const hz = Math.max(4, h); // высота стенки в зоне — замок следует ей
    if (male) {
      const u0 = p - s * 0.6, u1 = p + s * CONN.depth;
      const q = (y) => [
        mk(u0, y, vc - CONN.w1 / 2), mk(u0, y, vc + CONN.w1 / 2),
        mk(u1, y, vc + CONN.w2 / 2), mk(u1, y, vc - CONN.w2 / 2),
      ];
      // рельс заканчивается чуть ниже верхней кромки СВОЕЙ стенки
      const yTop = Math.max(CONN.stop + CONN.clr + 1, Math.min(hz, H) - CONN.top);
      solids.push(prismSolid(q(CONN.stop + CONN.clr), q(yTop), "conn"));
    } else {
      const v0 = vc - CONN.bossW / 2, v1 = vc + CONN.bossW / 2;
      pushBox(0, wallOut, 0, CONN.stop, v0, v1); // упор снизу
      // задний слой (дно паза) — профилем, чтобы верхняя кромка была
      // скруглена так же, как у остальной стенки этой зоны
      const parts = wallProfile(wallOut - dg, hz - CONN.stop, rnd, false);
      for (const quad of parts) {
        const qa = quad.map(([o, y]) => mk(p - s * (dg + o), CONN.stop + y, v0));
        const qb = quad.map(([o, y]) => mk(p - s * (dg + o), CONN.stop + y, v1));
        solids.push(prismSolid(qa, qb, "conn"));
      }
      const cw1 = CONN.w1 / 2 + CONN.clr, cw2 = CONN.w2 / 2 + CONN.clr;
      for (const sg of [-1, 1]) {
        const q = (y) => [
          mk(p, y, vc + (sg * CONN.bossW) / 2),
          mk(p - s * dg, y, vc + (sg * CONN.bossW) / 2),
          mk(p - s * dg, y, vc + sg * cw2),
          mk(p, y, vc + sg * cw1),
        ];
        solids.push(prismSolid(q(CONN.stop), q(hz), "conn"));
      }
    }
  }
}
