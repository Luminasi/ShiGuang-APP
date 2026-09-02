import { useEffect, useMemo, useRef, useState } from "react";
import type { Block, BotFrame } from "../../mascot";
import { BotEngine, COLOR_BY_ID, DEFAULT_COLOR, DEFAULT_EXPRESSION, DEFAULT_SHAPE, DEMI_VIEWBOX, EXPRESSION_BY_ID, lookTarget, mixHex, NOTIF_BLUE, RAYON, SHAPE_BY_ID, STATE_BY_ID, TURN_TIME } from "../../mascot";
import type { ColorId, ExpressionId, ShapeId, StateId } from "../../mascot";
import { clamp, easings } from "../../mascot/math";

/**
 * 拾光吉祥物（阶段 8）：bloub SVG 引擎的 React 封装。
 * 引擎是纯时间函数（sample(t)），本组件只做两件事：
 * 用 rAF 推进时钟 → 把 sample 结果渲染进 SVG（渲染结构照抄原 BloubBot.vue）。
 *
 * 约定（沿用原仓库，见 src/mascot/ 头部注释）：
 * - 引擎数值为逐帧测量值，勿改；
 * - 眼睛是 <mask> 上的孔洞，需要不透明 paper 色垫底；
 * - 过渡为指数缓出、不过冲；唯一弹簧是通知弹跳（引擎内部）；
 * - setLook 双轴绝对目标、由引擎混合，调用方只传屏幕归一化坐标。
 */

/** 场景 → 吉祥物颜色（拾光三场景映射，见 CLAUDE.md 阶段 6） */
const SCENE_COLOR: Record<string, ColorId> = {
  rain: "vert",
  snow: "blanc",
  cloud: "ambre",
};

export interface MascotProps {
  /** 显示宽度 px（viewBox 为正方形，高度等比；默认 96） */
  size?: number;
  /** 身形：8 种（cercle/galet/squircle/capsule/triangle/hexagone/nuage/goutte） */
  shape?: ShapeId;
  /** 颜色：优先级高于 sceneColors（默认按场景自动换色） */
  color?: ColorId;
  /** 表情：16 种（neutre/attentif/surpris/excite/heureux/hilare/colere/triste/effraye/mefiant/confus/curieux/fier/timide/blase/somnolent） */
  expression?: ExpressionId;
  /** 状态动画：idle/thinking/wink/wide/alert/notify/exclaim/sleep/egg/hexagon/play/orbit/burst/comet */
  state?: StateId;
  /** 蒙太奇循环（优先级高于 state）：每块一个状态 + 时长（秒，≥ MIN_BLOCK 0.6） */
  cycle?: Block[];
  /** false 时时钟停走（默认 true） */
  playing?: boolean;
  /** 单帧渲染：定格在状态内第 frozenAt 秒，不启动动画循环 */
  frozenAt?: number;
  /** 眼睛跟随鼠标（默认 true；只对 baseFace 状态生效，引擎自动处理） */
  follow?: boolean;
  /** mask 衬底色（眼睛孔洞透出的底色）；默认取当前场景 --bg 变量 */
  paper?: string;
  /** 按场景自动换色 rain→vert / snow→blanc / cloud→ambre（默认 true） */
  sceneColors?: boolean;
  /** 点击回调（形变互动由外部决定） */
  onClick?: () => void;
}

/** 读取当前场景背景色作为默认 paper（mask 孔洞透出的颜色） */
function readPaper(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() ||
    "#0c1f19"
  );
}

