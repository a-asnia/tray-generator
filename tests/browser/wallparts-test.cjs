// Вставные стенки контейнера в собранной странице: включение, подгонка
// толщины стенки под соединение, размеры деталей, скачивание базы и
// четырёх стенок, сохранение настройки.
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
await new Promise((r) => server.listen(8948, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8948/", { waitUntil: "load" });
await page.waitForSelector("canvas");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const goSub = async (n) => {
  await page.locator(`button:text-is("${n}")`).first().click();
  await page.waitForTimeout(250);
};
const goCont = async () => {
  await page.locator("button", { hasText: /^Контейнеры$/ }).first().click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /^Контейнер №/ }).first().click();
  await page.waitForTimeout(250);
};
const numOf = async (label) => +(await page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first().inputValue());
const setNum = async (label, v) => {
  const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
  await el.fill(String(v)); await el.press("Enter"); await page.waitForTimeout(250);
};

await goSub("Стенки");
ok("группа на месте", await page.locator("button", { hasText: "Вставные стенки контейнера" }).count() === 1);
ok("по умолчанию выключено", await page.locator("text=Толщина стенки").count() === 0);

// внешняя стенка по умолчанию 2.75 — соединению мало, должна подрасти
await goCont();
await setNum("Внешние стенки", 2.8);
const wallBefore = await numOf("Внешние стенки");
await goSub("Стенки");
await page.locator('button:text-is("Задняя")').click();
await page.waitForTimeout(600);
ok("сторона включилась", await page.locator('button:text-is("✓ Задняя")').count() === 1);
ok("остальные стороны не тронуты", await page.locator('button:text-is("Передняя")').count() === 1);
await goCont();
const wallAfter = await numOf("Внешние стенки");
await goSub("Стенки");
ok("толщина стенки подогнана под соединение", wallAfter > wallBefore, ` (${wallBefore} → ${wallAfter})`);
ok("настройки появились", await page.locator("text=Наружная губка").count() === 1);

const info = async () => (await page.locator("text=/Детали: база/").first().textContent()) || "";
ok("размеры детали показаны", /Детали: база \+ 1 шт/.test(await info()), ` → ${(await info()).trim().slice(0, 90)}`);
// вторая сторона добавляет ещё одну деталь
await page.locator('button:text-is("Левая")').click();
await page.waitForTimeout(500);
ok("две стороны — две детали", /Детали: база \+ 2 шт/.test(await info()), ` → ${(await info()).trim().slice(0, 70)}`);

// экспорт: база и четыре стенки
await page.locator("button", { hasText: /^Принтер$/ }).click();
await page.waitForTimeout(300);
const baseBtn = page.locator("button", { hasText: "Скачать базу" });
ok("кнопка базы есть", await baseBtn.count() === 1);
const dl1 = page.waitForEvent("download", { timeout: 15000 });
await baseBtn.click();
const f1 = await dl1;
ok("база скачалась", /^base_[\d.]+x[\d.]+x[\d.]+\.stl$/.test(f1.suggestedFilename()), ` → ${f1.suggestedFilename()}`);
const b1 = readFileSync(await f1.path());
ok("STL базы валиден", b1.length === 84 + b1.readUInt32LE(80) * 50, ` (${b1.readUInt32LE(80)} треугольников)`);

const got = [];
page.on("download", (d) => got.push(d));
await page.locator("button", { hasText: "Скачать вставные стенки" }).click();
await page.waitForTimeout(3000);
ok("скачались обе стенки", got.length === 2, ` → ${got.map((d) => d.suggestedFilename()).join(", ")}`);
if (got.length === 2) {
  const b = readFileSync(await got[0].path());
  const n = b.readUInt32LE(80);
  ok("STL стенки валиден", b.length === 84 + n * 50 && n > 10, ` (${n} треугольников)`);
  ok("имена деталей различаются", new Set(got.map((d) => d.suggestedFilename())).size === 2);
}

// настройка переживает перезагрузку
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
await goCont();
await goSub("Стенки");
ok("выбор сторон сохранился", await page.locator('button:text-is("✓ Задняя")').count() === 1);

// выключение возвращает цельные стенки
await page.locator('button:text-is("✓ Задняя")').click();
await page.locator('button:text-is("✓ Левая")').click();
await page.waitForTimeout(500);
ok("стороны выключаются", await page.locator('button:text-is("Задняя")').count() === 1);
await page.locator("button", { hasText: /^Принтер$/ }).click();
await page.waitForTimeout(300);
ok("кнопок деталей больше нет", await page.locator("button", { hasText: "Скачать базу" }).count() === 0);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nWALL PARTS UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
