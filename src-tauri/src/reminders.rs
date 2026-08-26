//! 到点提醒（阶段 2 今日计划）
//!
//! 后台线程每 20 秒检查一次今天已到开始时间且未提醒过的事项：
//! - 平时：开始后 2 分钟内未提醒 → 桌面通知 + 应用内横幅（事件 plan-reminder）
//! - 应用刚启动时：把今天已经错过且从未提醒的事项合并成一条汇总通知补上
//! 每个事项只提醒一次（plan_items.reminded 标记去重）。

use chrono::Timelike;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// 一条到点事项
#[derive(Debug, Clone, serde::Serialize)]
pub struct ReminderPayload {
    pub title: String,
    pub start_min: i64,
}

/// 查询到点未提醒的事项
/// - `missed = true`：开始时间已过去超过 `within_min` 分钟（错过补提醒）
/// - `missed = false`：最近 `within_min` 分钟内刚开始的
pub fn due_items(
    conn: &Connection,
    date: &str,
    now_min: i64,
    within_min: i64,
    missed: bool,
) -> rusqlite::Result<Vec<(i64, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, start_min FROM plan_items
         WHERE plan_date = ?1 AND done = 0 AND reminded = 0
           AND start_min <= ?2 AND (?3 OR (?2 - start_min) < ?4)
         ORDER BY start_min",
    )?;
    let rows = stmt
        .query_map(
            rusqlite::params![date, now_min, missed, within_min],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn mark_reminded(conn: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    for id in ids {
        conn.execute("UPDATE plan_items SET reminded = 1 WHERE id = ?1", [id])?;
    }
    Ok(())
}

fn fmt_min(min: i64) -> String {
    format!("{:02}:{:02}", min / 60, min % 60)
}

/// 启动提醒后台线程
pub fn start(app: AppHandle, db: Arc<Mutex<Connection>>) {
    std::thread::spawn(move || {
        let mut first = true;
        loop {
            let now = chrono::Local::now();
            let date = now.format("%Y-%m-%d").to_string();
            let now_min = now.hour() as i64 * 60 + now.minute() as i64;

            if let Ok(conn) = db.lock() {
                if let Ok(items) = due_items(&conn, &date, now_min, 2, first) {
                    if !items.is_empty() {
                        let ids: Vec<i64> = items.iter().map(|i| i.0).collect();
                        if first {
                            // 启动时补一条汇总：今天已到时间的事项
                            let list = items
                                .iter()
                                .map(|(_, t, m)| format!("{} {}", fmt_min(*m), t))
                                .collect::<Vec<_>>()
                                .join("、");
                            let _ = app
                                .notification()
                                .builder()
                                .title("拾光 · 错过的计划")
                                .body(format!("今天已到时间的事项：{}", list))
                                .show();
                        } else {
                            for (_, title, start_min) in &items {
                                let _ = app.emit(
                                    "plan-reminder",
                                    ReminderPayload {
                                        title: title.clone(),
                                        start_min: *start_min,
                                    },
                                );
                                let _ = app
                                    .notification()
                                    .builder()
                                    .title("拾光 · 到点提醒")
                                    .body(format!("「{}」时间到了，该去做了", title))
                                    .show();
                            }
                        }
                        let _ = mark_reminded(&conn, &ids);
                    }
                }
            }
            first = false;
            std::thread::sleep(Duration::from_secs(20));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate_for_tests(&conn).unwrap();
        conn
    }

    /// 插入一条今天 09:00 的事项
    fn insert_item(conn: &Connection, date: &str, title: &str, start_min: i64, done: bool) {
        conn.execute(
            "INSERT INTO plan_items (plan_date, title, start_min, done) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![date, title, start_min, done as i64],
        )
        .unwrap();
    }

    /// 启动补提醒：已错过（开始超过 2 分钟）且未提醒的事项，一条汇总
    #[test]
    fn missed_due() {
        let conn = test_conn();
        insert_item(&conn, "2026-08-26", "学习", 9 * 60, false);
        insert_item(&conn, "2026-08-26", "已完成事项", 8 * 60, true); // 已完成不提醒
        insert_item(&conn, "2026-08-27", "明天的事", 9 * 60, false); // 不是今天不提醒

        // 10:01 时，错过的只有 9:00 的「学习」
        let missed = due_items(&conn, "2026-08-26", 10 * 60 + 1, 2, true).unwrap();
        assert_eq!(missed.len(), 1);
        assert_eq!(missed[0].1, "学习");

        // 标记提醒后不再出现
        let ids: Vec<i64> = missed.iter().map(|i| i.0).collect();
        mark_reminded(&conn, &ids).unwrap();
        let again = due_items(&conn, "2026-08-26", 10 * 60 + 1, 2, true).unwrap();
        assert!(again.is_empty());
    }

    /// 平时检查：只提醒最近 2 分钟内刚开始的
    #[test]
    fn just_started_due() {
        let conn = test_conn();
        insert_item(&conn, "2026-08-26", "刚开始的", 10 * 60, false);
        insert_item(&conn, "2026-08-26", "早已开始", 8 * 60 + 30, false);

        // 10:01 时，最近 2 分钟内开始的只有「刚开始的」
        let due = due_items(&conn, "2026-08-26", 10 * 60 + 1, 2, false).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].1, "刚开始的");

        // 标记提醒后不再出现
        let ids: Vec<i64> = due.iter().map(|i| i.0).collect();
        mark_reminded(&conn, &ids).unwrap();
        let again = due_items(&conn, "2026-08-26", 10 * 60 + 1, 2, false).unwrap();
        assert!(again.is_empty());
    }
}
