import { useEffect, useRef, useState } from "react";

/**
 * 游戏模块开机动画（Switch 风格增强版）：
 * 深色空间中白色发光圆环从大收缩到中心 → 收尾瞬间粒子从中心爆散
 * → 白屏一闪 → 淡出进入游戏界面。
 * 全程约 2.6 秒，点击任意处立即跳过（跳过也会触发粒子爆散）。
 */

/** 在 canvas 上播一次中心爆散粒子（约 1 秒，自动结束） */
function burstParticles(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
  const cx = W / 2;
  const cy = H / 2;

  const ps: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    max: number;
  }[] = [];
  const N = 180;
  for (let i = 0; i < N; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 7;
    ps.push({
      x: cx,
      y: cy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp * 0.85,
      r: 1 + Math.random() * 2.4,
      max: 450 + Math.random() * 550,
    });
  }

  let raf = 0;
  const start = performance.now();
  const step = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of ps) {
      const k = Math.min(1, t / p.max);
      if (k >= 1) continue;
      alive++;
      const damp = 1 - k * 0.65;
      p.x += p.vx * damp;
      p.y += p.vy * damp;
      p.vx *= 0.985;
      p.vy *= 0.985;
      ctx.globalAlpha = (1 - k) * 0.95;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    if (alive > 0) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export default function BootIntro({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [boom, setBoom] = useState(false); // 粒子爆散
  const [out, setOut] = useState(false); // 开始淡出

  // 时间线：收缩约 1.5s → 1.35s 粒子爆散 → 1.9s 白闪淡出
  useEffect(() => {
    const t1 = setTimeout(() => setBoom(true), 1350);
    const t2 = setTimeout(() => setOut(true), 1900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (!boom) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    return burstParticles(canvas);
  }, [boom]);

  useEffect(() => {
    if (!out) return;
    const t = setTimeout(onDone, 550);
    return () => clearTimeout(t);
  }, [out, onDone]);

  const skip = () => {
    setBoom(true);
    setOut(true);
  };

  return (
    <div className="boot-mask" onClick={skip}>
      <div className="boot-glow" />
      <div className={`boot-ring${out ? " boot-ring-out" : ""}`}>
        <div className="boot-ring-core" />
      </div>
      <canvas ref={canvasRef} className="boot-particles" />
      <div className={`boot-flash${out ? " boot-flash-in" : ""}`} />
      <div className="boot-skip">点击任意处跳过</div>
    </div>
  );
}
