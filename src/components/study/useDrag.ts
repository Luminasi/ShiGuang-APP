import { useRef, useState } from "react";

/**
 * 悬浮元素拖拽 hook（精灵球 / AI 对话面板通用）。
 *
 * 用法：元素 style 用 pos 覆盖 left/top（pos 为 null 时走 CSS 默认定位）；
 * pointer 三个事件绑到拖动手柄上；位移 < 4px 视为点击，
 * 拖动后的 click 用 eatDragClick() 吞掉（仅当手柄自身绑了 onClick 时需要）。
 */
export function useDrag() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // 拖动起始信息：指针位置 + 元素当前位置
  const startRef = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  // 拖动结束后吞掉随之而来的 click，避免误触
  const suppressClickRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    startRef.current = {
      px: e.clientX,
      py: e.clientY,
      ox: rect.left,
      oy: rect.top,
      moved: false,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = startRef.current;
    if (!s) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < 4) return; // 小位移视为点击
    s.moved = true;
    const w = e.currentTarget.offsetWidth;
    const h = e.currentTarget.offsetHeight;
    // 拖出屏幕时收边，不允许完全拖出可视区
    setPos({
      x: Math.min(Math.max(0, s.ox + dx), window.innerWidth - w),
      y: Math.min(Math.max(0, s.oy + dy), window.innerHeight - h),
    });
  };

  const onPointerUp = () => {
    const s = startRef.current;
    startRef.current = null;
    setDragging(false);
    if (s?.moved) suppressClickRef.current = true;
  };

  /** 在 onClick 里调用：拖动后的 click 吞掉并返回 true；正常点击放行返回 false */
  const eatDragClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  };

  return { pos, dragging, onPointerDown, onPointerMove, onPointerUp, eatDragClick };
}
