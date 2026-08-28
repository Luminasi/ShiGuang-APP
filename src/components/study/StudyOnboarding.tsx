import { useState } from "react";
import { ArrowRight, ChevronLeft, Sparkles, Target, TreePine, Wand2 } from "lucide-react";
import ProfileForm from "./ProfileForm";
import RecognizeGuide from "./RecognizeGuide";

const PAGES = [
  {
    icon: Target,
    title: "学习任务 · AI 学习助手",
    body: "这里是你学习「AI Agent 与 vibe coding」的专属空间。AI 助手会根据你的进度规划 1-2 周的学习阶段，把每天要学的内容整理成任务树，标注必学与选修，配讲解、练习与推荐资料，学完还能出面试题帮你巩固。",
  },
  {
    icon: Sparkles,
    title: "慢慢来，比较快",
    body: "不用焦虑进度，每天完成几个小节点就是进步。把 AI 当作你的学习搭子：它负责规划、讲解和出题，你负责动手和提问。坚持下去，一个月后的你会感谢现在的自己。",
  },
  {
    icon: TreePine,
    title: "现在让我来为你安排学习计划吧",
    body: "接下来只需要几分钟：告诉我你想学什么、现在学到哪了，我就能为你生成一份专属的学习计划。之后随时可以呼出右下角的精灵球问我任何问题。",
    start: true,
  },
];

/**
 * 首次使用引导：多页说明 → 末页「先认识一下你这个界面」引子 / 「开始」→ 信息收集表单
 */
export default function StudyOnboarding({ onDone }: { onDone: (profile: string) => void }) {
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  if (formOpen) {
    return <ProfileForm onDone={onDone} onBack={() => setFormOpen(false)} />;
  }

  const p = PAGES[page];
  const Icon = p.icon;

  return (
    <div className="study-onboarding">
      <div className="study-onb-page" key={page}>
        <Icon size={56} strokeWidth={1.3} className="study-onb-icon" />
        <h2>{p.title}</h2>
        <p className="study-onb-body">{p.body}</p>
      </div>

      {/* 底部导航：上一页 / 下一页 / 开始 */}
      <div className="study-onb-footer">
        {page > 0 ? (
          <button className="study-ghost-btn" onClick={() => setPage(page - 1)}>
            <ChevronLeft size={16} /> 上一个
          </button>
        ) : (
          <span />
        )}
        <div className="study-onb-dots">
          {PAGES.map((_, i) => (
            <span
              key={i}
              className={`study-onb-dot ${i === page ? "active" : ""}`}
              onClick={() => setPage(i)}
            />
          ))}
        </div>
        {p.start ? (
          <>
            <button className="study-primary-btn" onClick={() => setFormOpen(true)}>
              现在让我来为你安排学习计划吧 <ArrowRight size={16} />
            </button>
            {/* 引子：独立的认识界面问答引导 */}
            <button className="study-ghost-btn study-onb-guide-btn" onClick={() => setGuideOpen(true)}>
              <Wand2 size={15} /> 先认识一下你这个界面
            </button>
          </>
        ) : (
          <button className="study-primary-btn" onClick={() => setPage(page + 1)}>
            下一个 <ArrowRight size={16} />
          </button>
        )}
      </div>

      {/* 认识界面引导：独立一屏一问，认识完进入信息收集 */}
      {guideOpen && (
        <RecognizeGuide
          onClose={() => setGuideOpen(false)}
          onDone={() => {
            setGuideOpen(false);
            setFormOpen(true);
          }}
        />
      )}
    </div>
  );
}
