import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BookOpen, Eraser, History, Send, Trash2, X } from "lucide-react";
import type { AiMessage, AskResult, KbHit, OverviewSession } from "../../lib/api";
import {
  aiAsk,
  aiClearHistory,
  aiListHistory,
  deleteOverviewSummary,
  listOverviewSessions,
  saveOverviewSummary,
  summarizeChat,
} from "../../lib/api";
import { addDays, dateLabel, todayStr } from "../../lib/time";
import type { ExpressionId, ShapeId, StateId } from "../../mascot";
import { EXPRESSIONS, SHAPES } from "../../mascot";
import Mascot from "../mascot/Mascot";

/**
 * 首页总览（阶段 8）：启动即进入。
 * 中央大吉祥物（随场景换色）+「今天想做些什么」+ AI 对话。
 * 问答复用 ai_ask 链路，会话隔离用 session_id = "overview-home"
 * （与学习任务的 'main' 历史互不干扰）。
 *
 * 会话生命周期：每次启动都是全新欢迎页（不恢复上次对话）；退出应用时
 * 把本次对话 AI 总结后归档到「历史对话」（overview_sessions 表）并清空会话；
 * 异常退出遗留的消息在下次启动时补归档，欢迎页同样不被打扰。
 *
 * 吉祥物互动（「活泼可爱」的核心）：
 * - 眼睛跟随鼠标（Mascot follow 自带）；
 * - 点击吉祥物：随机形变连招（8 形抽 2 次切换 + 16 表情抽 1）或整活状态（play/orbit/burst）；
 * - 自动微动作：每 25~40s 随机 wink/sleep 一下；
 * - 开场三连：每天首次进入播一次 burst；
 * - AI 等待时 thinking 态、回答后 excite/heureux 庆祝、出错 triste/blase。
 * prefers-reduced-motion：只保留呼吸/眨眼/注视（生物本能），关掉形变与整活。
 */
