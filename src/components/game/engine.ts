/**
 * 像素跑酷：纯游戏逻辑（不依赖 React / DOM / 音效）。
 * 物理参数、障碍生成、AABB 碰撞、技能（花蝶扇/忍蜂）、事件数组。
 * 音效由调用方根据返回值/事件播放。
 */

// ---------- 世界常量 ----------

export const W = 480;
export const H = 270;
export const GROUND_Y = 246; // 地面线（角色脚底 y）

// 物理
export const GRAVITY = 1050; // px/s²
export const JUMP_VY = -360; // 起跳初速（跳高 ≈ 61px，越过最高火柱 48px）
export const JUMP_CUT = 0.45; // 上升段松开跳跃键的额外衰减系数（可变跳高）
export const BASE_SPEED = 130; // 起步速度 px/s
export const MAX_SPEED = 420;
export const SPEED_RAMP = 3.2; // 每秒增速，约 90s 封顶
export const SCORE_RATE = 10; // 每滚动 10px 记 1 分

// 技能
export const CD_FAN = 6; // 花蝶扇冷却
export const CD_DASH = 12; // 忍蜂冷却
export const FAN_VX = 430;
export const FAN_LIFE = 2.2;
export const FAN_SPIN = 14; // 旋转 rad/s
export const DASH_TIME = 0.55; // 忍蜂突刺时长
export const DASH_MULT = 3.6; // 突刺期间世界速度倍率

// 生成
export const SPAWN_GAP_MIN = 240; // 障碍间隔（滚动距离 px）
export const SPAWN_GAP_MAX = 400;

export const HIGH_SCORE_KEY = "game.pixel_run_high_score";

// ---------- 类型 ----------

export type GamePhase = "ready" | "running" | "dead";
export type EngineEvent = "smash" | "ready1" | "ready2" | "die";

export interface Player {
  x: number; // 水平中心（固定）
  y: number; // 脚底 y
  vy: number;
  w: number; // 碰撞盒
  h: number;
  grounded: boolean;
  jumpHold: boolean; // 跳跃键是否按住（可变跳高）
  animT: number; // 奔跑动画计时
  dashT: number; // 忍蜂剩余时间，>0 即无敌穿行
  ghostT: number; // 残影间隔计时
  frame(): number; // 当前动画帧索引
}

export interface Obstacle {
  kind: "rock" | "log" | "flame";
  x: number; // 左缘
  w: number;
  h: number;
  animT: number; // 火焰动画计时
}

export interface FanProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  life: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface Ghost {
  x: number;
  y: number;
  frame: number;
}

export interface GameState {
  phase: GamePhase;
  t: number; // 运行总秒数（决定速度）
  dist: number; // 滚动总距离
  score: number;
  speed: number; // 当前滚动速度
  highScore: number; // 破纪录时实时抬升
  player: Player;
  obstacles: Obstacle[];
  fans: FanProjectile[];
  particles: Particle[];
  ghosts: Ghost[];
  spawnT: number; // 距下个障碍的滚动距离
  cd1: number; // 花蝶扇剩余冷却
  cd2: number; // 忍蜂剩余冷却
  shakeT: number; // 屏幕震动剩余
  flashT: number; // 击碎白闪剩余
}

// ---------- 工厂 ----------

export function createState(highScore: number): GameState {
  const runFrames = 4;
  const player: Player = {
    x: 70,
    y: GROUND_Y,
    vy: 0,
    w: 22,
    h: 34,
    grounded: true,
    jumpHold: false,
    animT: 0,
    dashT: 0,
    ghostT: 0,
    frame() {
      if (!this.grounded) return 0; // 跳跃帧（素材 jumpIndex）
      return Math.floor(this.animT / 0.09) % runFrames;
    },
  };
  return {
    phase: "ready",
    t: 0,
    dist: 0,
    score: 0,
    speed: BASE_SPEED,
    highScore,
    player,
    obstacles: [],
    fans: [],
    particles: [],
    ghosts: [],
    spawnT: 300,
    cd1: 0,
    cd2: 0,
    shakeT: 0,
    flashT: 0,
  };
}

// ---------- 每帧更新 ----------

