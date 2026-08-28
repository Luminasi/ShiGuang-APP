import { useCallback, useEffect, useState } from "react";
import type { GenerateResult, StudyPlan, StudyPlanNode } from "../../lib/api";
import {
  deletePlan,
  getSetting,
  listPlanNodes,
  listStudyPlans,
  setSetting,
  togglePlanNode,
} from "../../lib/api";
import StudyOnboarding from "./StudyOnboarding";
import PlanGenerating from "./PlanGenerating";
import TaskTreeCanvas from "./TaskTreeCanvas";
import NodeDetailPanel from "./NodeDetailPanel";
import AiBubble from "./AiBubble";
import AiChatPanel from "./AiChatPanel";
import QuizModal, { QuizPromptModal } from "./QuizModal";

type Phase = "boot" | "onboarding" | "planning" | "study";

const SETTINGS = {
  onboarded: "study.onboarded",
  activePlan: "study.active_plan_id",
  profile: "study.profile",
} as const;

/**
 * 学习任务模块：状态机容器
 * boot（读设置）→ onboarding（首启引导）→ planning（AI 生成计划）→ study（任务树）
 * 学习内容：AI Agent 与 vibe coding；AI 助手基于本机 Claude Code + 本地知识库。
 */
export default function StudyView() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [profile, setProfile] = useState("");

  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [nodes, setNodes] = useState<StudyPlanNode[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quizNode, setQuizNode] = useState<StudyPlanNode | null>(null);
  const [finishNode, setFinishNode] = useState<StudyPlanNode | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GenerateResult | null>(null);

  // 启动：读设置判定阶段
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [onboarded, activeId, savedProfile] = await Promise.all([
        getSetting(SETTINGS.onboarded),
        getSetting(SETTINGS.activePlan),
        getSetting(SETTINGS.profile),
      ]);
      if (cancelled) return;
      setProfile(savedProfile ?? "");
      if (onboarded !== "1") {
        setPhase("onboarding");
      } else if (!activeId) {
        setPhase("planning");
      } else {
        await enterStudy(Number(activeId), savedProfile ?? "");
        if (!cancelled) setPhase("study");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 进入任务树：加载计划与整棵树 */
  const enterStudy = useCallback(async (planId: number, profileJson: string) => {
    const plans = await listStudyPlans(false);
    const p = plans.find((x) => x.id === planId) ?? null;
    if (!p) {
      // 计划不存在（可能被删），清掉 active 标记
      await setSetting(SETTINGS.activePlan, "");
      return;
    }
    setPlan(p);
    setProfile(profileJson || p.meta || "");
    setNodes(await listPlanNodes(planId));
  }, []);

  // 引导完成：保存画像与标记
  const handleOnboarded = useCallback(async (profileJson: string) => {
    await Promise.all([
      setSetting(SETTINGS.profile, profileJson),
      setSetting(SETTINGS.onboarded, "1"),
    ]);
    setProfile(profileJson);
    setPhase("planning");
  }, []);

  // 计划生成完成
  const handleGenerated = useCallback((result: GenerateResult) => {
    setGenerated(result);
  }, []);

  const confirmGenerated = useCallback(async () => {
    if (!generated) return;
    await setSetting(SETTINGS.activePlan, String(generated.plan_id));
    setGenerated(null);
    setGenError(null);
    await enterStudy(generated.plan_id, profile);
    setPhase("study");
  }, [generated, profile, enterStudy]);

  const retryGenerate = useCallback(() => {
    setGenError(null);
    setPhase("planning");
  }, []);

  // 放弃生成：重置引导标记回到 onboarding，可重新认识界面 / 重填信息
  const skipGenerate = useCallback(async () => {
    await setSetting(SETTINGS.onboarded, "");
    setGenError(null);
    setGenerated(null);
    setPhase("onboarding");
  }, []);

  // 统一处理完成标记：落库 + 更新树 + 完成时询问是否出题巩固
  const handleToggle = useCallback(async (node: StudyPlanNode, done: boolean) => {
    const updated = await togglePlanNode(node.id, done);
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    if (done && node.kind !== "day") {
      setFinishNode(updated);
    }
  }, []);

  // 重新规划：归档旧计划 → 回 planning
  const replan = useCallback(async () => {
    if (plan) {
      // 旧计划归档，避免列表混乱
      await deletePlan(plan.id).catch(() => undefined);
    }
    await setSetting(SETTINGS.activePlan, "");
    setPlan(null);
    setNodes([]);
    setSelectedId(null);
    setPhase("planning");
  }, [plan]);

  return (
    <div className="study-view">
      {phase === "boot" && <div className="study-boot">正在准备学习空间…</div>}

      {phase === "onboarding" && <StudyOnboarding onDone={handleOnboarded} />}

      {phase === "planning" && (
        <PlanGenerating
          profile={profile}
          error={genError}
          onGenerated={handleGenerated}
          onError={setGenError}
          onRetry={retryGenerate}
          onSkip={skipGenerate}
        />
      )}

      {phase === "study" && plan && (
        <>
          <TaskTreeCanvas
            plan={plan}
            nodes={nodes}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onToggle={handleToggle}
            onReplan={replan}
          />
          {selectedId !== null && (
            <NodeDetailPanel
              node={nodes.find((n) => n.id === selectedId) ?? null}
              onClose={() => setSelectedId(null)}
              onToggle={handleToggle}
              onQuiz={(node) => setQuizNode(node)}
            />
          )}
        </>
      )}

      {/* AI 小助手（悬浮层，正交于主流程） */}
      {phase === "study" && !chatOpen && (
        <AiBubble onClick={() => setChatOpen(true)} />
      )}
      {phase === "study" && chatOpen && (
        <AiChatPanel onClose={() => setChatOpen(false)} />
      )}

      {/* 计划生成完成弹窗 */}
      {generated && (
        <div className="toast-mask" onClick={() => setGenerated(null)}>
          <div className="toast-card study-gen-done">
            <h3>🎉 学习计划已生成</h3>
            <p>
              已为你安排 {generated.node_count} 个学习节点，
              先看看任务树，从第一天开始吧！
            </p>
            <button className="study-primary-btn" onClick={confirmGenerated}>
              进入任务树，开始学习
            </button>
            <button className="study-ghost-btn" onClick={() => setGenerated(null)}>
              稍后再看
            </button>
          </div>
        </div>
      )}

      {/* 学习完毕 → 是否出题巩固 */}
      {finishNode && (
        <QuizPromptModal
          node={finishNode}
          onYes={() => {
            setQuizNode(finishNode);
            setFinishNode(null);
          }}
          onNo={() => setFinishNode(null)}
        />
      )}

      {/* 出题弹窗 */}
      {quizNode && (
        <QuizModal
          node={quizNode}
          onClose={() => setQuizNode(null)}
        />
      )}
    </div>
  );
}
