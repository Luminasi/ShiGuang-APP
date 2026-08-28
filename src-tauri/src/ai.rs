//! AI 提供方抽象：本机 Claude Code CLI 与 OpenAI 兼容网关（API key 直连）统一入口。
//! 配置存 settings 表（ai.provider / ai.base_url / ai.api_key / ai.model），
//! 由「设置」界面维护；统一入口 run_ai_blocking 持有 AiState 忙锁并分派。

use std::collections::HashMap;
use std::time::Duration;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::claude_cli::{run_claude_inner, AiState};
use crate::commands::with_db;
use crate::db::DbState;

/// AI 提供方配置（读自 settings 表）
#[derive(Debug, Clone)]
pub struct AiConfig {
    /// "cli" | "openai"
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

/// 从 settings 表加载 AI 配置（调用方持锁，传 &Connection；缺省 provider=cli）
pub fn load_ai_config(conn: &Connection) -> rusqlite::Result<AiConfig> {
    const KEYS: [&str; 4] = ["ai.provider", "ai.base_url", "ai.api_key", "ai.model"];
    let mut m: HashMap<String, String> = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings WHERE key IN (?1, ?2, ?3, ?4)")
        .map_err(|e| rusqlite::Error::InvalidParameterName(format!("读取 AI 设置失败：{e}")))?;
    let rows = stmt
        .query_map(rusqlite::params![KEYS[0], KEYS[1], KEYS[2], KEYS[3]], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| rusqlite::Error::InvalidParameterName(format!("读取 AI 设置失败：{e}")))?;
    for row in rows {
        let (k, v) =
            row.map_err(|e| rusqlite::Error::InvalidParameterName(format!("读取 AI 设置失败：{e}")))?;
        m.insert(k, v);
    }
    Ok(AiConfig {
        provider: m
            .get("ai.provider")
            .cloned()
            .unwrap_or_else(|| "cli".to_string()),
        base_url: m.get("ai.base_url").cloned().unwrap_or_default(),
        api_key: m.get("ai.api_key").cloned().unwrap_or_default(),
        model: m.get("ai.model").cloned().unwrap_or_default(),
    })
}

/// 统一 AI 入口：忙锁（同一时间只允许一个 AI 调用）→ 按 provider 分派 → 释放。
/// 调用方应放在 spawn_blocking 中执行。
/// max_tokens 仅在测试连接时传 Some(小值)，真实调用传 None（交给网关默认）。
pub fn run_ai_blocking(
    state: &AiState,
    cfg: &AiConfig,
    prompt: &str,
    timeout_secs: u64,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    // 忙检查：占用直到本次调用结束
    {
        let mut inner = state.0.lock().map_err(|_| "AI 状态锁异常，请重试".to_string())?;
        if inner.busy {
            return Err("AI 正在生成中，请稍候…".to_string());
        }
        inner.busy = true;
    }

    let result = if cfg.provider == "openai" {
        openai_chat(cfg, prompt, timeout_secs, max_tokens)
    } else {
        run_claude_inner(state, prompt, timeout_secs)
    };

    // 结束：释放忙锁与子进程句柄（openai 路径 pid 恒为 None，kill_current 为 no-op）
    {
        let mut inner = state.0.lock().map_err(|_| "AI 状态锁异常".to_string())?;
        inner.busy = false;
        inner.pid = None;
    }
    result
}

/// OpenAI 兼容网关调用：POST {base_url}/chat/completions，Bearer 认证，同步等待完整输出
fn openai_chat(
    cfg: &AiConfig,
    prompt: &str,
    timeout_secs: u64,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    if cfg.api_key.is_empty() {
        return Err("未配置 API key，请到「设置」中填写".to_string());
    }
    if !(cfg.base_url.starts_with("http://") || cfg.base_url.starts_with("https://")) {
        return Err("[OpenAI] base_url 需以 http:// 或 https:// 开头".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("[OpenAI] 初始化 HTTP 客户端失败：{e}"))?;
    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));

