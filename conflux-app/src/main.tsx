import React from "react";
import ReactDOM from "react-dom/client";

// eslint-disable-next-line no-console
console.log("[conflux] main.tsx: loading fonts...");

// Self-hosted fonts — bundled locally via @fontsource to avoid Google Fonts CDN blocks
// Explicit /index.css paths to avoid Vite dev-mode export-map ambiguity
import "@fontsource-variable/fraunces/index.css";
import "@fontsource/geist-sans/latin.css";
import "@fontsource-variable/jetbrains-mono/index.css";

// eslint-disable-next-line no-console
console.log("[conflux] main.tsx: fonts loaded, importing App...");

import App from "./App";
import "./index.css";

// eslint-disable-next-line no-console
console.log("[conflux] main.tsx: mounting React...");

// Restore persisted accent color before React mounts so the first paint uses it
const savedAccent = localStorage.getItem("conflux.accentColor");
if (savedAccent) {
  document.documentElement.style.setProperty("--accent-primary", savedAccent);
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("[conflux] #root element not found in index.html");
}

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  // eslint-disable-next-line no-console
  console.log("[conflux] main.tsx: React mounted ✓");
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[conflux] React mount failed:", err);
  rootEl.innerHTML = `<pre style="color:#FF3B30;padding:20px;font-family:monospace;white-space:pre-wrap">${String(err)}</pre>`;
}
