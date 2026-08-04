// «Магнит раскладки»: сборка липнет к краю лимита раскладки — крайние
// колонка/ряд дорастают (в пределах лимита принтера), большое пустое
// место закрывают новые контейнеры. Идемпотентно: на результате null.
import { snapLayout } from "../src/model/laymagnet.js";
import { makeContainer } from "../src/state/storage.js";

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;
const mk = (o = {}) => ({ ...makeContainer(null, 0, 0), ...o });
const lim = (o = {}) => ({ maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40, ...o });
const totalW = (cs) => {
  const g = {};
  for (const c of cs) g[c.gx] = Math.max(g[c.gx] || 0, c.W);
  return Object.values(g).reduce((a, b) => a + b, 0);
};
const totalD = (cs) => {
  const g = {};
  for (const c of cs) g[c.gy] = Math.max(g[c.gy] || 0, c.D);
  return Object.values(g).reduce((a, b) => a + b, 0);
};

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
  ok("большой зазор: добавился контейнер", r && r.length === 2);
  ok(`большой зазор: сумма ширин = краю (${totalW(r).toFixed(0)})`, r && near(totalW(r), 190));
  ok("новый контейнер той же глубины", r && r[1].D === 170);
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

// два ряда: новый столбец получает по контейнеру на каждый ряд
{
  const cs = [mk({ W: 150, D: 80 }), mk({ W: 150, D: 60, gy: 1 })];
  const r = snapLayout(cs, lim({ layW: 19, layD: 14 }));
  ok("сетка: добавлено по контейнеру на ряд", r && r.length === 4, ` → ${r && r.length}`);
  const col1 = r ? r.filter((c) => c.gx === 1) : [];
  ok("сетка: новые в обоих рядах", col1.length === 2 && new Set(col1.map((c) => c.gy)).size === 2);
  ok("сетка: глубина новых — по своему ряду", col1.every((c) => near(c.D, c.gy === 0 ? 80 : 60)));
}

console.log(fail === 0 ? "\nLAYOUT MAGNET TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
