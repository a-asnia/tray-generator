// Битое или чужое автосохранение не должно ломать приложение: значения
// чинятся при загрузке, а если что-то всё же упадёт — вместо белой
// страницы показывается экран с кнопкой «Начать заново».
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
await new Promise((r) => server.listen(8946, r));
const browser = await chromium.launch();
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };

const load = async (stored) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("http://127.0.0.1:8946/", { waitUntil: "load" });
  await page.evaluate((s) => { if (s === null) localStorage.clear(); else localStorage.setItem("trayGenState", s); }, stored);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(900);
  const hasCanvas = (await page.locator("canvas").count()) > 0;
  const guard = (await page.locator("text=Начать заново").count()) > 0;
  const w = await page.locator('div:has(> div > label:has-text("Ширина")) input[type="number"]').first().inputValue().catch(() => null);
  await page.close();
  return { hasCanvas, guard, errs, w };
};

let r = await load('не json вообще');
ok("нечитаемое сохранение → приложение работает", r.hasCanvas && !r.guard, ` (ширина ${r.w})`);

r = await load(JSON.stringify({ containers: [{ rows: 0, cols: 0, W: null, H: "abc", wall: -5 }] }));
ok("невозможные значения → значения починены", r.hasCanvas && !r.guard, ` (ширина ${r.w})`);

r = await load(JSON.stringify({
  containers: [{ W: 1e9, cols: 1e6, walls: 42, cells: 7, fixedCells: [null, 3], rowColWs: { 0: [NaN] } }],
  limits: { maxW: "нет", layW: -1, connClr: 99 },
}));
ok("мусор в каждом поле → приложение работает", r.hasCanvas && !r.guard, ` (ширина ${r.w})`);

r = await load(JSON.stringify({ format: "чужой-формат", containers: [{ совсем: "другое" }] }));
ok("чужой формат → значения по умолчанию", r.hasCanvas && !r.guard, ` (ширина ${r.w})`);

r = await load(null);
ok("чистый запуск", r.hasCanvas && !r.guard, ` (ширина ${r.w})`);
ok("ошибок в консоли нет", r.errs.length === 0, r.errs.length ? ` → ${r.errs[0]}` : "");

await browser.close();
server.close();
console.log(fail === 0 ? "\nRECOVERY TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
