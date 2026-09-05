// Свободная раскладка: контейнеры любых размеров стоят где угодно,
// прилипают краями, не пересекаются и не выходят за рамку стола.
import {
  moveContainer, snapMove, collides, fitAssembly, freeRects, autoSpot,
  resizeBox, normPositions, bounds, boxOf, overlaps,
} from "../src/model/laymove.js";

const mk = (o = {}) => ({
  id: o.id ?? 1, px: 0, pz: 0, W: 100, D: 100, H: 30, cols: 1, rows: 1,
  gridMode: "count", cellWt: 40, cellDt: 40, wall: 1.6, wallOut: 2.9, floor: 1.6,
  walls: {}, cells: {}, rowColWs: null, rowDs: null,
  lockedCellW: {}, lockedRows: {}, cellShares: {}, fixedCells: [],
  lockOuter: false, lockCell: false, ...o,
});
const LIM = { maxW: 170, maxD: 170, maxH: 175, layW: 32, layD: 32 }; // 320×320
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;
const at = (cs, id) => cs.find((c) => c.id === id);
const noOverlaps = (cs) => cs.every((a, i) => cs.every((b, j) => i >= j || !overlaps(boxOf(a), boxOf(b))));

// ── сценарий пользователя: 160+160 сзади, 117.8×160.8 в углу спереди ──
{
  const cs = [
    mk({ id: 1, px: 0, pz: 0, W: 160, D: 80 }),
    mk({ id: 2, px: 160, pz: 0, W: 160, D: 80 }),
    mk({ id: 3, px: 0, pz: 80, W: 117.8, D: 160.8 }),
  ];
  ok("контейнеры любых размеров сосуществуют", noOverlaps(cs));
  const b = bounds(cs);
  ok("габарит сборки честный", near(b.w, 320) && near(b.d, 240.8));
  // никакой нормализации размеров: никто никого не растягивает
  ok("узкий контейнер остался 117.8", cs[2].W === 117.8 && cs[2].D === 160.8);
}

// ── прилипание краёв ──
{
  const cs = [mk({ id: 1, px: 0, pz: 0, W: 100, D: 100 }), mk({ id: 2, px: 200, pz: 0, W: 80, D: 90 })];
  // тащим №2 почти вплотную к №1 — прилипает ровно к грани
  const s = snapMove(cs, 1, 104, 3, LIM);
  ok("прилипание к правой грани соседа", near(s.px, 100), ` → ${s.px}`);
  ok("прилипание к рамке по z", near(s.pz, 0), ` → ${s.pz}`);
  // перенос в занятое место отменяется
  const same = moveContainer(cs, 1, 10, 10, LIM);
  ok("перенос в занятое место отменён", same === cs);
  // перенос в свободное — работает, позиции нормированы
  const n = moveContainer(cs, 1, 104, 150, LIM);
  ok("перенос со снапом", near(at(n, 2).px, 100) && near(at(n, 2).pz, 150));
  ok("пересечений нет", noOverlaps(n));
}

// ── за рамку не выехать, позиция не «нормализуется» насильно ──
{
  const cs = [mk({ id: 1, px: 0, pz: 0 })];
  const n = moveContainer(cs, 0, 500, 500, LIM);
  ok("рамка стола жёсткая", near(at(n, 1).px, 220) && near(at(n, 1).pz, 220),
    ` → ${at(n, 1).px},${at(n, 1).pz}`);
  // одинокий контейнер можно поставить в середину — никто не утащит в угол
  const mid = moveContainer(cs, 0, 100, 120, LIM);
  ok("позиция в середине рамки сохраняется", near(at(mid, 1).px, 100) && near(at(mid, 1).pz, 120));
}

