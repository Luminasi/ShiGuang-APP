//! ccswitch —— 开发时按任务一键切换 Claude Code 模型（OpenCode Go 套餐）。
//!
//! 独立命令行工具，与时光应用本体零耦合：配置存 `%USERPROFILE%\.claude\ccswitch.json`，
//! 切换即改写 `%USERPROFILE%\.claude\settings.json` 的 env 块，把 Claude Code 指向
//! OpenCode Zen Go 网关（Anthropic Messages 协议兼容）的对应档位模型；对新开会话生效。
//!
//! 用法：
//!   ccswitch                     查看当前状态
//!   ccswitch eco                 切到省钱档（搭框架 / 日常问答 / 批量小任务）
//!   ccswitch power               切到强力档（复杂业务逻辑 / 难题攻坚）
//!   ccswitch change <模型名>     直接切到指定模型（不走两档）
//!   ccswitch off                 还原官方 Claude 配置
//!   ccswitch key <API_KEY>       保存 Go 套餐 API key
//!   ccswitch set <eco|power> <模型名>   为某档选定模型
//!   ccswitch models              列出 Go 套餐可用模型
//!   ccswitch test <eco|power>    测试某档连通性
//!
//! 构建：cargo build --release --bin ccswitch（产物 target/release/ccswitch.exe）

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const ZEN_GO_BASE: &str = "https://opencode.ai/zen/go";
const MODELS_URL: &str = "https://opencode.ai/zen/go/v1/models";
const HTTP_TIMEOUT_SECS: u64 = 30;

// ---------- 配置（~/.claude/ccswitch.json） ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    api_key: String,
    eco_model: String,
    power_model: String,
    /// 当前生效档位："off" | "eco" | "power" | "custom"
    profile: String,
    /// profile=custom 时直选的模型名
    custom_model: String,
    /// 首次切换时原 settings.json 是否存在（决定还原行为）
    had_settings: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            eco_model: String::new(),
            power_model: String::new(),
            profile: "off".into(),
            custom_model: String::new(),
            had_settings: false,
        }
    }
}

fn claude_dir() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "无法定位用户主目录（USERPROFILE）".to_string())?;
    Ok(PathBuf::from(home).join(".claude"))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("ccswitch.json"))
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("settings.json"))
}

fn backup_path() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("settings.json.shiguang-bak"))
}

fn load_config() -> Result<Config, String> {
    let path = config_path()?;
    match std::fs::read_to_string(&path) {
        Ok(text) if !text.trim().is_empty() => serde_json::from_str(&text)
            .map_err(|e| format!("配置文件损坏（{}）：{e}", path.display())),
        _ => Ok(Config::default()),
    }
}

fn save_config(cfg: &Config) -> Result<(), String> {
    let path = config_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建 .claude 目录失败：{e}"))?;
    }
    let out = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败：{e}"))?;
    std::fs::write(&path, out).map_err(|e| format!("写入配置失败：{e}"))
}

// ---------- settings.json 改写核心 ----------

/// 把某档位的网关 env 写进 settings.json 的 JSON Value（纯函数，便于测试）
fn apply_env(v: &mut Value, api_key: &str, model: &str) {
    if !v.is_object() {
        *v = json!({});
    }
    let obj = v.as_object_mut().unwrap();
    let env = obj.entry("env").or_insert_with(|| json!({}));
    if !env.is_object() {
        *env = json!({});
    }
    let env = env.as_object_mut().unwrap();
    env.insert("ANTHROPIC_BASE_URL".into(), json!(ZEN_GO_BASE));
    env.insert("ANTHROPIC_AUTH_TOKEN".into(), json!(api_key));
    env.insert("ANTHROPIC_MODEL".into(), json!(model));
    // 三级默认模型全部映射过去，子代理/后台任务也走同一档位
    env.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".into(), json!(model));
    env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".into(), json!(model));
    env.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".into(), json!(model));
    // 顶层 model 一并指定（Claude Code 启动默认模型）
    obj.insert("model".into(), json!(model));
}

