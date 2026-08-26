# 拾光 ShiGuang

> 生活管理助手 · Windows 桌面应用 —— 管理你的今日计划、学习、游戏与散步时光。

「拾光」是一款完全本地运行的个人生活管理应用：离线可用、数据本机保存、重启不丢。

## 功能

- **首页总览**（规划中）：各模块今日状态卡片
- **今日计划**：输入事项与时长，自动排成一天的时间轴；可拖动调整顺序与时长；到点桌面提醒；按日期翻看回顾
- **学习任务**：按科目管理，科目下任务清单与勾选（暂缓中）
- **游戏娱乐**：开机动画 → 读取 Steam 已安装游戏 + 扫描本机程序（勾选导入）→ 全屏海报舞台 → 设置游玩时长计时（剩余 5 分钟提醒、到点自动记录）→ 每款游戏的历史记录与累计时长；可手动设置本机游戏的启动路径
- **散步遛狗**（规划中）：散步计时、每日目标、周/月统计

## 技术栈

- [Tauri 2](https://tauri.app/)（Rust 后端 + Windows WebView2）
- React 18 + TypeScript + Vite
- SQLite（rusqlite bundled，WAL 模式）

## 开发运行

```bash
npm install          # 安装前端依赖
npm run tauri dev    # 开发模式（自动编译 Rust 后端并启动窗口）
```

需要 Rust 工具链（`rustup`）与 Node.js 18+。

## 数据

所有数据保存在本机 SQLite 数据库：

```
%APPDATA%\com.shiguang.app\shiguang.db
```

刷新、重启、关机后数据不丢失。

## 构建安装包

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/`。
