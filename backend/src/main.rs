// ============================================================
// 文件名称：main.rs
// 创建时间：2026-06-02
// 功能描述：Windows 桌面入口，隐藏控制台窗口后调用 lib::run()
// ============================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    limxdesk_lib::run()
}
