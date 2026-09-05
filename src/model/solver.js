// ══════════════════════════════════════════════════════════════
// Решатель размеров: раздаёт пролёт между ячейками ряда (или рядами по
// глубине) так, чтобы выполнялись объявленные ограничения.
//
// Ограничение на одну ячейку — одно из:
//   fix   — «эта ячейка всегда такая»: размер задан жёстко и не меняется;
//   share — доля при делении остатка (у двух ячеек с равной долей размеры
//           равны, доля 2 против 1 даёт вдвое больший размер);
//   без ограничений — доля берётся из текущего размера, то есть ячейка
//           просто сохраняет свою пропорцию.
// Плюс общий минимум: ни одна ячейка не может стать меньше него.
//
// Алгоритм — «наполнение с закреплением»: остаток делится по долям, и если
// какая-то ячейка при этом уходит ниже минимума, она закрепляется на
// минимуме, а остальные делят оставшееся заново. Так за конечное число
// шагов получается либо точное решение, либо честный ответ «не сходится»
// с числом, которого не хватает.
// ══════════════════════════════════════════════════════════════

export const MIN_CELL = 5; // минимальный размер ячейки, мм

// items: [{ fix?: число, share?: число, min?: число }]
// Возврат: { sizes, ok, need, fixedSum, freeCount, shortfall }
//   ok        — все ограничения выполнены точно
//   need      — минимальный пролёт, при котором решение существует
//   shortfall — сколько миллиметров не хватает (0, если сходится)
export function solveSizes(items, total, minCell = MIN_CELL) {
  const n = items.length;
  const sizes = new Array(n).fill(0);
  if (!n) return { sizes, ok: true, need: 0, fixedSum: 0, freeCount: 0, shortfall: 0 };

  const minOf = (k) => Math.max(0, items[k].min ?? minCell);
  const pinned = new Array(n).fill(false);
  let fixedSum = 0;
  for (let k = 0; k < n; k++) {
    if (items[k].fix != null) {
      pinned[k] = true;
      sizes[k] = Math.max(minOf(k), items[k].fix);
      fixedSum += sizes[k];
    }
  }
  const freeCount = n - pinned.filter(Boolean).length;
  // минимальный пролёт: закреплённые как есть, свободные — по минимуму
  let need = fixedSum;
  for (let k = 0; k < n; k++) if (!pinned[k]) need += minOf(k);

  // Пролёта не хватает даже на минимумы: решения нет. Отдаём согласованную
  // геометрию (всё ужато пропорционально) и честно сообщаем, сколько не
  // хватает — молча ужимать нельзя, иначе замок «эта ячейка всегда такая»
  // тихо перестаёт выполняться.
  if (total < need - 1e-6) {
    const base = items.map((it, k) => (it.fix != null ? Math.max(minOf(k), it.fix) : minOf(k)));
    const sum = base.reduce((s, v) => s + v, 0) || 1;
    return {
      sizes: base.map((v) => (v * total) / sum),
      ok: false,
      need,
      fixedSum,
      freeCount,
      shortfall: Math.round((need - total) * 100) / 100,
    };
  }

  if (!freeCount) {
    // свободных нет — если сумма закреплённых не сходится с пролётом,
    // масштабируем все (до этого доводит только правка размеров вручную)
    const sum = fixedSum || 1;
    return {
      sizes: Math.abs(sum - total) > 0.01 ? sizes.map((v) => (v * total) / sum) : sizes,
      ok: Math.abs(sum - total) <= 0.01,
      need,
      fixedSum,
      freeCount,
      shortfall: Math.max(0, Math.round((sum - total) * 100) / 100),
    };
  }

  // доля: явная, иначе пропорционально текущему размеру (ячейка сохраняет
  // свою долю), иначе поровну
  const shareOf = (k) => {
    const it = items[k];
    if (it.share != null && it.share > 0) return it.share;
    if (it.size != null && it.size > 0) return it.size;
    return 1;
  };

  for (let pass = 0; pass <= n; pass++) {
    const free = [];
    let taken = 0;
    for (let k = 0; k < n; k++) (pinned[k] ? (taken += sizes[k]) : free.push(k));
    if (!free.length) break;
    const rest = total - taken;
    const wsum = free.reduce((s, k) => s + shareOf(k), 0) || 1;
    // ячейка, которая сильнее всех уходит под минимум, закрепляется на нём
    let worst = -1, worstGap = 0;
    for (const k of free) {
      const v = (rest * shareOf(k)) / wsum;
      const gap = minOf(k) - v;
      if (gap > worstGap + 1e-9) { worstGap = gap; worst = k; }
    }
    if (worst >= 0) {
      pinned[worst] = true;
      sizes[worst] = minOf(worst);
      continue;
    }
    for (const k of free) sizes[k] = (rest * shareOf(k)) / wsum;
    break;
  }
  return { sizes, ok: true, need, fixedSum, freeCount, shortfall: 0 };
}
