/** 初始欢迎页：品牌眉标 + 渐变标题（阶段 6 主题化） */
export default function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-eyebrow">
          <span className="welcome-eyebrow-line" />
          拾光<em> · </em>让每一次专注，都留下生长的痕迹
          <span className="welcome-eyebrow-line" />
        </div>
        <h1 className="welcome-title">今天想做些什么</h1>
        <p className="welcome-sub">今天也要好好生活</p>
      </div>
    </div>
  );
}
