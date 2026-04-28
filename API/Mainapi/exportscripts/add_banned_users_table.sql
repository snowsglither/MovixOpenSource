-- Table pour le système de bannissement (commentaires)
CREATE TABLE IF NOT EXISTS banned_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ban_type ENUM('ip', 'user') NOT NULL,
  ban_value VARCHAR(255) NOT NULL,
  user_type VARCHAR(10) DEFAULT NULL,
  reason VARCHAR(500) DEFAULT NULL,
  banned_by VARCHAR(255) NOT NULL,
  banned_at BIGINT NOT NULL,
  expires_at BIGINT DEFAULT NULL,
  username VARCHAR(100) DEFAULT NULL,
  UNIQUE KEY unique_ban (ban_type, ban_value, user_type)
);

-- Ajouter la colonne ip_address aux commentaires et réponses (pour pouvoir bannir par IP)
ALTER TABLE comments ADD COLUMN ip_address VARCHAR(45) DEFAULT NULL;
ALTER TABLE comment_replies ADD COLUMN ip_address VARCHAR(45) DEFAULT NULL;
