CREATE TABLE IF NOT EXISTS local_profiles (
  id VARCHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  avatar_color VARCHAR(50) NOT NULL DEFAULT 'bg-blue-600',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO local_profiles (id, name, avatar_color) VALUES
  ('profile-ruben',       'Ruben',       'bg-blue-600'),
  ('profile-glodi',       'Glodi',       'bg-emerald-600'),
  ('profile-christopher', 'Christopher', 'bg-orange-600'),
  ('profile-pauliner',    'Pauliner',    'bg-pink-600'),
  ('profile-parents',     'Parents',     'bg-indigo-600'),
  ('profile-invite',      'Invité',      'bg-gray-600');

CREATE TABLE IF NOT EXISTS lkstv_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profile_id VARCHAR(36) NOT NULL,
  media_type ENUM('movie','tv') NOT NULL,
  media_id BIGINT NOT NULL,
  title VARCHAR(500),
  poster_path VARCHAR(500),
  progress FLOAT DEFAULT 0,
  duration FLOAT DEFAULT 0,
  season INT DEFAULT NULL,
  episode INT DEFAULT NULL,
  watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_profile_media (profile_id, media_type, media_id),
  KEY idx_profile_watched (profile_id, watched_at),
  CONSTRAINT fk_hist_profile FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lkstv_watchlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profile_id VARCHAR(36) NOT NULL,
  media_type ENUM('movie','tv') NOT NULL,
  media_id BIGINT NOT NULL,
  title VARCHAR(500),
  poster_path VARCHAR(500),
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_profile_wl (profile_id, media_type, media_id),
  KEY idx_profile_added (profile_id, added_at),
  CONSTRAINT fk_wl_profile FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
