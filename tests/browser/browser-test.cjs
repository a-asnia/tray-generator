(async () => {
// Проверка собранного tray-generator.html в реальном Chromium:
// загрузка без ошибок, рендер 3D и панели, скачивание STL, автосохранение.
const { createServer } = require("node:http");
const { readFileSync } = require("node:fs");
const { chromium } = require("playwright");
const HTML = require("node:path").join(__dirname, "..", "..", "tray-generator.html");

const html = readFileSync(HTML);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(8931, r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto("http://127.0.0.1:8931/", { waitUntil: "load" });
await page.waitForSelector("canvas", { timeout: 15000 });
await page.waitForTimeout(1200);

const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); };

ok("канвас three.js на странице", await page.$("canvas"));
ok("заголовок панели", await page.getByText("Система контейнеров").count());
ok("вкладки", (await page.getByRole("button", { name: "Принтер" }).count()) === 1);

// схема SVG с сегментами стенок
ok("схема контейнера (SVG)", await page.$("svg rect"));

// клик по вкладке Принтер и обратно
await page.getByRole("button", { name: "Принтер" }).click();
ok("вкладка Принтер открылась", await page.getByText("Лимиты принтера").count());
ok("экспорт теперь на вкладке Принтер", await page.getByText("Экспорт").count());

// скачивание STL — с вкладки Принтер
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.getByRole("button", { name: /Скачать STL — контейнер №1/ }).click(),
]);
const fname = download.suggestedFilename();
const path = await download.path();
const size = readFileSync(path).length;
ok(`скачан STL (${fname}, ${size} байт)`, /^tray1_170x170x30_1x1\.stl$/.test(fname) && size > 1000);

// STL-заголовок: число треугольников соответствует размеру файла
const buf = readFileSync(path);
const nTri = buf.readUInt32LE(80);
ok(`STL валиден (${nTri} треугольников)`, buf.length === 84 + nTri * 50 && nTri >= 60);

// автосохранение в localStorage
const saved = await page.evaluate(() => window.localStorage.getItem("trayGenState"));
ok("автосохранение в localStorage", saved && JSON.parse(saved).containers.length === 1);

await page.getByRole("button", { name: "Модель" }).click();
await page.waitForTimeout(200);
// выбор стенки на схеме открывает редактор
await page.locator("svg g").first().click();
await page.waitForTimeout(200);
ok("редактор ячейки по клику", await page.getByText("Ячейка 1×1").count());
await page.locator("svg g").last().click();
await page.waitForTimeout(300);
ok("редактор стенки по клику", (await page.getByText("Внешняя стенка").count()) + (await page.getByText("Перегородка").count()));

// рендер не пустой: канвас имеет непустые пиксели
const shot = await page.locator("canvas").screenshot();
ok("канвас отрисован", shot.length > 20000);
await page.screenshot({ path: "/tmp/app.png" });

let fail = 0;
for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
if (errors.length) { console.log("КОНСОЛЬ/ОШИБКИ СТРАНИЦЫ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
else console.log("OK  ошибок в консоли нет");

await browser.close();
server.close();
console.log(fail === 0 ? "\nBROWSER TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