/// 切换/还原的核心文件操作（路径参数化，便于测试）：
/// - apply=true：无备份则先备份原文件，然后写入网关 env；返回"原文件切换前是否存在"
/// - apply=false：有备份则覆盖还原；无备份且原本不存在则删除我们生成的文件
fn write_settings_at(
    path: &Path,
    backup: &Path,
    apply: bool,
    api_key: &str,
    model: &str,
    had_settings: bool,
) -> Result<bool, String> {
    if apply {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("创建 .claude 目录失败：{e}"))?;
        }
        // 原文件是否存在（必须在备份/写入前判断）
        let existed_before = path.exists();
        // 先读原 JSON（损坏则中止，零副作用：不备份也不覆盖）
        let mut root = match std::fs::read_to_string(path) {
            Ok(text) if !text.trim().is_empty() => serde_json::from_str::<Value>(&text)
                .map_err(|e| format!("settings.json 不是合法 JSON，已中止（请手动检查该文件）：{e}"))?,
            _ => json!({}),
        };
        // 首次切换：备份原文件
        if !backup.exists() && existed_before {
            std::fs::copy(path, backup).map_err(|e| format!("备份原配置失败：{e}"))?;
        }
        apply_env(&mut root, api_key, model);
        let out = serde_json::to_string_pretty(&root).map_err(|e| format!("序列化失败：{e}"))?;
        std::fs::write(path, out).map_err(|e| format!("写入 settings.json 失败：{e}"))?;
        Ok(existed_before)
    } else {
        // 还原官方
        if backup.exists() {
            std::fs::copy(backup, path).map_err(|e| format!("还原备份失败：{e}"))?;
        } else if !had_settings && path.exists() {
            // 原本没有 settings.json，删掉我们生成的
            let _ = std::fs::remove_file(path);
        }
        Ok(had_settings)
    }
}

// ---------- HTTP ----------

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))
}

/// 拉取 Go 套餐可用模型列表（公开接口，无需 key）
fn fetch_models() -> Result<Vec<String>, String> {
    let client = http_client()?;
    let resp = client
        .get(MODELS_URL)
        .send()
        .map_err(|e| format!("拉取模型列表失败：{e}"))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| format!("读取响应失败：{e}"))?;
    if !status.is_success() {
        return Err(format!(
            "拉取模型列表失败（{status}）：{}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("响应不是合法 JSON：{e}"))?;
    let mut out: Vec<String> = v
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    if out.is_empty() {
        return Err("模型列表为空，接口返回结构可能已变化".to_string());
    }
    Ok(out)
}

/// Anthropic Messages 协议最小请求：POST {base}/v1/messages，x-api-key 鉴权
fn anthropic_ping(api_key: &str, model: &str) -> Result<String, String> {
    let client = http_client()?;
    let url = format!("{ZEN_GO_BASE}/v1/messages");
    let body = json!({
        "model": model,
        "max_tokens": 8,
        "messages": [{"role": "user", "content": "只回复 OK"}],
    });
    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时：请检查网络".to_string()
            } else {
                format!("网络错误：{e}")
            }
        })?;
    let status = resp.status();
    let text = resp.text().map_err(|e| format!("读取响应失败：{e}"))?;
    if !status.is_success() {
        let snippet: String = text.chars().take(200).collect();
        return Err(match status.as_u16() {
            401 => format!("API key 无效或已过期（401）：{snippet}"),
            404 => format!("接口不存在（404）：{snippet}"),
            429 => format!("请求过于频繁或额度用尽（429）：{snippet}"),
            c => format!("请求失败（{c}）：{snippet}"),
        });
    }
    parse_content(&text).map_err(|e| format!("响应解析失败：{e}"))
}

/// 解析 Anthropic 响应的 content（字符串或 [{type:"text",text:"..."}]）
fn parse_content(text: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("不是合法 JSON：{e}"))?;
    if let Some(err) = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
        return Err(err.to_string());
    }
    let content = v
        .get("content")
        .ok_or_else(|| "响应缺少 content 字段".to_string())?;
    match content {
        Value::String(s) => Ok(s.clone()),
        Value::Array(arr) => {
            let mut out = String::new();
            for item in arr {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                        out.push_str(t);
                    }
                }
            }
            if out.is_empty() {
                Err("content 数组为空".to_string())
            } else {
                Ok(out)
            }
        }
        _ => Err("content 类型异常".to_string()),
    }
}