export default function Mascot(props: MascotProps) {
  const { size = 96 } = props;
  const R = RAYON;
  const VB = DEMI_VIEWBOX;

  // 引擎只创建一次（StrictMode 双渲染由 ref 守卫）
  const engineRef = useRef<BotEngine | null>(null);
  if (!engineRef.current) {
    const initial = props.cycle?.[0]?.state ?? props.state ?? "idle";
    const radii = SHAPE_BY_ID.get(props.shape ?? DEFAULT_SHAPE)?.radii ?? null;
    const expr = EXPRESSION_BY_ID.get(props.expression ?? DEFAULT_EXPRESSION) ?? null;
    engineRef.current = new BotEngine(R, initial, radii, expr);
  }
  const engine = engineRef.current;

  const [frame, setFrame] = useState<BotFrame>(() =>
    engine.sample(props.frozenAt ?? 0),
  );
  const svgRef = useRef<SVGSVGElement | null>(null);
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const maskId = `bot-mask-${uid}`;

  // ---- 时钟与蒙太奇游标（ref，rAF 循环内读写） ----
  const clockRef = useRef(0);
  const cycleRef = useRef<Block[] | null>(props.cycle ?? null);
  const playingRef = useRef(props.playing ?? true);
  const followRef = useRef(props.follow ?? true);
  const blockRef = useRef(0);
  const blockStartRef = useRef(0);
  const nextAtRef = useRef(Infinity);

  /** 摆上第 i 块：改状态、定结束时间。`from` = 从块内第几秒继续（暂未用于恢复） */
  const applyBlock = (i: number, from = 0) => {
    const blocks = cycleRef.current;
    const b = blocks?.[i];
    if (!b) {
      nextAtRef.current = Infinity;
      return;
    }
    blockRef.current = i;
    blockStartRef.current = clockRef.current - from;
    engine.setState(b.state, clockRef.current);
    nextAtRef.current = playingRef.current ? blockStartRef.current + b.duration : Infinity;
  };

  // ---- 主循环：推进时钟 → 蒙太奇 → 注视 → 采样 ----
  useEffect(() => {
    if (props.frozenAt !== undefined) return;
    if (cycleRef.current?.length) applyBlock(0);
    let raf = 0;
    let last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      // 时钟增量封顶：窗口隐藏期间 rAF 挂起，回来时不会猛然跳一大段
      const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0;
      last = ms;
      clockRef.current += dt;

      const blocks = cycleRef.current;
      if (playingRef.current && blocks?.length) {
        if (clockRef.current >= nextAtRef.current) {
          applyBlock((blockRef.current + 1) % blocks.length);
        }
      }

      if (followRef.current) aim();
      else release();

      setFrame(engine.sample(clockRef.current));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 蒙太奇更换 ----
  useEffect(() => {
    cycleRef.current = props.cycle ?? null;
    blockRef.current = 0;
    applyBlock(0);
    if (props.frozenAt === undefined) setFrame(engine.sample(clockRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cycle]);

  // ---- 播放/暂停 ----
  useEffect(() => {
    playingRef.current = props.playing ?? true;
    if (cycleRef.current?.length) applyBlock(blockRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.playing]);

  // ---- 状态 prop（无蒙太奇时生效） ----
  useEffect(() => {
    if (cycleRef.current) return;
    if (props.state && engine.state !== props.state) {
      engine.setState(props.state, clockRef.current);
      setFrame(engine.sample(clockRef.current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.state]);

  // ---- 身形 / 表情 ----
  useEffect(() => {
    const radii = SHAPE_BY_ID.get(props.shape ?? DEFAULT_SHAPE)?.radii ?? null;
    engine.setShape(radii, clockRef.current);
    if (props.frozenAt !== undefined) setFrame(engine.sample(props.frozenAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.shape]);

  useEffect(() => {
    const expr = EXPRESSION_BY_ID.get(props.expression ?? DEFAULT_EXPRESSION) ?? null;
    engine.setExpression(expr, clockRef.current);
    if (props.frozenAt !== undefined) setFrame(engine.sample(props.frozenAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.expression]);

  // ---- 定格帧 ----
  useEffect(() => {
    if (props.frozenAt !== undefined) setFrame(engine.sample(props.frozenAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.frozenAt]);

  // ---- 颜色：外部 color 优先 → 场景映射 → 默认 ----
  const [colorId, setColorId] = useState<ColorId>(
    () =>
      props.color ??
      (props.sceneColors === false
        ? DEFAULT_COLOR
        : (SCENE_COLOR[document.documentElement.dataset.scene ?? ""] ?? DEFAULT_COLOR)),
  );
  // ---- paper：外部优先 → 场景 --bg ----
  const [paper, setPaper] = useState<string>(() => props.paper ?? readPaper());

  useEffect(() => {
    const update = () => {
      const scene = document.documentElement.dataset.scene ?? "";
      setColorId(
        props.color ??
          (props.sceneColors === false ? DEFAULT_COLOR : SCENE_COLOR[scene] ?? DEFAULT_COLOR),
      );
      if (!props.paper) setPaper(readPaper());
    };
    update();
    // 场景切换由 <html data-scene> 驱动，观察属性即可（App.tsx 持久化）
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-scene"],
    });
    return () => mo.disconnect();
  }, [props.color, props.paper, props.sceneColors]);

  const ink = COLOR_BY_ID.get(colorId)?.hex ?? "#0a0a0c";

  // ---- 注视跟随（照抄 BloubBot.vue 的 aim/release，含 NaN 防护） ----
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const aimingRef = useRef(false);
  const turnSinceRef = useRef(0);

  const release = () => {
    if (!aimingRef.current) return;
    engine.setLook(null, clockRef.current, TURN_TIME);
    aimingRef.current = false;
  };

  const aim = () => {
    // 只有「携带休息表情」的状态接受外控；其它状态的注视本身就是动画
    if (!STATE_BY_ID.get(engine.state)?.baseFace) {
      release();
      return;
    }
    const box = svgRef.current?.getBoundingClientRect();
    // 零尺寸盒子会得到 0/0 = NaN，而引擎会永久保留最后一次目标——必须挡掉
    if (!box || box.width === 0 || box.height === 0) return;
    if (!aimingRef.current) turnSinceRef.current = clockRef.current;
    const demiLargeur = Math.max(1, window.innerWidth / 2);
    const demiHauteur = Math.max(1, window.innerHeight / 2);
    const p = pointerRef.current;
    engine.setLook(
      lookTarget({
        nx: p
          ? clamp((p.x - (box.left + box.width / 2)) / demiLargeur, -1, 1)
          : 0,
        ny: p
          ? clamp((p.y - (box.top + box.height / 2)) / demiHauteur, -1, 1)
          : 0,
        tour: easings.easeOutQuint(
          clamp((clockRef.current - turnSinceRef.current) / TURN_TIME),
        ),
        pointer: p !== null,
      }),
      clockRef.current,
    );
    aimingRef.current = true;
  };

  const onPointerMove = (e: PointerEvent) => {
    // 触屏没有悬停光标：手指抬起会让视线死盯最后触点，像 bug
    if (e.pointerType === "touch") return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerLeave = () => {
    pointerRef.current = null;
  };

  useEffect(() => {
    if (props.follow === false) {
      release();
      return;
    }
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerleave", onPointerLeave);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.follow]);

  // ---- 渲染（层级顺序照抄 BloubBot.vue 模板） ----
  const dotAttrs = (dot: BotFrame["dots"][number]) => {
    const fill =
      dot.color ??
      (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
    return { fill, opacity: dot.opacity };
  };

  return (
    <svg
      ref={svgRef}
      className="mascot-svg"
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      role="img"
      aria-label="拾光吉祥物"
      // 深色背景上给浅色身体（雪日白/暖云黄）一点轮廓
      style={{ filter: "drop-shadow(0 2px 6px rgba(8, 12, 16, 0.4))" }}
      onClick={props.onClick}
    >
      <defs>
        {/*
          眼睛是真正的孔洞（同 x.ai）：在 mask 里用黑色挖掉，随轮廓自动裁切，
          而非盖上去的白色形状。notch 是通知徽标的缺口，同法。
        */}
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={-VB}
          y={-VB}
          width={VB * 2}
          height={VB * 2}
        >
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path
              key={i}
              d={eye.d}
              transform={eye.matrix}
              opacity={eye.alpha}
              fill="#000"
            />
          ))}
          {frame.notch && (
            <circle
              cx={frame.notch.x}
              cy={frame.notch.y}
              r={frame.notch.r}
              fill="#000"
            />
          )}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((c, i) => (
              <stop
                key={i}
                offset={i / (arc.grad.stops.length - 1)}
                stopColor={c}
              />
            ))}
          </linearGradient>
        ))}
      </defs>

      {/* 轨道环的后半圈：先画、被身体遮住，才读得出「环绕」而非平面涂鸦 */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={`b${arc.id}`}
            d={arc.back}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>

      {/* 爆裂粒子：从身体后面穿过 */}
      {frame.dotsBehind && (
        <g>
          {frame.dots.map((dot, i) => {
            const a = dotAttrs(dot);
            return dot.d ? (
              <path
                key={`pb${i}`}
                d={dot.d}
                transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})`}
                fill={a.fill}
                opacity={a.opacity}
              />
            ) : (
              <circle key={`pb${i}`} cx={dot.x} cy={dot.y} r={dot.r} fill={a.fill} opacity={a.opacity} />
            );
          })}
        </g>
      )}

      {/* 身体：paper 底垫（mask 孔洞透出的是它）+ 挖洞后的实色身体 */}
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>

      {/* 前景粒子（thinking 三连点等） */}
      {!frame.dotsBehind && (
        <g>
          {frame.dots.map((dot, i) => {
            const a = dotAttrs(dot);
            return dot.d ? (
              <path
                key={`pf${i}`}
                d={dot.d}
                transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})`}
                fill={a.fill}
                opacity={a.opacity}
              />
            ) : (
              <circle key={`pf${i}`} cx={dot.x} cy={dot.y} r={dot.r} fill={a.fill} opacity={a.opacity} />
            );
          })}
        </g>
      )}

      {/* 通知小蓝点 */}
      {frame.notif && (
        <circle
          cx={frame.notif.x}
          cy={frame.notif.y}
          r={frame.notif.r}
          fill={NOTIF_BLUE}
        />
      )}

      {/* 轨道环的前半圈 */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={`f${arc.id}`}
            d={arc.front}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>
    </svg>
  );
}
