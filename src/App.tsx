import { useState } from "react";
import StatusBar from "./components/StatusBar";
import NavBar from "./components/NavBar";
import Welcome from "./components/Welcome";
import PlaceholderView from "./components/PlaceholderView";
import PlanView from "./components/PlanView";
import GameView from "./components/GameView";
import StudyView from "./components/study/StudyView";
import HelpView from "./components/help/HelpView";
import SettingsView from "./components/settings/SettingsView";
import { MODULES, WELCOME_VIEW } from "./modules";
import "./App.css";

export default function App() {
  const [view, setView] = useState<string>(WELCOME_VIEW);
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const currentModule = MODULES.find((m) => m.id === view);

  // 已开发模块的视图；未开发的显示占位页
  const renderModule = (id: string) => {
    switch (id) {
      case "plan":
        return <PlanView />;
      case "game":
        return <GameView />;
      case "study":
        return <StudyView />;
      default:
        return <PlaceholderView mod={currentModule!} />;
    }
  };

  return (
    <div className="app">
      <StatusBar
        onPlaceholderClick={(name) => {
          if (name === "设置") setSettingsOpen(true);
          else if (name === "使用说明") setHelpOpen(true);
          else setPlaceholder(name);
        }}
      />

      <NavBar active={view} onSelect={setView} />

      <main className="main-area">
        {view === WELCOME_VIEW || !currentModule ? (
          <Welcome />
        ) : (
          renderModule(view)
        )}
      </main>

      {placeholder && (
        <div className="toast-mask" onClick={() => setPlaceholder(null)}>
          <div className="toast-card">
            <p>「{placeholder}」功能开发中，敬请期待</p>
            <button onClick={() => setPlaceholder(null)}>知道了</button>
          </div>
        </div>
      )}

      {/* 使用说明：全屏分页弹层（盖住状态栏） */}
      {helpOpen && <HelpView onClose={() => setHelpOpen(false)} />}

      {/* 设置：AI 提供方配置弹层（阶段 7） */}
      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