/// key 末 4 位（打码展示；过短原样返回）
fn last4(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 4 {
        s.to_string()
    } else {
        chars[chars.len() - 4..].iter().collect()
    }
}

// ---------- 子命令 ----------

fn cmd_status() -> Result<(), String> {
    let cfg = load_config()?;
    let backup_exists = backup_path().map(|p| p.exists()).unwrap_or(false);
    let profile_name = match cfg.profile.as_str() {
        "eco" => "省钱档",
        "power" => "强力档",
        "custom" => "直选模型",
        _ => "官方（未切换）",
    };
    println!("ccswitch 当前状态");
    if cfg.profile == "custom" {
        println!("  生效档位：{}（{}：{}）", cfg.profile, profile_name, cfg.custom_model);
    } else {
        println!("  生效档位：{}（{}）", cfg.profile, profile_name);
    }
    if cfg.api_key.is_empty() {
        println!("  API key：未保存（先执行 ccswitch key <你的key>）");
    } else {
        println!("  API key：已保存（末 4 位 {}）", last4(&cfg.api_key));
    }
    println!(
        "  省钱档模型：{}",
        if cfg.eco_model.is_empty() { "未选择".into() } else { cfg.eco_model.clone() }
    );
    println!(
        "  强力档模型：{}",
        if cfg.power_model.is_empty() { "未选择".into() } else { cfg.power_model.clone() }
    );
    println!("  官方配置备份：{}", if backup_exists { "有（可 ccswitch off 还原）" } else { "无" });
    Ok(())
}

fn cmd_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("API key 不能为空".to_string());
    }
    let mut cfg = load_config()?;
    cfg.api_key = key.to_string();
    save_config(&cfg)?;
    println!("API key 已保存（末 4 位 {}）", last4(key));
    Ok(())
}

fn cmd_set(profile: &str, model: &str) -> Result<(), String> {
    if profile != "eco" && profile != "power" {
        return Err("档位只能是 eco 或 power".to_string());
    }
    let model = model.trim();
    if model.is_empty() {
        return Err("模型名不能为空".to_string());
    }
    let mut cfg = load_config()?;
    if profile == "eco" {
        cfg.eco_model = model.to_string();
    } else {
        cfg.power_model = model.to_string();
    }
    save_config(&cfg)?;
    let name = if profile == "eco" { "省钱档" } else { "强力档" };
    println!("{name}模型已设为 {model}");
    // 若当前正生效该档位，提示需要重新切换才能应用新模型
    if cfg.profile == profile {
        println!("提示：当前正生效该档位，执行 ccswitch {profile} 让新模型生效");
    }
    Ok(())
}

fn cmd_apply(profile: &str) -> Result<(), String> {
    if profile != "eco" && profile != "power" && profile != "off" {
        return Err("档位只能是 eco / power / off".to_string());
    }
    let mut cfg = load_config()?;

    let (api_key, model) = if profile == "off" {
        (String::new(), String::new())
    } else {
        if cfg.api_key.is_empty() {
            return Err("请先保存 API key：ccswitch key <你的key>".to_string());
        }
        let m = if profile == "eco" { &cfg.eco_model } else { &cfg.power_model };
        if m.is_empty() {
            let name = if profile == "eco" { "省钱档" } else { "强力档" };
            return Err(format!(
                "请先为{name}选择模型：ccswitch models 查看，ccswitch set {profile} <模型名> 选定"
            ));
        }
        (cfg.api_key.clone(), m.clone())
    };

    let path = settings_path()?;
    let backup = backup_path()?;
    let existed_before = write_settings_at(&path, &backup, profile != "off", &api_key, &model, cfg.had_settings)?;

    // had_settings 只在第一次从 off 切走时记录一次（供还原判断）
    if profile != "off" && cfg.profile == "off" {
        cfg.had_settings = existed_before;
    }
    cfg.profile = profile.to_string();
    save_config(&cfg)?;

    match profile {
        "eco" => println!("已切换到省钱档（{model}），新开的 Claude Code 会话生效"),
        "power" => println!("已切换到强力档（{model}），新开的 Claude Code 会话生效"),
        _ => println!("已还原官方 Claude 配置，新开的会话生效"),
    }
    Ok(())
}

