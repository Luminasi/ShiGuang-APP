import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import type { PlanItem } from "../lib/api";
import {
  addPlanItem,
  deletePlanItem,
  listPlans,
  togglePlanItem,
  updatePlanItem,
} from "../lib/api";
import { addDays, dateLabel, fmtMin, parseMin, todayStr } from "../lib/time";

/** 时间轴缩放：1 分钟 = 1 像素（一天 1440 像素） */
const DAY_MIN = 1440;
const SNAP = 5; // 拖动吸附步长（分钟）
const DEFAULT_START = 8 * 60; // 当天第一个事项默认从 8:00 开始排

/**
 * 今日计划：输入事项+时长 → 自动排时间轴 → 拖动调整 → 到点提醒 → 勾选完成 → 按日期翻看
 */
export default function PlanView() {
  const [date, setDate] = useState(todayStr());
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 添加表单
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [dur, setDur] = useState("30");
  const [startInput, setStartInput] = useState(""); // 留空自动续排
  const [formError, setFormError] = useState("");

  // 到点提醒横幅
  const [banner, setBanner] = useState<string | null>(null);

  // 当前时间（30 秒刷新一次，用于画“现在”线）
  const [now, setNow] = useState(new Date());

  // 拖动时读取最新 items（pointermove 闭包中拿不到最新 state）
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const isToday = date === todayStr();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // 按日期加载
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listPlans(date)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date]);

  // 当前时间线刷新
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // 监听后端到点提醒 → 应用内横幅
  useEffect(() => {
    const un = listen<{ title: string; start_min: number }>("plan-reminder", (e) => {
      setBanner(`「${e.payload.title}」时间到了，该去做了`);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const d = Math.min(DAY_MIN, Math.max(5, Math.round(Number(dur)) || 30));
    if (!t) {
      setFormError("请填写事项名称");
      return;
    }

    // 指定时间 / 自动续排
    let start: number;
    if (startInput.trim()) {
      const m = parseMin(startInput);
      if (m === null) {
        setFormError("开始时间格式应为 HH:MM，如 14:30");
        return;
      }
      start = m;
    } else {
      const lastEnd = items.reduce(
        (mx, p) => Math.max(mx, p.start_min + p.duration_min),
        -1
      );
      start = lastEnd >= 0 ? lastEnd : DEFAULT_START;
      if (start + d > DAY_MIN) start = DAY_MIN - d; // 排不下时顶到一天末尾
    }

    const row = await addPlanItem(date, t, start, d);
    setItems((prev) => [...prev, row].sort((a, b) => a.start_min - b.start_min));
    setTitle("");
    setDur("30");
    setStartInput("");
    setFormError("");
    setShowForm(false);
  };

  const toggle = async (item: PlanItem) => {
    const row = await togglePlanItem(item.id, !item.done);
    setItems((prev) => prev.map((p) => (p.id === row.id ? row : p)));
  };

  const remove = async (item: PlanItem) => {
    await deletePlanItem(item.id);
    setItems((prev) => prev.filter((p) => p.id !== item.id));
  };

  // 拖动：move=调整开始时间，resize=调整时长；松手时写库
  const beginDrag = (
    e: React.PointerEvent,
    item: PlanItem,
    mode: "move" | "resize"
  ) => {
    if (item.done) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const origStart = item.start_min;
    const origDur = item.duration_min;

    const apply = (dy: number) => {
      const delta = Math.round(dy / SNAP) * SNAP;
      if (mode === "move") {
        const s = Math.max(0, Math.min(DAY_MIN - origDur, origStart + delta));
        setItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, start_min: s } : p))
        );
      } else {
        const d = Math.max(SNAP, Math.min(DAY_MIN - origStart, origDur + delta));
        setItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, duration_min: d } : p))
        );
      }
    };

    const move = (ev: PointerEvent) => apply(ev.clientY - startY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const cur = itemsRef.current.find((p) => p.id === item.id);
      if (cur && (cur.start_min !== origStart || cur.duration_min !== origDur)) {
        void updatePlanItem(item.id, {
          startMin: cur.start_min,
          durationMin: cur.duration_min,
        });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="plan-view">
      {/* 头部：日期翻看 + 添加按钮 */}
      <div className="plan-header">
        <div className="plan-date-nav">
          <button className="plan-nav-btn" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft size={14} /> 昨天
          </button>
          <span className="plan-date-label">
            {dateLabel(date)}
            {isToday && <span className="plan-today-tag">今天</span>}
          </span>
          <button className="plan-nav-btn" onClick={() => setDate(addDays(date, 1))}>
            明天 <ChevronRight size={14} />
          </button>
          {!isToday && (
            <button className="plan-nav-btn plan-nav-today" onClick={() => setDate(todayStr())}>
              回到今天
            </button>
          )}
        </div>
        <button className="plan-add-btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? "取消" : "添加事项"}
        </button>
      </div>

      {/* 添加表单 */}
      {showForm && (
        <form className="plan-form" onSubmit={add}>
          <input
            className="pf-title"
            placeholder="要做什么？（如：背英语单词）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <input
            className="pf-dur"
            type="number"
            min={5}
            max={1440}
            placeholder="时长(分钟)"
            value={dur}
            onChange={(e) => setDur(e.target.value)}
          />
          <input
            className="pf-start"
            placeholder="开始时间，留空自动排"
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
          />
          <button type="submit" className="plan-form-submit">
            加入计划
          </button>
          {formError && <span className="plan-form-error">{formError}</span>}
        </form>
      )}

      {/* 时间轴 */}
      <div className="plan-body">
        <div className="plan-timeline">
          {/* 整点刻度线 */}
          {Array.from({ length: 24 }, (_, h) => h * 60).map((m) => (
            <div key={m} className="plan-hour" style={{ top: m }}>
              <span>{fmtMin(m)}</span>
            </div>
          ))}

          {/* 当前时间线（仅今天显示） */}
          {isToday && <div className="plan-now-line" style={{ top: nowMin }} />}

          {/* 事项块 */}
          {items.map((p) => (
            <div
              key={p.id}
              className={`plan-item${p.done ? " done" : ""}`}
              style={{ top: p.start_min, height: Math.max(p.duration_min, 26) }}
              onPointerDown={(e) => beginDrag(e, p, "move")}
              title="拖动调整时间"
            >
              <div className="plan-item-head">
                <span className="plan-item-time">
                  {fmtMin(p.start_min)}–{fmtMin(p.start_min + p.duration_min)}
                  <em className="plan-item-dur">（{p.duration_min} 分钟）</em>
                </span>
                <span className="plan-item-actions">
                  <button
                    className="plan-check"
                    title={p.done ? "标记未完成" : "标记完成"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => void toggle(p)}
                  >
                    {p.done && <Check size={12} strokeWidth={3} />}
                  </button>
                  <button
                    className="plan-del"
                    title="删除"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => void remove(p)}
                  >
                    <X size={12} />
                  </button>
                </span>
              </div>
              <div className="plan-item-title">{p.title}</div>
              <div
                className="plan-item-resize"
                title="拖动调整时长"
                onPointerDown={(e) => beginDrag(e, p, "resize")}
              />
            </div>
          ))}

          {/* 空状态 */}
          {!loading && items.length === 0 && (
            <div className="plan-empty">
              <p>{isToday ? "今天还没有安排，添加第一件事吧" : "这一天没有安排"}</p>
              <button className="plan-add-btn" onClick={() => setShowForm(true)}>
                <Plus size={14} /> 添加事项
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 到点提醒横幅 */}
      {banner && (
        <div className="plan-banner">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)}>知道了</button>
        </div>
      )}
    </div>
  );
}
