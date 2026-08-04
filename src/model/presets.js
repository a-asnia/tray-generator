// ── Пресеты контейнеров ──
// Пресет настраивает ВЫБРАННЫЙ контейнер под типовую задачу одним
// нажатием: след по нижней части (Ш×Г), место в раскладке, толщины
// стенок и дна остаются прежними, а сетка, высоты стенок, уровни полов
// и фиксации перезаписываются. Дальше всё правится обычными редакторами:
// ступеньки горки — это ряды, их ширина — глубина ряда, уровни — уровень
// пола ячейки.

// настройки «Горки» по умолчанию: ступенек, шаг уровня, глубина ступени
export const GORKA_DEF = { steps: 3, stepH: 15, depth: 35 };

export const PRESETS = [
  ["low", "Низкий большой"],
  ["narrow", "Узкий с делениями"],
  ["grid6", "Органайзер 4–6"],
  ["booklet", "Буклетница"],
  ["stairs", "Горка"],
];

const r1 = (v) => Math.round(v * 10) / 10;

// c — текущий контейнер, kind — ключ пресета, limits — лимиты принтера,
// opts — параметры горки {steps, stepH, depth}. Возвращает НОВЫЙ объект
// контейнера с тем же id/местом/следом.
export function presetContainer(c, kind, limits, opts = {}) {
  const innerW = c.W - 2 * c.wallOut;
  const innerD = c.D - 2 * c.wallOut;
  const maxH = limits?.maxH ?? 500;
  const base = {
    ...c,
    cols: 1, rows: 1, gridMode: "count",
    walls: {}, cells: {}, rowColWs: null, rowDs: null,
    lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [],
    lockOuter: false, lockCell: false,
  };

  // низкий большой: один отсек на весь след, невысокие борта
  if (kind === "low") return { ...base, H: Math.min(maxH, 14) };

  // узкий с делениями: один ряд длинных узких отсеков (под ручки, свёрла)
  if (kind === "narrow")
    return { ...base, H: Math.min(maxH, 30), cols: Math.max(3, Math.round(innerW / 28)) };

  // органайзер на 4–6 отсеков: 3×2, а на узком следе 2×2
  if (kind === "grid6")
    return { ...base, H: Math.min(maxH, 30), cols: innerW / 3 >= 40 ? 3 : 2, rows: 2 };

  // буклетница: три кармана каскадом — задняя стенка самая высокая,
  // каждый следующий карман ниже (видно все буклеты), полы наклонены
  // назад, чтобы буклеты опирались на стенку своего кармана
  if (kind === "booklet") {
    const H = Math.min(maxH, 110);
    const fr = r1(H * 0.35), st = (H - fr) / 3;
    return {
      ...base, H, rows: 3,
      // боковые стенки повторяют каскад карманов — силуэт лесенкой,
      // буклеты видно и сбоку
      walls: {
        "o:n:0": { h: fr },
        "h:0:0": { h: r1(fr + st) },
        "h:1:0": { h: r1(fr + 2 * st) },
        "o:w:0": { h: r1(fr + st) }, "o:e:0": { h: r1(fr + st) },
        "o:w:1": { h: r1(fr + 2 * st) }, "o:e:1": { h: r1(fr + 2 * st) },
      },
      cells: {
        "0:0": { tiltDir: "s", tiltA: 12 },
        "0:1": { tiltDir: "s", tiltA: 12 },
        "0:2": { tiltDir: "s", tiltA: 12 },
      },
    };
  }

  // горка: ступени поднимаются к задней стенке, задняя стенка — самая
  // высокая (равна высоте контейнера и следует за ней). Ступенька — ряд:
  // передние ряды держат заданную глубину (замок ряда), задний забирает
  // остаток. Боковые стенки повторяют лесенку, спереди и на ступенях —
  // невысокий бортик, чтобы предметы не съезжали.
  if (kind === "stairs") {
    const n = Math.max(2, Math.min(12, Math.round(opts.steps ?? GORKA_DEF.steps)));
    const stepH = Math.max(3, Math.min(60, opts.stepH ?? GORKA_DEF.stepH));
    const lip = 6; // бортик над полом своей ступени
    const sum = innerD - (n - 1) * c.wall; // суммарная глубина рядов
    const depth = Math.max(10, Math.min(opts.depth ?? GORKA_DEF.depth, (sum - 10) / Math.max(1, n - 1)));
    const rowDs = Array.from({ length: n }, (_, j) =>
      r1(j < n - 1 ? depth : Math.max(10, sum - depth * (n - 1))));
    const lockedRows = {};
    for (let j = 0; j < n - 1; j++) lockedRows[j] = true;
    // спинка выше верхней ступени минимум на 20 мм (или на шаг)
    const H = Math.min(maxH, r1((n - 1) * stepH + c.floor + Math.max(20, stepH)));
    const walls = { "o:n:0": { h: r1(c.floor + lip) } };
    const cells = {};
    for (let j = 0; j < n; j++) {
      if (j > 0) cells["0:" + j] = { lvl: r1(j * stepH) };
      const hSide = r1(j * stepH + c.floor + lip);
      walls["o:w:" + j] = { h: hSide };
      walls["o:e:" + j] = { h: hSide };
      if (j < n - 1) walls["h:" + j + ":0"] = { h: r1((j + 1) * stepH + c.floor + lip) };
    }
    return { ...base, H, rows: n, rowDs, lockedRows, walls, cells };
  }

  return base;
}
