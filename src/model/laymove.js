// ── Свободная раскладка контейнеров ──
// Никаких рядов и колонок: каждый контейнер занимает прямоугольник на
// столе с собственными шириной и глубиной. Позиция — левый ближний угол
// (px, pz) в миллиметрах от угла рамки стола. Контейнеры двигаются куда
// угодно, прилипают краями к соседям и к рамке; пересекаться и выходить
// за рамку стола им нельзя.

import { minOuterDim } from "./layout.js";

const lmR1 = (v) => Math.round(v * 10) / 10; // имя уникально: сборка склеивает модули в один скрипт
export const MIN_BOX = 30; // минимальный габарит контейнера, мм
export const SNAP = 8;     // радиус прилипания краёв, мм

export const boxOf = (c) => ({ x0: c.px, x1: c.px + c.W, z0: c.pz, z1: c.pz + c.D });

// ── Прижатие к стороне рамки ──
// Контейнер можно закрепить у стороны стола/полки (задняя = верх плана,
// pz 0). Прижатая ось не отпускается при переносе; после любых перестроек
// контейнер возвращается вплотную к своей стороне, как только там свободно.
export const PIN_SIDES = ["back", "front", "left", "right"];
export const pinnedPos = (c, limits) => {
  const limW = (limits?.layW || 0) * 10, limD = (limits?.layD || 0) * 10;
  const p = c.pin || {};
  let px = null, pz = null;
  if (p.left) px = 0;
  else if (p.right && limW > 0) px = lmR1(Math.max(0, limW - c.W));
  if (p.back) pz = 0;
  else if (p.front && limD > 0) pz = lmR1(Math.max(0, limD - c.D));
  return { px, pz };
};

// пересечение по площади (касание краями — не пересечение)
export const overlaps = (a, b, eps = 0.05) =>
  a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps;

export const collides = (cs, idx, px, pz) => {
  const me = { x0: px, x1: px + cs[idx].W, z0: pz, z1: pz + cs[idx].D };
  return cs.some((c, k) => k !== idx && overlaps(me, boxOf(c)));
};

// габарит сборки (позиции считаются уже нормированными от нуля)
export function bounds(cs) {
  if (!cs.length) return { w: 0, d: 0 };
  let w = 0, d = 0;
  for (const c of cs) { w = Math.max(w, c.px + c.W); d = Math.max(d, c.pz + c.D); }
  return { w: lmR1(w), d: lmR1(d) };
}

// сдвиг сборки в угол рамки: минимальные px и pz становятся нулём.
// Ссылки на неизменившиеся контейнеры сохраняются (жив кэш геометрии).
export function normPositions(cs) {
  if (!cs.length) return cs;
  const dx = Math.min(...cs.map((c) => c.px));
  const dz = Math.min(...cs.map((c) => c.pz));
  if (Math.abs(dx) < 0.05 && Math.abs(dz) < 0.05) return cs;
  return cs.map((c) => ({ ...c, px: lmR1(c.px - dx), pz: lmR1(c.pz - dz) }));
}

// Прилипание: ближайший к (px, pz) вариант, где края контейнера совпадают
// с краями соседей или рамки. По каждой оси — независимо.
export function snapMove(cs, idx, px, pz, limits) {
  const me = cs[idx];
  const limW = (limits?.layW || 0) * 10, limD = (limits?.layD || 0) * 10;
  const xs = [0], zs = [0];
  if (limW > 0) xs.push(limW - me.W);
  if (limD > 0) zs.push(limD - me.D);
  cs.forEach((c, k) => {
    if (k === idx) return;
    const b = boxOf(c);
    xs.push(b.x1, b.x0 - me.W, b.x0, b.x1 - me.W); // впритык и заподлицо
    zs.push(b.z1, b.z0 - me.D, b.z0, b.z1 - me.D);
  });
  const pick = (v, cands) => {
    let best = v, dist = SNAP;
    for (const c of cands) {
      const d = Math.abs(c - v);
      if (d < dist) { dist = d; best = c; }
    }
    return best;
  };
  let nx = pick(px, xs), nz = pick(pz, zs);
  // рамка стола — жёсткая: за неё не выехать
  if (limW > 0) nx = Math.min(nx, limW - me.W);
  if (limD > 0) nz = Math.min(nz, limD - me.D);
  nx = Math.max(0, nx); nz = Math.max(0, nz);
  // прижатая ось не отпускается: тащить можно только вдоль своей стороны
  const pin = pinnedPos(me, limits);
  if (pin.px !== null) nx = pin.px;
  if (pin.pz !== null) nz = pin.pz;
  return { px: lmR1(nx), pz: lmR1(nz) };
}

