import { useState } from "react";
import { ArrowRight, ChevronLeft, Send } from "lucide-react";

const TOPICS = [
  "Agent 原理",
  "工具链与 RAG",
  "MCP",
  "Claude Code 实操",
  "vibe coding 工作流",
  "项目实战",
] as const;

const LEVELS = ["零基础", "初级", "中级", "高级"] as const;

const HOURS = ["少于 3 小时", "3-6 小时", "6-10 小时", "10 小时以上"] as const;

const JOBS = ["AI 应用开发", "后端开发", "前端开发", "全栈", "数据分析", "其他"] as const;

const EXP = ["0-1 年", "1-3 年", "3-5 年", "5 年以上"] as const;

const HOBBIES = ["视频教程", "图文阅读", "代码示例", "动手实践"] as const;

interface ProfileData {
  topics: string[];
  level: string;
  hoursPerWeek: string;
  job: string;
  expYears: string;
  hobbies: string[];
  note: string;
}

const emptyProfile: ProfileData = {
  topics: [],
  level: "",
  hoursPerWeek: "",
  job: "",
  expYears: "",
  hobbies: [],
  note: "",
};

/** 一屏一问：每题一个字段，必填题需选择才能进下一步 */
const STEPS: {
  q: string;
  sub?: string;
  type: "multi" | "single" | "text";
  options?: readonly string[];
  key: keyof ProfileData;
  required?: boolean;
  placeholder?: string;
}[] = [
  {
    q: "想学哪些方面？",
    sub: "可以多选，之后 AI 会优先安排这些内容",
    type: "multi",
    options: TOPICS,
    key: "topics",
    required: true,
  },
  {
    q: "现在学到什么程度了？",
    type: "single",
    options: LEVELS,
    key: "level",
    required: true,
  },
  {
    q: "每周可以投入多少学习时间？",
    type: "single",
    options: HOURS,
    key: "hoursPerWeek",
  },
  {
    q: "你的目标岗位是？",
    type: "single",
    options: JOBS,
    key: "job",
  },
  {
    q: "编程经验有多久了？",
    type: "single",
    options: EXP,
    key: "expYears",
  },
  {
    q: "喜欢什么学习方式？",
    sub: "可以多选",
    type: "multi",
    options: HOBBIES,
    key: "hobbies",
  },
  {
    q: "还有什么想告诉 AI 助手？",
    sub: "选填：目标、期望、顾虑……",
    type: "text",
    key: "note",
    placeholder: "比如：我想三个月后能独立完成一个 AI 应用面试项目；我平时晚上才有时间学习…",
  },
];

const REQUIRED_TIPS: Record<string, string> = {
  topics: "请至少选择一个想学的方面",
  level: "请选择当前学习进度",
};

/**
 * 信息收集：一屏一问（想学哪些方面 → 进度 → 时长 → 岗位 → 经验 → 喜好 → 自由文本）。
 * 提交后保存为 study.profile JSON，供 AI 规划与问答使用。
 */
export default function ProfileForm({
  onDone,
  onBack,
}: {
  onDone: (profileJson: string) => void;
  onBack?: () => void;
}) {
  const [data, setData] = useState<ProfileData>(emptyProfile);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const value = data[s.key];
  const answered = Array.isArray(value) ? value.length > 0 : value !== "";

  const setField = (key: keyof ProfileData, v: string | string[]) =>
    setData((d) => ({ ...d, [key]: v }));

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const next = () => {
    if (s.required && !answered) {
      setError(REQUIRED_TIPS[s.key] ?? "请先完成本题");
      return;
    }
    setError("");
    if (isLast) {
      onDone(JSON.stringify(data));
    } else {
      setStep(step + 1);
    }
  };

  const prev = () => {
    setError("");
    setStep(Math.max(0, step - 1));
  };

  return (
    <div className="study-profile">
      <div className="study-profile-card">
        {/* 进度：第 N / 7 题 + 进度条 */}
        <div className="guide-progress">
          <span className="guide-progress-text">
            第 {step + 1} / {STEPS.length} 题
          </span>
          <div className="guide-progress-bar">
            <div
              className="guide-progress-fill"
              style={{ width: `${((step + (answered ? 1 : 0)) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* 当前问题（key 重挂载触发入场动画） */}
        <div key={step}>
          <h2 className="guide-q profile-step-q">{s.q}</h2>
          {s.sub && <p className="profile-step-sub">{s.sub}</p>}

          {s.type === "multi" && s.options && (
            <div className="study-chips">
              {(s.options as readonly string[]).map((opt) => (
                <button
                  key={opt}
                  className={`study-chip ${(value as string[]).includes(opt) ? "selected" : ""}`}
                  onClick={() =>
                    setField(s.key, toggle(value as string[], opt))
                  }
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {s.type === "single" && s.options && (
            <div className="guide-options">
              {(s.options as readonly string[]).map((opt, i) => (
                <button
                  key={opt}
                  className={`guide-option ${value === opt ? "selected" : ""}`}
                  onClick={() => setField(s.key, opt)}
                >
                  <span className="guide-opt-key">{String.fromCharCode(65 + i)}</span>
                  {opt}
                  {value === opt && <span className="guide-opt-check">✓</span>}
                </button>
              ))}
            </div>
          )}

          {s.type === "text" && (
            <textarea
              value={value as string}
              onChange={(e) => setField(s.key, e.target.value)}
              className="study-input study-textarea profile-step-text"
              placeholder={s.placeholder}
              rows={4}
              autoFocus
            />
          )}

          {error && <p className="study-form-error">{error}</p>}
        </div>

        {/* 底部导航 */}
        <div className="study-onb-footer profile-step-foot">
          {step > 0 ? (
            <button className="study-ghost-btn" onClick={prev}>
              <ChevronLeft size={16} /> 上一步
            </button>
          ) : onBack ? (
            <button className="study-ghost-btn" onClick={onBack}>
              <ChevronLeft size={16} /> 返回
            </button>
          ) : (
            <span />
          )}
          <span />
          <button className="study-primary-btn" onClick={next}>
            {isLast ? "完成" : "下一步"}{" "}
            {isLast ? <Send size={16} /> : <ArrowRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
