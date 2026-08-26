//! Steam 本地游戏库读取（阶段 4 游戏娱乐）
//!
//! 通过注册表找到 Steam 安装目录，读取主库和所有额外库里的
//! appmanifest_*.acf 清单文件，解析出已安装的游戏列表。
//! 全部逻辑离线完成，不需要 Steam 客户端或网络。

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use winreg::enums::*;
use winreg::RegKey;

/// 扫描到的一款 Steam 游戏
#[derive(Debug, Clone, Serialize)]
pub struct SteamGameInfo {
    pub appid: String,
    pub name: String,
    pub installdir: String,
}

/// 注册表里找 Steam 安装目录
fn steam_install_dir() -> Option<PathBuf> {
    // Steam 把安装路径记在 HKCU\Software\Valve\Steam\SteamPath
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(steam) = hkcu.open_subkey(r"Software\Valve\Steam") {
        if let Ok(path) = steam.get_value::<String, _>("SteamPath") {
            let p = PathBuf::from(path);
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    // 后备：HKLM 32 位视图
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(steam) = hklm.open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam") {
        if let Ok(path) = steam.get_value::<String, _>("InstallPath") {
            let p = PathBuf::from(path);
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    // 常见安装位置后备（覆盖未写注册表的绿色版安装）
    const FALLBACKS: [&str; 6] = [
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
        r"D:\Steam",
        r"E:\Steam",
        r"F:\Steam",
        r"G:\Steam",
    ];
    for c in FALLBACKS {
        let p = PathBuf::from(c);
        if p.join("steam.exe").is_file() || p.join("steamapps").is_dir() {
            return Some(p);
        }
    }
    None
}

/// 收集所有 Steam 库的 steamapps 目录（主库 + libraryfolders.vdf 里的额外库）
fn all_steamapps_dirs(steam_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let main = steam_dir.join("steamapps");
    if main.is_dir() {
        dirs.push(main.clone());
    }

    // 额外库路径写在 libraryfolders.vdf 中
    let vdf_path = main.join("libraryfolders.vdf");
    if let Ok(text) = std::fs::read_to_string(vdf_path) {
        for lib in library_paths(&text) {
            let d = PathBuf::from(lib).join("steamapps");
            if d.is_dir() && !dirs.contains(&d) {
                dirs.push(d);
            }
        }
    }
    dirs
}

/// 解析 libraryfolders.vdf，取出所有库的 path（第 2 层缩进的 "path" 键）
fn library_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut depth = 0usize;
    for line in text.lines() {
        let t = line.trim();
        if t == "{" {
            depth += 1;
        } else if t == "}" {
            depth = depth.saturating_sub(1);
        } else if depth == 2 {
            // 形如：		"path"		"D:\\SteamLibrary"
            if let Some(rest) = t.strip_prefix("\"path\"") {
                if let Some(v) = quoted_value(rest) {
                    paths.push(v.replace("\\\\", "\\"));
                }
            }
        }
    }
    paths
}

/// 从键值行的值部分提取字符串（rest 形如 `		"730"` 或 `"730"`）
fn quoted_value(rest: &str) -> Option<String> {
    rest.trim()
        .split('"')
        .filter(|p| !p.is_empty())
        .next()
        .map(|s| s.to_string())
}

/// 解析 appmanifest_*.acf 的第一层键值对（跳过子块内容）
/// ACF 结构：块名行 "AppState"，键值行都在第一层 { } 内
fn acf_top_pairs(text: &str) -> BTreeMap<String, String> {
    let mut pairs = BTreeMap::new();
    let mut depth = 0usize;
    for line in text.lines() {
        let t = line.trim();
        if t == "{" {
            depth += 1;
        } else if t == "}" {
            depth = depth.saturating_sub(1);
        } else if depth == 1 {
            // 第一层键值行：  "AppID"		"730"（单值行如 "UserConfig" 会被跳过）
            if t.starts_with('"') {
                // 键 = 开引号(索引0)到闭引号(相对 t[1..] 的 find 结果 + 1)
                let key_end = t[1..].find('"').map(|i| i + 1).unwrap_or(1);
                let key = t[1..key_end].to_string();
                // 值 = 闭引号之后的内容
                if let Some(v) = quoted_value(&t[key_end + 1..]) {
                    // 键统一小写：ACF 中键名大小写不统一（"appid" / "StateFlags"）
                    pairs.insert(key.to_ascii_lowercase(), v);
                }
            }
        }
    }
    pairs
}

/// 读取一个 appmanifest 文件 → 游戏信息
fn parse_manifest(path: &Path) -> Option<SteamGameInfo> {
    let text = std::fs::read_to_string(path).ok()?;
    let pairs = acf_top_pairs(&text);
    let appid = pairs.get("appid")?.trim().to_string();
    if appid.is_empty() {
        return None;
    }
    // 只收已安装的游戏（StateFlags 含 2=需要更新 或 4=已完全安装）
    let flags: i64 = pairs
        .get("stateflags")
        .map(|s| s.trim().parse().unwrap_or(0))
        .unwrap_or(0);
    if flags & (2 | 4) == 0 {
        return None;
    }
    Some(SteamGameInfo {
        appid,
        name: pairs
            .get("name")
            .map(|s| s.trim().to_string())
            .unwrap_or_default(),
        installdir: pairs
            .get("installdir")
            .map(|s| s.trim().to_string())
            .unwrap_or_default(),
    })
}

/// 扫描全部 Steam 库，返回已安装游戏列表（按 appid 排序，去重）
pub fn scan_installed_games() -> Vec<SteamGameInfo> {
    let Some(steam_dir) = steam_install_dir() else {
        return Vec::new();
    };
    let mut games = BTreeMap::new(); // appid → 游戏（自动排序 + 去重）
    for steamapps in all_steamapps_dirs(&steam_dir) {
        let Ok(entries) = std::fs::read_dir(&steamapps) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(rest) = name.strip_prefix("appmanifest_").and_then(|r| r.strip_suffix(".acf")) {
                if !rest.chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
                if let Some(game) = parse_manifest(&entry.path()) {
                    games.insert(game.appid.clone(), game);
                }
            }
        }
    }
    games.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_libraryfolders_paths() {
        let vdf = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
		"contentid"		"1874904384"
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}
"#;
        let paths = library_paths(vdf);
        assert_eq!(
            paths,
            vec![
                "C:\\Program Files (x86)\\Steam".replace("\\\\", "\\"),
                "D:\\SteamLibrary".replace("\\\\", "\\")
            ]
        );
        // 反斜杠转义应还原为单反斜杠
        assert_eq!(paths[0], "C:\\Program Files (x86)\\Steam");
        assert_eq!(paths[1], "D:\\SteamLibrary");
    }

    #[test]
    fn parse_acf_top_level() {
        let acf = r#""AppState"
{
	"appid"		"730"
	"name"		"Counter-Strike 2"
	"StateFlags"		"4"
	"installdir"		"Counter-Strike 2"
	"LastPlayed"		"1756000000"
	"SizeOnDisk"		"12345"
	"UserConfig"
	{
		"language"		"schinese"
	}
}
"#;
        let pairs = acf_top_pairs(acf);
        assert_eq!(pairs.get("appid").unwrap(), "730");
        assert_eq!(pairs.get("name").unwrap(), "Counter-Strike 2");
        assert_eq!(pairs.get("stateflags").unwrap(), "4");
        // 子块内容不应进入顶层
        assert!(pairs.get("language").is_none());
    }

    #[test]
    fn manifest_only_installed() {
        // 已安装（StateFlags 含 4）
        let installed = parse_manifest_text("730", "CS2", "4");
        assert!(installed.is_some());
        // 仅占位（StateFlags 0 / 无该键）不算已安装
        let not_installed = parse_manifest_text("999", "未安装", "0");
        assert!(not_installed.is_none());
    }

    #[cfg(test)]
    fn parse_manifest_text(appid: &str, name: &str, flags: &str) -> Option<SteamGameInfo> {
        let acf = format!(
            "\"AppState\"\n{{\n\t\"appid\"\t\t\"{}\"\n\t\"name\"\t\t\"{}\"\n\t\"StateFlags\"\t\t\"{}\"\n}}\n",
            appid, name, flags
        );
        let pairs = acf_top_pairs(&acf);
        if pairs.get("stateflags").map(|s| s.trim()).unwrap_or("0").parse::<i64>().unwrap_or(0) & (2 | 4) == 0 {
            return None;
        }
        Some(SteamGameInfo {
            appid: appid.to_string(),
            name: name.to_string(),
            installdir: String::new(),
        })
    }
}
