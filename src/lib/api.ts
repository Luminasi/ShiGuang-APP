/**
 * 前端数据访问层：封装后端命令调用（阶段 1）
 *
 * 界面组件不直接写 SQL，统一通过这里的函数读写数据。
 * 函数签名与 src-tauri/src/commands.rs 一一对应。
 */

import { invoke } from "@tauri-apps/api/core";

// ---------- 类型定义（与后端 models.rs 一致） ----------

export interface Subject {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface StudyTask {
  id: number;
  subject_id: number;
  title: string;
  done: boolean;
  done_at: string | null;
  created_at: string;
}

export interface PlanItem {
  id: number;
  plan_date: string; // YYYY-MM-DD
  title: string;
  start_min: number; // 当天第几分钟（0~1439）
  duration_min: number;
  done: boolean;
  sort_order: number;
  created_at: string;
}

export interface Game {
  id: number;
  source: string; // steam | scanned
  external_id: string | null;
  name: string;
  exe_path: string | null;
  image_path: string | null;
  last_played_at: string | null;
  created_at: string;
}

export interface GameSession {
  id: number;
  game_id: number;
  started_at: string;
  duration_min: number;
  goal_min: number | null;
  note: string | null;
  created_at: string;
}

export interface WalkRecord {
  id: number;
  date: string; // YYYY-MM-DD
  duration_min: number;
  started_at: string | null;
  note: string | null;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
}

/** 扫描到的 Steam 游戏 */
export interface SteamGameInfo {
  appid: string;
  name: string;
  installdir: string;
}

/** 扫描到的本机程序 */
export interface ScannedProgram {
  name: string;
  install_location: string | null;
  display_icon: string | null;
  publisher: string | null;
}

/** 一款游戏的累计统计 */
export interface GameStats {
  game_id: number;
  total_min: number;
  sessions: number;
}

/** 进行中的游戏计时 */
export interface GameTimerInfo {
  game_id: number;
  game_name: string;
  started_at: string;
  goal_min: number;
  elapsed_min: number;
  remaining_min: number;
}

// ---------- 科目（阶段 3） ----------

export const listSubjects = () => invoke<Subject[]>("list_subjects");
export const addSubject = (name: string) =>
  invoke<Subject>("add_subject", { name });
export const renameSubject = (id: number, name: string) =>
  invoke<void>("rename_subject", { id, name });
export const deleteSubject = (id: number) =>
  invoke<void>("delete_subject", { id });

// ---------- 学习任务（阶段 3） ----------

export const listTasks = (subjectId: number) =>
  invoke<StudyTask[]>("list_tasks", { subjectId });
export const addTask = (subjectId: number, title: string) =>
  invoke<StudyTask>("add_task", { subjectId, title });
export const toggleTask = (id: number, done: boolean) =>
  invoke<StudyTask>("toggle_task", { id, done });
export const renameTask = (id: number, title: string) =>
  invoke<void>("rename_task", { id, title });
export const deleteTask = (id: number) => invoke<void>("delete_task", { id });

// ---------- 今日计划（阶段 2） ----------

export const listPlans = (planDate: string) =>
  invoke<PlanItem[]>("list_plans", { planDate });
export const addPlanItem = (
  planDate: string,
  title: string,
  startMin: number,
  durationMin: number,
) => invoke<PlanItem>("add_plan_item", { planDate, title, startMin, durationMin });
export const updatePlanItem = (
  id: number,
  opts: { title?: string; startMin?: number; durationMin?: number },
) => invoke<PlanItem>("update_plan_item", { id, ...opts });
export const togglePlanItem = (id: number, done: boolean) =>
  invoke<PlanItem>("toggle_plan_item", { id, done });
export const deletePlanItem = (id: number) =>
  invoke<void>("delete_plan_item", { id });

// ---------- 游戏库（阶段 4） ----------

export const listGames = () => invoke<Game[]>("list_games");
export const addGame = (g: {
  source: string;
  externalId?: string | null;
  name: string;
  exePath?: string | null;
  imagePath?: string | null;
}) => invoke<Game>("add_game", { source: g.source, externalId: g.externalId, name: g.name, exePath: g.exePath, imagePath: g.imagePath });
export const touchGame = (id: number, lastPlayedAt: string) =>
  invoke<void>("touch_game", { id, lastPlayedAt });
export const deleteGame = (id: number) => invoke<void>("delete_game", { id });
export const updateGamePath = (id: number, exePath: string) =>
  invoke<void>("update_game_path", { id, exePath });
export const launchGame = (id: number) =>
  invoke<string>("launch_game", { id });

// ---------- 游戏游玩记录（阶段 4） ----------

export const listSessions = (gameId: number) =>
  invoke<GameSession[]>("list_sessions", { gameId });
export const addSession = (s: {
  gameId: number;
  startedAt: string;
  durationMin: number;
  goalMin?: number | null;
  note?: string | null;
}) => invoke<GameSession>("add_session", { gameId: s.gameId, startedAt: s.startedAt, durationMin: s.durationMin, goalMin: s.goalMin, note: s.note });
export const deleteSession = (id: number) =>
  invoke<void>("delete_session", { id });

// ---------- 游戏扫描与导入（阶段 4） ----------

export const scanSteamGames = () => invoke<SteamGameInfo[]>("scan_steam_games");
export const scanPrograms = () => invoke<ScannedProgram[]>("scan_programs");
export const importGames = (source: string, games: { externalId?: string | null; name: string; exePath?: string | null }[]) =>
  invoke<number>("import_games", {
    source,
    games: games.map((g) => ({
      externalId: g.externalId ?? null,
      name: g.name,
      exePath: g.exePath ?? null,
    })),
  });
export const gameStats = () => invoke<GameStats[]>("game_stats");

// ---------- 游戏计时（阶段 4） ----------

export const getGameTimer = () => invoke<GameTimerInfo | null>("get_game_timer");
export const startGameTimer = (gameId: number, goalMin: number) =>
  invoke<GameTimerInfo>("start_game_timer", { gameId, goalMin });
export const stopGameTimer = (gameId: number) =>
  invoke<GameSession>("stop_game_timer", { gameId });
export const cancelGameTimer = (gameId: number) =>
  invoke<void>("cancel_game_timer", { gameId });

// ---------- 散步记录（阶段 5） ----------

export const listWalks = (fromDate: string, toDate: string) =>
  invoke<WalkRecord[]>("list_walks", { fromDate, toDate });
export const addWalk = (w: {
  date: string;
  durationMin: number;
  startedAt?: string | null;
  note?: string | null;
}) => invoke<WalkRecord>("add_walk", { date: w.date, durationMin: w.durationMin, startedAt: w.startedAt, note: w.note });
export const deleteWalk = (id: number) => invoke<void>("delete_walk", { id });

// ---------- 设置 ----------

export const getSetting = (key: string) =>
  invoke<string | null>("get_setting", { key });
export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });
export const listSettings = () => invoke<Setting[]>("list_settings");

