import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronLeft,
  Clock,
  Gamepad2,
  GraduationCap,
  LayoutGrid,
  PawPrint,
  ShieldCheck,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface HelpPage {
  icon: LucideIcon;
  title: string;
  body: string;
  hints?: string[];
}

const PAGES: HelpPage[] = [
  {
    icon: ShieldCheck,
    title: "欢迎使用拾光",
    body: "拾光是一个完全本地运行的桌面生活应用：今日计划、学习任务、游戏娱乐、散步遛狗。所有数据只保存在你自己的电脑里，离线也能用，不会上传任何东西。",
    hints: [
      "今日计划：规划一天的时间",
      "学习任务：AI 助手规划学习 · 任务树 · 面试出题",
      "游戏娱乐：游戏时长记录与统计",
      "散步遛狗：出门与遛狗记录",
    ],
  },
  {
    icon: Clock,
    title: "顶部状态栏",
    body: "窗口最顶端一栏。左边是「用户 / 设置 / 使用说明」三个入口，中间实时显示北京时间，右边是最小化、最大化、关闭窗口的按钮。",
    hints: ["点「使用说明」随时可以回到这个页面"],
  },
  {
    icon: LayoutGrid,
    title: "左侧导航栏",
    body: "屏幕最左侧那一排竖着的小图标就是模块导航，从上到下依次是：首页总览、今日计划、学习任务、游戏娱乐、散步遛狗。鼠标悬停会浮出模块名称，点击即切换。",
  },
  {
    icon: CalendarClock,
    title: "今日计划",
    body: "规划今天要做的事：添加事项、安排时间段，完成后打勾。每天一早打开它，把今天安排明白。",
  },
  {
    icon: GraduationCap,
    title: "学习任务 · AI 学习助手",
    body: "学习「AI Agent 与 vibe coding」的专属空间：AI 助手先生成 1-2 周学习计划任务树，每个节点配讲解、练习与推荐资料；学完还能出面试题巩固。",
    hints: [
      "右下角吉祥物是 AI 学习小助手，随时可以提问",
      "任务树可以滚轮缩放、拖拽平移",
    ],
  },
  {
    icon: Gamepad2,
    title: "游戏娱乐",
    body: "记录游戏时光：自动扫描本机游戏（Steam / 本机程序）、计时器记录游玩时长、查看历史统计。适度游戏，张弛有度。",
  },
  {
    icon: PawPrint,
    title: "散步遛狗",
    body: "记录每天出门散步、遛狗的时间与路线。数据层已就绪，界面正在开发中，敬请期待。",
  },
];

/** 使用说明：全屏分页弹层，逐页介绍界面各部分 */
export default function HelpView({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0);

  const p = PAGES[page];
  const Icon = p.icon;
  const isLast = page === PAGES.length - 1;

  return (
    <div className="toast-mask help-view">
      <div className="help-card" key={page}>
        <button className="help-close" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        <Icon size={44} strokeWidth={1.3} className="help-icon" />
        <h2>{p.title}</h2>
        <p className="help-body">{p.body}</p>
        {p.hints && (
          <ul className="help-hints">
            {p.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        )}
      </div>

      {/* 底部导航：上一个 / 点导航 / 下一个（末页为开始认识） */}
      <div className="help-foot">
        {page > 0 ? (
          <button className="help-nav-btn ghost" onClick={() => setPage(page - 1)}>
            <ChevronLeft size={16} /> 上一个
          </button>
        ) : (
          <span />
        )}
        <div className="help-dots">
          {PAGES.map((_, i) => (
            <span
              key={i}
              className={`help-dot ${i === page ? "active" : ""}`}
              onClick={() => setPage(i)}
            />
          ))}
        </div>
        {isLast ? (
          <button className="help-nav-btn primary" onClick={onClose}>
            完成，开始使用
          </button>
        ) : (
          <button className="help-nav-btn primary" onClick={() => setPage(page + 1)}>
            下一个 <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
