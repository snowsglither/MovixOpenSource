-- Table: help_feedback
-- Stores up/down votes on tutos in the /help hub, one row per (slug, ip_hash).
-- `helpful` is 1 for yes / 0 for no. Users can change their mind; we UPSERT by
-- (slug, ip_hash) and keep only their latest vote. ip_hash is a SHA-256 of the
-- client IP with a server-side salt (TURNSTILE_IP_SALT or JWT_SECRET fallback),
-- so we can dedupe without storing raw IPs.

CREATE TABLE IF NOT EXISTS help_feedback (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  helpful TINYINT(1) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_slug_ip (slug, ip_hash),
  KEY idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
