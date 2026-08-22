// ── Сборка: кто с кем стыкуется и где стоят замки ──
// Раскладка свободная (см. laymove.js): соседи — это контейнеры, чьи
// грани фактически соприкасаются, и касаться могут любым перехлёстом
// (над одним широким может стоять два узких). Замки ставятся по
// фактическому перехлёсту пары и только там, где зона годится обоим
// (низкая или ступенчатая стенка — замка нет ни у кого, иначе рельс
// упёрся бы в сплошную стенку соседа).

import { boxOf, bounds, normPositions } from "./laymove.js";
import { connectorVs } from "./connectors.js";
import { lockOk } from "./build.js";

// Кто в паре несёт рельс (наружный выступ), а кто паз. По умолчанию —
// западный/северный. Горка всегда несёт рельс: паз в её ступенчатых
// стенках не помещается, а рельс встаёт на ровный участок лесенки.
export const railCarrier = (a, b) => {
  const aS = a.preset === "stairs", bS = b.preset === "stairs";
  return aS === bS ? true : aS;
};

const TOUCH = 0.06;   // насколько точно грани должны совпасть
const MIN_JOINT = 30; // короче этого перехлёста замок не ставится

// Позиции замков на стыке двух контейнеров: считаются в абсолютной
// координате вдоль стыка, затем переводятся в систему каждого.
const jointVs = (A, B, sideA, sideB, a, b) => {
  const mid = (a + b) / 2;
  const centerA = sideA === "E" || sideA === "W" ? A.oz : A.ox;
  const centerB = sideB === "E" || sideB === "W" ? B.oz : B.ox;
  return connectorVs(b - a)
    .map((v) => v + mid)
    .filter((abs) => lockOk(A.c, sideA, abs - centerA) && lockOk(B.c, sideB, abs - centerB))
    .map((abs) => ({ a: abs - centerA, b: abs - centerB }));
};

// Полная сборка: позиции (по центру стола) и соединители по касаниям.
export function assemble(containers, connect = true) {
  const cs = normPositions(containers);
  const { w: totalW, d: totalD } = bounds(cs);
  const items = cs.map((c, i) => ({
    c: containers[i],
    ox: c.px + c.W / 2 - totalW / 2,
    oz: c.pz + c.D / 2 - totalD / 2,
    conn: { N: [], S: [], W: [], E: [] },
  }));
  if (connect)
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) {
        const A = items[i], B = items[j];
        const a = boxOf(cs[i]), b = boxOf(cs[j]);
        const zA = Math.max(a.z0, b.z0), zB = Math.min(a.z1, b.z1);
        const xA = Math.max(a.x0, b.x0), xB = Math.min(a.x1, b.x1);
        const pair = (sideA, sideB, lo, hi) => {
          // от абсолютных координат стола к координатам сборки (центр в нуле)
          const off = sideA === "E" || sideA === "W" ? -totalD / 2 : -totalW / 2;
          const male = sideA === "E" || sideA === "S"
            ? railCarrier(cs[i], cs[j])
            : !railCarrier(cs[j], cs[i]);
          const vs = jointVs(A, B, sideA, sideB, lo + off, hi + off);
          if (!vs.length) return;
          A.conn[sideA].push({ male, vs: vs.map((v) => v.a) });
          B.conn[sideB].push({ male: !male, vs: vs.map((v) => v.b) });
        };
        if (zB - zA >= MIN_JOINT) {
          if (Math.abs(a.x1 - b.x0) < TOUCH) pair("E", "W", zA, zB);
          else if (Math.abs(b.x1 - a.x0) < TOUCH) pair("W", "E", zA, zB);
        }
        if (xB - xA >= MIN_JOINT) {
          if (Math.abs(a.z1 - b.z0) < TOUCH) pair("S", "N", xA, xB);
          else if (Math.abs(b.z1 - a.z0) < TOUCH) pair("N", "S", xA, xB);
        }
      }
  for (const it of items)
    for (const side of ["N", "S", "W", "E"])
      if (!it.conn[side].length) it.conn[side] = null;
  return { items, totalW, totalD };
}
