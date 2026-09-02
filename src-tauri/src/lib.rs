mod ai;
mod claude_cli;
mod commands;
mod db;
mod knowledge;
mod models;
mod overview;
mod reminders;
mod scanner;
mod steam;
mod study;
mod timers;

use claude_cli::AiState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 初始化数据库（建表），失败则应用无法启动（数据是应用的基础）
            let db = db::init(app).expect("failed to initialize database");
            app.manage(db);

            // 预置学习知识库（幂等：版本一致则跳过）
            {
                let conn = app.state::<db::DbState>().0.clone();
                let lock = conn.lock().expect("db lock");
                if let Err(e) = knowledge::seed_kb(&lock) {
                    eprintln!("[study] seed_kb failed: {e}");
                }
            }

            // AI 状态（忙标记 + 子进程句柄）
            app.manage(AiState::new());

            // 到点提醒后台线程（今日计划）
            let db_conn = app.state::<db::DbState>().0.clone();
            reminders::start(app.handle().clone(), db_conn.clone());
            // 游戏计时检查线程（剩余 5 分钟提醒 + 到点自动记录）
            timers::start(app.handle().clone(), db_conn);
            Ok(())
        })
        .on_window_event(|window, event| {
            // 应用退出时清理残留的 AI 子进程
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<AiState>() {
                    state.kill_current();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 科目 / 学习任务
            commands::list_subjects,
            commands::add_subject,
            commands::rename_subject,
            commands::delete_subject,
            commands::list_tasks,
            commands::add_task,
            commands::toggle_task,
            commands::rename_task,
            commands::delete_task,
            // 今日计划
            commands::list_plans,
            commands::add_plan_item,
            commands::update_plan_item,
            commands::toggle_plan_item,
            commands::delete_plan_item,
            // 游戏库与游玩记录
            commands::list_games,
            commands::add_game,
            commands::touch_game,
            commands::delete_game,
            commands::update_game_path,
            commands::launch_game,
            commands::list_sessions,
            commands::add_session,
            commands::delete_session,
            commands::import_games,
            commands::scan_steam_games,
            commands::scan_programs,
            commands::game_stats,
            // 游戏计时
            timers::get_game_timer,
            timers::start_game_timer,
            timers::stop_game_timer,
            timers::cancel_game_timer,
            // 散步记录
            commands::list_walks,
            commands::add_walk,
            commands::delete_walk,
            // 设置
            commands::get_setting,
            commands::set_setting,
            commands::list_settings,
            // AI 设置（阶段 7：OpenAI 兼容网关直连）
            ai::get_ai_settings,
            ai::set_ai_settings,
            ai::test_ai_connection,
            // 学习计划与任务树（阶段 7）
            study::list_study_plans,
            study::delete_plan,
            study::list_plan_nodes,
            study::save_plan_tree,
            study::toggle_plan_node,
            study::update_plan_node,
            // 学习 AI 助手（阶段 7）
            study::generate_study_plan,
            study::ai_ask,
            study::ai_quiz,
            study::ai_list_history,
            study::ai_clear_history,
            // 知识库（阶段 7）
            study::seed_kb,
            study::kb_search,
            // 首页总览对话总结与历史（阶段 8）
            overview::summarize_chat,
            overview::save_overview_summary,
            overview::list_overview_sessions,
            overview::delete_overview_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