// Перенос контейнера в точку (px, pz — левый ближний угол). Прилипает к
// краям; если место занято, пробует варианты без прилипания по одной из
// осей. Совсем некуда — возвращает прежний список (перенос отменён).
export function moveContainer(cs, idx, px, pz, limits) {
  const me = cs[idx];
  if (!me || !Number.isFinite(px) || !Number.isFinite(pz)) return cs;
  const s = snapMove(cs, idx, px, pz, limits);
  // прижатые оси не отпускаются и в запасных вариантах без прилипания
  const pin = pinnedPos(me, limits);
  const rawX = pin.px !== null ? pin.px : Math.max(0, lmR1(px));
  const rawZ = pin.pz !== null ? pin.pz : Math.max(0, lmR1(pz));
  const cands = [
    [s.px, s.pz],
    [s.px, rawZ],
    [rawX, s.pz],
    [rawX, rawZ],
  ];
  for (const [nx, nz] of cands) {
    const limW = (limits?.layW || 0) * 10, limD = (limits?.layD || 0) * 10;
    if (limW > 0 && nx + me.W > limW + 0.05) continue;
    if (limD > 0 && nz + me.D > limD + 0.05) continue;
    if (collides(cs, idx, nx, nz)) continue;
    if (Math.abs(nx - me.px) < 0.05 && Math.abs(nz - me.pz) < 0.05) return cs;
    // позицию пользователь выбрал сам — к углу рамки ничего не прижимаем
    return cs.map((c, k) => (k === idx ? { ...c, px: lmR1(nx), pz: lmR1(nz) } : c));
  }
  return cs;
}

// ── Свободные прямоугольники рамки ──
// Сетка по координатам краёв; из пустых клеток жадно собираются
// максимальные прямоугольники. Для десятков контейнеров это мгновенно.
export function freeRects(cs, limits) {
  const limW = (limits?.layW || 0) * 10, limD = (limits?.layD || 0) * 10;
  if (!(limW > 0) || !(limD > 0)) return [];
  const uniq = (arr) => [...new Set(arr.map(lmR1))].filter((v) => v > -0.01 && v < 1e6).sort((a, b) => a - b);
  const xs = uniq([0, limW, ...cs.flatMap((c) => [c.px, c.px + c.W])].map((v) => Math.min(Math.max(v, 0), limW)));
  const zs = uniq([0, limD, ...cs.flatMap((c) => [c.pz, c.pz + c.D])].map((v) => Math.min(Math.max(v, 0), limD)));
  const busy = (x0, x1, z0, z1) =>
    cs.some((c) => overlaps({ x0, x1, z0, z1 }, boxOf(c)));
  const cellBusy = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    cellBusy.push([]);
    for (let i = 0; i + 1 < xs.length; i++)
      cellBusy[j].push(busy(xs[i], xs[i + 1], zs[j], zs[j + 1]));
  }
  const nx = xs.length - 1, nz = zs.length - 1;
  const rowFree = (j, i0, i1) => { // клетки [i0, i1) ряда j свободны
    for (let k = i0; k < i1; k++) if (cellBusy[j][k]) return false;
    return true;
  };
  const rects = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (cellBusy[j][i]) continue;
      let iMax = i;
      while (iMax < nx && !cellBusy[j][iMax]) iMax++;
      // для каждой ширины-префикса тянем вниз, пока все клетки свободны
      for (let ie = i + 1; ie <= iMax; ie++) {
        let je = j + 1;
        while (je < nz && rowFree(je, i, ie)) je++;
        const w = lmR1(xs[ie] - xs[i]), d = lmR1(zs[je] - zs[j]);
        if (w >= MIN_BOX - 0.1 && d >= MIN_BOX - 0.1)
          rects.push({ x: xs[i], z: zs[j], w, d });
      }
    }
  // покрупнее вперёд; дубликаты не мешают
  return rects.sort((a, b) => b.w * b.d - a.w * a.d);
}