// ---------- AI 设置（阶段 7：OpenAI 兼容网关直连） ----------

/** 设置回显（api_key 不回传完整值，仅 has_api_key + 末 4 位） */
export interface AiSettingsView {
  provider: string; // "cli" | "openai"
  base_url: string;
  model: string;
  has_api_key: boolean;
  api_key_tail: string;
}

/** 设置写入（api_key 为 null 或空 = 不修改已保存的密钥） */
export interface AiSettingsInput {
  provider: string;
  base_url: string;
  model: string;
  api_key: string | null;
}

export const getAiSettings = () => invoke<AiSettingsView>("get_ai_settings");
export const setAiSettings = (input: AiSettingsInput) =>
  invoke<void>("set_ai_settings", { input });
/** 测试连接：草稿参数未保存也能测（返回模型回复前 50 字符） */
export const testAiConnection = (input: AiSettingsInput) =>
  invoke<string>("test_ai_connection", { input });

// ---------- 学习计划与任务树（阶段 7） ----------

export interface StudyPlan {
  id: number;
  title: string;
  goal: string | null;
  days: number;
  meta: string | null;
  status: string; // active | archived
  created_at: string;
}

export interface StudyPlanNode {
  id: number;
  plan_id: number;
  parent_id: number | null;
  title: string;
  kind: string; // day | task | sub
  required: boolean;
  content: string | null;
  exercise: string | null;
  resource_url: string | null;
  resource_label: string | null;
  done: boolean;
  done_at: string | null;
  sort_order: number;
  created_at: string;
}