/// 直选切换：不走两档，直接把 Claude Code 指向指定模型
fn cmd_change(model: &str) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("模型名不能为空".to_string());
    }
    let mut cfg = load_config()?;
    if cfg.api_key.is_empty() {
        return Err("请先保存 API key：ccswitch key <你的key>".to_string());
    }

    let path = settings_path()?;
    let backup = backup_path()?;
    let existed_before =
        write_settings_at(&path, &backup, true, &cfg.api_key, model, cfg.had_settings)?;

    // had_settings 只在第一次从 off 切走时记录一次（供还原判断）
    if cfg.profile == "off" {
        cfg.had_settings = existed_before;
    }
    cfg.profile = "custom".to_string();
    cfg.custom_model = model.to_string();
    save_config(&cfg)?;

    println!("已切换到模型 {model}，新开的 Claude Code 会话生效");
    Ok(())
}

fn cmd_models() -> Result<(), String> {
    println!("正在拉取 Go 套餐可用模型列表...");
    let models = fetch_models()?;
    println!("共 {} 个可用模型：", models.len());
    for m in &models {
        println!("  {m}");
    }
    println!();
    println!("选定模型：ccswitch set eco <模型名>  /  ccswitch set power <模型名>");
    Ok(())
}

fn cmd_test(profile: &str) -> Result<(), String> {
    if profile != "eco" && profile != "power" {
        return Err("档位只能是 eco 或 power".to_string());
    }
    let cfg = load_config()?;
    if cfg.api_key.is_empty() {
        return Err("请先保存 API key：ccswitch key <你的key>".to_string());
    }
    let model = if profile == "eco" { cfg.eco_model.clone() } else { cfg.power_model.clone() };
    if model.is_empty() {
        let name = if profile == "eco" { "省钱档" } else { "强力档" };
        return Err(format!("请先为{name}选择模型：ccswitch set {profile} <模型名>"));
    }
    println!("正在测试 {model} 连通性...");
    let reply = anthropic_ping(&cfg.api_key, &model)?;
    let first: String = reply.chars().take(50).collect();
    println!("连接成功（{model}），回复：{first}");
    Ok(())
}

