import { useEffect, useRef, useState } from "react";
import { BookOpen, Eraser, Loader2, Send, X } from "lucide-react";
import type { AiMessage, AskResult, KbHit } from "../../lib/api";
import { aiAsk, aiClearHistory, aiListHistory } from "../../lib/api";
import { useDrag } from "./useDrag";

/** 一条问答的渲染状态（含加载/错误/来源） */
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

/**
 * AI 学习小助手对话面板：右下角悬浮。
 * 问答复用 ai_ask（本地知识库 RAG + AI 提供方），
 * 历史持久化在 ai_messages；支持清空历史。
 * 可拖拽：按住头部标题栏拖动，松开停留；头部按钮区域不启动拖动。
 */
export default function AiChatPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useDrag();

  // 启动：加载历史
  useEffect(() => {
    let cancelled = false;
    aiListHistory()
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
  }, []);

  // 新消息自动滚到底
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, asking]);

  const send = async () => {
    const q = input.trim();
    if (!q || asking) return;
    setInput("");
    setAsking(true);
    setEntries((prev) => [...prev, { id: nextId(), role: "user", content: q }]);
    let result: AskResult;
    try {
      result = await aiAsk(q);
      setEntries((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", content: result.answer, sources: result.sources },
      ]);
    } catch (e) {
      setEntries((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", content: String(e), error: true },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const clear = async () => {
    await aiClearHistory().catch(() => undefined);
    setEntries([]);
    setExpanded(null);
  };

  return (
    <div
      className={`ai-chat${drag.dragging ? " dragging" : ""}`}
      style={
        drag.pos
          ? { left: drag.pos.x, top: drag.pos.y, right: "auto", bottom: "auto" }
          : undefined
      }
    >
      {/* 头部：拖拽手柄（按钮区域不启动拖动） */}
      <div
        className="ai-chat-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.onPointerDown(e);
        }}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
      >
        <span className="ai-chat-title">
          <span className="ai-chat-dot" /> AI 学习小助手
        </span>
        <div className="ai-chat-head-actions">
          <button onClick={clear} title="清空历史">
            <Eraser size={15} />
          </button>
          <button onClick={onClose} title="关闭">
            <X size={17} />
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="ai-chat-list" ref={listRef}>
        {entries.length === 0 && !asking && (
          <div className="ai-chat-empty">
            <p>👋 我是你的 AI 学习助手</p>
            <p>关于 AI Agent、MCP、Claude Code、vibe coding 的问题都可以问我</p>
            <p className="ai-chat-empty-hint">回答会结合本地知识库，并标注参考来源</p>
          </div>
        )}
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
                          <span className="ai-src-snippet">{s.content.slice(0, 120)}…</span>
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
              <Loader2 className="spin" size={13} /> AI 正在思考…
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="ai-chat-input">
        <input
          value={input}
          placeholder="输入你的问题，Enter 发送"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={asking}
        />
        <button className="ai-chat-send" onClick={send} disabled={asking || !input.trim()}>
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
