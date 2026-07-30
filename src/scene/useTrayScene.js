// ══════════════════════════════════════════════════════════════
// 3D-сцена (three.js): орбитальная камера, рендер контейнеров,
// выбор стенок/ячеек кликом (рейкаст → тег треугольника)
// ══════════════════════════════════════════════════════════════

import { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { layout, lineOf, cellKeys } from "../model/layout.js";

export function useTrayScene({ built, selection, sel, cur, limits, containers, selMode, setSel, setSelection }) {
  // актуальное состояние для пикинга кликом (эффект сцены создаётся один раз)
  const pickRef = useRef({});
  pickRef.current = { containers, sel, selMode, setSel, setSelection };

  const mountRef = useRef(null);
  const groupRef = useRef(null);
  const cameraRef = useRef(null);
  // Материалы создаются один раз и переиспользуются. Если создавать их
  // заново на каждую перестройку, three.js каждый раз компилирует и
  // линкует шейдерную программу — это самая дорогая операция при
  // изменении параметра (десятки миллисекунд на пустом месте).
  const matsRef = useRef(null);
  // меши по индексу контейнера: пересобираются только те, чья геометрия
  // или подсветка изменилась
  const meshRef = useRef(new Map());
  const frameRef = useRef(null);
  const orbitRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 3.2, radius: 320, dragging: false, lastX: 0, lastY: 0 });

  const applyCamera = useCallback(() => {
    const cam = cameraRef.current, o = orbitRef.current;
    if (!cam) return;
    const y = o.radius * Math.cos(o.phi);
    const r = o.radius * Math.sin(o.phi);
    cam.position.set(r * Math.sin(o.theta), y + 15, r * Math.cos(o.theta));
    cam.lookAt(0, 12, 0);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f5);
    const camera = new THREE.PerspectiveCamera(40, mount.clientWidth / mount.clientHeight, 1, 3000);
    cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(140, 220, 90);
    scene.add(dir);
    const grid = new THREE.GridHelper(500, 50, 0xc3ccd8, 0xd9e0e9);
    grid.position.y = -0.05;
    scene.add(grid);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshBasicMaterial({ color: 0xe4e9ef }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.1;
    scene.add(plate);

    const group = new THREE.Group();
    groupRef.current = group;
    scene.add(group);
    const body = (color, opacity) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, flatShading: true, transparent: opacity < 1, opacity });
    matsRef.current = {
      sel: body(0xf2620f, 1),          // выбранный контейнер
      other: body(0xf5a06a, 0.92),     // остальные — полупрозрачные
      hi: body(0x2563eb, 1),           // выбранная стенка/ячейка
      frame: new THREE.LineBasicMaterial({ color: 0x8a97a8 }), // рамка лимита
    };
    applyCamera();

    let raf;
    const loop = () => { renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();

    const onDown = (e) => { const o = orbitRef.current; o.dragging = true; o.moved = 0; o.lastX = e.clientX; o.lastY = e.clientY; };
    const onMove = (e) => {
      const o = orbitRef.current;
      if (!o.dragging) return;
      o.moved = (o.moved || 0) + Math.abs(e.clientX - o.lastX) + Math.abs(e.clientY - o.lastY);
      o.theta -= (e.clientX - o.lastX) * 0.008;
      o.phi = Math.min(Math.PI / 2.05, Math.max(0.25, o.phi - (e.clientY - o.lastY) * 0.008));
      o.lastX = e.clientX; o.lastY = e.clientY;
      applyCamera();
    };
    const onUp = () => { orbitRef.current.dragging = false; };
    const onWheel = (e) => {
      e.preventDefault();
      const o = orbitRef.current;
      o.radius = Math.min(1200, Math.max(90, o.radius * (1 + e.deltaY * 0.001)));
      applyCamera();
    };
    // выбор элементов кликом прямо на превью: рейкаст → тег треугольника
    const raycaster = new THREE.Raycaster();
    const onClickPick = (e) => {
      if ((orbitRef.current.moved || 0) > 5) return; // это было вращение
      const rect = renderer.domElement.getBoundingClientRect();
      const m = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(m, camera);
      const hits = raycaster.intersectObjects(group.children, false);
      const st = pickRef.current;
      if (!hits.length) { st.setSelection(null); return; }
      const hit = hits[0];
      const ud = hit.object.userData;
      if (!ud || !ud.tags) return;
      const tag = ud.tags[hit.faceIndex];
      const cont = st.containers[ud.cIdx];
      if (!cont) return;
      if (ud.cIdx !== st.sel) st.setSel(ud.cIdx);
      if (tag === "conn") { st.setSelection(null); return; }
      // фиксированные ячейки: пол выбирает бокс, стенки — обычный редактор стенки
      if (tag.startsWith("fx:")) { st.setSelection({ type: "fixed", k: +tag.split(":")[1] }); return; }
      if (tag.startsWith("fw:")) { st.setSelection({ type: "wall", key: tag }); return; }
      if (tag === "floor") {
        const Lc = layout(cont);
        const lx = hit.point.x - ud.ox, lz = hit.point.z - ud.oz;
        let ci = -1, cj = -1;
        // сначала ряд, затем ячейка в нём — у рядов свои перегородки
        for (let j = 0; j < Lc.nRows; j++)
          if (lz >= Lc.cz0(j) - cont.wall && lz <= Lc.cz0(j) + Lc.cd(j) + cont.wall) { cj = j; break; }
        if (cj >= 0)
          for (let i = 0; i < Lc.nColsAt(cj); i++)
            if (lx >= Lc.cx0(i, cj) - cont.wall && lx <= Lc.cx0(i, cj) + Lc.cw(i, cj) + cont.wall) { ci = i; break; }
        st.setSelection(ci >= 0 && cj >= 0 ? { type: "cell", i: ci, j: cj } : null);
        return;
      }
      if (st.selMode === "line") st.setSelection({ type: "line", src: tag, ...lineOf(cont, tag) });
      else st.setSelection({ type: "wall", key: tag });
    };

    const el = renderer.domElement;
    el.style.touchAction = "none";
    el.addEventListener("click", onClickPick);
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("click", onClickPick);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      for (const e of meshRef.current.values()) for (const m of e.meshes) m.geometry.dispose();
      meshRef.current.clear();
      frameRef.current?.geometry.dispose();
      frameRef.current = null;
      for (const m of Object.values(matsRef.current || {})) m.dispose();
      matsRef.current = null;
      renderer.dispose();
      mount.removeChild(el);
    };
  }, [applyCamera]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const mats = matsRef.current;
    if (!mats) return;
    const selKeys = new Set();
    if (selection?.type === "wall") selKeys.add(selection.key);
    if (selection?.type === "line") selection.keys.forEach((k) => selKeys.add(k));
    if (selection?.type === "cell") cellKeys(cur, selection.i, selection.j).forEach((k) => selKeys.add(k.key));
    if (selection?.type === "fixed") {
      selKeys.add(`fx:${selection.k}`);
      for (const s of ["n", "s", "w", "e"]) selKeys.add(`fw:${selection.k}:${s}`);
    }
    // подпись подсветки: она делит тела контейнера на два меша, поэтому при
    // её изменении буферы этого контейнера нужно пересобрать
    const hiSig = [...selKeys].sort().join(",");

    const cache = meshRef.current;
    built.items.forEach(({ solids, ox, oz }, idx) => {
      const sig = idx === sel ? hiSig : "";
      let e = cache.get(idx);
      if (!e || e.solids !== solids || e.sig !== sig) {
        // геометрия действительно изменилась — собираем буферы заново
        if (e) for (const m of e.meshes) { m.geometry.dispose(); group.remove(m); }
        const base = [], hi = [], baseTags = [], hiTags = [];
        for (const s of solids) {
          const isHi = idx === sel && selKeys.has(s.tag);
          const arr = isHi ? hi : base;
          const tagArr = isHi ? hiTags : baseTags;
          for (const [a, b, c] of s.tris) { arr.push(...a, ...b, ...c); tagArr.push(s.tag); }
        }
        const meshes = [];
        const addMesh = (arr, mat, tags) => {
          if (!arr.length) return;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo, mat);
          mesh.userData = { tags, cIdx: idx, ox, oz };
          meshes.push(mesh);
          group.add(mesh);
        };
        addMesh(base, idx === sel ? mats.sel : mats.other, baseTags);
        addMesh(hi, mats.hi, hiTags);
        e = { solids, sig, meshes };
        cache.set(idx, e);
      }
      // без пересборки: подвинуть и, если сменился выбранный контейнер,
      // переключить материал корпуса — шейдеры при этом не перекомпилируются
      for (const m of e.meshes) {
        m.position.set(ox, 0, oz);
        m.userData.ox = ox; m.userData.oz = oz;
        if (m.material !== mats.hi) m.material = idx === sel ? mats.sel : mats.other;
      }
    });
    // контейнеры, которых больше нет
    for (const [idx, e] of cache)
      if (idx >= built.items.length) {
        for (const m of e.meshes) { m.geometry.dispose(); group.remove(m); }
        cache.delete(idx);
      }

    // рамка лимита раскладки на столе — видно, как сборка «липнет» к краям
    const bw = limits.layW * 10, bd = limits.layD * 10;
    if (!frameRef.current) {
      const bGeo = new THREE.BufferGeometry();
      bGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
      const bLine = new THREE.LineLoop(bGeo, mats.frame);
      bLine.userData = {};
      bLine.raycast = () => {}; // рамка не должна перехватывать клики выбора
      frameRef.current = bLine;
      group.add(bLine);
    }
    const pos = frameRef.current.geometry.getAttribute("position");
    pos.copyArray([
      -bw / 2, 0.08, -bd / 2, bw / 2, 0.08, -bd / 2,
      bw / 2, 0.08, bd / 2, -bw / 2, 0.08, bd / 2,
    ]);
    pos.needsUpdate = true;
    frameRef.current.geometry.computeBoundingSphere();
  }, [built, selection, sel, cur, limits]);

  return mountRef;
}
