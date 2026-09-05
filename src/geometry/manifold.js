// Библиотека Manifold (булево объединение в цельное тело) грузится лениво
// с CDN только при нажатии «Скачать цельный STL» — как и раньше. При
// недоступности CDN экспорт сам откатывается на обычный STL (см. App).
// Комментарий @vite-ignore говорит сборщику не трогать этот динамический
// импорт: URL остаётся строкой и уходит в браузер как есть.
let manifoldPromise = null;
export function getManifold() {
  if (!manifoldPromise) {
    manifoldPromise = import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/manifold-3d@2.5.1/manifold.js")
      .then((m) => m.default())
      .then((wasm) => { wasm.setup(); return wasm; });
  }
  return manifoldPromise;
}
