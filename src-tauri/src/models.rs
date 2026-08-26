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
