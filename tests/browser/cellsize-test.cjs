// Тест полей размера ячейки: вписал размер → контейнер растёт/ужимается,
// соседняя ячейка не трогается; у лимита принтера добор идёт у свободных;
// «Зафиксировать эту ячейку» держит оба края.
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
  await new Promise((r) => server.listen(8934, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8934/", { waitUntil: "load" });
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
  const model = () => page.evaluate(() => {
    const c = JSON.parse(window.localStorage.getItem("trayGenState")).containers[0];
    return { W: c.W, colWs: layout(c).colWs };
  });
  const setNum = async (label, v) => {
    const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
    await el.fill(String(v));
    await el.press("Enter");
    await page.waitForTimeout(300);
  };

  // 2 колонки, выбрать ячейку 1
  await page.locator('div:has(> label:text-is("Колонки")) button', { hasText: "+" }).click();
  await page.waitForTimeout(300);
  await page.locator("svg g").first().click();
  await page.waitForTimeout(200);
  ok("поля размера ячейки на месте", await page.getByText("Размер этой ячейки").count());
  const m0 = await model();
  ok(`старт: W=170, колонки по ${m0.colWs[0].toFixed(1)}`, near(m0.W, 170) && near(m0.colWs[0], m0.colWs[1]));

  // ужать ячейку до 60 → контейнер ужался на разницу, соседняя не тронута
  await setNum("Ширина ячейки", 60);
  const m1 = await model();
  ok(`ячейка 60: контейнер ужался (W=${m1.W})`, near(m1.colWs[0], 60) && near(m1.W, 170 - (m0.colWs[0] - 60), 0.15));
  ok(`соседняя ячейка не изменилась (${m1.colWs[1].toFixed(1)})`, near(m1.colWs[1], m0.colWs[1]));

  // вырастить ячейку до 100 → контейнер упёрся в лимит 170, добор у свободной
  await setNum("Ширина ячейки", 100);
  const m2 = await model();
  ok(`ячейка 100: контейнер у лимита (W=${m2.W})`, near(m2.colWs[0], 100) && near(m2.W, 170));
  ok(`свободная колонка отдала недостающее (${m2.colWs[1].toFixed(1)})`, near(m2.colWs[1], 170 - 2 * 2.75 - 1.6 - 100));

  // зафиксировать размеры через замки сетки — поля блокируются, замок на схеме
  await page.locator("button", { hasText: /🔓 ширина \(эта ячейка\)/ }).click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /🔓 глубина \(весь ряд\)/ }).click();
  await page.waitForTimeout(300);
  const wCellDisabled = await page.locator(String.raw`div:has(> div > label:has-text("Ширина ячейки")) input[type="number"]`).first().isDisabled();
  ok("после фиксации поля размера заблокированы", wCellDisabled);
  ok("замок на схеме", await page.locator("svg text", { hasText: "🔒" }).count());

  // ужать контейнер: зафиксированная держит 100, свободная ужимается
  await goCont();
  await setNum("Ширина", 150);
  const m3 = await model();
  ok(`W=150: зафиксированная держит 100 (${m3.colWs[0].toFixed(1)})`, near(m3.colWs[0], 100));
  await goSub("Ячейка");
  ok(`свободная ужалась (${m3.colWs[1].toFixed(1)})`, near(m3.colWs[1], 150 - 2 * 2.75 - 1.6 - 100));

  // снять замки — вписанные размеры сохраняются
  await page.locator("button", { hasText: /🔒 ширина \(эта ячейка\)/ }).click();
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /🔒 глубина \(весь ряд\)/ }).click();
  await page.waitForTimeout(300);
  const m4 = await model();
  ok("после снятия фиксации размеры сохранились", near(m4.colWs[0], 100) && near(m4.W, 150));

  await page.screenshot({ path: "/tmp/cellsize.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nCELL SIZE TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
