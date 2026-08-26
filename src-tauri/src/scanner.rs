//! 本机已安装程序扫描（阶段 4 游戏娱乐）
//!
//! 枚举注册表 Uninstall 键（HKLM 32/64 位 + HKCU），列出已安装程序，
//! 由用户在界面上勾选确认哪些是游戏后导入游戏库。

use serde::Serialize;
use winreg::enums::*;
use winreg::RegKey;

/// 扫描到的一个本机程序
#[derive(Debug, Clone, Serialize)]
pub struct ScannedProgram {
    pub name: String,
    pub install_location: Option<String>,
    pub display_icon: Option<String>,
    pub publisher: Option<String>,
}

/// 需要排除的非游戏条目（系统组件、运行时等噪声）
fn is_noise(name: &str) -> bool {
    let n = name.trim();
    if n.len() < 3 {
        return true;
    }
    let lower = n.to_lowercase();
    // 系统更新与运行时
    if lower.starts_with("kb") {
        return true;
    }
    if lower.contains("update for windows")
        || lower.contains("security update")
        || lower.contains("visual c++")
        || lower.contains("microsoft .net")
        || lower.contains(".net runtime")
        || lower.contains("microsoft edge webview")
        || lower.contains("microsoft application error reporting")
        || lower.contains("microsoft visual studio")
        || lower.contains("adobe flash")
    {
        return true;
    }
    false
}

/// 枚举一个 Uninstall 子键，收集有效条目
fn collect_key(root: RegKey, path: &str, out: &mut Vec<ScannedProgram>) {
    let Ok(base) = root.open_subkey(path) else {
        return;
    };
    for name in base.enum_keys() {
        let Ok(key_name) = name else { continue };
        let Ok(k) = base.open_subkey(&key_name) else {
            continue;
        };
        let Some(display_name) = k.get_value::<String, _>("DisplayName").ok() else {
            continue;
        };
        if is_noise(&display_name) {
            continue;
        }
        out.push(ScannedProgram {
            name: display_name.trim().to_string(),
            install_location: k.get_value("InstallLocation").ok(),
            display_icon: k.get_value("DisplayIcon").ok(),
            publisher: k.get_value("Publisher").ok(),
        });
    }
}

/// 扫描本机已安装程序（去重后按名称排序，数量封顶 300）
pub fn scan_installed_programs() -> Vec<ScannedProgram> {
    let mut list: Vec<ScannedProgram> = Vec::new();

    // 64 位程序、32 位程序（WOW6432Node）、当前用户三处
    collect_key(RegKey::predef(HKEY_LOCAL_MACHINE), r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", &mut list);
    collect_key(RegKey::predef(HKEY_LOCAL_MACHINE), r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", &mut list);
    collect_key(RegKey::predef(HKEY_CURRENT_USER), r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", &mut list);

    // 按名称去重（同一程序可能出现在多个键）
    let mut seen = std::collections::HashSet::new();
    list.retain(|p| seen.insert(p.name.clone()));

    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    list.truncate(300);
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_filtering() {
        assert!(is_noise("KB5012170 Security Update"));
        assert!(is_noise("Microsoft Visual C++ 2015-2022 Redistributable"));
        assert!(is_noise("Microsoft .NET Runtime 8.0"));
        assert!(is_noise("X")); // 名称太短
        assert!(!is_noise("艾尔登法环"));
        assert!(!is_noise("Steam"));
        assert!(!is_noise("WeChat 微信"));
        assert!(!is_noise("Heroic Games Launcher"));
    }
}
