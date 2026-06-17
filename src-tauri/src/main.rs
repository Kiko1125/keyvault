//! main.rs — Tauri application entry point
//!
//! Key responsibilities:
//!   1. Create the WebviewWindow programmatically so we can pass a custom
//!      `data_directory` pointing to %TEMP%\keyvault_wv_cache — this keeps
//!      GPU cache, IndexedDB, WebStorage, cookies, etc. out of the exe folder.
//!   2. Manage the in-memory AppState (AES key lives here, zeroed on lock).
//!   3. Register all Tauri commands.

// Suppress the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod crypto;
mod models;
mod storage;

use std::sync::Mutex;
use tauri::Manager;

// ─── Shared application state ─────────────────────────────────────────────────

/// The 32-byte AES-256 key is kept in memory only for as long as the vault is
/// unlocked.  Calling `lock_vault` sets it to `None`, zeroing the value.
pub struct AppState {
    pub vault_key: Mutex<Option<[u8; 32]>>,
}

// ─── Entry point ─────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        // ── Shared state ──────────────────────────────────────────────────
        .manage(AppState {
            vault_key: Mutex::new(None),
        })
        // ── Registered commands ───────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            commands::check_vault_exists,
            commands::setup_master_password,
            commands::unlock_vault,
            commands::save_vault,
            commands::lock_vault,
            commands::reset_vault,
            commands::change_master_password,
            commands::copy_password,
            commands::get_exe_dir,
            commands::export_vault_json,
            commands::import_vault_json,
        ])
        // ── Window setup: redirect WebView2 cache to %TEMP% ───────────────
        .setup(|app| {
            // ── Cache directory ────────────────────────────────────────────
            // All WebView2 runtime artifacts (GPU cache, WebStorage, cookies,
            // code cache, etc.) go here instead of beside the exe.
            let webview_cache_dir = std::env::temp_dir().join("keyvault_wv_cache");
            if let Err(e) = std::fs::create_dir_all(&webview_cache_dir) {
                // Non-fatal: log it and continue without redirection.
                storage::log_error(&format!(
                    "无法创建 WebView 缓存目录 {:?}: {e}",
                    webview_cache_dir
                ));
            }

            // ── Portable data directory (beside exe) ───────────────────────
            let exe_dir = storage::exe_dir().unwrap_or_else(|_| {
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
            });

            // Log startup info for diagnostics
            storage::log_error(&format!(
                "KeyVault 启动 | exe目录={} | WebView缓存={}",
                exe_dir.display(),
                webview_cache_dir.display()
            ));

            // ── Create the main window ─────────────────────────────────────
            tauri::WebviewWindowBuilder::new(
                app,
                "main",                                         // window label
                tauri::WebviewUrl::App("index.html".into()),   // frontend entry
            )
            .title("KeyVault — 密钥保险库")
            .inner_size(1240.0, 800.0)
            .min_inner_size(900.0, 620.0)
            .center()
            // ← THIS is the critical portable line:
            // WebView2 writes ALL its caches here instead of beside the exe.
            .data_directory(webview_cache_dir)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("KeyVault 启动失败");
}
