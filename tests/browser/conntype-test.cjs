// Типы соединителей в собранной странице: переключатель на «Принтере»,
// пресеты зазора, стыковка двух контейнеров с «выступами», сохранение.
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
await new Promise((r) => server.listen(8955, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8955/", { waitUntil: "load" });
await page.waitForSelector("canvas");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const lims = () => page.evaluate(() => JSON.parse(localStorage.getItem("trayGenState")).limits);

// пристыковать второй контейнер — чтобы соединители реально строились
await page.locator("button", { hasText: /^Раскладка$/ }).first().click();
await page.waitForTimeout(300);
await page.locator('button:text-is("+")').first().click();
await page.waitForTimeout(600);

// вкладка «Принтер»: переключатель типов
await page.locator("button", { hasText: /^Принтер$/ }).first().click();
await page.waitForTimeout(300);
ok("кнопки типов на месте",
  (await page.locator('button:text-is("Ласточкин хвост")').count()) === 1 &&
  (await page.locator('button:text-is("Выступы (лего)")').count()) === 1);

await page.locator('button:text-is("Выступы (лего)")').click();
await page.waitForTimeout(600);
ok("описание типа сменилось", (await page.getByText(/как лего/).count()) > 0);
ok("тип сохранился в состоянии", (await lims()).connType === "pins");
ok("после переключения нет ошибок", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");

// пресеты зазора
await page.locator("button", { hasText: /^Свободно/ }).click();
await page.waitForTimeout(300);
ok("пресет задал зазор 0.35", Math.abs((await lims()).connClr - 0.35) < 0.001);
const clrInput = page.locator('div:has(> div > label:has-text("Зазор на сторону")) input[type="number"]').first();
ok("поле зазора показывает пресет", Math.abs(parseFloat(await clrInput.inputValue()) - 0.35) < 0.001);

// STL с «выступами» скачивается и валиден
const [dl] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.locator("button", { hasText: /Скачать STL — контейнер №/ }).first().click(),
]);
const buf = readFileSync(await dl.path());
const nTri = buf.readUInt32LE(80);
ok(`STL с выступами валиден (${nTri} тр.)`, buf.length === 84 + nTri * 50 && nTri > 100);

// настройка переживает перезагрузку
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
ok("тип пережил перезагрузку", (await lims()).connType === "pins");

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nCONNECTOR TYPE UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
