// Магнит соседей: при ужимании соседи растут до лимита принтера,
// несъеденный остаток (≥30 мм) закрывает новый контейнер; переключатель
// на вкладке Раскладка всё это выключает.
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
  await new Promise((r) => server.listen(8937, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8937/", { waitUntil: "load" });
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
  const sumW = (st) => {
    const cols = {};
    for (const c of st.containers) cols[c.gx] = Math.max(cols[c.gx] || 0, c.W);
    return Object.values(cols).reduce((s, v) => s + v, 0);
  };

  // раскладка 34 см: восточный сосед добавится одним контейнером 170
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  ok("переключатель «Магнит соседей» на месте", await page.locator("label", { hasText: "Магнит соседей" }).count());
  await setNum("Раскладка по X", 34);
  await page.locator('button:text-is("+")').first().click();
  await page.waitForTimeout(400);
  let st = await state();
  ok(`два контейнера по 170 (сумма ${sumW(st)})`, st.containers.length === 2 && near(sumW(st), 340));

  // ужать выбранный (восточный) до 120: сосед у лимита принтера →
  // остаток 50 закрывает новый контейнер
  await goCont();
  await setNum("Ширина", 120);
  st = await state();
  const widths = st.containers.map((c) => c.W).sort((a, b) => a - b);
  ok(`появился новый контейнер (${st.containers.length} шт: ${widths.join(", ")})`, st.containers.length === 3);
  ok("остаток закрыт контейнером 50 мм", widths.some((w) => near(w, 50)));
  ok(`общий габарит сохранился (${sumW(st)} = 340)`, near(sumW(st), 340));

  // ещё ужать до 100: остаток 20 впитывает контейнер-«хвост» (50 → 70)
  await setNum("Ширина", 100);
  st = await state();
  ok(`хвост впитал 20 мм (${st.containers.map((c) => c.W).sort((a, b) => a - b).join(", ")})`,
    st.containers.length === 3 && st.containers.some((c) => near(c.W, 70)));
  ok(`сумма всё ещё 340 (${sumW(st)})`, near(sumW(st), 340));

  // выключить магнит: ужатие больше никого не трогает
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.locator("label", { hasText: "Магнит соседей" }).locator("input").click();
  await page.waitForTimeout(200);
  await goCont();
  await setNum("Ширина", 80);
  st = await state();
  ok(`магнит выключен: контейнеров по-прежнему ${st.containers.length}, сумма ужалась (${sumW(st)})`,
    st.containers.length === 3 && near(sumW(st), 320));

  await page.screenshot({ path: "/tmp/magnet.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");

  await browser.close();
  server.close();
  console.log(fail === 0 ? "\nMAGNET TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
