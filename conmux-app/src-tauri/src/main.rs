// conmux-app — Windows CLI 大本营 GUI 壳。
//
// D-1 单二进制自托管：`Client::connect_or_spawn()` 在无 daemon 时 detached spawn
// `<current_exe> daemon`，故本 exe 必须能以 `daemon` 子命令前台跑 daemon。argv 分流
// 必须在 GUI 初始化之前（R-8）——否则 self-spawn 起的是第二个 GUI 窗口。
// 附带红利：daemon exe == client exe == conmux-app.exe → `verify_server_identity`
// 路径比对匹配，反冒充噪音自动消失。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 顶部判 argv：`daemon` 子命令前台跑 daemon，绝不进入 GUI 初始化。
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("daemon") {
        std::process::exit(conmux_app_lib::run_daemon());
    }
    conmux_app_lib::run();
}
