// Случай из скриншота пользователя: ужатие контейнера в СЕРЕДИНЕ сетки
// 3×3. Вся его колонка должна ужаться вместе, соседние колонки —
// прилипнуть и вырасти; щелей и «висящих» контейнеров быть не должно.
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
  const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;
  const state = () => page.evaluate(() => JSON.parse(window.localStorage.getItem("trayGenState")));
  const setNum = async (label, v) => {
    const el = page.locator(String.raw`div:has(> div > label:has-text("${label}")) input[type="number"]`).first();
    await el.fill(String(v));
    await el.press("Enter");
    await page.waitForTimeout(300);
  };
  const colInfo = (st) => {
    const cols = {};
    for (const c of st.containers) (cols[c.gx] = cols[c.gx] || []).push(c.W);
    return cols;
  };

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
  await page.locator("button", { hasText: /^Модель$/ }).click();
  await setNum("Ширина", 100);

  st = await state();
  const cols = colInfo(st);
  const colW = (g) => Math.max(...cols[g]);
  // вся средняя колонка ужалась одинаково — щелей нет
  ok(`вся колонка 1 стала 100 (${cols[1].join(", ")})`, cols[1].every((w) => near(w, 100)));
  // соседняя узкая колонка (60) впитала освободившиеся 70 мм
  ok(`колонка 2 выросла до 130 (${colW(2)})`, near(colW(2), 130));
  ok(`колонка 0 на лимите принтера (${colW(0)})`, near(colW(0), 170));
  const total = colW(0) + colW(1) + colW(2);
  ok(`общая ширина сохранилась (${total} = 400)`, near(total, 400));
  ok("новых контейнеров не понадобилось", st.containers.length === 9);

  // теперь глубина: ужать центр по глубине — весь средний ряд ужимается
  await setNum("Глубина", 100);
  st = await state();
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
