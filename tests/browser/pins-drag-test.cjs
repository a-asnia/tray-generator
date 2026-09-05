// Новые возможности раскладки: кнопки истории и вкладок в два ряда,
// прижатие контейнера к стороне рамки, «рисование» раскладки ручками
// размеров на плане, перенос контейнера мышью прямо на 3D-виде.
(async () => {
const { createServer } = require("node:http");
const { readFileSync } = require("node:fs");
const { chromium } = require("playwright");
const HTML = require("node:path").join(__dirname, "..", "..", "tray-generator.html");

const html = readFileSync(HTML);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(8983, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8983/", { waitUntil: "load" });
await page.waitForSelector("canvas");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("trayGenState")));

// ── кнопки истории и вкладок — в два ряда, ничего не теснится ──
const bUndo = await page.locator('button:has-text("↶ Назад")').boundingBox();
const bTab = await page.locator('button:text-is("Раскладка")').boundingBox();
ok("кнопки истории подписаны и на месте", !!bUndo);
ok("вкладки во втором ряду (ниже истории)", !!bTab && bTab.y > bUndo.y + bUndo.height - 2,
  ` → история y=${bUndo?.y}, вкладки y=${bTab?.y}`);

// ── прижатие к стороне ──
// контейнер 100×100 в центре; «к передней» + «к правой» — уезжает в угол
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("trayGenState"));
  s.containers[0] = { ...s.containers[0], W: 100, D: 100, px: 60, pz: 60 };
  s.limits = { ...s.limits, layW: 40, layD: 40 };
  localStorage.setItem("trayGenState", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
await page.locator('button:text-is("передней")').click();
await page.waitForTimeout(400);
await page.locator('button:text-is("правой")').click();
await page.waitForTimeout(500);
let c = (await st()).containers[0];
ok("контейнер прижался к передне-правому углу", Math.abs(c.px - 300) < 0.05 && Math.abs(c.pz - 300) < 0.05,
  ` → ${c.px},${c.pz}`);
ok("пин сохранился в проекте", c.pin?.front === true && c.pin?.right === true);
// снятие пина оставляет контейнер на месте
await page.locator('button:text-is("правой")').click();
await page.waitForTimeout(400);
c = (await st()).containers[0];
ok("снятый пин не двигает контейнер", Math.abs(c.px - 300) < 0.05 && !c.pin?.right);

// ── ручки размеров на плане: раскладка «рисуется» мышью ──
await page.locator('button:text-is("передней")').click(); // снять второй пин
await page.waitForTimeout(400);
await page.locator('button:text-is("Раскладка")').click();
await page.waitForTimeout(300);
await page.locator('button:has-text("№1")').click(); // выбрать
await page.waitForTimeout(300);
const eh = await page.locator('[title="Потяни: ширина"]').boundingBox();
ok("ручка ширины видна у выбранного", !!eh);
const before = (await st()).containers[0].W;
await page.mouse.move(eh.x + eh.width / 2, eh.y + eh.height / 2);
await page.mouse.down();
await page.mouse.move(eh.x + eh.width / 2 + 33, eh.y + eh.height / 2, { steps: 8 });
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(500);
c = (await st()).containers[0];
ok("ширина выросла тяжкой за ручку", c.W > before + 25 && c.W < before + 75, ` → ${before} → ${c.W}`);
ok("позиция угла не уехала", Math.abs(c.pz - 300) < 0.05);
const sh = await page.locator('[title="Потяни: глубина"]').boundingBox();
await page.mouse.move(sh.x + sh.width / 2, sh.y + sh.height / 2);
await page.mouse.down();
await page.mouse.move(sh.x + sh.width / 2, sh.y + sh.height / 2 - 26, { steps: 8 });
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(500);
c = (await st()).containers[0];
ok("глубина ужалась тяжкой вверх", c.D < 100 - 20, ` → ${c.D}`);

// ── перенос мышью на 3D-виде ──
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("trayGenState"));
  s.containers = [{ ...s.containers[0], W: 100, D: 100, px: 0, pz: 0, pin: {} }];
  localStorage.setItem("trayGenState", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(900);
const cv = await page.locator("canvas").boundingBox();
const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 90, cy + 45, { steps: 12 });
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(600);
c = (await st()).containers[0];
ok("контейнер переехал тяжкой по 3D-виду", Math.abs(c.px) + Math.abs(c.pz) > 5, ` → ${c.px},${c.pz}`);
ok("и остался в рамке", c.px + c.W <= 400.05 && c.pz + c.D <= 400.05 && c.px >= -0.05 && c.pz >= -0.05);
// клик без сдвига по модели по-прежнему выбирает элементы
await page.mouse.click(cx, cy);
await page.waitForTimeout(400);
ok("клик по модели открыл редактор (выбор работает)",
  (await page.locator("text=/Стенка|Ячейка|Пол/").count()) > 0);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nPINS+DRAG TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
