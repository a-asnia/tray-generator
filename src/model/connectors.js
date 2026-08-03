// ── Соединители контейнеров. Всегда ЦЕЛИКОМ внутри толщины внешней
// стенки: ничего не выступает внутрь ячейки, стенки соседей смыкаются
// вплотную (у «выступов» наружу торчит только сам шип — он входит в
// карман соседа, и плоскости всё равно смыкаются).
//
// Два типа:
//  - "dove" — «ласточкин хвост»: рельс вдвигается в паз сверху, держит
//    контейнеры на отрыв. Разъём — только подъёмом.
//  - "pins" — «выступы» (как лего): шип на одной стороне входит в карман
//    другой при горизонтальном прижатии. Держит от сдвига вдоль стыка и
//    по вертикали, но не на отрыв: контейнеры ставятся вплотную и так же
//    легко разнимаются.

import { prismSolid, boxSolid, wallProfile } from "../geometry/solids.js";

// Зазор (clr) — на сторону, между рельсом/шипом и пазом/карманом.
// Рекомендации для FDM:
// 0.1 мм — press fit, детали приходится вдавливать (PLA, жёсткая посадка);
// 0.2 мм — плотно, но собирается руками (значение по умолчанию);
// 0.3–0.4 мм — свободное скольжение (PETG, крупные детали, усадка).
export const DEFAULT_CLR = 0.2;
export const DEFAULT_TYPE = "dove";
// Пресеты зазора «ласточкиного хвоста» — чтобы не подбирать вручную
export const CLR_PRESETS = [
  ["Плотно", 0.1],
  ["Стандарт", 0.2],
  ["Свободно", 0.35],
];
// top — насколько рельс не доходит до верхней кромки стенки: сверху
// остаётся ровная полоска, замок не выглядывает наружу и не цепляется
// при сборке. Паз при этом сквозной — иначе рельс не вдвинуть.
export const CONN = { w1: 5.5, w2: 8.5, depth: 1.7, clr: DEFAULT_CLR, back: 0.85, stop: 3, flank: 2.5, top: 2 };
// «Выступы»: шип — усечённая пирамида (скаты 45°, печатается на
// вертикальной стенке без поддержек), карман — прямой, шип самоцентрируется
export const PIN = { w: 10, h: 5, prot: 1.6, y0: 5 };

