// Тест: сброс не уводит с текущей вкладки; лимит раскладки по умолчанию
// 40×40 см; режима «Размер ячейки» нет, поля размера — только в
// редакторе выбранной ячейки.
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
  await new Promise((r) => server.listen(8936, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8936/", { waitUntil: "load" });
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
  const state = () => page.evaluate(() => JSON.parse(window.localStorage.getItem("trayGenState")));

  // лимит раскладки по умолчанию 40×40
  const st0 = await state();
  ok(`лимит раскладки по умолчанию 40×40 (${st0.limits.layW}×${st0.limits.layD})`, st0.limits.layW === 40 && st0.limits.layD === 40);

  // режима «Размер ячейки» нет; поля размера ячейки — только по выбору ячейки
  ok("кнопки режима «Размер ячейки» нет", (await page.locator("button", { hasText: /^Размер ячейки$/ }).count()) === 0);
  ok("полей «Ячейка по ширине» нет", (await page.getByText("Ячейка по ширине").count()) === 0);
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  ok("поля размера в редакторе ячейки есть", await page.getByText("Ширина ячейки").count());

  // сброс на вкладке Раскладка оставляет на Раскладке
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.locator("button", { hasText: /Сбросить проект/ }).click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /Точно сбросить/ }).click();
  await page.waitForTimeout(400);
  ok("после сброса остались на Раскладке", await page.getByText("Лимит раскладки").count());
  const st1 = await state();
  ok("сброс сработал (1 контейнер, лимит 40×40)", st1.containers.length === 1 && st1.limits.layW === 40);

  await page.screenshot({ path: "/tmp/tabreset.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nTAB/RESET TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
