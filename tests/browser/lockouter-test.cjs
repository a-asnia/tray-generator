// «Зафиксировать внешний размер» — намертво: габарит не меняется от
// размеров ячеек, от магнита соседей, от сетки. Ячейки внутри при этом
// перераспределяются.
const { createServer } = require("node:http");
const { readFileSync } = require("node:fs");
const { chromium } = require("playwright");
const HTML = require("node:path").join(__dirname, "..", "..", "tray-generator.html");

(async () => {
  const html = readFileSync(HTML);
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });
  await new Promise((r) => server.listen(8943, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8943/", { waitUntil: "load" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(800);

  const checks = [];
  const ok = (name, cond) => { checks.push([name, !!cond]); };
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
  const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;
  const state = () => page.evaluate(() => JSON.parse(window.localStorage.getItem("trayGenState")));
  const rowsOf = (idx = 0) => page.evaluate((i) => {
    const st = JSON.parse(window.localStorage.getItem("trayGenState"));
    return layout(st.containers[i]).rowCols;
  }, idx);
  const setNum = async (label, v) => {
    const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
    await el.fill(String(v));
    await el.press("Enter");
    await page.waitForTimeout(300);
  };

  // 2 колонки, зафиксировать внешний размер
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: /Зафиксировать внешний размер/ }).click();
  await page.waitForTimeout(300);
  let st = await state();
  ok("замок включился", st.containers[0].lockOuter === true);
  ok("подсказка про намертво показана", await page.getByText("Габарит не меняют ни ячейки").count());
  const W0 = st.containers[0].W, D0 = st.containers[0].D;

  // главный баг: меняем размер ячейки — контейнер НЕ должен меняться
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  await setNum("Ширина ячейки", 50);
  st = await state();
  let rc = await rowsOf();
  ok(`ширина контейнера не изменилась (${st.containers[0].W} = ${W0})`, near(st.containers[0].W, W0));
  ok(`ячейка стала 50 (${rc[0][0].toFixed(1)})`, near(rc[0][0], 50));
  ok(`соседняя ячейка впитала разницу (${rc[0][1].toFixed(1)})`, near(rc[0][0] + rc[0][1], W0 - 2 * 2.9 - 1.6));

  // глубина ячейки — то же самое
  await setNum("Глубина ячейки", 60);
  st = await state();
  ok(`глубина контейнера не изменилась (${st.containers[0].D} = ${D0})`, near(st.containers[0].D, D0));

  // добавление колонок/рядов не меняет габарит
  await goCont();
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  await page.locator('div:has(> label:text-is("Ряды")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  st = await state();
  ok(`сетка изменилась, габарит нет (${st.containers[0].W}×${st.containers[0].D})`,
    near(st.containers[0].W, W0) && near(st.containers[0].D, D0) && st.containers[0].cols === 3);

  // фиксация ячейки (бокс) не меняет габарит
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: "Зафиксировать эту ячейку" }).click();
  await page.waitForTimeout(400);
  st = await state();
  ok(`бокс создан, габарит прежний (${st.containers[0].W})`,
    st.containers[0].fixedCells.length === 1 && near(st.containers[0].W, W0));

  // магнит соседей не двигает зафиксированный контейнер
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await setNum("Раскладка по X", 40);
  await page.locator('button:text-is("+")').nth(2).click(); // сосед справа
  await page.waitForTimeout(500);
  st = await state();
  const lockedIdx = st.containers.findIndex((c) => c.lockOuter);
  const otherIdx = 1 - lockedIdx;
  await page.getByRole("button", { name: `№${otherIdx + 1}`, exact: true }).click();
  await goCont();
  await setNum("Ширина", 100);
  st = await state();
  ok(`сосед ужат до 100, зафиксированный не тронут (${st.containers[lockedIdx].W} = ${W0})`,
    near(st.containers[otherIdx].W, 100) && near(st.containers[lockedIdx].W, W0));

  // снять замок — размер снова меняется
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.getByRole("button", { name: `№${lockedIdx + 1}`, exact: true }).click();
  await goCont();
  await page.locator("button", { hasText: /Зафиксировать внешний размер/ }).click();
  await page.waitForTimeout(300);
  await setNum("Ширина", 120);
  st = await state();
  ok(`после снятия замка размер меняется (${st.containers[lockedIdx].W})`, near(st.containers[lockedIdx].W, 120));

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nLOCK OUTER TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
