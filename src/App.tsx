import { useState } from "react";
import StatusBar from "./components/StatusBar";
import NavBar from "./components/NavBar";
import Welcome from "./components/Welcome";
import PlaceholderView from "./components/PlaceholderView";
import PlanView from "./components/PlanView";
import GameView from "./components/GameView";
import { MODULES, WELCOME_VIEW } from "./modules";
import "./App.css";

export default function App() {
  const [view, setView] = useState<string>(WELCOME_VIEW);
  const [placeholder, setPlaceholder] = useState<string | null>(null);

  const currentModule = MODULES.find((m) => m.id === view);

  // 已开发模块的视图；未开发的显示占位页
  const renderModule = (id: string) => {
    switch (id) {
      case "plan":
        return <PlanView />;
      case "game":
        return <GameView />;
      default:
        return <PlaceholderView mod={currentModule!} />;
    }
  };

  return (
    <div className="app">
      <StatusBar onPlaceholderClick={(name) => setPlaceholder(name)} />

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
    </div>
  );
}
