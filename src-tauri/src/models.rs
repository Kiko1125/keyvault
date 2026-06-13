use serde::{Deserialize, Serialize};

// ─── Entry Type ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Account,
    SecureNote,
    BankCard,
}

// ─── Password History ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PasswordHistory {
    /// The old plaintext password value
    pub password: String,
    /// Unix timestamp (milliseconds) when the password was changed
    pub changed_at: i64,
}

// ─── Vault Entry (unified model for all entry types) ─────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VaultEntry {
    /// Unique ID (nanoid-style)
    pub id: String,

    /// Entry type discriminator
    #[serde(rename = "type")]
    pub entry_type: EntryType,

    /// Display name (required for all types)
    pub name: String,

    /// Category tag (e.g. "社交", "工作", "银行")
    pub category: String,

    // ── Account fields ──────────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,

    /// Archived old passwords with timestamps
    #[serde(default)]
    pub password_history: Vec<PasswordHistory>,

    // ── Secure Note fields ───────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_content: Option<String>,

    // ── Bank Card fields ─────────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bank_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_holder: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_number: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_expiry: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_cvv: Option<String>,

    // ── Shared optional short remark ─────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,

    // ── Timestamps ───────────────────────────────────────────────────────────
    /// Creation time (Unix ms)
    pub created_at: i64,

    /// Last update time (Unix ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

// ─── Top-level Vault ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Vault {
    pub version: u32,
    pub entries: Vec<VaultEntry>,
}

impl Vault {
    pub fn new() -> Self {
        Vault { version: 1, entries: vec![] }
    }
}

// ─── Config (stored as plain-text config.json) ────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Config {
    /// Argon2id PHC string — used for password verification AND key derivation.
    /// The salt is embedded inside this string.
    pub argon2_hash: String,

    /// App created time (Unix ms)
    pub created_at: i64,
}
