/**
 * 像素跑酷：素材层。
 * 不知火舞像素角色（程序化帧数据，兜底渲染）+ 素材 PNG 运行时加载；
 * 障碍/扇子/云等全部程序化像素；renderGame 负责整帧绘制。
 *
 * 素材加载策略：public/game/mai-run.png 用 new Image() 运行时加载，
 * 失败或超时（3s）→ 走程序化像素帧，绝不阻塞游戏。
 */

import type { GameState } from "./engine";
import { GROUND_Y, W, H } from "./engine";

// ---------- 程序化像素配色 ----------

export const PAL = {
  edge: "#2b2f36", // 黑边
  red: "#e64545", // 红衣
  darkRed: "#b83333", // 红衣阴影
  skin: "#f7d9a8", // 肤色
  hair: "#f2f2f2", // 白发
  hairShade: "#c9c9d4", // 发阴影
  fan: "#f0e68c", // 扇面
  fanDark: "#c9b45c", // 扇阴影
  rock: "#9aa0ad", // 岩石
  rockDark: "#767c89",
  wood: "#a0683c", // 木桩
  woodDark: "#7c4a26",
  flameO: "#ff9a3c", // 火焰橙
  flameY: "#ffd23c", // 火焰黄
  cloud: "#ffffff",
  cloudEdge: "#c9d4e4",
  mountain: "#7fb2a5", // 远山
  mountainDark: "#5e8f83",
  ground: "#8a5a3b", // 地面砖
  groundDark: "#7a4d33",
};

/**
 * 不知火舞像素帧：14x20，. 为透明，渲染时 2x 缩放（28x40）。
 * 特征：白发双垂、红衣、露肤脚。4 帧奔跑（腿交替）+ 1 帧跳跃。
 * 字符映射：B=edge R=red D=darkRed S=skin W=hair G=hairShade
 */
const MAI_RUN_FRAMES: string[][] = [
  // 帧 1：左腿前迈
  [
    "..WWWWWWWWWW..",
    ".WWWWWWWWWWWW.",
    "WWWWWWWWWWWWWW",
    "WWWWWWSSWWWWWW",
    "WWWWWWSSWWWWWW",
    "WWWWWSSSSWWWWW",
    "...RRSSSSRR...",
    "..RRRRSSRRRR..",
    "..RRRRRRRRRR..",
    "..RRRRRRRRRR..",
    "...RRRRRRRR...",
    "...RRRRRRRR...",
    "...RRRRRRRR...",
    "....RRRRRR....",
    "....RR..RR....",
    "...RR....RR...",
    "..RR.....RR...",
    "..RR......RR..",
    ".SRR......RSS.",
    ".SS........SS.",
  ],
  // 帧 2：双腿收拢
  [
    "..WWWWWWWWWW..",
    ".WWWWWWWWWWWW.",
    "WWWWWWWWWWWWWW",
    "WWWWWWSSWWWWWW",
    "WWWWWWSSWWWWWW",
    "WWWWWSSSSWWWWW",
    "...RRSSSSRR...",
    "..RRRRSSRRRR..",
    "..RRRRRRRRRR..",
    "..RRRRRRRRRR..",
    "...RRRRRRRR...",
    "...RRRRRRRR...",
    "...RRRRRRRR...",
    "....RRRRRR....",
    "....RR..RR....",
    "...RR..RR.....",
    "..RR...RR.....",
    "..RR....RR....",
    ".SRR.....RSS..",
    ".SS........SS.",
  ],
  // 帧 3：右腿前迈（帧 1 镜像）
  [
    "..WWWWWWWWWW..",
    ".WWWWWWWWWWWW.",
    "WWWWWWWWWWWWWW",
    "WWWWWWSSWWWWWW",
    "WWWWWWSSWWWWWW",
    "WWWWWSSSSWWWWW",
    "...RRSSSSRR...",
    "..RRRRSSRRRR..",
    "..RRRRRRRRRR..",
    "..RRRRRRRRRR..",
    "...RRRRRRRR...",
    "...RRRRRRRR...",
    "...RRRRRRRR...",
    "....RRRRRR....",
    "....RR..RR....",
    "....RR...RR...",
    "...RR.....RR..",
    "..RR......RR..",
    ".RSS......RRS.",
    ".SS........SS.",
  ],
  // 帧 4：双腿交叉（帧 2 镜像）
  [
    "..WWWWWWWWWW..",
    ".WWWWWWWWWWWW.",
    "WWWWWWWWWWWWWW",
    "WWWWWWSSWWWWWW",
    "WWWWWWSSWWWWWW",
    "WWWWWSSSSWWWWW",
    "...RRSSSSRR...",
    "..RRRRSSRRRR..",
    "..RRRRRRRRRR..",
    "..RRRRRRRRRR..",
    "...RRRRRRRR...",
    "...RRRRRRRR...",
    "...RRRRRRRR...",
    "....RRRRRR....",
    "....RR..RR....",
    ".....RR..RR...",
    ".....RR...RR..",
    "....RR....RR..",
    "..SSR.....RRS.",
    ".SS........SS.",
  ],
];

