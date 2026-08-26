//! 后端命令：前端通过 invoke 调用的数据读写接口（阶段 1）
//!
//! 所有命令都是异步的，数据库操作在后台线程执行，不阻塞界面。
//! 界面层无需关心 SQL，只需调用这里的接口。

use rusqlite::{Connection, OptionalExtension, Row};
use tauri::State;

use crate::db::DbState;
use crate::models::{
    Game, GameSession, PlanItem, Setting, StudyTask, Subject, WalkRecord,
};

fn row_to_bool(v: i64) -> bool {
    v != 0
}

// ---------- 通用执行器 ----------

/// 在后台线程中锁定数据库连接并执行闭包
async fn with_db<T, F>(state: State<'_, DbState>, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
{
    let db = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| e.to_string())?;
        f(&conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- 行映射 ----------

fn map_subject(r: &Row) -> rusqlite::Result<Subject> {
    Ok(Subject {
        id: r.get(0)?,
        name: r.get(1)?,
        sort_order: r.get(2)?,
        created_at: r.get(3)?,
    })
}

fn map_task(r: &Row) -> rusqlite::Result<StudyTask> {
    Ok(StudyTask {
        id: r.get(0)?,
        subject_id: r.get(1)?,
        title: r.get(2)?,
        done: row_to_bool(r.get(3)?),
        done_at: r.get(4)?,
        created_at: r.get(5)?,
    })
}

fn map_plan(r: &Row) -> rusqlite::Result<PlanItem> {
    Ok(PlanItem {
        id: r.get(0)?,
        plan_date: r.get(1)?,
        title: r.get(2)?,
        start_min: r.get(3)?,
        duration_min: r.get(4)?,
        done: row_to_bool(r.get(5)?),
        sort_order: r.get(6)?,
        created_at: r.get(7)?,
    })
}

fn map_game(r: &Row) -> rusqlite::Result<Game> {
    Ok(Game {
        id: r.get(0)?,
        source: r.get(1)?,
        external_id: r.get(2)?,
        name: r.get(3)?,
        exe_path: r.get(4)?,
        image_path: r.get(5)?,
        last_played_at: r.get(6)?,
        created_at: r.get(7)?,
    })
}

fn map_session(r: &Row) -> rusqlite::Result<GameSession> {
    Ok(GameSession {
        id: r.get(0)?,
        game_id: r.get(1)?,
        started_at: r.get(2)?,
        duration_min: r.get(3)?,
        goal_min: r.get(4)?,
        note: r.get(5)?,
        created_at: r.get(6)?,
    })
}

fn map_walk(r: &Row) -> rusqlite::Result<WalkRecord> {
    Ok(WalkRecord {
        id: r.get(0)?,
        date: r.get(1)?,
        duration_min: r.get(2)?,
        started_at: r.get(3)?,
        note: r.get(4)?,
        created_at: r.get(5)?,
    })
}

// ============================================================
// 科目（阶段 3 学习任务）
// ============================================================

#[tauri::command]
pub async fn list_subjects(state: State<'_, DbState>) -> Result<Vec<Subject>, String> {
    with_db(state, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, name, sort_order, created_at FROM subjects ORDER BY sort_order, id")?;
        let rows = stmt
            .query_map([], map_subject)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn add_subject(
    state: State<'_, DbState>,
    name: String,
) -> Result<Subject, String> {
    with_db(state, move |conn| {
        let mut max: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM subjects",
            [],
            |r| r.get(0),
        )?;
        max += 1;
        conn.execute(
            "INSERT INTO subjects (name, sort_order) VALUES (?1, ?2)",
            rusqlite::params![name, max],
        )?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare(
            "SELECT id, name, sort_order, created_at FROM subjects WHERE id = ?1",
        )?;
        stmt.query_row([id], map_subject).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn rename_subject(
    state: State<'_, DbState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute(
            "UPDATE subjects SET name = ?1 WHERE id = ?2",
            rusqlite::params![name, id],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn delete_subject(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(state, move |conn| {
        // 任务表外键 ON DELETE CASCADE，科目删掉任务一并删除
        conn.execute("DELETE FROM subjects WHERE id = ?1", [id])?;
        Ok(())
    })
    .await
}

// ============================================================
// 学习任务（阶段 3）
// ============================================================

#[tauri::command]
pub async fn list_tasks(
    state: State<'_, DbState>,
    subject_id: i64,
) -> Result<Vec<StudyTask>, String> {
    with_db(state, move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, subject_id, title, done, done_at, created_at
             FROM study_tasks WHERE subject_id = ?1 ORDER BY done, id",
        )?;
        let rows = stmt
            .query_map([subject_id], map_task)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn add_task(
    state: State<'_, DbState>,
    subject_id: i64,
    title: String,
) -> Result<StudyTask, String> {
    with_db(state, move |conn| {
        conn.execute(
            "INSERT INTO study_tasks (subject_id, title) VALUES (?1, ?2)",
            rusqlite::params![subject_id, title],
        )?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare(
            "SELECT id, subject_id, title, done, done_at, created_at FROM study_tasks WHERE id = ?1",
        )?;
        stmt.query_row([id], map_task).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn toggle_task(
    state: State<'_, DbState>,
    id: i64,
    done: bool,
) -> Result<StudyTask, String> {
    with_db(state, move |conn| {
        // done_at 由 SQLite 按本地时间生成
        conn.execute(
            "UPDATE study_tasks SET
               done    = ?1,
               done_at = CASE WHEN ?1 THEN datetime('now', 'localtime') ELSE NULL END
             WHERE id = ?2",
            rusqlite::params![done as i64, id],
        )?;
        let mut stmt = conn.prepare(
            "SELECT id, subject_id, title, done, done_at, created_at FROM study_tasks WHERE id = ?1",
        )?;
        stmt.query_row([id], map_task).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn rename_task(
    state: State<'_, DbState>,
    id: i64,
    title: String,
) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute(
            "UPDATE study_tasks SET title = ?1 WHERE id = ?2",
            rusqlite::params![title, id],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn delete_task(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute("DELETE FROM study_tasks WHERE id = ?1", [id])?;
        Ok(())
    })
    .await
}

// ============================================================
// 今日计划（阶段 2）
// ============================================================

#[tauri::command]
pub async fn list_plans(
    state: State<'_, DbState>,
    plan_date: String,
) -> Result<Vec<PlanItem>, String> {
    with_db(state, move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, plan_date, title, start_min, duration_min, done, sort_order, created_at
             FROM plan_items WHERE plan_date = ?1 ORDER BY start_min, sort_order",
        )?;
        let rows = stmt
            .query_map([plan_date], map_plan)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn add_plan_item(
    state: State<'_, DbState>,
    plan_date: String,
    title: String,
    start_min: i64,
    duration_min: i64,
) -> Result<PlanItem, String> {
    with_db(state, move |conn| {
        conn.execute(
            "INSERT INTO plan_items (plan_date, title, start_min, duration_min) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![plan_date, title, start_min, duration_min],
        )?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare(
            "SELECT id, plan_date, title, start_min, duration_min, done, sort_order, created_at
             FROM plan_items WHERE id = ?1",
        )?;
        stmt.query_row([id], map_plan).map_err(Into::into)
    })
    .await
}

/// 拖动调整：可改开始时间、时长、标题（None 表示保持不变）
#[tauri::command]
pub async fn update_plan_item(
    state: State<'_, DbState>,
    id: i64,
    title: Option<String>,
    start_min: Option<i64>,
    duration_min: Option<i64>,
) -> Result<PlanItem, String> {
    with_db(state, move |conn| {
        conn.execute(
            "UPDATE plan_items SET
               title        = COALESCE(?1, title),
               start_min    = COALESCE(?2, start_min),
               duration_min = COALESCE(?3, duration_min)
             WHERE id = ?4",
            rusqlite::params![title, start_min, duration_min, id],
        )?;
        let mut stmt = conn.prepare(
            "SELECT id, plan_date, title, start_min, duration_min, done, sort_order, created_at
             FROM plan_items WHERE id = ?1",
        )?;
        stmt.query_row([id], map_plan).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn toggle_plan_item(
    state: State<'_, DbState>,
    id: i64,
    done: bool,
) -> Result<PlanItem, String> {
    with_db(state, move |conn| {
        conn.execute(
            "UPDATE plan_items SET done = ?1 WHERE id = ?2",
            rusqlite::params![done as i64, id],
        )?;
        let mut stmt = conn.prepare(
            "SELECT id, plan_date, title, start_min, duration_min, done, sort_order, created_at
             FROM plan_items WHERE id = ?1",
        )?;
        stmt.query_row([id], map_plan).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn delete_plan_item(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute("DELETE FROM plan_items WHERE id = ?1", [id])?;
        Ok(())
    })
    .await
}

// ============================================================
// 游戏库（阶段 4）
// ============================================================

#[tauri::command]
pub async fn list_games(state: State<'_, DbState>) -> Result<Vec<Game>, String> {
    with_db(state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, source, external_id, name, exe_path, image_path, last_played_at, created_at
             FROM games ORDER BY name",
        )?;
        let rows = stmt
            .query_map([], map_game)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn add_game(
    state: State<'_, DbState>,
    source: String,
    external_id: Option<String>,
    name: String,
    exe_path: Option<String>,
    image_path: Option<String>,
) -> Result<Game, String> {
    with_db(state, move |conn| {
        conn.execute(
            "INSERT OR IGNORE INTO games (source, external_id, name, exe_path, image_path)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![source, external_id, name, exe_path, image_path],
        )?;
        // 若已存在则返回已有记录
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare(
            "SELECT id, source, external_id, name, exe_path, image_path, last_played_at, created_at
             FROM games WHERE id = ?1",
        )?;
        stmt.query_row([id], map_game).map_err(Into::into)
    })
    .await
}

/// 更新游玩时间标记（开始游戏时调用）
#[tauri::command]
pub async fn touch_game(
    state: State<'_, DbState>,
    id: i64,
    last_played_at: String,
) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute(
            "UPDATE games SET last_played_at = ?1 WHERE id = ?2",
            rusqlite::params![last_played_at, id],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn delete_game(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(state, move |conn| {
        // 游玩记录级联删除
        conn.execute("DELETE FROM games WHERE id = ?1", [id])?;
        Ok(())
    })
    .await
}

/// 手动设置游戏的启动程序路径（本机程序游戏用；Steam 游戏走协议启动）
#[tauri::command]
pub async fn update_game_path(
    state: State<'_, DbState>,
    id: i64,
    exe_path: String,
) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute(
            "UPDATE games SET exe_path = ?1 WHERE id = ?2",
            rusqlite::params![exe_path, id],
        )?;
        Ok(())
    })
    .await
}

/// 启动本机游戏：直接 spawn 可执行文件。
/// 不用 opener 插件（其对部分中文路径不可靠），Rust 原生 spawn 支持 Unicode 路径，
/// 且能返回明确的错误（文件不存在 / 启动失败）。
#[tauri::command]
pub async fn launch_game(state: State<'_, DbState>, id: i64) -> Result<String, String> {
    // 先从库里取路径
    let exe: Option<String> = with_db(state, move |conn| {
        conn.query_row("SELECT exe_path FROM games WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(Into::into)
    })
    .await?;

    let Some(exe) = exe.filter(|p| !p.trim().is_empty()) else {
        return Err("该游戏没有设置启动路径".to_string());
    };
    if !std::path::Path::new(&exe).exists() {
        return Err(format!("文件不存在：{exe}"));
    }
    // 以 exe 所在目录为工作目录启动（部分游戏依赖 cwd）
    let dir = std::path::Path::new(&exe)
        .parent()
        .map(|d| d.to_path_buf())
        .unwrap_or_default();
    std::process::Command::new(&exe)
        .current_dir(dir)
        .spawn()
        .map_err(|e| format!("启动失败：{e}"))?;
    Ok(exe)
}

/// 一款游戏的累计统计（列表页展示）
#[derive(serde::Serialize)]
pub struct GameStats {
    pub game_id: i64,
    pub total_min: i64,   // 累计游玩分钟
    pub sessions: i64,    // 游玩次数
}

/// 待导入的游戏（扫描结果经前端勾选后组装）
#[derive(serde::Deserialize)]
pub struct ImportGame {
    pub external_id: Option<String>,
    pub name: String,
    pub exe_path: Option<String>,
}

/// 批量导入扫描到的游戏（重复项自动跳过），返回实际新增数量
#[tauri::command]
pub async fn import_games(
    state: State<'_, DbState>,
    source: String,
    games: Vec<ImportGame>,
) -> Result<usize, String> {
    with_db(state, move |conn| {
        let mut added = 0;
        for g in &games {
            let n = conn.execute(
                "INSERT OR IGNORE INTO games (source, external_id, name, exe_path)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![source, g.external_id, g.name, g.exe_path],
            )?;
            added += n as usize;
        }
        Ok(added)
    })
    .await
}

/// 扫描 Steam 已安装游戏（离线读本地清单文件）
#[tauri::command]
pub async fn scan_steam_games() -> Result<Vec<crate::steam::SteamGameInfo>, String> {
    let list = tauri::async_runtime::spawn_blocking(crate::steam::scan_installed_games)
        .await
        .map_err(|e| e.to_string())?;
    Ok(list)
}

/// 扫描本机已安装程序（供勾选导入为游戏）
#[tauri::command]
pub async fn scan_programs() -> Result<Vec<crate::scanner::ScannedProgram>, String> {
    let list = tauri::async_runtime::spawn_blocking(crate::scanner::scan_installed_programs)
        .await
        .map_err(|e| e.to_string())?;
    Ok(list)
}

/// 全部游戏的累计统计（一次取回，避免逐游戏查询）
#[tauri::command]
pub async fn game_stats(state: State<'_, DbState>) -> Result<Vec<GameStats>, String> {
    with_db(state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT g.id, COALESCE(SUM(s.duration_min), 0), COUNT(s.id)
             FROM games g LEFT JOIN game_sessions s ON s.game_id = g.id
             GROUP BY g.id ORDER BY g.name",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(GameStats {
                    game_id: r.get(0)?,
                    total_min: r.get(1)?,
                    sessions: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

// ============================================================
// 游戏游玩记录（阶段 4）
// ============================================================

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, DbState>,
    game_id: i64,
) -> Result<Vec<GameSession>, String> {
    with_db(state, move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, game_id, started_at, duration_min, goal_min, note, created_at
             FROM game_sessions WHERE game_id = ?1 ORDER BY started_at DESC",
        )?;
        let rows = stmt
            .query_map([game_id], map_session)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn add_session(
    state: State<'_, DbState>,
    game_id: i64,
    started_at: String,
    duration_min: i64,
    goal_min: Option<i64>,
    note: Option<String>,
) -> Result<GameSession, String> {
    with_db(state, move |conn| {
        conn.execute(
            "INSERT INTO game_sessions (game_id, started_at, duration_min, goal_min, note)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![game_id, started_at, duration_min, goal_min, note],
        )?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare(
            "SELECT id, game_id, started_at, duration_min, goal_min, note, created_at
             FROM game_sessions WHERE id = ?1",
        )?;
        stmt.query_row([id], map_session).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn delete_session(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute("DELETE FROM game_sessions WHERE id = ?1", [id])?;
        Ok(())
    })
    .await
}

// ============================================================
// 散步记录（阶段 5）
// ============================================================

#[tauri::command]
pub async fn list_walks(
    state: State<'_, DbState>,
    from_date: String,
    to_date: String,
) -> Result<Vec<WalkRecord>, String> {
    with_db(state, move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, date, duration_min, started_at, note, created_at
             FROM walk_records WHERE date BETWEEN ?1 AND ?2 ORDER BY date, id",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![from_date, to_date], map_walk)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn add_walk(
    state: State<'_, DbState>,
    date: String,
    duration_min: i64,
    started_at: Option<String>,
    note: Option<String>,
) -> Result<WalkRecord, String> {
    with_db(state, move |conn| {
        conn.execute(
            "INSERT INTO walk_records (date, duration_min, started_at, note) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![date, duration_min, started_at, note],
        )?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare(
            "SELECT id, date, duration_min, started_at, note, created_at
             FROM walk_records WHERE id = ?1",
        )?;
        stmt.query_row([id], map_walk).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn delete_walk(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute("DELETE FROM walk_records WHERE id = ?1", [id])?;
        Ok(())
    })
    .await
}

// ============================================================
// 设置（阶段 6 主题等）
// ============================================================

#[tauri::command]
pub async fn get_setting(
    state: State<'_, DbState>,
    key: String,
) -> Result<Option<String>, String> {
    with_db(state, move |conn| {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn set_setting(
    state: State<'_, DbState>,
    key: String,
    value: String,
) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_settings(state: State<'_, DbState>) -> Result<Vec<Setting>, String> {
    with_db(state, |conn| {
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Setting {
                    key: r.get(0)?,
                    value: r.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}
