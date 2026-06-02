// ============================================================
// 文件名称：titlebar.rs
// 创建时间：2026-06-02
// 设计哲学：自定义无边框标题栏的窗口控制命令；唯一对外面 = 4 个 invoke 命令
// 功能描述：提供前端标题栏调用的窗口最小化 / 最大化 / 关闭 / 状态查询能力
// 技术特性：Tauri v2 `#[tauri::command]`
//
// ── 命令清单 ──────────────────────────────────────────────────
// │ 命令名                  │ 描述                                  │
// │────────────────────────│──────────────────────────────────────│
// │ titlebar_minimize       │ 最小化主窗口                          │
// │ titlebar_maximize       │ 在最大化与还原之间切换                │
// │ titlebar_close          │ 触发主窗口关闭请求（实际隐藏到托盘）  │
// │ titlebar_is_maximized   │ 查询主窗口是否处于最大化状态          │
// ============================================================

use tauri::{AppHandle, Manager};

use crate::window::MAIN_WINDOW_LABEL;

/// 最小化主窗口
#[tauri::command]
pub fn titlebar_minimize(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口未找到".to_string())?;
    window.minimize().map_err(|e| e.to_string())
}

/// 在最大化与还原状态之间切换
#[tauri::command]
pub fn titlebar_maximize(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口未找到".to_string())?;
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// 触发主窗口关闭请求
///
/// 实际执行路径：
/// 1. `window.close()` 触发 `WindowEvent::CloseRequested`
/// 2. [`crate::window::handle_close_request`] 拦截事件，阻止默认关闭流程
/// 3. 改为 `window.hide()`，应用驻留系统托盘
#[tauri::command]
pub fn titlebar_close(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口未找到".to_string())?;
    window.close().map_err(|e| e.to_string())
}

/// 查询主窗口是否处于最大化状态
#[tauri::command]
pub fn titlebar_is_maximized(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口未找到".to_string())?;
    window.is_maximized().map_err(|e| e.to_string())
}
