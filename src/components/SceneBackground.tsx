import { useEffect, useRef, useState } from "react";

export type SceneId = "rain" | "snow" | "cloud";

const SCENES: readonly SceneId[] = ["rain", "snow", "cloud"];

/** 读取本地持久化的场景，默认雨林 */
export function loadScene(): SceneId {
  const saved = localStorage.getItem("shiguang_scene");
  return SCENES.includes(saved as SceneId) ? (saved as SceneId) : "rain";
}

/* ================================================================
   木屋天气三层背景（阶段 6.1）
   ----------------------------------------------------------------
   渲染结构（自下而上，DOM 见组件 return）：
     远景层 .scene-far   整图 cover 铺满 + 景深虚化 blur，视差最慢
                         —— 模拟「窗外更远处」，主图位移时露出的深度衬底
     主图层 .scene-main  整图 contain（完整构图、无拉伸变形），视差较快；
                         内部挂：窗玻璃特效画布 .scene-fx（雨痕/薄霜/光锥，
                         随主图一起视差）+ 室内光池 .scene-pool（screen 混合）
     调色幕 .scene-grade 全屏色温偏移 + UI 面板可读性压暗
     粒子画布 .scene-particles 雨丝/雪花/尘埃（屏幕空间，镜头前层）
     暗角    .scene-bg::after（App.css 按场景配置）
   ----------------------------------------------------------------
   素材替换：改 SCENE_CFG 里各场景的 image 路径即可（public/ 下）。
     横图竖图皆可：竖图自动 contain 居中，两侧留白由虚化远景层补齐。
   构图参数（window / 光池 / beams）均为【图片归一化坐标】(0~1)，
     若更换素材，请按新图构图重新标定 window 与光束起点。
     基准原图：图例/黄昏 (2).jpg，1817×2422。
   ================================================================ */

interface LightPool {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // "r,g,b"
  alpha: number; // 0~1，screen 混合
}

interface BeamCfg {
  from: [number, number]; // 光束起点（图片归一化）
  len: number; // 光束长度（图片高度倍数）
  topW: number; // 锥形顶宽（1080p 屏宽设计像素，运行时随图缩放）
  bottomW: number; // 锥形底宽
  color: string;
  alpha: number;
  phase: number; // 摆动初相位
}

interface SceneCfg {
  image: string;
  filter: string; // 主图层滤镜（色温/饱和度/对比度）
  farFilter: string; // 远景层滤镜 = 主图滤镜 + 景深虚化 + 压暗
  grade: string; // 全屏调色幕（色温偏移 + 面板可读性压暗）
  far: number; // 视差系数：远景层（越小越「远」）
  main: number; // 视差系数：主图层
  maxPx: number; // 鼠标到屏幕边缘时主图层最大位移 px
  window: { x: number; y: number; w: number; h: number }; // 窗玻璃矩形（归一化）
  pools: LightPool[];
  beams: BeamCfg[]; // 仅晴天使用
}

/** 四扇窗格（十字木棂分隔，归一化坐标，用于雨痕/窗外雪的生成区域） */
const PANES_N = [
  { x: 0.19, y: 0.075, w: 0.285, h: 0.3 },
  { x: 0.525, y: 0.075, w: 0.315, h: 0.3 },
  { x: 0.19, y: 0.43, w: 0.285, h: 0.29 },
  { x: 0.525, y: 0.43, w: 0.315, h: 0.29 },
];

/* ================================================================
   SCENE_CFG：三场景全部视觉参数（替换素材 / 调参只改这里）
   ================================================================ */
