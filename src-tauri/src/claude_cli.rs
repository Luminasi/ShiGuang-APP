//! Claude Code CLI 子进程封装（学习助手 AI 接入）
//!
//! 复用本机已登录的 Claude Code（`claude` 命令），非交互调用：
//! `claude -p --output-format json`，prompt 走 stdin 管道（避开 cmd 引号转义）。
//! 关键点：Windows 上 claude 是 .cmd shim，必须经 `cmd /C` 执行；
//! cwd 必须设在用户主目录（否则 Claude Code 会加载当前项目配置污染上下文）。

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

/// 正在执行的 AI 子进程（全局唯一）：忙标记 + 子进程 pid（供超时/退出清理）
#[derive(Default)]
pub struct AiInner {
    pub busy: bool,
    pub pid: Option<u32>,
}

/// AI 状态，由 lib.rs `app.manage` 注入（Clone 便于跨 spawn_blocking 传递）
#[derive(Clone, Default)]
pub struct AiState(pub Arc<Mutex<AiInner>>);

impl AiState {
    pub fn new() -> Self {
        Self::default()
    }

    /// 应用退出时清理残留子进程（树杀）
    pub fn kill_current(&self) {
        if let Ok(mut inner) = self.0.lock() {
            if let Some(pid) = inner.pid.take() {
                let _ = kill_by_pid(pid);
            }
        }
    }
}

/// 定位 claude 可执行文件（成功结果缓存；失败每次重找）
fn locate_claude() -> Result<PathBuf, String> {
    static CACHE: OnceLock<PathBuf> = OnceLock::new();
    if let Some(p) = CACHE.get() {
        return Ok(p.clone());
    }

    // 1. 环境变量显式覆盖
    if let Ok(p) = std::env::var("SHIGUANG_CLAUDE_PATH") {
        let p = PathBuf::from(p);
        if p.exists() {
            let _ = CACHE.set(p.clone());
            return Ok(p);
        }
    }

    // 2. `where claude` 找 PATH 中的可执行文件（取第一行）
    if let Ok(out) = Command::new("where").arg("claude").output() {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(line) = text.lines().next() {
                let p = PathBuf::from(line.trim());
                if p.exists() {
                    let _ = CACHE.set(p.clone());
                    return Ok(p);
                }
            }
        }
    }

    // 3. npm 全局安装的常见位置（claude.cmd shim）
    if let Ok(appdata) = std::env::var("APPDATA") {
        let p = Path::new(&appdata).join("npm").join("claude.cmd");
        if p.exists() {
            let _ = CACHE.set(p.clone());
            return Ok(p);
        }
    }

    // 4. 兜底：裸命令名（已加入 PATH 的 exe 场景）
    let _ = CACHE.set(PathBuf::from("claude"));
    Ok(PathBuf::from("claude"))
}

