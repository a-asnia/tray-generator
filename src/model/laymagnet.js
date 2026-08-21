// ── «Магнит раскладки» ──
// При включённой галке сборка липнет к краю лимита раскладки: ряд, не
// достающий до правого края, дотягивается последним контейнером (в
// пределах лимита принтера), а большое пустое место (от 30 мм) закрывается
// новым контейнером. То же по глубине: последний ряд дотягивается до
// дальнего края или добавляется новый ряд. Контейнеры с замками не
// растягиваются. Возвращает новый список либо null, если менять нечего
// (идемпотентно — повторный вызов на результате всегда даёт null).

import { makeContainer } from "../state/storage.js";
import { rowsOf, MIN_BOX } from "./laymove.js";

const round1 = (v) => Math.round(v * 10) / 10;

export function snapLayout(containers, limits) {
  if (!containers || !containers.length || !limits) return null;
  let cs = containers.map((c) => ({ ...c }));
  let changed = false;
  const limW = (limits.layW || 0) * 10, limD = (limits.layD || 0) * 10;

  // ── ширина рядов ──
  if (limW > 0)
    for (const r of rowsOf(cs)) {
      let rem = round1(limW - r.width);
      if (rem < 0.05) continue;
      const last = r.list[r.list.length - 1];
      const free = last && !last.lockOuter && !last.lockCell;
      // весь зазор закрывается растяжкой — растягиваем и всё
      if (free && last.W + rem <= limits.maxW + 0.01) {
        cs.find((c) => c.id === last.id).W = round1(last.W + rem);
        changed = true;
        continue;
      }
      // иначе зазор закрывают новые контейнеры этого ряда
      let gx = r.list.length;
      let tail = null;
      while (rem >= MIN_BOX) {
        const size = rem > limits.maxW + 0.01
          ? (rem - limits.maxW < MIN_BOX ? round1(rem / 2) : limits.maxW)
          : round1(rem);
        const nc = makeContainer(null, gx, r.gy);
        nc.W = size;
        nc.D = r.depth;
        cs.push(nc);
        tail = nc;
        rem = round1(rem - size);
        gx++;
        changed = true;
      }
      // хвост меньше контейнера добирает крайний — ряд встаёт ровно у края
      if (rem >= 0.05) {
        const t = tail || (free ? cs.find((c) => c.id === last.id) : null);
        if (t && t.W + rem <= limits.maxW + 0.01) { t.W = round1(t.W + rem); changed = true; }
      }
    }

  // ── глубина стопки ──
  if (limD > 0) {
    const rows = rowsOf(cs);
    const totalD = rows.reduce((s, r) => s + r.depth, 0);
    let rem = round1(limD - totalD);
    if (rem >= 0.05) {
      const last = rows[rows.length - 1];
      const free = last.list.every((c) => !c.lockOuter && !c.lockCell);
      if (free && last.depth + rem <= limits.maxD + 0.01) {
        for (const c of last.list) cs.find((x) => x.id === c.id).D = round1(last.depth + rem);
        return cs;
      }
      let gy = rows[rows.length - 1].gy + 1;
      let tailRow = null;
      while (rem >= MIN_BOX) {
        const size = rem > limits.maxD + 0.01
          ? (rem - limits.maxD < MIN_BOX ? round1(rem / 2) : limits.maxD)
          : round1(rem);
        // новый ряд повторяет ширины предыдущего — сборка остаётся ровной
        const src = rowsOf(cs).slice(-1)[0].list;
        tailRow = [];
        src.forEach((c, gx) => {
          const nc = makeContainer(null, gx, gy);
          nc.W = c.W;
          nc.D = size;
          cs.push(nc);
          tailRow.push(nc);
        });
        rem = round1(rem - size);
        gy++;
        changed = true;
      }
      // хвост по глубине добирает последний ряд
      if (rem >= 0.05) {
        const list = tailRow || (free ? last.list.map((c) => cs.find((x) => x.id === c.id)) : null);
        if (list && list[0].D + rem <= limits.maxD + 0.01) {
          for (const t of list) t.D = round1(t.D + rem);
          changed = true;
        }
      }
    }
  }

  return changed ? cs : null;
}
