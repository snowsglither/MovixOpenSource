ALTER TABLE download_links_history
  ADD COLUMN IF NOT EXISTS link_type ENUM('streaming','download') NOT NULL DEFAULT 'download';

-- Optional: index for type filtering
CREATE INDEX IF NOT EXISTS idx_link_type ON download_links_history(link_type);
