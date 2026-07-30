// Браузерный тест замков: 2 колонки → замок ширины ячейки 1 →
// ужатие контейнера → замкнутая колонка держит размер, соседняя ужалась.
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
  await new Promise((r) => server.listen(8932, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8932/", { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 15000 });
  await page.waitForTimeout(800);

  const checks = [];
  const ok = (name, cond) => { checks.push([name, !!cond]); };
  const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

  const colWs = () => page.evaluate(() => {
    const st = JSON.parse(window.localStorage.getItem("trayGenState"));
    return layout(st.containers[0]).colWs;
  });

  // 2 колонки
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  const before = await colWs();
  ok(`две колонки по ${before[0].toFixed(1)} мм`, before.length === 2 && near(before[0], before[1]));

  // выбрать ячейку 1×1 и замкнуть ширину
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  ok("редактор ячейки открыт", await page.getByText("Ячейка 1×1").count());
  ok("кнопки фиксации на месте", await page.getByText("Зафиксировать эту ячейку").count());
  await page.locator("button", { hasText: /🔓 ширина/ }).click();
  await page.waitForTimeout(200);
  ok("замок ширины включился", await page.locator("button", { hasText: /🔒 ширина/ }).count());
  ok("замок виден на схеме", await page.locator("svg text", { hasText: "🔒" }).count());

  // ужать контейнер: Ширина 170 → 150
  const wInput = page.locator('div:has(label:text-is("Ширина")) input[type="number"]').first();
  await wInput.fill("150");
  await wInput.press("Enter");
  await page.waitForTimeout(300);

  const after = await colWs();
  ok(`замкнутая колонка держит ${before[0].toFixed(1)} мм (сейчас ${after[0].toFixed(1)})`, near(after[0], before[0]));
  ok(`свободная колонка ужалась (${after[1].toFixed(1)} < ${before[1].toFixed(1)})`, after[1] < before[1] - 5);

  // вернуть ширину — свободная растёт, замкнутая стоит
  await wInput.fill("170");
  await wInput.press("Enter");
  await page.waitForTimeout(300);
  const back = await colWs();
  ok("после возврата W замкнутая всё ещё держит размер", near(back[0], before[0]) && near(back[1], before[1]));

  // снять замок — сетка выравнивается
  await page.locator("button", { hasText: /🔒 ширина/ }).click();
  await page.waitForTimeout(200);
  const freed = await colWs();
  ok("после снятия замка колонки снова равные", near(freed[0], freed[1]));

  // режим «Размер ячейки» и глобальный «Зафиксировать ячейку» убраны из UI
  ok("режима «Размер ячейки» больше нет", (await page.locator("button", { hasText: /^Размер ячейки$/ }).count()) === 0);
  ok("кнопки «Зафиксировать ячейку» больше нет", (await page.locator("button", { hasText: /Зафиксировать ячейку/ }).count()) === 0);

  await page.screenshot({ path: "/tmp/locks.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ СТРАНИЦЫ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nLOCK BROWSER TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
