// «Кирпичная» раскладка: замок держит только свою ячейку, ряды имеют
// независимые перегородки, соседний ряд не блокируется.
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
  await new Promise((r) => server.listen(8939, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8939/", { waitUntil: "load" });
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
  const rows = () => page.evaluate(() => {
    const st = JSON.parse(window.localStorage.getItem("trayGenState"));
    return layout(st.containers[0]).rowCols;
  });
  const setNum = async (label, v) => {
    const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
    await el.fill(String(v));
    await el.press("Enter");
    await page.waitForTimeout(300);
  };

  // сетка 2×2
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(200);
  await page.locator('div:has(> label:text-is("Ряды")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);

  // ячейка (1,1): задать ширину 60 и зафиксировать
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  ok("редактор ячейки 1×1", await page.getByText("Ячейка 1×1").count());
  await setNum("Ширина ячейки", 60);
  let r = await rows();
  ok(`ячейка (1,1) стала 60 (${r[0].map((x) => x.toFixed(1)).join("/")})`, near(r[0][0], 60));
  ok("сосед по ряду не тронут", near(r[0][1], 81.3));
  ok(`ряд 2 равномерный и НЕ заблокирован (${r[1].map((x) => x.toFixed(1)).join("/")})`, near(r[1][0], r[1][1]));
  await page.locator("button", { hasText: /🔓 ширина \(эта ячейка\)/ }).click();
  await page.waitForTimeout(300);

  // вернуть контейнеру 170: в ряду 1 замкнутая держит 60, сосед впитал;
  // ряд 2 остался равномерным — его ячейки менялись свободно
  await goCont();
  await setNum("Ширина", 170);
  r = await rows();
  ok(`замок держит только свою ячейку (${r[0][0].toFixed(1)})`, near(r[0][0], 60));
  ok(`сосед по ряду впитал рост (${r[0][1].toFixed(1)})`, near(r[0][1], 170 - 2 * 2.9 - 1.6 - 60, 0.15));
  ok("ряд 2 равномерный — перегородки рядов не совпадают", near(r[1][0], r[1][1]) && near(r[1][0], 81.3));

  // во втором ряду — своя ширина: перегородки встанут не друг напротив друга
  await page.locator("svg g").nth(2).click(); // ячейка (1,2) — первый в ряду 2
  await page.waitForTimeout(200);
  ok("выбрана ячейка 1×2", await page.getByText("Ячейка 1×2").count());
  await setNum("Ширина ячейки", 100);
  r = await rows();
  ok(`ряд 2: [${r[1].map((x) => x.toFixed(1)).join("/")}], ряд 1 не тронут`, near(r[1][0], 100) && near(r[0][0], 60));
  ok("перегородки рядов на разных позициях", Math.abs(r[0][0] - r[1][0]) > 5);

  // STL собирается и не пуст при несовпадающих перегородках
  await page.locator("button", { hasText: /^Принтер$/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.locator("button", { hasText: /Скачать STL — контейнер №1/ }).click(),
  ]);
  const buf = readFileSync(await download.path());
  const nTri = buf.readUInt32LE(80);
  ok(`STL валиден при кирпичной раскладке (${nTri} треугольников)`, buf.length === 84 + nTri * 50 && nTri > 100);

  await page.screenshot({ path: "/tmp/brick.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nBRICK TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
