// Проверка фрагмента для превью-артефакта: он публикуется внутрь чужого
// <html>/<body>, поэтому проверяем именно так — оборачиваем в скелет и
// смотрим, что страница живёт (канвас, вкладки, нет экрана ошибки).
//   node build.mjs --artifact /tmp/frag.html && node tests/artifact-check.cjs /tmp/frag.html
const { createServer } = require("node:http");
const { readFileSync } = require("node:fs");
const { chromium } = require("playwright");
const FRAG = process.argv[2];
if (!FRAG) {
  console.error("Укажите файл фрагмента: node tests/artifact-check.cjs <файл.html>");
  process.exit(2);
}
const frag = readFileSync(FRAG, "utf8");
const page_html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${frag}</body></html>`;
(async () => {
  const server = createServer((q, s) => { s.setHeader("Content-Type", "text/html; charset=utf-8"); s.end(page_html); });
  await new Promise((r) => server.listen(8975, r));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 850 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await p.goto("http://127.0.0.1:8975/", { waitUntil: "load" });
  await p.waitForTimeout(2500);
  const canvas = await p.locator("canvas").count();
  const tabs = await p.locator('button:text-is("Принтер"), button:text-is("Раскладка"), button:text-is("Контейнеры")').count();
  const guard = await p.locator("text=Начать заново").count();
  console.log("canvas:", canvas, "| вкладок:", tabs, "| экран ошибки:", guard);
  console.log("ошибки:", errs.length ? errs.slice(0, 3).join("\n  ") : "нет");
  
  await b.close(); server.close();
  process.exit(canvas === 1 && tabs === 3 && !guard && errs.length === 0 ? 0 : 1);
})();
