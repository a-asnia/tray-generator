// «Магнит раскладки»: щели уже 30 мм закрываются растяжкой контейнеров,
// свободное место побольше — новыми контейнерами (каждый в самый большой
// свободный прямоугольник). Идемпотентно: на результате null.
import { snapLayout } from "../src/model/laymagnet.js";
import { boxOf, overlaps, bounds, freeRects } from "../src/model/laymove.js";
import { makeContainer } from "../src/state/storage.js";

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;
const mk = (o = {}) => ({ ...makeContainer(null, 0, 0), ...o });
const lim = (o = {}) => ({ maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40, ...o });
const noOverlaps = (cs) => cs.every((a, i) => cs.every((b, j) => i >= j || !overlaps(boxOf(a), boxOf(b))));

// мелкая щель до края — контейнер дорастает
{
  const cs = [mk({ W: 100, D: 100 })];
  const r = snapLayout(cs, lim({ layW: 12, layD: 10 }));
  ok("дотяжка: ширина выросла до края", r && near(r[0].W, 120), r ? ` → ${r[0].W}` : "");
  ok("дотяжка: глубина не тронута (уже у края)", r && near(r[0].D, 100));
  ok("идемпотентно", snapLayout(r, lim({ layW: 12, layD: 10 })) === null);
}

// зазор больше 30 — заполняется новым контейнером
{
  const cs = [mk({ W: 150, D: 170 })];
  const r = snapLayout(cs, lim({ layW: 19, layD: 17 }));
  ok("большой зазор: добавился контейнер", r && r.length === 2, ` → ${r && r.length}`);
  ok("рамка заполнена целиком", r && freeRects(r, lim({ layW: 19, layD: 17 })).length === 0);
  ok("пересечений нет", r && noOverlaps(r));
  ok("идемпотентно", snapLayout(r, lim({ layW: 19, layD: 17 })) === null);
}

// упёрлись в лимит принтера, щель < 30 — не растягиваемся сверх принтера
{
  const cs = [mk({ W: 170, D: 170 })];
  const r = snapLayout(cs, lim({ layW: 18, layD: 17 }));
  ok("узкую щель за лимитом принтера никто не закрыл", r === null || r[0].W <= 170.01);
}

// пустая рамка 40×40 заполняется контейнерами до отказа
{
  const cs = [mk({ W: 170, D: 170 })];
  const r = snapLayout(cs, lim());
  ok("рамка 400×400 закрыта без свободных мест", r && freeRects(r, lim()).length === 0,
    ` → осталось ${r ? freeRects(r, lim()).length : "?"}`);
  ok("все в лимите принтера", r && r.every((c) => c.W <= 170.01 && c.D <= 170.01));
  ok("пересечений нет", r && noOverlaps(r));
  ok("сборка ровно до краёв", r && near(bounds(r).w, 400) && near(bounds(r).d, 400));
  ok("идемпотентно", snapLayout(r, lim()) === null);
}

// контейнер с замком не растягивается
{
  const cs = [mk({ W: 100, D: 100, lockOuter: true })];
  const r = snapLayout(cs, lim({ layW: 12, layD: 10 }));
  ok("замок: контейнер не растянут", r === null || near(r[0].W, 100));
}

// свободная раскладка: щель между контейнерами тоже закрывается
{
  const cs = [
    mk({ W: 150, D: 100 }),
    { ...mk({ W: 150, D: 100 }), px: 170, pz: 0 }, // щель 20 мм между ними
  ];
  const r = snapLayout(cs, lim({ layW: 32, layD: 10 }));
  ok("щель между соседями закрыта растяжкой", r && near(r[0].W, 170), r ? ` → ${r[0].W}` : "");
  ok("пересечений нет", r && noOverlaps(r));
}

// сложная свободная раскладка (сценарий пользователя) дозаполняется
{
  const cs = [
    { ...mk({ W: 160, D: 80 }), px: 0, pz: 0 },
    { ...mk({ W: 160, D: 80 }), px: 160, pz: 0 },
    { ...mk({ W: 117.8, D: 160.8 }), px: 0, pz: 80 },
  ];
  const L = lim({ layW: 32, layD: 32 });
  const r = snapLayout(cs, L);
  ok("угловая раскладка дозаполнена", r && freeRects(r, L).length === 0);
  // магнит имеет право дотянуть контейнер на щель уже 30 мм — но не более
  ok("исходные контейнеры не пересобраны",
    r && near(r[2].W, 117.8) && r[2].D >= 160.8 - 0.05 && r[2].D < 160.8 + 30 && near(r[0].W, 160));
  ok("пересечений нет", r && noOverlaps(r));
  ok("идемпотентно", snapLayout(r, L) === null);
}

console.log(fail === 0 ? "\nLAYOUT MAGNET TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
