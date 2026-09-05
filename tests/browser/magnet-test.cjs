// Магнит соседей в свободной раскладке: прилипшие соседи едут за гранью
// контейнера при изменении его размера; выключенный магнит оставляет
// щель, но наезды запрещены всегда.
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
  // ── магнит соседей в свободной раскладке ──
  // Прилипшие соседи едут за гранью контейнера при изменении его размера.
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  ok("переключатель «Магнит соседей» на месте", await page.locator("label", { hasText: "Магнит соседей" }).count());
  await setNum("Раскладка по X", 34);
  await setNum("Раскладка по Y", 17); // рамка 340×170: свободно только справа
  await page.locator('button:text-is("+ контейнер")').click();
  await page.waitForTimeout(400);
  let st = await state();
  ok(`два контейнера вплотную (${st.containers.map((c) => c.px).join("/")})`,
    st.containers.length === 2 && near(st.containers[1].px, 170));

  // ужать первый до 120: приклеенный сосед приезжает следом (px 170 → 120)
  await page.locator('button:text-is("№1")').click();
  await goCont();
  await setNum("Ширина", 120);
  st = await state();
  ok(`сосед приехал за гранью (px=${st.containers[1].px})`, near(st.containers[1].px, 120));
  ok("размер соседа не тронут", near(st.containers[1].W, 170));

  // вернуть 170: сосед отъезжает обратно, наездов нет
  await setNum("Ширина", 170);
  st = await state();
  ok(`сосед отъехал назад (px=${st.containers[1].px})`, near(st.containers[1].px, 170));

  // выключить магнит: ужатие оставляет щель, сосед стоит где стоял
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.locator("label", { hasText: "Магнит соседей" }).locator("input").click();
  await page.waitForTimeout(200);
  await page.locator('button:text-is("№1")').click();
  await goCont();
  await setNum("Ширина", 140);
  st = await state();
  ok(`магнит выключен: сосед не сдвинулся (px=${st.containers[1].px})`, near(st.containers[1].px, 170));
  ok("щель осталась (это нормально)", near(st.containers[0].W, 140));

  // рост при выключенном магните всё равно раздвигает — наезды запрещены
  await setNum("Ширина", 170);
  st = await state();
  const a = st.containers[0], b = st.containers[1];
  ok("наезда нет даже без магнита", a.px + a.W <= b.px + 0.05 || b.px + b.W <= a.px + 0.05 ||
    a.pz + a.D <= b.pz + 0.05 || b.pz + b.D <= a.pz + 0.05);

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
