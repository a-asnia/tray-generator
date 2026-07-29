// Плоская схема контейнера сверху: клик по стенке/ячейке выбирает её
import { layout, getWall, getCellLvl, cellKeys } from "../model/layout.js";
import { SEL } from "./theme.js";

export function Schematic({ c, selection, onSelect }) {
  const L = layout(c);
  const { W, D, wall, wallOut } = c;
  const hit = 2.2;
  const segs = [];

  const isSel = (key) =>
    selection?.type === "wall" && selection.key === key
      ? true
      : selection?.type === "line"
      ? selection.keys.includes(key)
      : selection?.type === "cell"
      ? cellKeys(c, selection.i, selection.j).some((k) => k.key === key)
      : false;

  const pushSeg = (key, x, z, sw, sd) =>
    segs.push(
      <g key={key} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSelect({ type: "wall", key }); }}>
        <rect x={x - hit} y={z - hit} width={sw + 2 * hit} height={sd + 2 * hit} fill="transparent" />
        <rect x={x} y={z} width={sw} height={sd} fill={isSel(key) ? SEL : getWall(c, key).h > 0.3 ? "#7B8AA0" : "#E2E8F0"} rx={0.4} />
      </g>
    );

  // внешние N/S — по ячейкам крайних рядов; «кирпичная» раскладка:
  // у каждого ряда свои перегородки
  for (let i = 0; i < L.nColsAt(0); i++) {
    const x0 = W / 2 + L.cx0(i, 0);
    pushSeg(`o:n:${i}`, x0, 0, L.cw(i, 0), wallOut);
  }
  for (let i = 0; i < L.nColsAt(L.nRows - 1); i++) {
    const x0 = W / 2 + L.cx0(i, L.nRows - 1);
    pushSeg(`o:s:${i}`, x0, D - wallOut, L.cw(i, L.nRows - 1), wallOut);
  }
  for (let j = 0; j < L.nRows; j++) {
    const z0 = D / 2 + L.cz0(j), z1 = z0 + L.cd(j);
    pushSeg(`o:w:${j}`, 0, z0, wallOut, z1 - z0);
    pushSeg(`o:e:${j}`, W - wallOut, z0, wallOut, z1 - z0);
  }
  for (let j = 0; j < L.nRows; j++)
    for (let i = 0; i < L.nColsAt(j) - 1; i++) {
      const xd = W / 2 + L.cx0(i, j) + L.cw(i, j);
      pushSeg(`v:${i}:${j}`, xd, D / 2 + L.cz0(j), wall, L.cd(j));
    }
  for (let j = 0; j < L.nRows - 1; j++) {
    const zd = D / 2 + L.cz0(j) + L.cd(j);
    for (let i = 0; i < L.nColsAt(j); i++) pushSeg(`h:${j}:${i}`, W / 2 + L.cx0(i, j), zd, L.cw(i, j), wall);
  }

  const cells = [];
  for (let j = 0; j < L.nRows; j++)
    for (let i = 0; i < L.nColsAt(j); i++) {
      const x0 = W / 2 + L.cx0(i, j), z0 = D / 2 + L.cz0(j);
      const selCell = selection?.type === "cell" && selection.i === i && selection.j === j;
      const lvl = getCellLvl(c, i, j);
      cells.push(
        <g key={`c${i}-${j}`} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSelect({ type: "cell", i, j }); }}>
          <rect
            x={x0} y={z0} width={L.cw(i, j)} height={L.cd(j)}
            fill={selCell ? "#DBEAFE" : lvl > 0 ? "#EAE4D8" : "#FFFFFF"} stroke={selCell ? SEL : "none"} strokeWidth={0.5}
          />
          {lvl > 0 && (
            <text x={x0 + L.cw(i, j) / 2} y={z0 + L.cd(j) / 2} textAnchor="middle" dominantBaseline="central"
              fontSize={Math.min(L.cw(i, j), L.cd(j)) * 0.3} fill="#8A7B5C">
              {lvl}
            </text>
          )}
          {(((c.lockedCellW || {})[i + ":" + j]) || ((c.lockedRows || {})[j])) && (
            <text x={x0 + 1.5} y={z0 + 1.5} dominantBaseline="hanging"
              fontSize={Math.min(L.cw(i, j), L.cd(j)) * 0.22} fill="#64748B">
              🔒
            </text>
          )}
        </g>
      );
    }

  return (
    <svg
      viewBox={`-2 -2 ${W + 4} ${D + 4}`}
      style={{ width: "100%", maxHeight: 210, background: "#F1F5F9", borderRadius: 10, border: "1px solid #E4E9EF", display: "block" }}
      onClick={() => onSelect(null)}
    >
      <rect x={0} y={0} width={W} height={D} fill="#CBD5E1" rx={1} />
      {cells}
      {segs}
    </svg>
  );
}