const SCENE_CFG: Record<SceneId, SceneCfg> = {
  /* ---------- 暖云（晴天）：金色黄昏原图基调 ----------
     滤镜：saturate(1.05) contrast(1.06) brightness(1) sepia(0.05) hue-rotate(-2deg)
     粒子：光锥 3 条 + 逆光尘埃 48 个（上限 80），整体 8s 呼吸 ±15%
     视差：远景 0.30 / 主图 0.60，最大位移 18px */
  cloud: {
    image: "/scenes/cabin-dusk.jpg",
    filter:
      "saturate(1.05) contrast(1.06) brightness(1) sepia(0.05) hue-rotate(-2deg)",
    farFilter:
      "saturate(1.15) contrast(1.02) brightness(0.8) blur(7px)",
    grade:
      "radial-gradient(120% 90% at 50% 40%, rgba(60, 36, 14, 0.05) 30%, rgba(28, 18, 8, 0.16) 100%)",
    far: 0.3,
    main: 0.6,
    maxPx: 18,
    window: { x: 0.19, y: 0.075, w: 0.65, h: 0.645 },
    pools: [], // 晴天阳光已烘焙在原图中，不叠光池
    beams: [
      { from: [0.3, 0.16], len: 0.55, topW: 140, bottomW: 320, color: "255, 210, 150", alpha: 0.08, phase: 0 },
      { from: [0.5, 0.18], len: 0.55, topW: 140, bottomW: 320, color: "255, 210, 150", alpha: 0.12, phase: 2.1 },
      { from: [0.66, 0.15], len: 0.55, topW: 140, bottomW: 320, color: "255, 210, 150", alpha: 0.14, phase: 4.2 },
    ],
  },

  /* ---------- 雨林（雨天）：外冷内暖 ----------
     滤镜：saturate(0.88) contrast(0.92) brightness(0.94) hue-rotate(-4deg)
     粒子（全屏雨丝双深度层，vw/12 条、上限 200）：
       前层 45%：长 18~34px 宽 1.2~1.6 速 620~820px/s 透明度 0.20~0.30
       后层 55%：长 12~24px 宽 0.8~1.1 速 460~600px/s 透明度 0.08~0.16
       倾斜 10°（x 位移 = -速度×0.18）
     玻璃：雨痕 28 条（每窗格 6~8，4→12~18px/s 匀加速，底部渐隐 0.8s 再随机 0.4~1.2s 再生）
             + 缓流水珠 8 个 + 弯折水痕 3 条 + 窗外冷雾
     光效：沙发冷残余 + 室内暖光池（screen）
     视差：远景 0.35 / 主图 0.65，最大位移 16px */
  rain: {
    image: "/scenes/cabin-dusk.jpg",
    filter: "saturate(0.88) contrast(0.92) brightness(0.94) hue-rotate(-4deg)",
    farFilter:
      "saturate(0.9) contrast(0.9) brightness(0.72) hue-rotate(-4deg) blur(9px)",
    grade:
      "linear-gradient(180deg, rgba(58, 70, 76, 0.20) 0%, rgba(34, 42, 48, 0.28) 100%)",
    far: 0.35,
    main: 0.65,
    maxPx: 16,
    window: { x: 0.19, y: 0.075, w: 0.65, h: 0.645 },
    pools: [
      // 沙发区冷色残余（阳光削弱后的灰蓝反光）
      { x: 0.03, y: 0.56, w: 0.52, h: 0.27, color: "160, 190, 200", alpha: 0.08 },
      // 室内暖光池（守候感）
      { x: 0.15, y: 0.6, w: 0.45, h: 0.3, color: "255, 170, 110", alpha: 0.08 },
    ],
    beams: [],
  },

  /* ---------- 雪日（下雪天）：外白内橙 ----------
     滤镜：saturate(0.62) contrast(0.95) brightness(1.02) hue-rotate(10deg)
     粒子（全屏雪花三深度层，vw/24 片、上限 100）：
       近层 12%：r 2.2~3.4 速 40~65px/s 透明度 0.30~0.45，±45°/s 自转
       中层 60%：r 1.2~2.0 速 28~45px/s 透明度 0.20~0.32，水平摇曳
       远层 28%：r 0.6~1.1 速 14~26px/s 透明度 0.12~0.20
       摇曳振幅 4~14px、周期 2.8~5.6s
     玻璃：薄霜蒙版（外框+十字棂 8~30px 羽化霜带、中央冰晶点 12 个、4s 脉动）
             + 窗外雪花 28 片（r 1~2，速 55~90px/s 透视更快）
     光效：窗顶冷白泛光 + 沙发区暖光池（壁炉感）+ 地板冷反光
     视差：远景 0.30 / 主图 0.60，最大位移 18px */
  snow: {
    image: "/scenes/cabin-dusk.jpg",
    filter: "saturate(0.62) contrast(0.95) brightness(1.02) hue-rotate(10deg)",
    farFilter:
      "saturate(0.7) contrast(0.92) brightness(0.88) hue-rotate(10deg) blur(10px)",
    grade:
      "linear-gradient(180deg, rgba(74, 92, 112, 0.20) 0%, rgba(32, 42, 56, 0.26) 100%)",
    far: 0.3,
    main: 0.6,
    maxPx: 18,
    window: { x: 0.19, y: 0.075, w: 0.65, h: 0.645 },
    pools: [
      // 沙发+侧桌暖光池（冰封世界里的炉火小屋）
      { x: 0.1, y: 0.5, w: 0.65, h: 0.45, color: "255, 190, 130", alpha: 0.1 },
      // 地板冷反光
      { x: 0.15, y: 0.75, w: 0.55, h: 0.25, color: "160, 180, 200", alpha: 0.05 },
    ],
    beams: [],
  },
};