// ── свободные прямоугольники и автопостановка ──
{
  const cs = [
    mk({ id: 1, px: 0, pz: 0, W: 160, D: 80 }),
    mk({ id: 2, px: 160, pz: 0, W: 160, D: 80 }),
    mk({ id: 3, px: 0, pz: 80, W: 117.8, D: 160.8 }),
  ];
  const rects = freeRects(cs, LIM);
  ok("свободные прямоугольники найдены", rects.length > 0);
  ok("прямоугольники не пересекают контейнеры",
    rects.every((rc) => cs.every((c) => !overlaps({ x0: rc.x, x1: rc.x + rc.w, z0: rc.z, z1: rc.z + rc.d }, boxOf(c)))));
  const spot = autoSpot(cs, LIM);
  ok("новое место найдено", !!spot && spot.W >= 30 && spot.D >= 30);
  const cs2 = [...cs, mk({ id: 4, px: spot.px, pz: spot.pz, W: spot.W, D: spot.D })];
  ok("новый контейнер никого не задел и в рамке", noOverlaps(cs2) &&
    spot.px + spot.W <= 320.05 && spot.pz + spot.D <= 320.05);
  // полная рамка — мест нет
  const full = [mk({ id: 1, px: 0, pz: 0, W: 160, D: 160 }), mk({ id: 2, px: 160, pz: 0, W: 160, D: 160 }),
    mk({ id: 3, px: 0, pz: 160, W: 160, D: 160 }), mk({ id: 4, px: 160, pz: 160, W: 160, D: 160 })];
  ok("в полной рамке мест нет", autoSpot(full, LIM) === null);
}

// ── жёсткая рамка при ужатии лимита ──
{
  const cs = [mk({ id: 1, px: 0, pz: 0, W: 170, D: 100 }), mk({ id: 2, px: 170, pz: 0, W: 150, D: 100 })];
  const lim2 = { ...LIM, layW: 20 }; // 200 мм
  const n = fitAssembly(cs, lim2);
  ok("сборка ужалась в рамку", n && n.every((c) => c.px + c.W <= 200.05), n ? ` → ${n.map((c) => c.px + c.W).join("/")}` : "");
  ok("пересечений после ужатия нет", n && noOverlaps(n));
  ok("идемпотентно", fitAssembly(n, lim2) === null);
  // замок габарита не ужимается
  const csL = [mk({ id: 1, px: 0, pz: 0, W: 170, D: 100, lockOuter: true })];
  const nl = fitAssembly(csL, { ...LIM, layW: 10 });
  ok("замок габарита не тронут", (nl || csL)[0].W === 170);
}

// ── изменение размера с приклеенными соседями ──
{
  const cs = [
    mk({ id: 1, px: 0, pz: 0, W: 100, D: 100 }),
    mk({ id: 2, px: 100, pz: 0, W: 80, D: 100 }),  // прилип справа
    mk({ id: 3, px: 0, pz: 200, W: 80, D: 80 }),   // не прилип
  ];
  const grown = resizeBox(cs, 0, { W: 130 }, LIM, true);
  ok("контейнер вырос", near(at(grown, 1).W, 130));
  ok("прилипший сосед уехал за гранью", near(at(grown, 2).px, 130), ` → ${at(grown, 2).px}`);
  ok("неприлипший не тронут", near(at(grown, 3).pz, 200));
  const shrunk = resizeBox(grown, 0, { W: 90 }, LIM, true);
  ok("при ужатии с магнитом сосед приехал назад", near(at(shrunk, 2).px, 90), ` → ${at(shrunk, 2).px}`);
  const shrunkNoMag = resizeBox(grown, 0, { W: 90 }, LIM, false);
  ok("без магнита при ужатии остаётся щель", near(at(shrunkNoMag, 2).px, 130));
  ok("рост без магнита всё равно раздвигает (никаких наездов)",
    noOverlaps(resizeBox(cs, 0, { W: 150 }, LIM, false)));
  // рост у рамки: соседа выдавливать некуда — он ужимается
  const tight = [mk({ id: 1, px: 0, pz: 0, W: 160, D: 100 }), mk({ id: 2, px: 160, pz: 0, W: 160, D: 100 })];
  const g2 = resizeBox(tight, 0, { W: 170 }, LIM, true);
  ok("у рамки сосед ужался, пересечений нет", noOverlaps(g2) && g2.every((c) => c.px + c.W <= 320.05));
}

