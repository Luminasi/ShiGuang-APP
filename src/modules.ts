import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Gamepad2,
  GraduationCap,
  Home,
  PawPrint,
} from "lucide-react";

/** 功能模块定义：左侧导航栏与视图共用的注册表 */
export interface AppModule {
  id: string;
  name: string;
  icon: LucideIcon;
  /** 悬停提示与模块页副标题用 */
  description: string;
}

export const MODULES: AppModule[] = [
  {
    id: "overview",
    name: "首页总览",
    icon: Home,
    description: "各模块今日状态一览",
  },
  {
    id: "plan",
    name: "今日计划",
    icon: CalendarClock,
    description: "帮我规划今天的时间",
  },
  {
    id: "study",
    name: "学习任务",
    icon: GraduationCap,
    description: "按科目管理我的学习",
  },
  {
    id: "game",
    name: "游戏娱乐",
    icon: Gamepad2,
    description: "游戏时光，张弛有度",
  },
  {
    id: "walk",
    name: "散步遛狗",
    icon: PawPrint,
    description: "出门走走，健康常在",
  },
];

export const WELCOME_VIEW = "welcome";

/** 顶部状态栏三个占位入口（功能在后续版本开放） */
export const STATUS_ITEMS = [
  { id: "user", name: "用户", icon: "user" },
  { id: "settings", name: "设置", icon: "settings" },
  { id: "help", name: "使用说明", icon: "help" },
] as const;
