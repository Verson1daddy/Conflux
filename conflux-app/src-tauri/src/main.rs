// Conflux — Multi-Agent CLI Dynamic Island for Windows
// 入口点：仅负责启动 Tauri 应用

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    conflux_lib::run();
}
