mod commands;
mod db;
mod models;
mod reminders;
mod scanner;
mod steam;
mod timers;

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

            // 到点提醒后台线程（今日计划）
            let db_conn = app.state::<db::DbState>().0.clone();
            reminders::start(app.handle().clone(), db_conn.clone());
            // 游戏计时检查线程（剩余 5 分钟提醒 + 到点自动记录）
            timers::start(app.handle().clone(), db_conn);
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
