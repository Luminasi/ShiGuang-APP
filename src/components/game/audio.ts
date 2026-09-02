/**
 * 像素跑酷：Web Audio API 程序化合成音效（无音频文件、无依赖）。
 * AudioContext 模块级单例，首次用户手势时创建/resume（绕过自动播放限制）；
 * 所有函数内部 try/catch 静默失败（无音频环境不报错）。
 */

let actx: AudioContext | null = null;

/** 首次用户手势时调用：创建并恢复 AudioContext */
export function resumeAudio() {
  try {
    if (!actx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      actx = new Ctor();
    }
    if (actx.state === "suspended") void actx.resume();
  } catch {
    /* 静默 */
  }
}

/** 基础音：振荡器 + 指数衰减包络 */
function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  glideTo?: number,
  delay = 0,
) {
  if (!actx) return;
  try {
    const t0 = actx.currentTime + delay;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
    }
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    /* 静默 */
  }
}

/** 白噪声 burst（带滤波器塑造质感） */
function noiseBurst(dur: number, vol: number, cutoff: number, type: BiquadFilterType, delay = 0) {
  if (!actx) return;
  try {
    const t0 = actx.currentTime + delay;
    const len = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const filter = actx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const gain = actx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(actx.destination);
    src.start(t0);
  } catch {
    /* 静默 */
  }
}

// ---------- 音效清单 ----------

/** 开局：双音上扬 */
export function sfxStart() {
  tone(440, 0.1, "square", 0.12, 660);
  tone(660, 0.12, "square", 0.12, 880, 0.11);
}

/** 跳跃：短促上滑「嗒」 */
export function sfxJump() {
  tone(280, 0.12, "square", 0.12, 620);
}

/** 花蝶扇：嗖—— */
export function sfxFan() {
  noiseBurst(0.3, 0.1, 6000, "bandpass");
  tone(900, 0.25, "sawtooth", 0.06, 200);
}

/** 忍蜂：呼啸突刺 */
export function sfxDash() {
  noiseBurst(0.45, 0.12, 4000, "lowpass");
  tone(150, 0.4, "sawtooth", 0.08, 480);
}

/** 击碎障碍：啪 */
export function sfxSmash() {
  noiseBurst(0.12, 0.16, 800, "lowpass");
  tone(120, 0.1, "square", 0.12, 60);
}

/** 死亡：低音下滑 */
export function sfxDie() {
  tone(420, 0.5, "square", 0.22, 55);
}

/** 新纪录：三连琶音 */
export function sfxRecord() {
  tone(523, 0.12, "triangle", 0.14);
  tone(659, 0.12, "triangle", 0.14, undefined, 0.12);
  tone(784, 0.18, "triangle", 0.14, undefined, 0.24);
}

/** 技能 CD 就绪：叮 */
export function sfxReady() {
  tone(880, 0.08, "sine", 0.1);
}
