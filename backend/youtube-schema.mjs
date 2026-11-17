// Additive v4 definitions only. The parent migration appends its existing InnoDB suffix.
// No migration, database connection, or environment access is performed by this module.
export const YOUTUBE_TABLE_NAMES = Object.freeze([
  'taswiqat_youtube_tokens',
  'taswiqat_youtube_attempts',
  'taswiqat_youtube_revocations'
]);
export const YOUTUBE_DEFINITIONS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS taswiqat_youtube_tokens (
    workspace_id VARCHAR(80) PRIMARY KEY,
    connection_id VARCHAR(80) NOT NULL UNIQUE,
    user_id VARCHAR(80) NOT NULL,
    channel_id VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_cipher MEDIUMTEXT NOT NULL,
    token_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    reconsent_required BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at DATETIME(3) NOT NULL,
    next_check_at DATETIME(3) NOT NULL,
    retry_count INT UNSIGNED NOT NULL DEFAULT 0,
    lease_owner VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lease_until DATETIME(3) NULL,
    INDEX(next_check_at,lease_until), INDEX(user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS taswiqat_youtube_attempts (
    state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    id VARCHAR(80) NOT NULL UNIQUE,
    workspace_id VARCHAR(80) NOT NULL UNIQUE,
    user_id VARCHAR(80) NOT NULL,
    session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    cookie_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    service ENUM('yt') NOT NULL DEFAULT 'yt',
    policy_version VARCHAR(20) NOT NULL,
    status ENUM('started','exchanging','pending') NOT NULL DEFAULT 'started',
    payload_cipher MEDIUMTEXT NULL,
    base_connection_id VARCHAR(80) NULL,
    base_token_version BIGINT UNSIGNED NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    INDEX(expires_at), INDEX(user_id,session_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS taswiqat_youtube_revocations (
    id VARCHAR(80) PRIMARY KEY,
    workspace_id VARCHAR(80) NOT NULL,
    token_cipher TEXT NOT NULL,
    requested_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    next_attempt_at DATETIME(3) NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    lease_owner VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lease_until DATETIME(3) NULL,
    INDEX(next_attempt_at,lease_until), INDEX(workspace_id), INDEX(expires_at)
  )`
]);