// Производные размеры зависят от зазора и типа, поэтому считаются функцией.
// limits.connClr — «Зазор соединителя», limits.connType — тип (вкладка «Принтер»).
export function connGeom(clr, type) {
  const g = { ...CONN, clr: clr ?? DEFAULT_CLR, type: type === "pins" ? "pins" : "dove" };
  if (g.type === "pins") {
    g.pin = { ...PIN };
    g.dg = g.pin.prot + 0.2; // глубина кармана
    g.bossW = g.pin.w + 2 * g.clr + 2 * g.flank; // ширина зоны соединителя
  } else {
    g.dg = g.depth + g.clr;                     // глубина паза
    g.bossW = g.w2 + 2 * g.clr + 2 * g.flank;   // ширина зоны соединителя
  }
  g.minWall = Math.round((g.dg + g.back) * 100) / 100; // минимум внешней стенки
  g.lockMin = Math.round(lockMinH(g) * 10) / 10; // минимальная высота стенки под замок
  return g;
}
// Геометрия замка для конкретного контейнера. Паз/карман живёт ВНУТРИ
// толщины внешней стенки, поэтому за ним обязан оставаться задний слой
// (back). Если стенка тоньше — глубина ужимается, а когда ужимать уже
// некуда, замок на этой стороне не ставится вовсе: лучше без замка, чем
// дыра в стенке (в такое состояние можно попасть, выключив стыковку,
// утоньшив стенку и включив обратно, или увеличив зазор, или открыв
// старый проект).
export const MIN_DG = 0.9; // мельче этого «ласточкин хвост» не держит
export const MIN_PROT = 0.8; // ниже этого шип ничего не центрирует
export const connOf = (c) => {
  const g = connGeom(c && c.connClr, c && c.connType);
  const wallOut = c && Number.isFinite(c.wallOut) ? c.wallOut : Infinity;
  const maxDg = wallOut - g.back;
  if (maxDg < g.dg) {
    g.dg = Math.max(0, maxDg);
    if (g.type === "pins") g.pin.prot = Math.max(0, g.dg - 0.2);
    else g.depth = Math.max(0, g.dg - g.clr);
  }
  g.fits = g.type === "pins" ? g.pin.prot >= MIN_PROT : g.dg >= MIN_DG;
  return g;
};
// Минимальная высота стенки, на которой замок имеет смысл: ниже неё зона
// не режется и замок не ставится — стенка остаётся целой.
export const lockMinH = (g) =>
  g.type === "pins" ? g.pin.y0 + g.pin.h + g.clr + 4 : g.stop + g.top + 5;
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
// dove male: рельс, выступающий наружу и входящий в паз соседа.
// dove female: паз ВНУТРИ толщины стенки (упор снизу + задний слой +
//   две щёчки-ласточки), сквозной сверху — иначе рельс не вдвинуть.
// pins male: шип-пирамидка на наружной плоскости.
// pins female: глухой карман в толщине стенки, открытый к соседу.
// Внутренняя грань стенки не меняется — ячейки остаются ровно заданного
// размера, а наружные плоскости соседей смыкаются вплотную по всей длине.
export function addConnUnits(solids, c, side, units) {
  const { W, D, H, wallOut } = c;
  const CONN = connOf(c); // зазор и тип берутся из настроек контейнера
  if (!CONN.fits) return; // стенка слишком тонкая — замок не ставим
  const dg = CONN.dg;
  const axis = side === "E" || side === "W" ? "x" : "z";
  const s = side === "E" || side === "S" ? 1 : -1;
  const p = axis === "x" ? (s * W) / 2 : (s * D) / 2;
  const male = side === "E" || side === "S";
  const mk = (u, y, v) => (axis === "x" ? [u, y, v] : [v, y, u]);
  // профиль стенки, выдавленный вдоль отрезка v0..v1 вглубь от наружной
  // плоскости; yFrom поднимает низ первой трапеции (стенка над карманом)
  const pushProfile = (parts, tBase, v0, v1, yFrom = 0) => {
    for (const [qi, quad] of parts.entries()) {
      const q = qi === 0 && yFrom > 0 ? quad.map(([o, y]) => [o, y === 0 ? yFrom : y]) : quad;
      const qa = q.map(([o, y]) => mk(p - s * (tBase + o), y, v0));
      const qb = q.map(([o, y]) => mk(p - s * (tBase + o), y, v1));
      solids.push(prismSolid(qa, qb, "conn"));
    }
  };
  const pushBox = (t0, t1, y0, y1, v0, v1) => {
    const cu = p - s * ((t0 + t1) / 2), su = Math.abs(t1 - t0);
    const cv = (v0 + v1) / 2, sv = v1 - v0;
    if (axis === "x") solids.push(boxSolid(cu, (y0 + y1) / 2, cv, su, y1 - y0, sv, "conn"));
    else solids.push(boxSolid(cv, (y0 + y1) / 2, cu, sv, y1 - y0, su, "conn"));
  };

  for (const { vc, h, rnd } of units) {
    const hz = Math.max(4, h); // высота стенки в зоне — замок следует ей
    if (CONN.type === "pins") {
      const { w, h: ph, prot, y0 } = CONN.pin;
      if (male) {
        // шип: усечённая пирамида от наружной плоскости наружу
        const base = (dv, dy) => [
          mk(p, y0 + dy, vc - w / 2 + dv), mk(p, y0 + dy, vc + w / 2 - dv),
          mk(p, y0 + ph - dy, vc + w / 2 - dv), mk(p, y0 + ph - dy, vc - w / 2 + dv),
        ];
        const qa = base(0, 0);
        const qb = base(prot, prot).map(([x, y, z]) => (axis === "x" ? [x + s * prot, y, z] : [x, y, z + s * prot]));
        solids.push(prismSolid(qa, qb, "conn"));
      } else {
        // карман: прямой, шип-пирамидка самоцентрируется при прижатии
        const pw2 = w / 2 + CONN.clr;
        const yPk0 = Math.max(0.4, y0 - CONN.clr), yPk1 = Math.min(hz - 1, y0 + ph + CONN.clr);
        const v0 = vc - CONN.bossW / 2, v1 = vc + CONN.bossW / 2;
        const parts = wallProfile(wallOut, hz, rnd, false);
        pushProfile(parts, 0, v0, vc - pw2);            // щёчки по бокам кармана
        pushProfile(parts, 0, vc + pw2, v1);
        pushBox(0, wallOut, 0, yPk0, vc - pw2, vc + pw2); // стенка под карманом
        pushProfile(parts, 0, vc - pw2, vc + pw2, yPk1);  // стенка над карманом
        pushBox(dg, wallOut, yPk0, yPk1, vc - pw2, vc + pw2); // задний слой (дно кармана)
      }
      continue;
    }
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
