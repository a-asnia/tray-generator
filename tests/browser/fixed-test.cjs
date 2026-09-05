// Фиксированная ячейка = контейнер внутри контейнера: жёсткий размер,
// якорь к углу/стенке, скользит при изменениях, сетка обтекает,
// ряд и колонка не блокируются.
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
  await new Promise((r) => server.listen(8940, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8940/", { waitUntil: "load" });
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
  const fixedRects = () => page.evaluate(() => {
    const st = JSON.parse(window.localStorage.getItem("trayGenState"));
    return layout(st.containers[0]).fixed;
  });
  const setNum = async (label, v) => {
    const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
    await el.fill(String(v));
    await el.press("Enter");
    await page.waitForTimeout(300);
  };

  // 2×2, зафиксировать ячейку 1×1 (угол nw)
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(200);
  await page.locator('div:has(> label:text-is("Ряды")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: "Зафиксировать эту ячейку" }).click();
  await page.waitForTimeout(400);

  ok("редактор фиксированной ячейки открылся", await page.getByText("Фиксированная ячейка 1").count());
  let st = await state();
  const fc0 = st.containers[0].fixedCells[0];
  ok(`бокс создан: ${fc0.w}×${fc0.d}, якорь ${fc0.anchor}`, near(fc0.w, 81.3, 0.1) && near(fc0.d, 81.3, 0.1) && fc0.anchor === "nw");
  ok("ряд не заблокирован (замков нет)", Object.keys(st.containers[0].lockedRows || {}).length === 0);
  ok("сетка ряда отдала ячейку", st.containers[0].rowColWs && st.containers[0].rowColWs[0].length === 1);

  // ужать контейнер: бокс держит размер, позиция — у северо-западного угла
  await goCont();
  await setNum("Ширина", 140);
  let fx = await fixedRects();
  ok(`бокс держит 81.3 мм при W=140 (${(fx[0].x1 - fx[0].x0).toFixed(1)})`, near(fx[0].x1 - fx[0].x0, 81.3, 0.1));
  ok("бокс прижат к левой стенке", near(fx[0].x0, -(140 - 2 * 2.9) / 2));

  // сменить якорь на «→ стенка»: бокс скользит к правой стенке
  await page.locator("svg g").last().click(); // клик по боксу на схеме (рисуется последним)
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: "→ стенка" }).click();
  await page.waitForTimeout(300);
  fx = await fixedRects();
  ok("бокс переехал к правой стенке", near(fx[0].x1, (140 - 2 * 2.9) / 2));
  ok("глубина не изменилась", near(fx[0].z1 - fx[0].z0, 81.3, 0.1));

  // уровень пола бокса
  await setNum("Уровень пола (лесенка)", 8);
  st = await state();
  ok("уровень пола бокса сохранён", near(st.containers[0].fixedCells[0].lvl, 8));

  // STL валиден с боксом
  await page.locator("button", { hasText: /^Принтер$/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.locator("button", { hasText: /Скачать STL — контейнер №1/ }).click(),
  ]);
  const buf = readFileSync(await download.path());
  const nTri = buf.readUInt32LE(80);
  ok(`STL валиден (${nTri} треугольников)`, buf.length === 84 + nTri * 50 && nTri > 100);

  await page.screenshot({ path: "/tmp/fixedcell.png" });

  // снять фиксацию
  await goCont();
  await page.locator("svg g").last().click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: "Снять фиксацию" }).click();
  await page.waitForTimeout(300);
  st = await state();
  ok("фиксация снята", (st.containers[0].fixedCells || []).length === 0);

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nFIXED CELL TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
