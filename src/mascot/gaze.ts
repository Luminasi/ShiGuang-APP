// 来源：github.com/jeremy-prt/bloub（MIT）src/ui/gaze.ts。跟随注视规则（框架无关），
// 只移植拾光用到的 lookTarget 部分；常量为原作者所选（非视频测量值），原样保留。
import type { Look } from './engine'

/**
 * 角度上限（度）。CHOISIS，非测量：幅度大到能与静止漂移（±7° 偏航、±5.5° 俯仰）
 * 区分开，又小到任何一只眼睛都不会转到球体边缘之后。
 */
export const YAW_MAX = 16
export const PITCH_MAX = 13

/** 光标在屏幕中心时注视的高度（度）。绝对值：相对值会让眼睛跟随每种表情自己的高度。 */
export const PITCH = 10

/** 进入视图时头部转向的角度（度），随后再跟随光标。 */
export const TURN = 26

/**
 * 途中多转一整圈（度）：眼睛不是横穿脸部，而是绕球一圈后落定。
 * 免费：眼睛长在球面上，超过 ±90° 偏航自然从另一侧重新出现；-360° 与 0° 同角，
 * 因此落点天然正确。
 */
export const SPIN = 360

/** 转向时长（秒）。 */
export const TURN_TIME = 1.1

export interface Aim {
  /** 光标到吉祥物中心的水平偏差，-1..1（右为正） */
  nx: number
  /** 垂直偏差，-1..1（屏幕向下为正） */
  ny: number
  /** 入场进度 0..1 */
  tour: number
  /** false = 没有已知光标：头部保持转向，但恢复漂移（而不是盯着死点） */
  pointer: boolean
}

/**
 * 跟随目标。`tour` 统率一切：让外部接管程度（mix）升起、让入场转圈（spin）淡出。
 * 这里不做任何表情补偿——混合由引擎完成，因为只有引擎知道瞬时姿态。
 */
export function lookTarget({ nx, ny, tour, pointer }: Aim): Look {
  return {
    // 拾光适配：主页吉祥物居中，视线左右对称跟随光标。
    // 原版 yaw = -TURN + nx*YAW_MAX（吉祥物固定左下角，视线恒偏左朝向对话区），
    // 居中布局下光标在右边也「转不过来」，故去掉 -TURN 偏移；俯仰同样对称居中。
    yaw: nx * YAW_MAX,
    // 俯仰正 = 向上看，而屏幕 y 轴向下
    pitch: -ny * PITCH_MAX,
    mix: tour,
    spin: SPIN * (1 - tour),
    wander: pointer ? 0 : 1
  }
}