/** 跳跃帧：双腿并拢展开 */
const MAI_JUMP_FRAME: string[] = [
  "..WWWWWWWWWW..",
  ".WWWWWWWWWWWW.",
  "WWWWWWWWWWWWWW",
  "WWWWWWSSWWWWWW",
  "WWWWWWSSWWWWWW",
  "WWWWWSSSSWWWWW",
  "...RRSSSSRR...",
  "..RRRRSSRRRR..",
  "..RRRRRRRRRR..",
  "..RRRRRRRRRR..",
  "...RRRRRRRR...",
  "...RRRRRRRR...",
  "...RRRRRRRR...",
  "....RRRRRR....",
  "....RR..RR....",
  "....RR..RR....",
  "....RR..RR....",
  "...RRRRRRRR...",
  "...RRRRRRRR...",
  "..SS......SS..",
];

/** 岩石 12x7 */
const ROCK_PX: string[] = [
  "..BBBBBBBB..",
  ".BGGGGGGGGB.",
  ".BGGGGGGGGB.",
  ".BGGGGGGGGB.",
  ".BGGGGGGGGB.",
  ".BGGBGGBGGB.",
  "..BBBBBBBB..",
];

/** 木桩 20x8 */
const LOG_PX: string[] = [
  "..BBBBBBBBBBBBBBBB..",
  ".BGGGGGGGGGGGGGGGGB.",
  ".BGGBGGBGGBGGBGGBGGB.",
  ".BGGGGGGGGGGGGGGGGB.",
  ".BGGBGGBGGBGGBGGBGGB.",
  ".BGGGGGGGGGGGGGGGGB.",
  ".BGGBGGBGGBGGBGGBGGB.",
  "..BBBBBBBBBBBBBBBB..",
];

/** 火柱 10x24，两帧火舌摆动（底部到地面） */
const FLAME_FRAMES: string[][] = [
  [
    "....RRRR....",
    "...ORRRO....",
    "..OORRRRO...",
    "..OORRRRO...",
    ".OORRRRRRO..",
    ".OORRRRRRO..",
    "OORRRRRRROO.",
    "OORRRRRRROO.",
    ".ORRRRRRRO..",
    ".ORRRRRRRO..",
    "..RRRRRR....",
    "..RRRRRR....",
    ".ORRRRRRRO..",
    ".ORRRRRRRO..",
    "OORRRRRRROO.",
    "OORRRRRRROO.",
    ".ORRRRRRRO..",
    ".OORRRRRRO..",
    ".OORRRRRRO..",
    "..OORRRRO...",
    "...ORRRO....",
    "....RRRR....",
    "...BBBB.....",
    "..BBBBBB....",
  ],
  [
    "....RRRR....",
    "....ORRRO...",
    "...OORRRRO..",
    "...OORRRRO..",
    "..OORRRRRRO.",
    "..OORRRRRRO.",
    ".OORRRRRRROO",
    ".OORRRRRRROO",
    "..ORRRRRRRO.",
    "..ORRRRRRRO.",
    "....RRRRRR..",
    "....RRRRRR..",
    "..ORRRRRRRO.",
    "..ORRRRRRRO.",
    ".OORRRRRRROO",
    ".OORRRRRRROO",
    "..ORRRRRRRO.",
    "...OORRRRRO.",
    "...OORRRRRO.",
    "....OORRRO..",
    "....ORRRO...",
    "....RRRR....",
    "...BBBB.....",
    "..BBBBBB....",
  ],
];

