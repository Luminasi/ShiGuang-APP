//! 数据模型：与数据库表一一对应，用于前后端传参
//! 所有字段与 db.rs 中的建表语句保持一致。

use serde::{Deserialize, Serialize};

/// 学习科目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subject {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
}

/// 科目下的学习任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyTask {
    pub id: i64,
    pub subject_id: i64,
    pub title: String,
    pub done: bool,
    pub done_at: Option<String>,
    pub created_at: String,
}

/// 今日计划事项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanItem {
    pub id: i64,
    pub plan_date: String, // YYYY-MM-DD
    pub title: String,
    pub start_min: i64,     // 当天第几分钟（0~1439）
    pub duration_min: i64,  // 时长（分钟）
    pub done: bool,
    pub sort_order: i64,
    pub created_at: String,
}

/// 游戏库中的一款游戏
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Game {
    pub id: i64,
    pub source: String, // steam | scanned
    pub external_id: Option<String>,
    pub name: String,
    pub exe_path: Option<String>,
    pub image_path: Option<String>,
    pub last_played_at: Option<String>,
    pub created_at: String,
}

/// 一次游戏游玩记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSession {
    pub id: i64,
    pub game_id: i64,
    pub started_at: String,
    pub duration_min: i64,
    pub goal_min: Option<i64>,
    pub note: Option<String>,
    pub created_at: String,
}

/// 一次散步记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalkRecord {
    pub id: i64,
    pub date: String, // YYYY-MM-DD
    pub duration_min: i64,
    pub started_at: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
}

/// 应用设置（键值对）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

// ---------- 学习任务模块（阶段 7） ----------

/// AI 生成的一次学习计划（1-2 周小阶段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyPlan {
    pub id: i64,
    pub title: String,
    pub goal: Option<String>,
    pub days: i64,
    pub meta: Option<String>,
    pub status: String, // active | archived
    pub created_at: String,
}

/// 计划任务树节点：parent_id + sort_order 构成树，kind 分层 day → task → sub
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyPlanNode {
    pub id: i64,
    pub plan_id: i64,
    pub parent_id: Option<i64>,
    pub title: String,
    pub kind: String, // day | task | sub
    pub required: bool,
    pub content: Option<String>,
    pub exercise: Option<String>,
    pub resource_url: Option<String>,
    pub resource_label: Option<String>,
    pub done: bool,
    pub done_at: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

/// 保存整棵树时的节点输入：tmp_id 用于前端引用，后端解析成真实 parent_id
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanNodeInput {
    pub tmp_id: String,
    pub parent_tmp_id: Option<String>, // None = 根（day 节点）
    pub title: String,
    pub kind: String,
    pub required: bool,
    pub content: Option<String>,
    pub exercise: Option<String>,
    pub resource_url: Option<String>,
    pub resource_label: Option<String>,
}

/// 知识库分块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KbChunk {
    pub id: i64,
    pub chapter: String,
    pub title: Option<String>,
    pub content: String,
    pub ord: i64,
}

/// AI 助手会话消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

/// 检索命中结果（仅向前端返回）
#[derive(Debug, Clone, Serialize)]
pub struct KbHit {
    pub chapter: String,
    pub title: Option<String>,
    pub content: String,
    pub score: f64,
}

/// AI 出题结果
#[derive(Debug, Clone, Serialize)]
pub struct Quiz {
    pub question: String,
    pub model_answer: String,
}

/// 问答结果：答案 + 知识库来源（供前端展示）
#[derive(Debug, Clone, Serialize)]
pub struct AskResult {
    pub answer: String,
    pub sources: Vec<KbHit>,
}

/// 生成计划的返回：新计划 id 与节点总数
#[derive(Debug, Clone, Serialize)]
pub struct GenerateResult {
    pub plan_id: i64,
    pub node_count: usize,
}
