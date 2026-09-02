# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 拾光 ShiGuang

Windows 桌面个人生活管理应用（今日计划 / 学习任务 / 游戏娱乐 / 散步遛狗）：完全本地运行、离线可用、数据本机保存。Tauri 2 桌面壳 + React 前端 + Rust 后端 + SQLite 存储，无任何外部服务。

## 常用命令

```bash
npm run tauri dev     # 开发模式：编译 Rust 后端并启动窗口（唯一运行方式）
npm run tauri build   # 构建安装包，产物在 src-tauri/target/release/bundle/
cd src-tauri && cargo test   # 运行 Rust 单测（db / reminders / steam / scanner / timers）
```

注意：浏览器直接打开 `index.html` 无效——所有数据操作走 Tauri `invoke`，必须通过 `npm run tauri dev` 运行。

## 提交约定

每完成一个新功能：提交到本地 git 并推送远程 GitHub（`origin/main`，仓库 ShiGuang-APP）。提交信息格式 `拾光 vX.Y.Z：主题`（中文，尾行 Co-Authored-By: Claude Code）。

## 架构约定

1. **前后端边界**：前端不写 SQL。所有数据操作统一走 [src/lib/api.ts](src/lib/api.ts) 的 `invoke` 封装 → 后端 `#[tauri::command]`（注册见 [src-tauri/src/lib.rs](src-tauri/src/lib.rs)）。新增数据功能 = 后端命令 + `api.ts` 封装两步，命令注册在 `lib.rs` 的 `generate_handler!` 中。
2. **后端执行方式**：命令经 `with_db` 在 `spawn_blocking` 后台线程执行（[commands.rs:21-33](src-tauri/src/commands.rs#L21-L33)），`DbState` 由 `app.manage` 注入（[lib.rs:18-19](src-tauri/src/lib.rs#L18-L19)）。
3. **视图切换无路由库**：`useState` 切换（[App.tsx:12,18-27](src/App.tsx#L12)）+ [src/modules.ts](src/modules.ts) 模块注册表。新模块流程：`modules.ts` 加 `AppModule` → `App.tsx` switch 加 case → 新建组件；未开发模块显示 `PlaceholderView`。
4. **后台任务模式**（提醒 [reminders.rs](src-tauri/src/reminders.rs)、游戏计时 [timers.rs](src-tauri/src/timers.rs)）：独立线程轮询查库（10~20 秒间隔）→ 桌面通知（tauri-plugin-notification）→ 前端事件（如 `plan-reminder`）弹横幅。计时状态持久化，重启自动恢复。
5. **阶段标记**：开发按「阶段 N」推进（1 数据层 → 6 主题设置），代码注释沿用此标记（如 `db.rs` 建表处、`api.ts` 分组处），新代码保持。
6. **占位行为**：顶部状态栏三个入口（用户/设置/使用说明）未开放，点击弹「开发中」toast（[App.tsx:43-50](src/App.tsx#L43-L50)），新增入口前先实现功能。

## 数据层

- SQLite（rusqlite bundled，WAL 模式），数据库路径 `%APPDATA%\com.shiguang.app\shiguang.db`
- 8 张表：`subjects`、`study_tasks`、`plan_items`、`games`、`game_sessions`、`game_timers`、`walk_records`、`settings`（建表见 [db.rs:53-147](src-tauri/src/db.rs#L53-L147)）
- 轻量迁移模式：`ensure_column`（[db.rs:33-50](src-tauri/src/db.rs#L33-L50)）——加列用它而非重建表
- 模型对照：[models.rs](src-tauri/src/models.rs)（Rust struct）↔ [api.ts](src/lib/api.ts)（TS interface），字段一一对应

## 目录结构

- [src/](src/) — 前端：`App.tsx` 视图切换、`modules.ts` 模块注册表、`lib/api.ts` 数据封装、`lib/time.ts` 时间工具、`lib/posters.ts` 游戏海报匹配、`components/` 各视图组件（`PlanView`、`GameView`、`StatusBar`、`NavBar` 等）
- [src-tauri/src/](src-tauri/src/) — 后端：`db.rs` 连接与建表、`models.rs` 模型、`commands.rs` 业务命令、`reminders.rs` / `timers.rs` 后台线程、`steam.rs` / `scanner.rs` 游戏库扫描

## 风格约定

- 注释、UI 文案、提交信息一律中文；提交信息格式如「拾光 v0.1.0：骨架、数据层、今日计划、游戏娱乐」
- 图标统一用 `lucide-react`
- 色板是 [App.css](src/App.css) 顶部 token 变量块（三场景 `:root[data-scene="rain|snow|cloud"]`，改色先改这里）；旧硬编码色由文件末尾「主题覆写层」覆盖，新样式也写在那里
- 视图文件体量较大（PlanView 302 行、GameView 746 行），新视图沿用同风格的组件内自组织，不强行拆分

## 当前进度速查（2026-09）

- **已实现**：数据层、今日计划、游戏娱乐（含开机动画、Steam/本机程序扫描导入、持久化计时器、历史统计、像素跑酷）、学习任务（AI 助手/任务树/出题）、AI 设置（提供方配置）、三场景主题系统（雨林/雪日/暖云 + 状态栏切换器 + 雨雪雾粒子背景）、首页总览（bloub 吉祥物 + AI 对话）
- **后端/数据就绪、缺 UI**：散步（walk，`walk_records` 表与命令已存在）
- **未开始**：数据备份导出
- 主题系统（阶段 6）：`<html data-scene>` 驱动 CSS 变量；场景持久化于 `localStorage.shiguang_scene`；切换器在状态栏，背景三层渲染在 [SceneBackground.tsx](src/components/SceneBackground.tsx)（远景虚化层 + 主图 contain + 粒子画布；窗玻璃特效/光池挂在主图层内随图视差）。三场景共用 [public/scenes/cabin-dusk.jpg](public/scenes/cabin-dusk.jpg)，全部天气参数（滤镜/粒子/视差/光池）集中在组件顶部 `SCENE_CFG`，替换素材只改 `image` 与构图坐标
- 吉祥物与首页总览（阶段 8）：bloub 开源引擎（github.com/jeremy-prt/bloub，MIT）原样移植至 [src/mascot/](src/mascot/)（逐帧测量数值禁止改动，见文件头注释）；场景配色 rain=绿 / snow=白 / cloud=黄 由 [Mascot.tsx](src/components/mascot/Mascot.tsx) 的 `SCENE_COLOR` 映射（snow 用新增 'blanc'，paper 色随 `--bg`）；首页总览 [OverviewView.tsx](src/components/overview/OverviewView.tsx) 含 AI 对话（复用 `ai_ask`，会话隔离 "overview-home"）；学习模块两处精灵球已替换为吉祥物（AiBubble / PlanGenerating）
- 后端单测覆盖 db / reminders / steam / scanner / timers；前端无测试框架
