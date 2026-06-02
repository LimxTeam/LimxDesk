// ============================================================
// 文件名称：tray.rs
// 创建时间：2026-06-02
// 设计哲学：系统托盘装配独立成模块；菜单事件 / 图标事件均集中在此处理
// 功能描述：
//   - 构建托盘菜单（显示主窗口 / 退出 LimxDesk）
//   - 注册菜单事件处理（show → 调用 `window` 模块；quit → 退出进程）
//   - 注册图标事件处理（左键单击 → 调用 `window` 模块恢复窗口）
//   - 优先复用 `default_window_icon` 作为托盘图标
// 技术特性：Tauri v2 `tray-icon` 特性 + Manager 抽象 + Runtime 泛型
// ============================================================

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Runtime,
};

use crate::window::show_and_focus_main_window;

/// 托盘图标的唯一 ID
const TRAY_ICON_ID: &str = "main-tray";

/// 托盘菜单：显示主窗口的菜单项 ID
const TRAY_MENU_ID_SHOW: &str = "show";

/// 托盘菜单：退出应用的菜单项 ID
const TRAY_MENU_ID_QUIT: &str = "quit";

/// 构建并安装系统托盘图标
///
/// 托盘菜单项：
/// - "显示主窗口"（id = [`TRAY_MENU_ID_SHOW`]）：调用 [`show_and_focus_main_window`]
/// - "退出 LimxDesk"（id = [`TRAY_MENU_ID_QUIT`]）：调用 `app.exit(0)`
///
/// 托盘左键单击行为：与"显示主窗口"菜单项一致。
/// 右键单击：自动弹出菜单（由 `tray-icon` 内部处理）。
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_MENU_ID_SHOW, "显示主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_MENU_ID_QUIT, "退出 LimxDesk", true, None::<&str>)?;
    let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .tooltip("LimxDesk")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            TRAY_MENU_ID_SHOW => {
                if let Err(err) = show_and_focus_main_window(app) {
                    eprintln!("[tray] 显示主窗口失败：{err}");
                }
            }
            TRAY_MENU_ID_QUIT => {
                app.exit(0);
            }
            other => {
                eprintln!("[tray] 收到未知菜单事件：{other}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(err) = show_and_focus_main_window(tray.app_handle()) {
                    eprintln!("[tray] 左键单击恢复窗口失败：{err}");
                }
            }
        });

    // 优先使用默认窗口图标作为托盘图标
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;
    Ok(())
}
