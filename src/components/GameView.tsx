import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gamepad2,
  Pencil,
  Play,
  Plus,
  Rocket,
  ScanLine,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  Game,
  GameSession,
  GameStats,
  GameTimerInfo,
  ScannedProgram,
  SteamGameInfo,
} from "../lib/api";
import {
  cancelGameTimer,
  deleteSession,
  gameStats,
  getGameTimer,
  importGames,
  launchGame,
  listGames,
  listSessions,
  scanPrograms,
  scanSteamGames,
  startGameTimer,
  stopGameTimer,
  updateGamePath,
} from "../lib/api";
import { posterFor } from "../lib/posters";
import BootIntro from "./BootIntro";
import PixelRunGame from "./game/PixelRunGame";

/** 卡片封面色板（无海报时按名称取色） */
const COVER_COLORS = [
  "#5b7cfa",
  "#7c5bfa",
  "#e05b8d",
  "#3aa7d6",
  "#2fb98c",
  "#e89a3c",
  "#e05b5b",
  "#8d5bfa",
  "#4a8f8f",
  "#b05be0",
];

function coverColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return COVER_COLORS[h % COVER_COLORS.length];
}

/** 本地时间串 "YYYY-MM-DD HH:MM:SS" → 时间戳 */
function parseLocal(s: string): number {
  const [d, t] = s.split(" ");
  const [y, m, day] = d.split("-").map(Number);
  const [h, mi, sec] = t.split(":").map(Number);
  return new Date(y, m - 1, day, h, mi, sec).getTime();
}

/** 分钟 → "H 小时 M 分" */
function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  return `${m} 分钟`;
}

/** 秒数 → "MM:SS"（剩余时间用） */
function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 历史记录时间 → "8月26日 21:30" */
function fmtDateTime(s: string): string {
  const [d, t] = s.split(" ");
  const [, m, day] = d.split("-").map(Number);
  return `${m}月${day}日 ${t.slice(0, 5)}`;
}

/**
 * 游戏娱乐：开机动画（粒子增强版）→ 独占式游戏界面：
 * 整幅海报铺满舞台做背景，名称左上、隐形箭头左右、
 * 历史左下、指示点底部中央、启动游戏右下角；
 * 计时面板放在顶部「添加游戏」旁边。
 * 点击启动游戏：界面淡出、背景轻微放大、中央出现加载球过渡。
 */