// ── прижатие к стороне рамки ──
{
  const cs = [
    mk({ id: 1, px: 50, pz: 60, W: 100, D: 100, pin: { back: true, left: true } }),
    mk({ id: 2, px: 200, pz: 200, W: 80, D: 80, pin: { front: true, right: true } }),
    mk({ id: 3, px: 150, pz: 100, W: 60, D: 60, pin: { back: true } }),
  ];
  const n = fitAssembly(cs, LIM) || cs;
  ok("прижатый уехал в задний левый угол", near(at(n, 1).px, 0) && near(at(n, 1).pz, 0),
    ` → ${at(n, 1).px},${at(n, 1).pz}`);
  ok("прижатый к переду-праву — в противоположном углу", near(at(n, 2).px, 240) && near(at(n, 2).pz, 240));
  ok("прижатый только к заду держит одну ось", near(at(n, 3).pz, 0) && near(at(n, 3).px, 150));
  ok("после дотяжки пересечений нет", noOverlaps(n));
  ok("идемпотентно", fitAssembly(n, LIM) === null);
  // перенос прижатого: свободная ось едет, прижатая — нет
  const m = moveContainer(n, 2, 250, 150, LIM);
  ok("прижатая ось не отпускается при переносе", near(at(m, 3).pz, 0) && near(at(m, 3).px, 250),
    ` → ${at(m, 3).px},${at(m, 3).pz}`);
  // рост прижатого к правому краю держит правую грань у рамки
  const g = resizeBox(n, 1, { W: 120 }, LIM, false);
  ok("прижатый справа остался вплотную к рамке", near(at(g, 2).px, 200) && at(g, 2).W === 120,
    ` → ${at(g, 2).px}+${at(g, 2).W}`);
  // место у стороны занято — прижатый ждёт снаружи от чужого, наезда нет
  const blocked = [
    mk({ id: 1, px: 0, pz: 0, W: 100, D: 100 }),
    mk({ id: 2, px: 0, pz: 150, W: 80, D: 80, pin: { back: true, left: true } }),
  ];
  const b = fitAssembly(blocked, LIM) || blocked;
  ok("занятая сторона не вызывает наезда", noOverlaps(b));
  ok("заблокированный пин сходится", fitAssembly(b, LIM) === null);
}

// ── стабильность парковки ──
{
  // рамка 100×100: второй контейнер физически не помещается и паркуется
  // снаружи; повторный прогон не должен перекладывать его заново
  const tiny = { ...LIM, layW: 10, layD: 10 };
  const cs = [mk({ id: 1, px: 0, pz: 0, W: 100, D: 100, lockOuter: true }),
    mk({ id: 2, px: 0, pz: 0, W: 90, D: 90, lockOuter: true })];
  const p = fitAssembly(cs, tiny) || cs;
  ok("не поместившийся припаркован снаружи", at(p, 2).px >= 100);
  ok("парковка стабильна (нет вечной перекладки)", fitAssembly(p, tiny) === null);
}

// ── нормализация позиций ──
{
  const cs = [mk({ id: 1, px: 40, pz: 30 }), mk({ id: 2, px: 140, pz: 30 })];
  const n = normPositions(cs);
  ok("норма (для 3D-сцены) прижимает к нулю", near(Math.min(...n.map((c) => c.px)), 0));
  ok("взаимное положение сохранено", near(at(n, 2).px - at(n, 1).px, 100));
  ok("норма без сдвига возвращает тот же список", normPositions(n) === n);
}

console.log(fail === 0 ? "\nFREE LAYOUT TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