fn usage() {
    println!(
        "ccswitch —— 开发时按任务一键切换 Claude Code 模型（OpenCode Go 套餐）

用法：
  ccswitch                          查看当前状态
  ccswitch eco                      切到省钱档（搭框架 / 日常问答 / 批量小任务）
  ccswitch power                    切到强力档（复杂业务逻辑 / 难题攻坚）
  ccswitch change <模型名>          直接切到指定模型（不走两档）
  ccswitch off                      还原官方 Claude 配置
  ccswitch key <API_KEY>            保存 Go 套餐 API key（opencode.ai/auth 获取）
  ccswitch set <eco|power> <模型名> 为某档选定模型
  ccswitch models                   列出 Go 套餐可用模型
  ccswitch test <eco|power>         测试某档连通性

切换对新开的 Claude Code 会话生效；首次切换自动备份原配置，ccswitch off 可还原。"
    );
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(|s| s.as_str()) {
        None => cmd_status(),
        Some("eco") | Some("power") | Some("off") => cmd_apply(&args[0]),
        Some("status") => cmd_status(),
        Some("key") => match args.get(1) {
            Some(k) => cmd_key(k),
            None => Err("用法：ccswitch key <API_KEY>".to_string()),
        },
        Some("set") => match (args.get(1), args.get(2)) {
            (Some(p), Some(m)) => cmd_set(p, m),
            _ => Err("用法：ccswitch set <eco|power> <模型名>".to_string()),
        },
        Some("change") => match args.get(1) {
            Some(m) => cmd_change(m),
            None => Err("用法：ccswitch change <模型名>".to_string()),
        },
        Some("models") => cmd_models(),
        Some("test") => match args.get(1) {
            Some(p) => cmd_test(p),
            None => Err("用法：ccswitch test <eco|power>".to_string()),
        },
        Some("help") | Some("--help") | Some("-h") => {
            usage();
            Ok(())
        }
        Some(unknown) => {
            usage();
            Err(format!("未知命令：{unknown}"))
        }
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("错误：{e}");
            ExitCode::FAILURE
        }
    }
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_env_inserts_all_keys() {
        let mut v = json!({});
        apply_env(&mut v, "sk-abc", "kimi-k3");
        let env = v.get("env").unwrap();
        assert_eq!(env.get("ANTHROPIC_BASE_URL").unwrap(), ZEN_GO_BASE);
        assert_eq!(env.get("ANTHROPIC_AUTH_TOKEN").unwrap(), "sk-abc");
        assert_eq!(env.get("ANTHROPIC_MODEL").unwrap(), "kimi-k3");
        assert_eq!(env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").unwrap(), "kimi-k3");
        assert_eq!(env.get("ANTHROPIC_DEFAULT_OPUS_MODEL").unwrap(), "kimi-k3");
        assert_eq!(env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL").unwrap(), "kimi-k3");
        assert_eq!(v.get("model").unwrap(), "kimi-k3");
    }

    #[test]
    fn apply_env_preserves_existing_config() {
        let mut v = json!({"permissions": {"allow": ["Bash"]}, "env": {"FOO": "bar"}});
        apply_env(&mut v, "sk-x", "glm-5.2");
        assert_eq!(v["permissions"]["allow"][0], "Bash");
        assert_eq!(v["env"]["FOO"], "bar");
        assert_eq!(v["env"]["ANTHROPIC_MODEL"], "glm-5.2");
    }

    #[test]
    fn apply_env_repairs_bad_env() {
        let mut v = json!({"env": "garbage"});
        apply_env(&mut v, "sk-x", "m");
        assert_eq!(v["env"]["ANTHROPIC_MODEL"], "m");
    }

    #[test]
    fn parse_content_variants() {
        let s = r#"{"content":[{"type":"text","text":"OK"}]}"#;
        assert_eq!(parse_content(s).unwrap(), "OK");
        let s2 = r#"{"content":"OK"}"#;
        assert_eq!(parse_content(s2).unwrap(), "OK");
        let e = r#"{"error":{"message":"模型不存在"}}"#;
        assert!(parse_content(e).unwrap_err().contains("模型不存在"));
        assert!(parse_content(r#"{"choices":[]}"#).is_err());
        assert!(parse_content("not json").is_err());
    }

    #[test]
    fn last4_masking() {
        assert_eq!(last4("sk-12345678"), "5678");
        assert_eq!(last4("abc"), "abc");
    }

    #[test]
    fn write_settings_apply_backup_and_restore() {
        let dir = std::env::temp_dir().join(format!("ccswitch-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let backup = dir.join("settings.json.shiguang-bak");
        let original = r#"{"model":"claude-sonnet","env":{"FOO":"1"}}"#;
        std::fs::write(&path, original).unwrap();

        // 应用：原文件被备份，env 被改写，已有配置保留
        let existed = write_settings_at(&path, &backup, true, "sk-t", "kimi-k3", false).unwrap();
        assert!(existed);
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        let after: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["env"]["ANTHROPIC_MODEL"], "kimi-k3");
        assert_eq!(after["env"]["FOO"], "1");

        // 还原：备份覆盖回原文件
        write_settings_at(&path, &backup, false, "", "", true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_settings_create_when_missing() {
        let dir = std::env::temp_dir().join(format!("ccswitch-test-new-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let backup = dir.join("settings.json.shiguang-bak");

        // 原文件不存在：应用生成新文件（无备份），还原时删除
        let existed = write_settings_at(&path, &backup, true, "sk-t", "glm-5.2", false).unwrap();
        assert!(!existed);
        assert!(!backup.exists());
        assert!(path.exists());
        write_settings_at(&path, &backup, false, "", "", false).unwrap();
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_settings_aborts_on_invalid_json() {
        let dir = std::env::temp_dir().join(format!("ccswitch-test-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let backup = dir.join("settings.json.shiguang-bak");
        std::fs::write(&path, "{ broken json").unwrap();

        // 非法 JSON：报错且不产生备份、不覆盖原文件
        assert!(write_settings_at(&path, &backup, true, "sk-t", "m", false).is_err());
        assert!(!backup.exists());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ broken json");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
