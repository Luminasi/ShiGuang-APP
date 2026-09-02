//! 首页总览对话历史（阶段 8）：退出应用时自动总结上下文 → 归档历史对话
//!
//! summarize_chat 复用 ai.rs 的统一 AI 入口（本机 Claude CLI / OpenAI 兼容网关）；
//! 历史 CRUD 沿用 commands.rs 的 with_db 模式（spawn_blocking 内短锁读写）。

use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::State;

use crate::ai::{load_ai_config, run_ai_blocking};
use crate::claude_cli::AiState;
use crate::commands::with_db;
use crate::db::DbState;
use crate::models::OverviewSession;

/// 短锁读库（供 AI 命令读取提供方配置，与 study.rs 同款辅助）
fn with_conn<T>(
    db: &Arc<Mutex<Connection>>,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

/// AI 总结一段对话：突出话题/结论/未完成事项，120 字内（退出归档用）
#[tauri::command]
pub async fn summarize_chat(
    state: State<'_, DbState>,
    ai_state: State<'_, AiState>,
    conversation: String,
) -> Result<String, String> {
    let db = state.0.clone();
    let ai = AiState(ai_state.0.clone());

    // 过长对话取头尾各 3000 字（中间省略），控制总结成本与时长
    let chars: Vec<char> = conversation.chars().collect();
    let text = if chars.len() > 6000 {
        let head: String = chars[..3000].iter().collect();
        let tail: String = chars[chars.len() - 3000..].iter().collect();
        format!("{head}\n……（中间部分省略）……\n{tail}")
    } else {
        conversation
    };

    let ai_cfg = with_conn(&db, |conn| load_ai_config(conn))?;
    let prompt = format!(
        "你是拾光的生活助理「小拾」。下面是用户与你的对话记录，请把它总结成一段 120 字以内的中文摘要，\
         突出用户关心的话题、得到的结论和未完成的事情。只输出摘要本身，不要任何解释或前缀。\n\n\
         对话记录：\n{text}"
    );

    tauri::async_runtime::spawn_blocking(move || {
        // max_tokens=400：摘要应短小，限制长度也加快退出归档
        run_ai_blocking(&ai, &ai_cfg, &prompt, 30, Some(400))
    })
    .await
    .map_err(|e| format!("对话总结失败：{e}"))?
}

fn map_session(r: &rusqlite::Row) -> rusqlite::Result<OverviewSession> {
    Ok(OverviewSession {
        id: r.get(0)?,
        summary: r.get(1)?,
        created_at: r.get(2)?,
    })
}

#[tauri::command]
pub async fn save_overview_summary(
    state: State<'_, DbState>,
    summary: String,
) -> Result<OverviewSession, String> {
    with_db(state, move |conn| {
        conn.execute("INSERT INTO overview_sessions (summary) VALUES (?1)", [&summary])?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, summary, created_at FROM overview_sessions WHERE id = ?1",
            [id],
            map_session,
        )
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn list_overview_sessions(state: State<'_, DbState>) -> Result<Vec<OverviewSession>, String> {
    with_db(state, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, summary, created_at FROM overview_sessions ORDER BY id DESC")?;
        let rows = stmt
            .query_map([], map_session)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn delete_overview_summary(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(state, move |conn| {
        conn.execute("DELETE FROM overview_sessions WHERE id = ?1", [id])?;
        Ok(())
    })
    .await
}
