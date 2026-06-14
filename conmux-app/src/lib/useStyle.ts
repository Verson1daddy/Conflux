// ===== useStyle =====
// 订阅当前 conmux 风格（chrome 组件按需消费 chrome token / appearance）。

import { useSyncExternalStore } from "react";
import { getCurrentStyle, subscribeStyle, type Style } from "./style";

export function useStyle(): Style {
  return useSyncExternalStore(subscribeStyle, getCurrentStyle);
}