/* ---------- 粒子/窗玻璃元素结构 ---------- */

interface RainDrop {
  x: number;
  y: number;
  len: number;
  spd: number;
  a: number;
  wd: number;
  front: boolean;
}

interface Flake {
  bx: number;
  y: number;
  r: number;
  spd: number;
  a: number;
  sway: number;
  period: number;
  phase: number;
  rot: number;
  rotSpd: number;
  near: boolean;
}

interface Dust {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  phase: number;
  vx: number;
  vy: number;
  turn: number;
  big: boolean;
}

interface Streak {
  pane: number;
  x: number;
  y: number;
  spd: number;
  cap: number;
  len: number;
  wd: number;
  a: number;
  delay: number;
}

interface WindowDrop {
  x: number;
  y: number;
  r: number;
  a: number;
  spd: number;
}

interface WindowFlake {
  x: number;
  y: number;
  r: number;
  spd: number;
  a: number;
}

interface SceneBackgroundProps {
  scene: SceneId;
}

export default function SceneBackground({ scene }: SceneBackgroundProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const mainImgRef = useRef<HTMLImageElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const particleRef = useRef<HTMLCanvasElement>(null);
  const [imgReady, setImgReady] = useState(false);
  const [farReady, setFarReady] = useState(false);

  useEffect(() => {
    const cfg = SCENE_CFG[scene];
    const root = rootRef.current;
    const main = mainRef.current;
    const img = mainImgRef.current;
    const fx = fxRef.current;
    const pc = particleRef.current;
    if (!root || !main || !img || !fx || !pc || !imgReady) return;

    const fxctx = fx.getContext("2d");
    const pctx = pc.getContext("2d");
    if (!fxctx || !pctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    // 运行时读取实际尺寸；fallback 为基准图尺寸
    const W = img.naturalWidth || 1817;
    const H = img.naturalHeight || 2422;

    let vw = 0;
    let vh = 0;
    let drawW = 0;
    let drawH = 0;
    let offX = 0;
    let offY = 0;
    let wx = 0;
    let wy = 0;
    let ww = 0;
    let wh = 0;
    let panes: { x: number; y: number; w: number; h: number }[] = [];
    let streaks: Streak[] = [];
    let wDrops: WindowDrop[] = [];
    let winFlakes: WindowFlake[] = [];
    // 用对象属性承载粒子绘制器，规避 TS 对闭包赋值的控制流收窄
    const state = { particles: null as { draw: (t: number) => void } | null };

    // 窗玻璃静态层（雾/霜/泛光，仅 resize 时重绘）
    const staticFx = document.createElement("canvas");
    const sctx = staticFx.getContext("2d");
    if (!sctx) return;

    /* ---------- 全屏粒子系统 ---------- */

    const buildParticles = () => {
      if (scene === "rain") {
        const drops: RainDrop[] = [];
        const n = Math.min(200, Math.round(vw / 12));
        for (let i = 0; i < n; i++) {
          const front = i / n < 0.45;
          drops.push({
            x: Math.random() * vw,
            y: Math.random() * vh,
            len: front ? 18 + Math.random() * 16 : 12 + Math.random() * 12,
            spd: front ? 620 + Math.random() * 200 : 460 + Math.random() * 140,
            a: front ? 0.2 + Math.random() * 0.1 : 0.08 + Math.random() * 0.08,
            wd: front ? 1.2 + Math.random() * 0.4 : 0.8 + Math.random() * 0.3,
            front,
          });
        }
        state.particles = {
          draw: () => {
            pctx.lineCap = "round";
            for (const d of drops) {
              d.y += d.spd / 60;
              d.x -= (d.spd / 60) * 0.18; // 10° 斜落
              if (d.y > vh + d.len) {
                d.y = -d.len;
                d.x = Math.random() * (vw + 80);
              }
              pctx.strokeStyle = d.front
                ? `rgba(215, 231, 236, ${d.a})`
                : `rgba(174, 191, 198, ${d.a})`;
              pctx.lineWidth = d.wd;
              pctx.beginPath();
              pctx.moveTo(d.x, d.y);
              pctx.lineTo(d.x - d.len * 0.18, d.y + d.len);
              pctx.stroke();
            }
          },
        };
      } else if (scene === "snow") {
        const flakes: Flake[] = [];
        const n = Math.min(100, Math.round(vw / 24));
        for (let i = 0; i < n; i++) {
          const p = i / n;
          const near = p < 0.12;
          const mid = !near && p < 0.72;
          flakes.push({
            bx: Math.random() * vw,
            y: Math.random() * vh,
            r: near
              ? 2.2 + Math.random() * 1.2
              : mid
                ? 1.2 + Math.random() * 0.8
                : 0.6 + Math.random() * 0.5,
            spd: near
              ? 40 + Math.random() * 25
              : mid
                ? 28 + Math.random() * 17
                : 14 + Math.random() * 12,
            a: near
              ? 0.3 + Math.random() * 0.15
              : mid
                ? 0.2 + Math.random() * 0.12
                : 0.12 + Math.random() * 0.08,
            sway: 4 + Math.random() * 10,
            period: 2.8 + Math.random() * 2.8,
            phase: Math.random() * Math.PI * 2,
            rot: Math.random() * Math.PI * 2,
            rotSpd: near ? (Math.random() * 2 - 1) * (Math.PI / 4) : 0, // 近层 ±45°/s
            near,
          });
        }
        state.particles = {
          draw: (t) => {
            for (const f of flakes) {
              f.y += f.spd / 60;
              if (f.y > vh + 4) {
                f.y = -4;
                f.bx = Math.random() * vw;
              }
              const x =
                f.bx + Math.sin((t * Math.PI * 2) / f.period + f.phase) * f.sway;
              pctx.fillStyle = `rgba(239, 247, 252, ${f.a})`;
              if (f.near) {
                f.rot += f.rotSpd / 60;
                pctx.save();
                pctx.translate(x, f.y);
                pctx.rotate(f.rot);
                pctx.strokeStyle = pctx.fillStyle;
                pctx.lineWidth = Math.max(1, f.r * 0.28);
                pctx.beginPath();
                for (let s = 0; s < 3; s++) {
                  const ang = (s * Math.PI) / 3;
                  pctx.moveTo(0, 0);
                  pctx.lineTo(Math.cos(ang) * f.r * 1.5, Math.sin(ang) * f.r * 1.5);
                }
                pctx.stroke();
                pctx.restore();
              } else {
                pctx.beginPath();
                pctx.arc(x, f.y, f.r, 0, Math.PI * 2);
                pctx.fill();
              }
            }
          },
        };
      } else {
        // 晴天：逆光尘埃，80% 分布在窗与光束区
        const dusts: Dust[] = [];
        const n = Math.min(80, 48 + Math.round(vw / 160));
        for (let i = 0; i < n; i++) {
          const inBeam = Math.random() < 0.8;
          const ix = inBeam ? 0.2 + Math.random() * 0.65 : Math.random();
          const iy = inBeam ? 0.1 + Math.random() * 0.65 : Math.random();
          const big = Math.random() < 0.15;
          dusts.push({
            x: ix * drawW + offX,
            y: iy * drawH + offY,
            r: big ? 2.5 + Math.random() * 1.5 : 0.6 + Math.random() * 1.6,
            a: 0.06 + Math.random() * 0.16,
            tw: (Math.PI * 2) / (2 + Math.random() * 2), // 闪烁周期 2~4s
            phase: Math.random() * Math.PI * 2,
            vx: (Math.random() * 2 - 1) * 5,
            vy: (Math.random() * 2 - 1) * 5 - 1, // 微沉
            turn: 3 + Math.random() * 3,
            big,
          });
        }
        // 预渲染发光圆点精灵（避免每帧径向渐变）
        const mkSprite = (size: number, core: number) => {
          const c = document.createElement("canvas");
          c.width = size;
          c.height = size;
          const g = c.getContext("2d");
          if (!g) return c;
          const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
          rg.addColorStop(0, `rgba(255, 233, 196, ${core})`);
          rg.addColorStop(0.4, "rgba(255, 233, 196, 0.35)");
          rg.addColorStop(1, "rgba(255, 233, 196, 0)");
          g.fillStyle = rg;
          g.fillRect(0, 0, size, size);
          return c;
        };
        const sprS = mkSprite(32, 0.9);
        const sprB = mkSprite(64, 0.7);
        state.particles = {
          draw: (t) => {
            // 整体 8s 呼吸 ±15%
            const breath = 1 + 0.15 * Math.sin((t * Math.PI * 2) / 8);
            for (const d of dusts) {
              d.x += d.vx / 60;
              d.y += d.vy / 60;
              d.turn -= 1 / 60;
              if (d.turn <= 0) {
                d.turn = 3 + Math.random() * 3;
                d.vx = (Math.random() * 2 - 1) * 5;
                d.vy = (Math.random() * 2 - 1) * 5 - 1;
              }
              if (d.x < -40) d.x = vw + 40;
              if (d.x > vw + 40) d.x = -40;
              if (d.y < -40) d.y = vh + 40;
              if (d.y > vh + 40) d.y = -40;
              const tw = d.a * (0.8 + 0.2 * Math.sin(t * d.tw + d.phase));
              pctx.globalAlpha = Math.min(1, breath * tw);
              pctx.drawImage(d.big ? sprB : sprS, d.x - d.r * 3, d.y - d.r * 3, d.r * 6, d.r * 6);
            }
            pctx.globalAlpha = 1;
          },
        };
      }
    };

    /* ---------- 窗玻璃动画元素 ---------- */

    const buildWindowFx = () => {
      streaks = [];
      wDrops = [];
      winFlakes = [];
      if (scene === "rain") {
        // 雨痕 28 条（四扇窗格各 6~8，共 22~30、上限 32）
        for (let i = 0; i < 28; i++) {
          const pane = i % 4;
          const p = panes[pane];
          const spd = 4 + Math.random() * 4;
          streaks.push({
            pane,
            x: p.x + Math.random() * p.w,
            y: p.y + Math.random() * p.h, // 预填充：开局窗面即有雨痕
            spd,
            cap: 12 + Math.random() * 6,
            len: 60 + Math.random() * 180,
            wd: 0.5 + Math.random() * 0.9,
            a: 0.08 + Math.random() * 0.16,
            delay: 0,
          });
        }
        // 缓慢弯折水痕 3 条（速度即上限，不加速）
        for (let i = 0; i < 3; i++) {
          const p = panes[i];
          const spd = 1.5 + Math.random() * 1.5;
          streaks.push({
            pane: i,
            x: p.x + Math.random() * p.w,
            y: p.y + Math.random() * p.h,
            spd,
            cap: spd,
            len: 80 + Math.random() * 70,
            wd: 0.5 + Math.random() * 0.3,
            a: 0.05,
            delay: 0,
          });
        }
        // 窗面缓流水珠 8 个（2~5px/s 缓慢下滑）
        for (let i = 0; i < 8; i++) {
          wDrops.push({
            x: wx + Math.random() * ww,
            y: wy + Math.random() * wh,
            r: 2 + Math.random() * 2,
            a: 0.1 + Math.random() * 0.06,
            spd: 2 + Math.random() * 3,
          });
        }
      } else if (scene === "snow") {
        // 窗外雪花 28 片（透视更快 55~90px/s）
        for (let i = 0; i < 28; i++) {
          winFlakes.push({
            x: wx + Math.random() * ww,
            y: wy + Math.random() * wh,
            r: 1 + Math.random(),
            spd: 55 + Math.random() * 35,
            a: 0.1 + Math.random() * 0.1,
          });
        }
      }
    };

    /* ---------- 窗玻璃静态层（雾 / 霜 / 泛光） ---------- */

    const drawStaticFx = () => {
      sctx.clearRect(0, 0, staticFx.width, staticFx.height);
      if (scene === "rain") {
        // 窗外雨雾：顶部浓向下渐淡
        const fog = sctx.createLinearGradient(0, wy, 0, wy + wh);
        fog.addColorStop(0, "rgba(96, 112, 118, 0.28)");
        fog.addColorStop(1, "rgba(96, 112, 118, 0)");
        sctx.fillStyle = fog;
        sctx.fillRect(wx, wy, ww, wh);
        // 窗顶残余暖泛光（阳光削弱 70% 后的一线暖）
        const bloom = sctx.createLinearGradient(0, wy, 0, wy + wh * 0.25);
        bloom.addColorStop(0, "rgba(255, 180, 130, 0.05)");
        bloom.addColorStop(1, "rgba(255, 180, 130, 0)");
        sctx.fillStyle = bloom;
        sctx.fillRect(wx, wy, ww, wh * 0.25);
      } else if (scene === "snow") {
        // 窗顶冷白泛光（替代烈日）
        const bloom = sctx.createLinearGradient(0, wy, 0, wy + wh * 0.3);
        bloom.addColorStop(0, "rgba(225, 240, 250, 0.12)");
        bloom.addColorStop(1, "rgba(225, 240, 250, 0)");
        sctx.fillStyle = bloom;
        sctx.fillRect(wx, wy, ww, wh * 0.3);
        // 薄霜蒙版：外框 + 十字棂 8~30px 羽化霜带
        const vb = ((0.475 + 0.525) / 2) * drawW;
        const hb = ((0.375 + 0.43) / 2) * drawH;
        sctx.filter = "blur(8px)";
        sctx.fillStyle = "rgba(245, 250, 255, 0.20)";
        sctx.fillRect(wx, wy, ww, 26);
        sctx.fillRect(wx, wy + wh - 26, ww, 26);
        sctx.fillRect(wx, wy, 26, wh);
        sctx.fillRect(wx + ww - 26, wy, 26, wh);
        sctx.fillRect(vb - 14, wy, 28, wh);
        sctx.fillRect(wx, hb - 14, ww, 28);
        sctx.fillStyle = "rgba(245, 250, 255, 0.10)";
        sctx.fillRect(wx + ww * 0.1, wy + wh * 0.06, ww * 0.8, 20);
        sctx.filter = "none";
        // 中央冰晶点 12 个（r 2~6，2~3 条细羽枝）
        for (let i = 0; i < 12; i++) {
          const x = wx + 40 + Math.random() * Math.max(1, ww - 80);
          const y = wy + 40 + Math.random() * Math.max(1, wh - 80);
          const r = 2 + Math.random() * 4;
          const g = sctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(245, 250, 255, ${0.06 + Math.random() * 0.08})`);
          g.addColorStop(1, "rgba(245, 250, 255, 0)");
          sctx.fillStyle = g;
          sctx.fillRect(x - r, y - r, r * 2, r * 2);
          sctx.strokeStyle = "rgba(245, 250, 255, 0.05)";
          sctx.lineWidth = 0.6;
          sctx.beginPath();
          for (let s = 0; s < 3; s++) {
            const ang = Math.random() * Math.PI;
            sctx.moveTo(x, y);
            sctx.lineTo(x + Math.cos(ang) * r * 2, y + Math.sin(ang) * r * 2);
          }
          sctx.stroke();
        }
      } else {
        // 晴天：窗顶金色泛光
        const bloom = sctx.createLinearGradient(0, wy, 0, wy + wh * 0.3);
        bloom.addColorStop(0, "rgba(255, 220, 160, 0.10)");
        bloom.addColorStop(1, "rgba(255, 220, 160, 0)");
        sctx.fillStyle = bloom;
        sctx.fillRect(wx, wy, ww, wh * 0.3);
      }
    };

    /* ---------- 晴天光锥（锥形光束，screen 视觉） ---------- */

    const drawBeams = (t: number) => {
      const s = drawW / 1920; // 文档像素以 1080p 屏宽设计，随图宽缩放
      for (const b of cfg.beams) {
        // 方向 (-0.55, 1) 归一化后微摆 ±1.2°（周期 8s，交错初相位）
        const ang =
          Math.sin((t * Math.PI * 2) / 8 + b.phase) * ((1.2 * Math.PI) / 180);
        const dx = Math.cos(ang) * -0.55 - Math.sin(ang) * 1;
        const dy = Math.sin(ang) * -0.55 + Math.cos(ang) * 1;
        const dl = Math.hypot(dx, dy);
        const ux = dx / dl;
        const uy = dy / dl;
        const px0 = b.from[0] * drawW;
        const py0 = b.from[1] * drawH;
        const px1 = px0 + ux * b.len * drawH;
        const py1 = py0 + uy * b.len * drawH;
        const perpx = -uy;
        const perpy = ux;
        const tw = (b.topW * s) / 2;
        const bw = (b.bottomW * s) / 2;
        const grad = fxctx.createLinearGradient(px0, py0, px1, py1);
        grad.addColorStop(0, `rgba(${b.color}, ${b.alpha})`);
        grad.addColorStop(1, `rgba(${b.color}, 0)`);
        fxctx.fillStyle = grad;
        fxctx.beginPath();
        fxctx.moveTo(px0 - perpx * tw, py0 - perpy * tw);
        fxctx.lineTo(px0 + perpx * tw, py0 + perpy * tw);
        fxctx.lineTo(px1 + perpx * bw, py1 + perpy * bw);
        fxctx.lineTo(px1 - perpx * bw, py1 - perpy * bw);
        fxctx.closePath();
        fxctx.fill();
      }
    };

    /* ---------- 窗玻璃特效逐帧 ---------- */

    const drawFx = (t: number) => {
      fxctx.clearRect(0, 0, fx.width, fx.height);
      // 霜层 4s 周期微脉动
      fxctx.globalAlpha =
        scene === "snow" ? 0.9 + 0.1 * Math.sin((t * Math.PI * 2) / 4) : 1;
      fxctx.drawImage(staticFx, 0, 0);
      fxctx.globalAlpha = 1;

      if (scene === "rain") {
        fxctx.save();
        fxctx.beginPath();
        fxctx.rect(wx, wy, ww, wh);
        fxctx.clip();
        fxctx.lineCap = "round";
        for (const st of streaks) {
          const p = panes[st.pane];
          if (st.delay > 0) {
            st.delay -= 1 / 60;
            if (st.delay <= 0) {
              // 随机 0.4~1.2s 后在窗格顶部再生
              st.x = p.x + Math.random() * p.w;
              st.y = p.y;
              st.spd = 4 + Math.random() * 4;
              st.cap = 12 + Math.random() * 6;
              st.len = 60 + Math.random() * 180;
              st.a = 0.08 + Math.random() * 0.16;
            }
            continue;
          }
          st.y += st.spd / 60;
          // 4 → 12~18 px/s 匀加速到底
          st.spd = Math.min(st.cap, st.spd + 0.35 / 60);
          if (st.y > p.y + p.h) {
            st.delay = 0.4 + Math.random() * 0.8;
            continue;
          }
          // 底部 40px 渐隐
          const fade = Math.min(1, Math.max(0, (p.y + p.h - st.y) / 40));
          fxctx.strokeStyle = `rgba(215, 228, 235, ${st.a * fade})`;
          fxctx.lineWidth = st.wd;
          fxctx.beginPath();
          fxctx.moveTo(st.x, st.y - st.len);
          fxctx.lineTo(st.x, st.y);
          fxctx.stroke();
          fxctx.fillStyle = `rgba(226, 238, 244, ${Math.min(1, st.a * 1.4 * fade)})`;
          fxctx.beginPath();
          fxctx.arc(st.x, st.y, 2 + st.wd, 0, Math.PI * 2);
          fxctx.fill();
        }
        // 窗面缓流水珠
        for (const d of wDrops) {
          d.y += d.spd / 60;
          if (d.y > wy + wh) {
            d.y = wy;
            d.x = wx + Math.random() * ww;
          }
          fxctx.fillStyle = `rgba(230, 240, 244, ${d.a})`;
          fxctx.beginPath();
          fxctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          fxctx.fill();
        }
        fxctx.restore();
      } else if (scene === "snow") {
        // 窗外雪花（仅窗玻璃区域）
        fxctx.save();
        fxctx.beginPath();
        fxctx.rect(wx, wy, ww, wh);
        fxctx.clip();
        for (const f of winFlakes) {
          f.y += f.spd / 60;
          if (f.y > wy + wh) {
            f.y = wy - 4;
            f.x = wx + Math.random() * ww;
          }
          fxctx.fillStyle = `rgba(235, 244, 250, ${f.a})`;
          fxctx.beginPath();
          fxctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          fxctx.fill();
        }
        fxctx.restore();
      } else {
        drawBeams(t);
      }
    };

    /* ---------- 布局与几何 ---------- */

    const resize = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      // contain：完整展示构图，无拉伸变形；留白由虚化远景层补齐
      const k = Math.min(vw / W, vh / H);
      drawW = W * k;
      drawH = H * k;
      offX = (vw - drawW) / 2;
      offY = (vh - drawH) / 2;
      main.style.left = `${offX}px`;
      main.style.top = `${offY}px`;
      main.style.width = `${drawW}px`;
      main.style.height = `${drawH}px`;

      pc.width = Math.round(vw * dpr);
      pc.height = Math.round(vh * dpr);
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 特效画布 dpr=1：雨痕/光锥为柔和效果，省一半显存与填充带宽
      fx.width = Math.round(drawW);
      fx.height = Math.round(drawH);
      staticFx.width = fx.width;
      staticFx.height = fx.height;

      wx = cfg.window.x * drawW;
      wy = cfg.window.y * drawH;
      ww = cfg.window.w * drawW;
      wh = cfg.window.h * drawH;
      panes = PANES_N.map((p) => ({
        x: p.x * drawW,
        y: p.y * drawH,
        w: p.w * drawW,
        h: p.h * drawH,
      }));

      buildParticles();
      buildWindowFx();
      drawStaticFx();
    };

    /* ---------- 主循环：视差缓动 + 粒子 + 窗玻璃特效 ---------- */

    let raf = 0;
    let t = 0;
    let last = performance.now();
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    let lastMove = -1e9;

    const onMove = (e: MouseEvent) => {
      tx = (e.clientX / vw - 0.5) * 2;
      ty = (e.clientY / vh - 0.5) * 2;
      lastMove = performance.now();
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;

      // 2.5D 视差：缓动趋近鼠标；3s 无鼠标进入空闲呼吸漂移（粒子仍自动播放）
      let gx = tx;
      let gy = ty;
      if (now - lastMove > 3000) {
        gx = Math.sin((t * Math.PI * 2) / 40) * 0.12;
        gy = Math.cos((t * Math.PI * 2) / 53) * 0.12;
      }
      px += (gx - px) * 0.06;
      py += (gy - py) * 0.06;
      root.style.setProperty("--px", `${(px * cfg.maxPx).toFixed(2)}px`);
      root.style.setProperty("--py", `${(py * cfg.maxPx).toFixed(2)}px`);

      pctx.clearRect(0, 0, vw, vh);
      state.particles?.draw(t);
      drawFx(t);
    };

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVis);
    if (!reduced) {
      window.addEventListener("mousemove", onMove);
      raf = requestAnimationFrame(frame);
    } else {
      // 减少动态效果偏好：只绘一帧静态画面
      pctx.clearRect(0, 0, vw, vh);
      state.particles?.draw(0);
      drawFx(0);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [scene, imgReady]);

  const cfg = SCENE_CFG[scene];

  return (
    <div className="scene-root" ref={rootRef}>
      {/* 远景虚化层：cover 铺满 + 景深模糊，视差最慢（外扩 4% 防露边） */}
      <img
        className={`scene-far${farReady ? " ready" : ""}`}
        src={cfg.image}
        alt=""
        draggable={false}
        style={{
          filter: cfg.farFilter,
          transform: `translate3d(calc(var(--px, 0px) * ${cfg.far}), calc(var(--py, 0px) * ${cfg.far}), 0)`,
        }}
        onLoad={() => setFarReady(true)}
      />

      {/* 主图层：contain 完整构图，位置尺寸由 JS 计算 */}
      <div
        ref={mainRef}
        className="scene-main"
        style={{
          transform: `translate3d(calc(var(--px, 0px) * ${cfg.main}), calc(var(--py, 0px) * ${cfg.main}), 0)`,
        }}
      >
        <img
          ref={mainImgRef}
          className={`scene-img${imgReady ? " ready" : ""}`}
          src={cfg.image}
          alt=""
          draggable={false}
          style={{ filter: cfg.filter }}
          onLoad={() => setImgReady(true)}
        />
        {/* 窗玻璃特效：雨痕 / 薄霜 / 光锥（随主图一起视差） */}
        <canvas ref={fxRef} className="scene-fx" />
        {/* 室内光池（screen 混合） */}
        {cfg.pools.map((pl, i) => (
          <div
            key={i}
            className="scene-pool"
            style={{
              left: `${pl.x * 100}%`,
              top: `${pl.y * 100}%`,
              width: `${pl.w * 100}%`,
              height: `${pl.h * 100}%`,
              background: `radial-gradient(ellipse at center, rgba(${pl.color}, ${pl.alpha}), rgba(${pl.color}, 0) 72%)`,
            }}
          />
        ))}
      </div>

      {/* 全屏调色幕：色温偏移 + UI 面板可读性压暗 */}
      <div className="scene-grade" style={{ background: cfg.grade }} />

      {/* 粒子画布：雨丝 / 雪花 / 尘埃 */}
      <canvas
        ref={particleRef}
        className="scene-canvas scene-particles"
        aria-hidden="true"
      />
    </div>
  );
}
