import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Eraser, Loader2, Send } from "lucide-react";
import type { AiMessage, AskResult, KbHit } from "../../lib/api";
import { aiAsk, aiClearHistory, aiListHistory } from "../../lib/api";
import type { ExpressionId, ShapeId, StateId } from "../../mascot";
import { EXPRESSIONS, SHAPES } from "../../mascot";
import Mascot from "../mascot/Mascot";

/**
 * 首页总览（阶段 8）：启动即进入。
 * 中央大吉祥物（随场景换色）+「今天想做些什么」+ AI 对话。
 * 问答复用 ai_ask 链路，会话隔离用 session_id = "overview-home"
 * （与学习任务的 'main' 历史互不干扰）。
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

  // ---- 吉祥物状态 ----
  const [mascotState, setMascotState] = useState<StateId>("idle");
  const [expression, setExpression] = useState<ExpressionId>("neutre");
  const [shape, setShape] = useState<ShapeId>("cercle");
  const mascotStateRef = useRef<StateId>("idle");
  const askingRef = useRef(false);
  const timeoutsRef = useRef<number[]>([]);

  // 启动：加载本页会话历史
  useEffect(() => {
    let cancelled = false;
    aiListHistory(SESSION)
      .then((msgs: AiMessage[]) => {
        if (cancelled) return;
        setEntries(
          msgs.map((m) => ({
            id: m.id,
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
            createdAt: m.created_at,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
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

  return (
    <div className={`overview${chatting ? " chatting" : ""}`}>
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

      {/* 对话内联在页面里（不换界面）：消息面板直接排在吉祥物与输入框之间 */}
      {chatting && (
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
                  <Loader2 className="spin" size={13} /> 小拾正在思考…
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="overview-composer">
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
        {!chatting && (
          <div className="overview-chips">
            {CHIPS.map((c) => (
              <button key={c} onClick={() => send(c)} disabled={asking}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
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