export default function GameView() {
  // 开机动画（本会话只播一次）
  const [intro, setIntro] = useState(
    () => !sessionStorage.getItem("shiguang_game_intro")
  );
  const finishIntro = useCallback(() => {
    sessionStorage.setItem("shiguang_game_intro", "1");
    setIntro(false);
  }, []);

  const [games, setGames] = useState<Game[]>([]);
  const [stats, setStats] = useState<Map<number, GameStats>>(new Map());
  const [timer, setTimer] = useState<GameTimerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  // 当前展示的下标与切换方向（方向决定背景图滑入方向）
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  // 启动过渡状态（界面淡出 + 背景放大 + 加载球）
  const [launching, setLaunching] = useState(false);
  const launchTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (launchTimer.current) window.clearTimeout(launchTimer.current);
    },
    []
  );

  // 扫描导入弹层
  const [scanOpen, setScanOpen] = useState(false);
  const [scanTab, setScanTab] = useState<"steam" | "programs">("steam");
  const [steamList, setSteamList] = useState<SteamGameInfo[] | null>(null);
  const [progList, setProgList] = useState<ScannedProgram[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  // 当前游戏的历史记录
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [goalInput, setGoalInput] = useState("60");

  // 设置启动路径弹层
  const [pathOpen, setPathOpen] = useState(false);
  const [pathInput, setPathInput] = useState("");

  // 子视图切换：游戏库舞台 | 像素跑酷小游戏
  const [miniGame, setMiniGame] = useState<"library" | "pixel-run">("library");

  // 计时显示每秒刷新（剩余时间由 started_at 实时算）
  const [tick, setTick] = useState(0);

  const loadAll = useCallback(async () => {
    const [gs, st, tm] = await Promise.all([
      listGames(),
      gameStats(),
      getGameTimer(),
    ]);
    setGames(gs);
    setStats(new Map(st.map((s) => [s.game_id, s])));
    setTimer(tm);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [loadAll]);

  // 后端计时事件 → 横幅 + 刷新
  useEffect(() => {
    const un1 = listen<{ game_id: number; game_name: string }>(
      "game-timer-5min",
      (e) => {
        setBanner(`「${e.payload.game_name}」还有 5 分钟就到点了`);
        void getGameTimer().then(setTimer);
      }
    );
    const un2 = listen<{ game_id: number; game_name: string; duration_min: number }>(
      "game-timer-ended",
      (e) => {
        setBanner(
          `「${e.payload.game_name}」时间到！本次玩了 ${e.payload.duration_min} 分钟，已自动记录`
        );
        setTimer(null);
        void loadAll();
      }
    );
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [loadAll]);

  const current = games[index] ?? null;
  const poster = current ? posterFor(current.name) : null;

  // 切换游戏 → 加载历史 + 按累计时长建议目标
  useEffect(() => {
    if (!current) return;
    setSessionLoading(true);
    listSessions(current.id)
      .then(setSessions)
      .finally(() => setSessionLoading(false));
    setGoalInput(
      String(Math.max(30, Math.round((stats.get(current.id)?.total_min ?? 60) / 5)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  /** 上一个 / 下一个游戏（到边界停止；启动过渡中禁止切换） */
  const go = (d: 1 | -1) => {
    if (launching) return;
    if ((d === -1 && index === 0) || (d === 1 && index === games.length - 1)) return;
    setDir(d);
    setIndex(index + d);
  };

  // ---- 扫描导入 ----

  const openScan = async (tab: "steam" | "programs") => {
    setScanOpen(true);
    setScanTab(tab);
    setImportMsg("");
    setScanning(true);
    try {
      if (tab === "steam") {
        const list = await scanSteamGames();
        setSteamList(list);
        setChecked(new Set(list.map((g) => `steam:${g.appid}`)));
      } else {
        const list = await scanPrograms();
        setProgList(list);
        setChecked(new Set());
      }
    } finally {
      setScanning(false);
    }
  };

  const toggleCheck = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const doImport = async () => {
    if (checked.size === 0) return;
    setScanning(true);
    try {
      const list =
        scanTab === "steam"
          ? [...(steamList ?? [])]
              .filter((g) => checked.has(`steam:${g.appid}`))
              .map((g) => ({
                externalId: g.appid,
                name: g.name,
                exePath: null as string | null,
              }))
          : [...(progList ?? [])]
              .filter((g) => checked.has(`prog:${g.name}`))
              .map((g) => ({
                externalId: null,
                name: g.name,
                exePath: g.install_location,
              }));
      const added = await importGames(scanTab === "steam" ? "steam" : "scanned", list);
      setImportMsg(`已导入 ${added} 款游戏（其余是已有的）`);
      await loadAll();
    } finally {
      setScanning(false);
    }
  };

  // ---- 启动游戏（过渡：界面淡出 → 背景放大 → 中央加载球） ----

  const launch = () => {
    if (!current || launching) return;
    const canLaunch =
      (current.source === "steam" && Boolean(current.external_id)) ||
      Boolean(current.exe_path);
    if (!canLaunch) {
      setBanner("「" + current.name + "」没有记录可执行文件路径，无法直接启动");
      return;
    }
    setLaunching(true);
    void (async () => {
      try {
        if (current.source === "steam" && current.external_id) {
          // Steam 游戏通过官方协议启动（会唤起 Steam 客户端）
          await openUrl(`steam://rungameid/${current.external_id}`);
        } else {
          // 本机程序：后端直接 spawn，中文路径更可靠，错误信息明确
          await launchGame(current.id);
        }
      } catch (e) {
        setBanner(`启动失败：${String(e)}`);
        setLaunching(false);
        return;
      }
      // 过渡动画展示片刻后自动恢复界面（游戏窗口可能已接管前台）
      launchTimer.current = window.setTimeout(() => setLaunching(false), 8000);
    })();
  };

  // ---- 计时 ----

  const beginTimer = async () => {
    if (!current) return;
    const goal = Math.min(720, Math.max(1, Math.round(Number(goalInput)) || 60));
    const t = await startGameTimer(current.id, goal);
    setTimer(t);
    setBanner(`「${t.game_name}」开始计时，目标 ${t.goal_min} 分钟`);
    void loadAll();
  };

  const endTimer = async (record: boolean) => {
    if (!current) return;
    if (record) {
      const s = await stopGameTimer(current.id);
      setBanner(`「${current.name}」已结束，本次 ${s.duration_min} 分钟已记录`);
    } else {
      await cancelGameTimer(current.id);
      setBanner("已放弃本次计时，未记录");
    }
    setTimer(null);
    void loadAll();
  };

  const removeSession = async (id: number) => {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    void loadAll();
  };

  // ---- 设置启动路径 ----

  const openPathEdit = () => {
    setPathInput(current?.exe_path ?? "");
    setPathOpen(true);
  };

  const savePath = async () => {
    if (!current || !pathInput.trim()) return;
    await updateGamePath(current.id, pathInput.trim());
    setPathOpen(false);
    setBanner(`已更新「${current.name}」的启动路径`);
    void loadAll();
  };

  // 剩余时间（实时计算）
  const remainingSec = useMemo(() => {
    if (!timer) return 0;
    return timer.goal_min * 60 - (Date.now() - parseLocal(timer.started_at)) / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer, tick]);

  const scanList = scanTab === "steam" ? steamList : progList;
  const selectedCount = checked.size;

  // 像素跑酷：整块替换舞台（intro 是首次进入模块的全屏遮罩，此时必然已结束）
  if (miniGame === "pixel-run") {
    return <PixelRunGame onBack={() => setMiniGame("library")} />;
  }

  return (
    <div className="game-view">
      {intro && <BootIntro onDone={finishIntro} />}

      {/* 头部：计时面板放在「添加游戏」旁边 */}
      <div className="game-header">
        <div className="game-header-title">
          <h2>游戏娱乐</h2>
          <span className="game-header-sub">游戏时光，张弛有度</span>
        </div>
        <div className="game-header-actions">
          {current &&
            (timer?.game_id === current.id ? (
              <div className="dock-timer">
                <div className="dock-timer-top">
                  <div className="timer-remain-sm">{fmtClock(remainingSec)}</div>
                  <div className="timer-sub">
                    目标 {timer.goal_min} 分钟 · 已玩{" "}
                    {fmtDuration(Math.max(0, timer.goal_min - remainingSec / 60))}
                  </div>
                </div>
                <div className="timer-bar">
                  <div
                    className="timer-bar-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          ((timer.goal_min * 60 - remainingSec) / (timer.goal_min * 60)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <div className="timer-actions">
                  <button
                    className="game-btn-primary"
                    onClick={() => void endTimer(true)}
                  >
                    <Square size={13} /> 结束并记录
                  </button>
                  <button className="plan-nav-btn" onClick={() => void endTimer(false)}>
                    放弃计时
                  </button>
                </div>
              </div>
            ) : timer ? (
              <div className="timer-blocked">「{timer.game_name}」正在计时中，请先结束它</div>
            ) : (
              <div className="dock-timer">
                <div className="timer-set">
                  <label>
                    本次想玩
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={goalInput}
                      onChange={(e) => setGoalInput(e.target.value)}
                    />
                    分钟
                  </label>
                  <button className="game-btn-primary" onClick={() => void beginTimer()}>
                    <Play size={13} /> 开始计时
                  </button>
                </div>
              </div>
            ))}
          <button className="plan-nav-btn" onClick={() => void openScan("steam")}>
            <Plus size={14} /> 添加游戏
          </button>
          <button
            className="plan-nav-btn"
            onClick={() => setMiniGame("pixel-run")}
            title="像素跑酷小游戏（不知火舞）"
          >
            <Gamepad2 size={14} /> 像素跑酷
          </button>
        </div>
      </div>

      {/* 空状态 / 加载中 */}
      {loading ? (
        <div className="game-empty">加载中…</div>
      ) : games.length === 0 ? (
        <div className="game-empty">
          <Gamepad2 size={44} className="game-empty-icon" />
          <p>游戏库还是空的</p>
          <p className="game-empty-sub">可以从 Steam 库导入，或扫描本机安装的程序</p>
          <div className="game-empty-actions">
            <button className="game-btn-primary" onClick={() => void openScan("steam")}>
              <ScanLine size={14} /> 从 Steam 导入
            </button>
            <button className="plan-nav-btn" onClick={() => void openScan("programs")}>
              <ScanLine size={14} /> 扫描本机程序
            </button>
          </div>
        </div>
      ) : current ? (
        /* ============ 独占游戏舞台：整幅海报做背景 ============ */
        <div
          className={`game-stage${launching ? " launching" : ""}`}
          onClick={() => {
            // 启动过渡中点背景任意处：立即恢复界面
            if (launching) setLaunching(false);
          }}
        >
          {/* 背景：海报放大铺满整个界面（key 变化触发方向滑入动画） */}
          {poster ? (
            <img
              key={current.id}
              className={`game-bg-img${dir === 1 ? " from-right" : " from-left"}`}
              src={poster}
              alt=""
              draggable={false}
            />
          ) : (
            <div
              key={current.id}
              className={`game-bg-img game-bg-cover${dir === 1 ? " from-right" : " from-left"}`}
              style={{
                background: `linear-gradient(160deg, ${coverColor(current.name)}, #10131c)`,
              }}
            >
              <span className="game-bg-cover-letter">
                {current.name.trim().charAt(0) || "?"}
              </span>
            </div>
          )}
          <div className="game-bg-tint" />

          {/* 图片上的 UI（启动时整体淡出） */}
          <div className="stage-ui">
            {/* 左上：游戏名 + 来源 + 统计 */}
            <div className="game-head">
              <div className="game-head-name">{current.name}</div>
              <div className="game-head-meta">
                <span className={`game-source game-source-${current.source}`}>
                  {current.source === "steam" ? "Steam" : "本机"}
                </span>
                <span>
                  累计 {fmtDuration(stats.get(current.id)?.total_min ?? 0)} ·{" "}
                  {stats.get(current.id)?.sessions ?? 0} 次
                </span>
                <button
                  className="path-edit-btn"
                  onClick={openPathEdit}
                  title="设置启动程序路径"
                >
                  <Pencil size={11} /> {current.exe_path ? "修改路径" : "设置路径"}
                </button>
              </div>
            </div>

            {/* 右上：位置计数 */}
            <div className="game-count">
              {index + 1} / {games.length}
            </div>

            {/* 左右隐形箭头 */}
            <button
              className={`game-nav-arrow left${index === 0 ? " disabled" : ""}`}
              onClick={() => go(-1)}
              title="上一个游戏"
              aria-label="上一个游戏"
            >
              <ChevronLeft size={30} />
            </button>
            <button
              className={`game-nav-arrow right${index === games.length - 1 ? " disabled" : ""}`}
              onClick={() => go(1)}
              title="下一个游戏"
              aria-label="下一个游戏"
            >
              <ChevronRight size={30} />
            </button>

            {/* 左下：历史记录（最近 4 条） */}
            <div className="dock-history">
              <h4>
                历史记录
                <span className="dock-history-count">
                  共 {stats.get(current.id)?.sessions ?? 0} 次
                </span>
              </h4>
              {sessionLoading ? (
                <div className="session-empty">加载中…</div>
              ) : sessions.length === 0 ? (
                <div className="session-empty">还没有游玩记录，开始第一次计时吧</div>
              ) : (
                <>
                  {sessions.slice(0, 4).map((s) => (
                    <div key={s.id} className="session-row">
                      <Clock size={12} />
                      <span className="session-date">{fmtDateTime(s.started_at)}</span>
                      <span className="session-dur">{fmtDuration(s.duration_min)}</span>
                      {s.goal_min != null && (
                        <span className="session-goal">（目标 {s.goal_min} 分）</span>
                      )}
                      <button
                        className="session-del"
                        title="删除记录"
                        onClick={() => void removeSession(s.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  {sessions.length > 4 && (
                    <div className="session-more">还有 {sessions.length - 4} 条记录…</div>
                  )}
                </>
              )}
            </div>

            {/* 底部中央：点状指示器 */}
            <div className="game-dots">
              {games.map((g, i) => (
                <button
                  key={g.id}
                  className={`game-dot${i === index ? " active" : ""}`}
                  title={g.name}
                  onClick={() => {
                    setDir(i > index ? 1 : -1);
                    setIndex(i);
                  }}
                />
              ))}
            </div>

            {/* 右下角：启动游戏 */}
            <button
              className="dock-launch-btn"
              onClick={() => void launch()}
              disabled={launching}
            >
              <Rocket size={18} /> 启动游戏
            </button>
          </div>

          {/* 启动过渡：清空 UI + 背景放大 + 中央加载球 */}
          {launching && (
            <div className="launch-zone">
              <div className="launch-ball">
                <div className="launch-ring r1" />
                <div className="launch-ring r2" />
                <div className="launch-ball-core" />
              </div>
              <div className="launch-name">{current.name}</div>
              <div className="launch-sub">正在启动… 点击界面返回</div>
            </div>
          )}
        </div>
      ) : null}

      {/* 设置启动路径弹层 */}
      {pathOpen && current && (
        <div className="path-mask" onClick={() => setPathOpen(false)}>
          <div className="path-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>设置启动路径</h3>
            <p className="path-game">{current.name}</p>
            <input
              className="path-input"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="例如 F:\原神\Genshin Impact bilibili\launcher.exe"
              autoFocus
            />
            <div className="path-actions">
              <button className="plan-nav-btn" onClick={() => setPathOpen(false)}>
                取消
              </button>
              <button
                className="game-btn-primary"
                disabled={!pathInput.trim()}
                onClick={() => void savePath()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 扫描导入弹层 */}
      {scanOpen && (
        <div className="scan-mask" onClick={() => setScanOpen(false)}>
          <div className="scan-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="scan-head">
              <h3>添加游戏</h3>
              <button className="scan-close" onClick={() => setScanOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="scan-tabs">
              <button
                className={`scan-tab${scanTab === "steam" ? " active" : ""}`}
                onClick={() => void openScan("steam")}
              >
                Steam 库
              </button>
              <button
                className={`scan-tab${scanTab === "programs" ? " active" : ""}`}
                onClick={() => void openScan("programs")}
              >
                本机程序
              </button>
            </div>

            {scanning && !scanList ? (
              <div className="scan-list scan-loading">扫描中…</div>
            ) : !scanList || scanList.length === 0 ? (
              <div className="scan-list scan-loading">
                {scanTab === "steam"
                  ? "未检测到 Steam 安装（或 Steam 里没有已安装的游戏）"
                  : "没有扫描到可导入的程序"}
              </div>
            ) : (
              <>
                <div className="scan-toolbar">
                  <button
                    className="plan-nav-btn"
                    onClick={() => {
                      const all = scanList.map((g) =>
                        scanTab === "steam"
                          ? `steam:${(g as SteamGameInfo).appid}`
                          : `prog:${(g as ScannedProgram).name}`
                      );
                      setChecked(checked.size === all.length ? new Set() : new Set(all));
                    }}
                  >
                    {checked.size === scanList.length ? "全不选" : "全选"}
                  </button>
                  <span className="scan-count">已选 {selectedCount} 项</span>
                </div>
                <div className="scan-list">
                  {scanList.map((g) => {
                    const key =
                      scanTab === "steam"
                        ? `steam:${(g as SteamGameInfo).appid}`
                        : `prog:${(g as ScannedProgram).name}`;
                    const prog = g as ScannedProgram;
                    const steam = g as SteamGameInfo;
                    return (
                      <label key={key} className="scan-row">
                        <input
                          type="checkbox"
                          checked={checked.has(key)}
                          onChange={() => toggleCheck(key)}
                        />
                        <span className="scan-row-name">
                          {scanTab === "steam" ? steam.name : prog.name}
                        </span>
                        <span className="scan-row-sub">
                          {scanTab === "steam"
                            ? steam.installdir
                            : prog.publisher || prog.install_location || ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            <div className="scan-foot">
              {importMsg && <span className="scan-import-msg">{importMsg}</span>}
              <button
                className="game-btn-primary"
                disabled={scanning || checked.size === 0}
                onClick={() => void doImport()}
              >
                <Check size={14} /> 导入所选
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提醒横幅 */}
      {banner && (
        <div className="plan-banner">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)}>知道了</button>
        </div>
      )}
    </div>
  );
}
