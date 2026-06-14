import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("[conmux] #root element not found in index.html");
}

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (err) {
  rootEl.innerHTML = `<pre style="color:#B5503C;padding:20px;font-family:monospace;white-space:pre-wrap">${String(err)}</pre>`;
}
