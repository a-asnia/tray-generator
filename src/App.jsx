// ══════════════════════════════════════════════════════════════
// Приложение: панель с вкладками (Модель / Принтер / Раскладка),
// редакторы стенок и ячеек, экспорт STL, автосохранение
// ══════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useMemo } from "react";
import { exportSTL, exportSTLIndexed, weldTris, solidsVolume } from "./geometry/stl.js";
import { getManifold } from "./geometry/manifold.js";
import { connectorVs, connGeom, DEFAULT_CLR } from "./model/connectors.js";
import { insertsOf, insertSlots, insertSlotsAll, insertSize, insertPlateSolids, MIN_WEB } from "./model/inserts.js";
import { layout, defWall, getWall, getCellLvl, lineOf, cellKeys, endLabels, wallTitle, minOuterDim, fitSizes, lockedWIn, layoutIssues, remapCells, maxColsOf, maxRowsOf, DEFAULT_CORNER_R } from "./model/layout.js";
import { buildContainer } from "./model/build.js";
import { assemble } from "./model/assembly.js";
import { presetContainer, PRESETS, GORKA_DEF, applyStairsWalls, fillStairsLevels } from "./model/presets.js";
import { snapLayout, fillAll } from "./model/laymagnet.js";
import { moveContainer, fitAssembly, resizeBox, autoSpot, boxOf, snapMove, collides, MIN_BOX } from "./model/laymove.js";
import { cardHolderSolids, CARDH } from "./model/cardholder.js";
import { makeContainer, SAVED, setNextId, exportProject, importProject } from "./state/storage.js";
import { useTrayScene } from "./scene/useTrayScene.js";
import { MONO, ACCENT, SEL } from "./ui/theme.js";
import { Param, Stepper, Collapse, SectionTitle } from "./ui/controls.jsx";
import { Schematic } from "./ui/Schematic.jsx";

// дурацкие цитаты «в тему» — по одной на сеанс, внизу панели
const QUOTES = [
  "«Хаос — это просто лоток, которого ещё нет».",
  "«Идеальный органайзер тот, в котором осталась одна свободная ячейка».",
  "«Сначала мы подбираем ячейки под вещи, потом вещи под ячейки».",
  "«Пустая ячейка — явление временное».",
  "«Печатать органайзер для деталей принтера — вот он, замкнутый цикл».",
  "«Порядок начинается с полутора миллиметров стенки».",
  "«Дай человеку коробку — он приберётся сегодня. Дай генератор лотков — он не остановится никогда».",
  "«У каждой мелочи должно быть место, где её потом не найдут».",
  "«Не бывает лишних перегородок, бывает мало мелочей».",
  "«Измерь дважды — напечатай трижды».",
];

