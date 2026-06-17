//! commands.rs — All Tauri `invoke` commands exposed to the frontend.
//!
//! Command inventory:
//!   check_vault_exists      → bool
//!   setup_master_password   → Ok / Err
//!   unlock_vault            → Vec<VaultEntry>
//!   save_vault              → Ok / Err
//!   lock_vault              → Ok / Err
//!   reset_vault             → Ok / Err  (delete all vault files, return to setup)
//!   change_master_password  → Ok / Err
//!   copy_password           → Ok / Err  (starts 30-second clipboard clear)
//!   get_exe_dir             → String
//!   export_vault_json       → Ok / Err
//!   import_vault_json       → Vec<VaultEntry>

use crate::{
    crypto,
    models::{Config, Vault, VaultEntry},
    storage, AppState,
};
use std::sync::MutexGuard;
use tauri::State;

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn locked_key<'a>(state: &'a State<AppState>) -> Result<MutexGuard<'a, Option<[u8; 32]>>, String> {
    state.vault_key.lock().map_err(|e| format!("状态锁错误: {e}"))
}

fn get_key(state: &State<AppState>) -> Result<[u8; 32], String> {
    locked_key(state)?
        .ok_or_else(|| "保险库未解锁".to_string())
}

// ─── Vault lifecycle ──────────────────────────────────────────────────────────

/// Returns true if both vault.dat and config.json exist beside the exe.
#[tauri::command]
pub fn check_vault_exists() -> bool {
    storage::vault_exists()
}

/// First-run only: hash master password, derive AES key, create empty vault.
#[tauri::command]
pub async fn setup_master_password(
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if password.len() < 6 {
        return Err("主密码至少需要 6 位字符".to_string());
    }
    if storage::vault_exists() {
        return Err("保险库已存在，请直接解锁".to_string());
    }

    // 1. Hash password for verification + key derivation
    let phc = crypto::hash_password(&password)?;

    // 2. Save config (contains Argon2 PHC — no raw secret)
    let config = Config {
        argon2_hash: phc.clone(),
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    storage::save_config(&config)?;

    // 3. Derive AES key and create empty encrypted vault
    let key = crypto::derive_key(&password, &phc)?;
    let vault = Vault::new();
    let vault_json = serde_json::to_vec(&vault).map_err(|e| e.to_string())?;
    let ciphertext = crypto::encrypt(&key, &vault_json)?;
    storage::save_vault_bytes(&ciphertext)?;

    // 4. Store derived key in app state (vault is now "unlocked")
    *locked_key(&state)? = Some(key);

    Ok(())
}

/// Verify master password, derive AES key, decrypt and return all entries.
#[tauri::command]
pub async fn unlock_vault(
    password: String,
    state: State<'_, AppState>,
) -> Result<Vec<VaultEntry>, String> {
    let config = storage::load_config()?;

    // Verify password first (fast reject on wrong password)
    if !crypto::verify_password(&password, &config.argon2_hash)? {
        return Err("主密码错误，请重试".to_string());
    }

    // Derive AES key (same salt embedded in PHC)
    let key = crypto::derive_key(&password, &config.argon2_hash)?;

    // Decrypt vault
    let raw = storage::load_vault_bytes()?;
    let plaintext = crypto::decrypt(&key, &raw).map_err(|e| {
        storage::log_error(&format!("解密失败: {e}"));
        e
    })?;

    let vault: Vault = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("保险库格式损坏: {e}"))?;

    // Persist key in memory
    *locked_key(&state)? = Some(key);

    Ok(vault.entries)
}

/// Encrypt and persist all entries to vault.dat (with backup rotation).
#[tauri::command]
pub async fn save_vault(
    entries: Vec<VaultEntry>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = get_key(&state)?;
    let vault = Vault { version: 1, entries };
    let json  = serde_json::to_vec(&vault).map_err(|e| e.to_string())?;
    let ct    = crypto::encrypt(&key, &json)?;
    storage::save_vault_bytes(&ct)
}

/// Zero out the in-memory AES key (logical logout).
#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> Result<(), String> {
    *locked_key(&state)? = None;
    Ok(())
}

/// Delete all vault files on disk and clear the in-memory key.
/// This is a destructive, irreversible operation — use only as a last resort
/// when the user has forgotten their master password.
#[tauri::command]
pub fn reset_vault(state: State<'_, AppState>) -> Result<(), String> {
    // Clear in-memory key first
    if let Ok(mut key) = state.vault_key.lock() {
        *key = None;
    }

    // Delete vault files (best-effort; ignore "not found" errors)
    for path in [
        storage::vault_path(),
        storage::vault_bak_path(),
        storage::config_path(),
    ] {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("删除文件失败 {:?}: {e}", path))?;
        }
    }

    Ok(())
}

