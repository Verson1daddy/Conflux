// ===== 窗框（M③ F1 契约 §3：窗口圆角 8、发丝线 1px inside）=====
//
// 三段布局容器：缩点条（top）+ pane（body，flex 占满）+ 状态栏（bottom）由调用方
// 作为 children 顺序传入。底色走 surface.base CSS 变量。

import type { FC, ReactNode } from "react";

const WindowFrame: FC<{ children: ReactNode }> = ({ children }) => (
  <div
    data-testid="conmux-window-frame"
    style={{
      height: "100vh",
      width: "100vw",
      display: "flex",
      flexDirection: "column",
      background: "var(--cx-surface-base)",
      border: "1px solid var(--cx-line-hairline)",
      borderRadius: 8,
      overflow: "hidden",
      boxSizing: "border-box",
    }}
  >
    {children}
  </div>
);

export { WindowFrame };
