// Пресеты контейнеров в собранной странице: кнопки в «Контейнер №N»,
// применение на месте (след сохраняется), горка с параметрами.
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
await new Promise((r) => server.listen(8963, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://127.0.0.1:8963/", { waitUntil: "load" });
await page.waitForSelector("canvas");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("canvas");
await page.waitForTimeout(700);

let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "OK  " : "FAIL"} ${n}${extra}`); if (!c) fail++; };
const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("trayGenState")).containers[0]);
const setNum = async (label, v) => {
  const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
  await el.fill(String(v)); await el.press("Enter"); await page.waitForTimeout(250);
};

const c0 = await st();
ok("блок «Пресеты» на месте", (await page.locator('button:has-text("Пресеты")').count()) === 1);

// органайзер 4–6
await page.locator('button:text-is("Органайзер 4–6")').click();
await page.waitForTimeout(500);
let c = await st();
ok("органайзер: 6 отсеков", c.cols * c.rows === 6);
ok("след сохранён", c.W === c0.W && c.D === c0.D);

// буклетница
await page.locator('button:text-is("Буклетница")').click();
await page.waitForTimeout(500);
c = await st();
ok("буклетница: 3 кармана каскадом", c.rows === 3 && c.walls["o:n:0"].h < c.walls["h:1:0"].h && c.H === 110);
ok("буклетница: полы наклонены назад", c.cells["0:1"]?.tiltDir === "s");

// параметры горки НЕ трогают буклетницу (она сейчас применена)
await setNum("Шаг уровня", 20);
c = await st();
ok("шаг уровня не меняет буклетницу", c.rows === 3 && c.preset === "booklet");

// горка с параметрами
await setNum("Ступенек", 4);
await setNum("Шаг уровня", 12);
await page.locator('button:text-is("Горка — применить")').click();
await page.waitForTimeout(600);
c = await st();
ok("горка: 4 ступени", c.rows === 4);
ok("горка: уровни с шагом 12", Math.abs((c.cells["0:2"]?.lvl ?? 0) - 24) < 0.05);
ok("горка: ряды равные (rowDs не заданы)", !c.rowDs && Object.keys(c.lockedRows || {}).length === 0);
ok("горка: задняя стенка без переопределения (следует H)", c.walls["o:s:3"] === undefined);
ok("горка: боковые ступеньками", c.walls["o:w:1"].h < c.walls["o:w:3"].h);
ok("след после горки сохранён", c.W === c0.W && c.D === c0.D);

// параметры применённой горки меняют её вживую, без кнопки
ok("подпись «применена» видна", (await page.getByText(/применена, параметры меняют/).count()) > 0);
await setNum("Ступенек", 3);
c = await st();
ok("живое изменение числа ступенек", c.rows === 3);

// колонки горки: перегородки между колонками — бортики, не спинки
await setNum("Колонки", 3);
c = await st();
ok("колонки горки применились", c.cols === 3);
ok("уровни у всех колонок", Math.abs((c.cells["2:1"]?.lvl ?? 0) - 12) < 0.05);
ok("перегородки колонок — бортики", c.walls["v:0:1"] && c.walls["v:0:1"].h < c.H - 5);
ok("передние сегменты всех колонок — бортики", c.walls["o:n:2"] && c.walls["o:n:2"].h < 12);

// регулировка уровня пола ячейки тянет бортики за собой
await page.locator("button", { hasText: /^Ячейка$/ }).first().click();
await page.waitForTimeout(250);
await page.locator("svg g").first().click();
await page.waitForTimeout(300);
await setNum("Уровень пола", 30);
c = await st();
ok("уровень ячейки задан", Math.abs((c.cells["0:0"]?.lvl ?? 0) - 30) < 0.05);
ok(`бортик ячейки вырос за уровнем (${c.walls["o:n:0"]?.h})`,
  Math.abs(c.walls["o:n:0"].h - (30 + c.floor + 6)) < 0.1);

// шаг уровня ограничен лимитом принтера
await page.locator("button", { hasText: /^Контейнер №/ }).first().click();
await page.waitForTimeout(250);
await setNum("Ступенек", 8);
await setNum("Шаг уровня", 60);
c = await st();
ok(`горка не выше лимита принтера (H ${c.H} ≤ 175)`, c.H <= 175.01);

// бортик: высота всех сегментов над полом настраивается — глубокие ячейки,
// и ручной уровень пола при этом не сбрасывается
await setNum("Ступенек", 3);
await page.locator("button", { hasText: /^Ячейка$/ }).first().click();
await page.waitForTimeout(250);
await page.locator("svg g").first().click();
await page.waitForTimeout(300);
await setNum("Уровень пола", 22);
await page.locator("button", { hasText: /^Контейнер №/ }).first().click();
await page.waitForTimeout(250);
await setNum("Бортик (глубина ячеек)", 35);
c = await st();
ok("бортик сохранился на контейнере", Math.abs(c.stairsLip - 35) < 0.05);
ok("ручной уровень пола пережил смену бортика", Math.abs((c.cells["0:0"]?.lvl ?? 0) - 22) < 0.05);
ok(`бортик считается от ручного уровня (${c.walls["o:n:0"]?.h})`,
  Math.abs(c.walls["o:n:0"].h - (22 + c.floor + 35)) < 0.1);

// низкий и узкий
await page.locator('button:text-is("Низкий большой")').click();
await page.waitForTimeout(400);
c = await st();
ok("низкий: 1×1 и H=14", c.cols === 1 && c.rows === 1 && c.H === 14);
await page.locator('button:text-is("Узкий с делениями")').click();
await page.waitForTimeout(400);
c = await st();
ok(`узкий: много колонок (${c.cols})`, c.cols >= 4 && c.rows === 1);

ok("ошибок в консоли нет", errs.length === 0, errs.length ? ` → ${errs[0]}` : "");
await browser.close();
server.close();
console.log(fail === 0 ? "\nPRESET UI TEST PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
})();
