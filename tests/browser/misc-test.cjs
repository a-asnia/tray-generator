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

// перетаскивание контейнеров по карте раскладки: два контейнера разной
// ширины в одном ряду (клетки должны удержать свои габариты)
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("trayGenState"));
  const a = { ...s.containers[0], id: 1, gx: 0, gy: 0, W: 150, D: 120, cols: 1, rows: 1, cells: {}, walls: {} };
  s.containers = [a, { ...a, id: 2, gx: 1, gy: 0, W: 90 }];
  localStorage.setItem("trayGenState", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
await page.locator("button", { hasText: /^Раскладка$/ }).click();
await page.waitForTimeout(300);

const centerOf = async (label) => {
  const b = await page.locator(`button:text-is("${label}")`).boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};
const dragCell = async (from, toXY) => {
  const [x0, y0] = await centerOf(from);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 10, y0 + 4, { steps: 3 });
  await page.mouse.move(toXY[0], toXY[1], { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(450);
};
await dragCell("№1", await centerOf("№2"));
let cs = (await st()).containers;
const after = cs.map((x) => [x.gx, x.gy, x.id]);
ok("перетаскивание поменяло контейнеры местами",
  cs[0].gx === 1 && cs[0].gy === 0 && cs[1].gx === 0 && cs[1].gy === 0,
  ` → ${cs.map((c) => `${c.gx},${c.gy}`).join(" | ")}`);
ok("контейнеры приняли габарит своей клетки",
  Math.abs(cs[0].W - 90) < 0.05 && Math.abs(cs[1].W - 150) < 0.05,
  ` → ${cs.map((c) => c.W).join(" | ")}`);
ok("габариты остались за клетками (сборка плотная)",
  cs.every((c) => {
    const colW = Math.max(...cs.filter((o) => o.gx === c.gx).map((o) => o.W));
    const rowD = Math.max(...cs.filter((o) => o.gy === c.gy).map((o) => o.D));
    return Math.abs(c.W - colW) < 0.05 && Math.abs(c.D - rowD) < 0.05;
  }),
  ` → ${cs.map((c) => `${c.gx},${c.gy}:${c.W}×${c.D}`).join(" | ")}`);

// перенос на пустую клетку: контейнер переезжает во второй ряд
const cellXY = await page.evaluate((k) => {
  const el = document.querySelector(`[data-cell="${k}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
}, `${after[1][0]},${after[1][1] + 1}`);
ok("пустая клетка — тоже мишень для переноса", !!cellXY);
if (cellXY) {
  await dragCell("№2", cellXY);
  cs = (await st()).containers;
  ok("контейнер переехал в свободный ряд", cs[1].gy === 1 && cs[0].gy === 0,
    ` → ${cs.map((c) => `${c.gx},${c.gy}`).join(" | ")}`);
  ok("сетка осталась без дыр в начале координат",
    Math.min(...cs.map((c) => c.gx)) === 0 && Math.min(...cs.map((c) => c.gy)) === 0);
}

// клик без сдвига по-прежнему просто выбирает контейнер
await page.locator('button:text-is("№2")').click();
await page.waitForTimeout(250);
ok("одиночный клик выбирает контейнер", (await page.locator('button:text-is("удалить №2")').count()) === 1);

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