export default function TrayGenerator() {
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const [containers, setContainers] = useState(() => (SAVED ? SAVED.containers : [{ ...makeContainer(null, 0, 0), id: 1 }]));
  const [sel, setSel] = useState(0);
  const [selection, setSelection] = useState(null);
  const [selMode, setSelMode] = useState("seg"); // 'seg' | 'line'
  const [connect, setConnect] = useState(SAVED ? SAVED.connect !== false : true);
  // магнит соседей: изменение размера контейнера компенсируется соседями
  const [magnet, setMagnet] = useState(SAVED ? SAVED.magnet !== false : true);
  // магнит раскладки: сборка липнет к краю лимита раскладки
  const [layMagnet, setLayMagnet] = useState(SAVED?.layMagnet === true);
  // по умолчанию — чуть меньше стола Bambu A1 mini (180×180×180), запас под юбку
  const [limits, setLimits] = useState(SAVED?.limits ?? { maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40 });
  // размеры соединителя — константы «ласточкиного хвоста» (зазор 0,35)
  const CG = connGeom();
  const [tab, setTab] = useState("cont");
  // подвкладки внутри «Контейнеры»
  const [sub, setSub] = useState("cont");
  // секции всегда открыты при запуске: свернул — только на этот сеанс
  const [openSecs, setOpenSecs] = useState(() => ({ presets: true, outer: true, cells: true, grid: true, walls: true, cellPick: true, inserts: true, project: true, export: true }));
  const toggleSec = (k) => setOpenSecs((o) => ({ ...o, [k]: !o[k] }));

  // автосохранение при каждом изменении
  useEffect(() => {
    try {
      window.localStorage.setItem("trayGenState", JSON.stringify({ containers, limits, connect, magnet, layMagnet, openSecs }));
    } catch (e) {}
  }, [containers, limits, connect, magnet, layMagnet, openSecs]);

  // «магнит раскладки»: дотяжка сборки до края лимита. snapLayout
  // идемпотентен (на результате возвращает null), поэтому эффект
  // сходится за один повтор и не зацикливается
  useEffect(() => {
    // шаг по истории магнит не переигрывает: иначе «назад» не давало бы
    // видимого результата — дотяжка тут же возвращала бы прежний размер
    if (!layMagnet || settling()) return;
    const next = snapLayout(containers, limits);
    if (next) {
      setContainers(next);
      setSelection(null);
    }
  }, [containers, limits, layMagnet]);

  // лимит раскладки — жёсткая рамка: за него сборка не выходит никогда
  // (добавили контейнер в заполненную раскладку или ужали сам лимит —
  // колонки и ряды подрезаются). fitAssembly тоже идемпотентен
  useEffect(() => {
    const next = fitAssembly(containers, limits);
    if (next) setContainers(next);
  }, [containers, limits]);

  // ── шаг назад ──
  // История правок контейнеров и лимитов. Быстрые правки одного и того же
  // (тяжка ползунка, доводка эффектами) склеиваются в один шаг: иначе
  // «Назад» отменяло бы движение слайдера по миллиметру.
  const hist = useRef([]);      // шаги назад
  const ahead = useRef([]);     // шаги вперёд (после «назад»)
  const histPrev = useRef({ containers, limits });
  const histAt = useRef(0);
  // Окно «доводки» после шага по истории. Восстановленное состояние тут же
  // проходят нормализующие эффекты (лимит раскладки, магниты, живая горка) —
  // их правки не должны считаться новым действием: иначе они обрывали бы
  // ветку «вперёд», и кнопка работала бы через раз.
  const jumpAt = useRef(0);
  const settling = () => Date.now() - jumpAt.current < 400;
  const [histLen, setHistLen] = useState(0);
  const [aheadLen, setAheadLen] = useState(0);
  const syncLens = () => { setHistLen(hist.current.length); setAheadLen(ahead.current.length); };
  useEffect(() => {
    const prev = histPrev.current;
    if (prev.containers === containers && prev.limits === limits) return;
    histPrev.current = { containers, limits };
    if (settling()) { syncLens(); return; }
    // пересборка списка с теми же значениями (доводка эффектами, повторный
    // ввод того же числа) — не шаг: иначе «назад» отменял бы пустоту
    if (JSON.stringify(prev.containers) === JSON.stringify(containers) && prev.limits === limits) return;
    const now = Date.now();
    if (now - histAt.current > 400) {
      hist.current.push(prev);
      if (hist.current.length > 60) hist.current.shift();
    }
    histAt.current = now;
    ahead.current = []; // новая правка обрывает ветку «вперёд»
    syncLens();
  }, [containers, limits]);
  // общий переход по истории: снимок берётся из одного стека и кладётся в другой
  const jump = (from, to) => {
    const snap = from.current.pop();
    if (!snap) return;
    to.current.push({ containers, limits });
    jumpAt.current = Date.now();
    histAt.current = 0;
    setContainers(snap.containers);
    setLimits(snap.limits);
    setSel((s) => Math.min(s, snap.containers.length - 1));
    setSelection(null);
    syncLens();
  };
  const undo = () => jump(hist, ahead);
  const redo = () => jump(ahead, hist);
  const histRefs = useRef({ undo, redo });
  histRefs.current = { undo, redo };
  useEffect(() => {
    const key = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = (e.key || "").toLowerCase();
      if (k === "z" || k === "я") { e.preventDefault(); (e.shiftKey ? histRefs.current.redo : histRefs.current.undo)(); }
      else if (k === "y" || k === "н") { e.preventDefault(); histRefs.current.redo(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const cur = containers[sel];

  const updLimits = (patch) => {
    const nl = { ...limits, ...patch };
    // при росте зазора паз становится глубже и требует более толстой
    // стенки — иначе он прорезал бы её насквозь
    const minW = connect ? CG.minWall : 0;
    // габариты и высоты стенок не могут превышать лимиты принтера
    setContainers((cs) =>
      cs.map((c) => ({
        ...c,
        wallOut: Math.max(c.wallOut, minW),
        W: Math.min(c.W, nl.maxW),
        D: Math.min(c.D, nl.maxD),
        H: Math.min(c.H, nl.maxH),
        walls: Object.fromEntries(
          Object.entries(c.walls).map(([k, w]) => [k, w.h === undefined ? w : { ...w, h: Math.min(w.h, nl.maxH) }])
        ),
      }))
    );
    setLimits(nl);
  };

  const updCur = (patch) => {
    // смена деления на ячейки снимает замки и вписанные размеры:
    // они привязаны к конкретной сетке (при смене рядов индексы ячеек
    // сдвигаются, поэтому сбрасываются и ширины ячеек)
    if (patch.cols !== undefined || patch.cellWt !== undefined || patch.gridMode !== undefined)
      patch = { rowColWs: null, lockedCellW: {}, cellShares: {}, ...patch };
    if (patch.rows !== undefined || patch.cellDt !== undefined || patch.gridMode !== undefined)
      patch = { rowDs: null, lockedRows: {}, rowColWs: null, lockedCellW: {}, cellShares: {}, ...patch };
    setContainers((cs) => cs.map((c, idx) => (idx === sel ? { ...c, ...patch } : c)));
    if (
      patch.cols !== undefined || patch.rows !== undefined ||
      patch.gridMode !== undefined || patch.cellWt !== undefined || patch.cellDt !== undefined ||
      (cur.gridMode === "size" && (patch.W !== undefined || patch.D !== undefined || patch.wall !== undefined || patch.wallOut !== undefined))
    ) setSelection(null);
  };
  const updWall = (key, patch) => updWalls([key], patch);
  const updWalls = (keys, patch) => {
    if (patch.h !== undefined) patch = { ...patch, h: Math.min(patch.h, limits.maxH) };
    setContainers((cs) =>
      cs.map((c, idx) => {
        if (idx !== sel) return c;
        const walls = { ...c.walls };
        for (const key of keys) walls[key] = { ...(walls[key] ?? defWall(c)), ...patch };
        return { ...c, walls };
      })
    );
  };

  // изменение параметров с учётом замков: при замке ячейки контейнер
  // подстраивает внешний размер, сохраняя внутренние габариты ячейки
  const applyParam = (patch) => {
    const lockO = cur.lockOuter, lockC = cur.lockCell;
    if (lockC && lockO) return; // оба замка: структура заблокирована
    // при изменении сетки настройки ячеек (уровень, наклон) переезжают на
    // новую сетку по географии — поднятый пол переживает деление
    const withRemap = (extra = {}) => {
      if (!("cols" in patch) && !("rows" in patch)) return { ...patch, ...extra };
      return { ...patch, ...extra, cells: remapCells(cur, { ...cur, ...patch, ...extra }) };
    };
    if (lockC && cur.gridMode !== "size") {
      const m = { ...cur, ...patch };
      const W2 = 2 * m.wallOut + m.cols * cur.cellW0 + (m.cols - 1) * m.wall;
      const D2 = 2 * m.wallOut + m.rows * cur.cellD0 + (m.rows - 1) * m.wall;
      if (W2 > limits.maxW + 0.01 || D2 > limits.maxD + 0.01 || W2 < 30 || D2 < 30) return; // не влезает в принтер
      updCur(withRemap({ W: Math.round(W2 * 10) / 10, D: Math.round(D2 * 10) / 10 }));
      return;
    }
    updCur(withRemap());
  };

  // ── Внешний габарит контейнера ──
  // Раскладка свободная: у контейнера свои ширина и глубина, левый ближний
  // угол стоит на месте, двигается противоположная грань. При включённом
  // магните прилипшие к этой грани соседи едут за ней (при росте — всегда,
  // иначе коробки наехали бы друг на друга). Жёсткая рамка стола
  // соблюдается всегда.
  const applyOuterDim = (patch) => {
    if (cur.lockOuter) return;
    const idx = sel;
    setContainers((cs) => resizeBox(cs, idx, patch, limits, magnet));
  };

  // сброс к значениям по умолчанию: без диалогов и перезагрузки,
  // двойное нажатие как защита от случайного клика
  const [resetArm, setResetArm] = useState(false);
  const doReset = () => {
    if (!resetArm) {
      setResetArm(true);
      setTimeout(() => setResetArm(false), 3000);
      return;
    }
    setResetArm(false);
    try { window.localStorage.removeItem("trayGenState"); } catch (e) {}
    const fresh = { ...makeContainer(null, 0, 0), id: 1 };
    setNextId(2);
    setContainers([fresh]);
    setSel(0);
    setSelection(null);
    setConnect(true);
    setMagnet(true);
    setLayMagnet(false);
    setLimits({ maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40 });
    setOpenSecs({ presets: true, outer: true, cells: true, grid: true, walls: true, project: true, export: true });
    // вкладка не переключается — остаёмся там, где нажали сброс
  };

  // ── Пресеты контейнеров ──
  // настройки «Горки»: ступенек, шаг уровня (мм), глубина ступени (мм)
  const [gorka, setGorka] = useState({ ...GORKA_DEF });
  // перетаскивание контейнеров по карте раскладки
  const [drag, setDrag] = useState(null); // {idx, over:{gx,gy}, x, y}
  const dragRef = useRef(null);
  const dragBlockClick = useRef(false);
  const applyPreset = (kind, g = gorka) => {
    setContainers((cs) => cs.map((x, i) => (i === sel ? presetContainer(x, kind, limits, g) : x)));
    setSelection(null);
  };
  // параметры горки применяются вживую, если выбранный контейнер — горка;
  // другие пресеты (и обычные контейнеры) они не трогают
  const updGorka = (patch) => {
    const g = { ...gorka, ...patch };
    setGorka(g);
    if (cur?.preset !== "stairs") return;
    // «Бортик» меняет только высоту стенок, «Колонки» — только сетку:
    // ручные уровни полов при этом не трогаются (стенки и недостающие
    // уровни доводит живой пересчёт). Полное пере-применение — лишь у
    // параметров, которые сами задают уровни: ступенек и шага.
    if ("lip" in patch) updCur({ stairsLip: Math.max(2, Math.min(120, g.lip)) });
    else if ("cols" in patch) updCur({ cols: Math.max(1, Math.min(8, Math.round(g.cols))) });
    else if ("base" in patch) {
      // общий уровень пола: сдвигаем ВСЕ уровни на разницу — ручные
      // правки уровней сохраняются, спинка едет вместе с лесенкой
      const nb = Math.max(0, Math.min(200, g.base));
      const delta = Math.round((nb - (cur.stairsBase ?? 0)) * 10) / 10;
      if (Math.abs(delta) < 0.001) return;
      const L2 = layout(cur);
      const cells = { ...(cur.cells || {}) };
      for (let j = 0; j < L2.nRows; j++)
        for (let i = 0; i < L2.nColsAt(j); i++) {
          const k = i + ":" + j;
          const e = cells[k] || {};
          cells[k] = { ...e, lvl: Math.max(0, Math.round(((e.lvl ?? 0) + delta) * 10) / 10) };
        }
      updCur({
        stairsBase: nb,
        cells,
        H: Math.min(limits.maxH, Math.max(20, Math.round((cur.H + delta) * 10) / 10)),
      });
    }
    else applyPreset("stairs", g);
  };
  // горка — «живой» пресет: при любых правках (уровень пола ячейки, число
  // колонок или рядов обычными редакторами) недостающие уровни наследуют
  // ряд, а бортики пересчитываются от фактических уровней. Сходится за
  // один повтор: на согласованном контейнере ничего не меняется.
  useEffect(() => {
    if (cur?.preset !== "stairs") return;
    const cells = fillStairsLevels(cur);
    const walls = applyStairsWalls({ ...cur, cells });
    if (JSON.stringify(cells) !== JSON.stringify(cur.cells) || JSON.stringify(walls) !== JSON.stringify(cur.walls))
      updCur({ cells, walls });
  }, [containers, sel]);

  const toggleLockOuter = () => updCur({ lockOuter: !cur.lockOuter });

  // Замок ширины держит только ЭТУ ячейку: её ряд получает явные размеры
  // (rowColWs), перегородки других рядов независимы и не обязаны совпадать.
  // Снятие замка размеры НЕ выравнивает — вписанные вручную остаются.
  const toggleCellWLock = (i, j) => {
    const Lc = layout(cur);
    const key = i + ":" + j;
    const locked = { ...(cur.lockedCellW || {}) };
    if (locked[key]) delete locked[key]; else locked[key] = true;
    const rowColWs = { ...(cur.rowColWs || {}) };
    rowColWs[j] = Lc.rowCols[j].slice();
    updCur({ lockedCellW: locked, rowColWs });
  };
  // глубина у ряда общая (ряды — полосы на всю ширину), её держит замок ряда
  const toggleRowLock = (j) => {
    const Lc = layout(cur);
    const locked = { ...(cur.lockedRows || {}) };
    if (locked[j]) delete locked[j]; else locked[j] = true;
    updCur({ lockedRows: locked, rowDs: Lc.rowDs.slice() });
  };
  // «Зафиксировать эту ячейку» — превращает ячейку сетки в фиксированную:
  // отдельный контейнер внутри контейнера с жёстким размером и якорем к
  // ближайшему углу или стенке (без координат — бокс скользит со стенкой).
  // Ряд и колонка при этом НЕ блокируются: сетка обтекает бокс.
  const convertToFixed = (i, j) => {
    const Lc = layout(cur);
    const az = j === 0 ? "n" : j === Lc.nRows - 1 ? "s" : "";
    const ax = i === 0 ? "w" : i === Lc.nColsAt(j) - 1 ? "e" : "";
    const anchor = az && ax ? az + ax : ax || az || "w";
    const fc = {
      w: Math.round(Lc.cw(i, j) * 10) / 10,
      d: Math.round(Lc.cd(j) * 10) / 10,
      anchor,
      lvl: getCellLvl(cur, i, j),
    };
    let patch = { fixedCells: [...(cur.fixedCells || []), fc] };
    // ячейка уходит из сетки ряда, остальные растекаются на её место
    const rowW = Lc.rowCols[j];
    if (rowW.length > 1) {
      const rowColWs = { ...(cur.rowColWs || {}) };
      rowColWs[j] = rowW.filter((_, kk) => kk !== i);
      const lw = {};
      for (const key of Object.keys(cur.lockedCellW || {})) {
        const [ii, jj] = key.split(":").map(Number);
        if (jj !== j || ii < i) lw[key] = true;
        else if (ii > i) lw[ii - 1 + ":" + jj] = true;
      }
      patch = { ...patch, rowColWs, lockedCellW: lw };
    }
    updCur(patch);
    setSelection({ type: "fixed", k: (cur.fixedCells || []).length });
  };
  const updFixed = (k, patch) =>
    updCur({ fixedCells: (cur.fixedCells || []).map((f, idx) => (idx === k ? { ...f, ...patch } : f)) });
  // Снятие фиксации. dissolve=false: бокс становится обычной ячейкой
  // сетки на своём месте (ширина сохраняется, соседи по ряду ужимаются).
  // dissolve=true: бокс исчезает, место забирают соседние ячейки.
  const unfixCell = (k, dissolve) => {
    const Lc = layout(cur);
    const f = Lc.fixed.find((x) => x.k === k);
    // настройки стенок бокса (fw:k:*) удаляются, индексы последующих сдвигаются
    const walls = {};
    for (const [wk, wv] of Object.entries(cur.walls || {})) {
      const m = wk.match(/^fw:(\d+):(.+)$/);
      if (!m) { walls[wk] = wv; continue; }
      const idx = +m[1];
      if (idx === k) continue;
      walls[idx > k ? `fw:${idx - 1}:${m[2]}` : wk] = wv;
    }
    const patch = { fixedCells: (cur.fixedCells || []).filter((_, idx) => idx !== k), walls };
    if (!dissolve && f) {
      // ряд, накрывающий центр бокса, и позиция вставки по X
      const zc = (f.z0 + f.z1) / 2;
      let j = 0;
      for (let jj = 0; jj < Lc.nRows; jj++)
        if (zc >= Lc.cz0(jj) - cur.wall && zc <= Lc.cz0(jj) + Lc.cd(jj) + cur.wall) { j = jj; break; }
      const sizes = Lc.rowCols[j].slice();
      let idx = sizes.length;
      for (let i = 0; i < sizes.length; i++)
        if (f.x0 < Lc.cx0(i, j) + Lc.cw(i, j) / 2) { idx = i; break; }
      sizes.splice(idx, 0, f.x1 - f.x0);
      const wallSum = 2 * cur.wallOut + (sizes.length - 1) * cur.wall;
      // замки ширины в этом ряду сдвигаются вслед за вставкой
      const lockedJ = {};
      for (const key of Object.keys(cur.lockedCellW || {})) {
        const [ii, jj] = key.split(":").map(Number);
        if (jj !== j) continue;
        lockedJ[ii >= idx ? ii + 1 : ii] = true;
      }
      const lockedCellW = {};
      for (const key of Object.keys(cur.lockedCellW || {})) {
        const [ii, jj] = key.split(":").map(Number);
        lockedCellW[jj === j && ii >= idx ? `${ii + 1}:${jj}` : key] = true;
      }
      patch.rowColWs = { ...(cur.rowColWs || {}), [j]: fitSizes(sizes, { ...lockedJ, [idx]: true }, cur.W - wallSum) };
      patch.lockedCellW = lockedCellW;
    }
    updCur(patch);
    setSelection(null);
  };

  // Задать ширину конкретной ячейки: меняется только её ряд, контейнер
  // растёт/ужимается на разницу (другие ряды подстраиваются свободными
  // ячейками). У лимита принтера недостающее добирается у свободных
  // ячеек этого же ряда; зафиксированные не меняются никогда.
  const setCellWidth = (i, j, v) => {
    if ((cur.lockedCellW || {})[i + ":" + j]) return;
    const Lc = layout(cur);
    const sizes = Lc.rowCols[j].slice();
    const wallSum = 2 * cur.wallOut + (sizes.length - 1) * cur.wall;
    const lockedJ = { ...lockedWIn(cur, j), [i]: true };
    // при зафиксированном габарите ячейка меняется ЗА СЧЁТ свободных
    // соседей в своём ряду — контейнер не растёт и не ужимается
    if (cur.lockOuter) {
      const avail = cur.W - wallSum;
      sizes[i] = Math.max(10, Math.min(v, avail - (sizes.length - 1) * 10));
      updCur({ rowColWs: { ...(cur.rowColWs || {}), [j]: fitSizes(sizes, lockedJ, avail) } });
      return;
    }
    // потолок: остальным ячейкам ряда оставляем хотя бы по 10 мм
    sizes[i] = Math.max(10, Math.min(v, limits.maxW - wallSum - (sizes.length - 1) * 10));
    const want = sizes.reduce((s, x) => s + x, 0) + wallSum;
    const W2 = Math.round(Math.max(30, Math.min(want, limits.maxW)) * 10) / 10;
    const fitted = fitSizes(sizes, lockedJ, W2 - wallSum);
    const rowColWs = { ...(cur.rowColWs || {}) };
    rowColWs[j] = fitted;
    updCur({ rowColWs });
    applyOuterDim({ W: W2 });
  };
  const setRowDepth = (j, v) => {
    if ((cur.lockedRows || {})[j]) return;
    const Lc = layout(cur);
    const sizes = Lc.rowDs.slice();
    const wallSum = 2 * cur.wallOut + (sizes.length - 1) * cur.wall;
    const lockedJ = { ...(cur.lockedRows || {}), [j]: true };
    if (cur.lockOuter) {
      const avail = cur.D - wallSum;
      sizes[j] = Math.max(10, Math.min(v, avail - (sizes.length - 1) * 10));
      updCur({ rowDs: fitSizes(sizes, lockedJ, avail) });
      return;
    }
    sizes[j] = Math.max(10, Math.min(v, limits.maxD - wallSum - (sizes.length - 1) * 10));
    const want = sizes.reduce((s, x) => s + x, 0) + wallSum;
    const D2 = Math.round(Math.max(30, Math.min(want, limits.maxD)) * 10) / 10;
    const fitted = fitSizes(sizes, lockedJ, D2 - wallSum);
    updCur({ rowDs: fitted });
    applyOuterDim({ D: D2 });
  };

  // Отверстия под визитницу: у них есть требования к стенке (высота, при
  // которой навешенный карман не упирается в стол, — CARDH.wallH; длина
  // сегмента от CARDH.minW). Включили галку — стенка и её сегмент сразу
  // подгоняются под эти требования, а не молча остаются без окон.
  const setCardHooks = (key, on) => {
    updWall(key, { cardHooks: on });
    if (!on) return;
    const [, side, ns] = key.split(":");
    const n = +ns;
    const Lc = layout(cur);
    if (getWall(cur, key).h < CARDH.wallH) updWall(key, { h: Math.min(limits.maxH, CARDH.wallH) });
    if (side === "n" || side === "s") {
      const j = side === "n" ? 0 : Lc.nRows - 1;
      if (Lc.cw(n, j) < CARDH.minW) setCellWidth(n, j, CARDH.minW);
    } else if (Lc.cd(n) < CARDH.minW) setRowDepth(n, CARDH.minW);
  };

  const updCell = (i, j, patch) => {
    setContainers((cs) =>
      cs.map((cc, idx) => {
        if (idx !== sel) return cc;
        const k = i + ":" + j;
        return { ...cc, cells: { ...(cc.cells || {}), [k]: { ...((cc.cells || {})[k] || {}), ...patch } } };
      })
    );
  };

  // Выбор чего-либо сам открывает нужную подвкладку: кликнул по ячейке —
  // видишь настройки ячейки, кликнул по стенке — настройки стенки.
  const showFor = (s) => {
    if (!s) return;
    setTab("cont");
    setSub(s.type === "cell" || s.type === "fixed" ? "cell" : "walls");
  };
  const selectAndShow = (s) => { setSelection(s); showFor(s); };
  const handleSelect = (s) => {
    if (s?.type === "wall" && selMode === "line") {
      const ln = { type: "line", src: s.key, ...lineOf(cur, s.key) };
      setSelection(ln); showFor(ln);
    } else selectAndShow(s);
  };

  // Геометрия кэшируется по объекту контейнера: правка одного контейнера
  // не должна пересобирать остальные. Объекты неизменяемые (обновление
  // делает новый объект только для затронутого), поэтому ссылка — надёжный
  // ключ, а WeakMap не держит устаревшие записи.
  const geoCache = useRef(new WeakMap());
  // ── сборка: ряды со свободными ширинами + соединители по соседям ──
  const built = useMemo(() => {
    const a = assemble(containers, connect);
    const items = a.items.map((it) => {
      const ck = JSON.stringify(it.conn);
      let hit = geoCache.current.get(it.c);
      if (!hit || hit.key !== ck) {
        hit = { key: ck, solids: buildContainer(it.c, it.conn) };
        geoCache.current.set(it.c, hit);
      }
      return { c: it.c, solids: hit.solids, ox: it.ox, oz: it.oz };
    });
    return { items, totalW: a.totalW, totalD: a.totalD, rows: a.rows };
  }, [containers, connect]);

  // ── three.js: сцена, камера, пикинг ──
  const mountRef = useTrayScene({ built, selection, sel, cur, limits, containers, selMode, setSel, setSelection: selectAndShow });

  const L = layout(cur);
  const volume = useMemo(() => solidsVolume(built.items[sel]?.solids ?? []), [built, sel]);

  const INS = insertsOf(cur);
  const updIns = (patch) => updCur({ inserts: { ...INS, ...patch } });
  const exportInsert = () => {
    const sz = insertSize(cur, INS.dir);
    exportSTL(insertPlateSolids(cur, INS.dir), `divider_${sz.len}x${sz.hgt}x${sz.thk}.stl`);
  };

  const exportOne = (idx) => {
    const { solids, c } = built.items[idx];
    exportSTL(solids, `tray${idx + 1}_${c.W}x${c.D}x${c.H}_${c.cols}x${c.rows}.stl`);
  };
  const exportAll = () => built.items.forEach((_, idx) => setTimeout(() => exportOne(idx), idx * 500));

  const [solidBusy, setSolidBusy] = useState(false);
  const exportSolid = async (idx) => {
    setSolidBusy(true);
    try {
      const wasm = await getManifold();
      const { Manifold, Mesh } = wasm;
      const { solids, c } = built.items[idx];
      const parts = solids.map((sl) => {
        const { vp, tv } = weldTris(sl.tris);
        return new Manifold(new Mesh({ numProp: 3, vertProperties: vp, triVerts: tv }));
      });
      const uni = Manifold.union(parts);
      const mesh = uni.getMesh();
      exportSTLIndexed(mesh.vertProperties, mesh.triVerts, `tray${idx + 1}_${c.W}x${c.D}x${c.H}_solid.stl`);
      parts.forEach((p) => p.delete && p.delete());
      uni.delete && uni.delete();
    } catch (e) {
      console.error(e);
      alert("Не удалось собрать цельное тело (библиотека Manifold не загрузилась или геометрия не сошлась). Скачиваю обычный STL — слайсер объединит тела сам.");
      exportOne(idx);
    } finally {
      setSolidBusy(false);
    }
  };

  // Заполнить раскладку: к существующим контейнерам добавляются новые —
  // ряды максимально доступного размера (лимит принтера), пока
  // влезают в лимит раскладки; остаток, который меньше лимита принтера,
  // забирает последний контейнер, а слишком мелкий хвост делится пополам
  // с предыдущим. Существующие контейнеры не меняются.
  // «Заполнить раскладку»: ряды дотягиваются до правого края лимита, стопка
  // рядов — до дальнего. Это тот же магнит раскладки, но разово и независимо
  // от галки; повторяем, пока есть что достраивать (snapLayout идемпотентен).
  const fillLayout = () => {
    setContainers((cs) => {
      let out = cs;
      for (let pass = 0; pass < 6; pass++) {
        const next = snapLayout(out, limits);
        if (!next) break;
        out = next;
      }
      return out;
    });
    setSelection(null);
  };

  // ── проект в файл и обратно ──
  const fileRef = useRef(null);
  const [ioMsg, setIoMsg] = useState("");
  // прежний таймер гасится: иначе старое «Проект открыт» стирало бы
  // новое сообщение раньше времени
  const ioTimer = useRef(null);
  const flashIo = (msg, ms) => {
    setIoMsg(msg);
    clearTimeout(ioTimer.current);
    ioTimer.current = setTimeout(() => setIoMsg(""), ms);
  };
  const saveProject = () => {
    exportProject({ containers, limits, connect, magnet, openSecs });
    flashIo("Проект сохранён в файл", 3000);
  };
  const openProjectFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // чтобы повторный выбор того же файла сработал
    if (!file) return;
    importProject(file, (proj) => {
      if (!proj) { flashIo("Не удалось открыть: это не файл проекта", 4000); return; }
      setContainers(proj.containers);
      if (proj.limits) setLimits(proj.limits);
      setConnect(proj.connect !== false);
      setMagnet(proj.magnet !== false);
      if (proj.openSecs) setOpenSecs((o) => ({ ...o, ...proj.openSecs }));
      setSel(0);
      setSelection(null);
      flashIo(`Проект открыт: ${proj.containers.length} контейнер(ов)`, 4000);
    });
  };

  // ── план раскладки ──
  // Свободная 2D-карта: рамка стола в масштабе, контейнеры — как стоят на
  // самом деле. Никаких рядов и клеток — тащи куда хочешь, края прилипают
  // к соседям и к рамке.
  const layWmm = Math.max(60, limits.layW * 10);
  const layDmm = Math.max(60, limits.layD * 10);
  const bW = Math.max(layWmm, ...containers.map((c) => c.px + c.W));
  const bD = Math.max(layDmm, ...containers.map((c) => c.pz + c.D));
  const scale = Math.min(0.8, 262 / bW, 300 / bD);
  const planRef = useRef(null);

  // «+ контейнер»: встаёт в самый большой свободный прямоугольник рамки
  const addContainer = () => {
    const spot = autoSpot(containers, limits);
    if (!spot) return;
    const nc = { ...makeContainer(null, spot.px, spot.pz), W: spot.W, D: spot.D };
    setContainers((cs) => [...cs, nc]);
    setSel(containers.length);
    setSelection(null);
  };
  const canAdd = !!autoSpot(containers, limits);

  // ── перетаскивание по плану ──
  // Позиция считается в мм из позиции курсора на плане; прилипание и
  // проверку пересечений делает модель (snapMove/collides). Нажатие без
  // сдвига — обычный выбор контейнера.
  const planPos = (e, d) => {
    const r = planRef.current?.getBoundingClientRect();
    if (!r) return null;
    return {
      px: (e.clientX - r.left) / scale - d.offX,
      pz: (e.clientY - r.top) / scale - d.offZ,
    };
  };
  const dragStart = (e, idx) => {
    if (e.button) return;
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    const r = planRef.current?.getBoundingClientRect();
    const c = containers[idx];
    dragRef.current = {
      idx, x0: e.clientX, y0: e.clientY, moved: false,
      // за какую точку контейнера схватились (мм от его угла)
      offX: r ? (e.clientX - r.left) / scale - c.px : c.W / 2,
      offZ: r ? (e.clientY - r.top) / scale - c.pz : c.D / 2,
    };
  };
  const dragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    // порог в 5 px: дрожание руки не должно превращать клик в перенос
    if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 5) return;
    d.moved = true;
    const p = planPos(e, d);
    if (!p) return;
    const snapped = snapMove(containers, d.idx, p.px, p.pz, limits);
    setDrag({ idx: d.idx, ...snapped, bad: collides(containers, d.idx, snapped.px, snapped.pz) });
  };
  const dragEnd = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved) { setSel(d.idx); setSelection(null); return; }
    dragBlockClick.current = true;
    setTimeout(() => { dragBlockClick.current = false; }, 0);
    const p = planPos(e, d);
    if (!p) return;
    setContainers((cs) => moveContainer(cs, d.idx, p.px, p.pz, limits));
    setSel(d.idx);
    setSelection(null);
  };
  const dragCancel = () => { dragRef.current = null; setDrag(null); };
  useEffect(() => {
    if (!drag) return;
    const esc = (e) => { if (e.key === "Escape") dragCancel(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [drag]);

  const mapView = (
    <div
      ref={planRef}
      style={{
        position: "relative",
        width: Math.round(bW * scale) + 2,
        height: Math.round(bD * scale) + 2,
        background: "#F8FAFC", borderRadius: 6,
      }}
    >
      {/* рамка стола — жёсткий лимит раскладки */}
      <div style={{
        position: "absolute", left: 0, top: 0,
        width: Math.round(layWmm * scale), height: Math.round(layDmm * scale),
        border: "1.5px dashed #A9B4C2", borderRadius: 4, boxSizing: "border-box",
      }} />
      {containers.map((c, idx) => {
        const isDragged = drag?.idx === idx;
        const px = isDragged ? drag.px : c.px;
        const pz = isDragged ? drag.pz : c.pz;
        return (
          <button
            key={c.id}
            title={`Контейнер №${idx + 1}: ${c.W}×${c.D} мм. Перетащи, чтобы переставить`}
            onPointerDown={(e) => dragStart(e, idx)}
            onPointerMove={dragMove}
            onPointerUp={dragEnd}
            onPointerCancel={dragCancel}
            style={{
              position: "absolute",
              left: Math.round(px * scale), top: Math.round(pz * scale),
              width: Math.max(18, Math.round(c.W * scale)),
              height: Math.max(16, Math.round(c.D * scale)),
              borderRadius: 6, fontSize: 11.5, fontWeight: 700, padding: 0,
              cursor: drag ? "grabbing" : "grab", touchAction: "none", boxSizing: "border-box",
              border: isDragged && drag.bad ? "2px solid #DC2626"
                : idx === sel ? `2px solid ${ACCENT}` : "1px solid #C9D2DD",
              background: isDragged && drag.bad ? "#FEE2E2" : idx === sel ? "#FFF3EB" : "#fff",
              color: idx === sel ? ACCENT : "#3D4A5C",
              opacity: isDragged ? 0.75 : 1,
              zIndex: isDragged ? 5 : 1,
            }}
          >
            №{idx + 1}
          </button>
        );
      })}
    </div>
  );

  // ── редакторы: стенка/линия и ячейка/фиксированная ячейка ──
  let editorWall = null, editorCell = null;
  if (selection?.type === "wall") {
    const key = selection.key;
    const w = getWall(cur, key);
    const isOuter = key.startsWith("o");
    editorWall = (
      <div style={{ background: "#EFF6FF", border: `1px solid ${SEL}33`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: SEL, marginBottom: 8 }}>{wallTitle(key)}</div>
        <Param label="Высота" unit="мм" value={w.h} min={0} max={limits.maxH} step={0.5} onChange={(v) => updWall(key, { h: v })} />
        <Param label={isOuter ? "Наклон внутрь" : "Наклон в одну сторону"} unit="°" value={w.t1} min={0} max={50} step={1} onChange={(v) => updWall(key, { t1: v })} />
        {!isOuter && (
          <Param label="Наклон в другую сторону" unit="°" value={w.t2} min={0} max={50} step={1} onChange={(v) => updWall(key, { t2: v })} />
        )}
        <Param label="Скругление кромки" unit="мм" value={w.rnd} min={0} max={8} step={0.25} onChange={(v) => updWall(key, { rnd: v })} />
        {isOuter && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#3D4A5C", cursor: "pointer", margin: "2px 0 4px" }}>
              <input
                type="checkbox" checked={!!w.cardHooks}
                onChange={(e) => setCardHooks(key, e.target.checked)}
                style={{ accentColor: SEL }}
              />
              Отверстия под визитницу
            </label>
            {w.cardHooks && (
              <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 6px", lineHeight: 1.4 }}>
                Окна {CARDH.hw}×{CARDH.hh} мм под крюки. Стенка поднята до {CARDH.wallH} мм, чтобы карман висел не задевая стол; деталь — на вкладке «Принтер».
              </p>
            )}
          </>
        )}
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "6px 0 4px" }}>Спуск кромки дугой</div>
        <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
          {[["none", "Нет"], ["a", endLabels(key)[0]], ["b", endLabels(key)[1]]].map(([d, t]) => (
            <button
              key={d}
              onClick={() => updWall(key, { drop: d })}
              style={{
                padding: "4px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: w.drop === d ? `2px solid ${SEL}` : "1px solid #D6DDE6",
                background: w.drop === d ? "#DBEAFE" : "#fff", color: w.drop === d ? SEL : "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {w.drop !== "none" && (
          <Param label="Высота в низкой точке" unit="мм" value={Math.min(w.dropH, w.h)} min={0} max={w.h} step={0.5} onChange={(v) => updWall(key, { dropH: v })} />
        )}
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "6px 0 4px" }}>Заполнение стенки</div>
        <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
          {[["solid", "Сплошная"], ["hex", "Соты"], ["lines", "Линии"]].map(([f, t]) => (
            <button
              key={f}
              onClick={() => updWall(key, { face: f })}
              style={{
                padding: "4px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: w.face === f ? `2px solid ${SEL}` : "1px solid #D6DDE6",
                background: w.face === f ? "#DBEAFE" : "#fff", color: w.face === f ? SEL : "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {w.face === "hex" && (
          <Param label="Размер соты" unit="мм" value={w.hexSize} min={5} max={20} step={0.5} onChange={(v) => updWall(key, { hexSize: v })} />
        )}
        {w.face === "lines" && (
          <Param label="Шаг линий" unit="мм" value={w.lineStep} min={6} max={30} step={0.5} onChange={(v) => updWall(key, { lineStep: v })} />
        )}
        {w.face === "lines" && (
          <button
            onClick={() => updWall(key, { seed: Math.floor(Math.random() * 1e6) + 1 })}
            style={{ padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #D6DDE6", background: "#fff", color: "#3D4A5C", marginBottom: 8 }}
          >
            Перемешать узор
          </button>
        )}
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "4px 0 0", lineHeight: 1.4 }}>
          Высота 0 объединяет ячейки, выше {cur.H} мм — башенка. Соты и спуск кромки вместе не работают.
        </p>
      </div>
    );
  } else if (selection?.type === "line") {
    const first = getWall(cur, selection.keys[0]);
    editorWall = (
      <div style={{ background: "#EFF6FF", border: `1px solid ${SEL}33`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: SEL, marginBottom: 8 }}>{selection.label}</div>
        <Param label="Высота всех сегментов" unit="мм" value={first.h} min={0} max={limits.maxH} step={0.5} onChange={(v) => updWalls(selection.keys, { h: v })} />
        <Param label={selection.outer ? "Наклон внутрь" : "Наклон в одну сторону"} unit="°" value={first.t1} min={0} max={50} step={1} onChange={(v) => updWalls(selection.keys, { t1: v })} />
        {!selection.outer && (
          <Param label="Наклон в другую сторону" unit="°" value={first.t2} min={0} max={50} step={1} onChange={(v) => updWalls(selection.keys, { t2: v })} />
        )}
        <Param label="Скругление кромки" unit="мм" value={first.rnd} min={0} max={8} step={0.25} onChange={(v) => updWalls(selection.keys, { rnd: v })} />
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "6px 0 4px" }}>Спуск кромки дугой</div>
        <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
          {[["none", "Нет"], ["a", endLabels(selection.src)[0]], ["b", endLabels(selection.src)[1]]].map(([d, t]) => (
            <button
              key={d}
              onClick={() => updWalls(selection.keys, { drop: d })}
              style={{
                padding: "4px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: first.drop === d ? `2px solid ${SEL}` : "1px solid #D6DDE6",
                background: first.drop === d ? "#DBEAFE" : "#fff", color: first.drop === d ? SEL : "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {first.drop !== "none" && (
          <Param label="Высота в низкой точке" unit="мм" value={Math.min(first.dropH, first.h)} min={0} max={first.h} step={0.5} onChange={(v) => updWalls(selection.keys, { dropH: v })} />
        )}
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "6px 0 4px" }}>Заполнение стенки</div>
        <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
          {[["solid", "Сплошная"], ["hex", "Соты"], ["lines", "Линии"]].map(([f, t]) => (
            <button
              key={f}
              onClick={() => updWalls(selection.keys, { face: f })}
              style={{
                padding: "4px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: first.face === f ? `2px solid ${SEL}` : "1px solid #D6DDE6",
                background: first.face === f ? "#DBEAFE" : "#fff", color: first.face === f ? SEL : "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {first.face === "hex" && (
          <Param label="Размер соты" unit="мм" value={first.hexSize} min={5} max={20} step={0.5} onChange={(v) => updWalls(selection.keys, { hexSize: v })} />
        )}
        {first.face === "lines" && (
          <Param label="Шаг линий" unit="мм" value={first.lineStep} min={6} max={30} step={0.5} onChange={(v) => updWalls(selection.keys, { lineStep: v })} />
        )}
        {first.face === "lines" && (
          <button
            onClick={() => updWalls(selection.keys, { seed: Math.floor(Math.random() * 1e6) + 1 })}
            style={{ padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #D6DDE6", background: "#fff", color: "#3D4A5C", marginBottom: 8 }}
          >
            Перемешать узор
          </button>
        )}
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "4px 0 0", lineHeight: 1.4 }}>
          Значение применяется сразу ко всем {selection.keys.length} сегментам линии; дуга спуска строится в каждом сегменте отдельно.
        </p>
      </div>
    );
  } else if (selection?.type === "cell") {
    const keys = cellKeys(cur, selection.i, selection.j);
    const firstH = getWall(cur, keys[0].key).h;
    const Lsel = layout(cur);
    const colLocked = !!(cur.lockedCellW || {})[selection.i + ":" + selection.j];
    const rowLocked = !!(cur.lockedRows || {})[selection.j];
    const lockBtn = (on, text, onClick) => (
      <button
        onClick={onClick}
        style={{
          padding: "4px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
          border: on ? `2px solid ${SEL}` : "1px solid #D6DDE6",
          background: on ? "#DBEAFE" : "#fff", color: on ? SEL : "#3D4A5C",
        }}
      >
        {on ? "🔒" : "🔓"} {text}
      </button>
    );
    editorCell = (
      <div style={{ background: "#EFF6FF", border: `1px solid ${SEL}33`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: SEL, marginBottom: 8 }}>
          Ячейка {selection.i + 1}×{selection.j + 1}
        </div>
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "0 0 4px" }}>Размер этой ячейки</div>
        <Param
          label="Ширина ячейки" unit="мм" value={Math.round(Lsel.cw(selection.i, selection.j) * 10) / 10}
          min={10} max={limits.maxW} step={0.5} disabled={colLocked}
          onChange={(v) => setCellWidth(selection.i, selection.j, v)}
        />
        <Param
          label="Глубина ячейки" unit="мм" value={Math.round(Lsel.cd(selection.j) * 10) / 10}
          min={10} max={limits.maxD} step={0.5} disabled={rowLocked}
          onChange={(v) => setRowDepth(selection.j, v)}
        />
        <button
          onClick={() => convertToFixed(selection.i, selection.j)}
          style={{
            width: "100%", padding: "6px 4px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
            border: "1px solid #D6DDE6", margin: "0 0 6px", background: "#fff", color: "#3D4A5C",
          }}
        >
          🔒 Зафиксировать эту ячейку
        </button>
        <div style={{ display: "flex", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
          {lockBtn(colLocked, "ширина (эта ячейка)", () => toggleCellWLock(selection.i, selection.j))}
          {lockBtn(rowLocked, "глубина (весь ряд)", () => toggleRowLock(selection.j))}
        </div>
        {!colLocked && (
          <Param
            label="Доля при делении остатка" unit="×"
            value={(cur.cellShares || {})[selection.i + ":" + selection.j] ?? 1}
            min={0.5} max={5} step={0.5}
            onChange={(v) => {
              const key = selection.i + ":" + selection.j;
              const next = { ...(cur.cellShares || {}) };
              if (Math.abs(v - 1) < 0.001) delete next[key]; else next[key] = v;
              updCur({ cellShares: next });
            }}
          />
        )}
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 8px", lineHeight: 1.4 }}>
          «Зафиксировать» — жёсткий бокс с якорем к стенке, сетка его обтекает. Замок ширины держит ячейку в ряду, замок глубины — весь ряд. «Доля» — вес при делении свободного места.
        </p>
        <Param
          label="Высота стенок ячейки" unit="мм" value={firstH} min={0} max={limits.maxH} step={0.5}
          onChange={(v) => updWalls(keys.map((k) => k.key), { h: v })}
        />
        <Param
          label="Уровень пола (лесенка)" unit="мм" value={getCellLvl(cur, selection.i, selection.j)}
          min={0} max={Math.max(0, cur.H - 4)} step={0.5}
          onChange={(v) => updCell(selection.i, selection.j, { lvl: v })}
        />
        {(() => {
          const cc = (cur.cells || {})[selection.i + ":" + selection.j] || {};
          const fDir = cc.tiltDir || "none";
          return (
            <div>
              <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "6px 0 4px" }}>Наклон пола (спуск к стороне)</div>
              <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
                {[["none", "Нет"], ["n", "Ближней"], ["s", "Дальней"], ["w", "Левой"], ["e", "Правой"]].map(([d, t]) => (
                  <button
                    key={d}
                    onClick={() => updCell(selection.i, selection.j, { tiltDir: d, tiltA: cc.tiltA || 5 })}
                    style={{
                      padding: "4px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      border: fDir === d ? `2px solid ${SEL}` : "1px solid #D6DDE6",
                      background: fDir === d ? "#DBEAFE" : "#fff", color: fDir === d ? SEL : "#3D4A5C",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {fDir !== "none" && (
                <Param label="Угол наклона пола" unit="°" value={cc.tiltA || 5} min={1} max={30} step={0.5}
                  onChange={(v) => updCell(selection.i, selection.j, { tiltA: v })} />
              )}
              <button
                onClick={() => {
                  // уровень и наклон этой ячейки — во все ячейки контейнера:
                  // так задаётся общий уровень пола и общий наклон
                  const src = { ...cc };
                  const L3 = layout(cur);
                  const cells = {};
                  for (let j = 0; j < L3.nRows; j++)
                    for (let i = 0; i < L3.nColsAt(j); i++) cells[i + ":" + j] = { ...src };
                  updCur({ cells });
                }}
                style={{
                  width: "100%", margin: "2px 0 6px", padding: "7px 0", borderRadius: 8, fontSize: 12,
                  fontWeight: 600, cursor: "pointer", border: `1px solid ${SEL}`, background: "#fff", color: SEL,
                }}
              >
                Применить уровень и наклон ко всем ячейкам
              </button>
            </div>
          );
        })()}
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "6px 0 4px" }}>Наклон стенок внутрь</div>
        {keys.map(({ side, key, slot }) => (
          <Param
            key={key + slot} label={side} unit="°"
            value={getWall(cur, key)[slot]} min={0} max={50} step={1}
            onChange={(v) => updWall(key, { [slot]: v })}
          />
        ))}
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "4px 0 0", lineHeight: 1.4 }}>
          Выше {cur.H} мм — ячейка-башенка. Под поднятым полом печатается сетка рёбер, поддержки не нужны.
        </p>
      </div>
    );
  }

  if (selection?.type === "fixed" && (cur.fixedCells || [])[selection.k]) {
    const k = selection.k;
    const fc = cur.fixedCells[k];
    const anchors = [
      ["nw", "↖ угол"], ["n", "↑ стенка"], ["ne", "↗ угол"],
      ["w", "← стенка"], ["e", "→ стенка"],
      ["sw", "↙ угол"], ["s", "↓ стенка"], ["se", "↘ угол"],
    ];
    editorCell = (
      <div style={{ background: "#FFF3EB", border: "1px solid #F2620F55", borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: ACCENT, marginBottom: 8 }}>
          🔒 Фиксированная ячейка {k + 1}
        </div>
        <Param label="Ширина (внутри)" unit="мм" value={fc.w} min={10} max={limits.maxW} step={0.5} onChange={(v) => updFixed(k, { w: v })} />
        <Param label="Глубина (внутри)" unit="мм" value={fc.d} min={10} max={limits.maxD} step={0.5} onChange={(v) => updFixed(k, { d: v })} />
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "6px 0 4px" }}>Прижата к</div>
        <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
          {anchors.map(([a, t]) => (
            <button
              key={a}
              onClick={() => updFixed(k, { anchor: a })}
              style={{
                padding: "4px 9px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: (fc.anchor || "nw") === a ? `2px solid ${ACCENT}` : "1px solid #D6DDE6",
                background: (fc.anchor || "nw") === a ? "#FFE4D1" : "#fff", color: (fc.anchor || "nw") === a ? ACCENT : "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <Param label="Уровень пола (лесенка)" unit="мм" value={fc.lvl || 0} min={0} max={Math.max(0, cur.H - 4)} step={0.5} onChange={(v) => updFixed(k, { lvl: v })} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={() => unfixCell(k, false)}
            style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", border: "1px solid #D6DDE6", background: "#fff", color: "#3D4A5C" }}
          >
            🔓 Снять фиксацию
          </button>
          <button
            onClick={() => unfixCell(k, true)}
            style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", border: "1px solid #F1C0C0", background: "#fff", color: "#C0392B" }}
          >
            Растворить в сетке
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "8px 0 0", lineHeight: 1.4 }}>
          Жёсткий бокс с якорем к стенке: сетка его обтекает, стенки настраиваются кликом в 3D.<br /><b>Снять фиксацию</b> — станет обычной ячейкой на своём месте. <b>Растворить</b> — исчезнет, место заберут соседи.
        </p>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", height: "100vh", background: "#F6F8FA",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#16202E", overflow: "hidden",
    }}>
      <div style={{ width: 310, minWidth: 270, flex: "0 1 310px", padding: "18px 18px 30px", background: "#FDFDFE", borderRight: "1px solid #E4E9EF", overflowY: "auto", maxHeight: "100vh" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT, fontWeight: 700 }}>
          Генератор лотков
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 700, margin: "3px 0 0" }}>Система контейнеров</h1>

        <div style={{ display: "flex", gap: 6, margin: "12px 0 16px" }}>
          {[["↶", undo, histLen, "Отменить последнее изменение (Ctrl+Z)"],
            ["↷", redo, aheadLen, "Вернуть отменённое (Ctrl+Shift+Z)"]].map(([sign, act, on, hint]) => (
            <button
              key={sign}
              onClick={act}
              disabled={!on}
              title={hint}
              style={{
                flex: "0 0 auto", width: 32, padding: "7px 0", borderRadius: 8, fontSize: 14, fontWeight: 700,
                cursor: on ? "pointer" : "default", border: "1px solid #D6DDE6",
                background: on ? "#fff" : "#F1F5F9", color: on ? "#3D4A5C" : "#B6C0CC",
              }}
            >
              {sign}
            </button>
          ))}
          {[["printer", "Принтер"], ["layout", "Раскладка"], ["cont", "Контейнеры"]].map(([t, n]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                border: tab === t ? `2px solid ${ACCENT}` : "1px solid #D6DDE6",
                background: tab === t ? "#FFF3EB" : "#fff", color: tab === t ? ACCENT : "#3D4A5C",
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {tab === "layout" && (<div>
        <SectionTitle>Раскладка</SectionTitle>
        <p style={{ fontSize: 12, color: "#8A97A8", margin: "0 0 8px", lineHeight: 1.45 }}>
          Раскладка свободная: контейнеры любых размеров стоят где угодно внутри рамки стола и <b>таскаются мышью</b> — края прилипают к соседям и к рамке (Esc отменяет, красным — место занято).
        </p>
        {mapView}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={addContainer}
            disabled={!canAdd}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: canAdd ? "pointer" : "default", border: `1.5px solid ${canAdd ? ACCENT : "#D6DDE6"}`,
              background: "#fff", color: canAdd ? ACCENT : "#B6C0CC",
            }}
          >
            + контейнер
          </button>
          <button
            onClick={fillLayout}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: "pointer", border: `1.5px solid ${ACCENT}`, background: "#fff", color: ACCENT,
            }}
          >
            Заполнить раскладку
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "4px 0 0", lineHeight: 1.4 }}>
          «+» ставит контейнер в самое большое свободное место; «Заполнить» закрывает контейнерами всё свободное место рамки.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          {containers.length > 1 && (
            <button
              onClick={() => { setContainers((cs) => cs.filter((_, i) => i !== sel)); setSel(0); setSelection(null); }}
              style={{ padding: "5px 10px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", border: "1px solid #F1C0C0", background: "#fff", color: "#C0392B" }}
            >
              удалить №{sel + 1}
            </button>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#3D4A5C", cursor: "pointer" }}>
            <input
              type="checkbox" checked={connect}
              onChange={(e) => {
                const on = e.target.checked;
                setConnect(on);
                if (on) setContainers((cs) => cs.map((c) => ({ ...c, wallOut: Math.max(c.wallOut, CG.minWall) })));
              }}
              style={{ accentColor: ACCENT }}
            />
            Соединители
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#3D4A5C", cursor: "pointer" }}>
            <input
              type="checkbox" checked={magnet}
              onChange={(e) => setMagnet(e.target.checked)}
              style={{ accentColor: ACCENT }}
            />
            Магнит соседей
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#3D4A5C", cursor: "pointer" }}>
            <input
              type="checkbox" checked={layMagnet}
              onChange={(e) => setLayMagnet(e.target.checked)}
              style={{ accentColor: ACCENT }}
            />
            Магнит раскладки
          </label>
        </div>
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "6px 0 0", lineHeight: 1.4 }}>
          Магнит соседей: соседи, прилипшие к грани контейнера, едут за ней при изменении его размера — сборка остаётся плотной.
        </p>
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "6px 0 0", lineHeight: 1.4 }}>
          Магнит раскладки: щели уже 30 мм закрываются растяжкой контейнеров, свободное место побольше — новыми контейнерами.
        </p>

        <SectionTitle>Соединители</SectionTitle>
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "0 0 0", lineHeight: 1.45 }}>
          «Ласточкин хвост»: рельс входит в паз соседа сверху. Зазор {DEFAULT_CLR.toLocaleString("ru")} мм, стенка от {CG.minWall} мм, замок — на стенке от {CG.lockMin} мм.
        </p>

        <SectionTitle>Лимит раскладки</SectionTitle>
        <Param label="Раскладка по X" unit="см" value={limits.layW} min={5} max={2000} step={1} onChange={(v) => updLimits({ layW: Math.round(v) })} />
        <Param label="Раскладка по Y" unit="см" value={limits.layD} min={5} max={2000} step={1} onChange={(v) => updLimits({ layD: Math.round(v) })} />
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-2px 0 0", lineHeight: 1.45 }}>
          Жёсткая рамка стола: сборка за неё не выходит. Сейчас {(built.totalW / 10).toFixed(1)}×{(built.totalD / 10).toFixed(1)} см из {limits.layW}×{limits.layD} см.
        </p>

        </div>)}

        {tab === "printer" && (<div>
        <SectionTitle>Лимиты принтера</SectionTitle>
        <Param label="Макс. ширина" unit="мм" value={limits.maxW} min={50} max={500} step={1} onChange={(v) => updLimits({ maxW: v })} />
        <Param label="Макс. глубина" unit="мм" value={limits.maxD} min={50} max={500} step={1} onChange={(v) => updLimits({ maxD: v })} />
        <Param label="Макс. высота" unit="мм" value={limits.maxH} min={30} max={500} step={1} onChange={(v) => updLimits({ maxH: v })} />
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-2px 0 0", lineHeight: 1.45 }}>
          Лимиты на ОДИН контейнер по внешним габаритам. По умолчанию — стол Bambu A1 mini с запасом.
        </p>

                <div style={{ height: 12 }} />
        <Collapse title="Проект" open={openSecs.project} onToggle={() => toggleSec("project")}>
        <button
          onClick={saveProject}
          style={{
            width: "100%", padding: "10px 0", background: "#fff", color: "#16202E",
            border: "1.5px solid #16202E", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}
        >
          💾 Сохранить проект в файл
        </button>
        <button
          onClick={() => fileRef.current && fileRef.current.click()}
          style={{
            width: "100%", marginTop: 8, padding: "10px 0", background: "#fff", color: "#16202E",
            border: "1.5px solid #16202E", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}
        >
          📂 Открыть проект из файла
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={openProjectFile} style={{ display: "none" }} />
        {ioMsg && (
          <p style={{ fontSize: 12, color: ACCENT, margin: "8px 0 0", fontWeight: 600 }}>{ioMsg}</p>
        )}
        <p style={{ fontSize: 12, color: "#8A97A8", marginTop: 8, lineHeight: 1.5 }}>
          Вся работа одним файлом .json. «Открыть проект» заменяет текущую.
        </p>
        </Collapse>

        <Collapse title="Экспорт" open={openSecs.export} onToggle={() => toggleSec("export")}>
        <button
          onClick={() => exportOne(sel)}
          style={{
            width: "100%", padding: "11px 0", background: ACCENT, color: "#fff", border: "none",
            borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(242,98,15,0.35)",
          }}
        >
          Скачать STL — контейнер №{sel + 1}
        </button>
        <button
          onClick={() => !solidBusy && exportSolid(sel)}
          disabled={solidBusy}
          style={{
            width: "100%", marginTop: 8, padding: "10px 0", background: "#fff", color: solidBusy ? "#8A97A8" : "#16202E",
            border: "1.5px solid #16202E", borderRadius: 10, fontSize: 14, fontWeight: 700,
            cursor: solidBusy ? "wait" : "pointer", opacity: solidBusy ? 0.7 : 1,
          }}
        >
          {solidBusy ? "Объединяю тело…" : `Скачать цельный STL (солид) — №${sel + 1}`}
        </button>
        {INS.dir !== "none" && insertSlots(cur, INS.dir).length > 0 && (
          <button
            onClick={exportInsert}
            style={{ width: "100%", marginTop: 8, padding: "10px 0", background: "#fff", color: "#16202E", border: "1.5px solid #D6DDE6", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Скачать вставную перегородку — {insertSize(cur, INS.dir).len} × {insertSize(cur, INS.dir).hgt} мм
          </button>
        )}
        {Object.values(cur.walls || {}).some((w2) => w2 && w2.cardHooks) && (
          <button
            onClick={() => exportSTL(cardHolderSolids(cur), "card_holder.stl")}
            style={{ width: "100%", marginTop: 8, padding: "10px 0", background: "#fff", color: "#16202E", border: "1.5px solid #D6DDE6", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Скачать визитницу — под отверстия в стенке
          </button>
        )}
        {containers.length > 1 && (
          <button
            onClick={exportAll}
            style={{ width: "100%", marginTop: 8, padding: "10px 0", background: "#fff", color: ACCENT, border: `1.5px solid ${ACCENT}`, borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Скачать все ({containers.length} файла)
          </button>
        )}
        <p style={{ fontSize: 12, color: "#8A97A8", marginTop: 8, lineHeight: 1.5 }}>
          Миллиметры, вертикаль — Z. Пазы спрятаны внутри толщины стенки: ячейки не искажаются, контейнеры смыкаются вплотную. Сборка — вдвиганием сверху.
        </p>
        </Collapse>

        <button
          onClick={doReset}
          style={{
            width: "100%", marginTop: 14, padding: "8px 0", borderRadius: 8, fontSize: 12.5, cursor: "pointer",
            border: resetArm ? "2px solid #C0392B" : "1px solid #F1C0C0",
            background: resetArm ? "#FDECEA" : "#fff", color: "#C0392B", fontWeight: resetArm ? 700 : 400,
          }}
        >
          {resetArm ? "Точно сбросить? Нажми ещё раз" : "Сбросить проект (значения по умолчанию)"}
        </button>
        </div>)}

        {tab === "cont" && (<div>
        {containers.length > 1 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {containers.map((_, i) => (
              <button
                key={i}
                onClick={() => { setSel(i); setSelection(null); }}
                style={{
                  padding: "5px 11px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  border: i === sel ? `2px solid ${ACCENT}` : "1px solid #D6DDE6",
                  background: i === sel ? "#FFF3EB" : "#fff", color: i === sel ? ACCENT : "#3D4A5C",
                }}
              >
                №{i + 1}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
          {[["cont", `Контейнер №${sel + 1}`], ["cell", "Ячейка"], ["walls", "Стенки"]].map(([t, n]) => (
            <button
              key={t}
              onClick={() => setSub(t)}
              style={{
                flex: 1, padding: "7px 2px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: sub === t ? `2px solid ${SEL}` : "1px solid #D6DDE6",
                background: sub === t ? "#EFF6FF" : "#fff", color: sub === t ? SEL : "#3D4A5C",
              }}
            >
              {n}
            </button>
          ))}
        </div>

        <Schematic c={cur} selection={selection} onSelect={handleSelect} />
        {layoutIssues(cur).map((iss, k) => (
          <p key={k} style={{ fontSize: 11.5, color: "#B45309", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, padding: "6px 9px", margin: "6px 0 0", lineHeight: 1.45 }}>
            ⚠ {iss.text}
          </p>
        ))}
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "6px 0 12px", lineHeight: 1.45 }}>
          Нажми на <b>ячейку</b> или <b>стенку</b> — на схеме или прямо на 3D-модели: нужная подвкладка откроется сама.
        </p>

        {sub === "cont" && (<div>
        <Collapse title={`Внешний размер — контейнер №${sel + 1}`} open={openSecs.outer} onToggle={() => toggleSec("outer")}>
        <button
          onClick={toggleLockOuter}
          style={{
            width: "100%", padding: "6px 4px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
            border: cur.lockOuter ? `2px solid ${SEL}` : "1px solid #D6DDE6", margin: "0 0 10px",
            background: cur.lockOuter ? "#DBEAFE" : "#fff", color: cur.lockOuter ? SEL : "#3D4A5C",
          }}
        >
          {cur.lockOuter ? "🔒" : "🔓"} Зафиксировать внешний размер
        </button>
        {cur.lockOuter && (
          <p style={{ fontSize: 11.5, color: "#64748B", margin: "-4px 0 8px", lineHeight: 1.4 }}>
          Габарит не меняют ни ячейки, ни магнит. Внутри менять можно всё.
        </p>
        )}
        <Param label="Ширина" unit="мм" value={cur.W} min={30} max={limits.maxW} step={1} disabled={cur.lockOuter || (cur.lockCell && cur.gridMode !== "size")} onChange={(v) => applyOuterDim({ W: v })} />
        <Param label="Глубина" unit="мм" value={cur.D} min={30} max={limits.maxD} step={1} disabled={cur.lockOuter || (cur.lockCell && cur.gridMode !== "size")} onChange={(v) => applyOuterDim({ D: v })} />
        <Param label="Высота" unit="мм" value={cur.H} min={10} max={limits.maxH} step={1} disabled={cur.lockOuter} onChange={(v) => updCur({ H: v })} />
        {cur.lockCell && (
          <p style={{ fontSize: 11.5, color: "#64748B", margin: "-4px 0 8px", lineHeight: 1.4 }}>
          Ячейка держит внутренний размер, контейнер подстраивается сам (в пределах лимита принтера).
        </p>
        )}

        </Collapse>

        <Collapse title="Пресеты" open={openSecs.presets} onToggle={() => toggleSec("presets")}>
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "0 0 8px", lineHeight: 1.45 }}>
          Пресет перенастраивает контейнер №{sel + 1}: сетку, стенки, полы. След {cur.W}×{cur.D} мм и место в раскладке остаются.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {PRESETS.filter(([k]) => k !== "stairs").map(([k, t]) => (
            <button
              key={k}
              onClick={() => applyPreset(k)}
              style={{
                padding: "8px 0", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                border: "1px solid #D6DDE6", background: "#fff", color: "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, padding: "8px 10px 2px", borderRadius: 8, border: "1px solid #E4E9EF", background: "#FAFBFC" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#3D4A5C", margin: "0 0 6px" }}>
            Горка {cur?.preset === "stairs" ? "— применена, параметры меняют её вживую" : ""}
          </p>
          <Param label="Ступенек" unit="шт" value={gorka.steps} min={2} max={12} step={1}
            onChange={(v) => updGorka({ steps: Math.round(v) })} />
          <Param
            label="Шаг уровня" unit="мм" value={gorka.stepH} min={3}
            max={Math.max(3, Math.min(60, Math.floor((limits.maxH - (cur?.floor ?? 1.6) - 20) / Math.max(1, gorka.steps - 1))))}
            step={1} onChange={(v) => updGorka({ stepH: v })} />
          <Param label="Колонки" unit="шт" value={gorka.cols ?? 1} min={1} max={8} step={1}
            onChange={(v) => updGorka({ cols: Math.round(v) })} />
          <Param label="Бортик (глубина ячеек)" unit="мм" value={gorka.lip ?? 6} min={2} max={80} step={1}
            onChange={(v) => updGorka({ lip: v })} />
          <Param label="Общий уровень пола" unit="мм" value={gorka.base ?? 0} min={0} max={120} step={1}
            onChange={(v) => updGorka({ base: v })} />
          <button
            onClick={() => applyPreset("stairs")}
            style={{
              width: "100%", margin: "2px 0 8px", padding: "8px 0", borderRadius: 8, fontSize: 12.5,
              fontWeight: 700, cursor: "pointer", border: `1.5px solid ${ACCENT}`, background: "#fff", color: ACCENT,
            }}
          >
            Горка — применить
          </button>
          <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "0 0 8px", lineHeight: 1.45 }}>
          Только для горки. Ступени растут к задней стенке, все равной глубины и ширины. Бортик — высота стенок над полом своей ступени, общий уровень поднимает лесенку целиком. «Ступенек» и «Шаг уровня» пересобирают её заново.
        </p>
        </div>
        </Collapse>

        <Collapse title="Толщина стенок и дна" open={openSecs.cells} onToggle={() => toggleSec("cells")}>
        <Param
          label="Внешние стенки" unit="мм" value={cur.wallOut}
          min={connect ? CG.minWall : 0.8} max={8} step={0.1}
          disabled={cur.lockOuter && cur.lockCell}
          onChange={(v) => applyParam({ wallOut: connect ? Math.max(v, CG.minWall) : v })}
        />
        {connect && (
          cur.wallOut < CG.minWall - 0.001 ? (
            <p style={{ fontSize: 11.5, color: "#B45309", margin: "-6px 0 10px", lineHeight: 1.4 }}>
          ⚠ Для замка нужна стенка от {CG.minWall} мм — сейчас {cur.wallOut} мм: паз ужат или замок не ставится.
        </p>
          ) : (
            <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-6px 0 10px", lineHeight: 1.4 }}>
              Минимум {CG.minWall} мм — паз соединителя прячется внутри стенки.
            </p>
          )
        )}
        <Param label="Перегородки" unit="мм" value={cur.wall} min={0.8} max={5} step={0.1} disabled={cur.lockOuter && cur.lockCell} onChange={(v) => applyParam({ wall: v })} />
        <Param label="Толщина дна" unit="мм" value={cur.floor} min={0.8} max={5} step={0.1} onChange={(v) => updCur({ floor: v })} />
        <Param
          label="Скругление углов" unit="мм" value={cur.cornerR ?? DEFAULT_CORNER_R}
          min={0} max={Math.min(6, cur.wallOut)} step={0.1}
          onChange={(v) => updCur({ cornerR: v })}
        />
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-6px 0 10px", lineHeight: 1.4 }}>
          Наружные вертикальные углы: радиус заметно больше скругления кромки.
        </p>

        </Collapse>

        <Collapse title="Деление на ячейки" open={openSecs.grid} onToggle={() => toggleSec("grid")}>
        {/* делить можно ровно настолько, насколько хватает пролёта:
            ячейка тоньше 5 мм — это уже не ячейка, а слипшиеся стенки */}
        <Stepper label="Колонки" value={Math.min(cur.cols, maxColsOf(cur))} min={1} max={Math.min(8, maxColsOf(cur))}
          disabled={cur.lockOuter && cur.lockCell} onChange={(v) => applyParam({ cols: v })} />
        <Stepper label="Ряды" value={Math.min(cur.rows, maxRowsOf(cur))} min={1} max={Math.min(8, maxRowsOf(cur))}
          disabled={cur.lockOuter && cur.lockCell} onChange={(v) => applyParam({ rows: v })} />
        </Collapse>

        </div>)}

        {sub === "cell" && (<div>
        <Collapse title="Настройки ячейки" open={openSecs.cellPick} onToggle={() => toggleSec("cellPick")}>
        {editorCell}
        {!editorCell && (
          <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "10px 0 0", lineHeight: 1.45 }}>
            Ячейка не выбрана. Здесь настраиваются размер ячейки и её фиксация, уровень пола (лесенка) и наклон пола.
          </p>
        )}
        </Collapse>
        </div>)}

        {sub === "walls" && (<div>
        <Collapse title="Настройки стенки" open={openSecs.walls} onToggle={() => toggleSec("walls")}>
        <p style={{ fontSize: 12, color: "#8A97A8", margin: "0 0 8px", lineHeight: 1.45 }}>
          Режим выбора:
        </p>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {[["seg", "Сегмент"], ["line", "Вся перегородка"]].map(([m, t]) => (
            <button
              key={m}
              onClick={() => { setSelMode(m); setSelection(null); }}
              style={{
                padding: "5px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                border: selMode === m ? `2px solid ${SEL}` : "1px solid #D6DDE6",
                background: selMode === m ? "#EFF6FF" : "#fff", color: selMode === m ? SEL : "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {editorWall}
        {Object.keys(cur.walls).length > 0 && (
          <button
            onClick={() => updCur({ walls: {} })}
            style={{ marginTop: 10, padding: "6px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", border: "1px solid #D6DDE6", background: "#fff", color: "#5A6B80" }}
          >
            Сбросить все стенки контейнера №{sel + 1}
          </button>
        )}

        </Collapse>

        <Collapse title="Вставные перегородки" open={openSecs.inserts} onToggle={() => toggleSec("inserts")}>
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 10px", lineHeight: 1.45 }}>
          Направляющие печатаются на стенках, перегородки — отдельной деталью, вдвигаются сверху. Зазор 0,2 мм.
        </p>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[["none", "Нет"], ["x", "Поперёк"], ["z", "Вдоль"]].map(([v, t]) => (
            <button
              key={v}
              onClick={() => updIns({ dir: v })}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: INS.dir === v ? `2px solid ${ACCENT}` : "1px solid #D6DDE6",
                background: INS.dir === v ? "#FFF3EB" : "#fff", color: INS.dir === v ? ACCENT : "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {INS.dir !== "none" && (() => {
          const slotsAll = insertSlotsAll(cur, INS.dir);
          const slots = insertSlots(cur, INS.dir);
          const blockedTall = slotsAll.length - slots.length;
          const sz = insertSize(cur, INS.dir);
          const crossing = INS.dir === "x" ? L.nRows > 1 : L.nColsAt(0) > 1;
          return (
            <>
              <Param label="Шаг мест" unit="мм" value={INS.step} min={6} max={80} step={1} onChange={(v) => updIns({ step: v })} />
              <Param label="Толщина вставки" unit="мм" value={INS.thk} min={0.8} max={6} step={0.1} onChange={(v) => updIns({ thk: v })} />
              <Param label="Зазор" unit="мм" value={INS.clr} min={0} max={0.6} step={0.05} onChange={(v) => updIns({ clr: v })} />
              <Param label="Выступ направляющей" unit="мм" value={INS.proj} min={0.4} max={4} step={0.1} onChange={(v) => updIns({ proj: v })} />
              <Param label="Ширина направляющей" unit="мм" value={INS.rail} min={0.8} max={5} step={0.1} onChange={(v) => updIns({ rail: v })} />
              <button
                onClick={() => updIns({ show: !INS.show })}
                style={{
                  width: "100%", padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: INS.show ? `2px solid ${SEL}` : "1px solid #D6DDE6", marginBottom: 8,
                  background: INS.show ? "#DBEAFE" : "#fff", color: INS.show ? SEL : "#3D4A5C",
                }}
              >
                {INS.show ? "👁 Вставки показаны в превью" : "👁 Показать вставки в превью"}
              </button>
              <p style={{ fontSize: 11.5, color: "#64748B", margin: 0, lineHeight: 1.45 }}>
                Мест под вставку: <b>{slots.length}</b>. Деталь: <b>{sz.len} × {sz.hgt} × {sz.thk} мм</b>, печатается плашмя.
                Скачать её — на вкладке «Принтер».
              </p>
              {crossing && slots.length > 0 && (
                <p style={{ fontSize: 11.5, color: "#64748B", margin: "8px 0 0", lineHeight: 1.45 }}>
                  Печатные стенки поперёк вставки — не помеха: в детали снизу вырезы,
                  она седлает стенки, а низ повторяет уровни полов.
                </p>
              )}
              {blockedTall > 0 && (
                <p style={{ fontSize: 11.5, color: "#B45309", margin: "8px 0 0", lineHeight: 1.45 }}>
          ⚠ Мест пропущено: {blockedTall}. Над вырезом нужно не меньше {MIN_WEB} мм сплошной полосы — понизьте поперечную стенку.
        </p>
              )}
              {slots.length === 0 && blockedTall === 0 && (
                <p style={{ fontSize: 11.5, color: "#B45309", margin: "8px 0 0", lineHeight: 1.45 }}>
                  ⚠ Ни одного места не помещается: уменьшите шаг или увеличьте контейнер.
                </p>
              )}
            </>
          );
        })()}
        </Collapse>

        </div>)}
        </div>)}

        {/* воздух под кнопками + случайная цитата (одна на сеанс) */}
        <div style={{ height: 44 }} />
        <div style={{ borderTop: "1px solid #E4E9EF", paddingTop: 14, paddingBottom: 48 }}>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: "#A9B4C2", fontStyle: "italic", margin: 0, textAlign: "center" }}>
            {quote}
          </p>
        </div>
      </div>

      <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", minWidth: 320, height: "100vh" }}>
        <div ref={mountRef} style={{ flex: 1, minHeight: 320, cursor: "grab" }} />
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "6px 26px", padding: "10px 18px",
          background: "#FDFDFE", borderTop: "1px solid #E4E9EF", fontSize: 13,
        }}>
          <div>
            <span style={{ color: "#8A97A8" }}>Ячейка №{sel + 1}: </span>
            <span style={{ fontFamily: MONO }}>{L.cellW.toFixed(1)} × {L.cellD.toFixed(1)} × {(cur.H - cur.floor).toFixed(1)} мм</span>
          </div>
          <div>
            <span style={{ color: "#8A97A8" }}>Материал ≈ </span>
            <span style={{ fontFamily: MONO }}>{volume.toFixed(1)} см³</span>
          </div>
          <div style={{ color: "#B4BECB", marginLeft: "auto" }}>
            Вращение — левой кнопкой, сдвиг — правой, зум — колесом
          </div>
        </div>
      </div>
    </div>
  );
}
