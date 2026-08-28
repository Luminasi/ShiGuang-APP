import { Check, ExternalLink, GraduationCap, HelpCircle, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { StudyPlanNode } from "../../lib/api";

/** 轻量 markdown 渲染：标题 / 分段 / - 列表 / 行内 code / 粗体，不引第三方依赖 */
function renderMd(text: string): React.ReactNode[] {
  const blocks = text.split(/\n{2,}|\n(?=#{1,3} |- )/);
  return blocks.filter((b) => b.trim()).map((b, i) => {
    const t = b.trim();
    if (t.startsWith("### ")) return <h5 key={i}>{t.slice(4)}</h5>;
    if (t.startsWith("## ")) return <h4 key={i}>{t.slice(3)}</h4>;
    if (t.startsWith("# ")) return <h4 key={i}>{t.slice(2)}</h4>;
    if (t.startsWith("- ")) {
      return (
        <ul key={i}>
          {t.split("\n").filter((x) => x.trim().startsWith("- ")).map((x, j) => (
            <li key={j}>
              {inlineMd(x.trim().slice(2))}
            </li>
          ))}
        </ul>
      );
    }
    return <p key={i}>{inlineMd(t)}</p>;
  });
}

/** 行内格式：`code` 与 **粗体** */
function inlineMd(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return p;
  });
}

/**
 * 节点详情面板（右侧滑出）：讲解 / 练习 / 开始学习（打开推荐资源）/ 标记完成
 */
export default function NodeDetailPanel({
  node,
  onClose,
  onToggle,
  onQuiz,
}: {
  node: StudyPlanNode | null;
  onClose: () => void;
  onToggle: (node: StudyPlanNode, done: boolean) => void;
  onQuiz: (node: StudyPlanNode) => void;
}) {
  if (!node) return null;
  const isDay = node.kind === "day";

  const openResource = async () => {
    const url = node.resource_url;
    if (!url || !/^https?:\/\//i.test(url)) return;
    await openUrl(url);
  };

  const finish = () => {
    onToggle(node, true);
  };

  return (
    <div className="study-detail-mask" onClick={onClose}>
      <div className="study-detail" onClick={(e) => e.stopPropagation()}>
        <div className="study-detail-head">
          <div>
            <div className="study-detail-tags">
              <span className={`study-node-required ${node.required ? "must" : "elective"}`}>
                {node.required ? "必学" : "选修"}
              </span>
              <span className="study-node-kind">{isDay ? "当天主题" : node.kind === "task" ? "知识点" : "细分点"}</span>
              {node.done && <span className="study-node-done-tag">✓ 已完成</span>}
            </div>
            <h3>{node.title}</h3>
          </div>
          <button className="study-detail-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="study-detail-body">
          {node.content ? (
            <div className="study-md">{renderMd(node.content)}</div>
          ) : (
            <p className="study-md-empty">这个节点没有详细讲解，去完成你的实践吧</p>
          )}

          {node.exercise && (
            <div className="study-exercise">
              <h4>
                <GraduationCap size={15} /> 练习
              </h4>
              <div className="study-md">{renderMd(node.exercise)}</div>
            </div>
          )}
        </div>

        <div className="study-detail-foot">
          {node.resource_url && /^https?:\/\//i.test(node.resource_url) ? (
            <button className="study-ghost-btn" onClick={openResource}>
              <ExternalLink size={15} />
              {node.resource_label || "开始学习（打开资料）"}
            </button>
          ) : (
            <span className="study-no-link">本节点无外部链接，直接阅读讲解即可</span>
          )}
          <div className="study-detail-foot-right">
            {!node.done && (
              <>
                <button className="study-ghost-btn" onClick={finish}>
                  <Check size={15} /> 学习完毕
                </button>
                <button className="study-primary-btn" onClick={() => onQuiz(node)}>
                  <HelpCircle size={15} /> 出题巩固
                </button>
              </>
            )}
            {node.done && (
              <button className="study-ghost-btn" onClick={() => onQuiz(node)}>
                <HelpCircle size={15} /> 再做一题
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
