// ============================================================
// 文件名称：window.rs
// 创建时间：2026-06-02
// 设计哲学：主窗口生命周期与可见性的单点掌控；其他模块仅通过本模块访问主窗口
// 功能描述：
//   - 暴露主窗口标签常量，供其他模块复用
//   - 提供"显示并聚焦主窗口"的通用工具
//   - 提供主窗口关闭请求的统一拦截策略（隐藏到托盘而非退出进程）
// 技术特性：Tauri v2 + Runtime 泛型抽象
// ============================================================

use tauri::{AppHandle, Manager, Runtime, Window, WindowEvent};

/// 主窗口标签
///
/// 必须与 `tauri.conf.json` 中 `app.windows[*].label` 一致。
pub const MAIN_WINDOW_LABEL: &str = "main";

/// 显示并聚焦主窗口
///
/// 顺序执行：
/// 1. `show()`：取消隐藏状态
/// 2. `unminimize()`：取消最小化状态
/// 3. `set_focus()`：将焦点切回该窗口
pub fn show_and_focus_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口未找到".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 主窗口关闭事件拦截器
///
/// 行为规范：
/// - 仅对主窗口（`label == `[`MAIN_WINDOW_LABEL`]）的 `CloseRequested` 事件生效
/// - 阻止默认关闭流程，改为 `window.hide()`，使应用驻留系统托盘
/// - 真正退出由托盘菜单"退出 LimxDesk"触发
pub fn handle_close_request<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == MAIN_WINDOW_LABEL {
            api.prevent_close();
            if let Err(err) = window.hide() {
                eprintln!("[window] 隐藏主窗口失败：{err}");
            }
        }
    }
}