/** 扇子 7x6，两帧旋转 */
const FAN_FRAMES: string[][] = [
  [
    "..BBB..",
    ".BFFFB.",
    "BFFFFFB",
    "BFFFFFB",
    ".BFFFB.",
    "..BBB..",
  ],
  [
    "..BBB..",
    ".BFFFB.",
    "BFFFFFB",
    "BFFFFFB",
    ".BFFFB.",
    "..BBB..",
  ],
];

/** 云 14x6 */
const CLOUD_PX: string[] = [
  "...BBBBBBB....",
  ".BBWWWWWWWBB..",
  "BWWWWWWWWWWWWB",
  "BBWWWWWWWWWWBB",
  "..BBWWWWWWBB..",
  "....BBBBB.....",
];

// ---------- 像素网格绘制 ----------

/** 逐像素画帧数据（. 为透明），scale 为像素放大倍数 */
export function drawPix(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rows: string[],
  scale = 1,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  rows.forEach((row, rowIdx) => {
    for (let col = 0; col < row.length; col++) {
      const ch = row[col];
      if (ch === ".") continue;
      const color = PAL[ch as keyof typeof PAL] ?? PAL.edge;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * scale, y + rowIdx * scale, scale, scale);
    }
  });
  ctx.restore();
}

// ---------- 素材加载（运行时，失败兜底） ----------

export interface PlayerAssets {
  image: HTMLImageElement | null;
  frameW: number;
  frameH: number;
  runFrames: number;
  jumpIndex: number;
  frameDur: number;
}

/** 加载素材 PNG；失败/超时返回 image=null（走像素帧兜底），永不 reject */
export function loadPlayerAssets(timeoutMs = 3000): Promise<PlayerAssets> {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (image: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      resolve({
        image,
        frameW: 28,
        frameH: 40,
        runFrames: 4,
        jumpIndex: 0,
        frameDur: 0.09,
      });
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      finish(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    img.src = `${import.meta.env.BASE_URL}game/mai-run.png`;
  });
}

// ---------- 整帧渲染 ----------

