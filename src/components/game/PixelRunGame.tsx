import { useEffect, useRef, useState } from "react";
import { ChevronLeft, RotateCcw, Wind, Zap } from "lucide-react";
import { getSetting, setSetting } from "../../lib/api";
import {
  CD_DASH,
  CD_FAN,
  createState,
  HIGH_SCORE_KEY,
  restartState,
  tryCast,
  tryJump,
  update,
  W,
  type GamePhase,
} from "./engine";
import { loadPlayerAssets, renderGame, type PlayerAssets } from "./sprites";
import { resumeAudio, sfxReady, sfxSmash, sfxDie, sfxRecord, sfxStart, sfxJump, sfxFan, sfxDash } from "./audio";

/**
 * 像素跑酷小游戏：不知火舞 × 花蝶扇 × 忍蜂。
 * 固定内部分辨率 480x270，canvas 像素风；rAF 主循环驱动 engine（ref 可变状态），
 * React state 只在开局/结算时变更；技能按钮 CD 遮罩由 rAF 直写 CSS 变量。
 */
export default function PixelRunGame({ onBack }: { onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createState(0)); // 可变游戏状态（主循环直改）
  const assetsRef = useRef<PlayerAssets | null>(null);
  const cdBtn1Ref = useRef<HTMLButtonElement>(null);
  const cdBtn2Ref = useRef<HTMLButtonElement>(null);
  const notifiedRef = useRef(false); // 死亡只结算一次
  const highScoreRef = useRef(0); // 开局时读入的历史最高分（判断破纪录）

  const [phase, setPhase] = useState<GamePhase>("ready");
  const [showSettle, setShowSettle] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [isRecord, setIsRecord] = useState(false);

  // 主循环 + 键盘 + 数据加载（StrictMode 双挂载安全：cleanup 全部释放）
  useEffect(() => {
    let alive = true;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = stateRef.current;

      // 逻辑推进 + 事件播音效
      for (const ev of update(s, dt)) {
        if (ev === "smash") sfxSmash();
        else if (ev === "ready1" || ev === "ready2") sfxReady();
        else if (ev === "die") handleDie();
      }

      // 技能按钮冷却遮罩（直写 DOM，不走 React）
      const cd1 = Math.min(1, s.cd1 / CD_FAN);
      const cd2 = Math.min(1, s.cd2 / CD_DASH);
      cdBtn1Ref.current?.style.setProperty("--cd", cd1.toFixed(3));
      cdBtn2Ref.current?.style.setProperty("--cd", cd2.toFixed(3));

      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && assetsRef.current) renderGame(ctx, s, assetsRef.current);
      raf = requestAnimationFrame(frame);
    };

    // 素材（失败兜底像素帧）+ 最高分
    loadPlayerAssets().then((a) => {
      if (alive) assetsRef.current = a;
    });
    getSetting(HIGH_SCORE_KEY)
      .then((v) => {
        if (!alive) return;
        const hs = Number(v) || 0;
        highScoreRef.current = hs;
        stateRef.current = createState(hs);
      })
      .catch(() => undefined);

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      if (code === "Space" || code === "ArrowUp" || code === "KeyW") {
        e.preventDefault();
        if (e.repeat) return;
        const s = stateRef.current;
        s.player.jumpHold = true;
        resumeAudio();
        if (tryJump(s)) sfxJump();
      } else if (code === "KeyJ" || code === "Digit1") {
        if (e.repeat) return;
        cast(1);
      } else if (code === "KeyK" || code === "Digit2") {
        if (e.repeat) return;
        cast(2);
      } else if (code === "Escape") {
        onBack();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        stateRef.current.player.jumpHold = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 施放技能（按钮点击）；返回是否施放成功 */
  const cast = (slot: 1 | 2) => {
    resumeAudio();
    const r = tryCast(stateRef.current, slot);
    if (r === "fan") sfxFan();
    else if (r === "dash") sfxDash();
  };

  /** 死亡结算（一次性）：写最高分 + 新纪录音效 */
  const handleDie = () => {
    const s = stateRef.current;
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    const fin = Math.floor(s.score);
    const rec = fin > highScoreRef.current && fin > 0;
    setFinalScore(fin);
    setBestScore(Math.floor(s.highScore));
    setIsRecord(rec);
    setPhase("dead");
    setShowSettle(true);
    if (rec) {
      sfxRecord();
      void setSetting(HIGH_SCORE_KEY, String(fin)).catch(() => undefined);
    } else {
      sfxDie();
    }
  };

  /** 开局（开始按钮 / 再来一局） */
  const start = () => {
    resumeAudio();
    sfxStart();
    stateRef.current.phase = "running";
    setPhase("running");
  };

  const retry = () => {
    resumeAudio();
    sfxStart();
    stateRef.current = restartState(stateRef.current);
    notifiedRef.current = false;
    setShowSettle(false);
    setPhase("running");
  };

  return (
    <div className="pixel-run-root">
      {/* 顶部条 */}
      <div className="pixel-run-bar">
        <button className="pixel-run-back" onClick={onBack}>
          <ChevronLeft size={16} /> 返回游戏库
        </button>
        <span className="pixel-run-title">像素跑酷 · 不知火舞</span>
        <span className="pixel-run-hint">空格 跳跃 · J 花蝶扇 · K 忍蜂 · Esc 返回</span>
      </div>

      {/* 舞台 */}
      <div className="pixel-run-stage">
        <canvas ref={canvasRef} width={W} height={270} className="pixel-run-canvas" />

        {/* 开始界面 */}
        {phase === "ready" && (
          <div className="pixel-run-overlay">
            <div className="pixel-run-intro">
              <h3>不知火舞的像素跑酷</h3>
              <p>空格/↑ 跳跃 · J 花蝶扇（6s CD）击碎障碍 · K 忍蜂（12s CD）突刺穿行</p>
              <button className="pixel-run-start" onClick={start}>
                开始奔跑
              </button>
            </div>
          </div>
        )}

        {/* 结算界面 */}
        {showSettle && (
          <div className="pixel-run-overlay">
            <div className="pixel-run-settle">
              <h3>游戏结束</h3>
              {isRecord && <div className="pixel-run-record">🏆 新纪录！</div>}
              <p>
                本次得分 <b>{finalScore}</b>
              </p>
              <p>
                最高分 <b>{bestScore}</b>
              </p>
              <div className="pixel-run-settle-actions">
                <button className="pixel-run-start" onClick={retry}>
                  <RotateCcw size={15} /> 再来一局
                </button>
                <button className="pixel-run-back-btn" onClick={onBack}>
                  返回游戏库
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 技能按钮（CD 遮罩 rAF 直写 --cd） */}
        <div className="pixel-run-skillbar">
          <button
            ref={cdBtn1Ref}
            className="pixel-run-skill-btn"
            onClick={() => cast(1)}
            title="花蝶扇（J）：向前丢出扇子，击碎路径上的障碍，冷却 6 秒"
          >
            <span className="pixel-run-skill-cd" />
            <Wind size={17} />
            <span className="pixel-run-skill-name">花蝶扇</span>
            <span className="pixel-run-skill-key">J</span>
          </button>
          <button
            ref={cdBtn2Ref}
            className="pixel-run-skill-btn"
            onClick={() => cast(2)}
            title="忍蜂（K）：向前突刺，无视一切障碍，冷却 12 秒"
          >
            <span className="pixel-run-skill-cd" />
            <Zap size={17} />
            <span className="pixel-run-skill-name">忍蜂</span>
            <span className="pixel-run-skill-key">K</span>
          </button>
        </div>
      </div>
    </div>
  );
}
