import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, GitBranch, RefreshCw } from "lucide-react";
import type { StudyPlan, StudyPlanNode } from "../../lib/api";

/** 列宽（day → task → sub 每层一列）与行距 */
const COL_W = 250;
const ROW_H = 108;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.0;

const KIND_LABEL: Record<string, string> = {
  day: "天",
  task: "任务",
  sub: "细分",
};

interface Pos {
  x: number;
  y: number;
}

/** 树布局纯函数：level × COL_W 为列，DFS 序 × ROW_H 为行 */
function layoutTree(nodes: StudyPlanNode[]): { pos: Map<number, Pos>; width: number; height: number } {
  const byParent = new Map<number | null, StudyPlanNode[]>();
  for (const n of nodes) {
    const k = n.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(n);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  const pos = new Map<number, Pos>();
  let maxLevel = 0;
  let y = 0;
  const dfs = (parent: number | null, level: number) => {
    const children = byParent.get(parent) ?? [];
    for (const c of children) {
      pos.set(c.id, { x: level * COL_W, y: y * ROW_H });
      maxLevel = Math.max(maxLevel, level);
      y += 1;
      if (byParent.has(c.id)) dfs(c.id, level + 1);
    }
  };
  dfs(null, 0);
  return { pos, width: (maxLevel + 1) * COL_W, height: Math.max(y * ROW_H, 400) };
}

/**
 * 任务树画布：横向线性流程（左 → 右），滚轮缩放、拖拽平移，
 * 必学/选修徽标、完成勾选（落库）、点击节点查看详情。
 */
export default function TaskTreeCanvas({
  plan,
  nodes,
  selectedId,
  onSelect,
  onToggle,
  onReplan,
}: {
  plan: StudyPlan;
  nodes: StudyPlanNode[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onToggle: (node: StudyPlanNode, done: boolean) => void;
  onReplan: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 40, y: 40 });
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  // 拖拽状态
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const { pos, width, height } = useMemo(() => layoutTree(nodes), [nodes]);

  const doneCount = nodes.filter((n) => n.done).length;
  const totalCount = nodes.filter((n) => n.kind !== "day").length;

  const applyTransform = (s: number, o: { x: number; y: number }) => {
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${o.x}px, ${o.y}px) scale(${s})`;
      worldRef.current.style.transformOrigin = "0 0";
    }
  };

  // 滚轮缩放（原生事件以禁用 passive，光标为中心）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
      const { x, y } = offsetRef.current;
      // 光标处世界坐标不变
      const wx = (mx - x) / scale;
      const wy = (my - y) / scale;
      const no = { x: mx - wx * ns, y: my - wy * ns };
      setScale(ns);
      setOffset(no);
      applyTransform(ns, no);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale]);

  // 指针拖拽平移
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
      moved: false,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (d.moved) {
      const no = { x: d.ox + dx, y: d.oy + dy };
      setOffset(no);
      applyTransform(scale, no);
    }
  };
  const onPointerUp = () => {
    suppressClickRef.current = dragRef.current?.moved ?? false;
    dragRef.current = null;
    setTimeout(() => (suppressClickRef.current = false), 0);
  };

  const clickNode = (id: number) => {
    if (suppressClickRef.current) return;
    onSelect(id);
  };

  // 连线：父节点右边缘 → 子节点左边缘
  const edges = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const n of nodes) {
      if (n.parent_id == null) continue;
      const p = pos.get(n.parent_id);
      const c = pos.get(n.id);
      if (!p || !c) continue;
      lines.push({
        x1: p.x + 210,
        y1: p.y + ROW_H / 2,
        x2: c.x + 0,
        y2: c.y + ROW_H / 2,
      });
    }
    return lines;
  }, [nodes, pos]);

  return (
    <div className="study-tree">
      {/* 顶部工具条 */}
      <div className="study-tree-bar">
        <div className="study-tree-title">
          <h2>{plan.title}</h2>
          <span className="study-tree-meta">
            {plan.days} 天阶段 · {totalCount} 个任务 · 已完成 {doneCount}
          </span>
          {plan.goal && <span className="study-tree-goal">🎯 {plan.goal}</span>}
        </div>
        <div className="study-tree-actions">
          <span className="study-tree-hint">滚轮缩放 · 拖拽移动 · 点击节点查看详情</span>
          <button className="study-ghost-btn" onClick={onReplan} title="重新生成学习计划">
            <RefreshCw size={15} /> 重新规划
          </button>
        </div>
      </div>

      {/* 画布 */}
      <div
        ref={containerRef}
        className="study-tree-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div ref={worldRef} className="study-tree-world" style={{ width, height }}>
          {/* 连线层 */}
          <svg className="study-tree-lines" width={width} height={height}>
            {edges.map((e, i) => (
              <path
                key={i}
                d={`M ${e.x1} ${e.y1} C ${e.x1 + 30} ${e.y1}, ${e.x2 - 30} ${e.y2}, ${e.x2} ${e.y2}`}
                className="study-tree-edge"
              />
            ))}
          </svg>

          {/* 节点层 */}
          {nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const isDay = n.kind === "day";
            const isSelected = n.id === selectedId;
            return (
              <div
                key={n.id}
                className={`study-tree-node kind-${n.kind} ${isSelected ? "selected" : ""} ${
                  n.done ? "done" : ""
                }`}
                style={{ left: p.x + 10, top: p.y + 8, width: 200 }}
                onClick={() => clickNode(n.id)}
              >
                <div className="study-node-head">
                  <span className="study-node-kind">
                    {isDay ? "📅" : n.kind === "task" ? <BookOpen size={12} /> : <GitBranch size={12} />}
                    {isDay ? " 第 " + (n.sort_order + 1) + " 天" : KIND_LABEL[n.kind] ?? n.kind}
                  </span>
                  {!isDay && (
                    <span
                      className={`study-node-required ${n.required ? "must" : "elective"}`}
                      title={n.required ? "必学（就业核心）" : "选修（进阶拓展）"}
                    >
                      {n.required ? "必学" : "选修"}
                    </span>
                  )}
                </div>
                <div className="study-node-title">{n.title}</div>
                <button
                  className={`study-node-check ${n.done ? "checked" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(n, !n.done);
                  }}
                  title={n.done ? "已完成" : "标记完成"}
                >
                  <Check size={13} />
                </button>
              </div>
            );
          })}

          {nodes.length === 0 && (
            <div className="study-tree-empty">还没有学习内容，点击右上角「重新规划」生成计划</div>
          )}
        </div>
      </div>
    </div>
  );
}
