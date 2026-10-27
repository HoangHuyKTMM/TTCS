-- Migration: 004_dual_agent_cp1.sql
-- Dual-Agent CP-1. Áp dụng an toàn (chạy lại được) bằng: node migrate.js
-- File này ghi DDL đích. migrate.js kiểm tra cột/index trước khi ALTER.

-- Các ALTER bên dưới không chạy lại được. DB đang chạy dùng `node migrate.js`.

ALTER TABLE stories ADD FULLTEXT INDEX ft_story_search (title, description);

ALTER TABLE chapters
  ADD COLUMN status ENUM('draft', 'pending_review', 'published', 'rejected') NOT NULL DEFAULT 'published';

ALTER TABLE comments ADD COLUMN toxicity_score FLOAT NOT NULL DEFAULT 0;
UPDATE comments SET status = 'approved' WHERE status IS NULL OR status = '';
UPDATE comments SET status = 'rejected' WHERE status NOT IN ('pending', 'approved', 'shadowbanned', 'rejected');
ALTER TABLE comments
  MODIFY COLUMN status ENUM('pending', 'approved', 'shadowbanned', 'rejected') NOT NULL DEFAULT 'approved';

CREATE TABLE IF NOT EXISTS story_summary_cache (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  from_chapter INT NOT NULL,
  to_chapter INT NOT NULL,
  summary_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_story_range (story_id, from_chapter, to_chapter),
  KEY idx_summary_lookup (story_id, from_chapter, to_chapter),
  CONSTRAINT fk_cache_story FOREIGN KEY (story_id) REFERENCES stories (story_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conv_user (user_id),
  CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  metadata JSON NULL,
  trace_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conv_time (conversation_id, created_at),
  KEY idx_trace (trace_id),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chapter_fingerprints (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  chapter_id BIGINT UNSIGNED NOT NULL,
  simhash_64 BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_simhash (simhash_64),
  KEY idx_fp_story (story_id),
  CONSTRAINT fk_fp_chapter FOREIGN KEY (chapter_id) REFERENCES chapters (chapter_id) ON DELETE CASCADE,
  CONSTRAINT fk_fp_story FOREIGN KEY (story_id) REFERENCES stories (story_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS moderation_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_type ENUM('comment', 'chapter') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  violation_type ENUM('toxicity', 'spam', 'plagiarism') NOT NULL,
  confidence_score FLOAT NOT NULL,
  matched_target_id BIGINT UNSIGNED NULL,
  evidence_data JSON NULL,
  trace_id VARCHAR(64) NULL,
  status ENUM('pending_review', 'approved_by_admin', 'penalized_by_admin') NOT NULL DEFAULT 'pending_review',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mod_status (status, created_at),
  KEY idx_mod_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
