import type { AppModule } from "../modules";

/** 模块占位页：模块功能在后续阶段逐个开发 */
export default function PlaceholderView({ mod }: { mod: AppModule }) {
  const Icon = mod.icon;
  return (
    <div className="placeholder-view">
      <Icon size={40} strokeWidth={1.4} className="placeholder-icon" />
      <h2>{mod.name}</h2>
      <p>{mod.description}</p>
      <span className="placeholder-tag">模块开发中，敬请期待</span>
    </div>
  );
}
