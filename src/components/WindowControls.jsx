import { useEffect, useState } from "react";
import { getAppWindow, isTauri } from "../platform.js";
import { useThemed } from "../theme.js";

const WIN_GLYPHS = {
  minimize: "M19 13H5v-2h14z",
  maximize: "M4 4h16v16H4zm2 4v10h12V8z",
  restore: "M4 8h4V4h12v12h-4v4H4zm12 0v6h2V6h-8v2zM6 12v6h8v-6z",
  close: "M13.46 12L19 17.54V19h-1.46L12 13.46L6.46 19H5v-1.46L10.54 12L5 6.46V5h1.46L12 10.54L17.54 5H19v1.46z",
};

export function WindowControls() {
  const { theme } = useThemed();
  const [maximized, setMaximized] = useState(false);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten;
    let alive = true;
    (async () => {
      try {
        const w = await getAppWindow();
        if (!alive) return;
        setMaximized(await w.isMaximized());
        unlisten = await w.onResized(async () => {
          if (alive) setMaximized(await w.isMaximized());
        });
      } catch { /* Tauri API unavailable (browser dev server) */ }
    })();
    return () => { alive = false; if (unlisten) unlisten(); };
  }, []);

  if (!isTauri) return null;

  const act = async (name) => {
    try {
      const w = await getAppWindow();
      if (name === "minimize") await w.minimize();
      else if (name === "toggle") await w.toggleMaximize();
      else if (name === "close") await w.close();
    } catch { /* Tauri API unavailable (browser dev server) */ }
  };

  const btn = (id, action, title, path) => {
    const isClose = id === "close";
    const hovered = hover === id;
    return (
      <button
        key={id}
        title={title}
        onClick={() => act(action)}
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover(null)}
        style={{
          width: 46, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          border: "none", cursor: "pointer", padding: 0, transition: "background .12s",
          background: hovered ? (isClose ? "#e81123" : theme.outerBorder) : "transparent",
          color: hovered && isClose ? "#ffffff" : theme.outerText,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
          <path fill="currentColor" d={path} />
        </svg>
      </button>
    );
  };

  return (
    <div style={{ position: "absolute", top: 0, right: 0, display: "flex", alignItems: "center", zIndex: 10 }}>
      {btn("minimize", "minimize", "Minimize", WIN_GLYPHS.minimize)}
      {btn("maximize", "toggle", maximized ? "Restore" : "Maximize", maximized ? WIN_GLYPHS.restore : WIN_GLYPHS.maximize)}
      {btn("close", "close", "Close", WIN_GLYPHS.close)}
    </div>
  );
}
