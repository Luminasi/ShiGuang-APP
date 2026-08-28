import { useEffect, useRef, useState } from "react";
import type { GenerateResult } from "../../lib/api";
import { generateStudyPlan } from "../../lib/api";

const STEPS = [
  "正在分析你的学习进度…",
  "正在规划一周的学习阶段…",
  "正在整理必学与选修内容…",
  "正在准备练习与学习资料…",
];

/**
 * 规划生成过渡：加载球 + 分步文案轮换。
 * 挂载即调用 generate_study_plan（10-60s），完成后回调；失败显示重试。
 */
export default function PlanGenerating({
  profile,
  error,
  onGenerated,
  onError,
  onRetry,
  onSkip,
}: {
  profile: string;
  error: string | null;
  onGenerated: (result: GenerateResult) => void;
  onError: (msg: string) => void;
  onRetry: () => void;
  /** 失败时放弃生成：退出到引导（重新认识界面 / 重填信息） */
  onSkip?: () => void;
}) {
  const [step, setStep] = useState(0);
  const runningRef = useRef(false);

  // 分步文案轮换
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2500);
    return () => clearInterval(t);
  }, []);

  // 触发生成（仅一次；重试时 error 变化重新触发）
  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    generateStudyPlan(profile)
      .then(onGenerated)
      .catch((e) => onError(String(e)))
      .finally(() => {
        runningRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  if (error) {
    return (
      <div className="study-planning">
        <div className="study-planning-card">
          <h2>😕 计划生成失败了</h2>
          <p className="study-gen-error-text">{error}</p>
          <p className="study-gen-hint">
            常见原因：AI 生成超时（本机模型较慢，可稍后重试）、
            或未登录 Claude Code（终端执行 <code>claude</code> 完成一次登录）。
          </p>
          <div className="study-gen-actions">
            <button className="study-primary-btn" onClick={onRetry}>
              重试
            </button>
            {onSkip && (
              <button className="study-ghost-btn" onClick={onSkip}>
                先不生成，重新走一遍引导
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="study-planning">
      <div className="study-ball" aria-hidden>
        <div className="study-ball-top" />
        <div className="study-ball-line" />
        <div className="study-ball-bottom" />
        <div className="study-ball-button" />
      </div>
      <h2 className="study-planning-title">为你安排学习计划</h2>
      <p className="study-planning-step" key={step}>
        {STEPS[step]}
      </p>
      <p className="study-planning-hint">AI 正在思考，通常需要 1-3 分钟，请稍候…</p>
    </div>
  );
}
