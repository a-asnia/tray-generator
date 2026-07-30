// Сквозной тест пункта 3: ужатие контейнера растит соседа (магнит),
// замкнутые колонки внутри соседа при этом не меняются.
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
  await new Promise((r) => server.listen(8933, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8933/", { waitUntil: "load" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(800);

  const checks = [];
  const ok = (name, cond) => { checks.push([name, !!cond]); };
  const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;
  const state = () => page.evaluate(() => JSON.parse(window.localStorage.getItem("trayGenState")));
  const colWsOf = (idx) => page.evaluate((i) => {
    const st = JSON.parse(window.localStorage.getItem("trayGenState"));
    return layout(st.containers[i]).colWs;
  }, idx);
  const numInput = (label) => page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
  const setNum = async (label, v) => { const el = numInput(label); await el.fill(String(v)); await el.press("Enter"); await page.waitForTimeout(300); };

  // принтер пошире, чтобы соседу было куда расти
  await page.locator("button", { hasText: /^Принтер$/ }).click();
  await setNum("Макс. ширина", 200);

  // пристыковать второй контейнер (лимит 37 см: остаток 200 мм — один сосед)
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await setNum("Раскладка по X", 37);
  await page.locator('button:text-is("+")').nth(2).click(); // восточный сосед (в средней строке сетки)
  await page.waitForTimeout(400);
  let st = await state();
  ok("два контейнера", st.containers.length === 2);

  // у нового (выбранного) контейнера: W=180, две колонки, замок первой
  await page.locator("button", { hasText: /^Модель$/ }).click();
  await setNum("Ширина", 180);
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /🔓 ширина/ }).click();
  await page.waitForTimeout(300);

  st = await state();
  const nbIdx = st.containers.findIndex((c) => c.lockedCellW && c.lockedCellW["0:0"]);
  const myIdx = 1 - nbIdx;
  const lockedW0 = (await colWsOf(nbIdx))[0];
  const nbW0 = st.containers[nbIdx].W;
  ok(`сосед: W=${nbW0}, замкнутая колонка ${lockedW0.toFixed(1)} мм`, near(nbW0, 180) && lockedW0 > 50);

  // выбрать первый контейнер и ужать его
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.locator("button", { hasText: `№${myIdx + 1}` }).click();
  await page.locator("button", { hasText: /^Модель$/ }).click();
  const myW0 = (await state()).containers[myIdx].W;
  await setNum("Ширина", 150);

  st = await state();
  const nbW1 = st.containers[nbIdx].W;
  const nbCols1 = await colWsOf(nbIdx);
  ok(`мой контейнер ужался (${myW0} → ${st.containers[myIdx].W})`, near(st.containers[myIdx].W, 150));
  ok(`сосед вырос (${nbW0} → ${nbW1})`, nbW1 > nbW0 + 5);
  ok(`замкнутая колонка соседа не изменилась (${nbCols1[0].toFixed(1)} мм)`, near(nbCols1[0], lockedW0));
  ok("свободная колонка соседа впитала рост", nbCols1[1] > lockedW0 - 5 || nbCols1[1] > 0);

  await page.screenshot({ path: "/tmp/neighbor.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nNEIGHBOR TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
