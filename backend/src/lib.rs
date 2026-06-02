// ============================================================
// 文件名称：lib.rs
// 创建时间：2026-06-02
// 设计哲学：极简入口装配 —— 业务能力下沉至各子模块；本文件只做"声明 + 装配"
// 功能描述：
//   1. 声明模块树
//   2. 安装 tracing 日志
//   3. 注册 Tauri 插件
//   4. setup 阶段安装系统托盘
//   5. 拦截主窗口关闭请求并隐藏到托盘
//   6. 注册 invoke 命令：titlebar 4 个
// 技术特性：Tauri v2 + tray-icon
//
// ── 模块表 ────────────────────────────────────────────────────
// │ 模块名     │ 描述                                              │
// │───────────│─────────────────────────────────────────────────│
// │ window     │ 主窗口生命周期、可见性、关闭事件                  │
// │ titlebar   │ 自定义标题栏的窗口控制 invoke 命令                │
// │ tray       │ 系统托盘装配                                      │
//
// ── 注册的命令 ─────────────────────────────────────────────────
// │ 命令名                            │ 来源模块                │
// │──────────────────────────────────│────────────────────────│
// │ titlebar_minimize                 │ titlebar                │
// │ titlebar_maximize                 │ titlebar                │
// │ titlebar_close                    │ titlebar                │
// │ titlebar_is_maximized             │ titlebar                │
// ============================================================

mod titlebar;
mod tray;
mod window;

/// 构建并运行 Tauri 桌面应用
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            window::handle_close_request(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            titlebar::titlebar_minimize,
            titlebar::titlebar_maximize,
            titlebar::titlebar_close,
            titlebar::titlebar_is_maximized,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

/// 初始化 tracing 日志
fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter = EnvFilter::try_from_env("LIMXDESK_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info,limxdesk_lib=debug"));

    let _ = fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_level(true)
        .with_ansi(true)
        .try_init();
}
