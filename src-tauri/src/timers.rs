//! 游戏计时器（阶段 4 游戏娱乐）
//!
//! 计时状态持久化在 game_timers 表：开始计时 → 写库；应用重启后自动恢复，
//! 窗口最小化或切到全屏游戏也不受影响（计时由后端 Rust 负责）。
//!
//! 后台线程每 10 秒检查一次：
//! - 剩余 ≤ 5 分钟 → 桌面通知 + 应用内事件 game-timer-5min（只提醒一次）
//! - 时间到 → 自动结束并写入游玩记录，通知 + 事件 game-timer-ended

use chrono::NaiveDateTime;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

use crate::db::DbState;
use crate::models::GameSession;

/// 当前进行中的计时信息（返回给前端展示）
#[derive(Debug, Clone, Serialize)]
pub struct GameTimerInfo {
    pub game_id: i64,
    pub game_name: String,
    pub started_at: String,
    pub goal_min: i64,
    pub elapsed_min: i64,
    pub remaining_min: i64, // 距到点剩余分钟（已超时为负）
}

/// 还剩 5 分钟事件
#[derive(Debug, Clone, Serialize)]
pub struct TimerSoonPayload {
    pub game_id: i64,
    pub game_name: String,
}

/// 时间到已记录事件
#[derive(Debug, Clone, Serialize)]
pub struct TimerEndedPayload {
    pub game_id: i64,
    pub game_name: String,
    pub duration_min: i64,
}

// ---------- 时间工具 ----------

const TS_FMT: &str = "%Y-%m-%d %H:%M:%S";

fn ts_now() -> String {
    chrono::Local::now().format(TS_FMT).to_string()
}

fn parse_ts(s: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, TS_FMT).ok()
}

/// 从开始时间到现在经过的秒数
fn elapsed_sec(started: &str, now: NaiveDateTime) -> i64 {
    parse_ts(started)
        .map(|t| (now - t).num_seconds())
        .unwrap_or(0)
}

/// 秒数 → 记录用分钟（四舍五入，最少 1 分钟）
fn round_min(secs: i64) -> i64 {
    if secs <= 0 {
        return 1;
    }
    ((secs + 30) / 60).max(1)
}

// ---------- 数据库操作 ----------

/// 当前进行中的计时（无则 None）
fn active_timer(conn: &Connection) -> rusqlite::Result<Option<GameTimerInfo>> {
    let mut stmt = conn.prepare(
        "SELECT t.game_id, g.name, t.started_at, t.goal_min
         FROM game_timers t JOIN games g ON g.id = t.game_id
         ORDER BY t.game_id LIMIT 1",
    )?;
    let now = chrono::Local::now().naive_local();
    let row = stmt
        .query_row([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })
        .optional()?;
    let Some((game_id, game_name, started_at, goal_min)) = row else {
        return Ok(None);
    };
    let elapsed = elapsed_sec(&started_at, now);
    Ok(Some(GameTimerInfo {
        game_id,
        game_name,
        started_at,
        goal_min,
        elapsed_min: elapsed / 60,
        remaining_min: goal_min - elapsed / 60,
    }))
}

/// 开始计时（已有其他游戏在计时则拒绝）
fn start_timer(conn: &Connection, game_id: i64, goal_min: i64) -> Result<GameTimerInfo, String> {
    if let Some(cur) = active_timer(conn).map_err(|e| e.to_string())? {
        return Err(format!(
            "「{}」正在计时中，请先结束它再开始新的",
            cur.game_name
        ));
    }
    conn.execute(
        "INSERT INTO game_timers (game_id, started_at, goal_min) VALUES (?1, ?2, ?3)
         ON CONFLICT(game_id) DO UPDATE SET started_at = excluded.started_at, goal_min = excluded.goal_min",
        rusqlite::params![game_id, ts_now(), goal_min],
    )
    .map_err(|e| e.to_string())?;
    active_timer(conn)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "计时未创建成功".to_string())
}