    let mut body = json!({
        "model": cfg.model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": false,
    });
    if let Some(mt) = max_tokens {
        body["max_tokens"] = json!(mt);
    }

    let resp = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send()
        .map_err(map_reqwest_err)?;
    let status = resp.status();
    let text = resp.text().map_err(|e| format!("[OpenAI] 读取响应失败：{e}"))?;
    if !status.is_success() {
        return Err(map_http_error(status.as_u16(), &text));
    }
    extract_content(&text).map_err(|e| format!("[OpenAI] {e}"))
}

/// reqwest 层错误 → 友好中文
fn map_reqwest_err(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "[OpenAI] 请求超时：请检查网络或 base_url".to_string()
    } else if e.is_connect() {
        format!("[OpenAI] 无法连接网关：请检查 base_url 与网络（{e}）")
    } else {
        format!("[OpenAI] 网络错误：{e}")
    }
}

/// HTTP 状态码 → 友好中文（附 body 片段便于排查）
fn map_http_error(code: u16, body: &str) -> String {
    let snippet = body.chars().take(200).collect::<String>();
    match code {
        401 => "[OpenAI] API key 无效或已过期（401）：请到「设置」检查密钥".to_string(),
        403 => "[OpenAI] 网关拒绝访问，密钥无权限（403）".to_string(),
        404 => "[OpenAI] 接口不存在（404）：请检查 base_url 是否完整（应形如 https://api.example.com/v1）".to_string(),
        408 => "[OpenAI] 网关超时（408）".to_string(),
        429 => "[OpenAI] 请求过于频繁或配额用尽（429）：请稍后再试或检查账户额度".to_string(),
        500..=599 => format!("[OpenAI] 网关服务异常（{code}）：{snippet}"),
        _ => format!("[OpenAI] 请求失败（{code}）：{snippet}"),
    }
}

/// 解析 chat/completions 响应的 choices[0].message.content
/// 兼容两种形状：字符串，或 [{type:"text", text:"..."}]（部分网关）
fn extract_content(text: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("网关响应不是合法 JSON：{e}"))?;
    let content = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .ok_or_else(|| "网关响应缺少 choices[0].message.content，可能不是标准 OpenAI 兼容接口".to_string())?;
    match content {
        serde_json::Value::String(s) => Ok(s.clone()),
        serde_json::Value::Array(arr) => {
            let mut out = String::new();
            for item in arr {
                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                    out.push_str(t);
                }
            }
            if out.is_empty() {
                Err("网关响应 content 数组为空".to_string())
            } else {
                Ok(out)
            }
        }
        _ => Err("网关响应 content 类型异常（应为字符串或文本数组）".to_string()),
    }
}

/// API key 末 4 位（打码展示用；过短则原样返回）
fn last4(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 4 {
        s.to_string()
    } else {
        chars[chars.len() - 4..].iter().collect()
    }
}

// ---------- 设置命令 ----------

/// 设置回显（不回传完整 key，仅末 4 位）
#[derive(Serialize)]
pub struct AiSettingsView {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
    pub api_key_tail: String,
}

/// 设置写入（api_key 为 None 或空 = 不修改）
#[derive(Deserialize, Clone)]
pub struct AiSettingsInput {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn get_ai_settings(state: State<'_, DbState>) -> Result<AiSettingsView, String> {
    let cfg = with_db(state, |conn| load_ai_config(conn)).await?;
    Ok(AiSettingsView {
        has_api_key: !cfg.api_key.is_empty(),
        api_key_tail: last4(&cfg.api_key),
        provider: cfg.provider,
        base_url: cfg.base_url,
        model: cfg.model,
    })
}

#[tauri::command]
pub async fn set_ai_settings(
    state: State<'_, DbState>,
    input: AiSettingsInput,
) -> Result<(), String> {
    if input.provider != "cli" && input.provider != "openai" {
        return Err("未知的 AI 提供方".to_string());
    }
    if input.provider == "openai" {
        if input.base_url.trim().is_empty() {
            return Err("请填写网关地址（base_url）".to_string());
        }
        if input.model.trim().is_empty() {
            return Err("请填写模型名称".to_string());
        }
    }
    with_db(state, move |conn| {
        let set = |conn: &Connection, k: &str, v: &str| -> rusqlite::Result<()> {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![k, v],
            )?;
            Ok(())
        };
        set(conn, "ai.provider", &input.provider)?;
        set(conn, "ai.base_url", input.base_url.trim())?;
        set(conn, "ai.model", input.model.trim())?;
        if let Some(k) = &input.api_key {
            let k = k.trim();
            if !k.is_empty() {
                set(conn, "ai.api_key", k)?;
            }
        }
        Ok(())
    })
    .await
}

