// ══════════════════════════════════════════════════════════════
// STL: экспорт (мм, вертикаль — ось Z), объём, сварка вершин
// ══════════════════════════════════════════════════════════════

import { sub, cross, dot } from "./vec.js";

export function exportSTL(solids, filename) {
  const tris = solids.flatMap((s) => s.tris);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  const put = (p) => {
    dv.setFloat32(o, p[0], true);
    dv.setFloat32(o + 4, p[2], true);
    dv.setFloat32(o + 8, p[1], true);
    o += 12;
  };
  for (const [a, b, c] of tris) {
    const n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    put([n[0] / l, n[1] / l, n[2] / l]);
    put(a); put(c); put(b);
    dv.setUint16(o, 0, true); o += 2;
  }
  const blob = new Blob([buf], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function solidsVolume(solids) {
  let v = 0;
  for (const s of solids) for (const [a, b, c] of s.tris) v += dot(a, cross(b, c)) / 6;
  return v / 1000;
}

// ── Цельное тело: сварка вершин + булево объединение через Manifold ──
export function weldTris(tris) {
  const map = new Map();
  const vp = [], tv = [];
  const idx = (p) => {
    const k = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
    let i = map.get(k);
    if (i === undefined) { i = vp.length / 3; map.set(k, i); vp.push(p[0], p[1], p[2]); }
    return i;
  };
  for (const [a, b, c] of tris) {
    const ia = idx(a), ib = idx(b), ic = idx(c);
    if (ia !== ib && ib !== ic && ia !== ic) tv.push(ia, ib, ic);
  }
  return { vp: new Float32Array(vp), tv: new Uint32Array(tv) };
}

export function exportSTLIndexed(vp, tv, filename) {
  const nTri = tv.length / 3;
  const buf = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, nTri, true);
  let o = 84;
  const put = (x, y, z) => {
    dv.setFloat32(o, x, true); dv.setFloat32(o + 4, z, true); dv.setFloat32(o + 8, y, true);
    o += 12;
  };
  const P = (i) => [vp[3 * i], vp[3 * i + 1], vp[3 * i + 2]];
  for (let t = 0; t < nTri; t++) {
    const a = P(tv[3 * t]), b = P(tv[3 * t + 1]), c = P(tv[3 * t + 2]);
    const n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    put(n[0] / l, n[1] / l, n[2] / l);
    put(a[0], a[1], a[2]); put(c[0], c[1], c[2]); put(b[0], b[1], b[2]);
    dv.setUint16(o, 0, true); o += 2;
  }
  const blob = new Blob([buf], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