// Куда поставить новый контейнер: самый большой свободный прямоугольник,
// размер — сколько влезает (не больше лимита принтера). null — места нет.
export function autoSpot(cs, limits) {
  const rects = freeRects(cs, limits);
  if (!rects.length) return null;
  const rc = rects[0];
  return {
    px: rc.x, pz: rc.z,
    W: lmR1(Math.min(rc.w, limits.maxW)),
    D: lmR1(Math.min(rc.d, limits.maxD)),
  };
}

// ── Жёсткая рамка стола ──
// Сборка не выходит за лимит раскладки никогда. Габариты ужимаются до
// рамки (замок габарита не трогается), позиции зажимаются внутрь.
// Пересечения (после ужатия рамки или битого проекта) разрешаются
// перекладкой: наехавший контейнер переезжает в ближайший свободный
// прямоугольник, где помещается; совсем некуда — ужимается под самое
// большое свободное место. Идемпотентно: без изменений возвращает null.
export function fitAssembly(cs, limits) {
  if (!cs || !cs.length || !limits) return null;
  const limW = (limits.layW || 0) * 10, limD = (limits.layD || 0) * 10;
  const out = cs.map((c) => {
    let n = c;
    const set = (patch) => { n = n === c ? { ...c, ...patch } : Object.assign(n, patch); };
    if (!c.lockOuter) {
      if (limW > 0 && n.W > limW) set({ W: lmR1(Math.max(MIN_BOX, limW)) });
      if (limD > 0 && n.D > limD) set({ D: lmR1(Math.max(MIN_BOX, limD)) });
    }
    if (limW > 0 && n.px + n.W > limW + 0.05) set({ px: lmR1(Math.max(0, limW - n.W)) });
    if (limD > 0 && n.pz + n.D > limD + 0.05) set({ pz: lmR1(Math.max(0, limD - n.D)) });
    if (n.px < -0.05) set({ px: 0 });
    if (n.pz < -0.05) set({ pz: 0 });
    return n;
  });
  // раскладываем заново только наехавших: прижатые к сторонам и замки
  // первыми (прижатый обязан остаться у своей стороны, замку не ужаться),
  // на месте стоящие не трогаем
  const pinRank = (c) => (c.pin && Object.keys(c.pin).length ? 0 : 2);
  const order = out.map((_, k) => k).sort((a, b) =>
    (pinRank(out[a]) + (out[a].lockOuter ? 0 : 1)) - (pinRank(out[b]) + (out[b].lockOuter ? 0 : 1)) || a - b);
  const placed = [];
  const parked = [];
  for (const k of order) {
    const c = out[k];
    const me = boxOf(c);
    if (!placed.some((q) => overlaps(me, boxOf(q)))) { placed.push(c); continue; }
    // ищем свободный прямоугольник, куда контейнер влезает как есть;
    // позиция внутри — как можно ближе к прежней
    const rects = freeRects(placed, limits);
    const fit = rects.filter((rc) => rc.w >= c.W - 0.01 && rc.d >= c.D - 0.01);
    const posIn = (rc, w, d) => ({
      px: lmR1(Math.min(Math.max(c.px, rc.x), rc.x + rc.w - w)),
      pz: lmR1(Math.min(Math.max(c.pz, rc.z), rc.z + rc.d - d)),
    });
    if (fit.length) {
      const best = fit.reduce((A, B) => {
        const pa = posIn(A, c.W, c.D), pb = posIn(B, c.W, c.D);
        const da = Math.abs(pa.px - c.px) + Math.abs(pa.pz - c.pz);
        const db = Math.abs(pb.px - c.px) + Math.abs(pb.pz - c.pz);
        return db < da ? B : A;
      });
      out[k] = { ...c, ...posIn(best, c.W, c.D) };
    } else if (!c.lockOuter && rects.length) {
      // не влезает никуда — ужимается под самое большое свободное место
      const rc = rects[0];
      const W = lmR1(Math.max(MIN_BOX, Math.min(c.W, rc.w)));
      const D = lmR1(Math.max(MIN_BOX, Math.min(c.D, rc.d)));
      out[k] = { ...c, W, D, ...posIn(rc, W, D) };
    } else {
      // свободного места нет вовсе — контейнер физически не помещается.
      // Пересекаться нельзя никогда, поэтому он паркуется СНАРУЖИ рамки,
      // справа от неё (на плане это видно; перетащить обратно можно, как
      // только место освободится)
      parked.push(k);
      continue;
    }
    placed.push(out[k]);
  }
  let parkZ = 0;
  // парковка правее и рамки, и всего, что торчит из неё (замок шире рамки)
  const parkX = lmR1(Math.max(limW, bounds(placed).w) + 8);
  for (const k of parked) {
    out[k] = { ...out[k], px: parkX, pz: lmR1(parkZ) };
    parkZ += out[k].D + 8;
  }
  // дотяжка прижатых к своей стороне — только когда там свободно (иначе
  // клеймо и перекладка гоняли бы контейнер по кругу); припаркованных
  // снаружи это не касается
  out.forEach((c, k) => {
    if (parked.includes(k)) return;
    const pin = pinnedPos(c, limits);
    const px = pin.px !== null ? pin.px : c.px;
    const pz = pin.pz !== null ? pin.pz : c.pz;
    if (Math.abs(px - c.px) < 0.05 && Math.abs(pz - c.pz) < 0.05) return;
    if (!out.some((q, j) => j !== k && overlaps({ x0: px, x1: px + c.W, z0: pz, z1: pz + c.D }, boxOf(q))))
      out[k] = { ...c, px, pz };
  });
  // «изменилось» — по значениям: пересчёт, вернувший те же числа (например,
  // припаркованному снаружи), не должен считаться изменением — иначе эффект
  // раскладки перекладывал бы одно и то же вечно
  const same = (a, b) => a.px === b.px && a.pz === b.pz && a.W === b.W && a.D === b.D;
  if (out.every((c, k) => same(c, cs[k]))) return null;
  return out.map((c, k) => (same(c, cs[k]) ? cs[k] : c));
}

