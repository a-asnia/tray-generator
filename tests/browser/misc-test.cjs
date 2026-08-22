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

// перетаскивание по свободному плану: контейнеры любых размеров, никто
// никого не растягивает, края прилипают
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("trayGenState"));
  const a = { ...s.containers[0], id: 1, px: 0, pz: 0, W: 150, D: 120, cols: 1, rows: 1, cells: {}, walls: {} };
  s.containers = [a, { ...a, id: 2, px: 150, pz: 0, W: 90, D: 80 }];
  localStorage.setItem("trayGenState", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);
await page.locator("button", { hasText: /^Раскладка$/ }).click();
await page.waitForTimeout(300);

const boxOf = async (label) => await page.locator(`button:text-is("${label}")`).boundingBox();
const drag = async (from, dx, dy) => {
  const b = await boxOf(from);
  const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 10, y0 + 4, { steps: 3 });
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(450);
};
// №2 (90×80) уводим вниз, под №1 — прилипнет к его нижней грани и к левому краю
const b1 = await boxOf("№1");
const b2v = await boxOf("№2");
await page.mouse.move(b2v.x + b2v.width / 2, b2v.y + b2v.height / 2);
await page.mouse.down();
await page.mouse.move(b2v.x + 10, b2v.y + 10, { steps: 3 });
await page.mouse.move(b1.x + b2v.width / 2 + 2, b1.y + b1.height + b2v.height / 2 + 3, { steps: 10 });
await page.waitForTimeout(150);
await page.mouse.up();
await page.waitForTimeout(500);
let cs = (await st()).containers;
ok("контейнер переехал под первый и прилип",
  Math.abs(cs[1].px - 0) < 0.05 && Math.abs(cs[1].pz - 120) < 0.05,
  ` → ${cs[1].px},${cs[1].pz}`);
ok("размеры никто не менял", cs[0].W === 150 && cs[1].W === 90 && cs[1].D === 80,
  ` → ${cs.map((c) => `${c.W}×${c.D}`).join(" | ")}`);
// перенос в занятое место отменяется
await drag("№2", 10, -40);
cs = (await st()).containers;
ok("перенос в занятое место отменён", Math.abs(cs[1].pz - 120) < 6, ` → ${cs[1].px},${cs[1].pz}`);

// клик без сдвига по-прежнему просто выбирает контейнер
await page.locator('button:text-is("№2")').click();
await page.waitForTimeout(250);
ok("одиночный клик выбирает контейнер", (await page.locator('button:text-is("удалить №2")').count()) === 1);

// «+» доступен даже когда раскладка заполнена (лимит меньше сборки)
await setNum("Раскладка по X", 5);
await setNum("Раскладка по Y", 5);
ok("кнопка «+ контейнер» на месте", (await page.locator('button:text-is("+ контейнер")').count()) === 1);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nMISC UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
