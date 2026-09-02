/**
 * 拾光吉祥物引擎公开 API（阶段 8）。
 * 引擎本体来自 github.com/jeremy-prt/bloub（MIT，LICENSE 见本目录），
 * 前端只通过本文件消费，不要直接 import 内部实现细节。
 */
export { BotEngine } from './engine'
export type { BotFrame, Look, RenderedEye } from './engine'
export { STATE_BY_ID, SEQUENCE } from './states'
export type { StateId } from './states'
export {
  SHAPES,
  SHAPE_BY_ID,
  COLOR_BY_ID,
  DEFAULT_COLOR,
  DEFAULT_SHAPE,
  mixHex
} from './skins'
export type { ShapeId, ColorId } from './skins'
export { EXPRESSIONS, EXPRESSION_BY_ID, DEFAULT_EXPRESSION } from './expressions'
export type { ExpressionId, BotExpression } from './expressions'
export { RAYON, DEMI_VIEWBOX } from './repere'
export type { Block } from './cycles'
export { NOTIF_BLUE } from './decor'
export { lookTarget, TURN_TIME } from './gaze'
