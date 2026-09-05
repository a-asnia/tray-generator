// ── монтирование ──
import React from "react";
import ReactDOM from "react-dom/client";
import TrayGenerator from "./App.jsx";

// Если что-то всё же сломается, показываем понятный экран с кнопкой
// сброса вместо белой страницы: состояние лежит в localStorage, и без
// сброса перезагрузка не помогла бы.
class Guard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (!this.state.err) return this.props.children;
    const reset = () => {
      try { window.localStorage.removeItem("trayGenState"); } catch (e) { /* хранилище недоступно */ }
      window.location.reload();
    };
    const box = {
      maxWidth: 520, margin: "12vh auto", padding: 24, background: "#fff",
      border: "1px solid #E4E9EF", borderRadius: 14, fontFamily: "system-ui, sans-serif", color: "#16202E",
    };
    return React.createElement("div", { style: box }, [
      React.createElement("h2", { key: "t", style: { margin: "0 0 8px", fontSize: 19 } }, "Не получилось построить проект"),
      React.createElement("p", { key: "p", style: { margin: "0 0 16px", fontSize: 14, lineHeight: 1.5, color: "#5A6B80" } },
        "Скорее всего сохранённый проект повреждён. Нажмите «Начать заново» — вернутся настройки по умолчанию. " +
        "Если у вас есть выгруженный файл проекта, после сброса его можно открыть заново на вкладке «Принтер»."),
      React.createElement("button", {
        key: "b", onClick: reset,
        style: {
          padding: "9px 16px", borderRadius: 9, border: "none", background: "#F2620F",
          color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
        },
      }, "Начать заново"),
      React.createElement("pre", {
        key: "e",
        style: { marginTop: 18, fontSize: 11, color: "#8A97A8", whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto" },
      }, String(this.state.err?.stack || this.state.err)),
    ]);
  }
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(Guard, null, React.createElement(TrayGenerator)));
