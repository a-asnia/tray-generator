// ══════════════════════════════════════════════════════════════
// Приложение: панель с вкладками (Модель / Принтер / Раскладка),
// редакторы стенок и ячеек, экспорт STL, автосохранение
// ══════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useMemo } from "react";
import { exportSTL, exportSTLIndexed, weldTris, solidsVolume } from "./geometry/stl.js";
import { getManifold } from "./geometry/manifold.js";
import { connectorVs, connGeom, DEFAULT_CLR } from "./model/connectors.js";
import { insertsOf, insertSlots, insertSize, insertPlateSolids } from "./model/inserts.js";
import { wpartsOf, wpGeom, wpSize, wpFlatten, wpOn, SIDES, SIDE_NAME } from "./model/wallparts.js";
import { layout, defWall, getWall, getCellLvl, lineOf, cellKeys, endLabels, wallTitle, minOuterDim, fitSizes, lockedWIn, DEFAULT_CORNER_R } from "./model/layout.js";
import { buildContainer } from "./model/build.js";
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
  // по умолчанию — чуть меньше стола Bambu A1 mini (180×180×180), запас под юбку
  const [limits, setLimits] = useState(SAVED?.limits ?? { maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40, connClr: DEFAULT_CLR });
  // размеры соединителя зависят от зазора печати (настройка «Принтер»)
  const CG = connGeom(limits.connClr);
  const [tab, setTab] = useState("cont");
  // подвкладки внутри «Контейнеры»
  const [sub, setSub] = useState("cont");
  const [openSecs, setOpenSecs] = useState(() => ({ outer: true, cells: true, grid: true, walls: true, cellPick: true, inserts: true, wparts: true, project: true, export: true, ...(SAVED?.openSecs ?? {}) }));
  const toggleSec = (k) => setOpenSecs((o) => ({ ...o, [k]: !o[k] }));

  // автосохранение при каждом изменении
  useEffect(() => {
    try {
      window.localStorage.setItem("trayGenState", JSON.stringify({ containers, limits, connect, magnet, openSecs }));
    } catch (e) {}
  }, [containers, limits, connect, magnet, openSecs]);

  const cur = containers[sel];

  const updLimits = (patch) => {
    const nl = { ...limits, ...patch };
    // при росте зазора паз становится глубже и требует более толстой
    // стенки — иначе он прорезал бы её насквозь
    const minW = connect ? connGeom(nl.connClr).minWall : 0;
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
      patch = { rowColWs: null, lockedCellW: {}, ...patch };
    if (patch.rows !== undefined || patch.cellDt !== undefined || patch.gridMode !== undefined)
      patch = { rowDs: null, lockedRows: {}, rowColWs: null, lockedCellW: {}, ...patch };
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
    if (lockC && cur.gridMode !== "size") {
      const m = { ...cur, ...patch };
      const W2 = 2 * m.wallOut + m.cols * cur.cellW0 + (m.cols - 1) * m.wall;
      const D2 = 2 * m.wallOut + m.rows * cur.cellD0 + (m.rows - 1) * m.wall;
      if (W2 > limits.maxW + 0.01 || D2 > limits.maxD + 0.01 || W2 < 30 || D2 < 30) return; // не влезает в принтер
      updCur({ ...patch, W: Math.round(W2 * 10) / 10, D: Math.round(D2 * 10) / 10 });
      return;
    }
    updCur(patch);
  };

  // Магнит соседей (переключатель на вкладке «Раскладка»): сборка
  // сохраняет общий габарит. Ужал контейнер — соседние колонки/ряды
  // выросли на ту же величину (и наоборот). Сосед растёт максимум до
  // лимита принтера; если впитать освободившееся место больше некому,
  // рядом добавляется НОВЫЙ контейнер на остаток (минимум 30 мм).
  // Замки соседа соблюдаются: зафиксированные ячейки не меняются.
  const applyOuterDim = (patch) => {
    // «Зафиксировать внешний размер» — намертво: габарит не меняется ни
    // от ползунков, ни от изменения ячеек внутри, ни магнитом соседей
    if (cur.lockOuter) return;
    const isW = "W" in patch;
    const axis = isW ? "W" : "D";
    const gKey = isW ? "gx" : "gy";
    const maxAxis = isW ? limits.maxW : limits.maxD;
    // не даём ужать контейнер ниже суммы его зафиксированных колонок/рядов
    patch = { [axis]: Math.max(patch[axis], minOuterDim(cur, axis)) };
    const myG = cur[gKey];
    const myId = cur.id;
    const magnetOn = magnet;
    const myOther = isW ? cur.D : cur.W;
    const myOtherG = isW ? cur.gy : cur.gx;
    setContainers((cs) => {
      const widthIn = (arr, g) => Math.max(30, ...arr.filter((c) => c[gKey] === g).map((c) => c[axis]));
      const myBefore = widthIn(cs, myG);
      let next = cs.map((c) => (c.id === myId ? { ...c, ...patch } : c));
      if (!magnetOn) return next;
      // В связанной сборке контейнеры одной колонки держат общую ширину
      // (одного ряда — общую глубину), иначе вокруг ужатого появляются
      // щели, а соединители расходятся. Поэтому при магните размер
      // применяется ко всей колонке/ряду — кроме контейнеров с глобальными
      // замками; замки ячеек каждого соседа по колонке соблюдаются.
      const mates = cs.filter((c) => c[gKey] === myG && (c.id === myId || (!c.lockOuter && !c.lockCell)));
      const tgt = Math.round(Math.max(patch[axis], ...mates.map((c) => minOuterDim(c, axis))) * 10) / 10;
      next = cs.map((c) => (mates.some((m) => m.id === c.id) ? { ...c, [axis]: tgt } : c));
      let delta = myBefore - widthIn(next, myG); // >0 — место освободилось, соседи растут
      if (Math.abs(delta) < 0.05) return next;
      const groupOf = (g) => next.filter((c) => c[gKey] === g);
      const adjustable = [...new Set(next.map((c) => c[gKey]))].filter(
        (g) => g !== myG && groupOf(g).every((c) => !c.lockOuter && !c.lockCell)
      );
      const minOf = (g) => Math.max(...groupOf(g).map((c) => minOuterDim(c, axis)));
      // расширяться может только контейнер, который способен впитать рост
      // свободными ячейками: по ширине — в КАЖДОМ ряду есть незамкнутая
      // ячейка, по глубине — есть незамкнутый ряд
      const canGrow = (cc) => {
        const Lg = layout(cc);
        if (!isW) {
          const locked = cc.lockedRows || {};
          return Object.keys(locked).filter((k) => +k >= 0 && +k < Lg.nRows).length < Lg.nRows;
        }
        for (let j = 0; j < Lg.nRows; j++)
          if (Object.keys(lockedWIn(cc, j)).length >= Lg.nColsAt(j)) return false;
        return true;
      };
      const capOf = (g) => (groupOf(g).every(canGrow) ? maxAxis : widthIn(next, g));
      const targets = new Map(adjustable.map((g) => [g, widthIn(next, g)]));
      for (let pass = 0; pass < 3 && Math.abs(delta) > 0.05 && adjustable.length; pass++) {
        const open = adjustable.filter((g) =>
          delta > 0 ? targets.get(g) < capOf(g) - 0.01 : targets.get(g) > minOf(g) + 0.01
        );
        if (!open.length) break;
        const share = delta / open.length;
        for (const g of open) {
          const t0 = targets.get(g);
          const t = Math.max(minOf(g), Math.min(capOf(g), Math.round((t0 + share) * 10) / 10));
          delta -= t - t0;
          targets.set(g, t);
        }
      }
      next = next.map((c) =>
        c[gKey] !== myG && targets.has(c[gKey]) && !c.lockOuter && !c.lockCell &&
        Math.abs(targets.get(c[gKey]) - c[axis]) > 0.01
          ? { ...c, [axis]: targets.get(c[gKey]) }
          : c
      );
      // соседям расти больше некуда (лимит принтера) — остаток закрывает
      // новый контейнер, вставленный сразу за ужатым
      if (delta >= 30) {
        const size = Math.round(delta * 10) / 10;
        next = next.map((c) => (c[gKey] > myG ? { ...c, [gKey]: c[gKey] + 1 } : c));
        const fresh = makeContainer(null, 0, 0);
        next = [...next, {
          ...fresh,
          [gKey]: myG + 1,
          [isW ? "gy" : "gx"]: myOtherG,
          [axis]: size,
          [isW ? "D" : "W"]: myOther,
        }];
      }
      return next;
    });
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
    setLimits({ maxW: 170, maxD: 170, maxH: 175, layW: 40, layD: 40, connClr: DEFAULT_CLR });
    setOpenSecs({ outer: true, cells: true, grid: true, walls: true, project: true, export: true });
    // вкладка не переключается — остаёмся там, где нажали сброс
  };

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

  const posMap = useMemo(() => {
    const m = new Map();
    containers.forEach((c, i) => m.set(`${c.gx},${c.gy}`, i));
    return m;
  }, [containers]);

  // Геометрия кэшируется по объекту контейнера: правка одного контейнера
  // не должна пересобирать остальные. Объекты неизменяемые (обновление
  // делает новый объект только для затронутого), поэтому ссылка — надёжный
  // ключ, а WeakMap не держит устаревшие записи.
  const geoCache = useRef(new WeakMap());
  // ── сборка: соединители по соседям + раскладка сеткой ──
  const built = useMemo(() => {
    const nb = (c, dx, dy) => {
      const i = posMap.get(`${c.gx + dx},${c.gy + dy}`);
      return i === undefined ? null : containers[i];
    };
    // физическая сетка: ширина колонки/глубина ряда = максимум по контейнерам
    const gxs = containers.map((c) => c.gx), gys = containers.map((c) => c.gy);
    const gx0 = Math.min(...gxs), gx1 = Math.max(...gxs);
    const gy0 = Math.min(...gys), gy1 = Math.max(...gys);
    const gap = connect ? 0 : 6;
    const colW = {}, rowD = {};
    for (let g = gx0; g <= gx1; g++)
      colW[g] = Math.max(30, ...containers.filter((c) => c.gx === g).map((c) => c.W));
    for (let g = gy0; g <= gy1; g++)
      rowD[g] = Math.max(30, ...containers.filter((c) => c.gy === g).map((c) => c.D));
    const colX = {}, rowZ = {};
    let acc = 0;
    for (let g = gx0; g <= gx1; g++) { colX[g] = acc + colW[g] / 2; acc += colW[g] + gap; }
    const totalW = acc - gap;
    acc = 0;
    for (let g = gy0; g <= gy1; g++) { rowZ[g] = acc + rowD[g] / 2; acc += rowD[g] + gap; }
    const totalD = acc - gap;

    const items = containers.map((c) => {
      const E = nb(c, 1, 0), Wn = nb(c, -1, 0), S = nb(c, 0, 1), N = nb(c, 0, -1);
      const conn = !connect
        ? { N: null, S: null, W: null, E: null }
        : {
            E: E ? { male: true, vs: connectorVs(Math.min(c.D, E.D)) } : null,
            W: Wn ? { male: false, vs: connectorVs(Math.min(c.D, Wn.D)) } : null,
            S: S ? { male: true, vs: connectorVs(Math.min(c.W, S.W)) } : null,
            N: N ? { male: false, vs: connectorVs(Math.min(c.W, N.W)) } : null,
          };
      const ck = `${limits.connClr}|${JSON.stringify(conn)}`;
      let hit = geoCache.current.get(c);
      if (!hit || hit.key !== ck) {
        hit = { key: ck, solids: buildContainer({ ...c, connClr: limits.connClr }, conn) };
        geoCache.current.set(c, hit);
      }
      return {
        c,
        solids: hit.solids,
        ox: colX[c.gx] - totalW / 2,
        oz: rowZ[c.gy] - totalD / 2,
      };
    });
    return { items, totalW, totalD };
  }, [containers, connect, posMap, limits.connClr]);

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
  // колонки и ряды максимально доступного размера (лимит принтера), пока
  // влезают в лимит раскладки; остаток, который меньше лимита принтера,
  // забирает последний контейнер, а слишком мелкий хвост делится пополам
  // с предыдущим. Существующие контейнеры не меняются.
  const fillLayout = () => {
    const gxs2 = containers.map((c) => c.gx), gys2 = containers.map((c) => c.gy);
    const fGx0 = Math.min(...gxs2), fGx1 = Math.max(...gxs2);
    const fGy0 = Math.min(...gys2), fGy1 = Math.max(...gys2);
    const colW = {}, rowD = {};
    for (let g = fGx0; g <= fGx1; g++) colW[g] = Math.max(30, ...containers.filter((c) => c.gx === g).map((c) => c.W));
    for (let g = fGy0; g <= fGy1; g++) rowD[g] = Math.max(30, ...containers.filter((c) => c.gy === g).map((c) => c.D));
    const extend = (map, g1, total, maxDim) => {
      let rem = total - Object.values(map).reduce((s, v) => s + v, 0);
      let g = g1 + 1;
      while (rem >= 30) {
        let size;
        if (rem > maxDim + 0.01) size = rem - maxDim < 30 ? Math.round((rem / 2) * 10) / 10 : maxDim;
        else size = Math.round(rem * 10) / 10;
        map[g] = size;
        rem -= size;
        g++;
      }
      return g - 1;
    };
    const nGx1 = extend(colW, fGx1, limits.layW * 10, limits.maxW);
    const nGy1 = extend(rowD, fGy1, limits.layD * 10, limits.maxD);
    const occupied = new Set(containers.map((c) => `${c.gx},${c.gy}`));
    const added = [];
    for (let gy = fGy0; gy <= nGy1; gy++)
      for (let gx = fGx0; gx <= nGx1; gx++)
        if (!occupied.has(`${gx},${gy}`))
          added.push({ ...makeContainer(null, gx, gy), W: colW[gx], D: rowD[gy] });
    if (added.length) {
      setContainers([...containers, ...added]);
      setSelection(null);
    }
  };

  // ── проект в файл и обратно ──
  const fileRef = useRef(null);
  const [ioMsg, setIoMsg] = useState("");
  const saveProject = () => {
    exportProject({ containers, limits, connect, magnet, openSecs });
    setIoMsg("Проект сохранён в файл");
    setTimeout(() => setIoMsg(""), 3000);
  };
  const openProjectFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // чтобы повторный выбор того же файла сработал
    if (!file) return;
    importProject(file, (proj) => {
      if (!proj) { setIoMsg("Не удалось открыть: это не файл проекта"); setTimeout(() => setIoMsg(""), 4000); return; }
      setContainers(proj.containers);
      if (proj.limits) setLimits(proj.limits);
      setConnect(proj.connect !== false);
      setMagnet(proj.magnet !== false);
      if (proj.openSecs) setOpenSecs((o) => ({ ...o, ...proj.openSecs }));
      setSel(0);
      setSelection(null);
      setIoMsg(`Проект открыт: ${proj.containers.length} контейнер(ов)`);
      setTimeout(() => setIoMsg(""), 4000);
    });
  };

  // ── карта раскладки ──
  const gxs = containers.map((c) => c.gx), gys = containers.map((c) => c.gy);
  const rGx0 = Math.min(...gxs), rGx1 = Math.max(...gxs);
  const rGy0 = Math.min(...gys), rGy1 = Math.max(...gys);
  const gx0 = rGx0 - 1, gx1 = rGx1 + 1, gy0 = rGy0 - 1, gy1 = rGy1 + 1;
  // Размеры нового контейнера: стандартный (120×80), НО если после него
  // в лимит раскладки уже не влезет ещё один стандартный — он растягивается
  // и заполняет оставшееся место (в пределах лимита принтера).
  // В существующей колонке/ряду размер совпадает с ними — для плотной стыковки.
  // «стандартный» контейнер = максимум принтера по ширине и глубине
  const STD = { W: limits.maxW, D: limits.maxD };
  const colWidthAt = (g) => {
    const ws = containers.filter((c) => c.gx === g).map((c) => c.W);
    return ws.length ? Math.max(...ws) : 0;
  };
  const rowDepthAt = (g) => {
    const ds = containers.filter((c) => c.gy === g).map((c) => c.D);
    return ds.length ? Math.max(...ds) : 0;
  };
  const plannedDims = (gx, gy) => {
    // остаток, не влезающий в один контейнер по лимиту принтера,
    // делится пополам на ДВА контейнера (splitX/splitY)
    let W, splitX = null;
    if (gx >= rGx0 && gx <= rGx1 && colWidthAt(gx) > 0) {
      W = Math.min(colWidthAt(gx), limits.maxW);
    } else {
      let used = 0;
      for (let g = Math.min(rGx0, gx); g <= Math.max(rGx1, gx); g++)
        if (g !== gx) used += colWidthAt(g) || (g >= rGx0 && g <= rGx1 ? 30 : 0);
      const remain = limits.layW * 10 - used;
      if (remain < STD.W * 2) {
        if (remain <= limits.maxW) W = Math.max(30, remain); // последний — заполняет остаток
        else {
          const half = Math.round((remain / 2) * 10) / 10;
          if (half <= limits.maxW && half >= 30) {
            splitX = [half, Math.round((remain - half) * 10) / 10];
            W = splitX[0];
          } else W = Math.min(STD.W, limits.maxW);
        }
      } else W = STD.W;
      W = Math.max(30, Math.min(W, limits.maxW));
    }
    let D, splitY = null;
    if (gy >= rGy0 && gy <= rGy1 && rowDepthAt(gy) > 0) {
      D = Math.min(rowDepthAt(gy), limits.maxD);
    } else {
      let used = 0;
      for (let g = Math.min(rGy0, gy); g <= Math.max(rGy1, gy); g++)
        if (g !== gy) used += rowDepthAt(g) || (g >= rGy0 && g <= rGy1 ? 30 : 0);
      const remain = limits.layD * 10 - used;
      if (remain < STD.D * 2) {
        if (remain <= limits.maxD) D = Math.max(30, remain);
        else {
          const half = Math.round((remain / 2) * 10) / 10;
          if (half <= limits.maxD && half >= 30) {
            splitY = [half, Math.round((remain - half) * 10) / 10];
            D = splitY[0];
          } else D = Math.min(STD.D, limits.maxD);
        }
      } else D = STD.D;
      D = Math.max(30, Math.min(D, limits.maxD));
    }
    return { W: Math.round(W * 10) / 10, D: Math.round(D * 10) / 10, splitX, splitY };
  };
  const canPlace = (gx, gy) => {
    const pd = plannedDims(gx, gy);
    let wSum = pd.splitX ? pd.splitX[1] : 0;
    for (let g = Math.min(rGx0, gx); g <= Math.max(rGx1, gx); g++)
      wSum += g === gx ? Math.max(colWidthAt(g), pd.W) : colWidthAt(g) || 30;
    let dSum = pd.splitY ? pd.splitY[1] : 0;
    for (let g = Math.min(rGy0, gy); g <= Math.max(rGy1, gy); g++)
      dSum += g === gy ? Math.max(rowDepthAt(g), pd.D) : rowDepthAt(g) || 30;
    return wSum <= limits.layW * 10 + 0.5 && dSum <= limits.layD * 10 + 0.5;
  };
  const gridCells = [];
  for (let gy = gy0; gy <= gy1; gy++)
    for (let gx = gx0; gx <= gx1; gx++) {
      const idx = posMap.get(`${gx},${gy}`);
      if (idx !== undefined) {
        gridCells.push(
          <button
            key={`${gx},${gy}`}
            onClick={() => { setSel(idx); setSelection(null); }}
            style={{
              width: 38, height: 34, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              border: idx === sel ? `2px solid ${ACCENT}` : "1px solid #D6DDE6",
              background: idx === sel ? "#FFF3EB" : "#fff", color: idx === sel ? ACCENT : "#3D4A5C",
            }}
          >
            №{idx + 1}
          </button>
        );
      } else {
        const adjacent =
          posMap.has(`${gx + 1},${gy}`) || posMap.has(`${gx - 1},${gy}`) ||
          posMap.has(`${gx},${gy + 1}`) || posMap.has(`${gx},${gy - 1}`);
        gridCells.push(
          adjacent && canPlace(gx, gy) ? (
            <button
              key={`${gx},${gy}`}
              onClick={() => {
                const pd = plannedDims(gx, gy);
                const fresh = [{ ...makeContainer(null, gx, gy), W: pd.W, D: pd.D }];
                if (pd.splitX) {
                  const dir = gx > rGx1 ? 1 : -1;
                  fresh.push({ ...makeContainer(null, gx + dir, gy), W: pd.splitX[1], D: pd.D });
                } else if (pd.splitY) {
                  const dir = gy > rGy1 ? 1 : -1;
                  fresh.push({ ...makeContainer(null, gx, gy + dir), W: pd.W, D: pd.splitY[1] });
                }
                setContainers((cs) => [...cs, ...fresh]);
                setSel(containers.length);
                setSelection(null);
              }}
              style={{ width: 38, height: 34, borderRadius: 8, fontSize: 15, cursor: "pointer", border: "1px dashed #A9B4C2", background: "transparent", color: "#8A97A8" }}
            >
              +
            </button>
          ) : (
            <div key={`${gx},${gy}`} style={{ width: 38, height: 34 }} />
          )
        );
      }
    }

  const WP = wpartsOf(cur);
  const WPG = wpGeom(cur);
  const wpSides = SIDES.filter((x) => wpOn(cur, x));
  const wpAnyOn = SIDES.some((x) => WP[x]);
  const updWp = (patch) => updCur({ wparts: { ...WP, ...patch } });
  const toggleSide = (side) => {
    // соединению нужна стенка потолще — подгоняем, как для замков
    const need = WPG.minWall;
    const on = !WP[side];
    if (on && cur.wallOut < need) updCur({ wparts: { ...WP, [side]: true }, wallOut: Math.max(cur.wallOut, need) });
    else updWp({ [side]: on });
  };
  const exportBase = () => {
    const { solids, c } = built.items[sel];
    exportSTL(solids.filter((b) => !b.part), `base_${c.W}x${c.D}x${c.H}.stl`);
  };
  const exportWalls = () => {
    const { solids, c } = built.items[sel];
    wpSides.forEach((side, k) =>
      setTimeout(() => {
        const sz = wpSize(c, side);
        exportSTL(wpFlatten(solids.filter((b) => b.part === `wall:${side}`), side, c), `wall_${side}_${sz.len}x${sz.hgt}x${sz.thk}.stl`);
      }, k * 400)
    );
  };

  // ── редакторы: стенка/линия и ячейка/фиксированная ячейка ──
  let editorWall = null, editorCell = null;
  if (selection?.type === "wall") {
    const key = selection.key;
    const w = getWall(cur, key);
    const isOuter = key.startsWith("o");
    editorWall = (
      <div style={{ background: "#EFF6FF", border: `1px solid ${SEL}33`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: SEL, marginBottom: 8 }}>{wallTitle(key)}</div>
        {isOuter && (() => {
          const sd = key.split(":")[1];
          const on = !!WP[sd];
          const thkS = (WP.thks && WP.thks[sd]) || WP.thk;
          return (
            <div style={{ background: "#fff", border: "1px solid #E4E9EF", borderRadius: 8, padding: "8px 9px", marginBottom: 10 }}>
              <button
                onClick={() => toggleSide(sd)}
                style={{
                  width: "100%", padding: "6px 0", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: on ? `2px solid ${ACCENT}` : "1px solid #D6DDE6",
                  background: on ? "#FFF3EB" : "#fff", color: on ? ACCENT : "#3D4A5C",
                }}
              >
                {on ? "✓ Вставная стенка" : "Сделать вставной"}
              </button>
              {on && (
                <div style={{ marginTop: 8 }}>
                  <Param
                    label="Толщина этой стенки" unit="мм" value={thkS} min={0.8} max={6} step={0.1}
                    onChange={(v) => updWp({ thks: { ...(WP.thks || {}), [sd]: v } })}
                  />
                  <Param label="Зазор" unit="мм" value={WP.clr} min={0} max={0.6} step={0.05} onChange={(v) => updWp({ clr: v })} />
                  <Param label="Наружная губка" unit="мм" value={WP.lip} min={0.6} max={4} step={0.1} onChange={(v) => updWp({ lip: v })} />
                  <Param label="Глубина посадки" unit="мм" value={WP.seat} min={2} max={Math.max(4, cur.H - 2)} step={0.5} onChange={(v) => updWp({ seat: v })} />
                  <p style={{ fontSize: 11.5, color: "#64748B", margin: 0, lineHeight: 1.4 }}>
                    {wpOn(cur, sd)
                      ? `Деталь ${wpSize(cur, sd).len} × ${wpSize(cur, sd).hgt} × ${wpSize(cur, sd).thk} мм. Высота и скругление кромки — из настроек этой стенки выше.`
                      : `Не помещается: нужна внешняя стенка от ${wpGeom(cur, sd).minWall} мм.`}
                  </p>
                </div>
              )}
            </div>
          );
        })()}
        <Param label="Высота" unit="мм" value={w.h} min={0} max={limits.maxH} step={0.5} onChange={(v) => updWall(key, { h: v })} />
        <Param label={isOuter ? "Наклон внутрь" : "Наклон в одну сторону"} unit="°" value={w.t1} min={0} max={50} step={1} onChange={(v) => updWall(key, { t1: v })} />
        {!isOuter && (
          <Param label="Наклон в другую сторону" unit="°" value={w.t2} min={0} max={50} step={1} onChange={(v) => updWall(key, { t2: v })} />
        )}
        <Param label="Скругление кромки" unit="мм" value={w.rnd} min={0} max={8} step={0.25} onChange={(v) => updWall(key, { rnd: v })} />
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
          Скругление катает верхнюю плоскость радиусом, толщина стенки не меняется. Соты работают без спуска кромки (спуск строит стенку сплошной); наклонная плоскость при сотах тоже становится сотовой панелью. Высота 0 объединяет ячейки; выше {cur.H} мм — стенка поднимется над контейнером. У внешних стенок скругляется только внутренний угол — наружная плоскость остаётся ровной для стыковки.
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
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 8px", lineHeight: 1.4 }}>
          «Зафиксировать эту ячейку» превращает её в контейнер внутри контейнера: жёсткий размер и якорь к ближайшему углу или стенке (без координат — при изменениях бокс скользит вместе со стенкой, сетка обтекает его; ряд и колонка не блокируются). Мелкие замки ниже — для настройки сетки: замок ширины держит только эту ячейку в её ряду, замок глубины — весь ряд (глубина у ряда общая, это полоса).
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
          Высота выше {cur.H} мм делает ячейку-башенку. Под поднятым полом — редкая сетка рёбер (шаг ~12 мм): она печатается со стола и служит опорой, поддержки не нужны.
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
          Это контейнер внутри контейнера: размер жёсткий, позиция — только якорь (угол или стенка), без координат. При изменении размеров контейнера бокс скользит вместе со своей стенкой, а сетка ячеек обтекает его — ряды и колонки не блокируются. Стенки бокса настраиваются кликом по ним в 3D (высота, наклон внутрь, соты/линии).
          <br /><b>Снять фиксацию</b> — ячейка остаётся на месте и становится обычной ячейкой сетки (размер сохраняется, но дальше может меняться). <b>Растворить в сетке</b> — ячейка исчезает, её место забирают соседние.
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
          Нажми <b>+</b> — пристыкуется стандартный контейнер (размером с лимит принтера по ширине и глубине); когда места в лимите остаётся меньше, чем на два стандартных, новый растягивается и заполняет остаток (а если остаток больше лимита принтера — вставятся сразу два, пополам). В существующем ряду/колонке размер подстраивается под соседей.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${gx1 - gx0 + 1}, 38px)`, gap: 4, justifyContent: "start" }}>
          {gridCells}
        </div>
        <button
          onClick={fillLayout}
          style={{
            width: "100%", marginTop: 8, padding: "8px 0", borderRadius: 8, fontSize: 13, fontWeight: 700,
            cursor: "pointer", border: `1.5px solid ${ACCENT}`, background: "#fff", color: ACCENT,
          }}
        >
          Заполнить раскладку
        </button>
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "4px 0 0", lineHeight: 1.4 }}>
          Достроит сетку контейнерами максимально доступного размера (лимит принтера), пока они влезают в лимит раскладки. Существующие контейнеры не меняются.
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
        </div>
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "6px 0 0", lineHeight: 1.4 }}>
          Магнит соседей: размер применяется сразу ко всей колонке или ряду контейнера (в сетке они держат общую ширину/глубину — иначе щели), соседние колонки прилипают и растут на освободившееся место (и наоборот). Сосед растёт максимум до лимита принтера; если расти больше некому, остаток (от 30 мм) закрывает новый контейнер. Контейнеры с замками не трогаются.
        </p>

        <SectionTitle>Лимит раскладки</SectionTitle>
        <Param label="Раскладка по X" unit="см" value={limits.layW} min={5} max={2000} step={1} onChange={(v) => updLimits({ layW: Math.round(v) })} />
        <Param label="Раскладка по Y" unit="см" value={limits.layD} min={5} max={2000} step={1} onChange={(v) => updLimits({ layD: Math.round(v) })} />
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-2px 0 0", lineHeight: 1.45 }}>
          Лимит любой, задаётся в сантиметрах и вмещает контейнеры по внешней стороне. Сборка сейчас: {(built.totalW / 10).toFixed(1)}×{(built.totalD / 10).toFixed(1)} см из {limits.layW}×{limits.layD} см.
        </p>

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

        {tab === "printer" && (<div>
        <SectionTitle>Лимиты принтера</SectionTitle>
        <Param label="Макс. ширина" unit="мм" value={limits.maxW} min={50} max={500} step={1} onChange={(v) => updLimits({ maxW: v })} />
        <Param label="Макс. глубина" unit="мм" value={limits.maxD} min={50} max={500} step={1} onChange={(v) => updLimits({ maxD: v })} />
        <Param label="Макс. высота" unit="мм" value={limits.maxH} min={30} max={500} step={1} onChange={(v) => updLimits({ maxH: v })} />
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-2px 0 0", lineHeight: 1.45 }}>
          Лимиты действуют на ОДИН контейнер по его внешним габаритам (и на высоту стенок). По умолчанию — чуть меньше стола Bambu A1 mini (180×180×180 мм), с запасом под юбку. Нужно больше места — пристыкуй ещё один контейнер во вкладке «Раскладка».
        </p>

        <SectionTitle>Зазор соединителей</SectionTitle>
        <Param
          label="Зазор на сторону" unit="мм" value={limits.connClr ?? DEFAULT_CLR}
          min={0.05} max={0.5} step={0.05}
          onChange={(v) => updLimits({ connClr: Math.round(v * 100) / 100 })}
        />
        <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-2px 0 0", lineHeight: 1.45 }}>
          Щель между рельсом «ласточкиного хвоста» и пазом соседа, на сторону (общий зазор вдвое больше). Для FDM: <b>0,1 мм</b> — жёсткая посадка, детали приходится вдавливать; <b>0,2 мм</b> — плотно, но собирается руками (по умолчанию); <b>0,3–0,4 мм</b> — свободно, для PETG и крупных деталей. Точное значение зависит от принтера — напечатайте пару контейнеров и проверьте. Минимальная внешняя стенка при этом зазоре: {CG.minWall} мм.
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
          Сохраняется вся работа: контейнеры, раскладка, ячейки, стенки, фиксации и лимиты — одним файлом .json. Его можно перенести на другой компьютер или хранить как версию; «Открыть проект» заменяет текущую работу содержимым файла.
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
        {wpSides.length > 0 && (
          <>
            <button
              onClick={exportBase}
              style={{ width: "100%", marginTop: 8, padding: "10px 0", background: "#fff", color: "#16202E", border: "1.5px solid #16202E", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              Скачать базу (дно + стойки)
            </button>
            <button
              onClick={exportWalls}
              style={{ width: "100%", marginTop: 8, padding: "10px 0", background: "#fff", color: "#16202E", border: "1.5px solid #D6DDE6", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              Скачать вставные стенки ({wpSides.length} файла)
            </button>
          </>
        )}
        {INS.dir !== "none" && insertSlots(cur, INS.dir).length > 0 && (
          <button
            onClick={exportInsert}
            style={{ width: "100%", marginTop: 8, padding: "10px 0", background: "#fff", color: "#16202E", border: "1.5px solid #D6DDE6", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Скачать вставную перегородку — {insertSize(cur, INS.dir).len} × {insertSize(cur, INS.dir).hgt} мм
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
            Габарит зафиксирован намертво: он не меняется ни от размеров ячеек (они перераспределяются внутри), ни магнитом соседей. Ячейки, перегородки и сетку внутри менять можно.
          </p>
        )}
        <Param label="Ширина" unit="мм" value={cur.W} min={30} max={limits.maxW} step={1} disabled={cur.lockOuter || (cur.lockCell && cur.gridMode !== "size")} onChange={(v) => applyOuterDim({ W: v })} />
        <Param label="Глубина" unit="мм" value={cur.D} min={30} max={limits.maxD} step={1} disabled={cur.lockOuter || (cur.lockCell && cur.gridMode !== "size")} onChange={(v) => applyOuterDim({ D: v })} />
        <Param label="Высота" unit="мм" value={cur.H} min={10} max={limits.maxH} step={1} disabled={cur.lockOuter} onChange={(v) => updCur({ H: v })} />
        {cur.lockCell && (
          <p style={{ fontSize: 11.5, color: "#64748B", margin: "-4px 0 8px", lineHeight: 1.4 }}>
            Ячейка зафиксирована по внутренним размерам: при изменении сетки и стенок контейнер подстраивается сам. Если новый размер не влезает в лимит принтера — изменение не применится.
          </p>
        )}

        </Collapse>

        <Collapse title="Толщина стенок и дна" open={openSecs.cells} onToggle={() => toggleSec("cells")}>
        <Param
          label="Внешние стенки" unit="мм" value={cur.wallOut}
          min={Math.max(connect ? CG.minWall : 0.8, wpAnyOn ? WPG.minWall : 0)} max={8} step={0.1}
          disabled={cur.lockOuter && cur.lockCell}
          onChange={(v) => applyParam({ wallOut: Math.max(v, connect ? CG.minWall : 0.8, wpAnyOn ? WPG.minWall : 0) })}
        />
        {connect && (
          cur.wallOut < CG.minWall - 0.001 ? (
            <p style={{ fontSize: 11.5, color: "#B45309", margin: "-6px 0 10px", lineHeight: 1.4 }}>
              ⚠ Для замка нужна стенка от {CG.minWall} мм — сейчас {cur.wallOut} мм. Паз ужат, а если и так не помещается, замок на этом контейнере не ставится: стенка важнее.
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
          Наружные вертикальные углы. Должно быть заметно больше скругления кромки, иначе у самого верха радиус угла обнуляется и угол вырождается в остриё.
        </p>

        </Collapse>

        <Collapse title="Деление на ячейки" open={openSecs.grid} onToggle={() => toggleSec("grid")}>
        <Stepper label="Колонки" value={cur.cols} min={1} max={8} disabled={cur.lockOuter && cur.lockCell} onChange={(v) => applyParam({ cols: v })} />
        <Stepper label="Ряды" value={cur.rows} min={1} max={8} disabled={cur.lockOuter && cur.lockCell} onChange={(v) => applyParam({ rows: v })} />
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

        <Collapse title="Вставные стенки контейнера" open={openSecs.wparts} onToggle={() => toggleSec("wparts")}>
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 10px", lineHeight: 1.45 }}>
          В основании по линии стенки идёт канавка из двух губок, а сама стенка печатается отдельной плоской деталью и вставляется в неё сверху. Включается по каждой стороне отдельно.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
          {SIDES.map((sd) => (
            <button
              key={sd}
              onClick={() => toggleSide(sd)}
              style={{
                padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: WP[sd] ? `2px solid ${ACCENT}` : "1px solid #D6DDE6",
                background: WP[sd] ? "#FFF3EB" : "#fff", color: WP[sd] ? ACCENT : "#3D4A5C",
              }}
            >
              {WP[sd] ? "✓ " : ""}{SIDE_NAME[sd]}
            </button>
          ))}
        </div>
        {wpAnyOn && (
          <>
            <Param label="Толщина стенки" unit="мм" value={WP.thk} min={0.8} max={6} step={0.1} onChange={(v) => updWp({ thk: v })} />
            <Param label="Зазор" unit="мм" value={WP.clr} min={0} max={0.6} step={0.05} onChange={(v) => updWp({ clr: v })} />
            <Param label="Наружная губка" unit="мм" value={WP.lip} min={0.6} max={4} step={0.1} onChange={(v) => updWp({ lip: v })} />
            <Param label="Глубина посадки" unit="мм" value={WP.seat} min={2} max={Math.max(4, cur.H - 2)} step={0.5} onChange={(v) => updWp({ seat: v })} />
            {wpSides.length > 0 ? (
              <>
                <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 6px", lineHeight: 1.45 }}>
                  Детали: база + {wpSides.length} шт.{" "}
                  {wpSides.map((sd) => `${SIDE_NAME[sd].toLowerCase()} ${wpSize(cur, sd).len}×${wpSize(cur, sd).hgt}`).join(", ")} мм,
                  толщина {WP.thk} мм, печатаются плашмя. Зазор {WP.clr} мм на сторону. Скачать — на вкладке «Принтер».
                </p>
                <p style={{ fontSize: 11.5, color: "#B45309", margin: 0, lineHeight: 1.45 }}>
                  ⚠ Вставная стенка утоплена на {WP.lip} мм: на этих сторонах контейнеры не сомкнутся вплотную, поэтому замок соединителя там не ставится.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 11.5, color: "#B45309", margin: 0, lineHeight: 1.45 }}>
                ⚠ Соединение не помещается: нужна внешняя стенка от {WPG.minWall} мм и высота больше посадки. Пока стенки печатаются целиком.
              </p>
            )}
          </>
        )}
        </Collapse>

        <Collapse title="Вставные перегородки" open={openSecs.inserts} onToggle={() => toggleSec("inserts")}>
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 10px", lineHeight: 1.45 }}>
          На внутренних гранях печатаются направляющие, а сами перегородки печатаются отдельной деталью и вдвигаются сверху — их можно переставлять и убирать. Зазор по умолчанию 0,2 мм на сторону.
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
          const slots = insertSlots(cur, INS.dir);
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
              {crossing && (
                <p style={{ fontSize: 11.5, color: "#B45309", margin: "8px 0 0", lineHeight: 1.45 }}>
                  ⚠ Печатные перегородки идут поперёк вставок — вставка не пройдёт от стенки до стенки.
                  Поставьте {INS.dir === "x" ? "«Ряды»" : "«Колонки»"} = 1 в «Делении на ячейки».
                </p>
              )}
              {slots.length === 0 && (
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
