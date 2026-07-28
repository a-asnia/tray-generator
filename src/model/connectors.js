// ── «Ласточкин хвост» ЦЕЛИКОМ внутри толщины внешней стенки ──
// Паз не выступает ни внутрь ячейки, ни наружу; стенки соседей
// смыкаются вплотную. Требование: внешняя стенка ≥ minWall.

import { prismSolid, boxSolid } from "../geometry/solids.js";

export const CONN = { w1: 5.5, w2: 8.5, depth: 1.7, clr: 0.25, back: 0.85, stop: 3, flank: 2.5 };
CONN.dg = CONN.depth + CONN.clr;               // глубина паза
CONN.minWall = CONN.dg + CONN.back;            // 2.8 мм — минимум внешней стенки
CONN.bossW = CONN.w2 + 2 * CONN.clr + 2 * CONN.flank; // ширина зоны соединителя

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

// Соединительные узлы одной стороны. male: рельс, выступающий наружу и
// входящий в паз соседа. female: паз, вырезанный ВНУТРИ толщины внешней
// стенки (упор снизу + задний слой + две щёчки-ласточки). Внутренняя грань
// стенки не меняется — ячейки остаются ровно заданного размера, а наружные
// плоскости соседей смыкаются вплотную по всей длине.
export function addConnUnits(solids, c, side, vs) {
  const { W, D, H, wallOut } = c;
  const dg = CONN.dg;
  const axis = side === "E" || side === "W" ? "x" : "z";
  const s = side === "E" || side === "S" ? 1 : -1;
  const p = axis === "x" ? (s * W) / 2 : (s * D) / 2;
  const male = side === "E" || side === "S";
  const mk = (u, y, v) => (axis === "x" ? [u, y, v] : [v, y, u]);

  for (const vc of vs) {
    if (male) {
      const u0 = p - s * 0.6, u1 = p + s * CONN.depth;
      const q = (y) => [
        mk(u0, y, vc - CONN.w1 / 2), mk(u0, y, vc + CONN.w1 / 2),
        mk(u1, y, vc + CONN.w2 / 2), mk(u1, y, vc - CONN.w2 / 2),
      ];
      solids.push(prismSolid(q(CONN.stop + CONN.clr), q(H), "conn"));
    } else {
      const uAt = (t) => p - s * t; // t — глубина от наружной плоскости внутрь стенки
      const pushBox = (t0, t1, y0, y1, v0, v1) => {
        const cu = (uAt(t0) + uAt(t1)) / 2, su = Math.abs(t1 - t0);
        const cv = (v0 + v1) / 2, sv = v1 - v0;
        if (axis === "x") solids.push(boxSolid(cu, (y0 + y1) / 2, cv, su, y1 - y0, sv, "conn"));
        else solids.push(boxSolid(cv, (y0 + y1) / 2, cu, sv, y1 - y0, su, "conn"));
      };
      pushBox(0, wallOut, 0, CONN.stop, vc - CONN.bossW / 2, vc + CONN.bossW / 2); // упор снизу
      pushBox(dg, wallOut, CONN.stop, H, vc - CONN.bossW / 2, vc + CONN.bossW / 2); // задний слой (дно паза)
      const cw1 = CONN.w1 / 2 + CONN.clr, cw2 = CONN.w2 / 2 + CONN.clr;
      for (const sg of [-1, 1]) {
        const q = (y) => [
          mk(uAt(0), y, vc + (sg * CONN.bossW) / 2),
          mk(uAt(dg), y, vc + (sg * CONN.bossW) / 2),
          mk(uAt(dg), y, vc + sg * cw2),
          mk(uAt(0), y, vc + sg * cw1),
        ];
        solids.push(prismSolid(q(CONN.stop), q(H), "conn"));
      }
    }
  }
}
