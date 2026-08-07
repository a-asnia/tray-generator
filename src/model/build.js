// ══════════════════════════════════════════════════════════════
// Полная сборка контейнера в набор выпуклых тел (solids).
// Внутри — тела стенок с профилем и спуском кромки, узорные
// заполнения (соты вершиной вверх, диагональные линии), пандусы,
// пол с лесенкой и рёбрами, зоны соединителей.
// ══════════════════════════════════════════════════════════════

import { prismSolid, boxSolid, rampSolid, wallProfile, ARC_SEGS } from "../geometry/solids.js";
import { hashStr, mulberry32, ribbonQuads } from "../geometry/random.js";
import { connOf, splitRange, addConnUnits, lockMinH } from "./connectors.js";
import { layout, getWall, getCellLvl, DEFAULT_CORNER_R } from "./layout.js";
import { insertsOf, insertSlots, insertInPlace } from "./inserts.js";
import { CARDH } from "./cardholder.js";

// ── Полная сборка контейнера. conn = {N,S,W,E: {male, vs} | null} ──
// opts.fillets === false отключает галтели (для сверки с эталоном)
export function buildContainer(c, conn, opts = {}) {
  const { W, D, H, wall, wallOut, floor } = c;
  const L = layout(c);
  const solids = [];
  const tan = (deg) => Math.tan((deg * Math.PI) / 180);

  // Галтель: небольшое скругление внутреннего угла в месте примыкания
  // перегородки к корпусу — веер вертикальных треугольных призм
  // (вертикальные поверхности, печатается без поддержек)
  const FILLET_R = 2, FILLET_SEGS = 4;
  // ownBox — индекс бокса, чья это собственная галтель (его полость
  // проверкой не отсекается); для остальных галтель не должна попасть
  // внутрь полости бокса (например, когда бокс занимает угол корпуса)
  // h — высота стыка, rTr — скругление верхних кромок смыкающихся стенок.
  // В зоне скругления грани отступают от полости, и галтель отступает
  // вместе с ними ровно теми же гранями дуги — тогда её верх приходит
  // заподлицо с кромкой. Если этого не делать, галтель обрывается плоской
  // площадкой ниже кромки, и во внутренних углах торчат острые уголки.
  const addFillet = (cx, cz, dx, dz, h, tag, ownBox = -1, rTr = 0) => {
    if (opts.fillets === false || h < 1.5) return;
    const r = FILLET_R;
    const qx0 = Math.min(cx, cx + dx * r), qx1 = Math.max(cx, cx + dx * r);
    const qz0 = Math.min(cz, cz + dz * r), qz1 = Math.max(cz, cz + dz * r);
    for (const f of L.fixed)
      if (f.k !== ownBox && qx1 > f.x0 + 0.01 && qx0 < f.x1 - 0.01 && qz1 > f.z0 + 0.01 && qz0 < f.z1 - 0.01) return;
    // веер галтели, сдвинутый наружу полости на o
    const fan = (o) => {
      const c0 = [cx - dx * o, cz - dz * o];
      const pts = [];
      for (let s = 0; s <= FILLET_SEGS; s++) {
        const t = (s / FILLET_SEGS) * (Math.PI / 2);
        pts.push([c0[0] + dx * r * (1 - Math.sin(t)), c0[1] + dz * r * (1 - Math.cos(t))]);
      }
      return { c0, pts };
    };
    const layer = (lo, hi, y0, y1) => {
      if (y1 - y0 < 0.005) return;
      for (let s = 0; s + 1 < lo.pts.length; s++) {
        const qa = [lo.c0, lo.pts[s], lo.pts[s + 1], lo.pts[s + 1]].map(([x, z]) => [x, y0, z]);
        const qb = [hi.c0, hi.pts[s], hi.pts[s + 1], hi.pts[s + 1]].map(([x, z]) => [x, y1, z]);
        solids.push(prismSolid(qa, qb, tag));
      }
    };
    const rr = Math.max(0, Math.min(rTr, h - 1));
    const f0 = fan(0);
    if (rr < 0.05) { layer(f0, f0, 0, h); return; }
    const hb = h - rr;
    layer(f0, f0, 0, hb);
    // те же грани дуги, что и у профиля стенки (wallProfile)
    let prev = f0, prevY = hb;
    for (let k = 1; k <= ARC_SEGS; k++) {
      const t = (k / ARC_SEGS) * (Math.PI / 2);
      const f = fan(rr * (1 - Math.cos(t)));
      const y = hb + rr * Math.sin(t);
      layer(prev, f, prevY, y);
      prev = f; prevY = y;
    }
  };
  // Скругление ставится только между ВЕРТИКАЛЬНЫМИ стенками: если стенка
  // наклонена внутрь (пандус), она сама даёт плавный переход, а прямая
  // галтель торчала бы из наклонной плоскости
  const flatWall = (key) => {
    const w = getWall(c, key);
    return w.t1 < 0.5 && w.t2 < 0.5;
  };
  // Фактический радиус скругления кромки стенки (как в wallProfile).
  // Галтель должна заканчиваться там, где начинается скругление, иначе
  // торчит «пеньком» выше скруглённой кромки — в углах и на стыках.
  const rEff = (key, thk, sym) => {
    const w = getWall(c, key);
    return Math.max(0, Math.min(w.rnd, sym ? thk / 2 : thk - 0.4, w.h * 0.9));
  };
  // Скругление НАРУЖНОЙ кромки стенки: у стороны с замком наружная
  // плоскость строго ровная, поэтому радиус там нулевой.
  const rOuter = (key, thk, sym) => (sym ? rEff(key, thk, sym) : 0);
  // высота стенки на её конце (учитывая спуск кромки)
  const hAtEnd = (wc, atStart) => {
    if (wc.drop === "none") return wc.h;
    const low = wc.drop === (atStart ? "a" : "b");
    return low ? Math.max(0.4, Math.min(wc.dropH, wc.h)) : wc.h;
  };

  const CONN = connOf(c); // размеры соединителя с учётом зазора печати
  // Замок следует СВОЕЙ стенке: высота и скругление кромки берутся у
  // сегмента, на котором он стоит (зона может накрыть два сегмента —
  // высота по минимуму). Слишком низкая стенка — зона не режется вовсе
  // и замок не ставится: стенка остаётся целой и ровной.
  const zoneInfo = (side, vc) => {
    const sideL = side.toLowerCase();
    const segs = [];
    if (sideL === "n" || sideL === "s") {
      const j = sideL === "n" ? 0 : L.nRows - 1;
      for (let i = 0; i < L.nColsAt(j); i++)
        segs.push({ a: L.cx0(i, j) - wallOut, b: L.cx0(i, j) + L.cw(i, j) + wallOut, key: `o:${sideL}:${i}` });
    } else {
      for (let j = 0; j < L.nRows; j++)
        segs.push({ a: L.cz0(j) - wallOut, b: L.cz0(j) + L.cd(j) + wallOut, key: `o:${sideL}:${j}` });
    }
    const z0 = vc - CONN.bossW / 2, z1 = vc + CONN.bossW / 2;
    let h = Infinity, hMax = -Infinity, rnd = 0, best = -1e9;
    for (const sg of segs) {
      if (sg.b < z0 + 0.01 || sg.a > z1 - 0.01) continue;
      const wc = getWall(c, sg.key);
      h = Math.min(h, wc.h);
      hMax = Math.max(hMax, wc.h);
      const ov = Math.min(sg.b, z1) - Math.max(sg.a, z0);
      if (ov > best) { best = ov; rnd = wc.rnd; }
    }
    if (!Number.isFinite(h)) { const wc = getWall(c, `o:${sideL}:0`); h = wc.h; hMax = wc.h; rnd = wc.rnd; }
    // even: все сегменты под зоной одной высоты. На ступенчатой стенке
    // (горка) замок не ставится: вырезать зону из сегментов разной высоты
    // и вернуть плоскую — значит разломать лесенку на куски
    return { vc, h, rnd, even: hMax - h < 0.01 };
  };
  const unitsOf = (side) =>
    conn[side] && CONN.fits
      ? conn[side].vs.map((vc) => zoneInfo(side, vc)).filter((u) => u.even && u.h >= lockMinH(CONN))
      : [];
  const uN = unitsOf("N"), uS = unitsOf("S"), uW = unitsOf("W"), uE = unitsOf("E");
  const zonesFrom = (units) =>
    units.map((u) => [u.vc - CONN.bossW / 2, u.vc + CONN.bossW / 2]).sort((a, b) => a[0] - b[0]);
  const zN = zonesFrom(uN), zS = zonesFrom(uS), zW = zonesFrom(uW), zE = zonesFrom(uE);

  // ── Окна под съёмную визитницу ──
  // Пара сквозных окон у верха внешней стенки (галка в редакторе стенки).
  // Окно режет стенку зоной на всю высоту, обратно ставятся низ (на всю
  // толщину) и верх со скруглённой кромкой — между ними сквозной проём.
  const cardHoleVs = (wc, a, b, zones) => {
    if (!wc.cardHooks || wc.h < CARDH.minH || b - a < CARDH.minW) return [];
    const mid = (a + b) / 2;
    return [mid - CARDH.sp / 2, mid + CARDH.sp / 2].filter((vc) =>
      zones.every(([za, zb]) => vc + CARDH.hw / 2 <= za + 0.01 || vc - CARDH.hw / 2 >= zb - 0.01));
  };
  const withCardZones = (zones, holes) =>
    [...zones, ...holes.map((vc) => [vc - CARDH.hw / 2, vc + CARDH.hw / 2])].sort((p, q) => p[0] - q[0]);
  const pushCardHolePieces = (key, wc, sym, vc, mapFn) => {
    const y1 = wc.h - CARDH.top, y0 = y1 - CARDH.hh;
    const a = vc - CARDH.hw / 2, b = vc + CARDH.hw / 2;
    const q = sym
      ? [[-wallOut / 2, 0], [wallOut / 2, 0], [wallOut / 2, y0], [-wallOut / 2, y0]]
      : [[0, 0], [wallOut, 0], [wallOut, y0], [0, y0]];
    pushProfiled([q], mapFn, a, b, key); // низ проёма
    const parts = wallProfile(wallOut, wc.h, wc.rnd, sym).map((quad, qi) =>
      qi === 0 ? quad.map(([o, y]) => [o, y === 0 ? y1 : y]) : quad);
    pushProfiled(parts, mapFn, a, b, key); // верх проёма с кромкой
  };

  const addRamp = (orient, facePos, dir, s0, s1, h, tilt, cellSize, embed, thk, wc, yBase, tag) => {
    if (tilt < 0.5 || h <= yBase + 0.3) return;
    const run = Math.min((h - yBase) * tan(tilt), cellSize * 0.45);
    if (run < 0.15) return;
    if (wc.face === "hex") buildHexRamp(orient, facePos, dir, s0, s1, h, yBase, run, thk, wc.hexSize, embed, tag);
    else if (wc.face === "lines") buildLinesRamp(orient, facePos, dir, s0, s1, h, yBase, run, thk, wc, embed, tag);
    else solids.push(rampSolid(orient, facePos, dir, s0, s1, h, yBase, run, embed, tag));
  };

  // Тело наружного угла: снизу четверть-цилиндра радиуса r, сверху
  // сектор, радиус которого сходит к нулю по той же дуге, что и скругление
  // кромки (ρ = r·cos t при подъёме r·sin t). На каждой высоте крайняя
  // точка сектора лежит ровно в плоскости соответствующей стенки, отступив
  // внутрь на o = r − ρ, — поэтому стык со стенками получается заподлицо.
  // Тело наружного угла. Rc — радиус скругления угла по плану, rEdge —
  // радиус скругления верхней кромки. В зоне кромки радиус угла убывает
  // на тот же отступ, что уходит внутрь наружная плоскость: ρ = Rc − o.
  // Поэтому у самой кромки угол остаётся скруглённым радиусом Rc − rEdge.
  // Если брать Rc = rEdge, наверху радиус схлопывается в ноль и угол
  // вырождается в остриё — именно это и выглядело странно.
  const addCorner = (px, pz, sx, sz, h, rEdge, Rc, tag) => {
    if (Rc < 0.05) return;
    const SEG = 8; // клиньев в секторе (угол 90°)
    const ring = (rho) => {
      const pts = [[px, pz]];
      for (let k = 0; k <= SEG; k++) {
        const a = (k / SEG) * (Math.PI / 2);
        pts.push([px + sx * rho * Math.cos(a), pz + sz * rho * Math.sin(a)]);
      }
      return pts;
    };
    const layer = (rA, rB, y0, y1) => {
      if (y1 - y0 < 0.005) return;
      const a = ring(rA), b = ring(rB);
      for (let k = 1; k <= SEG; k++) {
        const qa = [a[0], a[k], a[k + 1], a[k + 1]].map(([x, z]) => [x, y0, z]);
        const qb = [b[0], b[k], b[k + 1], b[k + 1]].map(([x, z]) => [x, y1, z]);
        solids.push(prismSolid(qa, qb, tag));
      }
    };
    const hb = h - rEdge;
    layer(Rc, Rc, 0, hb); // вертикальная часть — радиус постоянный
    let prevR = Rc, prevY = hb;
    for (let k = 1; k <= ARC_SEGS; k++) {
      const t = (k / ARC_SEGS) * (Math.PI / 2);
      const o = rEdge * (1 - Math.cos(t));      // отступ наружной плоскости
      const rho = Math.max(0.02, Rc - o);
      const y = hb + rEdge * Math.sin(t);
      layer(prevR, rho, prevY, y);
      prevR = rho; prevY = y;
    }
  };

  // Радиус скругления НАРУЖНОГО ВЕРТИКАЛЬНОГО угла корпуса.
  // Скругление верхних кромок нельзя честно свести в остром углу: два
  // валика пересекаются под 45°, и в углу либо вырастает горб, либо (если
  // подрезать торцы) остаются щели между ломтиками. Поэтому угол
  // скругляется тем же радиусом и по плану: получается четверть-цилиндра,
  // переходящая сверху в сферический сектор, — и валик обходит угол
  // непрерывно. Плоскости стенок остаются идеально ровными, уходит только
  // сам угол. Скругление ставится, если обе смежные стенки одинаковы по
  // скруглению и высоте; иначе угол остаётся как был (без подрезки).
  // Отступ наружной кромки стенки внутрь на высоте y — той же гранёной
  // дугой, что строит wallProfile. Нужен там, где угол скруглить нельзя
  // (у одной из стенок замок и её плоскость обязана быть ровной): торец
  // стенки с замком подрезается по дуге свободной стенки, а недорез
  // закрывает тело самой свободной стенки — щелей не остаётся.
  const arcInsetFn = (key, sym) => {
    const w = getWall(c, key);
    const r = rOuter(key, wallOut, sym);
    if (r < 0.05 || w.h <= r + 0.3) return 0;
    const hb = w.h - r;
    return (y) => {
      if (y <= hb + 1e-9) return 0;
      let ins = 0;
      for (let k = 1; k <= ARC_SEGS; k++) {
        const t = (k / ARC_SEGS) * (Math.PI / 2);
        ins = r * (1 - Math.cos(t));
        if (hb + r * Math.sin(t) >= y - 1e-9) break;
      }
      return ins;
    };
  };
  // Радиус скругления угла по плану: настройка контейнера, но не меньше
  // радиуса кромки (иначе угол вырождается) и не больше толщины стенки
  // (иначе дуга съела бы внутреннюю грань).
  const cornerR = (kA, symA, kB, symB) => {
    const rA = rOuter(kA, wallOut, symA), rB = rOuter(kB, wallOut, symB);
    if (rA < 0.05 || Math.abs(rA - rB) > 0.01) return 0;
    const wA = getWall(c, kA), wB = getWall(c, kB);
    if (Math.abs(wA.h - wB.h) > 0.01 || wA.h <= rA + 0.3) return 0;
    return Math.min(Math.max(c.cornerR ?? DEFAULT_CORNER_R, rA), wallOut, Math.min(W, D) / 4);
  };
  // экструзия профиля стенки вдоль отрезка s0..s1; mapFn(смещение, y, s) → точка
  // trim = {a, b} — насколько укоротить торцы: в углу корпуса на радиус
  // скругления угла, чтобы освободить место телу угла (см. addCorner)
  // Подрезка задаётся числом (постоянная — освобождает место телу угла)
  // либо функцией высоты (дуга соседней стенки в смешанном углу).
  const trimAt = (t, y) => (typeof t === "function" ? t(y) : t || 0);
  const pushProfiled = (parts, mapFn, s0, s1, tag, trim) => {
    for (const quad of parts) {
      let yTop = 0;
      for (const [, y] of quad) yTop = Math.max(yTop, y);
      const a = s0 + trimAt(trim?.a, yTop), b = s1 - trimAt(trim?.b, yTop);
      if (b - a < 0.02) continue;
      const qa = quad.map(([o, y]) => mapFn(o, y, a));
      const qb = quad.map(([o, y]) => mapFn(o, y, b));
      solids.push(prismSolid(qa, qb, tag));
    }
  };

  // высота кромки в точке frac (0..1) вдоль сегмента: спуск четверть-эллипсом —
  // горизонтальный старт на высоком конце, почти вертикальный финиш (как дуга,
  // нарисованная пользователем)
  const heightAt = (frac, h, drop, dropH) => {
    if (drop === "none") return h;
    const t = drop === "b" ? frac : 1 - frac; // t=0 — высокий конец
    return h - (h - dropH) * (1 - Math.cos((t * Math.PI) / 2));
  };

  // тело стенки с учётом спуска кромки: сегмент режется на ломтики вдоль
  // длины, каждый ломтик — призма между профилями двух соседних высот.
  // S0..S1 — полный пролёт сегмента (для непрерывности дуги через вырезы зон)
  const pushWallBody = (key, wc, thk, sym, s0, s1, S0, S1, mapFn, trim) => {
    const dropH = Math.min(wc.dropH, wc.h);
    if (wc.drop === "none" || wc.h - dropH < 0.3) {
      pushProfiled(wallProfile(thk, wc.h, wc.rnd, sym), mapFn, s0, s1, key, trim);
      return;
    }
    const N = 12;
    const span = S1 - S0 || 1;
    for (let k = 0; k < N; k++) {
      const sa = s0 + ((s1 - s0) * k) / N;
      const sb = s0 + ((s1 - s0) * (k + 1)) / N;
      const h0 = Math.max(0.4, heightAt((sa - S0) / span, wc.h, wc.drop, dropH));
      const h1 = Math.max(0.4, heightAt((sb - S0) / span, wc.h, wc.drop, dropH));
      const pa = wallProfile(thk, h0, wc.rnd, sym);
      const pb = wallProfile(thk, h1, wc.rnd, sym);
      // подрезка торцов — только у крайних ломтиков сегмента
      for (let q = 0; q < Math.max(pa.length, pb.length); q++) {
        const qa0 = pa[q] ?? pa[pa.length - 1], qb0 = pb[q] ?? pb[pb.length - 1];
        let yTop = 0;
        for (const [, y] of qa0) yTop = Math.max(yTop, y);
        const saT = sa + (k === 0 ? trimAt(trim?.a, yTop) : 0);
        const sbT = sb - (k === N - 1 ? trimAt(trim?.b, yTop) : 0);
        if (sbT - saT < 0.02) continue;
        const qa = qa0.map(([o, y]) => mapFn(o, y, saT));
        const qb = qb0.map(([o, y]) => mapFn(o, y, sbT));
        solids.push(prismSolid(qa, qb, key));
      }
    }
  };

  // Общая обвязка узорных стенок (соты и линии): геометрия рамки вокруг
  // узора, окно узора и примитивы «прямоугольник» / «брусок». Рамка —
  // две толщины этой стенки с каждой стороны; верхний пояс несёт
  // скругление кромки, поэтому рисуется профилем.
  const patternCtx = (key, wc, thk, sym, s0, s1, mapFn, trim) => {
    const strut = Math.max(1.2, Math.min(2.2, thk));
    const oA = sym ? -thk / 2 : 0, oB = sym ? thk / 2 : thk;
    const eA0 = typeof trim?.a === "number" ? trim.a : 0;
    const eB0 = typeof trim?.b === "number" ? trim.b : 0;
    const rect = (sa0, sb0, ya, yb) => {
      const sa = Math.max(sa0, s0 + eA0), sb = Math.min(sb0, s1 - eB0);
      if (sb - sa < 0.02) return;
      const q = [[sa, ya], [sb, ya], [sb, yb], [sa, yb]];
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    };
    const rail = 2 * thk;
    const yA = floor + rail;
    const parts = wallProfile(thk, wc.h, wc.rnd, sym);
    const hbTop = parts.length > 1 ? parts[0][2][1] : wc.h; // высота начала скругления
    const yB = Math.min(wc.h - rail, parts.length > 1 ? hbTop : wc.h - rail);
    const sA = s0 + rail, sB = s1 - rail;
    // сплошная стенка — когда окно узора не набирается
    const solidWall = (yFrom) =>
      pushProfiled(
        yFrom === undefined ? parts : parts.map((q, qi) => (qi === 0 ? q.map(([o, y]) => [o, y === 0 ? yFrom : y]) : q)),
        mapFn, s0, s1, key, trim
      );
    const drawFrame = () => {
      rect(s0, s1, 0, yA);   // нижний пояс
      solidWall(yB);         // верхний пояс (со скруглением кромки)
      rect(s0, sA, yA, yB);
      rect(sB, s1, yA, yB);  // боковые пояса
    };
    // отсечение отрезка по окну узора (алгоритм Лианга — Барски)
    const clipTo = (P1, P2, wLo, wHi, hLo, hHi) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - wLo, wHi - P1[0], P1[1] - hLo, hHi - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return { A: [P1[0] + t0 * dx, P1[1] + t0 * dy], B: [P1[0] + t1 * dx, P1[1] + t1 * dy], t0, t1 };
    };
    const clipSeg = (P1, P2) => {
      const c2 = clipTo(P1, P2, sA, sB, yA, yB);
      return c2 && [c2.A, c2.B];
    };
    // брусок решётки: отрезок, расширенный до полосы шириной strut
    const bar = (P1, P2) => {
      const c2 = clipSeg(P1, P2);
      if (!c2) return;
      const [A, B] = c2;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.4) return;
      const nx = (-dy / len) * (strut / 2), ny = (dx / len) * (strut / 2);
      const q = [[A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny]];
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    };
    return { strut, oA, oB, rect, yA, yB, sA, sB, hbTop, solidWall, drawFrame, clipTo, clipSeg, bar };
  };

  // Сотовая стенка: рамка (низ/верх/бока) + гексагональная решётка из
  // брусков. Гексы вершиной вверх: потолки отверстий — два ската по 60°,
  // печатается вертикально без поддержек. Верхний пояс несёт скругление.
  const buildHexWall = (key, wc, thk, sym, s0, s1, mapFn, trim) => {
    const { oA, oB, rect, yA, yB, sA, sB, solidWall, drawFrame, bar } =
      patternCtx(key, wc, thk, sym, s0, s1, mapFn, trim);
    if (sB - sA < wc.hexSize * 0.9 || yB - yA < wc.hexSize * 0.9) {
      solidWall(); // окно слишком маленькое — сплошная стенка
      return;
    }
    drawFrame();
    const Whex = wc.hexSize;               // ширина соты между вертикальными гранями
    const R = Whex / Math.sqrt(3);         // радиус до вершины
    // только ЦЕЛЫЕ ряды сот по высоте: неполный верхний ряд не рисуется,
    // остаток до верхнего пояса заливается пластиком
    let rows = 0;
    while (yA + R + rows * 1.5 * R + R <= yB + 0.01) rows++;
    if (rows < 1) {
      solidWall(yA); // ни одного целого ряда сот — заливаем окно
      return;
    }
    const colsN = Math.ceil((sB - sA) / Whex) + 2;
    for (let r = 0; r < rows; r++) {
      const yc = yA + R + r * 1.5 * R;
      const shift = r % 2 === 1 ? Whex / 2 : 0;
      for (let ci = -1; ci < colsN; ci++) {
        const sc = sA + Whex / 2 + ci * Whex + shift;
        const V = [
          [sc, yc + R], [sc + Whex / 2, yc + R / 2], [sc + Whex / 2, yc - R / 2],
          [sc, yc - R], [sc - Whex / 2, yc - R / 2], [sc - Whex / 2, yc + R / 2],
        ];
        for (let e = 0; e < 6; e++) bar(V[e], V[(e + 1) % 6]);
      }
    }
    // заливка над последним целым рядом: клинья между вершинами + сплошная полоса
    const yTip = yA + R + (rows - 1) * 1.5 * R + R;
    const yValley = yTip - R / 2;
    const shiftN = rows % 2 === 1 ? Whex / 2 : 0;
    for (let ci = -1; ci < colsN + 1; ci++) {
      const sc = sA + Whex / 2 + ci * Whex + shiftN;
      const P = [[sc, yValley], [sc - Whex / 2, yTip], [sc + Whex / 2, yTip]]
        .map(([sv, yv]) => [Math.min(sB, Math.max(sA, sv)), yv]);
      if (Math.max(P[0][0], P[1][0], P[2][0]) - Math.min(P[0][0], P[1][0], P[2][0]) < 0.3) continue;
      const q = [P[0], P[1], P[2], P[2]];
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    }
    if (yB - yTip > 0.05) rect(sA, sB, yTip, yB);
  };

  // Стенка с фоном из изогнутых случайных линий: рамка как у сот + два
  // семейства волнистых диагональных прядей (±45°, печатаются без поддержек).
  // Узор детерминированный: сид зависит от стенки; «перемешать» меняет сид.
  const buildLinesWall = (key, wc, thk, sym, s0, s1, mapFn, trim) => {
    const { strut, oA, oB, yA, yB, sA, sB, hbTop, solidWall, drawFrame, clipTo } =
      patternCtx(key, wc, thk, sym, s0, s1, mapFn, trim);
    const sp = Math.max(4, wc.lineStep);
    if (sB - sA < sp || yB - yA < sp) {
      solidWall();
      return;
    }
    drawFrame();
    // расширенное окно клипа: концы прядей заходят вглубь поясов рамки
    // и сращиваются с ними — без зазоров на стыке
    const ext = 2.3;
    const sAe = sA - ext, sBe = sB + ext;
    const yAe = Math.max(0.4, yA - 2.6);
    const yBe = Math.min(yB + 3, hbTop - 0.15, wc.h - 0.4);
    const clipT = (P1, P2) => clipTo(P1, P2, sAe, sBe, yAe, yBe);
    // жёсткие границы тела стенки: лента (с учётом полуширины!) никогда
    // не выходит за края сегмента, ниже дна и выше начала скругления
    const pushQ = (q0) => {
      const q = q0.map(([sv, yv]) => [
        Math.min(s1 - 0.05, Math.max(s0 + 0.05, sv)),
        Math.min(hbTop - 0.05, Math.max(0.2, yv)),
      ]);
      const area = Math.abs(
        q[0][0] * (q[1][1] - q[3][1]) + q[1][0] * (q[2][1] - q[0][1]) +
        q[2][0] * (q[3][1] - q[1][1]) + q[3][0] * (q[0][1] - q[2][1])
      ) / 2;
      if (area < 0.15) return; // полностью сплющенные о границу — отбрасываем
      solids.push(prismSolid(q.map(([sv, yv]) => mapFn(oA, yv, sv)), q.map(([sv, yv]) => mapFn(oB, yv, sv)), key));
    };
    const emitStrand = (pts, hws) => {
      let run = [], rw = [];
      const flush = () => { if (run.length > 1) for (const q of ribbonQuads(run, rw)) pushQ(q); run = []; rw = []; };
      for (let k = 0; k + 1 < pts.length; k++) {
        const c2 = clipT(pts[k], pts[k + 1]);
        if (!c2) { flush(); continue; }
        const wA = hws[k] + (hws[k + 1] - hws[k]) * c2.t0;
        const wB = hws[k] + (hws[k + 1] - hws[k]) * c2.t1;
        if (run.length === 0) { run.push(c2.A); rw.push(wA); }
        run.push(c2.B); rw.push(wB);
        if (c2.t1 < 0.999) flush();
      }
      flush();
    };
    const rng = mulberry32(hashStr(key) ^ Math.imul(wc.seed || 1, 2654435761));
    const hWin = yB - yA;
    for (const f of [1, -1]) {
      let base = sA - (f === 1 ? hWin : 0) - sp + rng() * sp;
      const end = sB + (f === -1 ? hWin : 0) + sp;
      for (; base < end; base += sp * 1.1 + rng() * sp * 0.4) {
        const A1 = sp * (0.25 + rng() * 0.4), l1 = sp * (1.8 + rng() * 1.6), p1 = rng() * 6.283;
        const A2 = sp * 0.18 * rng(), l2 = sp * (0.8 + rng() * 0.9), p2 = rng() * 6.283;
        const wBase = strut * (0.75 + rng() * 0.7);            // своя толщина у каждой пряди
        const lw = sp * (2.2 + rng() * 2), pw = rng() * 6.283; // волна толщины вдоль пряди
        const pts = [], hws = [];
        for (let y = yAe; ; y += 1.2) {
          const yy = Math.min(y, yBe);
          const t = yy - yA;
          const sv = base + f * t + A1 * Math.sin((t * 6.283) / l1 + p1) + A2 * Math.sin((t * 6.283) / l2 + p2);
          pts.push([sv, yy]);
          // градиент: у дна прядь заметно толще, кверху сходит на тонкую
          const grad = 1.45 - 0.75 * ((yy - yAe) / (yBe - yAe || 1));
          hws.push(Math.max(0.55, (wBase / 2) * grad * (1 + 0.35 * Math.sin((t * 6.283) / lw + pw))));
          if (yy >= yBe) break;
        }
        emitStrand(pts, hws);
      }
    }
  };

  // Наклонная сотовая панель: вместо сплошного клина пандуса — тонкая
  // панель вдоль гипотенузы с гекс-решёткой и рамкой (верхний стык со
  // стенкой, нижний пояс у дна, боковые пояса). Толщина по перпендикуляру
  // к наклонной плоскости ≈ толщине стенки.
  const buildHexRamp = (orient, facePos, dir, s0, s1, yTop, yBot0, run, thk, hexSize, embed, tag) => {
    const yBot = yBot0 - 0.6; // слегка утапливаем в дно для сращивания
    const dh = yTop - yBot;
    const Lslope = Math.hypot(run, dh);
    const thkH = Math.min((thk * Lslope) / Math.max(dh, 0.1), thk * 2.2); // горизонтальная толщина
    const toO = (u) => facePos + dir * ((u * run) / Lslope);
    const toY = (u) => yTop - (u * dh) / Lslope;
    const p3 = (o, y, sv) => (orient === "x" ? [o, y, sv] : [sv, y, o]);
    const pushQuadUS = (corners) => {
      // corners: 4 точки [u, s]; передняя грань на наклонной плоскости,
      // задняя — сдвиг по горизонтали внутрь (к стенке)
      const qa = corners.map(([u, sv]) => p3(toO(u), toY(u), sv));
      const qb = corners.map(([u, sv]) => p3(toO(u) - dir * thkH, toY(u), sv));
      solids.push(prismSolid(qa, qb, tag));
    };
    // рамка наклонной панели — тоже две толщины стенки
    const rail = 2 * thk;
    const uA = rail, uB = Lslope - rail;
    const sA = s0 + rail, sB = s1 - rail;
    if (sB - sA < hexSize * 0.9 || uB - uA < hexSize * 0.9) {
      solids.push(rampSolid(orient, facePos, dir, s0, s1, yTop, yBot0, run, embed, tag));
      return;
    }
    pushQuadUS([[0, s0], [uA, s0], [uA, s1], [0, s1]]);                 // верхний стык
    pushQuadUS([[uB, s0], [Lslope, s0], [Lslope, s1], [uB, s1]]);       // нижний пояс
    pushQuadUS([[uA, s0], [uB, s0], [uB, sA], [uA, sA]]);               // боковой пояс
    pushQuadUS([[uA, sB], [uB, sB], [uB, s1], [uA, s1]]);               // боковой пояс
    const strut = Math.max(1.2, Math.min(2.2, thk));
    const clipSeg = (P1, P2) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - uA, uB - P1[0], P1[1] - sA, sB - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return [[P1[0] + t0 * dx, P1[1] + t0 * dy], [P1[0] + t1 * dx, P1[1] + t1 * dy]];
    };
    const bar = (P1, P2) => {
      const c2 = clipSeg(P1, P2);
      if (!c2) return;
      const [A, B] = c2;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.4) return;
      const nx = (-dy / len) * (strut / 2), ny = (dx / len) * (strut / 2);
      pushQuadUS([[A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny]]);
    };
    const Whex = hexSize, R = Whex / Math.sqrt(3);
    // только целые ряды; неполный ряд у нижнего края ската заливается
    let rows = 0;
    while (uA + R + rows * 1.5 * R + R <= uB + 0.01) rows++;
    if (rows < 1) {
      pushQuadUS([[uA, s0], [uB, s0], [uB, s1], [uA, s1]]);
      return;
    }
    const colsN = Math.ceil((sB - sA) / Whex) + 2;
    for (let r = 0; r < rows; r++) {
      const uc = uA + R + r * 1.5 * R;
      const shift = r % 2 === 1 ? Whex / 2 : 0;
      for (let ci = -1; ci < colsN; ci++) {
        const sc = sA + Whex / 2 + ci * Whex + shift;
        const V = [
          [uc + R, sc], [uc + R / 2, sc + Whex / 2], [uc - R / 2, sc + Whex / 2],
          [uc - R, sc], [uc - R / 2, sc - Whex / 2], [uc + R / 2, sc - Whex / 2],
        ];
        for (let e = 0; e < 6; e++) bar(V[e], V[(e + 1) % 6]);
      }
    }
    const uTip = uA + R + (rows - 1) * 1.5 * R + R;
    const uValley = uTip - R / 2;
    const shiftN = rows % 2 === 1 ? Whex / 2 : 0;
    for (let ci = -1; ci < colsN + 1; ci++) {
      const sc = sA + Whex / 2 + ci * Whex + shiftN;
      const P = [[uValley, sc], [uTip, sc - Whex / 2], [uTip, sc + Whex / 2]]
        .map(([uv, sv]) => [uv, Math.min(sB, Math.max(sA, sv))]);
      if (Math.max(P[0][1], P[1][1], P[2][1]) - Math.min(P[0][1], P[1][1], P[2][1]) < 0.3) continue;
      pushQuadUS([P[0], P[1], P[2], P[2]]);
    }
    if (uB - uTip > 0.05) pushQuadUS([[uTip, sA], [uB, sA], [uB, sB], [uTip, sB]]);
  };

  // Наклонная панель с линиями: каркас как у сотового пандуса + пряди
  const buildLinesRamp = (orient, facePos, dir, s0, s1, yTop, yBot0, run, thk, wc, embed, tag) => {
    const yBot = yBot0 - 0.6;
    const dh = yTop - yBot;
    const Lslope = Math.hypot(run, dh);
    const thkH = Math.min((thk * Lslope) / Math.max(dh, 0.1), thk * 2.2);
    const toO = (u) => facePos + dir * ((u * run) / Lslope);
    const toY = (u) => yTop - (u * dh) / Lslope;
    const p3 = (o, y, sv) => (orient === "x" ? [o, y, sv] : [sv, y, o]);
    const pushQuadUS = (corners) => {
      const qa = corners.map(([u, sv]) => p3(toO(u), toY(u), sv));
      const qb = corners.map(([u, sv]) => p3(toO(u) - dir * thkH, toY(u), sv));
      solids.push(prismSolid(qa, qb, tag));
    };
    // рамка наклонной панели — тоже две толщины стенки
    const rail = 2 * thk;
    const uA = rail, uB = Lslope - rail;
    const sA = s0 + rail, sB = s1 - rail;
    const sp = Math.max(4, wc.lineStep);
    if (sB - sA < sp || uB - uA < sp) {
      solids.push(rampSolid(orient, facePos, dir, s0, s1, yTop, yBot0, run, embed, tag));
      return;
    }
    pushQuadUS([[0, s0], [uA, s0], [uA, s1], [0, s1]]);
    pushQuadUS([[uB, s0], [Lslope, s0], [Lslope, s1], [uB, s1]]);
    pushQuadUS([[uA, s0], [uB, s0], [uB, sA], [uA, sA]]);
    pushQuadUS([[uA, sB], [uB, sB], [uB, s1], [uA, s1]]);
    const strut = Math.max(1.2, Math.min(2.2, thk));
    const ext = 2.3;
    const sAe = sA - ext, sBe = sB + ext;
    const uAe = Math.max(0.3, uA - 2.6);
    const uBe = Math.min(uB + 3, Lslope - 0.3);
    const clipT = (P1, P2) => {
      let t0 = 0, t1 = 1;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
      const p = [-dx, dx, -dy, dy], q = [P1[0] - uAe, uBe - P1[0], P1[1] - sAe, sBe - P1[1]];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
          const r = q[i] / p[i];
          if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
          else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
      }
      return { A: [P1[0] + t0 * dx, P1[1] + t0 * dy], B: [P1[0] + t1 * dx, P1[1] + t1 * dy], t0, t1 };
    };
    const emitStrand = (pts, hws) => {
      let run = [], rw = [];
      const flush = () => {
        if (run.length > 1)
          for (const q0 of ribbonQuads(run, rw)) {
            const q = q0.map(([uv, sv]) => [
              Math.min(Lslope - 0.05, Math.max(0.05, uv)),
              Math.min(s1 - 0.05, Math.max(s0 + 0.05, sv)),
            ]);
            const area = Math.abs(
              q[0][0] * (q[1][1] - q[3][1]) + q[1][0] * (q[2][1] - q[0][1]) +
              q[2][0] * (q[3][1] - q[1][1]) + q[3][0] * (q[0][1] - q[2][1])
            ) / 2;
            if (area >= 0.15) pushQuadUS(q);
          }
        run = [];
        rw = [];
      };
      for (let k = 0; k + 1 < pts.length; k++) {
        const c2 = clipT(pts[k], pts[k + 1]);
        if (!c2) { flush(); continue; }
        const wA = hws[k] + (hws[k + 1] - hws[k]) * c2.t0;
        const wB = hws[k] + (hws[k + 1] - hws[k]) * c2.t1;
        if (run.length === 0) { run.push(c2.A); rw.push(wA); }
        run.push(c2.B); rw.push(wB);
        if (c2.t1 < 0.999) flush();
      }
      flush();
    };
    const rng = mulberry32(hashStr(tag + "r") ^ Math.imul(wc.seed || 1, 2654435761));
    const wWin = uB - uA;
    for (const f of [1, -1]) {
      let base = sA - (f === 1 ? wWin : 0) - sp + rng() * sp;
      const end = sB + (f === -1 ? wWin : 0) + sp;
      for (; base < end; base += sp * 1.1 + rng() * sp * 0.4) {
        const A1 = sp * (0.25 + rng() * 0.4), l1 = sp * (1.8 + rng() * 1.6), p1 = rng() * 6.283;
        const A2 = sp * 0.18 * rng(), l2 = sp * (0.8 + rng() * 0.9), p2 = rng() * 6.283;
        const wBase = strut * (0.75 + rng() * 0.7);
        const lw = sp * (2.2 + rng() * 2), pw = rng() * 6.283;
        const pts = [], hws = [];
        for (let u = uAe; ; u += 1.2) {
          const uu = Math.min(u, uBe);
          const t = uu - uA;
          const sv = base + f * t + A1 * Math.sin((t * 6.283) / l1 + p1) + A2 * Math.sin((t * 6.283) / l2 + p2);
          pts.push([uu, sv]);
          // низ ската (большие u) — толще, к верхнему стыку — тоньше
          const grad = 0.7 + 0.75 * ((uu - uAe) / (uBe - uAe || 1));
          hws.push(Math.max(0.55, (wBase / 2) * grad * (1 + 0.35 * Math.sin((t * 6.283) / lw + pw))));
          if (uu >= uBe) break;
        }
        emitStrand(pts, hws);
      }
    }
  };

  // диспетчер: узорные заполнения (если нет спуска) либо обычное тело стенки
  const pushWallAuto = (key, wc, thk, sym, s0, s1, S0, S1, mapFn, trim) => {
    if (wc.face === "hex" && wc.drop === "none") buildHexWall(key, wc, thk, sym, s0, s1, mapFn, trim);
    else if (wc.face === "lines" && wc.drop === "none") buildLinesWall(key, wc, thk, sym, s0, s1, mapFn, trim);
    else pushWallBody(key, wc, thk, sym, s0, s1, S0, S1, mapFn, trim);
  };

  // ── Радиусы наружных вертикальных углов ──
  // Считаются до построения стенок и пола: стенки укорачивают торцы на эту
  // величину, пол вырезает у себя квадратик угла, а само тело угла ставится
  // отдельно (addCorner).
  const symN = !conn.N, symS = !conn.S, symW = !conn.W, symE = !conn.E;
  const kN0 = "o:n:0", kNL = `o:n:${L.nColsAt(0) - 1}`;
  const kS0 = "o:s:0", kSL = `o:s:${L.nColsAt(L.nRows - 1) - 1}`;
  const kW0 = "o:w:0", kWL = `o:w:${L.nRows - 1}`;
  const kE0 = "o:e:0", kEL = `o:e:${L.nRows - 1}`;
  const rNW = cornerR(kN0, symN, kW0, symW);
  const rNE = cornerR(kNL, symN, kE0, symE);
  const rSW = cornerR(kS0, symS, kWL, symW);
  const rSE = cornerR(kSL, symS, kEL, symE);
  // Что подрезать в углу. Скруглённый угол: обе стенки на постоянный
  // радиус (место для тела угла). Смешанный угол (у одной стенки замок):
  // только стенка с замком, по дуге свободной — иначе валик свободной
  // стенки упирался бы в квадратный торец соседа.
  const cut = (r, meKey, meSym, otherKey, otherSym) => {
    if (r >= 0.05) return r;
    const rMe = rOuter(meKey, wallOut, meSym), rOther = rOuter(otherKey, wallOut, otherSym);
    return rMe < 0.05 && rOther >= 0.05 ? arcInsetFn(otherKey, otherSym) : 0;
  };
  const cutNW_ns = cut(rNW, kN0, symN, kW0, symW), cutNW_we = cut(rNW, kW0, symW, kN0, symN);
  const cutNE_ns = cut(rNE, kNL, symN, kE0, symE), cutNE_we = cut(rNE, kE0, symE, kNL, symN);
  const cutSW_ns = cut(rSW, kS0, symS, kWL, symW), cutSW_we = cut(rSW, kWL, symW, kS0, symS);
  const cutSE_ns = cut(rSE, kSL, symS, kEL, symE), cutSE_we = cut(rSE, kEL, symE, kSL, symS);
  // квадратики углов, которые пол не должен занимать (их закрывает тело угла)
  const cornerCuts = [
    [-W / 2, -D / 2, rNW], [W / 2, -D / 2, rNE],
    [-W / 2, D / 2, rSW], [W / 2, D / 2, rSE],
  ].filter(([, , r]) => r >= 0.05);
  // прямоугольник плиты минус квадратики углов: угол становится скруглённым
  const rectMinusCorners = (x0, z0, x1, z1) => {
    let out = [[x0, z0, x1, z1]];
    for (const [cx, cz, r] of cornerCuts) {
      const nx = [];
      for (const [a0, b0, a1, b1] of out) {
        const qx0 = Math.min(cx, cx + (cx < 0 ? r : -r)), qx1 = Math.max(cx, cx + (cx < 0 ? r : -r));
        const qz0 = Math.min(cz, cz + (cz < 0 ? r : -r)), qz1 = Math.max(cz, cz + (cz < 0 ? r : -r));
        if (qx1 <= a0 + 0.001 || qx0 >= a1 - 0.001 || qz1 <= b0 + 0.001 || qz0 >= b1 - 0.001) { nx.push([a0, b0, a1, b1]); continue; }
        // режем по X, затем остаток по Z — всегда не больше двух кусков
        if (qx0 <= a0 + 0.001) { if (qx1 < a1 - 0.001) nx.push([qx1, b0, a1, b1]); }
        else nx.push([a0, b0, qx0, b1]);
        const rx0 = Math.max(a0, qx0), rx1 = Math.min(a1, qx1);
        if (rx1 - rx0 > 0.001) {
          if (qz0 <= b0 + 0.001) { if (qz1 < b1 - 0.001) nx.push([rx0, qz1, rx1, b1]); }
          else nx.push([rx0, b0, rx1, qz0]);
        }
        if (qx0 > a0 + 0.001 && qx1 < a1 - 0.001) nx.push([qx1, b0, a1, b1]);
      }
      out = nx;
    }
    return out.filter(([a0, b0, a1, b1]) => a1 - a0 > 0.05 && b1 - b0 > 0.05);
  };

  // ── Фиксированные ячейки: вычитание их зоны из плит и рёбер ──
  // Вычесть footprint всех боксов из прямоугольника: остаётся ≤4 куска
  // на бокс — сетка и полы обтекают «контейнер внутри контейнера»
  const rectMinusBoxes = (xa, za, xb, zb) => {
    let rects = [[xa, za, xb, zb]];
    for (const f of L.fixed) {
      const out = [];
      for (const [x0, z0, x1, z1] of rects) {
        if (f.fx1 <= x0 + 0.01 || f.fx0 >= x1 - 0.01 || f.fz1 <= z0 + 0.01 || f.fz0 >= z1 - 0.01) {
          out.push([x0, z0, x1, z1]);
          continue;
        }
        const iz0 = Math.max(z0, f.fz0), iz1 = Math.min(z1, f.fz1);
        if (iz0 > z0 + 0.05) out.push([x0, z0, x1, iz0]);
        if (iz1 < z1 - 0.05) out.push([x0, iz1, x1, z1]);
        const ix0 = Math.max(x0, f.fx0), ix1 = Math.min(x1, f.fx1);
        if (ix0 > x0 + 0.05) out.push([x0, iz0, ix0, iz1]);
        if (ix1 < x1 - 0.05) out.push([ix1, iz0, x1, iz1]);
      }
      rects = out;
    }
    return rects.filter(([x0, z0, x1, z1]) => x1 - x0 > 0.1 && z1 - z0 > 0.1);
  };
  // зоны боксов, пересекающих линию x=const (для подрезки верт. перегородок)
  const boxZonesAtX = (x) =>
    L.fixed.filter((f) => x > f.fx0 - 0.01 && x < f.fx1 + 0.01).map((f) => [f.fz0, f.fz1]).sort((a, b) => a[0] - b[0]);
  const boxZonesAtZ = (z) =>
    L.fixed.filter((f) => z > f.fz0 - 0.01 && z < f.fz1 + 0.01).map((f) => [f.fx0, f.fx1]).sort((a, b) => a[0] - b[0]);
  // зоны боксов, прижатых к внешней стенке (для подрезки её пандусов)
  const boxZonesAtWall = (side) =>
    L.fixed.filter((f) => !f.own[side]).map((f) => (side === "n" || side === "s" ? [f.fx0, f.fx1] : [f.fz0, f.fz1])).sort((a, b) => a[0] - b[0]);

  // пол — по ячейкам: у каждой свой уровень (лесенка). Плита заходит под
  // окружающие стенки (они и есть «ножки»); под поднятым полом — пустота.
  // Раскладка «кирпичная»: у каждого ряда свои ячейки (i — индекс в ряду j).
  const cellLvl = (i, j) => Math.min(getCellLvl(c, i, j), H - 4);
  for (let j = 0; j < L.nRows; j++)
    for (let i = 0; i < L.nColsAt(j); i++) {
      const lvl = cellLvl(i, j);
      // заход плиты под стенки — строго по толщине конкретной стенки:
      // под внешнюю на wallOut, под перегородку на wall. Ни плита, ни
      // рёбра под ней не пересекают внутренний объём соседней ячейки.
      const xa = Math.max(-W / 2, L.cx0(i, j) - (i === 0 ? wallOut : wall));
      const xb = Math.min(W / 2, L.cx0(i, j) + L.cw(i, j) + (i === L.nColsAt(j) - 1 ? wallOut : wall));
      const za = Math.max(-D / 2, L.cz0(j) - (j === 0 ? wallOut : wall));
      const zb = Math.min(D / 2, L.cz0(j) + L.cd(j) + (j === L.nRows - 1 ? wallOut : wall));
      const cc = (c.cells && c.cells[i + ":" + j]) || {};
      const boxOverlap = L.fixed.some((f) => f.fx1 > xa && f.fx0 < xb && f.fz1 > za && f.fz0 < zb);
      const fDir = boxOverlap ? "none" : (cc.tiltDir || "none"); // наклонный пол не должен войти в бокс
      const fA = cc.tiltA ?? 5; // сторона выбрана — наклон есть, угол по умолчанию 5°
      if (fDir === "none" || fA < 0.5) {
        for (const [bx0b, bz0b, bx1b, bz1b] of rectMinusBoxes(xa, za, xb, zb))
          for (const [px0, pz0, px1, pz1] of rectMinusCorners(bx0b, bz0b, bx1b, bz1b))
            solids.push(boxSolid((px0 + px1) / 2, lvl + floor / 2, (pz0 + pz1) / 2, px1 - px0, floor, pz1 - pz0, "floor"));
      } else {
        // наклонный пол: клин, спускающийся к выбранной стороне; верх высокой
        // кромки ограничен высотой контейнера
        const span = fDir === "w" || fDir === "e" ? L.cw(i, j) : L.cd(j);
        const rise = Math.min(span * Math.tan((fA * Math.PI) / 180), Math.max(0, H - lvl - floor - 1));
        const yLo = lvl + floor, yHi = lvl + floor + rise;
        let capA, capB;
        if (fDir === "e") {
          // низкая сторона — правая (x+)
          const q = [[xa, lvl], [xb, lvl], [xb, yLo], [xa, yHi]];
          capA = q.map(([x, y]) => [x, y, za]); capB = q.map(([x, y]) => [x, y, zb]);
        } else if (fDir === "w") {
          const q = [[xa, lvl], [xb, lvl], [xb, yHi], [xa, yLo]];
          capA = q.map(([x, y]) => [x, y, za]); capB = q.map(([x, y]) => [x, y, zb]);
        } else if (fDir === "n") {
          // низкая сторона — ближняя (z-)
          const q = [[za, lvl], [zb, lvl], [zb, yHi], [za, yLo]];
          capA = q.map(([z, y]) => [xa, y, z]); capB = q.map(([z, y]) => [xb, y, z]);
        } else {
          const q = [[za, lvl], [zb, lvl], [zb, yLo], [za, yHi]];
          capA = q.map(([z, y]) => [xa, y, z]); capB = q.map(([z, y]) => [xb, y, z]);
        }
        solids.push(prismSolid(capA, capB, "floor"));
      }
      // минимальное заполнение под поднятой плитой: редкая сетка рёбер,
      // печатаются со стола и служат опорой для пола (мосты ≤ ~12 мм)
      if (lvl > 2) {
        const ribT = 1.0, spacing = 12;
        const nAlongX = Math.max(0, Math.floor((zb - za) / spacing));
        for (let k = 1; k <= nAlongX; k++) {
          const z = za + ((zb - za) * k) / (nAlongX + 1);
          for (const [a, b] of splitRange(xa, xb, boxZonesAtZ(z)))
            solids.push(boxSolid((a + b) / 2, (lvl + 0.4) / 2, z, b - a, lvl + 0.4, ribT, "floor"));
        }
        const nAlongZ = Math.max(0, Math.floor((xb - xa) / spacing));
        for (let k = 1; k <= nAlongZ; k++) {
          const x = xa + ((xb - xa) * k) / (nAlongZ + 1);
          for (const [a, b] of splitRange(za, zb, boxZonesAtX(x)))
            solids.push(boxSolid(x, (lvl + 0.4) / 2, (a + b) / 2, ribT, lvl + 0.4, b - a, "floor"));
        }
      }
    }

  // внешние стенки N/S (сегменты вдоль X), с вырезом под зоны соединителей;
  // сегменты идут по ячейкам крайнего ряда — ближнего (N) или дальнего (S)
  for (const [side, zones, jRow] of [["n", zN, 0], ["s", zS, L.nRows - 1]]) {
    for (let i = 0; i < L.nColsAt(jRow); i++) {
      const x0 = L.cx0(i, jRow), x1 = x0 + L.cw(i, jRow);
      const bx0 = Math.max(-W / 2, x0 - wallOut), bx1 = Math.min(W / 2, x1 + wallOut);
      const key = `o:${side}:${i}`;
      const wc = getWall(c, key);
      if (wc.h > 0.3) {
        // сторона без замка: кромка скругляется с обеих сторон (симметрично);
        // со замком — только внутренняя, наружная плоскость строго ровная
        const sym = !conn[side === "n" ? "N" : "S"];
        const off = sym ? wallOut / 2 : 0;
        const mapFn = side === "n"
          ? (o, y, x) => [x, y, -D / 2 + off + o]
          : (o, y, x) => [x, y, D / 2 - off - o];
        // в углах корпуса торец подрезается под скругление W/E-стенки
        const rL = side === "n" ? cutNW_ns : cutSW_ns, rR = side === "n" ? cutNE_ns : cutSE_ns;
        const cardVs = cardHoleVs(wc, bx0, bx1, zones);
        for (const [a, b] of splitRange(bx0, bx1, withCardZones(zones, cardVs)))
            pushWallAuto(key, wc, wallOut, sym, a, b, bx0, bx1, mapFn, {
              a: a <= -W / 2 + 0.01 ? rL : 0,
              b: b >= W / 2 - 0.01 ? rR : 0,
            });
        for (const vc of cardVs) pushCardHolePieces(key, wc, sym, vc, mapFn);
        const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
        // пандус не должен войти в полость прижатого к стенке бокса
        for (const [ra, rb] of splitRange(x0, x1, boxZonesAtWall(side)))
          addRamp("z", side === "n" ? -D / 2 + wallOut : D / 2 - wallOut, side === "n" ? 1 : -1, ra, rb, hRamp, wc.t1, L.cd(jRow), wallOut - 0.4, wallOut, wc, floor + cellLvl(i, jRow), key);
      }
    }
  }
  // внешние стенки W/E (сегменты вдоль Z)
  for (let j = 0; j < L.nRows; j++) {
    const z0 = L.cz0(j), z1 = z0 + L.cd(j);
    const bz0 = Math.max(-D / 2, z0 - wallOut), bz1 = Math.min(D / 2, z1 + wallOut);
    for (const [side, zones] of [["w", zW], ["e", zE]]) {
      const key = `o:${side}:${j}`;
      const wc = getWall(c, key);
      if (wc.h > 0.3) {
        const sym = !conn[side === "w" ? "W" : "E"];
        const off = sym ? wallOut / 2 : 0;
        const mapFn = side === "w"
          ? (o, y, z) => [-W / 2 + off + o, y, z]
          : (o, y, z) => [W / 2 - off - o, y, z];
        const rT = side === "w" ? cutNW_we : cutNE_we, rB = side === "w" ? cutSW_we : cutSE_we;
        const cardVs = cardHoleVs(wc, bz0, bz1, zones);
        for (const [a, b] of splitRange(bz0, bz1, withCardZones(zones, cardVs)))
            pushWallAuto(key, wc, wallOut, sym, a, b, bz0, bz1, mapFn, {
              a: a <= -D / 2 + 0.01 ? rT : 0,
              b: b >= D / 2 - 0.01 ? rB : 0,
            });
        for (const vc of cardVs) pushCardHolePieces(key, wc, sym, vc, mapFn);
        const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
        for (const [ra, rb] of splitRange(z0, z1, boxZonesAtWall(side)))
          addRamp("x", side === "w" ? -W / 2 + wallOut : W / 2 - wallOut, side === "w" ? 1 : -1, ra, rb, hRamp, wc.t1, L.cw(side === "w" ? 0 : L.nColsAt(j) - 1, j), wallOut - 0.4, wallOut, wc, floor + cellLvl(side === "w" ? 0 : L.nColsAt(j) - 1, j), key);
      }
    }
  }

  // тела наружных вертикальных углов
  const eN = rOuter(kN0, wallOut, symN), eS = rOuter(kS0, wallOut, symS);
  const eW = rOuter(kW0, wallOut, symW), eE = rOuter(kE0, wallOut, symE);
  addCorner(-W / 2 + rNW, -D / 2 + rNW, -1, -1, getWall(c, kN0).h, Math.min(eN, eW), rNW, kN0);
  addCorner(W / 2 - rNE, -D / 2 + rNE, 1, -1, getWall(c, kNL).h, Math.min(eN, eE), rNE, kNL);
  addCorner(-W / 2 + rSW, D / 2 - rSW, -1, 1, getWall(c, kS0).h, Math.min(eS, eW), rSW, kS0);
  addCorner(W / 2 - rSE, D / 2 - rSE, 1, 1, getWall(c, kSL).h, Math.min(eS, eE), rSE, kSL);

  // галтели во внутренних углах самого корпуса (4 угла контейнера)
  {
    const cx = W / 2 - wallOut, cz = D / 2 - wallOut;
    const nL = "o:n:0", nR = `o:n:${L.nColsAt(0) - 1}`;
    const sL = "o:s:0", sR = `o:s:${L.nColsAt(L.nRows - 1) - 1}`;
    const wT = "o:w:0", wB = `o:w:${L.nRows - 1}`, eT = "o:e:0", eB = `o:e:${L.nRows - 1}`;
    // высота галтели — до начала скругления кромок обеих стенок
    const hCorner = (kA, kB) => Math.min(getWall(c, kA).h, getWall(c, kB).h);
    const rCorner = (kA, symA, kB, symB) => Math.min(rEff(kA, wallOut, symA), rEff(kB, wallOut, symB));
    if (flatWall(nL) && flatWall(wT)) addFillet(-cx, -cz, 1, 1, hCorner(nL, wT), nL, -1, rCorner(nL, symN, wT, symW));
    if (flatWall(nR) && flatWall(eT)) addFillet(cx, -cz, -1, 1, hCorner(nR, eT), nR, -1, rCorner(nR, symN, eT, symE));
    if (flatWall(sL) && flatWall(wB)) addFillet(-cx, cz, 1, -1, hCorner(sL, wB), sL, -1, rCorner(sL, symS, wB, symW));
    if (flatWall(sR) && flatWall(eB)) addFillet(cx, cz, -1, -1, hCorner(sR, eB), sR, -1, rCorner(sR, symS, eB, symE));
  }

  // В male-зонах стенка ставится обратно (несёт рельс или шип) — тем же
  // профилем, той же высотой и скруглением, что стенка этой зоны, иначе
  // на месте замка получается ступенька по высоте или провал в кромке
  const zoneWall = (side, u) => {
    const mapFn = side === "n" ? (o, y, x) => [x, y, -D / 2 + o]
      : side === "s" ? (o, y, x) => [x, y, D / 2 - o]
      : side === "w" ? (o, y, z) => [-W / 2 + o, y, z]
      : (o, y, z) => [W / 2 - o, y, z];
    pushProfiled(wallProfile(wallOut, Math.max(1, u.h), u.rnd, false), mapFn,
      u.vc - CONN.bossW / 2, u.vc + CONN.bossW / 2, "conn");
  };
  if (conn.S?.male) for (const u of uS) zoneWall("s", u);
  if (conn.N?.male) for (const u of uN) zoneWall("n", u);
  if (conn.E?.male) for (const u of uE) zoneWall("e", u);
  if (conn.W?.male) for (const u of uW) zoneWall("w", u);

  // ── Вставные стенки: направляющие на внутренних гранях ──
  // Пара вертикальных рёбер образует канал, в который перегородка
  // вдвигается сверху уже после печати. Рёбра ставятся НА грань: внутри
  // толщины внешней стенки живёт паз соединителя, выборка бы его срезала.
  // Сверху рёбра сходят на нет — это заходная воронка при вставке.
  {
    const ins = insertsOf(c);
    const half = ins.thk / 2 + ins.clr;
    const LEAD = 2; // высота заходного скоса
    for (const axis of ["x", "z"]) {
      const slots = insertSlots(c, axis);
      if (!slots.length) continue;
      // ребро: коробка от грани внутрь ячейки, сверху со скосом
      const rib = (u0, u1, faceP, dirP, yBot, yTop, tag) => {
        if (yTop - yBot < 1) return;
        const yMid = Math.max(yBot, yTop - LEAD);
        const q = (p0, p1, y) => (axis === "x"
          ? [[u0, y, p0], [u1, y, p0], [u1, y, p1], [u0, y, p1]]
          : [[p0, y, u0], [p0, y, u1], [p1, y, u1], [p1, y, u0]]);
        const pIn = faceP + dirP * ins.proj;
        if (yMid > yBot + 0.05) solids.push(prismSolid(q(faceP, pIn, yBot), q(faceP, pIn, yMid), tag));
        // скос: выступ сходит к нулю у самого верха
        solids.push(prismSolid(q(faceP, pIn, yMid), q(faceP, faceP, yTop), tag));
      };
      for (const u of slots) {
        // место пропускается, если на нём уже стоит печатная перегородка
        // (иначе ребро наросло бы прямо на неё) или тут стоит бокс
        const blockedByBox = L.fixed.some((f) =>
          axis === "x" ? u > f.fx0 - half && u < f.fx1 + half : u > f.fz0 - half && u < f.fz1 + half);
        if (blockedByBox) continue;
        let blocked = false;
        if (axis === "x")
          for (let j = 0; j < L.nRows && !blocked; j++)
            for (let i = 0; i < L.nColsAt(j) - 1; i++)
              if (Math.abs(L.cx0(i, j) + L.cw(i, j) + wall / 2 - u) < half + wall) { blocked = true; break; }
        else
          for (let j = 0; j < L.nRows - 1; j++)
            if (Math.abs(L.cz0(j) + L.cd(j) + wall / 2 - u) < half + wall) { blocked = true; break; }
        if (blocked) continue;

        // ряд, в котором стоит вставка «вдоль» (рёбра — на его стенках W/E)
        let jz = 0, bz = -1e9;
        if (axis === "z")
          for (let jj = 0; jj < L.nRows; jj++) {
            const d = Math.min(u - L.cz0(jj), L.cz0(jj) + L.cd(jj) - u);
            if (d > bz) { bz = d; jz = jj; }
          }
        // две противоположные стенки, поперёк которых идёт вставка
        const sides = axis === "x"
          ? [["n", 0, -D / 2 + wallOut, 1], ["s", L.nRows - 1, D / 2 - wallOut, -1]]
          : [["w", jz, -W / 2 + wallOut, 1], ["e", jz, W / 2 - wallOut, -1]];
        for (const [side, rowHint, faceP, dirP] of sides) {
          const i = axis === "x" ? L.cellIndexAt(rowHint, u) : side === "w" ? 0 : L.nColsAt(rowHint) - 1;
          const j = rowHint;
          const key = axis === "x" ? `o:${side}:${i}` : `o:${side}:${j}`;
          const wc = getWall(c, key);
          if (wc.h <= 1 || !flatWall(key)) continue; // на пандусе направляющая не нужна
          const yBot = floor + cellLvl(i, j);
          const yTop = Math.min(wc.h, H) - 1;
          rib(u - half - ins.rail, u - half, faceP, dirP, yBot, yTop, key);
          rib(u + half, u + half + ins.rail, faceP, dirP, yBot, yTop, key);
        }
        // вставка «на месте» — только для превью, в экспорт контейнера не идёт
        if (ins.show && opts.inserts !== false) solids.push(...insertInPlace(c, axis, u));
      }
    }
  }

  // вертикальные перегородки — свои в каждом ряду («кирпичная» раскладка,
  // перегородки соседних рядов не обязаны совпадать)
  const hasDividerAt = (j2, x) => {
    if (j2 < 0 || j2 >= L.nRows) return false;
    for (let ii = 0; ii < L.nColsAt(j2) - 1; ii++)
      if (Math.abs(L.cx0(ii, j2) + L.cw(ii, j2) + wall / 2 - x) < 0.01) return true;
    return false;
  };
  for (let j = 0; j < L.nRows; j++) {
    for (let i = 0; i < L.nColsAt(j) - 1; i++) {
      const xd = L.cx0(i, j) + L.cw(i, j) + wall / 2;
      const key = `v:${i}:${j}`;
      const wc = getWall(c, key);
      const z0 = L.cz0(j), z1 = z0 + L.cd(j);
      // заход конца в соседнюю стенку: на wallOut, если там продолжение
      // той же перегородки (сращивание), иначе строго до дальней грани
      // горизонтальной перегородки — чтобы не торчать в чужой ячейке
      const extN = j === 0 || hasDividerAt(j - 1, xd) ? wallOut : wall;
      const extS = j === L.nRows - 1 || hasDividerAt(j + 1, xd) ? wallOut : wall;
      const bz0 = Math.max(-D / 2 + wallOut * 0.5, z0 - extN), bz1 = Math.min(D / 2 - wallOut * 0.5, z1 + extS);
      if (wc.h > 0.3) {
        // сегменты перегородки обтекают фиксированные боксы
        const bZones = boxZonesAtX(xd);
        const segs = splitRange(bz0, bz1, bZones);
        for (const [a, b] of segs) pushWallAuto(key, wc, wall, true, a, b, bz0, bz1, (o, y, z) => [xd + o, y, z]);
        const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
        for (const [a, b] of splitRange(z0, z1, bZones)) {
          addRamp("x", xd - wall / 2, -1, a, b, hRamp, wc.t1, L.cw(i, j), wall / 2, wall, wc, floor + cellLvl(i, j), key);
          addRamp("x", xd + wall / 2, 1, a, b, hRamp, wc.t2, L.cw(i + 1, j), wall / 2, wall, wc, floor + cellLvl(i + 1, j), key);
        }
        // галтели на концах: у корпуса, у горизонтальных перегородок
        // (Т-стыки, в том числе кирпичные) — если конец дошёл до стыка
        // и обе смыкающиеся стенки вертикальны (без пандусов)
        const meFlat = flatWall(key);
        const rMe = rEff(key, wall, true); // скругление самой перегородки
        if (segs.length && segs[0][0] <= bz0 + 0.01) {
          const other = j === 0 ? `o:n:${i}` : `h:${j - 1}:${L.cellIndexAt(j - 1, xd)}`;
          if (meFlat && flatWall(other)) {
            const zA = j === 0 ? -D / 2 + wallOut : z0;
            const rOther = j === 0 ? rEff(other, wallOut, !conn.N) : rEff(other, wall, true);
            const hF = Math.min(hAtEnd(wc, true), getWall(c, other).h);
            const rF = Math.min(rMe, rOther);
            addFillet(xd - wall / 2, zA, -1, 1, hF, key, -1, rF);
            addFillet(xd + wall / 2, zA, 1, 1, hF, key, -1, rF);
          }
        }
        if (segs.length && segs[segs.length - 1][1] >= bz1 - 0.01) {
          const other = j === L.nRows - 1 ? `o:s:${i}` : `h:${j}:${i}`;
          if (meFlat && flatWall(other)) {
            const zB = j === L.nRows - 1 ? D / 2 - wallOut : z1;
            const rOther = j === L.nRows - 1 ? rEff(other, wallOut, !conn.S) : rEff(other, wall, true);
            const hF = Math.min(hAtEnd(wc, false), getWall(c, other).h);
            const rF = Math.min(rMe, rOther);
            addFillet(xd - wall / 2, zB, -1, -1, hF, key, -1, rF);
            addFillet(xd + wall / 2, zB, 1, -1, hF, key, -1, rF);
          }
        }
        // концы, упирающиеся в стенку фиксированного бокса
        if (meFlat) for (const [a, b] of segs) {
          const hB = wc.h;
          if (a > bz0 + 0.01) {
            addFillet(xd - wall / 2, a, -1, 1, hB, key, -1, rMe);
            addFillet(xd + wall / 2, a, 1, 1, hB, key, -1, rMe);
          }
          if (b < bz1 - 0.01) {
            addFillet(xd - wall / 2, b, -1, -1, hB, key, -1, rMe);
            addFillet(xd + wall / 2, b, 1, -1, hB, key, -1, rMe);
          }
        }
      }
    }
  }
  // горизонтальные перегородки: сегменты по ячейкам ряда j (верхнего);
  // пандус на дальнюю сторону уходит в ячейку ряда j+1, накрывающую центр
  // сегмента — при несовпадающих перегородках это ближайшая по перекрытию
  for (let j = 0; j < L.nRows - 1; j++) {
    const zd = L.cz0(j) + L.cd(j) + wall / 2;
    for (let i = 0; i < L.nColsAt(j); i++) {
      const key = `h:${j}:${i}`;
      const wc = getWall(c, key);
      const x0 = L.cx0(i, j), x1 = x0 + L.cw(i, j);
      const bx0 = Math.max(-W / 2 + wallOut * 0.5, x0 - wallOut), bx1 = Math.min(W / 2 - wallOut * 0.5, x1 + wallOut);
      if (wc.h > 0.3) {
        const bZones = boxZonesAtZ(zd);
        const segs = splitRange(bx0, bx1, bZones);
        for (const [a, b] of segs) pushWallAuto(key, wc, wall, true, a, b, bx0, bx1, (o, y, x) => [x, y, zd + o]);
        const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
        const i2 = L.cellIndexAt(j + 1, (x0 + x1) / 2);
        for (const [a, b] of splitRange(x0, x1, bZones)) {
          addRamp("z", zd - wall / 2, -1, a, b, hRamp, wc.t1, L.cd(j), wall / 2, wall, wc, floor + cellLvl(i, j), key);
          addRamp("z", zd + wall / 2, 1, a, b, hRamp, wc.t2, L.cd(j + 1), wall / 2, wall, wc, floor + cellLvl(i2, j + 1), key);
        }
        // галтели в углах примыкания к корпусу (только вертикальные стенки)
        const meFlatH = flatWall(key);
        const rMeH = rEff(key, wall, true);
        const rW = Math.max(rEff(`o:w:${j}`, wallOut, !conn.W), rEff(`o:w:${j + 1}`, wallOut, !conn.W));
        const rE = Math.max(rEff(`o:e:${j}`, wallOut, !conn.E), rEff(`o:e:${j + 1}`, wallOut, !conn.E));
        if (i === 0 && segs.length && segs[0][0] <= bx0 + 0.01 && meFlatH && flatWall(`o:w:${j}`) && flatWall(`o:w:${j + 1}`)) {
          const hF = Math.min(hAtEnd(wc, true), getWall(c, `o:w:${j}`).h, getWall(c, `o:w:${j + 1}`).h);
          const rF = Math.min(rMeH, rW);
          addFillet(-W / 2 + wallOut, zd - wall / 2, 1, -1, hF, key, -1, rF);
          addFillet(-W / 2 + wallOut, zd + wall / 2, 1, 1, hF, key, -1, rF);
        }
        if (i === L.nColsAt(j) - 1 && segs.length && segs[segs.length - 1][1] >= bx1 - 0.01 && meFlatH && flatWall(`o:e:${j}`) && flatWall(`o:e:${j + 1}`)) {
          const hF = Math.min(hAtEnd(wc, false), getWall(c, `o:e:${j}`).h, getWall(c, `o:e:${j + 1}`).h);
          const rF = Math.min(rMeH, rE);
          addFillet(W / 2 - wallOut, zd - wall / 2, -1, -1, hF, key, -1, rF);
          addFillet(W / 2 - wallOut, zd + wall / 2, -1, 1, hF, key, -1, rF);
        }
        // концы, упирающиеся в стенку фиксированного бокса
        if (meFlatH) for (const [a, b] of segs) {
          const hB = wc.h;
          if (a > bx0 + 0.01) {
            addFillet(a, zd - wall / 2, 1, -1, hB, key, -1, rMeH);
            addFillet(a, zd + wall / 2, 1, 1, hB, key, -1, rMeH);
          }
          if (b < bx1 - 0.01) {
            addFillet(b, zd - wall / 2, -1, -1, hB, key, -1, rMeH);
            addFillet(b, zd + wall / 2, -1, 1, hB, key, -1, rMeH);
          }
        }
      }
    }
  }

  // ── Фиксированные ячейки: собственные стенки и пол ──
  // Бокс — «контейнер внутри контейнера»: полость x0..x1 × z0..z1;
  // стороны, не прижатые к внешней стенке, несут собственную перегородку
  // (ключи fw:k:сторона — редактируются кликом, как обычные стенки)
  for (const f of L.fixed) {
    const fc = (c.fixedCells || [])[f.k] || {};
    const lvl = Math.min(fc.lvl || 0, H - 4);
    const sides = [
      ["n", f.own.n, "z", f.z0, 1, f.fx0, f.fx1, (o, y, x) => [x, y, f.z0 - wall / 2 + o]],
      ["s", f.own.s, "z", f.z1, -1, f.fx0, f.fx1, (o, y, x) => [x, y, f.z1 + wall / 2 + o]],
      ["w", f.own.w, "x", f.x0, 1, f.fz0, f.fz1, (o, y, z) => [f.x0 - wall / 2 + o, y, z]],
      ["e", f.own.e, "x", f.x1, -1, f.fz0, f.fz1, (o, y, z) => [f.x1 + wall / 2 + o, y, z]],
    ];
    for (const [side, has, orient, facePos, dir, s0, s1, mapFn] of sides) {
      if (!has) continue;
      const key = `fw:${f.k}:${side}`;
      const wc = getWall(c, key);
      if (wc.h <= 0.3) continue;
      pushWallAuto(key, wc, wall, true, s0, s1, s0, s1, mapFn);
      // наклон внутрь полости бокса (t1)
      const hRamp = wc.drop !== "none" ? Math.min(wc.h, wc.dropH) : wc.h;
      const span = orient === "z" ? [f.x0, f.x1] : [f.z0, f.z1];
      const cellSize = orient === "z" ? f.z1 - f.z0 : f.x1 - f.x0;
      addRamp(orient, facePos, dir, span[0], span[1], hRamp, wc.t1, cellSize, wall / 2, wall, wc, floor + lvl, key);
      // галтели там, где стенка бокса упирается в корпус (без пандусов);
      // галтель идёт до кромки, отступая вместе с ней (rTr)
      const hBoxF = wc.h, rBoxF = rEff(key, wall, true);
      if (!flatWall(key)) { /* наклонная стенка бокса — галтели не нужны */ }
      else if (orient === "x") {
        const faceLo = side === "w" ? f.x0 - wall : f.x1, faceHi = side === "w" ? f.x0 : f.x1 + wall;
        if (!f.own.n) {
          addFillet(faceLo, -D / 2 + wallOut, -1, 1, hBoxF, key, -1, rBoxF);
          addFillet(faceHi, -D / 2 + wallOut, 1, 1, hBoxF, key, -1, rBoxF);
        }
        if (!f.own.s) {
          addFillet(faceLo, D / 2 - wallOut, -1, -1, hBoxF, key, -1, rBoxF);
          addFillet(faceHi, D / 2 - wallOut, 1, -1, hBoxF, key, -1, rBoxF);
        }
      } else {
        const faceLo = side === "n" ? f.z0 - wall : f.z1, faceHi = side === "n" ? f.z0 : f.z1 + wall;
        if (!f.own.w) {
          addFillet(-W / 2 + wallOut, faceLo, 1, -1, hBoxF, key, -1, rBoxF);
          addFillet(-W / 2 + wallOut, faceHi, 1, 1, hBoxF, key, -1, rBoxF);
        }
        if (!f.own.e) {
          addFillet(W / 2 - wallOut, faceLo, -1, -1, hBoxF, key, -1, rBoxF);
          addFillet(W / 2 - wallOut, faceHi, -1, 1, hBoxF, key, -1, rBoxF);
        }
      }
    }
    // скругление внутренних углов полости бокса (в т.ч. там, где сторона
    // прижата к корпусу — тогда высоту даёт внешняя стенка)
    {
      const outerH = (s) => {
        if (s === "n") return getWall(c, `o:n:${Math.min(L.cellIndexAt(0, (f.x0 + f.x1) / 2), L.nColsAt(0) - 1)}`).h;
        if (s === "s") return getWall(c, `o:s:${Math.min(L.cellIndexAt(L.nRows - 1, (f.x0 + f.x1) / 2), L.nColsAt(L.nRows - 1) - 1)}`).h;
        return getWall(c, `o:${s}:0`).h;
      };
      const sideKey = (s) => {
        if (f.own[s]) return `fw:${f.k}:${s}`;
        if (s === "n") return `o:n:${Math.min(L.cellIndexAt(0, (f.x0 + f.x1) / 2), L.nColsAt(0) - 1)}`;
        if (s === "s") return `o:s:${Math.min(L.cellIndexAt(L.nRows - 1, (f.x0 + f.x1) / 2), L.nColsAt(L.nRows - 1) - 1)}`;
        return `o:${s}:0`;
      };
      const hSide = (s) => (f.own[s] ? getWall(c, sideKey(s)).h : outerH(s));
      // скругление кромки этой стороны — за ним галтель и отступает
      const rSide = (s) => (f.own[s]
        ? rEff(sideKey(s), wall, true)
        : rEff(sideKey(s), wallOut, !conn[s.toUpperCase()]));
      const pair = (a, b) => flatWall(sideKey(a)) && flatWall(sideKey(b));
      const hr = (a, b) => [Math.min(hSide(a), hSide(b)), Math.min(rSide(a), rSide(b))];
      if (pair("n", "w")) { const [hh, rr] = hr("n", "w"); addFillet(f.x0, f.z0, 1, 1, hh, `fx:${f.k}`, f.k, rr); }
      if (pair("n", "e")) { const [hh, rr] = hr("n", "e"); addFillet(f.x1, f.z0, -1, 1, hh, `fx:${f.k}`, f.k, rr); }
      if (pair("s", "w")) { const [hh, rr] = hr("s", "w"); addFillet(f.x0, f.z1, 1, -1, hh, `fx:${f.k}`, f.k, rr); }
      if (pair("s", "e")) { const [hh, rr] = hr("s", "e"); addFillet(f.x1, f.z1, -1, -1, hh, `fx:${f.k}`, f.k, rr); }
    }
    // пол бокса: полость + заход под собственные стенки; у прижатых
    // сторон — под внешнюю стенку
    const pxa = f.own.w ? f.fx0 : -W / 2;
    const pxb = f.own.e ? f.fx1 : W / 2;
    const pza = f.own.n ? f.fz0 : -D / 2;
    const pzb = f.own.s ? f.fz1 : D / 2;
    solids.push(boxSolid((pxa + pxb) / 2, lvl + floor / 2, (pza + pzb) / 2, pxb - pxa, floor, pzb - pza, `fx:${f.k}`));
    if (lvl > 2) {
      const ribT = 1.0, spacing = 12;
      const nAx = Math.max(0, Math.floor((pzb - pza) / spacing));
      for (let k2 = 1; k2 <= nAx; k2++) {
        const z = pza + ((pzb - pza) * k2) / (nAx + 1);
        solids.push(boxSolid((pxa + pxb) / 2, (lvl + 0.4) / 2, z, pxb - pxa, lvl + 0.4, ribT, `fx:${f.k}`));
      }
      const nAz = Math.max(0, Math.floor((pxb - pxa) / spacing));
      for (let k2 = 1; k2 <= nAz; k2++) {
        const x = pxa + ((pxb - pxa) * k2) / (nAz + 1);
        solids.push(boxSolid(x, (lvl + 0.4) / 2, (pza + pzb) / 2, ribT, lvl + 0.4, pzb - pza, `fx:${f.k}`));
      }
    }
  }

  // соединители (высота и скругление кромки — от стенки своей зоны)
  const sideUnits = { N: uN, S: uS, W: uW, E: uE };
  for (const side of ["N", "S", "W", "E"])
    if (conn[side] && sideUnits[side].length)
      addConnUnits(solids, c, side, sideUnits[side], conn[side]);

  return solids;
}
