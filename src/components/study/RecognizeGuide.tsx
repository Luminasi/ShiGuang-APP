import { useState } from "react";
import { Check, ChevronRight, RotateCcw, Sparkles, X } from "lucide-react";

interface QuizItem {
  q: string;
  options: string[];
  /** 正确选项索引 */
  answer: number;
  /** 答完后的讲解提示 */
  tip: string;
}

const QUIZ: QuizItem[] = [
  {
    q: "界面最顶部那一栏是什么？",
    options: ["标题栏", "状态栏", "菜单栏"],
    answer: 1,
    tip: "顶部是状态栏：左边「用户 / 设置 / 使用说明」入口，中间实时北京时间，右边是最小化、最大化、关闭窗口的按钮。",
  },
  {
    q: "左侧那一排竖着的小图标是？",
    options: ["应用托盘", "快捷收藏", "模块导航栏"],
    answer: 2,
    tip: "左侧是导航栏，共 5 个模块：首页总览、今日计划、学习任务、游戏娱乐、散步遛狗。鼠标悬停浮出名称，点击即切换。",
  },
  {
    q: "「首页总览」是干什么的？",
    options: ["各模块今日状态一览", "只看游戏时长", "搜索全应用"],
    answer: 0,
    tip: "首页总览把各模块今天的状态汇总在一屏：计划完成情况、学习进度、游戏时长等。目前还在开发中，敬请期待。",
  },
  {
    q: "想记录今天要做的事，应该点哪个模块？",
    options: ["游戏娱乐", "今日计划", "学习任务"],
    answer: 1,
    tip: "今日计划：添加事项、安排时间段、完成后打勾，一天的时间安排都在这里。",
  },
  {
    q: "AI 规划的学习任务树在哪个模块？",
    options: ["学习任务", "今日计划", "首页总览"],
    answer: 0,
    tip: "学习任务模块里有 AI 生成的任务树：必学 / 选修标注、讲解与练习、推荐资料，学完还能出面试题巩固。",
  },
  {
    q: "学习页右下角的红白精灵球是什么？",
    options: ["游戏入口", "AI 学习小助手", "通知中心"],
    answer: 1,
    tip: "那是 AI 学习小助手。点击展开对话面板，关于 AI Agent、MCP、Claude Code 的问题都可以问它，回答会标注参考来源。",
  },
  {
    q: "想记录游戏时长和统计，去哪个模块？",
    options: ["今日计划", "学习任务", "游戏娱乐"],
    answer: 2,
    tip: "游戏娱乐：自动扫描 Steam 与本机游戏、计时器记录游玩时长、历史统计一应俱全。",
  },
  {
    q: "出门遛狗的记录在哪里？",
    options: ["散步遛狗", "今日计划", "游戏娱乐"],
    answer: 0,
    tip: "散步遛狗模块记录出门时间与路线。数据层已就绪，界面开发中，敬请期待。",
  },
];

/**
 * 认识界面问答引导：一屏一题（选择题），
 * 答完显示对错与讲解提示 → 下一题；末题进完成页。
 * 独立于使用说明：由首启引导末页「先认识一下你这个界面」引子进入，
 * 认识完（onDone）直接进入信息收集。
 */
export default function RecognizeGuide({
  onClose,
  onDone,
}: {
  onClose: () => void;
  /** 认识完：进入信息收集 */
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const item = QUIZ[index];
  const answered = selected !== null;
  const isCorrect = answered && selected === item.answer;
  const isLast = index === QUIZ.length - 1;

  const choose = (i: number) => {
    if (answered) return;
    setSelected(i);
  };

  const next = () => {
    if (isLast) {
      setDone(true);
    } else {
      setIndex(index + 1);
      setSelected(null);
    }
  };

  // 完成页
  if (done) {
    return (
      <div className="toast-mask guide-mask">
        <div className="guide-card guide-done">
          <button className="help-close" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
          <div className="guide-done-icon">🎉</div>
          <h2>界面认全了！</h2>
          <p>
            状态栏、导航栏、五个模块……现在你已经知道每个地方是干什么的了。
            界面看着复杂，其实就这几块，多用几次就熟了。
          </p>
          <div className="guide-done-actions">
            <button
              className="guide-nav-btn ghost"
              onClick={() => {
                setIndex(0);
                setSelected(null);
                setDone(false);
              }}
            >
              <RotateCcw size={15} /> 再认识一遍
            </button>
            <button className="guide-nav-btn primary" onClick={onDone}>
              下一步：填写学习信息 <Sparkles size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="toast-mask guide-mask">
      <div className="guide-card" key={index}>
        <button className="help-close" onClick={onClose} title="关闭">
          <X size={18} />
        </button>

        {/* 进度：第 N / 8 题 + 进度条 */}
        <div className="guide-progress">
          <span className="guide-progress-text">
            第 {index + 1} / {QUIZ.length} 题
          </span>
          <div className="guide-progress-bar">
            <div
              className="guide-progress-fill"
              style={{
                width: `${((index + (answered ? 1 : 0)) / QUIZ.length) * 100}%`,
              }}
            />
          </div>
        </div>

        <h2 className="guide-q">{item.q}</h2>

        <div className="guide-options">
          {item.options.map((opt, i) => {
            let cls = "guide-option";
            if (answered) {
              if (i === item.answer) cls += " correct";
              else if (i === selected) cls += " wrong";
              else cls += " dim";
            }
            return (
              <button key={i} className={cls} onClick={() => choose(i)} disabled={answered}>
                <span className="guide-opt-key">{String.fromCharCode(65 + i)}</span>
                {opt}
                {answered && i === item.answer && <Check size={16} className="guide-opt-mark" />}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className={`guide-tip ${isCorrect ? "ok" : "no"}`}>
            <div className="guide-tip-head">
              {isCorrect ? "答对了" : `答案是 ${String.fromCharCode(65 + item.answer)}`}
            </div>
            <p>{item.tip}</p>
          </div>
        )}

        {answered && (
          <button className="guide-nav-btn primary guide-next" onClick={next}>
            {isLast ? "完成" : "下一题"} <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