export function renderGame(
  ctx: CanvasRenderingContext2D,
  s: GameState,
  assets: PlayerAssets,
) {
  ctx.imageSmoothingEnabled = false;
  ctx.save();

  // 屏幕震动
  if (s.shakeT > 0) {
    const mag = s.shakeT * 6;
    ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
  }

  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#dceaf7");
  sky.addColorStop(1, "#f4f8fc");
  ctx.fillStyle = sky;
  ctx.fillRect(-8, -8, W + 16, GROUND_Y + 8);

  // 远山（慢速滚动，两个错层锯齿山）
  drawMountain(ctx, -0.06 * s.speed, 0, 150);
  drawMountain(ctx, -0.1 * s.speed + 240, 1, 90);

  // 云（更慢）
  drawClouds(ctx, s);

  // 地面砖带
  drawGround(ctx, s);

  // 障碍
  for (const ob of s.obstacles) {
    if (ob.kind === "flame") {
      const frame = Math.floor(ob.animT / 0.12) % 2;
      drawPix(ctx, ob.x, GROUND_Y - 48, FLAME_FRAMES[frame], 2);
    } else if (ob.kind === "rock") {
      drawPix(ctx, ob.x, GROUND_Y - 14, ROCK_PX, 2);
    } else {
      drawPix(ctx, ob.x, GROUND_Y - 16, LOG_PX, 2);
    }
  }

  // 扇子弹道（旋转）
  for (const f of s.fans) {
    ctx.save();
    ctx.translate(f.x + 7, f.y + 6);
    ctx.rotate(f.rot);
    drawPix(ctx, -7, -6, FAN_FRAMES[0], 1);
    ctx.restore();
  }

  // 粒子
  drawParticles(ctx, s);

  // 玩家（残影在前，本体在后）
  for (const g of s.ghosts) {
    drawPlayer(ctx, s, assets, g.x, g.y, g.frame, 0.35);
  }
  drawPlayer(ctx, s, assets, s.player.x, s.player.y, s.player.frame(), 1);

  // 忍蜂速度线
  if (s.player.dashT > 0) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.5, s.player.dashT)})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const yy = 20 + i * 30 + Math.sin(s.t * 30 + i) * 6;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }
  }

  // 白闪（击碎反馈）
  if (s.flashT > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.5, s.flashT * 5)})`;
    ctx.fillRect(-8, -8, W + 16, H + 16);
  }

  // HUD
  drawHud(ctx, s);

  ctx.restore();
}

// ---------- 子绘制 ----------

function drawMountain(ctx: CanvasRenderingContext2D, offset: number, layer: number, baseY: number) {
  const col = layer === 0 ? PAL.mountainDark : PAL.mountain;
  ctx.fillStyle = col;
  const w = 200;
  const shift = ((offset % w) + w) % w;
  for (let mx = -w; mx < W + w; mx += w) {
    const x = mx + shift;
    ctx.beginPath();
    ctx.moveTo(x, baseY + 120);
    ctx.lineTo(x + w / 2, baseY + 20);
    ctx.lineTo(x + w, baseY + 120);
    ctx.closePath();
    ctx.fill();
  }
}

function drawClouds(ctx: CanvasRenderingContext2D, s: GameState) {
  const pos: { y: number; base: number; speed: number }[] = [
    { y: 40, base: 60, speed: 0.02 },
    { y: 90, base: 260, speed: 0.015 },
    { y: 60, base: 380, speed: 0.025 },
  ];
  for (const c of pos) {
    const x = ((c.base - s.t * c.speed * s.speed) % (W + 60) + (W + 60)) % (W + 60) - 30;
    drawPix(ctx, Math.floor(x), c.y, CLOUD_PX, 1);
  }
}

function drawGround(ctx: CanvasRenderingContext2D, s: GameState) {
  // 深色地线
  ctx.fillStyle = "#4a3424";
  ctx.fillRect(0, GROUND_Y, W, 3);
  // 砖带（随 speed 滚动，双色交错）
  const brickW = 32;
  const shift = ((s.dist % brickW) + brickW) % brickW;
  for (let x = -brickW; x < W + brickW; x += brickW) {
    const even = Math.floor((x - shift + brickW) / brickW) % 2 === 0;
    ctx.fillStyle = even ? PAL.ground : PAL.groundDark;
    ctx.fillRect(x - shift, GROUND_Y + 3, brickW, H - GROUND_Y - 3);
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  s: GameState,
  assets: PlayerAssets,
  x: number,
  y: number,
  frame: number,
  alpha: number,
) {
  const dx = Math.floor(x - 14);
  const dy = Math.floor(y - 40);
  if (assets.image) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      assets.image,
      frame * assets.frameW,
      0,
      assets.frameW,
      assets.frameH,
      dx,
      dy,
      assets.frameW,
      assets.frameH,
    );
    ctx.restore();
  } else {
    const rows =
      s.player.grounded ? MAI_RUN_FRAMES[frame % MAI_RUN_FRAMES.length] : MAI_JUMP_FRAME;
    drawPix(ctx, dx, dy, rows, 2, alpha);
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, s: GameState) {
  for (const p of s.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    const size = p.size * 2;
    ctx.fillRect(Math.floor(p.x - size / 2), Math.floor(p.y - size / 2), size, size);
  }
  ctx.globalAlpha = 1;
}

function drawHud(ctx: CanvasRenderingContext2D, s: GameState) {
  ctx.textBaseline = "top";
  // 分数（大号）
  ctx.font = "bold 22px 'Courier New', monospace";
  ctx.fillStyle = "#2b2f36";
  const score = Math.floor(s.score);
  ctx.fillText(String(score).padStart(5, "0"), W - 110, 12);
  // 最高分
  ctx.font = "bold 11px 'Courier New', monospace";
  ctx.fillStyle = "#767c89";
  ctx.fillText(`HI ${Math.floor(s.highScore).toString().padStart(5, "0")}`, W - 110, 40);
  // 技能冷却（running 时显示）
  if (s.phase === "running") {
    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.fillStyle = "#5a6b7d";
    ctx.fillText(`花蝶扇 ${s.cd1 > 0 ? s.cd1.toFixed(1) + "s" : "READY"}`, 10, 12);
    ctx.fillText(`忍蜂 ${s.cd2 > 0 ? s.cd2.toFixed(1) + "s" : "READY"}`, 10, 28);
  }
}
