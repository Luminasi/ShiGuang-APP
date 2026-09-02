import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CloudRain,
  CloudSun,
  HelpCircle,
  Minus,
  Settings,
  Snowflake,
  Square,
  User,
  X,
} from "lucide-react";
import { STATUS_ITEMS } from "../modules";
import type { SceneId } from "./SceneBackground";

/** 三场景（阶段 6）：雨林 / 雪日 / 暖云 */
const SCENES = [
  { id: "rain", name: "雨林", Icon: CloudRain },
  { id: "snow", name: "雪日", Icon: Snowflake },
  { id: "cloud", name: "暖云", Icon: CloudSun },
] as const;

/** 北京时间格式化：2026年8月26日 星期三 20:34 */
function formatBeijingTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // 「月」「日」手动拼接，避免某些环境下本地化数据缺失导致只显示数字（如 826）
  return `${get("year")}年${get("month")}月${get("day")}日 ${get(
    "weekday"
  )} ${get("hour")}:${get("minute")}`;
}

const ICONS: Record<string, typeof User> = {
  user: User,
  settings: Settings,
  help: HelpCircle,
};

interface StatusBarProps {
  /** 点击占位入口（用户/设置/使用说明）时回调 */
  onPlaceholderClick: (name: string) => void;
  /** 当前场景 */
  scene: SceneId;
  /** 切换场景 */
  onSceneChange: (scene: SceneId) => void;
}

export default function StatusBar({
  onPlaceholderClick,
  scene,
  onSceneChange,
}: StatusBarProps) {
  const [now, setNow] = useState(new Date());
  const [maximized, setMaximized] = useState(false);

  // 每秒刷新一次时钟（显示到分钟）
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const appWindow = getCurrentWindow();

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    setMaximized(await appWindow.isMaximized());
  };

  return (
    <header className="status-bar" data-tauri-drag-region>
      <div className="status-left" data-tauri-drag-region>
        {STATUS_ITEMS.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <button
              key={item.id}
              className="status-btn"
              onClick={() => onPlaceholderClick(item.name)}
            >
              <Icon size={14} strokeWidth={2} />
              <span>{item.name}</span>
            </button>
          );
        })}

        {/* 场景切换器：雨林 / 雪日 / 暖云（阶段 6） */}
        <div className="scene-switcher">
          {SCENES.map(({ id, name, Icon }) => (
            <button
              key={id}
              className={`scene-btn${scene === id ? " on" : ""}`}
              title={`场景：${name}`}
              onClick={() => onSceneChange(id)}
            >
              <Icon size={14} strokeWidth={2} />
            </button>
          ))}
        </div>
      </div>

      <div className="status-clock" data-tauri-drag-region>
        {formatBeijingTime(now)}
      </div>

      <div className="status-right" data-tauri-drag-region>
        <button
          className="win-btn"
          title="最小化"
          onClick={() => appWindow.minimize()}
        >
          <Minus size={16} />
        </button>
        <button
          className="win-btn"
          title={maximized ? "还原" : "最大化"}
          onClick={toggleMaximize}
        >
          <Square size={13} />
        </button>
        <button
          className="win-btn win-close"
          title="关闭"
          onClick={() => appWindow.close()}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
