//! storage.rs — Portable file I/O with exe-relative paths
//!
//! All user data lives in the same directory as the .exe so the folder can
//! be copied to a USB drive and used as-is.
//!
//! Layout next to KeyVault.exe:
//!   vault.dat    — AES-256-GCM encrypted vault data
//!   vault.bak    — Previous vault snapshot (anti-corruption backup)
//!   config.json  — Argon2 PHC hash (no plaintext secrets)
//!   error.log    — Error log (append-only, human-readable)
//!
//! WebView2 cache is redirected to %TEMP%\keyvault_wv_cache by main.rs.

use crate::models::Config;
use std::{
    io::{self, Write},
    path::PathBuf,
};

// ─── Path helpers ─────────────────────────────────────────────────────────────

/// Returns the directory that contains the running .exe.
/// Falls back to the current working directory on error.
pub fn exe_dir() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|e| format!("无法获取 exe 路径: {e}"))?
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无法获取 exe 所在目录".to_string())
}

pub fn vault_path() -> PathBuf {
    exe_dir().unwrap_or_default().join("vault.dat")
}

pub fn vault_bak_path() -> PathBuf {
    exe_dir().unwrap_or_default().join("vault.bak")
}

pub fn config_path() -> PathBuf {
    exe_dir().unwrap_or_default().join("config.json")
}

pub fn error_log_path() -> PathBuf {
    exe_dir().unwrap_or_default().join("error.log")
}

// ─── Config I/O ──────────────────────────────────────────────────────────────

pub fn save_config(config: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(config_path(), json).map_err(|e| format!("写入配置失败: {e}"))
}

pub fn load_config() -> Result<Config, String> {
    let bytes = std::fs::read(config_path())
        .map_err(|e| format!("读取配置文件失败: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("解析配置文件失败: {e}"))
}

// ─── Vault I/O (with atomic-style backup) ────────────────────────────────────

/// Save raw (encrypted) vault bytes.
///
/// Safety dance:
/// 1. Rename existing vault.dat → vault.bak  (safe point)
/// 2. Write new vault.dat
/// 3. If step 2 fails, restore vault.bak → vault.dat
///
/// Even if power is lost mid-write, vault.bak still holds the last good copy.
pub fn save_vault_bytes(data: &[u8]) -> Result<(), String> {
    let path  = vault_path();
    let backup = vault_bak_path();

    // Rotate: current → backup
    if path.exists() {
        std::fs::rename(&path, &backup)
            .map_err(|e| format!("创建备份失败: {e}"))?;
    }

    // Atomic write via temp file + rename would be ideal, but on Windows
    // cross-drive rename fails; writing directly is acceptable here.
    if let Err(e) = std::fs::write(&path, data) {
        // Attempt to restore backup so user doesn't lose data
        if backup.exists() {
            let _ = std::fs::rename(&backup, &path);
        }
        return Err(format!("写入保险库失败（已恢复备份）: {e}"));
    }

    Ok(())
}

pub fn load_vault_bytes() -> Result<Vec<u8>, String> {
    std::fs::read(vault_path()).map_err(|e| format!("读取保险库失败: {e}"))
}

pub fn vault_exists() -> bool {
    vault_path().exists() && config_path().exists()
}

// ─── Error log ───────────────────────────────────────────────────────────────

/// Append a timestamped line to error.log (best-effort; never panics).
pub fn log_error(msg: &str) {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC");
    let line = format!("[{now}] {msg}\n");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(error_log_path())
    {
        let _ = f.write_all(line.as_bytes());
    }
}
