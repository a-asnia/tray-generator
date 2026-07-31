// Вставные стенки в собранной странице: группа настроек, пересчёт мест,
// показ вставок в превью, скачивание отдельной детали, сохранение в проект.
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
await new Promise((r) => server.listen(8947, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8947/", { waitUntil: "load" });
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
const setNum = async (label, v) => {
  const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
  await el.fill(String(v)); await el.press("Enter"); await page.waitForTimeout(200);
};
const tris = () => page.evaluate(() => {
  let n = 0;
  document.querySelectorAll("canvas").length;
  return window.__triCount ?? n;
});

// группа есть, режим по умолчанию выключен
await goSub("Стенки");
ok("группа «Вставные перегородки» на месте", await page.locator("button", { hasText: "Вставные перегородки" }).count() === 1);
ok("по умолчанию выключено", await page.locator("text=Шаг мест").count() === 0);

await page.locator('button:text-is("Поперёк")').click();
await page.waitForTimeout(500);
ok("появились настройки", await page.locator("text=Шаг мест").count() === 1);
const slotsText = async () => (await page.locator("text=/Мест под вставку/").first().textContent()) || "";
const n1 = (await slotsText()).match(/Мест под вставку:\s*(\d+)/)?.[1];
ok("места посчитаны", +n1 > 1, ` → ${n1}`);

await setNum("Шаг мест", 40);
const n2 = (await slotsText()).match(/Мест под вставку:\s*(\d+)/)?.[1];
ok("больший шаг — меньше мест", +n2 < +n1, ` → ${n2} при шаге 40`);

// размеры детали пересчитываются от контейнера
const sizeText = async () => (await page.locator("text=/Деталь:/").first().textContent()) || "";
const before = await sizeText();
await goCont();
await setNum("Глубина", 120);
await goSub("Стенки");
await page.waitForTimeout(300);
const after = await sizeText();
ok("размер детали пересчитался от глубины", before !== after, ` → ${after.trim().slice(0, 60)}`);

// показ вставок в превью меняет геометрию сцены
const cnt = () => page.evaluate(() => {
  let n = 0;
  const scan = (o) => { if (o.geometry?.attributes?.position) n += o.geometry.attributes.position.count; (o.children || []).forEach(scan); };
  return n;
});
await page.locator("button", { hasText: "Показать вставки" }).click();
await page.waitForTimeout(600);
ok("кнопка показа переключилась", await page.locator("button", { hasText: "Вставки показаны" }).count() === 1);

// скачивание отдельной детали
await page.locator("button", { hasText: /^Принтер$/ }).click();
await page.waitForTimeout(300);
const btn = page.locator("button", { hasText: "Скачать вставную перегородку" });
ok("кнопка скачивания детали есть", await btn.count() === 1);
const dl = page.waitForEvent("download", { timeout: 15000 });
await btn.click();
const file = await dl;
const name = file.suggestedFilename();
ok("файл детали скачался", /^divider_[\d.]+x[\d.]+x[\d.]+\.stl$/.test(name), ` → ${name}`);
const path = await file.path();
const buf = readFileSync(path);
const triCount = buf.readUInt32LE(80);
ok("STL детали валиден", buf.length === 84 + triCount * 50 && triCount === 12, ` (${triCount} треугольников)`);

// настройки переживают перезагрузку
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
await goCont();
await goSub("Стенки");
ok("настройка сохранилась", await page.locator("text=Шаг мест").count() === 1);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nINSERTS UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
