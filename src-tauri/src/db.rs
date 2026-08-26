//! 数据库：连接管理 + 建表（阶段 1 数据层）
//!
//! 数据库文件存放在系统的应用数据目录（Windows 下为 %APPDATA%\com.shiguang.app\shiguang.db），
//! 刷新/重启/关机后数据不丢失。所有读写都通过本模块的连接进行。

use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// 全局状态：持有数据库连接（Arc 便于在异步命令中跨线程克隆）
pub struct DbState(pub Arc<Mutex<Connection>>);

/// 打开（或创建）数据库文件，并执行建表迁移
pub fn init(app: &tauri::App) -> Result<DbState, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let db_path = dir.join("shiguang.db");
    let conn = open(&db_path)?;
    migrate(&conn)?;
    Ok(DbState(Arc::new(Mutex::new(conn))))
}

fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // 提升并发与稳定性
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// 为已存在的旧表补充新列（轻量迁移，幂等）
fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    ddl: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !cols.iter().any(|c| c == column) {
        conn.execute_batch(&format!(
            "ALTER TABLE {} ADD COLUMN {};",
            table, ddl
        ))?;
    }
    Ok(())
}

/// 建表结构（幂等，可重复执行）
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        -- 学习科目（阶段 3）
        CREATE TABLE IF NOT EXISTS subjects (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        -- 科目下的学习任务（阶段 3）
        CREATE TABLE IF NOT EXISTS study_tasks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            title      TEXT NOT NULL,
            done       INTEGER NOT NULL DEFAULT 0,
            done_at    TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_study_tasks_subject ON study_tasks(subject_id);

        -- 今日计划事项（阶段 2）：按日期保存，可拖动调整
        CREATE TABLE IF NOT EXISTS plan_items (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_date    TEXT NOT NULL,                -- YYYY-MM-DD
            title        TEXT NOT NULL,
            start_min    INTEGER NOT NULL,             -- 当天第几分钟（0~1439）
            duration_min INTEGER NOT NULL DEFAULT 30,  -- 时长（分钟）
            done         INTEGER NOT NULL DEFAULT 0,
            reminded     INTEGER NOT NULL DEFAULT 0,   -- 是否已提醒过（到点提醒去重）
            sort_order   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_plan_date ON plan_items(plan_date);

        -- 游戏库（阶段 4）：来源为 steam / scanned
        CREATE TABLE IF NOT EXISTS games (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            source        TEXT NOT NULL DEFAULT 'steam',
            external_id   TEXT,                        -- Steam appid 等外部标识
            name          TEXT NOT NULL,
            exe_path      TEXT,                        -- 启动程序路径（scanned）
            image_path    TEXT,                        -- 封面/图标
            last_played_at TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_games_source_ext ON games(source, external_id);

        -- 游戏游玩记录（阶段 4）
        CREATE TABLE IF NOT EXISTS game_sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            started_at  TEXT NOT NULL,                 -- 开始时间
            duration_min INTEGER NOT NULL DEFAULT 0,   -- 实际游玩时长
            goal_min    INTEGER,                       -- 本次目标时长
            note        TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_game_sessions_game ON game_sessions(game_id);

        -- 进行中的游戏计时（阶段 4）：持久化，重启后恢复；同一时间只允许一个计时
        CREATE TABLE IF NOT EXISTS game_timers (
            game_id     INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
            started_at  TEXT NOT NULL,                 -- 计时开始时间（本地）
            goal_min    INTEGER NOT NULL,              -- 本次目标时长（分钟）
            created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        -- 散步记录（阶段 5）
        CREATE TABLE IF NOT EXISTS walk_records (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL,                 -- YYYY-MM-DD
            duration_min INTEGER NOT NULL,
            started_at  TEXT,
            note        TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_walk_date ON walk_records(date);

        -- 应用设置（键值对）：主题、每日目标、提醒开关等
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )?;
    // 旧数据库升级：补充后续版本新增的列
    ensure_column(
        conn,
        "plan_items",
        "reminded",
        "reminded INTEGER NOT NULL DEFAULT 0",
    )?;
    Ok(())
}

/// 供其他模块的单元测试使用（建表）
#[cfg(test)]
pub fn migrate_for_tests(conn: &Connection) -> rusqlite::Result<()> {
    migrate(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 打开内存库执行迁移，做一次增删查改冒烟测试
    #[test]
    fn migrate_and_crud() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        // 建科目
        conn.execute(
            "INSERT INTO subjects (name, sort_order) VALUES (?1, ?2)",
            ["英语", "0"],
        )
        .unwrap();
        // 插任务
        conn.execute(
            "INSERT INTO study_tasks (subject_id, title) VALUES (1, '背单词 30 个')",
            [],
        )
        .unwrap();
        // 插计划
        conn.execute(
            "INSERT INTO plan_items (plan_date, title, start_min, duration_min) VALUES ('2026-08-26', '学习', 480, 120)",
            [],
        )
        .unwrap();
        // 插游戏与游玩记录
        conn.execute(
            "INSERT INTO games (source, external_id, name) VALUES ('steam', '730', 'CS2')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO game_sessions (game_id, started_at, duration_min, goal_min) VALUES (1, '2026-08-26 20:00:00', 45, 60)",
            [],
        )
        .unwrap();
        // 插散步记录
        conn.execute(
            "INSERT INTO walk_records (date, duration_min) VALUES ('2026-08-26', 40)",
            [],
        )
        .unwrap();
        // 插设置
        conn.execute("INSERT INTO settings (key, value) VALUES ('theme', 'default')", [])
            .unwrap();

        // 全部能查回来
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM subjects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM study_tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM plan_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM game_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM walk_records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);

        // 删除科目，级联删任务
        conn.execute("DELETE FROM subjects WHERE id = 1", []).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM study_tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}
