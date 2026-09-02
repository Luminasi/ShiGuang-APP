import Mascot from "../mascot/Mascot";
import { useDrag } from "./useDrag";

/**
 * AI 小助手悬浮球（阶段 8：精灵球已替换为场景色吉祥物）。
 * 点击打开对话面板；可拖拽：按住拖动到任意位置，松开后停留；位移 < 4px 视为点击。
 * 面板打开时由 StudyView 隐藏本球（正交于主流程）。
 */
export default function AiBubble({ onClick }: { onClick: () => void }) {
  const drag = useDrag();

  const handleClick = () => {
    if (drag.eatDragClick()) return;
    onClick();
  };

  return (
    <button
      className={`ai-bubble${drag.dragging ? " dragging" : ""}`}
      style={
        drag.pos
          ? { left: drag.pos.x, top: drag.pos.y, right: "auto", bottom: "auto" }
          : undefined
      }
      onClick={handleClick}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      title="AI 学习小助手（可拖拽）"
      aria-label="打开 AI 学习小助手"
    >
      <Mascot size={38} follow={false} sceneColors />
      <span className="ai-bubble-tip">问 AI</span>
    </button>
  );
}
