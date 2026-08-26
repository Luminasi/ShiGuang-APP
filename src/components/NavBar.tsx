import { MODULES } from "../modules";

interface NavBarProps {
  active: string;
  onSelect: (id: string) => void;
}

/** 左侧浅灰导航栏：图标竖排，鼠标悬停显示功能名 */
export default function NavBar({ active, onSelect }: NavBarProps) {
  return (
    <nav className="nav-bar">
      {MODULES.map((mod) => {
        const Icon = mod.icon;
        const isActive = active === mod.id;
        return (
          <button
            key={mod.id}
            className={`nav-item${isActive ? " active" : ""}`}
            data-label={mod.name}
            onClick={() => onSelect(mod.id)}
          >
            <Icon size={22} strokeWidth={1.8} />
            {/* 悬停提示文字（CSS 控制显示） */}
            <span className="nav-tip">{mod.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
