// Тест: «Заполнить раскладку», перенос «Сбросить проект» на вкладку
// Раскладка, перенос настроек ячеек в «Редактор стенок».
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
  await new Promise((r) => server.listen(8935, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8935/", { waitUntil: "load" });
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
  const resetBtnCount = () => page.locator("button", { hasText: /Сбросить проект/ }).count();

  // «Сбросить проект» нет на Модели и Раскладке, есть на Принтере
  ok("нет сброса на вкладке Контейнеры", (await resetBtnCount()) === 0);
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  ok("нет сброса на вкладке Раскладка", (await resetBtnCount()) === 0);
  ok("описание соединителя на Раскладке", (await page.getByText(/входит в паз соседа/).count()) === 1);
  await page.locator("button", { hasText: /^Принтер$/ }).click();
  ok("сброс есть на вкладке Принтер", (await resetBtnCount()) === 1);
  ok("описания соединителей на Принтере нет", (await page.getByText(/входит в паз соседа/).count()) === 0);

  // настройки ячеек уехали в «Редактор стенок»
  await goCont();
  ok("группа переименована в толщины", await page.getByText("Толщина стенок и дна").count());
  ok("старой группы «Ячейки и перегородки» нет", (await page.getByText("Ячейки и перегородки").count()) === 0);
  ok("группа «Деление на ячейки» есть", await page.locator('button:has-text("Деление на ячейки")').count());
  await goSub("Стенки");
  ok("группа настроек стенки есть", await page.locator('button:has-text("Настройки стенки")').count());
  ok("кнопки «Зафиксировать ячейку» нет", (await page.locator("button", { hasText: /Зафиксировать ячейку/ }).count()) === 0);
  // и по-прежнему работают: две колонки через степпер
  await goCont();
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  ok("степпер колонок работает на новом месте", (await state()).containers[0].cols === 2);

  // «Заполнить раскладку»: рамка 40×40 см закрывается контейнерами целиком
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await setNum("Раскладка по X", 40);
  await setNum("Раскладка по Y", 40);
  await page.locator("button", { hasText: "Заполнить раскладку" }).click();
  await page.waitForTimeout(800);
  const st = await state();
  ok(`заполнилось 9 контейнеров (${st.containers.length})`, st.containers.length === 9);
  const noOv = st.containers.every((a, i) => st.containers.every((b, j) => i >= j ||
    a.px + a.W <= b.px + 0.05 || b.px + b.W <= a.px + 0.05 ||
    a.pz + a.D <= b.pz + 0.05 || b.pz + b.D <= a.pz + 0.05));
  ok("наездов нет", noOv);
  const area = st.containers.reduce((s2, c) => s2 + c.W * c.D, 0);
  ok(`рамка закрыта целиком (${area} = 160000)`, near(area, 160000, 1));
  ok("всё в рамке", st.containers.every((c) => c.px + c.W <= 400.05 && c.pz + c.D <= 400.05));
  ok("исходный контейнер не изменился", near(st.containers[0].W, 170) && st.containers[0].cols === 2);
  // повторное нажатие ничего не добавляет
  await page.locator("button", { hasText: "Заполнить раскладку" }).click();
  await page.waitForTimeout(400);
  ok("повторное заполнение не дублирует", (await state()).containers.length === 9);

  await page.screenshot({ path: "/tmp/fill.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nUI REWORK TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
