// ── «Магнит раскладки» ──
// При включённой галке сборка липнет к краям лимита: узкая щель между
// контейнером и краем (или соседом), куда ничего не поставить, закрывается
// растяжкой самого контейнера (в пределах лимита принтера), а свободное
// место побольше (от 30 мм) заполняется новыми контейнерами — каждый
// встаёт в самый большой свободный прямоугольник. Контейнеры с замками не
// растягиваются. Возвращает новый список либо null (идемпотентно).

import { makeContainer } from "../state/storage.js";
import { boxOf, overlaps, freeRects, autoSpot, MIN_BOX } from "./laymove.js";

const lgR1 = (v) => Math.round(v * 10) / 10; // имя уникально: сборка склеивает модули в один скрипт

export function snapLayout(containers, limits) {
  if (!containers || !containers.length || !limits) return null;
  let cs = containers.map((c) => ({ ...c }));
  let changed = false;

  for (let pass = 0; pass < 12; pass++) {
    let step = false;

    // 1. узкие щели (< 30 мм): растяжка контейнера, к чьей грани щель
    //    примыкает — правее или дальше него пусто до края щели
    const stripFree = (x0, x1, z0, z1, skip) =>
      x1 - x0 > 0.05 && z1 - z0 > 0.05 &&
      !cs.some((c, k) => k !== skip && overlaps({ x0, x1, z0, z1 }, boxOf(c)));
    const limW = (limits.layW || 0) * 10, limD = (limits.layD || 0) * 10;
    for (let k = 0; k < cs.length && !step; k++) {
      const c = cs[k];
      if (c.lockOuter || c.lockCell) continue;
      const b = boxOf(c);
      // до правого края рамки
      if (limW > 0) {
        const gap = lgR1(limW - b.x1);
        if (gap > 0.05 && gap < MIN_BOX && c.W + gap <= limits.maxW + 0.01 &&
            stripFree(b.x1, limW, b.z0, b.z1, k)) {
          c.W = lgR1(c.W + gap); step = true; continue;
        }
      }
      // до дальнего края рамки
      if (limD > 0) {
        const gap = lgR1(limD - b.z1);
        if (gap > 0.05 && gap < MIN_BOX && c.D + gap <= limits.maxD + 0.01 &&
            stripFree(b.x0, b.x1, b.z1, limD, k)) {
          c.D = lgR1(c.D + gap); step = true; continue;
        }
      }
      // до ближайшего соседа справа / сзади
      for (const o of cs) {
        const ob = boxOf(o);
        if (ob.x0 > b.x1 + 0.05 && ob.z0 < b.z1 - 0.5 && ob.z1 > b.z0 + 0.5) {
          const gap = lgR1(ob.x0 - b.x1);
          if (gap < MIN_BOX && c.W + gap <= limits.maxW + 0.01 &&
              stripFree(b.x1, ob.x0, b.z0, b.z1, k)) {
            c.W = lgR1(c.W + gap); step = true; break;
          }
        }
        if (ob.z0 > b.z1 + 0.05 && ob.x0 < b.x1 - 0.5 && ob.x1 > b.x0 + 0.5) {
          const gap = lgR1(ob.z0 - b.z1);
          if (gap < MIN_BOX && c.D + gap <= limits.maxD + 0.01 &&
              stripFree(b.x0, b.x1, b.z1, ob.z0, k)) {
            c.D = lgR1(c.D + gap); step = true; break;
          }
        }
      }
    }

    // 2. большое свободное место — новый контейнер в самый большой
    //    свободный прямоугольник
    if (!step) {
      const spot = autoSpot(cs, limits);
      if (spot) {
        const nc = makeContainer(null, spot.px, spot.pz);
        nc.W = spot.W;
        nc.D = spot.D;
        cs.push(nc);
        step = true;
      }
    }

    if (!step) break;
    changed = true;
  }

  return changed ? cs : null;
}

// «Заполнить раскладку» пользуется тем же магнитом разово
export const fillAll = (cs, limits) => snapLayout(cs, limits) || cs;
export { freeRects };
