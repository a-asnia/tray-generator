// ══════════════════════════════════════════════════════════════
// Приложение: панель с вкладками (Модель / Принтер / Раскладка),
// редакторы стенок и ячеек, экспорт STL, автосохранение
// ══════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useMemo } from "react";
import { exportSTL, exportSTLIndexed, weldTris, solidsVolume } from "./geometry/stl.js";
import { getManifold } from "./geometry/manifold.js";
import { CONN, connectorVs } from "./model/connectors.js";
import { layout, defWall, getWall, getCellLvl, lineOf, cellKeys, endLabels, wallTitle, minOuterDim, fitSizes } from "./model/layout.js";
import { buildContainer } from "./model/build.js";
import { makeContainer, SAVED, setNextId } from "./state/storage.js";
import { useTrayScene } from "./scene/useTrayScene.js";
import { MONO, ACCENT, SEL } from "./ui/theme.js";
import { Param, Stepper, Collapse, SectionTitle } from "./ui/controls.jsx";
import { Schematic } from "./ui/Schematic.jsx";

export default function TrayGenerator() {
  const [containers, setContainers] = useState(() => (SAVED ? SAVED.containers : [{ ...makeContainer(null, 0, 0), id: 1 }]));
  const [sel, setSel] = useState(0);
  const [selection, setSelection] = useState(null);
  const [selMode, setSelMode] = useState("seg"); // 'seg' | 'line'
  const [connect, setConnect] = useState(SAVED ? SAVED.connect !== false : true);
  // по умолчанию — чуть меньше стола Bambu A1 mini (180×180×180), запас под юбку
  const [limits, setLimits] = useState(SAVED?.limits ?? { maxW: 170, maxD: 170, maxH: 175, layW: 100, layD: 100 });
  const [tab, setTab] = useState("model");
  const [openSecs, setOpenSecs] = useState(SAVED?.openSecs ?? { outer: true, cells: true, walls: true, export: true });
  const toggleSec = (k) => setOpenSecs((o) => ({ ...o, [k]: !o[k] }));

  // автосохранение при каждом изменении
  useEffect(() => {
    try {
      window.localStorage.setItem("trayGenState", JSON.stringify({ containers, limits, connect, openSecs }));
    } catch (e) {}
  }, [containers, limits, connect, openSecs]);

  const cur = containers[sel];

  const updLimits = (patch) => {
    const nl = { ...limits, ...patch };
    // габариты и высоты стенок не могут превышать лимиты принтера
    setContainers((cs) =>
      cs.map((c) => ({
        ...c,
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
    // смена деления на ячейки снимает замки колонок/рядов по этой оси:
    // явные размеры относятся к конкретной сетке
    if (patch.cols !== undefined || patch.cellWt !== undefined || patch.gridMode !== undefined)
      patch = { colWs: null, lockedCols: {}, ...patch };
    if (patch.rows !== undefined || patch.cellDt !== undefined || patch.gridMode !== undefined)
      patch = { rowDs: null, lockedRows: {}, ...patch };
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

  // Магнит соседей: сборка сохраняет общий габарит. Ужал контейнер на
  // 20 мм — соседние колонки/ряды выросли ровно на 20 мм (и наоборот),
  // чтобы всё осталось прижатым друг к другу. Ограничения: лимит принтера
  // сверху, замки соседа снизу — его зафиксированные ячейки не меняются,
  // рост и ужатие впитывают только свободные.
  const applyOuterDim = (patch) => {
    const isW = "W" in patch;
    const axis = isW ? "W" : "D";
    const gKey = isW ? "gx" : "gy";
    const maxAxis = isW ? limits.maxW : limits.maxD;
    // не даём ужать контейнер ниже суммы его зафиксированных колонок/рядов
    patch = { [axis]: Math.max(patch[axis], minOuterDim(cur, axis)) };
    const myG = cur[gKey];
    const myId = cur.id;
    setContainers((cs) => {
      const widthIn = (arr, g) => Math.max(30, ...arr.filter((c) => c[gKey] === g).map((c) => c[axis]));
      const myBefore = widthIn(cs, myG);
      const next = cs.map((c) => (c.id === myId ? { ...c, ...patch } : c));
      if (next.length < 2) return next;
      let delta = myBefore - widthIn(next, myG); // >0 — место освободилось, соседи растут
      if (Math.abs(delta) < 0.05) return next;
      const groupOf = (g) => next.filter((c) => c[gKey] === g);
      const adjustable = [...new Set(next.map((c) => c[gKey]))].filter(
        (g) => g !== myG && groupOf(g).every((c) => !c.lockOuter && !c.lockCell)
      );
      if (!adjustable.length) return next;
      const minOf = (g) => Math.max(...groupOf(g).map((c) => minOuterDim(c, axis)));
      const targets = new Map(adjustable.map((g) => [g, widthIn(next, g)]));
      for (let pass = 0; pass < 3 && Math.abs(delta) > 0.05; pass++) {
        const open = adjustable.filter((g) =>
          delta > 0 ? targets.get(g) < maxAxis - 0.01 : targets.get(g) > minOf(g) + 0.01
        );
        if (!open.length) break;
        const share = delta / open.length;
        for (const g of open) {
          const t0 = targets.get(g);
          const t = Math.max(minOf(g), Math.min(maxAxis, Math.round((t0 + share) * 10) / 10));
          delta -= t - t0;
          targets.set(g, t);
        }
      }
      return next.map((c) =>
        c[gKey] !== myG && targets.has(c[gKey]) && !c.lockOuter && !c.lockCell &&
        Math.abs(targets.get(c[gKey]) - c[axis]) > 0.01
          ? { ...c, [axis]: targets.get(c[gKey]) }
          : c
      );
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
    setLimits({ maxW: 170, maxD: 170, maxH: 175, layW: 100, layD: 100 });
    setOpenSecs({ outer: true, cells: true, walls: true, export: true });
    setTab("model");
  };

  const toggleLockOuter = () => updCur({ lockOuter: !cur.lockOuter });
  const toggleLockCell = () => {
    if (cur.lockCell) updCur({ lockCell: false });
    else if (cur.gridMode === "size") {
      // в режиме «размер ячейки» фиксируем именно целевые размеры
      updCur({ lockCell: true, cellW0: cur.cellWt, cellD0: cur.cellDt });
    } else {
      const Lc = layout(cur);
      updCur({ lockCell: true, cellW0: Lc.cellW, cellD0: Lc.cellD });
    }
  };

  // переключение режима деления без потери сетки: количество ячеек
  // переносится; при активном замке ячейки контейнер подгоняется так,
  // чтобы размеры ячеек сохранились точно
  const switchGridMode = (m) => {
    if ((cur.gridMode || "count") === m) return;
    const Lc = layout(cur);
    if (m === "size") {
      updCur({
        gridMode: "size",
        cellWt: Math.max(15, Math.min(160, Math.round(Lc.cellW))),
        cellDt: Math.max(15, Math.min(160, Math.round(Lc.cellD))),
      });
    } else {
      const patch = { gridMode: "count", cols: Lc.nCols, rows: Lc.nRows };
      if (cur.lockCell) {
        const W2 = 2 * cur.wallOut + Lc.nCols * cur.cellW0 + (Lc.nCols - 1) * cur.wall;
        const D2 = 2 * cur.wallOut + Lc.nRows * cur.cellD0 + (Lc.nRows - 1) * cur.wall;
        if (W2 >= 30 && W2 <= limits.maxW + 0.01) patch.W = Math.round(W2 * 10) / 10;
        if (D2 >= 30 && D2 <= limits.maxD + 0.01) patch.D = Math.round(D2 * 10) / 10;
      }
      updCur(patch);
    }
  };

  // Замок колонки/ряда: текущие размеры сетки материализуются в явные
  // (colWs/rowDs) и дальше держатся точно. Снятие замка размеры НЕ
  // выравнивает — вписанные вручную остаются, просто снова могут меняться.
  const toggleColLock = (i) => {
    const Lc = layout(cur);
    const locked = { ...(cur.lockedCols || {}) };
    if (locked[i]) delete locked[i]; else locked[i] = true;
    updCur({ lockedCols: locked, colWs: Lc.colWs.slice() });
  };
  const toggleRowLock = (j) => {
    const Lc = layout(cur);
    const locked = { ...(cur.lockedRows || {}) };
    if (locked[j]) delete locked[j]; else locked[j] = true;
    updCur({ lockedRows: locked, rowDs: Lc.rowDs.slice() });
  };
  // общий замок ячейки: фиксирует/освобождает сразу оба её края
  const setCellLockBoth = (i, j, on) => {
    const Lc = layout(cur);
    const lc = { ...(cur.lockedCols || {}) }, lr = { ...(cur.lockedRows || {}) };
    if (on) { lc[i] = true; lr[j] = true; } else { delete lc[i]; delete lr[j]; }
    updCur({ lockedCols: lc, lockedRows: lr, colWs: Lc.colWs.slice(), rowDs: Lc.rowDs.slice() });
  };

  // Задать размер конкретной ячейки (её колонки/ряда) с панели: контейнер
  // растёт или ужимается на разницу, остальные ячейки не трогаются. Если
  // рост упирается в лимит принтера — недостающее добирается у свободных
  // (незамкнутых) колонок/рядов; зафиксированные не меняются никогда.
  const setCellSize = (axis, idx, v) => {
    const Lc = layout(cur);
    const col = axis === "col";
    const locked0 = (col ? cur.lockedCols : cur.lockedRows) || {};
    if (locked0[idx]) return;
    const sizes = (col ? Lc.colWs : Lc.rowDs).slice();
    const dimKey = col ? "W" : "D";
    const maxDim = col ? limits.maxW : limits.maxD;
    const wallSum = 2 * cur.wallOut + (sizes.length - 1) * cur.wall;
    // потолок: остальным ячейкам оставляем хотя бы по 10 мм
    sizes[idx] = Math.max(10, Math.min(v, maxDim - wallSum - (sizes.length - 1) * 10));
    const want = sizes.reduce((s, x) => s + x, 0) + wallSum;
    const dim2 = Math.round(Math.max(30, Math.min(want, maxDim)) * 10) / 10;
    const fitted = fitSizes(sizes, { ...locked0, [idx]: true }, dim2 - wallSum);
    updCur(col ? { colWs: fitted } : { rowDs: fitted });
    applyOuterDim({ [dimKey]: dim2 });
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

  const handleSelect = (s) => {
    if (s?.type === "wall" && selMode === "line") {
      setSelection({ type: "line", src: s.key, ...lineOf(cur, s.key) });
    } else setSelection(s);
  };

  const posMap = useMemo(() => {
    const m = new Map();
    containers.forEach((c, i) => m.set(`${c.gx},${c.gy}`, i));
    return m;
  }, [containers]);

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
      return {
        c,
        solids: buildContainer(c, conn),
        ox: colX[c.gx] - totalW / 2,
        oz: rowZ[c.gy] - totalD / 2,
      };
    });
    return { items, totalW, totalD };
  }, [containers, connect, posMap]);

  // ── three.js: сцена, камера, пикинг ──
  const mountRef = useTrayScene({ built, selection, sel, cur, limits, containers, selMode, setSel, setSelection });

  const L = layout(cur);
  const volume = useMemo(() => solidsVolume(built.items[sel]?.solids ?? []), [built, sel]);

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

  // ── редактор стенки/линии/ячейки ──
  let editor = null;
  if (selection?.type === "wall") {
    const key = selection.key;
    const w = getWall(cur, key);
    const isOuter = key.startsWith("o");
    editor = (
      <div style={{ background: "#EFF6FF", border: `1px solid ${SEL}33`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: SEL, marginBottom: 8 }}>{wallTitle(key)}</div>
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
    editor = (
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
    const colLocked = !!(cur.lockedCols || {})[selection.i];
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
    editor = (
      <div style={{ background: "#EFF6FF", border: `1px solid ${SEL}33`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: SEL, marginBottom: 8 }}>
          Ячейка {selection.i + 1}×{selection.j + 1}
        </div>
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "0 0 4px" }}>Размер этой ячейки</div>
        <Param
          label="Ширина ячейки" unit="мм" value={Math.round(Lsel.cw(selection.i) * 10) / 10}
          min={10} max={limits.maxW} step={0.5} disabled={colLocked}
          onChange={(v) => setCellSize("col", selection.i, v)}
        />
        <Param
          label="Глубина ячейки" unit="мм" value={Math.round(Lsel.cd(selection.j) * 10) / 10}
          min={10} max={limits.maxD} step={0.5} disabled={rowLocked}
          onChange={(v) => setCellSize("row", selection.j, v)}
        />
        <button
          onClick={() => setCellLockBoth(selection.i, selection.j, !(colLocked && rowLocked))}
          style={{
            width: "100%", padding: "6px 4px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
            border: colLocked && rowLocked ? `2px solid ${SEL}` : "1px solid #D6DDE6", margin: "0 0 6px",
            background: colLocked && rowLocked ? "#DBEAFE" : "#fff", color: colLocked && rowLocked ? SEL : "#3D4A5C",
          }}
        >
          {colLocked && rowLocked ? "🔒 Снять фиксацию ячейки" : "🔒 Зафиксировать эту ячейку"}
        </button>
        <div style={{ display: "flex", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
          {lockBtn(colLocked, "ширина", () => toggleColLock(selection.i))}
          {lockBtn(rowLocked, "глубина", () => toggleRowLock(selection.j))}
        </div>
        <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 8px", lineHeight: 1.4 }}>
          Впишите размер и нажмите «Зафиксировать» — края этой ячейки будут держаться точно, соседние останутся свободными. При изменении размера свободной ячейки контейнер растёт или ужимается на разницу; если рост упирается в лимит принтера, недостающее забирается у свободных ячеек. Ячейки стоят сеткой, поэтому ширина фиксируется у всей колонки, а глубина — у всего ряда (иначе перегородки разъедутся). Изменение числа ячеек снимает замки и вписанные размеры.
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
                    onClick={() => updCell(selection.i, selection.j, { tiltDir: d })}
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
          {[["model", "Модель"], ["printer", "Принтер"], ["layout", "Раскладка"]].map(([t, n]) => (
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
                if (on) setContainers((cs) => cs.map((c) => ({ ...c, wallOut: Math.max(c.wallOut, CONN.minWall) })));
              }}
              style={{ accentColor: ACCENT }}
            />
            Соединители
          </label>
        </div>

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
        </div>)}

        {tab === "model" && (<div>
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
          min={connect ? CONN.minWall : 0.8} max={6} step={0.1}
          disabled={cur.lockOuter && cur.lockCell}
          onChange={(v) => applyParam({ wallOut: connect ? Math.max(v, CONN.minWall) : v })}
        />
        {connect && (
          <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-6px 0 10px", lineHeight: 1.4 }}>
            Минимум {CONN.minWall} мм — паз соединителя прячется внутри стенки.
          </p>
        )}
        <Param label="Перегородки" unit="мм" value={cur.wall} min={0.8} max={5} step={0.1} disabled={cur.lockOuter && cur.lockCell} onChange={(v) => applyParam({ wall: v })} />
        <Param label="Толщина дна" unit="мм" value={cur.floor} min={0.8} max={5} step={0.1} onChange={(v) => updCur({ floor: v })} />

        </Collapse>

        <Collapse title="Редактор стенок" open={openSecs.walls} onToggle={() => toggleSec("walls")}>
        <button
          onClick={toggleLockCell}
          style={{
            width: "100%", padding: "6px 4px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
            border: cur.lockCell ? `2px solid ${SEL}` : "1px solid #D6DDE6", margin: "0 0 10px",
            background: cur.lockCell ? "#DBEAFE" : "#fff", color: cur.lockCell ? SEL : "#3D4A5C",
          }}
        >
          {cur.lockCell ? "🔒" : "🔓"} Зафиксировать ячейку{cur.lockCell ? ` (${cur.cellW0.toFixed(1)}×${cur.cellD0.toFixed(1)} мм)` : ""}
        </button>
        <div style={{ fontSize: 12, color: "#3D4A5C", fontWeight: 600, margin: "0 0 4px" }}>Деление на ячейки</div>
        <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
          {[["count", "Количество"], ["size", "Размер ячейки"]].map(([m, t]) => (
            <button
              key={m}
              onClick={() => switchGridMode(m)}
              style={{
                flex: 1, padding: "5px 4px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: (cur.gridMode || "count") === m ? `2px solid ${SEL}` : "1px solid #D6DDE6",
                background: (cur.gridMode || "count") === m ? "#DBEAFE" : "#fff",
                color: (cur.gridMode || "count") === m ? SEL : "#3D4A5C",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {cur.gridMode === "size" ? (
          <div>
            <Param label="Ячейка по ширине" unit="мм" value={cur.cellWt} min={15} max={160} step={1} disabled={cur.lockCell} onChange={(v) => updCur({ cellWt: v })} />
            <Param label="Ячейка по глубине" unit="мм" value={cur.cellDt} min={15} max={160} step={1} disabled={cur.lockCell} onChange={(v) => updCur({ cellDt: v })} />
            <p style={{ fontSize: 11.5, color: "#8A97A8", margin: "-4px 0 10px", lineHeight: 1.45 }}>
              Контейнер заполняется ячейками этого внутреннего размера; последняя в каждом направлении забирает остаток (от одного до двух размеров). Сейчас: {layout(cur).nCols}×{layout(cur).nRows} ячеек.
            </p>
          </div>
        ) : (
          <div>
            <Stepper label="Колонки" value={cur.cols} min={1} max={8} disabled={cur.lockOuter && cur.lockCell} onChange={(v) => applyParam({ cols: v })} />
            <Stepper label="Ряды" value={cur.rows} min={1} max={8} disabled={cur.lockOuter && cur.lockCell} onChange={(v) => applyParam({ rows: v })} />
          </div>
        )}
        <p style={{ fontSize: 12, color: "#8A97A8", margin: "0 0 8px", lineHeight: 1.45 }}>
          Нажми на <b>стенку</b> или <b>ячейку</b> — на схеме или прямо на 3D-модели. Режим выбора стенки:
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
        <Schematic c={cur} selection={selection} onSelect={handleSelect} />
        {editor}
        {Object.keys(cur.walls).length > 0 && (
          <button
            onClick={() => updCur({ walls: {} })}
            style={{ marginTop: 10, padding: "6px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", border: "1px solid #D6DDE6", background: "#fff", color: "#5A6B80" }}
          >
            Сбросить все стенки контейнера №{sel + 1}
          </button>
        )}

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
            Вращение — перетаскиванием, зум — колесом
          </div>
        </div>
      </div>
    </div>
  );
}
