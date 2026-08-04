// ── «Магнит раскладки» ──
// При включённой галке сборка липнет к краю лимита раскладки: если до
// края остаётся пустота, крайняя колонка (и ряд) дорастает до края —
// когда это возможно в пределах лимита принтера; большое пустое место
// (от 30 мм) закрывается новыми контейнерами, как в «Заполнить
// раскладку». Контейнеры с замками не растягиваются. Возвращает новый
// список контейнеров либо null, если менять нечего (идемпотентно —
// повторный вызов на результате всегда даёт null).

import { makeContainer } from "../state/storage.js";

const round1 = (v) => Math.round(v * 10) / 10;

export function snapLayout(containers, limits) {
  if (!containers || !containers.length) return null;
  const cs = containers.map((c) => ({ ...c }));
  const added = [];
  let changed = false;

  for (const ax of [
    { pos: "gx", dim: "W", cross: "gy", crossDim: "D", total: limits.layW * 10, max: limits.maxW },
    { pos: "gy", dim: "D", cross: "gx", crossDim: "W", total: limits.layD * 10, max: limits.maxD },
  ]) {
    const all = () => cs.concat(added);
    const gs = all().map((c) => c[ax.pos]);
    const g0 = Math.min(...gs);
    let g1 = Math.max(...gs);
    // ширина колонки/глубина ряда = максимум по контейнерам в ней
    const sizeAt = (g) => Math.max(30, ...all().filter((c) => c[ax.pos] === g).map((c) => c[ax.dim]));
    let sum = 0;
    for (let g = g0; g <= g1; g++) sum += sizeAt(g);
    let rem = ax.total - sum;
    if (rem < 0.05) continue;

    const growEdge = (g, amount) => {
      const edge = all().filter((c) => c[ax.pos] === g);
      if (!edge.every((c) => !c.lockOuter && !c.lockCell)) return false;
      const target = round1(sizeAt(g) + amount);
      if (target > ax.max + 0.01) return false;
      for (const c of edge) c[ax.dim] = target;
      changed = true;
      return true;
    };

    // мелкий зазор (контейнер туда не поставить) — только дотяжка краёв
    if (rem < 30) {
      growEdge(g1, rem);
      continue;
    }
    // контейнеров хватает — крайние дорастают до края целиком
    if (growEdge(g1, rem)) continue;
    // пустое место закрывают новые контейнеры (остаток меньше лимита
    // принтера забирает последний, совсем мелкий хвост делится пополам)
    while (rem >= 30) {
      let size;
      if (rem > ax.max + 0.01) size = rem - ax.max < 30 ? round1(rem / 2) : ax.max;
      else size = round1(rem);
      g1++;
      const crossVals = [...new Set(all().map((c) => c[ax.cross]))];
      for (const cv of crossVals) {
        const peers = all().filter((c) => c[ax.cross] === cv);
        const nc = makeContainer(null, 0, 0);
        nc[ax.pos] = g1;
        nc[ax.cross] = cv;
        nc[ax.dim] = size;
        nc[ax.crossDim] = Math.max(30, ...peers.map((c) => c[ax.crossDim]));
        added.push(nc);
      }
      rem = round1(rem - size);
      changed = true;
    }
    // хвост меньше 30 мм — дотянуть новую крайнюю колонку
    if (rem >= 0.05) growEdge(g1, rem);
  }

  return changed ? cs.concat(added) : null;
}