// ── Приклеенные соседи при изменении размера ──
// Правая грань контейнера двигается (меняется ширина) — контейнеры,
// прилипшие к ней (левая грань на ней, пересечение по глубине), едут
// следом, и так по цепочке. То же для глубины и дальней грани.
// Возвращает список с новыми позициями последователей.
export function dragFollowers(cs, idx, axis, delta) {
  if (Math.abs(delta) < 0.05) return cs;
  const [p, s, o0, o1] = axis === "W" ? ["px", "W", "z0", "z1"] : ["pz", "D", "x0", "x1"];
  const moved = new Map(); // индекс → сдвиг
  const queue = [idx];
  const edgeOf = (c) => (axis === "W" ? c.px + c.W : c.pz + c.D);
  while (queue.length) {
    const i = queue.shift();
    const base = cs[i];
    const edge = edgeOf(base); // позиции ещё не сдвинуты — грань старая
    const bb = boxOf(base);
    cs.forEach((c, k) => {
      if (k === i || moved.has(k) || k === idx) return;
      const cb = boxOf(c);
      const lead = axis === "W" ? cb.x0 : cb.z0;
      const across = Math.min(bb[o1], cb[o1]) - Math.max(bb[o0], cb[o0]);
      if (Math.abs(lead - edge) < 0.06 && across > 0.5) {
        moved.set(k, delta);
        queue.push(k);
      }
    });
  }
  if (!moved.size) return cs;
  return cs.map((c, k) => (moved.has(k) ? { ...c, [p]: lmR1(c[p] + moved.get(k)) } : c));
}

// Изменение габарита контейнера в свободной раскладке. Левый ближний угол
// стоит на месте, двигается правая (дальняя) грань. Прилипшие соседи при
// включённом магните едут за гранью; при росте они едут всегда — иначе
// коробки наехали бы друг на друга. Затем всё зажимается в рамку.
export function resizeBox(cs, idx, patch, limits, magnetOn) {
  const me = cs[idx];
  if (!me || me.lockOuter) return cs;
  let out = cs;
  for (const axis of ["W", "D"]) {
    if (!(axis in patch)) continue;
    const maxAx = axis === "W" ? limits.maxW : limits.maxD;
    const want = lmR1(Math.max(minOuterDim(out[idx], axis), MIN_BOX, Math.min(patch[axis], maxAx)));
    const delta = lmR1(want - out[idx][axis]);
    if (Math.abs(delta) < 0.05) continue;
    if (magnetOn || delta > 0) out = dragFollowers(out, idx, axis, delta);
    out = out.map((c, k) => (k === idx ? { ...c, [axis]: want } : c));
  }
  if (out === cs) return cs;
  return fitAssembly(out, limits) || out;
}
