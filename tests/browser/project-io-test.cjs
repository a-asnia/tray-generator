// Экспорт/импорт проекта: сохранение в файл, полное восстановление
// работы после сброса, отказ на чужом файле.
const { createServer } = require("node:http");
const { readFileSync, writeFileSync } = require("node:fs");
const { chromium } = require("playwright");
const HTML = require("node:path").join(__dirname, "..", "..", "tray-generator.html");

(async () => {
  const html = readFileSync(HTML);
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });
  await new Promise((r) => server.listen(8944, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8944/", { waitUntil: "load" });
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
  const setNum = async (label, v) => {
    const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
    await el.fill(String(v));
    await el.press("Enter");
    await page.waitForTimeout(300);
  };

  // собираем узнаваемый проект: сетка, размер ячейки, бокс, второй контейнер
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(200);
  await page.locator('div:has(> label:text-is("Ряды")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  await setNum("Ширина ячейки", 55);
  await page.locator("button", { hasText: "Зафиксировать эту ячейку" }).click();
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.locator('button:text-is("+")').nth(2).click();
  await page.waitForTimeout(500);
  const before = await state();
  const N = before.containers.length;
  ok(`проект собран: ${N} контейнер(ов), бокс ${before.containers[0].fixedCells.length}`,
    N >= 2 && before.containers[0].fixedCells.length === 1);

  // сохранить проект в файл
  await page.locator("button", { hasText: /^Принтер$/ }).click();
  ok("группа «Проект» на вкладке Принтер", await page.getByText("Сохранить проект в файл").count());
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.locator("button", { hasText: "Сохранить проект в файл" }).click(),
  ]);
  const projPath = "/tmp/proj.json";
  writeFileSync(projPath, readFileSync(await dl.path()));
  const saved = JSON.parse(readFileSync(projPath, "utf8"));
  ok(`файл проекта: ${dl.suggestedFilename()}`, /^tray-project-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()));
  ok("в файле формат и контейнеры", saved.format === "tray-generator-project" && saved.containers.length === N);
  ok("сообщение об успехе", await page.getByText("Проект сохранён в файл").count());

  // сбросить проект начисто
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.locator("button", { hasText: /Сбросить проект/ }).click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /Точно сбросить/ }).click();
  await page.waitForTimeout(500);
  let st = await state();
  ok("после сброса один пустой контейнер", st.containers.length === 1 && (st.containers[0].fixedCells || []).length === 0);

  // импортировать проект обратно
  await page.locator("button", { hasText: /^Принтер$/ }).click();
  await page.setInputFiles('input[type="file"]', projPath);
  await page.waitForTimeout(700);
  st = await state();
  ok(`проект восстановлен: ${st.containers.length} из ${N}`, st.containers.length === N);
  ok("бокс восстановлен", (st.containers[0].fixedCells || []).length === 1 &&
    near(st.containers[0].fixedCells[0].w, before.containers[0].fixedCells[0].w));
  ok("сетка восстановлена", st.containers[0].cols === before.containers[0].cols && st.containers[0].rows === before.containers[0].rows);
  ok("размеры ячеек восстановлены",
    JSON.stringify(st.containers[0].rowColWs) === JSON.stringify(before.containers[0].rowColWs));
  ok("лимиты восстановлены", st.limits.layW === before.limits.layW && st.limits.maxW === before.limits.maxW);
  ok("сообщение об открытии", await page.getByText(/Проект открыт/).count());

  // модель после импорта живая: STL скачивается
  const [dl2] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.locator("button", { hasText: /Скачать STL — контейнер №1/ }).click(),
  ]);
  const buf = readFileSync(await dl2.path());
  const nTri = buf.readUInt32LE(80);
  ok(`STL после импорта валиден (${nTri} тр.)`, buf.length === 84 + nTri * 50 && nTri > 100);

  // чужой файл — понятная ошибка, проект не ломается
  const badPath = "/tmp/bad.json";
  writeFileSync(badPath, '{"hello":"world"}');
  await page.setInputFiles('input[type="file"]', badPath);
  await page.waitForTimeout(600);
  ok("отказ на чужом файле", await page.getByText(/это не файл проекта/).count());
  st = await state();
  ok("проект не пострадал", st.containers.length === N);

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nPROJECT IO TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
