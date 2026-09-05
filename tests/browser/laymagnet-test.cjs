// «Магнит раскладки» в собранной странице: галка на «Раскладке»,
// дотяжка крайнего контейнера до края лимита, заполнение пустого места
// новыми контейнерами, сохранение настройки.
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
await new Promise((r) => server.listen(8966, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8966/", { waitUntil: "load" });
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

// контейнер 150 мм шириной, лимит раскладки 16 см — зазор 10 мм
await setNum("Ширина", 150);
await page.locator("button", { hasText: /^Раскладка$/ }).click();
await page.waitForTimeout(300);
await setNum("Раскладка по X", 16);
await setNum("Раскладка по Y", 17);
let s0 = await st();
ok("до магнита ничего не менялось", s0.containers.length === 1 && s0.containers[0].W === 150);

await page.locator('label:has-text("Магнит раскладки") input').check();
await page.waitForTimeout(700);
let s1 = await st();
ok("галка включилась и сохранилась", s1.layMagnet === true);
ok(`крайний дорос до края (${s1.containers[0].W})`, Math.abs(s1.containers[0].W - 160) < 0.05);
ok("контейнер не добавлялся", s1.containers.length === 1);

// расширяем лимит — пустое место заполняется новым контейнером
await setNum("Раскладка по X", 30);
await page.waitForTimeout(700);
let s2 = await st();
ok(`место закрыто новым контейнером (${s2.containers.length} шт.)`, s2.containers.length === 2);
const edge = Math.max(...s2.containers.map((c) => c.px + c.W));
ok(`сборка дотянута до края (${edge.toFixed(0)} = 300)`, Math.abs(edge - 300) < 0.05);

// настройка переживает перезагрузку
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
ok("галка пережила перезагрузку", (await st()).layMagnet === true);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nLAYOUT MAGNET UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
