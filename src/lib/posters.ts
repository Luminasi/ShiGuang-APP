/**
 * 游戏海报匹配（阶段 4）
 *
 * 素材来源：f:\shiguang\图例 文件夹，用户确认了对应关系：
 *   a7d69af1...png → 三角洲行动（delta.jpg）
 *   fc8b6925...png → 无畏契约（valorant.jpg）
 *   7c900650...png → 原神（genshin.jpg）
 *   fb144d80...png → 永劫无间（naraka.jpg）
 *   艾尔登法环 黑夜君临...jpeg → 艾尔登法环（elden.jpg）
 *
 * 按游戏名称关键字匹配（Steam 上多为英文名，如 NARAKA: BLADEPOINT），
 * 匹配不到的退回纯色封面。
 */

import delta from "../assets/posters/delta.jpg";
import valorant from "../assets/posters/valorant.jpg";
import genshin from "../assets/posters/genshin.jpg";
import naraka from "../assets/posters/naraka.jpg";
import elden from "../assets/posters/elden.jpg";

const POSTERS: { keys: string[]; img: string }[] = [
  { keys: ["永劫", "naraka", "bladepoint"], img: naraka },
  { keys: ["三角洲", "delta force"], img: delta },
  { keys: ["瓦罗兰特", "valorant", "无畏契约"], img: valorant },
  { keys: ["原神", "genshin"], img: genshin },
  { keys: ["艾尔登", "elden ring", "nightreign"], img: elden },
];

/** 按游戏名称取海报图；没有匹配返回 null（用纯色封面） */
export function posterFor(name: string): string | null {
  const n = name.toLowerCase();
  for (const p of POSTERS) {
    if (p.keys.some((k) => n.includes(k))) return p.img;
  }
  return null;
}
