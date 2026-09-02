//! 学习任务模块（阶段 7）：学习计划 / 任务树节点 / AI 学习助手
//!
//! 数据命令沿用 commands.rs 的 with_db 模式；AI 命令通过 claude_cli.rs
//! 调用本机 Claude Code CLI（spawn_blocking 内执行，run_claude 在锁外）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde::Deserialize;
use tauri::State;

use crate::ai::{load_ai_config, run_ai_blocking};
use crate::claude_cli::AiState;
use crate::commands::with_db;
use crate::db::DbState;
use crate::knowledge::{search_kb, seed_kb as do_seed_kb};
use crate::models::{
    AiMessage, AskResult, GenerateResult, KbHit, PlanNodeInput, Quiz, StudyPlan, StudyPlanNode,
};

// ============================================================
// 同步 DB 辅助（供 AI 命令在 spawn_blocking 内短锁读写）
// ============================================================

fn with_conn<T>(
    db: &Arc<Mutex<Connection>>,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

fn map_plan(r: &rusqlite::Row) -> rusqlite::Result<StudyPlan> {
    Ok(StudyPlan {
        id: r.get(0)?,
        title: r.get(1)?,
        goal: r.get(2)?,
        days: r.get(3)?,
        meta: r.get(4)?,
        status: r.get(5)?,
        created_at: r.get(6)?,
    })
}

fn map_node(r: &rusqlite::Row) -> rusqlite::Result<StudyPlanNode> {
    Ok(StudyPlanNode {
        id: r.get(0)?,
        plan_id: r.get(1)?,
        parent_id: r.get(2)?,
        title: r.get(3)?,
        kind: r.get(4)?,
        required: r.get::<_, i64>(5)? != 0,
        content: r.get(6)?,
        exercise: r.get(7)?,
        resource_url: r.get(8)?,
        resource_label: r.get(9)?,
        done: r.get::<_, i64>(10)? != 0,
        done_at: r.get(11)?,
        sort_order: r.get(12)?,
        created_at: r.get(13)?,
    })
}

const NODE_COLS: &str = "id, plan_id, parent_id, title, kind, required, content, exercise, resource_url, resource_label, done, done_at, sort_order, created_at";

// ============================================================
// 学习计划 CRUD
// ============================================================

#[tauri::command]
pub async fn list_study_plans(
    state: State<'_, DbState>,
    include_archived: Option<bool>,
) -> Result<Vec<StudyPlan>, String> {
    let archived = include_archived.unwrap_or(false);
    with_db(state, move |conn| {
        let sql = if archived {
            "SELECT id, title, goal, days, meta, status, created_at FROM study_plans ORDER BY created_at DESC"
        } else {
            "SELECT id, title, goal, days, meta, status, created_at FROM study_plans WHERE status = 'active' ORDER BY created_at DESC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map([], map_plan)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn delete_plan(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(state, move |conn| {
        // 节点级联删除（外键 ON DELETE CASCADE）
        conn.execute("DELETE FROM study_plans WHERE id = ?1", [id])?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_plan_nodes(
    state: State<'_, DbState>,
    plan_id: i64,
) -> Result<Vec<StudyPlanNode>, String> {
    with_db(state, move |conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {NODE_COLS} FROM study_plan_nodes WHERE plan_id = ?1 ORDER BY parent_id IS NOT NULL, sort_order, id"
        ))?;
        let rows = stmt
            .query_map([plan_id], map_node)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

/// 事务写入整棵树（先清旧节点，按序插入，tmp_id → 真实 id 解析父子关系）
#[tauri::command]
pub async fn save_plan_tree(
    state: State<'_, DbState>,
    plan_id: i64,
    nodes: Vec<PlanNodeInput>,
) -> Result<(), String> {
    with_db(state, move |conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM study_plan_nodes WHERE plan_id = ?1", [plan_id])?;
        let mut id_map: HashMap<String, i64> = HashMap::new();
        for (i, n) in nodes.iter().enumerate() {
            let parent_id = match &n.parent_tmp_id {
                Some(pid) => Some(*id_map.get(pid).ok_or_else(|| {
                    rusqlite::Error::InvalidParameterName(format!("未知的 parent_tmp_id: {pid}"))
                })?),
                None => None,
            };
            tx.execute(
                "INSERT INTO study_plan_nodes
                 (plan_id, parent_id, title, kind, required, content, exercise, resource_url, resource_label, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    plan_id,
                    parent_id,
                    n.title,
                    n.kind,
                    n.required,
                    n.content,
                    n.exercise,
                    n.resource_url,
                    n.resource_label,
                    i as i64
                ],
            )?;
            id_map.insert(n.tmp_id.clone(), tx.last_insert_rowid());
        }
        tx.commit()?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn toggle_plan_node(
    state: State<'_, DbState>,
    id: i64,
    done: bool,
) -> Result<StudyPlanNode, String> {
    with_db(state, move |conn| {
        conn.execute(
            "UPDATE study_plan_nodes SET done = ?1, done_at = CASE WHEN ?1 = 1 THEN datetime('now','localtime') ELSE NULL END WHERE id = ?2",
            rusqlite::params![done, id],
        )?;
        let mut stmt =
            conn.prepare(&format!("SELECT {NODE_COLS} FROM study_plan_nodes WHERE id = ?1"))?;
        stmt.query_row([id], map_node).map_err(Into::into)
    })
    .await
}

#[derive(Deserialize)]
pub struct NodeUpdate {
    pub title: Option<String>,
    pub content: Option<String>,
    pub exercise: Option<String>,
    pub resource_url: Option<String>,
    pub resource_label: Option<String>,
    pub required: Option<bool>,
}

#[tauri::command]
pub async fn update_plan_node(
    state: State<'_, DbState>,
    id: i64,
    fields: NodeUpdate,
) -> Result<StudyPlanNode, String> {
    with_db(state, move |conn| {
        let mut sets = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = &fields.title {
            sets.push("title = ?");
            params.push(Box::new(v.clone()));
        }
        if let Some(v) = &fields.content {
            sets.push("content = ?");
            params.push(Box::new(v.clone()));
        }
        if let Some(v) = &fields.exercise {
            sets.push("exercise = ?");
            params.push(Box::new(v.clone()));
        }
        if let Some(v) = &fields.resource_url {
            sets.push("resource_url = ?");
            params.push(Box::new(v.clone()));
        }
        if let Some(v) = &fields.resource_label {
            sets.push("resource_label = ?");
            params.push(Box::new(v.clone()));
        }
        if let Some(v) = &fields.required {
            sets.push("required = ?");
            params.push(Box::new(*v));
        }
        if !sets.is_empty() {
            let sql = format!(
                "UPDATE study_plan_nodes SET {} WHERE id = ?{}",
                sets.join(", "),
                sets.len() + 1
            );
            let mut p: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
            p.push(&id);
            conn.execute(&sql, rusqlite::params_from_iter(p))?;
        }
        let mut stmt =
            conn.prepare(&format!("SELECT {NODE_COLS} FROM study_plan_nodes WHERE id = ?1"))?;
        stmt.query_row([id], map_node).map_err(Into::into)
    })
    .await
}

// ============================================================
// 知识库命令
// ============================================================

#[tauri::command]
pub async fn seed_kb(state: State<'_, DbState>) -> Result<usize, String> {
    let db = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| e.to_string())?;
        do_seed_kb(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn kb_search(
    state: State<'_, DbState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<KbHit>, String> {
    let limit = limit.unwrap_or(5);
    with_db(state, move |conn| {
        search_kb(conn, &query, limit).map_err(|e| rusqlite::Error::InvalidParameterName(e))
    })
    .await
}

// ============================================================
// AI 命令：规划生成 / 问答 / 出题 / 会话历史
// ============================================================

/// AI 规划生成返回的结构（与提示词约定一致）
#[derive(Deserialize)]
struct AiPlanJson {
    title: String,
    goal: Option<String>,
    days: Vec<AiDayJson>,
}

#[derive(Deserialize)]
struct AiDayJson {
    title: String,
    #[serde(default)]
    tasks: Vec<AiTaskJson>,
}

#[derive(Deserialize)]
struct AiTaskJson {
    title: String,
    #[serde(default = "default_required")]
    required: bool,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    exercise: Option<String>,
    #[serde(default)]
    resource_url: Option<String>,
    #[serde(default)]
    resource_label: Option<String>,
    #[serde(default)]
    sub: Vec<AiTaskJson>,
}

fn default_required() -> bool {
    true
}

/// 把 AI 返回的 JSON 转成保存用输入（day → task → sub，tmp_id 自增）
fn plan_json_to_inputs(plan: &AiPlanJson) -> Vec<PlanNodeInput> {
    let mut inputs = Vec::new();
    let mut next = 0;
    for day in &plan.days {
        let day_tmp = format!("n{next}");
        next += 1;
        inputs.push(PlanNodeInput {
            tmp_id: day_tmp.clone(),
            parent_tmp_id: None,
            title: day.title.clone(),
            kind: "day".into(),
            required: true,
            content: None,
            exercise: None,
            resource_url: None,
            resource_label: None,
        });
        for task in &day.tasks {
            let task_tmp = format!("n{next}");
            next += 1;
            inputs.push(PlanNodeInput {
                tmp_id: task_tmp.clone(),
                parent_tmp_id: Some(day_tmp.clone()),
                title: task.title.clone(),
                kind: "task".into(),
                required: task.required,
                content: task.content.clone(),
                exercise: task.exercise.clone(),
                resource_url: task.resource_url.clone(),
                resource_label: task.resource_label.clone(),
            });
            for sub in &task.sub {
                let sub_tmp = format!("n{next}");
                next += 1;
                inputs.push(PlanNodeInput {
                    tmp_id: sub_tmp,
                    parent_tmp_id: Some(task_tmp.clone()),
                    title: sub.title.clone(),
                    kind: "sub".into(),
                    required: sub.required,
                    content: sub.content.clone(),
                    exercise: sub.exercise.clone(),
                    resource_url: sub.resource_url.clone(),
                    resource_label: sub.resource_label.clone(),
                });
            }
        }
    }
    inputs
}

/// 根据用户画像选择知识库章节关键词做预检索（把相关内容拼进规划提示词）
fn profile_topics(profile: &str) -> &'static [&'static str] {
    let p = profile.to_lowercase();
    if p.contains("mcp") {
        &["mcp", "claude code", "agent"]
    } else if p.contains("vibe") || p.contains("编程") {
        &["vibe coding", "claude code", "提示词"]
    } else if p.contains("rag") || p.contains("知识库") {
        &["rag", "检索", "agent"]
    } else if p.contains("agent") || p.contains("智能体") {
        &["agent", "工具", "mcp"]
    } else {
        &["agent", "mcp", "vibe coding"]
    }
}

/// 组装规划生成提示词（含知识库片段）
fn build_plan_prompt(profile: &str, kb_hits: &[KbHit]) -> String {
    let mut kb_text = String::new();
    for (i, h) in kb_hits.iter().take(5).enumerate() {
        let t = h.title.clone().unwrap_or_default();
        kb_text.push_str(&format!(
            "[{}] {}（{}）\n{}\n\n",
            i + 1,
            t,
            h.chapter,
            h.content.chars().take(400).collect::<String>()
        ));
    }

    format!(
        "你是拾光学习助手的规划引擎。用户想学习「AI Agent 与 vibe coding（AI 辅助编程）」，目标是就业。\
         请根据用户画像规划一个 1-2 周（7-14 天）的小阶段学习计划。\n\n\
         用户画像（JSON）：\n{profile}\n\n\
         参考资料（本地知识库片段，可参考其准确内容）：\n{kb_text}\n\
         硬性要求：\n\
         1. 只输出一个 JSON 对象，不要 markdown 代码围栏，不要任何额外说明。结构：\n\
         {{\"title\": \"计划名\", \"goal\": \"一句话目标\", \"days\": [{{\"title\": \"第 1 天：主题\", \
         \"tasks\": [{{\"title\": \"知识点\", \"required\": true, \"content\": \"讲解 150-400 字\", \
         \"exercise\": \"一道练习\", \"resource_url\": \"https://...或 null\", \"resource_label\": \"链接名\", \
         \"sub\": [{{\"title\": \"细分点\", \"required\": true, \"content\": \"讲解\"}}]}}]}}]}}\n\
         2. 每天 2-4 个任务；required=true 为必学（就业核心），false 为选修（进阶/拓展）。\n\
         3. content 写清核心概念与要点（中文）；exercise 给一道可动手完成的练习。\n\
         4. resource_url 只能放知名公开资料（官方文档等），不确定就 null，宁可少放不可编造。\n\
         5. 任务内容要有递进：原理 → 工具 → 实操 → 项目。\n\
         6. 天数由用户每周可投入时间决定（少于 5 小时给 7 天，多于 10 小时可给 14 天）。"
    )
}

/// 生成学习计划：调 Claude → 校验 JSON → 事务落库
#[tauri::command]
pub async fn generate_study_plan(
    state: State<'_, DbState>,
    ai_state: State<'_, AiState>,
    profile: String,
) -> Result<GenerateResult, String> {
    let db = state.0.clone();
    let ai = AiState(ai_state.0.clone());

    // 根据画像选择预检索关键词（把相关知识库片段拼进规划提示词）
    let query = profile_topics(&profile).join(" ");
    let (prompt0, ai_cfg) = {
        // 短锁：预检索知识库片段 + 读 AI 提供方配置
        let (hits, ai_cfg) = with_conn(&db, |conn| {
            let hits = search_kb(conn, &query, 6)
                .map_err(|e| rusqlite::Error::InvalidParameterName(e))?;
            let ai_cfg = load_ai_config(conn)?;
            Ok((hits, ai_cfg))
        })?;
        (build_plan_prompt(&profile, &hits), ai_cfg)
    };

    let plan_json = tauri::async_runtime::spawn_blocking(move || {
        let mut last_err = String::new();
        // 最多重试一次（模型偶发输出非法 JSON）
        for attempt in 0..2 {
            let prompt = if attempt == 0 {
                prompt0.clone()
            } else {
                format!("{prompt0}\n\n注意：上次输出无法解析，请只输出合法的 JSON 对象，不要任何其他文字。")
            };
            // 计划生成输出量大，模型首 token 可能耗时 1 分半（实测 ~180s 完成），超时放宽到 240s
            let raw = run_ai_blocking(&ai, &ai_cfg, &prompt, 240, None)?;
            match serde_json::from_str::<AiPlanJson>(raw.trim()) {
                Ok(p) => return Ok(p),
                Err(e) => {
                    last_err = format!("AI 输出无法解析为计划 JSON：{e}");
                }
            }
        }
        Err(last_err)
    })
    .await
    .map_err(|e| format!("规划生成失败：{e}"))??;

    // 落库：计划 + 整棵树（事务）
    let title = plan_json.title.clone();
    let goal = plan_json.goal.clone();
    let days = plan_json.days.len() as i64;
    let inputs = plan_json_to_inputs(&plan_json);
    let (plan_id, node_count) = with_conn(&db, move |conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO study_plans (title, goal, days, meta, status) VALUES (?1, ?2, ?3, ?4, 'active')",
            rusqlite::params![title, goal, days, profile.clone()],
        )?;
        let pid = tx.last_insert_rowid();
        let mut id_map: HashMap<String, i64> = HashMap::new();
        for (i, n) in inputs.iter().enumerate() {
            let parent_id = match &n.parent_tmp_id {
                Some(pid2) => Some(*id_map.get(pid2).ok_or_else(|| {
                    rusqlite::Error::InvalidParameterName("未知 parent_tmp_id".into())
                })?),
                None => None,
            };
            tx.execute(
                "INSERT INTO study_plan_nodes (plan_id, parent_id, title, kind, required, content, exercise, resource_url, resource_label, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    pid, parent_id, n.title, n.kind, n.required, n.content, n.exercise,
                    n.resource_url, n.resource_label, i as i64
                ],
            )?;
            id_map.insert(n.tmp_id.clone(), tx.last_insert_rowid());
        }
        tx.commit()?;
        Ok((pid, id_map.len()))
    })?;

    Ok(GenerateResult {
        plan_id,
        node_count,
    })
}

/// 问答：RAG 检索 → 拼历史 → 调 Claude → 落库会话
/// session_id：会话隔离（首页总览用 "overview-home"，学习任务用默认 "main"），可选
#[tauri::command]
pub async fn ai_ask(
    state: State<'_, DbState>,
    ai_state: State<'_, AiState>,
    question: String,
    session_id: Option<String>,
) -> Result<AskResult, String> {
    let db = state.0.clone();
    let ai = AiState(ai_state.0.clone());
    let session = session_id.unwrap_or_else(|| "main".to_string());
    let session_read = session.clone();
    let question_read = question.clone();

    // 短锁：检索 + 读最近历史 + 读 AI 提供方配置
    let (hits, history, ai_cfg) = with_conn(&db, move |conn| {
        let hits = search_kb(conn, &question_read, 5)
            .map_err(|e| rusqlite::Error::InvalidParameterName(e))?;
        let mut stmt = conn.prepare(
            "SELECT role, content FROM ai_messages WHERE session_id = ?1 ORDER BY id DESC LIMIT 10",
        )?;
        let rows = stmt
            .query_map([&session_read], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let ai_cfg = load_ai_config(conn)?;
        Ok((hits, rows, ai_cfg))
    })?;

    let mut kb_text = String::new();
    for (i, h) in hits.iter().enumerate() {
        let t = h.title.clone().unwrap_or_default();
        kb_text.push_str(&format!("[{}] {}（{}）\n{}\n\n", i + 1, t, h.chapter, h.content));
    }
    let mut hist_text = String::new();
    for (role, content) in history.iter().rev().take(10) {
        hist_text.push_str(&format!("{role}: {}\n", content.chars().take(200).collect::<String>()));
    }

    let prompt = format!(
        "你是拾光的学习助手「小拾」，帮助用户学习 AI Agent 与 vibe coding。回答用中文、简洁、可分点。\n\n\
         参考资料（本地知识库检索，最多 5 段）：\n{kb_text}\n\
         对话历史（最近若干条）：\n{hist_text}\n\
         用户问题：{question}\n\n\
         规则：优先基于参考资料回答；资料不足时先说明「知识库未覆盖」，再结合常识补充；不要编造链接。"
    );

    let answer =
        tauri::async_runtime::spawn_blocking(move || run_ai_blocking(&ai, &ai_cfg, &prompt, 60, None))
            .await
            .map_err(|e| format!("AI 调用失败：{e}"))??;

    // 落库会话（按传入的 session_id 隔离）
    let answer_saved = answer.clone();
    let session_save = session.clone();
    with_conn(&db, move |conn| {
        conn.execute(
            "INSERT INTO ai_messages (session_id, role, content) VALUES (?1, 'user', ?2)",
            rusqlite::params![session_save, question.clone()],
        )?;
        conn.execute(
            "INSERT INTO ai_messages (session_id, role, content) VALUES (?1, 'assistant', ?2)",
            rusqlite::params![session_save, answer_saved],
        )?;
        Ok(())
    })?;

    Ok(AskResult { answer, sources: hits })
}

/// 出题：基于节点内容生成一道面试题
#[tauri::command]
pub async fn ai_quiz(
    state: State<'_, DbState>,
    ai_state: State<'_, AiState>,
    node_id: i64,
) -> Result<Quiz, String> {
    let db = state.0.clone();
    let ai = AiState(ai_state.0.clone());

    // 短锁：读节点 + 读 AI 提供方配置
    let (node, ai_cfg) = with_conn(&db, move |conn| {
        let node = conn.query_row(
            &format!("SELECT {NODE_COLS} FROM study_plan_nodes WHERE id = ?1"),
            [node_id],
            map_node,
        )?;
        let ai_cfg = load_ai_config(conn)?;
        Ok((node, ai_cfg))
    })?;

    let content = node
        .content
        .clone()
        .unwrap_or_default()
        .chars()
        .take(800)
        .collect::<String>();
    let prompt = format!(
        "你是拾光的面试官。基于下面的学习内容，出一道 AI Agent / vibe coding 方向的面试题，\
         难度与就业水平匹配，考察概念理解或场景应用。\n\n\
         知识点：{}\n内容：{}\n\n\
         要求简洁：题目 50 字内，参考答案 150 字内。\n\
         只输出一个 JSON 对象，不要围栏，不要额外文字：\
         {{\"question\": \"题目（含场景描述）\", \"answer\": \"参考答案 150 字内\"}}",
        node.title, content
    );

    // max_tokens=700：限制输出长度，避免模型长篇大论拖慢出题
    let raw = tauri::async_runtime::spawn_blocking(move || run_ai_blocking(&ai, &ai_cfg, &prompt, 60, Some(700)))
        .await
        .map_err(|e| format!("AI 调用失败：{e}"))??;

    let v: serde_json::Value = serde_json::from_str(raw.trim())
        .map_err(|e| format!("AI 输出无法解析为题目：{e}"))?;
    let question = v
        .get("question")
        .and_then(|q| q.as_str())
        .ok_or_else(|| "AI 输出缺少 question 字段".to_string())?
        .to_string();
    let model_answer = v
        .get("answer")
        .and_then(|q| q.as_str())
        .ok_or_else(|| "AI 输出缺少 answer 字段".to_string())?
        .to_string();
    Ok(Quiz {
        question,
        model_answer,
    })
}

#[tauri::command]
pub async fn ai_list_history(
    state: State<'_, DbState>,
    session_id: Option<String>,
) -> Result<Vec<AiMessage>, String> {
    let session = session_id.unwrap_or_else(|| "main".to_string());
    with_db(state, move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, created_at FROM ai_messages WHERE session_id = ?1 ORDER BY id",
        )?;
        let rows = stmt
            .query_map([session], |r| {
                Ok(AiMessage {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    role: r.get(2)?,
                    content: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn ai_clear_history(
    state: State<'_, DbState>,
    session_id: Option<String>,
) -> Result<(), String> {
    let session = session_id.unwrap_or_else(|| "main".to_string());
    with_db(state, move |conn| {
        conn.execute("DELETE FROM ai_messages WHERE session_id = ?1", [session])?;
        Ok(())
    })
    .await
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate_for_tests;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate_for_tests(&conn).unwrap();
        conn
    }

    #[test]
    fn plan_tree_save_and_list() {
        let conn = test_db();
        // 建计划
        conn.execute(
            "INSERT INTO study_plans (title, goal, days) VALUES ('测试计划', '目标', 3)",
            [],
        )
        .unwrap();
        let plan_id = conn.last_insert_rowid();

        // 用 PlanNodeInput 保存一棵树
        let nodes = vec![
            PlanNodeInput {
                tmp_id: "d1".into(),
                parent_tmp_id: None,
                title: "第 1 天：原理".into(),
                kind: "day".into(),
                required: true,
                content: None,
                exercise: None,
                resource_url: None,
                resource_label: None,
            },
            PlanNodeInput {
                tmp_id: "t1".into(),
                parent_tmp_id: Some("d1".into()),
                title: "Agent 原理".into(),
                kind: "task".into(),
                required: true,
                content: Some("讲解".into()),
                exercise: Some("练习".into()),
                resource_url: Some("https://example.com".into()),
                resource_label: Some("文档".into()),
            },
            PlanNodeInput {
                tmp_id: "s1".into(),
                parent_tmp_id: Some("t1".into()),
                title: "ReAct 模式".into(),
                kind: "sub".into(),
                required: false,
                content: None,
                exercise: None,
                resource_url: None,
                resource_label: None,
            },
        ];
        // 模拟 save_plan_tree 的事务插入：tmp_id → 真实 id 映射，按序解析父子
        let tx = conn.unchecked_transaction().unwrap();
        let mut id_map: HashMap<String, i64> = HashMap::new();
        for (i, n) in nodes.iter().enumerate() {
            let parent_id = n.parent_tmp_id.as_ref().map(|p| *id_map.get(p).unwrap());
            tx.execute(
                "INSERT INTO study_plan_nodes (plan_id, parent_id, title, kind, required, content, exercise, resource_url, resource_label, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![plan_id, parent_id, n.title, n.kind, n.required, n.content, n.exercise, n.resource_url, n.resource_label, i as i64],
            )
            .unwrap();
            id_map.insert(n.tmp_id.clone(), tx.last_insert_rowid());
        }
        tx.commit().unwrap();

        // 整树能查回，层级正确
        let rows: Vec<(String, Option<i64>)> = conn
            .prepare("SELECT title, parent_id FROM study_plan_nodes WHERE plan_id = ?1 ORDER BY sort_order")
            .unwrap()
            .query_map([plan_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].0, "第 1 天：原理");
        assert!(rows[0].1.is_none()); // day 是根
        assert_eq!(rows[1].0, "Agent 原理");
        assert_eq!(rows[1].1, Some(id_map["d1"])); // task 挂在 day 下
        assert_eq!(rows[2].1, Some(id_map["t1"])); // sub 挂在 task 下
    }

    #[test]
    fn plan_json_to_inputs_shape() {
        let plan = AiPlanJson {
            title: "计划".into(),
            goal: Some("目标".into()),
            days: vec![AiDayJson {
                title: "第 1 天".into(),
                tasks: vec![AiTaskJson {
                    title: "MCP 入门".into(),
                    required: true,
                    content: Some("内容".into()),
                    exercise: Some("练习".into()),
                    resource_url: None,
                    resource_label: None,
                    sub: vec![AiTaskJson {
                        title: "协议".into(),
                        required: false,
                        content: None,
                        exercise: None,
                        resource_url: None,
                        resource_label: None,
                        sub: vec![],
                    }],
                }],
            }],
        };
        let inputs = plan_json_to_inputs(&plan);
        assert_eq!(inputs.len(), 3); // day + task + sub
        assert_eq!(inputs[0].kind, "day");
        assert!(inputs[0].parent_tmp_id.is_none());
        assert_eq!(inputs[1].parent_tmp_id.as_deref(), Some("n0"));
        assert_eq!(inputs[2].parent_tmp_id.as_deref(), Some("n1"));
    }

    #[test]
    fn profile_topics_mapping() {
        assert!(profile_topics("我想学 MCP 和智能体").contains(&"mcp"));
        assert!(profile_topics("vibe coding 编程").contains(&"vibe coding"));
    }
}
