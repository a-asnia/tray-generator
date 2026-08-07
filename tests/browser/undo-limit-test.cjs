// Кнопка «назад» (Ctrl+Z) и жёсткий лимит раскладки: сборка за рамку
// стола не выходит ни при добавлении контейнеров, ни при ужатии лимита.
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
await new Promise((r) => server.listen(8972, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8972/", { waitUntil: "load" });
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
  await el.fill(String(v)); await el.press("Enter"); await page.waitForTimeout(300);
};
const spanW = (cs) => [...new Set(cs.map((c) => c.gx))]
  .reduce((s, g) => s + Math.max(...cs.filter((o) => o.gx === g).map((o) => o.W)), 0);

// секции открыты сразу после загрузки
ok("секции не свёрнуты по умолчанию",
  (await page.locator(String.raw`div:has(> div > label:has-text("Ширина")) input[type="number"]`).first().isVisible()) &&
  (await page.locator("button", { hasText: /Деление на ячейки/ }).first().isVisible()));

// ── шаг назад ──
const undoBtn = page.locator('button[title*="Отменить последнее"]');
ok("кнопка «назад» есть", (await undoBtn.count()) === 1);
ok("в начале нечего отменять", await undoBtn.isDisabled());
const H0 = (await st()).containers[0].H;
await setNum("Высота", 55);
ok("высота изменилась", (await st()).containers[0].H === 55);
await page.waitForTimeout(500);
await undoBtn.click();
await page.waitForTimeout(400);
ok(`«назад» вернул высоту (${(await st()).containers[0].H} = ${H0})`, (await st()).containers[0].H === H0);

// Ctrl+Z отменяет добавление контейнера
await page.locator("button", { hasText: /^Раскладка$/ }).click();
await page.waitForTimeout(300);
await page.locator('button:text-is("+")').first().click();
await page.waitForTimeout(700);
ok("контейнеры добавились", (await st()).containers.length > 1);
await page.keyboard.press("Control+z");
await page.waitForTimeout(400);
ok("Ctrl+Z убрал добавленный контейнер", (await st()).containers.length === 1);

// ── лимит раскладки жёсткий ──
await setNum("Раскладка по X", 20); // 200 мм при контейнере 170
let cs = (await st()).containers;
ok(`сборка влезает в лимит (${spanW(cs)} ≤ 200)`, spanW(cs) <= 200.05);
await page.locator('button:text-is("+")').first().click();
await page.waitForTimeout(700);
cs = (await st()).containers;
ok("контейнер всё равно добавился", cs.length > 1);
ok(`сборка после добавления в лимите (${spanW(cs)} ≤ 200)`, spanW(cs) <= 200.05);
ok("никто не мельче 30 мм", cs.every((c) => c.W >= 29.95));

// ужатие лимита подрезает готовую сборку
await setNum("Раскладка по X", 12);
cs = (await st()).containers;
ok(`ужатый лимит подрезал сборку (${spanW(cs)} ≤ 120)`, spanW(cs) <= 120.05);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nUNDO/LIMIT TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