/// 测试连接：复用统一入口（busy 锁语义一致），草稿参数覆盖库中配置，未保存也能测
#[tauri::command]
pub async fn test_ai_connection(
    state: State<'_, DbState>,
    ai_state: State<'_, AiState>,
    input: AiSettingsInput,
) -> Result<String, String> {
    if input.provider != "cli" && input.provider != "openai" {
        return Err("未知的 AI 提供方".to_string());
    }
    let ai = AiState(ai_state.0.clone());

    // 库中已存配置为底，草稿的 key 优先覆盖
    let base = with_db(state, |conn| load_ai_config(conn)).await?;
    let mut cfg = AiConfig {
        provider: input.provider,
        base_url: input.base_url.trim().to_string(),
        model: input.model.trim().to_string(),
        api_key: base.api_key,
    };
    if let Some(k) = &input.api_key {
        let k = k.trim();
        if !k.is_empty() {
            cfg.api_key = k.to_string();
        }
    }

    if cfg.provider == "openai" {
        if cfg.base_url.is_empty() {
            return Err("请先填写网关地址（base_url）".to_string());
        }
        if cfg.model.is_empty() {
            return Err("请先填写模型名称".to_string());
        }
    }

    let reply = tauri::async_runtime::spawn_blocking(move || {
        // max_tokens=8：最小请求，一次调用成本可忽略
        run_ai_blocking(&ai, &cfg, "只回复 OK 两个字", 30, Some(8))
    })
    .await
    .map_err(|e| format!("测试连接失败：{e}"))??;

    let first = reply.chars().take(50).collect::<String>();
    Ok(format!("连接成功，模型回复：{first}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate_for_tests;
    use std::io::{Read, Write};

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate_for_tests(&conn).unwrap();
        conn
    }

    fn cfg(provider: &str, base_url: &str, key: &str, model: &str) -> AiConfig {
        AiConfig {
            provider: provider.to_string(),
            base_url: base_url.to_string(),
            api_key: key.to_string(),
            model: model.to_string(),
        }
    }

    #[test]
    fn load_config_defaults() {
        let conn = test_db();
        let c = load_ai_config(&conn).unwrap();
        assert_eq!(c.provider, "cli");
        assert!(c.base_url.is_empty() && c.api_key.is_empty() && c.model.is_empty());
    }

    #[test]
    fn load_config_roundtrip() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('ai.provider','openai'),('ai.base_url','https://api.test.com/v1'),('ai.api_key','sk-abcdef123456'),('ai.model','deepseek-chat')",
            [],
        )
        .unwrap();
        let c = load_ai_config(&conn).unwrap();
        assert_eq!(c.provider, "openai");
        assert_eq!(c.base_url, "https://api.test.com/v1");
        assert_eq!(c.api_key, "sk-abcdef123456");
        assert_eq!(c.model, "deepseek-chat");
    }

    #[test]
    fn extract_content_variants() {
        // 字符串 content
        let s = r#"{"choices":[{"message":{"content":"你好"}}]}"#;
        assert_eq!(extract_content(s).unwrap(), "你好");
        // 数组型 content（部分网关分段）
        let arr = r#"{"choices":[{"message":{"content":[{"type":"text","text":"A"},{"type":"text","text":"B"}]}}]}"#;
        assert_eq!(extract_content(arr).unwrap(), "AB");
        // content 为 null
        let nul = r#"{"choices":[{"message":{"content":null}}]}"#;
        assert!(extract_content(nul).is_err());
        // 缺字段
        assert!(extract_content(r#"{"choices":[]}"#).is_err());
        // 非 JSON
        assert!(extract_content("oops").is_err());
    }

    #[test]
    fn map_http_error_table() {
        let body = r#"{"error":{"message":"bad"}}"#;
        assert!(map_http_error(401, body).contains("API key 无效"));
        assert!(map_http_error(403, body).contains("403"));
        assert!(map_http_error(404, body).contains("base_url"));
        assert!(map_http_error(429, body).contains("429"));
        assert!(map_http_error(500, body).contains("网关服务异常"));
        assert!(map_http_error(400, body).contains("400"));
    }

    #[test]
    fn openai_chat_connect_refused() {
        // 127.0.0.1:1 无服务 → 连接失败，错误含「无法连接网关」
        let c = cfg("openai", "http://127.0.0.1:1", "sk-x", "m");
        let e = openai_chat(&c, "hi", 5, None).unwrap_err();
        assert!(e.contains("无法连接网关"), "实际: {e}");
    }

    #[test]
    fn openai_chat_mock_server() {
        // 本地 mock 网关：验证 URL 拼接与 Bearer 头，200 与 401 两种响应
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = sock.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let (path, auth, body) = {
                let first = req.lines().next().unwrap_or("").to_string();
                let auth = req
                    .lines()
                    .find(|l| l.to_lowercase().starts_with("authorization:"))
                    .unwrap_or("")
                    .to_string();
                let body = req.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
                (first, auth, body)
            };
            assert!(path.contains("/v1/chat/completions"), "path: {path}");
            assert!(auth.contains("Bearer sk-test-key"), "auth: {auth}");
            assert!(body.contains("\"stream\":false"), "body: {body}");

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                r#"{"choices":[{"message":{"content":"OK，收到"}}]}"#.len(),
                r#"{"choices":[{"message":{"content":"OK，收到"}}]}"#
            );
            sock.write_all(resp.as_bytes()).unwrap();
        });

        let c = cfg("openai", &format!("http://127.0.0.1:{port}/v1"), "sk-test-key", "test-model");
        let out = openai_chat(&c, "hi", 10, None).unwrap();
        assert_eq!(out, "OK，收到");
        handle.join().unwrap();
    }

    #[test]
    fn openai_chat_rejects_401() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf).unwrap();
            let body = r#"{"error":{"message":"Invalid API key"}}"#;
            let resp = format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            sock.write_all(resp.as_bytes()).unwrap();
        });

        let c = cfg("openai", &format!("http://127.0.0.1:{port}/v1"), "sk-bad", "m");
        let e = openai_chat(&c, "hi", 10, None).unwrap_err();
        assert!(e.contains("API key 无效"), "实际: {e}");
        handle.join().unwrap();
    }

    #[test]
    fn run_ai_blocking_busy_and_release() {
        // busy 预置：拒绝且锁不误释放
        let st = AiState::new();
        {
            let mut inner = st.0.lock().unwrap();
            inner.busy = true;
        }
        let c = cfg("openai", "http://127.0.0.1:1", "sk-x", "m");
        let e = run_ai_blocking(&st, &c, "hi", 5, None).unwrap_err();
        assert!(e.contains("AI 正在生成中"), "实际: {e}");
        {
            let inner = st.0.lock().unwrap();
            assert!(inner.busy, "busy 不应被误释放");
        }

        // 空闲 + 连接失败：结束后 busy 必须释放
        {
            let mut inner = st.0.lock().unwrap();
            inner.busy = false;
        }
        let e = run_ai_blocking(&st, &c, "hi", 5, None).unwrap_err();
        assert!(e.contains("无法连接网关"), "实际: {e}");
        let inner = st.0.lock().unwrap();
        assert!(!inner.busy, "调用结束后 busy 应释放");
        assert!(inner.pid.is_none());
    }
}
