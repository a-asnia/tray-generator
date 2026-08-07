// Разное: визитница (галка → кнопка → STL), уровень пола переживает
// деление на колонки, «ко всем ячейкам», обмен контейнеров местами,
// «+» доступен при заполненной раскладке.
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
await new Promise((r) => server.listen(8971, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8971/", { waitUntil: "load" });
await page.waitForSelector("canvas");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("trayGenState")));
const setNum = async (label, v) => {
  const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
  await el.fill(String(v)); await el.press("Enter"); await page.waitForTimeout(250);
};

// уровень пола переживает деление на колонки/ряды
await page.locator("svg g").first().click();
await page.waitForTimeout(300);
await setNum("Уровень пола", 18);
await page.locator("button", { hasText: /^Контейнер №/ }).first().click();
await page.waitForTimeout(250);
await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).first().click();
await page.waitForTimeout(400);
await page.locator('div:has(> label:text-is("Ряды")) button', { hasText: "+" }).first().click();
await page.waitForTimeout(400);
let c = (await st()).containers[0];
ok("деление сохранило уровень пола во всех ячейках",
  ["0:0", "1:0", "0:1", "1:1"].every((k) => Math.abs((c.cells[k]?.lvl ?? 0) - 18) < 0.05));

// «ко всем ячейкам»: наклон одной ячейки — во все
await page.locator("svg g").first().click();
await page.waitForTimeout(300);
await page.locator('button:text-is("Дальней")').click();
await page.waitForTimeout(250);
await page.locator("button", { hasText: /ко всем ячейкам/ }).click();
await page.waitForTimeout(350);
c = (await st()).containers[0];
ok("наклон применился ко всем ячейкам",
  ["0:0", "1:0", "0:1", "1:1"].every((k) => c.cells[k]?.tiltDir === "s"));

// визитница: галка на стенке → окна и кнопка скачивания
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("trayGenState"));
  s.containers[0].walls["o:n:0"] = { ...(s.containers[0].walls["o:n:0"] || {}), cardHooks: true };
  localStorage.setItem("trayGenState", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
await page.locator("button", { hasText: /^Принтер$/ }).click();
await page.waitForTimeout(300);
const btn = page.locator("button", { hasText: /Скачать визитницу/ });
ok("кнопка визитницы появилась", (await btn.count()) === 1);
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), btn.click()]);
ok("имя файла визитницы", dl.suggestedFilename() === "card_holder.stl");
const buf = readFileSync(await dl.path());
const nT = buf.readUInt32LE(80);
ok(`STL визитницы валиден (${nT} тр.)`, buf.length === 84 + nT * 50 && nT >= 84);

// обмен контейнеров местами
await page.locator("button", { hasText: /^Раскладка$/ }).click();
await page.waitForTimeout(300);
await page.locator('button:text-is("+")').first().click();
await page.waitForTimeout(600);
const before = (await st()).containers.map((x) => [x.gx, x.gy, x.id]);
await page.locator("button", { hasText: /Поменять контейнеры местами/ }).click();
await page.waitForTimeout(200);
await page.locator('button:text-is("№1")').click();
await page.waitForTimeout(200);
await page.locator('button:text-is("№2")').click();
await page.waitForTimeout(400);
const after = (await st()).containers.map((x) => [x.gx, x.gy, x.id]);
ok("контейнеры поменялись местами",
  after[0][0] === before[1][0] && after[0][1] === before[1][1] &&
  after[1][0] === before[0][0] && after[1][1] === before[0][1]);

// «+» доступен даже когда раскладка заполнена (лимит меньше сборки)
await setNum("Раскладка по X", 5);
await setNum("Раскладка по Y", 5);
ok("плюсы на месте при заполненной раскладке", (await page.locator('button:text-is("+")').count()) > 0);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nMISC UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