/// Change the master password:
/// 1. Verify old password
/// 2. Re-encrypt vault with new key
/// 3. Update config.json with new PHC
#[tauri::command]
pub async fn change_master_password(
    old_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if new_password.len() < 6 {
        return Err("新密码至少需要 6 位字符".to_string());
    }

    // Verify old password
    let config = storage::load_config()?;
    if !crypto::verify_password(&old_password, &config.argon2_hash)? {
        return Err("原主密码错误".to_string());
    }

    // Decrypt vault with old key
    let old_key   = get_key(&state)?;
    let raw       = storage::load_vault_bytes()?;
    let plaintext = crypto::decrypt(&old_key, &raw)?;

    // Generate new PHC + key
    let new_phc = crypto::hash_password(&new_password)?;
    let new_key = crypto::derive_key(&new_password, &new_phc)?;

    // Re-encrypt with new key
    let ct = crypto::encrypt(&new_key, &plaintext)?;
    storage::save_vault_bytes(&ct)?;

    // Update config
    let new_config = Config {
        argon2_hash: new_phc,
        created_at: config.created_at,
    };
    storage::save_config(&new_config)?;

    // Update in-memory key
    *locked_key(&state)? = Some(new_key);

    Ok(())
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

/// Copy text to clipboard and schedule auto-clear after 30 seconds.
/// Runs the clear task on a background thread so it doesn't block the UI.
#[tauri::command]
pub async fn copy_password(text: String) -> Result<(), String> {
    use arboard::Clipboard;

    // Copy now (synchronous clipboard write)
    let mut cb = Clipboard::new().map_err(|e| format!("剪贴板初始化失败: {e}"))?;
    cb.set_text(&text).map_err(|e| format!("写入剪贴板失败: {e}"))?;

    // Fire-and-forget 30-second clear
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if let Ok(mut cb) = Clipboard::new() {
            // Only clear if the clipboard still contains our secret.
            // If the user copied something else in the meantime, leave it alone.
            if let Ok(current) = cb.get_text() {
                if current == text {
                    let _ = cb.set_text("");
                }
            }
        }
    });

    Ok(())
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/// Return the directory of the running exe (for display in the UI).
#[tauri::command]
pub fn get_exe_dir() -> Result<String, String> {
    storage::exe_dir().map(|p| p.to_string_lossy().to_string())
}

/// Export the decrypted vault as a plain-text JSON file to a user-specified path.
#[tauri::command]
pub async fn export_vault_json(
    export_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key       = get_key(&state)?;
    let raw       = storage::load_vault_bytes()?;
    let plaintext = crypto::decrypt(&key, &raw)?;

    // Pretty-print for readability
    let vault: Vault = serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;
    let pretty = serde_json::to_string_pretty(&vault).map_err(|e| e.to_string())?;

    std::fs::write(&export_path, pretty.as_bytes())
        .map_err(|e| format!("导出失败: {e}"))
}

/// Import entries from a previously exported plain-text JSON file.
/// Merges by ID (skips duplicates).
#[tauri::command]
pub async fn import_vault_json(
    import_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<VaultEntry>, String> {
    // Load current vault
    let key       = get_key(&state)?;
    let raw       = storage::load_vault_bytes()?;
    let plaintext = crypto::decrypt(&key, &raw)?;
    let mut vault: Vault = serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;

    // Parse import file
    let import_bytes = std::fs::read(&import_path)
        .map_err(|e| format!("读取导入文件失败: {e}"))?;
    let import_vault: Vault = serde_json::from_slice(&import_bytes)
        .map_err(|e| format!("导入文件格式错误: {e}"))?;

    // Merge (skip existing IDs)
    let existing_ids: std::collections::HashSet<String> =
        vault.entries.iter().map(|e| e.id.clone()).collect();

    let mut added = 0usize;
    for entry in import_vault.entries {
        if !existing_ids.contains(&entry.id) {
            vault.entries.push(entry);
            added += 1;
        }
    }

    if added == 0 {
        return Err("没有新条目可导入（所有 ID 已存在）".to_string());
    }

    // Save merged vault
    let json = serde_json::to_vec(&vault).map_err(|e| e.to_string())?;
    let ct   = crypto::encrypt(&key, &json)?;
    storage::save_vault_bytes(&ct)?;

    Ok(vault.entries)
}
