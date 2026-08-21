// «Магнит раскладки»: сборка липнет к краю лимита — ряд дотягивается до
// правого края последним контейнером, стопка рядов до дальнего края,
// большое пустое место закрывают новые контейнеры и ряды.
// Идемпотентно: на результате null.
import { snapLayout } from "../src/model/laymagnet.js";
import { rowsOf } from "../src/model/laymove.js";
import { makeContainer } from "../src/state/storage.js";

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;
const mk = (o = {}) => ({ ...makeContainer(null, 0, 0), ...o });
const lim = (o = {}) => ({ maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40, ...o });
// ширина сборки — самый широкий ряд, глубина — сумма глубин рядов
const totalW = (cs) => Math.max(...rowsOf(cs).map((r) => r.width));
const totalD = (cs) => rowsOf(cs).reduce((s, r) => s + r.depth, 0);

// мелкий зазор — крайний контейнер дорастает до края
{
  const cs = [mk({ W: 100, D: 100 })];
  const r = snapLayout(cs, lim({ layW: 12, layD: 10 }));
  ok("дотяжка: ширина крайнего выросла до края", r && near(r[0].W, 120));
  ok("дотяжка: глубина не тронута (уже у края)", r && near(r[0].D, 100));
  ok("идемпотентно", snapLayout(r, lim({ layW: 12, layD: 10 })) === null);
}

// зазор больше 30 — заполняется новым контейнером
{
  const cs = [mk({ W: 150, D: 170 })];
  const r = snapLayout(cs, lim({ layW: 19, layD: 17 }));
  ok("большой зазор: добавился контейнер", r && r.length >= 2, ` → ${r && r.length}`);
  ok(`большой зазор: сумма ширин = краю (${totalW(r).toFixed(0)})`, r && near(totalW(r), 190));
  ok("новый контейнер той же глубины", r && r[1].D === 170, ` → ${r && r[1].D}`);
  ok("идемпотентно", snapLayout(r, lim({ layW: 19, layD: 17 })) === null);
}

// упёрлись в лимит принтера, зазор < 30 — ничего не меняется
{
  const cs = [mk({ W: 165, D: 170 })];
  ok("узкий хвост за лимитом принтера не трогается",
    snapLayout(cs, lim({ layW: 18, layD: 17 })) === null);
}

// пустая раскладка 40×40 заполняется сеткой (как «Заполнить раскладку»)
{
  const cs = [mk({})]; // 170×170
  const r = snapLayout(cs, lim());
  ok("заполнение: контейнеров стало 9", r && r.length === 9, ` → ${r && r.length}`);
  ok(`заполнение: ширины до края (${totalW(r).toFixed(0)}×${totalD(r).toFixed(0)})`,
    r && near(totalW(r), 400) && near(totalD(r), 400));
  ok("все в лимите принтера", r && r.every((c) => c.W <= 170 && c.D <= 170));
  ok("идемпотентно", snapLayout(r, lim()) === null);
}

// контейнер с замком не растягивается
{
  const cs = [mk({ W: 100, D: 100, lockOuter: true })];
  const r = snapLayout(cs, lim({ layW: 12, layD: 10 }));
  ok("замок: крайний не растянут", r === null || near(r[0].W, 100));
}

// два ряда: каждый дотягивается до правого края сам по себе
{
  const cs = [mk({ W: 150, D: 80 }), mk({ W: 150, D: 60, gy: 1 })];
  const r = snapLayout(cs, lim({ layW: 19, layD: 14 }));
  const rows = rowsOf(r || cs);
  ok("оба ряда достали до края", rows.every((x) => near(x.width, 190)), ` → ${rows.map((x) => x.width).join("/")}`);
  ok("глубина рядов своя", near(rows[0].depth, 80) && near(rows[1].depth, 60));
  ok("идемпотентно", snapLayout(r, lim({ layW: 19, layD: 14 })) === null);
}

// ряды разной разбивки магнит не выравнивает: он только дотягивает края
{
  const cs = [
    mk({ W: 160, D: 120 }), mk({ W: 160, D: 120, gx: 1 }),
    mk({ W: 118, D: 161, gy: 1 }),
  ];
  const r = snapLayout(cs, lim({ layW: 32, layD: 29 })) || cs;
  ok("широкий ряд не тронут", near(rowsOf(r)[0].width, 320));
  ok("узкий ряд дотянулся до края", near(rowsOf(r)[1].width, 320), ` → ${rowsOf(r)[1].width}`);
  ok("узкий контейнер сохранил свои 118", r.some((c) => near(c.W, 118)));
}

console.log(fail === 0 ? "\nLAYOUT MAGNET TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
