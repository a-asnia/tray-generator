// ══════════════════════════════════════════════════════════════
// UI: базовые элементы панели (слайдер с полем, счётчик, секции)
// ══════════════════════════════════════════════════════════════

import { useState } from "react";
import { MONO, ACCENT } from "./theme.js";

export function Param({ label, unit, value, min, max, step, onChange, disabled }) {
  const [draft, setDraft] = useState(null);
  const commit = (raw) => {
    const v = parseFloat(raw);
    if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
    setDraft(null);
  };
  return (
    <div style={{ marginBottom: 12, opacity: disabled ? 0.45 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <label style={{ fontSize: 13, color: "#3D4A5C", fontWeight: 500 }}>{label}{disabled ? " 🔒" : ""}</label>
        <span style={{ fontFamily: MONO, fontSize: 13, color: "#16202E", whiteSpace: "nowrap" }}>
          <input
            type="number" value={draft ?? value} min={min} max={max} step={step} disabled={!!disabled}
            onChange={(e) => {
              // не зажимаем на каждой клавише — иначе нельзя набрать «40» при минимуме 5
              setDraft(e.target.value);
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v >= min && v <= max) onChange(v);
            }}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(e.target.value); }}
            style={{
              width: 58, textAlign: "right", border: "1px solid #D6DDE6", borderRadius: 6,
              padding: "1px 5px", fontFamily: "inherit", fontSize: 13,
              background: disabled ? "#F1F5F9" : "#fff", outline: "none",
            }}
          />
          <span style={{ marginLeft: 4, color: "#8A97A8", fontSize: 12 }}>{unit}</span>
        </span>
      </div>
      <input
        type="range" value={value} min={min} max={max} step={step} disabled={!!disabled}
        onChange={(e) => { setDraft(null); onChange(parseFloat(e.target.value)); }}
        style={{ width: "100%", accentColor: ACCENT, height: 4, cursor: disabled ? "default" : "pointer" }}
      />
    </div>
  );
}

// счётчик с плюсом и минусом (колонки и ряды)
export function Stepper({ label, value, min, max, onChange, disabled }) {
  const btn = (d, t) => (
    <button
      onClick={() => !disabled && onChange(Math.min(max, Math.max(min, value + d)))}
      disabled={!!disabled}
      style={{
        width: 30, height: 28, borderRadius: 7, border: "1px solid #D6DDE6",
        background: disabled ? "#F1F5F9" : "#fff", fontSize: 16, fontWeight: 700,
        color: "#3D4A5C", cursor: disabled ? "default" : "pointer", lineHeight: 1,
      }}
    >
      {t}
    </button>
  );
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, opacity: disabled ? 0.45 : 1 }}>
      <label style={{ fontSize: 13, color: "#3D4A5C", fontWeight: 500 }}>{label}{disabled ? " 🔒" : ""}</label>
      <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {btn(-1, "−")}
        <span style={{ fontFamily: MONO, fontSize: 14, minWidth: 18, textAlign: "center" }}>{value}</span>
        {btn(1, "+")}
      </span>
    </div>
  );
}

// сворачиваемая секция настроек
export function Collapse({ title, open, onToggle, children }) {
  return (
    <div style={{ border: "1px solid #E4E9EF", borderRadius: 10, marginBottom: 8, background: "#fff" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "9px 12px", background: "transparent", border: "none", cursor: "pointer",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#5A6B80",
        }}
      >
        <span>{title}</span>
        <span style={{ color: "#A9B4C2", fontSize: 13 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={{ padding: "2px 12px 10px" }}>{children}</div>}
    </div>
  );
}

export const SectionTitle = ({ children }) => (
  <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8A97A8", fontWeight: 600, margin: "16px 0 8px" }}>
    {children}
  </div>
);
