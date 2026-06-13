//! crypto.rs — AES-256-GCM encryption + Argon2id key derivation
//!
//! Design decisions:
//! - Single Argon2id PHC string stored in config.json; salt is embedded in it.
//! - `hash_password`  → generates PHC string (for storage & verification).
//! - `derive_key`     → re-runs Argon2id with the embedded salt to reproduce
//!                      the deterministic 32-byte AES key. No key material is
//!                      ever written to disk.
//! - AES-256-GCM nonce is random per write; nonce prepended to ciphertext.
//! - Ciphertext format: [12-byte nonce || ciphertext || 16-byte GCM tag]

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{rand_core::OsRng as PwdOsRng, PasswordHash, PasswordHasher,
                    PasswordVerifier, SaltString},
    Argon2, Params,
};

// ─── Argon2id parameters ──────────────────────────────────────────────────────
// Moderate settings for a desktop app: ~256 ms on a modern CPU.
const ARGON2_M_COST: u32 = 65_536;  // 64 MiB memory
const ARGON2_T_COST: u32 = 3;       // 3 iterations
const ARGON2_P_COST: u32 = 1;       // 1 lane
const KEY_LEN:       usize = 32;    // AES-256

// ─── Argon2 instance builder ──────────────────────────────────────────────────
fn build_argon2() -> Result<Argon2<'static>, String> {
    let params = Params::new(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST, Some(KEY_LEN))
        .map_err(|e| format!("Argon2 参数错误: {e}"))?;
    Ok(Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params))
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Hash the master password and return a PHC string for storage.
/// The PHC string embeds algorithm, params, salt, and hash.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut PwdOsRng);
    let argon2 = build_argon2()?;
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("密码哈希失败: {e}"))
}

/// Verify a plaintext password against a stored PHC hash string.
pub fn verify_password(password: &str, phc: &str) -> Result<bool, String> {
    let parsed = PasswordHash::new(phc).map_err(|e| format!("PHC 格式错误: {e}"))?;
    // Use default Argon2 here — it reads params from the PHC string.
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// Derive a deterministic 32-byte AES key from the password + the salt that
/// is embedded in the PHC string.  This is safe because:
/// - The hash itself is NOT the key — we run Argon2 independently with the
///   same salt and params but request raw 32-byte output.
/// - An attacker who reads `config.json` still has to brute-force Argon2.
pub fn derive_key(password: &str, phc: &str) -> Result<[u8; KEY_LEN], String> {
    let parsed = PasswordHash::new(phc).map_err(|e| format!("PHC 格式错误: {e}"))?;
    let salt_str = parsed.salt.ok_or("PHC 中无 salt")?;

    let argon2 = build_argon2()?;
    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(password.as_bytes(), salt_str.as_str().as_bytes(), &mut key)
        .map_err(|e| format!("密钥派生失败: {e}"))?;
    Ok(key)
}

/// Encrypt plaintext bytes with AES-256-GCM.
/// Returns `[12-byte nonce || ciphertext+tag]`.
pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce  = Aes256Gcm::generate_nonce(&mut OsRng); // 96-bit random nonce

    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("加密失败: {e}"))?;

    // Prepend nonce so we can recover it at decrypt time
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt data produced by [`encrypt`].
/// Expects `[12-byte nonce || ciphertext+tag]`.
pub fn decrypt(key: &[u8; KEY_LEN], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 13 {
        return Err("数据损坏：长度不足".to_string());
    }
    let (nonce_bytes, ct) = data.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce  = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ct)
        .map_err(|_| "解密失败：主密码错误或数据已损坏".to_string())
}
