-- Migration: 003_prd_v1_1_standardization.sql
-- Description: Chuẩn hóa cơ sở dữ liệu lên v1.1.0 theo PRD (docs/prd.html)
-- Date: 2026-09-21

-- ==========================================================
-- 1. BẢNG USERS: Bổ sung firebase_uid và auth_method
-- ==========================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128) NULL AFTER password_hash;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_method VARCHAR(20) NULL DEFAULT 'email' AFTER firebase_uid;

-- Index cho firebase_uid
CREATE UNIQUE INDEX IF NOT EXISTS uk_users_firebase_uid ON users (firebase_uid);

-- ==========================================================
-- 2. BẢNG STORIES: Đảm bảo có free_chapters và is_hidden
-- ==========================================================
ALTER TABLE stories ADD COLUMN IF NOT EXISTS free_chapters INT NOT NULL DEFAULT 3 COMMENT 'So chuong mien phi cho doc gia';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS is_hidden TINYINT(1) NOT NULL DEFAULT 0;

-- ==========================================================
-- 3. BẢNG COMMENTS: Bổ sung các cột phục vụ Moderation Agent
-- ==========================================================
ALTER TABLE comments ADD COLUMN IF NOT EXISTS moderation_label VARCHAR(32) NOT NULL DEFAULT 'clean';
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_spoiler TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS agent_reason VARCHAR(255) NULL;

-- ==========================================================
-- 4. BẢNG TOPUP_INTENTS (Autonomous Webhook Top-up theo PRD Section 3.C & 5)
-- ==========================================================
CREATE TABLE IF NOT EXISTS topup_intents (
  intent_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  coins BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  payment_code VARCHAR(191) NOT NULL,
  account_no VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_payment_code (payment_code),
  KEY idx_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================
-- 5. BẢNG CHAPTER_RECAPS (AI Chapter Recap theo PRD Section 3.A & 5)
-- ==========================================================
CREATE TABLE IF NOT EXISTS chapter_recaps (
  recap_id INT AUTO_INCREMENT PRIMARY KEY,
  chapter_id BIGINT UNSIGNED NOT NULL,
  recap_text TEXT NOT NULL,
  model_name VARCHAR(64) NOT NULL DEFAULT 'grok-beta',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_chapter_recap (chapter_id),
  CONSTRAINT fk_recaps_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================
-- 6. BẢNG PLAGIARISM_CHECKS (Moderation & Plagiarism Guard theo PRD Section 3.B & 5)
-- ==========================================================
CREATE TABLE IF NOT EXISTS plagiarism_checks (
  check_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chapter_id BIGINT UNSIGNED NOT NULL,
  story_id BIGINT UNSIGNED NOT NULL,
  similarity_score FLOAT NOT NULL DEFAULT 0,
  matched_story_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'passed',
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_story_check (story_id, status),
  CONSTRAINT fk_plagiarism_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_plagiarism_story FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================
-- 7. BẢNG READING_STARTS (Theo dõi mở đọc tính giới hạn hàng ngày)
-- ==========================================================
CREATE TABLE IF NOT EXISTS reading_starts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL COMMENT 'user_id hoặc IP cho guest',
  story_id BIGINT UNSIGNED NOT NULL,
  started_at DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_story (user_id, story_id),
  KEY idx_story (story_id),
  KEY idx_started_at (started_at),
  KEY idx_user_started (user_id, started_at),
  CONSTRAINT fk_reading_starts_story FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================
-- 8. BẢNG WITHDRAWALS (Rút tiền cho tác giả)
-- ==========================================================
CREATE TABLE IF NOT EXISTS withdrawals (
  withdrawal_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  coins BIGINT NOT NULL,
  method VARCHAR(191) NULL,
  details TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  KEY idx_withdrawals_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================
-- 9. BẢNG AUTHOR_APPLICATIONS (Đơn xin làm tác giả)
-- ==========================================================
CREATE TABLE IF NOT EXISTS author_applications (
  application_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  pen_name VARCHAR(191) NULL,
  bio TEXT NULL,
  samples TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  admin_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_author_app_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
