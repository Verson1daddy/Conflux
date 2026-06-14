// conmux-app — Windows CLI 大本营 GUI 壳（Milestone ① 最小骨架）。
// 本里程碑仅渲染 terminal-core 的 demo pane；不接 daemon（那是 Milestone ②）。
// 引用 conmux::PROTOCOL_VERSION 验证 GUI 客户端与机制层的 Rust 依赖边可用
// （depcruise 只守前端反向依赖；Rust 侧靠此引用 + workspace 编译来验证边界）。

pub fn run() {
    eprintln!(
        "[conmux-app] starting — conmux protocol v{}",
        conmux::PROTOCOL_VERSION
    );
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running conmux-app");
}
