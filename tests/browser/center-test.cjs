// Ужатие контейнера в СЕРЕДИНЕ заполненной сборки: меняется только он,
// приклеенные к его грани соседи едут следом, наезды запрещены всегда.
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
  const noOverlap = (cs) => cs.every((a, i) => cs.every((b, j) => i >= j ||
    a.px + a.W <= b.px + 0.05 || b.px + b.W <= a.px + 0.05 ||
    a.pz + a.D <= b.pz + 0.05 || b.pz + b.D <= a.pz + 0.05));

  // заполнить рамку 40×40 контейнерами (свободная укладка)
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.locator("button", { hasText: "Заполнить раскладку" }).click();
  await page.waitForTimeout(800);
  let st = await state();
  ok(`рамка заполнена (${st.containers.length} контейнеров)`, st.containers.length >= 6);
  ok("наездов нет", noOverlap(st.containers));
  ok("всё в рамке", st.containers.every((c) => c.px + c.W <= 400.05 && c.pz + c.D <= 400.05));

  // выбрать контейнер В СЕРЕДИНЕ (не касается левого края) и ужать его:
  // приклеенные справа соседи едут следом, никто не наезжает
  const centerIdx = st.containers.findIndex((c) => c.px > 10 && c.px + c.W < 390);
  ok("контейнер в середине найден", centerIdx >= 0);
  const before = st.containers.map((c) => ({ px: c.px, pz: c.pz, W: c.W, D: c.D }));
  await page.locator("button", { hasText: `№${centerIdx + 1}` }).click();
  await goCont();
  const w0 = before[centerIdx].W;
  await setNum("Ширина", w0 - 40);

  st = await state();
  ok(`ужался только выбранный (${st.containers[centerIdx].W})`, near(st.containers[centerIdx].W, w0 - 40));
  ok("чужие размеры не тронуты",
    st.containers.every((c, k) => k === centerIdx || near(c.W, before[k].W)));
  const glued = before.filter((b, k) => k !== centerIdx &&
    near(b.px, before[centerIdx].px + w0) &&
    b.pz < before[centerIdx].pz + before[centerIdx].D - 0.5 && b.pz + b.D > before[centerIdx].pz + 0.5).length;
  const moved = st.containers.filter((c, k) => k !== centerIdx && !near(c.px, before[k].px)).length;
  ok(`приклеенные соседи поехали (${moved} из ${glued})`, glued === 0 || moved >= glued);
  ok("наездов после ужатия нет", noOverlap(st.containers));

  // глубина: то же по оси Z
  const d0 = st.containers[centerIdx].D;
  await setNum("Глубина", d0 - 30);
  st = await state();
  ok(`глубина ужалась (${st.containers[centerIdx].D})`, near(st.containers[centerIdx].D, d0 - 30));
  ok("наездов нет и после глубины", noOverlap(st.containers));

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
