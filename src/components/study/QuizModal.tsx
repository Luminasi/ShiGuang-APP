import { useEffect, useState } from "react";
import { Brain, Eye, Loader2, X } from "lucide-react";
import type { Quiz, StudyPlanNode } from "../../lib/api";
import { aiQuiz } from "../../lib/api";

/** 学习完毕确认弹窗：是否通过题目巩固知识点 */
export function QuizPromptModal({
  node,
  onYes,
  onNo,
}: {
  node: StudyPlanNode;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="toast-mask" onClick={onNo}>
      <div className="toast-card study-quiz-prompt">
        <h3>🎯 当前知识点已学习完毕</h3>
        <p>是否通过一道面试题来巩固「{node.title}」？</p>
        <div className="study-quiz-actions">
          <button className="study-primary-btn" onClick={onYes}>
            好，出题考考我
          </button>
          <button className="study-ghost-btn" onClick={onNo}>
            下次再说
          </button>
        </div>
      </div>
    </div>
  );
}

/** 出题展示：题目 + 参考答案（AI 实时生成，带加载态） */
export default function QuizModal({
  node,
  onClose,
}: {
  node: StudyPlanNode;
  onClose: () => void;
}) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // 出题：attempt 变化时重试
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setQuiz(null);
    setShowAnswer(false);
    aiQuiz(node.id)
      .then((q) => !cancelled && setQuiz(q))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [node.id, attempt]);

  return (
    <div className="toast-mask" onClick={onClose}>
      <div className="toast-card study-quiz" onClick={(e) => e.stopPropagation()}>
        <div className="study-quiz-head">
          <h3>
            <Brain size={18} /> 面试巩固 · {node.title}
          </h3>
          <button className="study-detail-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="study-quiz-loading">
            <Loader2 className="spin" size={22} />
            <p>AI 正在出题…</p>
          </div>
        )}
        {error && (
          <div className="study-quiz-error">
            <p>{error}</p>
            <button className="study-ghost-btn" onClick={() => setAttempt((a) => a + 1)}>
              重新出题
            </button>
          </div>
        )}
        {quiz && (
          <>
            <div className="study-quiz-question">{quiz.question}</div>
            <div className="study-quiz-actions">
              {!showAnswer ? (
                <button className="study-primary-btn" onClick={() => setShowAnswer(true)}>
                  <Eye size={15} /> 查看参考答案
                </button>
              ) : (
                <button className="study-ghost-btn" onClick={() => setShowAnswer(false)}>
                  收起答案
                </button>
              )}
            </div>
            {showAnswer && (
              <div className="study-quiz-answer">
                <h4>参考答案</h4>
                <p>{quiz.model_answer}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
