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

mod engine;
mod events;
mod fixture_selection;
mod fixture_types;
mod keyframe;
mod layout;
mod output;
mod patch;
mod playback;
mod programmer;
mod sequence;
mod show;
mod titlebar;
mod tray;
mod window;

/// 构建并运行 Tauri 桌面应用
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .manage(fixture_selection::FixtureSelectionState::default())
        .manage(output::OutputState::default())
        .manage(engine::EngineState::default())
        .manage(keyframe::KeyframeState::default())
        .manage(programmer::ProgrammerState::default())
        .manage(show::ShowRuntimeState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            register_recipe_engines(app.handle());
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
            show::show_library_root,
            show::show_scan_library,
            show::show_create,
            show::show_load,
            show::show_save,
            show::show_save_as,
            show::show_delete,
            show::show_current,
            fixture_types::fixture_type_library_root,
            fixture_types::fixture_type_scan_library,
            fixture_types::fixture_type_import_gdtf,
            fixture_types::fixture_type_create,
            fixture_types::fixture_type_update,
            fixture_types::fixture_type_delete,
            fixture_types::fixture_type_scan_current_show,
            fixture_types::fixture_type_import_gdtf_to_show,
            fixture_types::fixture_type_create_in_show,
            fixture_types::fixture_type_update_in_show,
            fixture_types::fixture_type_delete_from_show,
            fixture_selection::fixture_selection_get,
            fixture_selection::fixture_selection_select,
            fixture_selection::fixture_selection_clear,
            programmer::programmer_get,
            programmer::programmer_active_attributes,
            programmer::programmer_replace_current,
            programmer::programmer_set_mode,
            programmer::programmer_set_blind,
            programmer::programmer_sync_selection,
            programmer::programmer_apply_selection_tool,
            programmer::programmer_select_part,
            programmer::programmer_set_attribute_for_selection,
            programmer::programmer_set_attributes_for_selection,
            programmer::programmer_adjust_attribute_for_selection,
            programmer::programmer_clear,
            programmer::programmer_store_values,
            programmer::programmer_reset,
            sequence::sequence_load_current_show,
            sequence::sequence_replace_current_show,
            sequence::sequence_create,
            sequence::sequence_select,
            sequence::sequence_delete,
            sequence::sequence_copy,
            sequence::sequence_move,
            sequence::sequence_store_programmer,
            sequence::sequence_store_single_step_program,
            sequence::sequence_update_cue,
            sequence::sequence_delete_cue,
            sequence::sequence_copy_cue,
            sequence::sequence_move_cue,
            sequence::sequence_go,
            sequence::sequence_back,
            sequence::sequence_goto_cue,
            sequence::sequence_off,
            sequence::sequence_set_master,
            playback::playback_load_current_show,
            playback::playback_replace_current_show,
            playback::playback_assign_executor,
            playback::playback_store_programmer_on_executor,
            playback::playback_clear_executor,
            playback::playback_copy_executor,
            playback::playback_move_executor,
            playback::playback_fire_executor,
            playback::playback_goto_cue,
            playback::playback_set_executor_master,
            playback::playback_set_executor_rate,
            playback::playback_persist_executor_master,
            playback::playback_runtime_snapshot,
            output::output_get_targets,
            output::output_network_interfaces,
            output::output_set_targets,
            output::output_render_dmx,
            output::output_send_current,
            patch::patch_load_current_show,
            patch::patch_save_current_show,
            patch::patch_apply_wizard,
            patch::patch_update_fixture,
            patch::patch_delete_fixture,
            patch::patch_duplicate_fixture,
            patch::patch_auto_patch,
            layout::layout_load_current_show,
            layout::layout_save_current_show,
            layout::layout_save_view_slot,
            layout::layout_clear_view_slot,
            keyframe::keyframe_load_current_show,
            keyframe::keyframe_create_effect,
            keyframe::keyframe_update_effect,
            keyframe::keyframe_delete_effect,
            keyframe::keyframe_select_effect,
            keyframe::keyframe_duplicate_effect,
            keyframe::keyframe_available_attributes,
            keyframe::keyframe_apply_to_selection,
            keyframe::keyframe_capture_frame,
            keyframe::keyframe_remove_frame,
            keyframe::keyframe_update_applied,
            keyframe::keyframe_remove_applied,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

/// 把各类效果引擎注册进回放引擎。
///
/// 引擎在这里装配而不是由回放引擎自己知道有哪些效果种类 —— 关键帧只是
/// 其中一种，后续的效果类型同样在这里挂上。
fn register_recipe_engines(app: &tauri::AppHandle) {
    use tauri::Manager;

    let library = app.state::<keyframe::KeyframeState>().handle();
    let engine_state = app.state::<engine::EngineState>();
    if let Err(error) = engine_state.register_recipe(std::sync::Arc::new(
        keyframe::KeyframeRecipeEngine::new(library),
    )) {
        tracing::error!("failed to register keyframe engine: {error}");
    }
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
