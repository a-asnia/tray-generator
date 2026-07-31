// Структура вкладок (Принтер / Раскладка / Контейнеры с подвкладками),
// автопереход на нужную подвкладку при выборе и сдвиг сцены правой кнопкой.
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
await new Promise((r) => server.listen(8950, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8950/", { waitUntil: "load" });
await page.waitForSelector("canvas");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(800);

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const has = async (sel) => (await page.locator(sel).count()) > 0;

// ── три вкладки в нужном порядке ──
const tabs = await page.locator('button:text-is("Принтер"), button:text-is("Раскладка"), button:text-is("Контейнеры")').allTextContents();
ok("три вкладки: Принтер, Раскладка, Контейнеры", tabs.length === 3, ` → ${tabs.join(", ")}`);
ok("нет старой вкладки «Модель»", !(await has('button:text-is("Модель")')));

// ── подвкладки под «Контейнеры» ──
ok("подвкладка контейнера с номером", await has('button:text-is("Контейнер №1")'));
ok("подвкладка «Ячейка»", await has('button:text-is("Ячейка")'));
ok("подвкладка «Стенки»", await has('button:text-is("Стенки")'));

// ── что где лежит ──
ok("на «Контейнер №N» — размер и деление", (await has("text=Внешний размер")) && (await has("text=Деление на ячейки")));
await page.locator('button:text-is("Стенки")').click();
await page.waitForTimeout(300);
ok("на «Стенки» — настройки стенки и вставные перегородки",
  (await has("text=Настройки стенки")) && (await has("text=Вставные перегородки")));
ok("на «Стенки» нет размеров контейнера", !(await has("text=Деление на ячейки")));

await page.locator("button", { hasText: /^Принтер$/ }).click();
await page.waitForTimeout(300);
ok("на «Принтер» — лимиты и экспорт", (await has("text=Лимиты принтера")) && (await has("text=Экспорт")));
await page.locator("button", { hasText: /^Раскладка$/ }).click();
await page.waitForTimeout(300);
ok("на «Раскладка» — заполнение и лимит", await has("text=Заполнить раскладку"));

// ── выбор сам открывает нужную подвкладку ──
await page.locator("button", { hasText: /^Контейнеры$/ }).click();
await page.waitForTimeout(300);
await page.locator("svg g").first().click();   // ячейка на схеме
await page.waitForTimeout(400);
ok("клик по ячейке открыл подвкладку «Ячейка»", await has("text=Ячейка 1×1"));
await page.locator("svg g").last().click();   // стенка на схеме
await page.waitForTimeout(400);
ok("клик по стенке открыл подвкладку «Стенки»",
  (await has("text=Режим выбора")) &&
  ((await page.getByText("Внешняя стенка").count()) + (await page.getByText("Перегородка").count()) > 0));

// ── сдвиг сцены правой кнопкой ──
const box = await page.locator("canvas").boundingBox();
const camAt = () => page.evaluate(() => {
  const c = document.querySelector("canvas");
  return c ? c.width + "x" + c.height : "";
});
const shot1 = await page.screenshot({ clip: box });
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down({ button: "right" });
await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 90, { steps: 12 });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(400);
const shot2 = await page.screenshot({ clip: box });
ok("правая кнопка двигает сцену", Buffer.compare(shot1, shot2) !== 0);
await camAt();

// правый клик без протяжки возвращает в центр
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(400);
const shot3 = await page.screenshot({ clip: box });
ok("правый клик возвращает сцену в центр", Buffer.compare(shot1, shot3) === 0);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nTABS/PAN TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