export default function OverviewView() {
  const SESSION = "overview-home";
  const CHIPS = ["帮我安排今天", "出个面试题", "调整学习计划", "AI 文案生成工具"];

  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // ---- 对话状态 ----
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 退出归档时读取最新对话（close 事件回调闭包拿不到最新 state）
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // ---- 历史对话 ----
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<OverviewSession[]>([]);
  const [historyOpenId, setHistoryOpenId] = useState<number | null>(null);

  // ---- 吉祥物状态 ----
  const [mascotState, setMascotState] = useState<StateId>("idle");
  const [expression, setExpression] = useState<ExpressionId>("neutre");
  const [shape, setShape] = useState<ShapeId>("cercle");
  const mascotStateRef = useRef<StateId>("idle");
  const askingRef = useRef(false);
  const timeoutsRef = useRef<number[]>([]);

  // 启动：每次都是全新欢迎页（不恢复上次对话）。
  // 上次异常退出（未走退出归档流程）可能遗留会话消息：总结归档 → 清空，欢迎页不被打扰。
  useEffect(() => {
    let cancelled = false;
    aiListHistory(SESSION)
      .then(async (msgs: AiMessage[]) => {
        if (cancelled || msgs.length === 0) return;
        const conv = msgs
          .map((m) => `${m.role === "user" ? "用户" : "小拾"}：${m.content}`)
          .join("\n");
        let summary = await summarizeWithTimeout(conv, 10_000);
        if (!summary) summary = naiveSummary(conv);
        if (!cancelled) await saveOverviewSummary(summary).catch(() => undefined);
        await aiClearHistory(SESSION).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 退出应用：AI 总结本次对话 → 归档历史对话 → 清空会话，再真正关闭窗口。
  // 总结最多等 10s（失败/超时退回朴素摘要），归档不阻塞退出。
  useEffect(() => {
    const win = getCurrentWindow();
    let closing = false;
    const un = win.onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      closing = true;
      try {
        const msgs = entriesRef.current;
        if (msgs.length > 0) {
          const conv = convText(msgs);
          let summary = await summarizeWithTimeout(conv, 10_000);
          if (!summary) summary = naiveSummary(conv);
          await saveOverviewSummary(summary).catch(() => undefined);
        }
        await aiClearHistory(SESSION).catch(() => undefined);
      } catch {
        // 归档失败不阻塞退出
      } finally {
        win.destroy();
      }
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新消息自动滚到底
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, asking]);

  // 卸载时清掉所有待触发的形变计时器
  useEffect(() => {
    const list = timeoutsRef.current;
    return () => list.forEach((t) => clearTimeout(t));
  }, []);

  // 开场三连：每天首次进入播一次 burst（2.6s 后回 idle）
  useEffect(() => {
    if (reducedMotion) return;
    const today = new Date().toDateString();
    const key = "shiguang_mascot_intro";
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
    setMascotState("burst");
    const t = window.setTimeout(() => setMascotState("idle"), 2600);
    timeoutsRef.current.push(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  // 自动微动作：每 25~40s 在空闲时随机 wink/sleep 约 1s
  useEffect(() => {
    if (reducedMotion) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (
          document.visibilityState === "visible" &&
          !askingRef.current &&
          mascotStateRef.current === "idle"
        ) {
          const action: StateId = Math.random() < 0.6 ? "wink" : "sleep";
          mascotStateRef.current = action;
          setMascotState(action);
          const back = window.setTimeout(() => {
            mascotStateRef.current = "idle";
            setMascotState("idle");
          }, 1000);
          timeoutsRef.current.push(back);
        }
        schedule();
      }, 25000 + Math.random() * 15000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  // ---- 发送问答 ----
  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || asking) return;
    setInput("");
    setAsking(true);
    askingRef.current = true;
    setEntries((prev) => [...prev, { id: nextId(), role: "user", content: q }]);
    mascotStateRef.current = "thinking";
    setMascotState("thinking");
    try {
      const result: AskResult = await aiAsk(q, SESSION);
      setEntries((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", content: result.answer, sources: result.sources },
      ]);
      // 庆祝表情，短暂后回中性
      setExpression(Math.random() < 0.5 ? "excite" : "heureux");
      const back = window.setTimeout(() => setExpression("neutre"), 1800);
      timeoutsRef.current.push(back);
    } catch (e) {
      setEntries((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", content: String(e), error: true },
      ]);
      setExpression(Math.random() < 0.5 ? "triste" : "blase");
      const back = window.setTimeout(() => setExpression("neutre"), 2200);
      timeoutsRef.current.push(back);
    } finally {
      setAsking(false);
      askingRef.current = false;
      mascotStateRef.current = "idle";
      setMascotState("idle");
    }
  };

  // ---- 清空重来 ----
  const clear = async () => {
    await aiClearHistory(SESSION).catch(() => undefined);
    setEntries([]);
    setExpanded(null);
    setExpression("neutre");
    setShape("cercle");
    mascotStateRef.current = "idle";
    setMascotState("idle");
  };

  // ---- 历史对话 ----
  const openHistory = () => {
    setShowHistory(true);
    setHistoryOpenId(null);
    listOverviewSessions()
      .then(setHistory)
      .catch(() => setHistory([]));
  };

  const removeHistory = async (id: number) => {
    await deleteOverviewSummary(id).catch(() => undefined);
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };

  // ---- 点击吉祥物：形变连招 / 整活 ----
  const handleMascotClick = () => {
    if (askingRef.current || reducedMotion) return;
    const roll = Math.random();
    // 35%：整活状态（play 音符三角 / orbit 环绕 / burst 爆裂），约 2.2s 后回 idle
    if (roll < 0.35 && mascotStateRef.current === "idle") {
      const fun: StateId[] = ["play", "orbit", "burst"];
      const action = fun[Math.floor(Math.random() * fun.length)] ?? "play";
      mascotStateRef.current = action;
      setMascotState(action);
      const back = window.setTimeout(() => {
        mascotStateRef.current = "idle";
        setMascotState("idle");
      }, 2200);
      timeoutsRef.current.push(back);
      return;
    }
    // 其余：8 形抽 2 次连换（覆盖「变三角形/方块」诉求：triangle + squircle 在列）+ 16 表情抽 1
    const ids = SHAPES.map((s) => s.id);
    const pick = () => ids[Math.floor(Math.random() * ids.length)] ?? "cercle";
    setShape(pick());
    const second = window.setTimeout(() => setShape(pick()), 1500);
    timeoutsRef.current.push(second);
    const exprs = EXPRESSIONS.map((e) => e.id);
    setExpression(exprs[Math.floor(Math.random() * exprs.length)] ?? "neutre");
  };

  const chatting = entries.length > 0;

  // 输入框（欢迎态独立使用 / 对话态内嵌在聊天面板底部）
  const composerBox = (
    <div className="overview-composer-box">
      <input
        value={input}
        placeholder={chatting ? "继续问小拾…" : "问问今天的计划、学习建议、面试题…"}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
        disabled={asking}
      />
      <button
        className="ai-chat-send overview-send"
        onClick={() => send()}
        disabled={asking || !input.trim()}
        title="发送"
      >
        <Send size={18} />
      </button>
    </div>
  );

  return (
    <div className={`overview${chatting ? " chatting" : ""}`}>
      <button className="overview-history-btn" onClick={openHistory} title="历史对话">
        <History size={14} /> 历史对话
      </button>

      <div className="overview-hero">
        <Mascot
          size={chatting ? 96 : 160}
          follow
          sceneColors
          state={mascotState}
          expression={expression}
          shape={shape}
          onClick={handleMascotClick}
        />
        {!chatting && <h1 className="welcome-title">今天想做些什么</h1>}
        {!chatting && <p className="overview-sub">问我任何问题，或从下面开始</p>}
      </div>

      {/* 对话进行时：消息列表与输入框合成一块半透明玻璃板（内联在页面里，不换界面） */}
      {chatting ? (
        <div className="overview-chat">
          <div className="overview-chat-bar">
            <span className="overview-chat-title">小拾 · AI 助手</span>
            <button className="overview-new" onClick={clear} title="清空并重新开始">
              <Eraser size={14} /> 新对话
            </button>
          </div>

          <div className="overview-chat-list" ref={listRef}>
            {entries.map((e) => (
              <div key={e.id} className={`ai-msg ${e.role}`}>
                <div className="ai-msg-bubble">
                  {e.role === "assistant" && e.error && (
                    <div className="ai-msg-error">{e.content}</div>
                  )}
                  {e.role === "assistant" && !e.error && (
                    <div className="ai-msg-text">{e.content}</div>
                  )}
                  {e.role === "user" && <div className="ai-msg-text">{e.content}</div>}
                  {e.sources && e.sources.length > 0 && (
                    <div className="ai-msg-sources">
                      <button
                        className="ai-src-toggle"
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      >
                        <BookOpen size={12} /> 参考了 {e.sources.length} 份资料
                      </button>
                      {expanded === e.id && (
                        <ul className="ai-src-list">
                          {e.sources.map((s, i) => (
                            <li key={i}>
                              <span className="ai-src-name">
                                [{s.chapter}] {s.title ?? s.content.slice(0, 18)}
                              </span>
                              <span className="ai-src-snippet">
                                {s.content.slice(0, 120)}…
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {e.createdAt && (
                    <span className="ai-msg-time">{timeOf(e.createdAt)}</span>
                  )}
                </div>
              </div>
            ))}
            {asking && (
              <div className="ai-msg assistant">
                <div className="ai-msg-bubble ai-msg-thinking">
                  <span className="think-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  小拾正在思考…
                </div>
              </div>
            )}
          </div>

          <div className="overview-composer in-panel">{composerBox}</div>
        </div>
      ) : (
        <div className="overview-composer">
          {composerBox}
          <div className="overview-chips">
            {CHIPS.map((c) => (
              <button key={c} onClick={() => send(c)} disabled={asking}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 历史对话浮层：每次退出自动归档的对话摘要 */}
      {showHistory && (
        <div
          className="overview-history"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowHistory(false);
          }}
        >
          <div className="overview-history-card">
            <div className="overview-history-head">
              <span className="overview-chat-title">历史对话</span>
              <button
                className="overview-history-close"
                onClick={() => setShowHistory(false)}
                title="关闭"
              >
                <X size={14} />
              </button>
            </div>
            <div className="overview-history-list">
              {history.length === 0 && (
                <p className="overview-history-empty">
                  还没有历史对话。每次退出应用时，小拾会把本次对话自动总结归档到这里。
                </p>
              )}
              {history.map((h) => (
                <div key={h.id} className={`oh-item${historyOpenId === h.id ? " open" : ""}`}>
                  <div
                    className="oh-item-head"
                    onClick={() => setHistoryOpenId(historyOpenId === h.id ? null : h.id)}
                  >
                    <span className="oh-item-time">{histLabel(h.created_at)}</span>
                    <button
                      className="oh-item-del"
                      title="删除这条历史"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeHistory(h.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div
                    className="oh-item-summary"
                    onClick={() => setHistoryOpenId(historyOpenId === h.id ? null : h.id)}
                  >
                    {h.summary}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 一条问答的渲染状态（含来源/错误/时间） */
interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources?: KbHit[];
  error?: boolean;
  createdAt?: string;
}

let seq = 0;
const nextId = () => ++seq;

function timeOf(createdAt?: string) {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 5);
}

/** 对话 → 纯文本（AI 总结用） */
function convText(entries: ChatEntry[]): string {
  return entries
    .map((e) => `${e.role === "user" ? "用户" : "小拾"}：${e.content}`)
    .join("\n");
}

/** AI 总结对话，最多等 ms 毫秒；失败或超时返回 null（由调用方走朴素摘要兜底） */
async function summarizeWithTimeout(conv: string, ms: number): Promise<string | null> {
  try {
    return await Promise.race([
      summarizeChat(conv),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
    ]);
  } catch {
    return null;
  }
}

/** AI 总结不可用时的朴素兜底：首条提问 + 提问次数 */
function naiveSummary(conv: string): string {
  const first =
    conv
      .split("\n")
      .find((l) => l.startsWith("用户："))
      ?.slice(3)
      .trim() ?? "";
  const asks = (conv.match(/用户：/g) ?? []).length;
  const head = first.length > 80 ? `${first.slice(0, 80)}…` : first;
  return `（未生成 AI 摘要）本次共 ${asks} 次提问，主题：${head || "闲聊"}`;
}

/** 历史条目时间标签：今天/昨天 时分，更早显示月日 时分 */
function histLabel(createdAt: string): string {
  const date = createdAt.slice(0, 10);
  const time = createdAt.slice(11, 16);
  if (date === todayStr()) return `今天 ${time}`;
  if (date === addDays(todayStr(), -1)) return `昨天 ${time}`;
  return `${dateLabel(date).replace(/ 星期\S+/, "")} ${time}`;
}
