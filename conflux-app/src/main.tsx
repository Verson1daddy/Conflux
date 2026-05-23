import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { FloatPanelWindowApp } from "./components/island/FloatPanelWindowApp";
import { IslandWindowApp } from "./components/island/IslandWindowApp";

import "@fontsource-variable/fraunces/index.css";
import "@fontsource/geist-sans/latin.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "./index.css";

function resolveWindowLabel(): "main" | "island" | "float_panel" {
  const hintedWindowLabel = new URLSearchParams(window.location.search).get("confluxWindow");
  if (hintedWindowLabel === "island" || hintedWindowLabel === "float_panel") {
    return hintedWindowLabel;
  }

  try {
    const label = getCurrentWindow().label;
    if (label === "island" || label === "float_panel") {
      return label;
    }
    return "main";
  } catch {
    const pathname = window.location.pathname;
    if (pathname === "/float_panel" || pathname.endsWith("/float_panel")) {
      return "float_panel";
    }
    return pathname === "/island" || pathname.endsWith("/island") ? "island" : "main";
  }
}

const savedAccent = localStorage.getItem("conflux.accentColor");
if (savedAccent) {
  document.documentElement.style.setProperty("--accent-primary", savedAccent);
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("[conflux] #root element not found in index.html");
}

const windowLabel = resolveWindowLabel();
document.documentElement.dataset.windowLabel = windowLabel;
document.body.dataset.windowLabel = windowLabel;

const RootComponent =
  windowLabel === "island"
    ? IslandWindowApp
    : windowLabel === "float_panel"
      ? FloatPanelWindowApp
      : App;

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <RootComponent />
    </React.StrictMode>
  );
} catch (err) {
  rootEl.innerHTML = `<pre style="color:#FF3B30;padding:20px;font-family:monospace;white-space:pre-wrap">${String(err)}</pre>`;
}
