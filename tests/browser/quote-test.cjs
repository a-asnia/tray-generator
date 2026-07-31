// Цитата и воздух под кнопками — один блок в самом низу, на всех вкладках
const { createServer } = require("node:http");
const { readFileSync } = require("node:fs");
const { chromium } = require("playwright");
const HTML = require("node:path").join(__dirname, "..", "..", "tray-generator.html");
(async () => {
  const html = readFileSync(HTML);
  const server = createServer((req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); });
  await new Promise((r) => server.listen(8945, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  await page.goto("http://127.0.0.1:8945/", { waitUntil: "load" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(700);

  const checks = [];
  const ok = (n, c) => { checks.push([n, !!c]); };
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
  const quoteLoc = page.locator('p[style*="italic"]');

  for (const tab of ["Контейнеры", "Принтер", "Раскладка"]) {
    await page.locator("button", { hasText: new RegExp(`^${tab}$`) }).click();
    await page.waitForTimeout(250);
    const n = await quoteLoc.count();
    const txt = n ? (await quoteLoc.first().innerText()).trim() : "";
    ok(`${tab}: ровно одна цитата — ${txt.slice(0, 46)}…`, n === 1 && txt.startsWith("«"));
  }

  // цитата стабильна при переключении вкладок
  await goCont();
  const q1 = await quoteLoc.first().innerText();
  await page.locator("button", { hasText: /^Раскладка$/ }).click();
  await page.waitForTimeout(200);
  const q2 = await quoteLoc.first().innerText();
  ok("цитата не меняется при переключении вкладок", q1 === q2);

  // цитата — самый нижний элемент панели: после прокрутки видна,
  // и ниже неё в панели нет других элементов
  await quoteLoc.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  ok("после прокрутки цитата видна", await quoteLoc.first().isVisible());
  const below = await page.evaluate(() => {
    const q = document.querySelector('p[style*="italic"]');
    const panel = document.querySelector('div[style*="overflow-y: auto"]');
    if (!q || !panel) return -1;
    const qb = q.getBoundingClientRect().bottom;
    let n = 0;
    for (const el of panel.querySelectorAll("button, input, svg")) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top >= qb - 1) n++;
    }
    return n;
  });
  ok(`ниже цитаты нет кнопок и полей (${below})`, below === 0);
  // между последним элементом и цитатой есть воздух ≥ 40 px
  const gap = await page.evaluate(() => {
    const q = document.querySelector('p[style*="italic"]');
    const panel = document.querySelector('div[style*="overflow-y: auto"]');
    const qt = q.getBoundingClientRect().top;
    let last = 0;
    for (const el of panel.querySelectorAll("button, input, p, svg")) {
      if (el === q) continue;
      const b = el.getBoundingClientRect().bottom;
      if (b < qt && b > last) last = b;
    }
    return Math.round(qt - last);
  });
  ok(`воздух под кнопками ${gap} px`, gap >= 40);
  // и воздух ПОД цитатой до конца панели
  const tail = await page.evaluate(() => {
    const q = document.querySelector('p[style*="italic"]');
    const panel = document.querySelector('div[style*="overflow-y: auto"]');
    const qb = q.getBoundingClientRect().bottom;
    const pb = panel.getBoundingClientRect().top + panel.scrollHeight - panel.scrollTop;
    return Math.round(pb - qb);
  });
  ok(`воздух под цитатой ${tail} px`, tail >= 40);
  await page.screenshot({ path: "/tmp/quote.png" });

  let fail = 0;
  for (const [n, c] of checks) { console.log(`${c ? "OK " : "FAIL"} ${n}`); if (!c) fail++; }
  if (errors.length) { console.log("ОШИБКИ:"); errors.forEach((e) => console.log("  " + e)); fail++; }
  else console.log("OK  ошибок в консоли нет");
  await browser.close(); server.close();
  console.log(fail === 0 ? "\nQUOTE TEST PASSED" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