/// 组装子进程：.cmd/.bat 必须经 cmd /C 执行
fn build_command(path: &Path) -> Command {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    let is_shim = ext == Some("cmd".into()) || ext == Some("bat".into());
    let mut cmd = if is_shim {
        // .cmd/.bat 必须经 cmd.exe 执行（CreateProcess 不能直接跑）
        let mut c = Command::new("cmd.exe");
        c.arg("/C").arg(path);
        c
    } else {
        Command::new(path)
    };
    cmd.args(["-p", "--output-format", "json"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

/// Windows 下树杀进程（cmd 壳被杀后 node 子进程可能残留，需 /T 树杀）
fn kill_by_pid(pid: u32) -> std::io::Result<()> {
    if pid == 0 {
        return Ok(());
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).output();
    }
    Ok(())
}

/// 阻塞调用 Claude CLI（无锁版）：prompt 走 stdin，等待完整输出，超时树杀。
/// 忙锁由 ai::run_ai_blocking 统一持有，此处不再加锁；调用方应放在 spawn_blocking 中执行。
pub(crate) fn run_claude_inner(state: &AiState, prompt: &str, timeout_secs: u64) -> Result<String, String> {
    let path = locate_claude()?;
    let mut cmd = build_command(&path);

    // cwd 设为用户主目录，避免加载项目 CLAUDE.md 污染上下文
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    if !home.is_empty() {
        cmd.current_dir(home);
    }

    let mut child = cmd.spawn().map_err(|e| format!("无法启动 claude 命令：{e}"))?;

    // 子进程 pid 挂到 AiState（供应用退出清理）
    {
        let mut inner = state.0.lock().map_err(|_| "AI 状态锁异常".to_string())?;
        inner.pid = Some(child.id());
    }

    // 两个线程分别读 stdout / stderr，避免管道写满阻塞
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out_handle = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        buf
    });
    let err_handle = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf);
        buf
    });

    // prompt 走 stdin（argv 不加 prompt，绕开 cmd 引号转义）
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        if let Err(e) = stdin.write_all(prompt.as_bytes()) {
            return Err(format!("写入 prompt 失败：{e}"));
        }
    }

    // 轮询等待，超时树杀
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let mut timed_out = false;
    let wait_result = loop {
        match child.try_wait() {
            Ok(Some(_)) => break Ok(()),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    break Err("AI 生成超时，请重试或缩小问题范围".to_string());
                }
                thread::sleep(Duration::from_millis(200));
            }
            Err(e) => break Err(format!("等待子进程失败：{e}")),
        }
    };

    // 超时/错误：树杀子进程
    if let Err(msg) = wait_result {
        if let Ok(mut inner) = state.0.lock() {
            if let Some(pid) = inner.pid.take() {
                let _ = kill_by_pid(pid);
            }
        }
        return Err(msg);
    }
    if timed_out {
        if let Ok(mut inner) = state.0.lock() {
            if let Some(pid) = inner.pid.take() {
                let _ = kill_by_pid(pid);
            }
        }
        return Err("AI 生成超时".to_string());
    }

    let stdout = out_handle.join().unwrap_or_default();
    let stderr = err_handle.join().unwrap_or_default();

    parse_result(&stdout).map_err(|e| {
        // stdout 不可解析时，把 stderr 尾部作为诊断信息
        let tail = stderr.trim();
        let tail = tail
            .chars()
            .rev()
            .take(300)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();
        let tail = tail.trim();
        if !tail.is_empty() {
            format!("{e}（stderr: {tail}）")
        } else {
            e
        }
    })
}

/// 去掉可能的 ```json 代码围栏
fn strip_fences(s: &str) -> &str {
    let s = s.trim();
    if let Some(r) = s.strip_prefix("```json").or_else(|| s.strip_prefix("```")) {
        r.strip_suffix("```").unwrap_or(r).trim()
    } else {
        s
    }
}

/// 解析 `claude -p --output-format json` 的输出，返回 result 字段文本。
/// 输出为逐行 JSON 事件流，最后一个是 type=result 的事件。
pub fn parse_result(stdout: &str) -> Result<String, String> {
    // 逐行扫描（正常输出格式）
    for line in stdout.lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                let result = v
                    .get("result")
                    .and_then(|r| r.as_str())
                    .ok_or_else(|| "Claude 输出缺少 result 字段".to_string())?;
                if v.get("subtype").and_then(|t| t.as_str()) == Some("error_result") {
                    return Err(result.to_string());
                }
                return Ok(result.to_string());
            }
        }
    }
    // 整段解析兜底（模型偶发包裹围栏或 pretty 输出）
    let whole = strip_fences(stdout);
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(whole) {
        if let Some(result) = v.get("result").and_then(|r| r.as_str()) {
            return Ok(result.to_string());
        }
    }
    Err("无法解析 Claude 输出（请确认已登录 Claude Code，或在终端执行 `claude` 完成一次登录）".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_line_json() {
        let out = r#"{"type":"result","subtype":"success","result":"你好，我是助手","session_id":"abc","usage":{"input_tokens":10}}"#;
        assert_eq!(parse_result(out).unwrap(), "你好，我是助手");
    }

    #[test]
    fn parse_error_result() {
        let out = r#"{"type":"result","subtype":"error_result","result":"出错了"}"#;
        assert!(parse_result(out).is_err());
    }

    #[test]
    fn parse_with_fences() {
        let out = "```json\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"{\\\"a\\\":1}\"}\n```";
        assert_eq!(parse_result(out).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn parse_garbage() {
        assert!(parse_result("这不是 JSON").is_err());
        assert!(parse_result("").is_err());
    }

    #[test]
    fn parse_stdout_events_stream() {
        // 流式事件：前面是辅助消息，最后是 result
        let out = "{\"type\":\"system\",\"subtype\":\"init\"}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"ok\"}\n";
        assert_eq!(parse_result(out).unwrap(), "ok");
    }

    #[test]
    fn strip_fences_variants() {
        assert_eq!(strip_fences("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_fences("```\nhi\n```"), "hi");
        assert_eq!(strip_fences("plain"), "plain");
    }
}
