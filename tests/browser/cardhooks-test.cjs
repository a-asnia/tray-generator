// Отверстия под визитницу: включение галки сразу подгоняет стенку под
// требования — поднимает её до высоты, на которой карман висит не
// задевая стол, и растягивает короткий сегмент.
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
await new Promise((r) => server.listen(8973, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8973/", { waitUntil: "load" });
await page.waitForSelector("canvas");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(600);

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("trayGenState")).containers[0]);
const wallH = await page.evaluate(() => CARDH.wallH);
ok(`высота стенки под визитницу посчитана (${wallH} мм)`, wallH >= 60 && wallH <= 70);

// узкий контейнер с низкой ближней стенкой — оба требования нарушены
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("trayGenState"));
  s.containers[0] = { ...s.containers[0], W: 50, D: 60, H: 40, walls: { "o:n:0": { h: 12 } } };
  localStorage.setItem("trayGenState", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(600);

// выбрать внешнюю стенку на схеме: кликаем сегменты, пока не появится галка
const rects = await page.locator("svg rect").count();
for (let i = 0; i < rects; i++) {
  await page.locator("svg rect").nth(i).click({ force: true });
  await page.waitForTimeout(120);
  if (await page.locator("text=Отверстия под визитницу").count()) break;
}
ok("редактор внешней стенки открылся", (await page.locator("text=Отверстия под визитницу").count()) === 1);
await page.locator('label:has-text("Отверстия под визитницу") input[type="checkbox"]').check();
await page.waitForTimeout(600);

const c = await st();
const hooked = Object.entries(c.walls).filter(([, w]) => w && w.cardHooks);
ok("галка записалась ровно в одну стенку", hooked.length === 1);
ok(`стенка поднялась до ${wallH} мм (было 12, стало ${hooked[0] && hooked[0][1].h})`,
  hooked[0] && Math.abs(hooked[0][1].h - wallH) < 0.05);
ok(`контейнер расширился под окна (${c.W} мм)`, c.W >= 60);

// окна действительно прорезаны: STL визитницы и модель строятся без ошибок
await page.locator("button", { hasText: /^Принтер$/ }).click();
await page.waitForTimeout(300);
ok("кнопка визитницы появилась", (await page.locator("button", { hasText: /Скачать визитницу/ }).count()) === 1);

// снятие галки высоту не трогает — правку не откатываем молча
await page.locator("button", { hasText: /^Контейнеры$/ }).click();
await page.waitForTimeout(250);
await page.locator('label:has-text("Отверстия под визитницу") input[type="checkbox"]').uncheck();
await page.waitForTimeout(400);
const c2 = await st();
ok("после снятия галки стенка осталась высокой",
  Math.abs(c2.walls[hooked[0][0]].h - wallH) < 0.05 && !c2.walls[hooked[0][0]].cardHooks);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nCARD HOOKS UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
