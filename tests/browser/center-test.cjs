// Ужатие контейнера в СЕРЕДИНЕ сборки 3×3. Ширина — личный размер:
// ужимается только он, а соседи ПО РЯДУ забирают освободившееся место,
// так что ряд остаётся у края. Глубина общая у ряда — ужимается весь ряд,
// соседние ряды прилипают. Щелей и «висящих» контейнеров быть не должно.
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
  await new Promise((r) => server.listen(8938, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8938/", { waitUntil: "load" });
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
  const rowInfo = (st) => {
    const rows = {};
    for (const c of st.containers) (rows[c.gy] = rows[c.gy] || []).push(c);
    for (const k of Object.keys(rows)) rows[k].sort((a, b) => a.gx - b.gx);
    return rows;
  };
  const rowW = (rows, g) => rows[g].reduce((s, c) => s + c.W, 0);

  // сетка 3×3 через «Заполнить раскладку» (лимит 40×40 по умолчанию)
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.locator("button", { hasText: "Заполнить раскладку" }).click();
  await page.waitForTimeout(600);
  let st = await state();
  ok(`сетка 3×3 (${st.containers.length} контейнеров)`, st.containers.length === 9);

  // выбрать ЦЕНТРАЛЬНЫЙ контейнер (gx=1, gy=1) и ужать его ширину
  const centerIdx = st.containers.findIndex((c) => c.gx === 1 && c.gy === 1);
  ok("центральный контейнер найден", centerIdx >= 0);
  await page.locator("button", { hasText: `№${centerIdx + 1}` }).click();
  await goCont();
  await setNum("Ширина", 100);

  st = await state();
  let rows = rowInfo(st);
  const mid = rows[1];
  ok(`ужался только выбранный (${mid.map((c) => c.W).join(", ")})`, near(mid[1].W, 100));
  ok("соседние ряды не тронуты",
    near(rowW(rows, 0), 400) && near(rowW(rows, 2), 400));
  ok(`ряд остался у края (${rowW(rows, 1)} = 400)`, near(rowW(rows, 1), 400));
  ok("соседи по ряду впитали освободившееся", mid.some((c) => c.W > 60.05));
  ok("новых контейнеров не понадобилось", st.containers.length === 9);

  // теперь глубина: ужать центр по глубине — весь средний ряд ужимается
  await setNum("Глубина", 100);
  st = await state();
  rows = rowInfo(st);
  const midRow = st.containers.filter((c) => c.gy === 1).map((c) => c.D);
  ok(`весь ряд 1 стал 100 по глубине (${midRow.join(", ")})`, midRow.every((d) => near(d, 100)));
  const rowD = (g) => Math.max(...st.containers.filter((c) => c.gy === g).map((c) => c.D));
  ok(`суммарная глубина сохранилась (${rowD(0) + rowD(1) + rowD(2)} = 400)`, near(rowD(0) + rowD(1) + rowD(2), 400));

  await page.screenshot({ path: "/tmp/center.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nCENTER TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
