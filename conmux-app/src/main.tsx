import React from "react";
import ReactDOM from "react-dom/client";
import { setPtyEventChannels } from "@conmux/terminal-core";
import App from "./App";
import "./index.css";

// D-2：渲染前把 terminal-core 的 PTY 事件通道切到 conmux daemon 客户端 emit 的
// `conmux://` 通道（Rust 侧 lib.rs 读线程据此 emit）。必须在任何 XtermTerminal
// 挂载（即任何 onPtyOutputForInstance / onProcessExitedForInstance 调用）之前设置。
setPtyEventChannels({
  output: "conmux://pty-output",
  exited: "conmux://process-exited",
});

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
