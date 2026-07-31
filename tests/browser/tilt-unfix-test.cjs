// 1) Наклон пола включается одним выбором стороны (угол по умолчанию 5°).
// 2) «Снять фиксацию» оставляет ячейку в сетке на своём месте,
//    «Растворить в сетке» — убирает её, место забирают соседи.
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
  await new Promise((r) => server.listen(8949, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8949/", { waitUntil: "load" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(700);

  const checks = [];
  const ok = (n, c) => { checks.push([n, !!c]); };
  const near = (a, b, eps = 0.6) => Math.abs(a - b) < eps;
  const state = () => page.evaluate(() => JSON.parse(window.localStorage.getItem("trayGenState")));
  const floorTop = () => page.evaluate(() => {
    const c = JSON.parse(window.localStorage.getItem("trayGenState")).containers[0];
    const s = buildContainer(c, { N: null, S: null, W: null, E: null }).filter((x) => x.tag === "floor");
    let hi = -1e9;
    for (const b of s) for (const t of b.tris) for (const p of t) hi = Math.max(hi, p[1]);
    return +hi.toFixed(2);
  });
  const rowsOf = () => page.evaluate(() => {
    const c = JSON.parse(window.localStorage.getItem("trayGenState")).containers[0];
    return layout(c).rowCols;
  });

  // ── наклон пола: одного клика по стороне достаточно
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(250);
  await page.locator("svg g").first().click();
  await page.waitForTimeout(250);
  const flat = await floorTop();
  ok(`пол ровный до наклона (верх ${flat} мм)`, near(flat, 1.6));
  await page.locator("button", { hasText: /^Ближней$/ }).click();
  await page.waitForTimeout(400);
  const tilted = await floorTop();
  let st = await state();
  ok(`после выбора стороны пол наклонён (верх ${tilted} мм)`, tilted > 5);
  ok("угол записан в модель (5°)", st.containers[0].cells["0:0"].tiltA === 5);
  // выключение возвращает ровный пол
  // «Нет» именно в блоке наклона пола: в панели есть и другие кнопки «Нет»
  await page.locator('div:has(> div:text-is("Наклон пола (спуск к стороне)")) button:text-is("Нет")').first().click();
  await page.waitForTimeout(400);
  ok(`«Нет» возвращает ровный пол (${await floorTop()} мм)`, near(await floorTop(), 1.6));

  // ── фиксация: «снять фиксацию» оставляет ячейку в сетке
  await page.locator("svg g").first().click();
  await page.waitForTimeout(250);
  const rowsBefore = await rowsOf();
  await page.locator("button", { hasText: "Зафиксировать эту ячейку" }).click();
  await page.waitForTimeout(450);
  st = await state();
  const boxW = st.containers[0].fixedCells[0].w;
  ok(`бокс создан (${boxW} мм), ячеек в ряду ${(await rowsOf())[0].length}`,
    st.containers[0].fixedCells.length === 1 && (await rowsOf())[0].length === rowsBefore[0].length - 1);

  ok("есть обе кнопки", (await page.locator("button", { hasText: /^🔓 Снять фиксацию$/ }).count()) === 1 &&
    (await page.locator("button", { hasText: /^Растворить в сетке$/ }).count()) === 1);

  await page.locator("button", { hasText: /^🔓 Снять фиксацию$/ }).click();
  await page.waitForTimeout(450);
  st = await state();
  const rowsAfter = await rowsOf();
  ok("фиксация снята", (st.containers[0].fixedCells || []).length === 0);
  ok(`ячейка осталась в сетке: ${rowsAfter[0].length} ячеек (было ${rowsBefore[0].length})`,
    rowsAfter[0].length === rowsBefore[0].length);
  ok(`её ширина сохранена (${rowsAfter[0][0].toFixed(1)} ≈ ${boxW})`, near(rowsAfter[0][0], boxW));

  // ── «растворить в сетке» убирает ячейку
  await page.locator("svg g").first().click();
  await page.waitForTimeout(250);
  await page.locator("button", { hasText: "Зафиксировать эту ячейку" }).click();
  await page.waitForTimeout(450);
  await page.locator("button", { hasText: /^Растворить в сетке$/ }).click();
  await page.waitForTimeout(450);
  st = await state();
  const rowsDis = await rowsOf();
  ok("бокс убран", (st.containers[0].fixedCells || []).length === 0);
  ok(`ячейка растворена: ${rowsDis[0].length} ячеек (на одну меньше)`, rowsDis[0].length === rowsBefore[0].length - 1);

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nTILT/UNFIX TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
