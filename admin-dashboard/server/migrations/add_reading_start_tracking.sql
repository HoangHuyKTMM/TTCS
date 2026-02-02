-- Migration: Add reading start tracking for daily chapter limits
-- Tracks when a user/guest first started reading each story

CREATE TABLE IF NOT EXISTS reading_starts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(255) NOT NULL COMMENT 'user_id or IP for guests',
  story_id BIGINT UNSIGNED NOT NULL,
  started_at DATE NOT NULL COMMENT 'Date when user first accessed this story',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_story (user_id, story_id),
  KEY idx_story (story_id),
  KEY idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Track reading start date for daily chapter unlocking';

-- Index for faster lookups
CREATE INDEX idx_user_started ON reading_starts (user_id, started_at);