export function update(s: GameState, dtRaw: number): EngineEvent[] {
  const events: EngineEvent[] = [];
  const dt = Math.min(0.05, dtRaw);
  const running = s.phase === "running";
  const p = s.player;

  if (running) {
    // 时间与速度
    s.t += dt;
    s.speed = Math.min(MAX_SPEED, BASE_SPEED + s.t * SPEED_RAMP);

    // 忍蜂：突刺期间世界速度倍率 + 残影
    let mult = 1;
    if (p.dashT > 0) {
      p.dashT -= dt;
      mult = DASH_MULT;
      p.ghostT -= dt;
      if (p.ghostT <= 0) {
        p.ghostT = 0.03;
        s.ghosts.push({ x: p.x, y: p.y, frame: p.frame() });
      }
      if (s.ghosts.length > 24) s.ghosts.shift();
    }
    const scroll = s.speed * mult;

    // 计分
    s.score += (scroll * dt) / SCORE_RATE;
    if (s.score > s.highScore) s.highScore = s.score;

    // 玩家物理（可变跳高：上升段松开键 → 更快衰减）
    if (!p.grounded) {
      if (!p.jumpHold && p.vy < 0) p.vy += JUMP_CUT * GRAVITY * dt;
      p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y >= GROUND_Y) {
        p.y = GROUND_Y;
        p.vy = 0;
        p.grounded = true;
      }
    }
    if (p.grounded) p.animT += dt;

    // 冷却
    if (s.cd1 > 0) {
      s.cd1 = Math.max(0, s.cd1 - dt);
      if (s.cd1 === 0) events.push("ready1");
    }
    if (s.cd2 > 0) {
      s.cd2 = Math.max(0, s.cd2 - dt);
      if (s.cd2 === 0) events.push("ready2");
    }

    // 障碍移动 + 清理
    for (const ob of s.obstacles) {
      ob.x -= scroll * dt;
      ob.animT += dt;
    }
    s.obstacles = s.obstacles.filter((ob) => ob.x + ob.w > -10);

    // 生成（按滚动距离）
    s.spawnT -= scroll * dt;
    if (s.spawnT <= 0) {
      spawnObstacle(s);
      s.spawnT = SPAWN_GAP_MIN + Math.random() * (SPAWN_GAP_MAX - SPAWN_GAP_MIN);
    }

    // 扇子弹道 + 击碎障碍
    for (const f of s.fans) {
      f.x += f.vx * dt;
      f.vy += 60 * dt;
      f.y += f.vy * dt;
      f.rot += FAN_SPIN * dt;
      f.life -= dt;
      // 命中判定（扇盒 14x14，中心 x+7/y+6）
      for (let i = s.obstacles.length - 1; i >= 0; i--) {
        const ob = s.obstacles[i];
        const obBox = { x: ob.x, y: GROUND_Y - ob.h, w: ob.w, h: ob.h };
        if (aabb(f.x - 1, f.y - 1, 16, 16, obBox.x, obBox.y, obBox.w, obBox.h)) {
          s.obstacles.splice(i, 1);
          s.score += 30;
          s.shakeT = 0.2;
          s.flashT = 0.1;
          events.push("smash");
          spawnDebris(s, obBox.x + obBox.w / 2, GROUND_Y - obBox.h / 2, ob.kind);
        }
      }
    }
    s.fans = s.fans.filter((f) => f.life > 0 && f.x < W + 30);

    // 玩家与障碍碰撞（忍蜂突刺期间整体跳过 = 无视障碍）
    if (p.dashT <= 0) {
      const px = p.x - p.w / 2 + 5;
      const py = p.y - p.h + 4;
      const pw = p.w - 10;
      const ph = p.h - 8;
      for (const ob of s.obstacles) {
        if (aabb(px, py, pw, ph, ob.x, GROUND_Y - ob.h, ob.w, ob.h)) {
          s.phase = "dead";
          events.push("die");
          break;
        }
      }
    }

    s.dist += scroll * dt;
  }

  // 粒子（任何阶段都更新，死亡后碎屑继续飞）
  updateParticles(s, dt);

  // 震动/白闪衰减
  if (s.shakeT > 0) s.shakeT = Math.max(0, s.shakeT - dt);
  if (s.flashT > 0) s.flashT = Math.max(0, s.flashT - dt);

  return events;
}

// ---------- 操作 ----------

/** 跳跃：仅落地且运行中 */
export function tryJump(s: GameState): boolean {
  if (s.phase !== "running" || !s.player.grounded) return false;
  s.player.vy = JUMP_VY;
  s.player.grounded = false;
  return true;
}

/**
 * 施放技能。slot 1 = 花蝶扇（CD 6s），slot 2 = 忍蜂（CD 12s）。
 * 返回 "fan" | "dash" 表示施放成功（调用方播音效），null 表示冷却中/未运行。
 */
export function tryCast(s: GameState, slot: 1 | 2): "fan" | "dash" | null {
  if (s.phase !== "running") return null;
  if (slot === 1) {
    if (s.cd1 > 0) return null;
    s.cd1 = CD_FAN;
    const p = s.player;
    s.fans.push({
      x: p.x + 10,
      y: p.y - 14,
      vx: FAN_VX,
      vy: -30,
      rot: 0,
      life: FAN_LIFE,
    });
    return "fan";
  }
  if (s.cd2 > 0) return null;
  s.cd2 = CD_DASH;
  s.player.dashT = DASH_TIME;
  s.ghosts = [];
  return "dash";
}

/** 重新开始一局（继承当前 highScore） */
export function restartState(s: GameState): GameState {
  const next = createState(s.highScore);
  return next;
}

// ---------- 内部 ----------

function spawnObstacle(s: GameState) {
  // 速度越快，火柱（最高、需满跳）占比越高
  const flameP = s.speed > 250 ? 0.35 : 0.2;
  const roll = Math.random();
  let kind: Obstacle["kind"];
  if (roll < 0.45) kind = "rock";
  else if (roll < 0.45 + 0.35) kind = "log";
  else kind = "flame";
  if (kind === "flame" && Math.random() > flameP) kind = "rock"; // 未达阈值时火柱降权
  const dims = kind === "rock" ? { w: 24, h: 14 } : kind === "log" ? { w: 40, h: 16 } : { w: 18, h: 46 };
  s.obstacles.push({ kind, x: W + 10, w: dims.w, h: dims.h, animT: 0 });
}

/** 击碎障碍的碎屑粒子（按障碍类型配色） */
function spawnDebris(s: GameState, x: number, y: number, kind: Obstacle["kind"]) {
  const color =
    kind === "rock" ? "#9aa0ad" : kind === "log" ? "#a0683c" : "#ff9a3c";
  for (let i = 0; i < 10; i++) {
    s.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 260,
      vy: -Math.random() * 240,
      life: 0.5 + Math.random() * 0.3,
      maxLife: 0.8,
      color,
      size: 1 + Math.random() * 1.5,
    });
  }
  if (s.particles.length > 200) s.particles.splice(0, s.particles.length - 200);
}

function updateParticles(s: GameState, dt: number) {
  for (const p of s.particles) {
    p.life -= dt;
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  s.particles = s.particles.filter((p) => p.life > 0);
}

function aabb(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
