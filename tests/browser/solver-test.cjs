// Решатель в собранной странице: доля при делении остатка в редакторе
// ячейки, «эта ячейка всегда такая» держится, а при конфликте появляется
// предупреждение с точным дефицитом (вместо молчаливого ужатия).
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
await new Promise((r) => server.listen(8952, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8952/", { waitUntil: "load" });
await page.waitForSelector("canvas");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const goSub = async (n) => { await page.locator(`button:text-is("${n}")`).first().click(); await page.waitForTimeout(250); };
const goCont = async () => {
  await page.locator("button", { hasText: /^Контейнеры$/ }).first().click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /^Контейнер №/ }).first().click();
  await page.waitForTimeout(250);
};
const setNum = async (label, v) => {
  const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
  await el.fill(String(v)); await el.press("Enter"); await page.waitForTimeout(250);
};
const model = () => page.evaluate(() => JSON.parse(localStorage.getItem("trayGenState")));
const widths = async () => {
  const st = await model();
  const c = st.containers[0];
  const inner = c.W - 2 * c.wallOut - (3 - 1) * c.wall;
  const ws = (c.rowColWs && c.rowColWs[0]) || [inner / 3, inner / 3, inner / 3];
  return ws.map((v) => Math.round(v * 10) / 10);
};

// сетка 1×3
await goCont();
await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
await page.waitForTimeout(250);
await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
await page.waitForTimeout(400);

// доля: первая ячейка ×2
await page.locator("svg g").first().click();
await page.waitForTimeout(400);
ok("редактор ячейки открыт", await page.getByText("Ячейка 1×1").count());
ok("поле доли на месте", await page.locator("text=Доля при делении остатка").count() === 1);
await setNum("Доля при делении остатка", 2);
await page.waitForTimeout(400);
{
  const st = await model();
  ok("доля записана в модель", st.containers[0].cellShares && st.containers[0].cellShares["0:0"] === 2);
}

// «эта ячейка всегда такая»: вторая держит размер при любом делении
await page.locator("svg g").nth(1).click();
await page.waitForTimeout(300);
await setNum("Ширина ячейки", 40);
await page.locator("button", { hasText: /🔓 ширина/ }).click();
await page.waitForTimeout(400);
const before = await widths();
ok(`вторая зафиксирована на ~40 (${before[1]})`, Math.abs(before[1] - 40) < 0.5);
ok("первая вдвое шире третьей (доля 2)", Math.abs(before[0] - 2 * before[2]) < 1, ` → ${before.join(" / ")}`);

// слайдер до конфликта не доводит: минимум ширины учитывает замки
await goCont();
await setNum("Ширина", 55);
await page.waitForTimeout(400);
{
  const st = await model();
  ok(`слайдер не даёт ужать ниже замков (W=${st.containers[0].W})`, st.containers[0].W > 45);
  ok("и предупреждения нет", (await page.locator("text=не хватает").count()) === 0);
}

// а вот открытый «плохой» проект — реальный путь к конфликту:
// зафиксированная ячейка шире, чем есть места
await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem("trayGenState"));
  const c = st.containers[0];
  c.W = 60; c.rowColWs = { 0: [45, 20, 20] }; c.lockedCellW = { "0:0": true };
  localStorage.setItem("trayGenState", JSON.stringify(st));
});
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
ok("конфликт из проекта показан с дефицитом", (await page.locator("text=не хватает").count()) >= 1,
  ` → ${(await page.locator("text=/не хватает/").first().textContent().catch(() => "")).trim().slice(0, 80)}`);

// снять замок — конфликт уходит
await page.locator("svg g").first().click();
await page.waitForTimeout(400);
await page.locator("button", { hasText: /🔒 ширина/ }).click();
await page.waitForTimeout(400);
ok("после снятия замка конфликт ушёл", (await page.locator("text=не хватает").count()) === 0);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nSOLVER UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
