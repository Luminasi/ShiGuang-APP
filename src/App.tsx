import { useEffect, useState } from "react";
import StatusBar from "./components/StatusBar";
import NavBar from "./components/NavBar";
import Welcome from "./components/Welcome";
import PlaceholderView from "./components/PlaceholderView";
import PlanView from "./components/PlanView";
import GameView from "./components/GameView";
import StudyView from "./components/study/StudyView";
import OverviewView from "./components/overview/OverviewView";
import HelpView from "./components/help/HelpView";
import SettingsView from "./components/settings/SettingsView";
import SceneBackground, { loadScene, SceneId } from "./components/SceneBackground";
import { MODULES } from "./modules";
import "./App.css";

// 首帧前就写入场景标记，避免非雨林场景闪一下默认配色
const initialScene = loadScene();
document.documentElement.dataset.scene = initialScene;

export default function App() {
  // 阶段 8：启动直接进首页总览（欢迎页保留为未知视图兜底，不再作启动页）
  const [view, setView] = useState<string>("overview");
  const [scene, setScene] = useState<SceneId>(initialScene);
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 场景切换（阶段 6）：写入 <html data-scene> 驱动 CSS 变量换色，并本地持久化
  useEffect(() => {
    document.documentElement.dataset.scene = scene;
    localStorage.setItem("shiguang_scene", scene);
  }, [scene]);

  const currentModule = MODULES.find((m) => m.id === view);

  // 已开发模块的视图；未开发的显示占位页
  const renderModule = (id: string) => {
    switch (id) {
      case "overview":
        return <OverviewView />;
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
      {/* 氛围背景层：场景渐变 + 雨/雪/雾粒子 */}
      <div className="scene-bg">
        <SceneBackground scene={scene} />
      </div>

      <StatusBar
        scene={scene}
        onSceneChange={setScene}
        onPlaceholderClick={(name) => {
          if (name === "设置") setSettingsOpen(true);
          else if (name === "使用说明") setHelpOpen(true);
          else setPlaceholder(name);
        }}
      />

      <NavBar active={view} onSelect={setView} />

      <main className="main-area">
        {!currentModule ? <Welcome /> : renderModule(view)}
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
