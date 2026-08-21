// ── Сборка: кто с кем стыкуется и где стоят замки ──
// Раскладка — ряды со свободными ширинами (см. laymove.js), поэтому
// сосед сверху или снизу может быть не один, а стыковаться лишь частью
// стенки. Замки ставятся по ФАКТИЧЕСКОМУ перехлёсту двух контейнеров и
// только там, где зона годится обоим (низкая или ступенчатая стенка —
// замка нет ни у кого, иначе рельс упрётся в сплошную стенку соседа).

import { placeContainers, neighborsOf } from "./laymove.js";
import { connectorVs } from "./connectors.js";
import { lockOk } from "./build.js";

// Кто в паре несёт рельс (наружный выступ), а кто паз. По умолчанию —
// западный/северный. Горка всегда несёт рельс: паз в её ступенчатых
// стенках не помещается, а рельс встаёт на ровный участок лесенки.
export const railCarrier = (a, b) => {
  const aS = a.preset === "stairs", bS = b.preset === "stairs";
  return aS === bS ? true : aS;
};

// Позиции замков на стыке двух контейнеров. Считаются в АБСОЛЮТНЫХ
// координатах по перехлёсту, затем переводятся в систему каждого из них.
const jointVs = (A, B, sideA, sideB, a, b) => {
  const mid = (a + b) / 2;
  const centerA = sideA === "E" || sideA === "W" ? A.oz : A.ox;
  const centerB = sideB === "E" || sideB === "W" ? B.oz : B.ox;
  return connectorVs(b - a)
    .map((v) => v + mid)
    .filter((abs) => lockOk(A.c, sideA, abs - centerA) && lockOk(B.c, sideB, abs - centerB))
    .map((abs) => ({ a: abs - centerA, b: abs - centerB }));
};

// Полная сборка: позиции и описания соединителей для каждого контейнера.
export function assemble(containers, connect = true) {
  const placed = placeContainers(containers);
  const conns = placed.items.map(() => ({ N: [], S: [], W: [], E: [] }));
  if (connect)
    placed.items.forEach((me, i) => {
      const nb = neighborsOf(placed, i);
      // вдоль ряда стыкуются целиком: перехлёст — общая глубина ряда
      for (const [side, other, oside] of [["E", nb.E, "W"], ["W", nb.W, "E"]]) {
        for (const { item, k } of other) {
          if (k < i && side === "W") continue; // пару считаем один раз
          const a = Math.max(me.oz - me.c.D / 2, item.oz - item.c.D / 2);
          const b = Math.min(me.oz + me.c.D / 2, item.oz + item.c.D / 2);
          if (b - a < 0.5) continue;
          const male = side === "E" ? railCarrier(me.c, item.c) : !railCarrier(item.c, me.c);
          const vs = jointVs(me, item, side, oside, a, b);
          if (!vs.length) continue;
          conns[i][side].push({ male, vs: vs.map((v) => v.a) });
          conns[k][oside].push({ male: !male, vs: vs.map((v) => v.b) });
        }
      }
      // между рядами: сосед может накрывать лишь часть стенки, и соседей
      // на одной стороне бывает несколько
      for (const { item, k, a, b } of nb.S) {
        const male = railCarrier(me.c, item.c);
        const vs = jointVs(me, item, "S", "N", a, b);
        if (!vs.length) continue;
        conns[i].S.push({ male, vs: vs.map((v) => v.a) });
        conns[k].N.push({ male: !male, vs: vs.map((v) => v.b) });
      }
    });
  const items = placed.items.map((it, i) => ({
    c: it.c,
    ox: it.ox,
    oz: it.oz,
    conn: {
      N: conns[i].N.length ? conns[i].N : null,
      S: conns[i].S.length ? conns[i].S : null,
      W: conns[i].W.length ? conns[i].W : null,
      E: conns[i].E.length ? conns[i].E : null,
    },
  }));
  return { items, totalW: placed.totalW, totalD: placed.totalD, rows: placed.rows };
}
