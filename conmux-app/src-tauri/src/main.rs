// conmux-app — Windows CLI 大本营 GUI 壳。入口：仅启动 Tauri 应用。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    conmux_app_lib::run();
}
