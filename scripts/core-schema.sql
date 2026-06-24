-- LKS TV — Schéma core (tables non créées par les exportscripts)
-- Reconstruit depuis les routes API

-- Table principale des films (liens de streaming par TMDB ID)
CREATE TABLE IF NOT EXISTS films (
  id BIGINT PRIMARY KEY,
  links JSON,
  download_links JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_films_id (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table principale des séries (un enregistrement par épisode)
CREATE TABLE IF NOT EXISTS series (
  id INT AUTO_INCREMENT PRIMARY KEY,
  series_id BIGINT NOT NULL,
  season_number INT NOT NULL DEFAULT 0,
  episode_number INT NOT NULL DEFAULT 0,
  links JSON,
  download_links JSON,
  UNIQUE KEY unique_episode (series_id, season_number, episode_number),
  INDEX idx_series_id (series_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des demandes de contenu (Wishboard/Greenlight)
CREATE TABLE IF NOT EXISTS wishboard_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  profile_id VARCHAR(255),
  tmdb_id INT NOT NULL,
  media_type VARCHAR(20) NOT NULL,
  season_number INT DEFAULT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  vote_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_wb_tmdb (tmdb_id, media_type),
  INDEX idx_wb_profile (profile_id),
  INDEX idx_wb_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des votes Wishboard
CREATE TABLE IF NOT EXISTS wishboard_votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  profile_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_vote (request_id, user_id),
  INDEX idx_wbv_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des notes admin Wishboard
CREATE TABLE IF NOT EXISTS wishboard_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  admin_id VARCHAR(255),
  note TEXT,
  is_public TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_note (request_id),
  INDEX idx_wbn_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table de l'historique des statuts Wishboard
CREATE TABLE IF NOT EXISTS wishboard_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  status VARCHAR(50),
  reason TEXT,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  admin_id VARCHAR(255) DEFAULT NULL,
  admin_auth_type VARCHAR(10) DEFAULT NULL,
  INDEX idx_wbsh_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