/** 保存整棵树时的节点输入（tmp_id 引用父子） */
export interface PlanNodeInput {
  tmp_id: string;
  parent_tmp_id: string | null;
  title: string;
  kind: string;
  required: boolean;
  content: string | null;
  exercise: string | null;
  resource_url: string | null;
  resource_label: string | null;
}

export const listStudyPlans = (includeArchived = false) =>
  invoke<StudyPlan[]>("list_study_plans", { includeArchived });
export const deletePlan = (id: number) => invoke<void>("delete_plan", { id });
export const listPlanNodes = (planId: number) =>
  invoke<StudyPlanNode[]>("list_plan_nodes", { planId });
export const savePlanTree = (planId: number, nodes: PlanNodeInput[]) =>
  invoke<void>("save_plan_tree", { planId, nodes });
export const togglePlanNode = (id: number, done: boolean) =>
  invoke<StudyPlanNode>("toggle_plan_node", { id, done });
export const updatePlanNode = (
  id: number,
  fields: Partial<{
    title: string;
    content: string;
    exercise: string;
    resource_url: string;
    resource_label: string;
    required: boolean;
  }>,
) => invoke<StudyPlanNode>("update_plan_node", { id, fields });

// ---------- 学习 AI 助手（阶段 7） ----------

export interface KbChunk {
  id: number;
  chapter: string;
  title: string | null;
  content: string;
  ord: number;
}

export interface AiMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface KbHit {
  chapter: string;
  title: string | null;
  content: string;
  score: number;
}

export interface Quiz {
  question: string;
  model_answer: string;
}

export interface AskResult {
  answer: string;
  sources: KbHit[];
}

export interface GenerateResult {
  plan_id: number;
  node_count: number;
}

/** 生成学习计划（AI 调用，耗时 10-60s） */
export const generateStudyPlan = (profile: string) =>
  invoke<GenerateResult>("generate_study_plan", { profile });
/** AI 问答（含知识库检索）；sessionId 缺省 "main"，首页总览传 "overview-home" 隔离历史 */
export const aiAsk = (question: string, sessionId?: string) =>
  invoke<AskResult>("ai_ask", { question, sessionId: sessionId ?? null });
/** 基于节点内容出面试题 */
export const aiQuiz = (nodeId: number) =>
  invoke<Quiz>("ai_quiz", { nodeId });
export const aiListHistory = (sessionId?: string) =>
  invoke<AiMessage[]>("ai_list_history", { sessionId: sessionId ?? null });
export const aiClearHistory = (sessionId?: string) =>
  invoke<void>("ai_clear_history", { sessionId: sessionId ?? null });

// ---------- 知识库（阶段 7） ----------

export const seedKb = () => invoke<number>("seed_kb");
export const kbSearch = (query: string, limit?: number) =>
  invoke<KbHit[]>("kb_search", { query, limit: limit ?? 5 });

// ---------- 首页总览对话总结与历史（阶段 8） ----------

/** 一段归档的历史对话（退出应用时自动总结保存） */
export interface OverviewSession {
  id: number;
  summary: string;
  created_at: string;
}

/** AI 总结一段对话（退出归档用，后端超时上限 30s） */
export const summarizeChat = (conversation: string) =>
  invoke<string>("summarize_chat", { conversation });
export const saveOverviewSummary = (summary: string) =>
  invoke<OverviewSession>("save_overview_summary", { summary });
export const listOverviewSessions = () =>
  invoke<OverviewSession[]>("list_overview_sessions");
export const deleteOverviewSummary = (id: number) =>
  invoke<void>("delete_overview_summary", { id });