/// 结束计时：写入游玩记录并清除计时状态，返回 (记录, 游戏名)
fn finish_timer(conn: &Connection, game_id: i64) -> Result<(GameSession, String), String> {
    let info = active_timer(conn)
        .map_err(|e| e.to_string())?
        .filter(|t| t.game_id == game_id)
        .ok_or_else(|| "该游戏没有进行中的计时".to_string())?;

    let now = chrono::Local::now().naive_local();
    let elapsed = elapsed_sec(&info.started_at, now);
    let duration = round_min(elapsed);
    let now_str = now.format(TS_FMT).to_string();

    conn.execute(
        "INSERT INTO game_sessions (game_id, started_at, duration_min, goal_min)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![game_id, info.started_at, duration, info.goal_min],
    )
    .map_err(|e| e.to_string())?;
    let session_id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE games SET last_played_at = ?1 WHERE id = ?2",
        rusqlite::params![now_str, game_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM game_timers WHERE game_id = ?1", [game_id])
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, started_at, duration_min, goal_min, note, created_at
             FROM game_sessions WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let session = stmt
        .query_row([session_id], |r| {
            Ok(GameSession {
                id: r.get(0)?,
                game_id: r.get(1)?,
                started_at: r.get(2)?,
                duration_min: r.get(3)?,
                goal_min: r.get(4)?,
                note: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok((session, info.game_name))
}

/// 放弃计时：不写记录，直接清除
fn abandon_timer(conn: &Connection, game_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM game_timers WHERE game_id = ?1", [game_id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ---------- 命令（供前端调用） ----------

async fn with_db<T, F>(state: State<'_, DbState>, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
{
    let db = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| e.to_string())?;
        f(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 查询当前进行中的计时（应用启动时恢复界面用）
#[tauri::command]
pub async fn get_game_timer(state: State<'_, DbState>) -> Result<Option<GameTimerInfo>, String> {
    with_db(state, |conn| {
        active_timer(conn).map_err(|e| e.to_string())
    })
    .await
}

/// 开始计时（goal_min：本次目标时长，分钟）
#[tauri::command]
pub async fn start_game_timer(
    state: State<'_, DbState>,
    game_id: i64,
    goal_min: i64,
) -> Result<GameTimerInfo, String> {
    let goal = goal_min.clamp(1, 12 * 60);
    with_db(state, move |conn| start_timer(conn, game_id, goal)).await
}

/// 手动结束计时并记录本次游玩
#[tauri::command]
pub async fn stop_game_timer(
    state: State<'_, DbState>,
    game_id: i64,
) -> Result<GameSession, String> {
    with_db(state, move |conn| finish_timer(conn, game_id).map(|(s, _)| s)).await
}

/// 放弃计时（不记录）
#[tauri::command]
pub async fn cancel_game_timer(state: State<'_, DbState>, game_id: i64) -> Result<(), String> {
    with_db(state, move |conn| abandon_timer(conn, game_id)).await
}

// ---------- 提醒后台线程 ----------

/// 启动游戏计时检查线程（每 10 秒一次）
pub fn start(app: AppHandle, db: Arc<Mutex<Connection>>) {
    std::thread::spawn(move || {
        let mut warned: HashSet<i64> = HashSet::new();
        loop {
            if let Ok(conn) = db.lock() {
                if let Ok(Some(t)) = active_timer(&conn) {
                    // 秒级剩余时间：目标总秒数 - 已过秒数
                    let secs = t.goal_min * 60
                        - elapsed_sec(&t.started_at, chrono::Local::now().naive_local());

                    if secs <= 0 {
                        // 到点：自动结束并记录
                        if let Ok((session, name)) = finish_timer(&conn, t.game_id) {
                            warned.remove(&t.game_id);
                            let _ = app.emit(
                                "game-timer-ended",
                                TimerEndedPayload {
                                    game_id: t.game_id,
                                    game_name: name.clone(),
                                    duration_min: session.duration_min,
                                },
                            );
                            let _ = app
                                .notification()
                                .builder()
                                .title("拾光 · 游戏时间到")
                                .body(format!("「{}」本次玩了 {} 分钟，已自动记录", name, session.duration_min))
                                .show();
                        }
                    } else if secs <= 5 * 60 && warned.insert(t.game_id) {
                        // 剩余 5 分钟内：提醒一次
                        let _ = app.emit(
                            "game-timer-5min",
                            TimerSoonPayload {
                                game_id: t.game_id,
                                game_name: t.game_name.clone(),
                            },
                        );
                        let _ = app
                            .notification()
                            .builder()
                            .title("拾光 · 游戏提醒")
                            .body(format!("「{}」还有 5 分钟就到点啦", t.game_name))
                            .show();
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(10));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate_for_tests(&conn).unwrap();
        conn.execute(
            "INSERT INTO games (source, external_id, name) VALUES ('steam', '1', '测试游戏')",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn round_min_rounds_up_to_at_least_one() {
        assert_eq!(round_min(30), 1); // 30 秒 → 1 分钟
        assert_eq!(round_min(59), 1);
        assert_eq!(round_min(60), 1);
        assert_eq!(round_min(90), 2);
        assert_eq!(round_min(150), 3);
        assert_eq!(round_min(-10), 1);
    }

    #[test]
    fn timer_lifecycle_records_session() {
        let conn = test_conn();

        // 开始计时（目标 60 分钟）
        let info = start_timer(&conn, 1, 60).unwrap();
        assert_eq!(info.game_id, 1);
        assert_eq!(info.goal_min, 60);
        assert!(active_timer(&conn).unwrap().is_some());

        // 已有计时时不允许再开一个（同游戏返回现有）
        assert!(start_timer(&conn, 1, 30).is_err() || active_timer(&conn).unwrap().unwrap().goal_min == 30);

        // 结束计时 → 生成游玩记录
        let (session, name) = finish_timer(&conn, 1).unwrap();
        assert_eq!(name, "测试游戏");
        assert_eq!(session.game_id, 1);
        assert!(session.duration_min >= 1);
        assert_eq!(session.goal_min, Some(60));
        assert!(active_timer(&conn).unwrap().is_none());

        // 再结束一次应该报错（没有进行中的计时）
        assert!(finish_timer(&conn, 1).is_err());
    }

    #[test]
    fn abandon_clears_without_record() {
        let conn = test_conn();
        start_timer(&conn, 1, 30).unwrap();
        abandon_timer(&conn, 1).unwrap();
        assert!(active_timer(&conn).unwrap().is_none());
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM game_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}
