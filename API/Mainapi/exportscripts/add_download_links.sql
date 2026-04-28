-- Add download_links JSON column to films
ALTER TABLE films
  ADD COLUMN IF NOT EXISTS download_links JSON NULL;

-- Add download_links JSON column to series (per-episode row)
ALTER TABLE series
  ADD COLUMN IF NOT EXISTS download_links JSON NULL;

-- History table for scoring/leaderboard
CREATE TABLE IF NOT EXISTS download_links_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  admin_id VARCHAR(255) NOT NULL,
  admin_auth_type ENUM('oauth','bip-39') NOT NULL,
  action ENUM('added','removed') NOT NULL,
  media_type ENUM('movie','tv') NOT NULL,
  tmdb_id BIGINT NOT NULL,
  season INT NULL,
  episode INT NULL,
  link_url TEXT NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin (admin_id, admin_auth_type),
  INDEX idx_changed (changed_at),
  INDEX idx_action (action)
);
