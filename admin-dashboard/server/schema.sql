-- =============================================================================
-- CANONICAL DATABASE SCHEMA: Reader App (v1.1.0)
-- Chuẩn hóa theo PRD & Thiết kế Kỹ thuật (docs/prd.html)
-- Cơ sở dữ liệu: MySQL 8.0+ / utf8mb4 / InnoDB
-- =============================================================================

CREATE DATABASE IF NOT EXISTS app_doc_truyen
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE app_doc_truyen;

-- -----------------------------------------------------------------------------
-- 1. Table: users (Người dùng, độc giả, tác giả, admin)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fullname VARCHAR(255) NOT NULL,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NULL,
  avatar_url VARCHAR(500) NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user' COMMENT 'guest, user, vip, author, admin',
  vip_until DATETIME NULL,
  firebase_uid VARCHAR(128) NULL,
  auth_method VARCHAR(20) NULL DEFAULT 'email' COMMENT 'email, google, apple',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uk_users_email (email),
  UNIQUE KEY uk_users_firebase_uid (firebase_uid),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. Table: authors (Hồ sơ tác giả)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS authors (
  author_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  pen_name VARCHAR(255) NOT NULL,
  bio TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (author_id),
  UNIQUE KEY uq_authors_user (user_id),
  CONSTRAINT fk_authors_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. Table: stories (Danh sách truyện)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stories (
  story_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  author_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  cover_image VARCHAR(500) DEFAULT NULL,
  status ENUM('draft', 'ongoing', 'completed') DEFAULT 'ongoing',
  views BIGINT UNSIGNED NOT NULL DEFAULT 0,
  genre VARCHAR(100) DEFAULT NULL COMMENT 'Thể loại chính',
  free_chapters INT NOT NULL DEFAULT 3 COMMENT 'Số chương miễn phí cho độc giả thông thường',
  is_hidden TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Ẩn truyện khi tác giả hết hạn gói',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id),
  KEY idx_stories_author_id (author_id),
  KEY idx_stories_created (created_at),
  KEY idx_stories_hidden (is_hidden),
  FULLTEXT KEY ft_story_search (title, description),
  CONSTRAINT fk_stories_author FOREIGN KEY (author_id) REFERENCES authors (author_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. Table: genres & story_genres (Thể loại và liên kết nhiều-nhiều)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS genres (
  genre_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (genre_id),
  UNIQUE KEY uk_genre_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS story_genres (
  story_id BIGINT UNSIGNED NOT NULL,
  genre_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (story_id, genre_id),
  KEY idx_story (story_id),
  KEY idx_genre (genre_id),
  CONSTRAINT fk_story_genre_story FOREIGN KEY (story_id) REFERENCES stories (story_id) ON DELETE CASCADE,
  CONSTRAINT fk_story_genre_genre FOREIGN KEY (genre_id) REFERENCES genres (genre_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. Table: chapters (Nội dung từng chương truyện)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chapters (
  chapter_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  chapter_no INT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  content_format VARCHAR(20) NOT NULL DEFAULT 'html',
  status ENUM('draft', 'pending_review', 'published', 'rejected') NOT NULL DEFAULT 'pending_review',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chapter_id),
  UNIQUE KEY uq_chapters_story_no (story_id, chapter_no),
  KEY idx_chapters_story_id (story_id),
  CONSTRAINT fk_chapters_story FOREIGN KEY (story_id) REFERENCES stories (story_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. Table: chapter_recaps (LEGACY — cache từng chương của chatbot cũ)
-- Không còn là luồng Dual-Agent. Cache mới là story_summary_cache.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chapter_recaps (
  recap_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chapter_id BIGINT UNSIGNED NOT NULL,
  recap_text TEXT NOT NULL,
  model_name VARCHAR(64) NOT NULL DEFAULT 'grok-beta',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (recap_id),
  UNIQUE KEY uk_chapter_recap (chapter_id),
  CONSTRAINT fk_recaps_chapter FOREIGN KEY (chapter_id) REFERENCES chapters (chapter_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. Dual-Agent tables (CP-1). plagiarism_checks không còn là luồng agent.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS story_summary_cache (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  from_chapter INT NOT NULL,
  to_chapter INT NOT NULL,
  summary_text TEXT NOT NULL,
  source_hash CHAR(64) NULL,
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
  guest_token_hash CHAR(64) NULL,
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
  status ENUM('pending_review', 'approved_by_admin', 'penalized_by_admin', 'superseded') NOT NULL DEFAULT 'pending_review',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mod_status (status, created_at),
  KEY idx_mod_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. Table: comments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  comment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  story_id BIGINT UNSIGNED NOT NULL,
  chapter_id BIGINT UNSIGNED DEFAULT NULL,
  parent_id BIGINT UNSIGNED DEFAULT NULL,
  content TEXT NOT NULL,
  status ENUM('pending', 'approved', 'shadowbanned', 'rejected') NOT NULL DEFAULT 'approved',
  toxicity_score FLOAT NOT NULL DEFAULT 0,
  moderation_label VARCHAR(32) NOT NULL DEFAULT 'clean' COMMENT 'clean, toxic, spoiler, ad_spam',
  is_spoiler TINYINT(1) NOT NULL DEFAULT 0,
  agent_reason VARCHAR(255) NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  is_negative TINYINT NOT NULL DEFAULT 0,
  negative_probability INT NOT NULL DEFAULT 0,
  reviewed_by VARCHAR(191) NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id),
  KEY idx_comments_user (user_id),
  KEY idx_comments_story (story_id),
  KEY idx_comments_chapter (chapter_id),
  KEY idx_comments_status (status),
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_comments_story FOREIGN KEY (story_id) REFERENCES stories (story_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_comments_chapter FOREIGN KEY (chapter_id) REFERENCES chapters (chapter_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. Table: reading_history & reading_starts (Tiến độ đọc & Paywall Quota)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_history (
  history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  story_id VARCHAR(191) NOT NULL,
  chapter_id VARCHAR(191) NULL,
  chapter_no INT NULL,
  progress_pct DECIMAL(5,2) NULL,
  last_read_at DATETIME NULL,
  PRIMARY KEY (history_id),
  UNIQUE KEY uq_history_user_story (user_id, story_id),
  KEY idx_history_user (user_id, last_read_at),
  KEY idx_history_story_id (story_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reading_starts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(255) NOT NULL COMMENT 'user_id hoặc Remote IP (với guest)',
  story_id BIGINT UNSIGNED NOT NULL,
  started_at DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_story (user_id, story_id),
  KEY idx_story (story_id),
  KEY idx_started_at (started_at),
  KEY idx_user_started (user_id, started_at),
  CONSTRAINT fk_reading_starts_story FOREIGN KEY (story_id) REFERENCES stories (story_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. Table: likes, chapter_views, follows, author_follows
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS likes (
  like_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  story_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (like_id),
  UNIQUE KEY uk_likes_user_story (user_id, story_id),
  KEY idx_likes_story (story_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chapter_views (
  view_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  story_id BIGINT UNSIGNED NOT NULL,
  chapter_id BIGINT UNSIGNED NOT NULL,
  viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (view_id),
  KEY idx_views_user_day (user_id, viewed_at),
  KEY idx_views_story (story_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS follows (
  follow_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  follower_id VARCHAR(191) NOT NULL,
  followee_id VARCHAR(191) NOT NULL COMMENT 'story_id được theo dõi',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follow_id),
  UNIQUE KEY uk_follows_pair (follower_id, followee_id),
  KEY idx_follows_followee (followee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS author_follows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  author_id VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_author (user_id, author_id),
  KEY idx_author_follows (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. Table: wallets & topup_intents (Autonomous Webhook Top-up Engine)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  wallet_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (wallet_id),
  UNIQUE KEY uk_wallets_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS topup_intents (
  intent_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  coins BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  payment_code VARCHAR(191) NOT NULL,
  account_no VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending, consumed, expired',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (intent_id),
  UNIQUE KEY uk_payment_code (payment_code),
  KEY idx_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS topup_requests (
  request_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  coins BIGINT NOT NULL,
  amount BIGINT NULL,
  method VARCHAR(64) NULL,
  note TEXT NULL,
  evidence_url TEXT NULL,
  provider_ref TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending, approved, rejected',
  admin_id VARCHAR(191) NULL,
  admin_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  PRIMARY KEY (request_id),
  KEY idx_topup_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  payment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  coins BIGINT NULL,
  provider VARCHAR(191) NULL COMMENT 'bank_auto, sepay, payos, manual',
  provider_ref VARCHAR(191) NULL,
  months INT NULL,
  days INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_id),
  KEY idx_payments_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 12. Table: donations, withdrawals, author_applications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS donations (
  donation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_id VARCHAR(191) NOT NULL,
  story_id VARCHAR(191) NULL,
  author_id VARCHAR(191) NOT NULL,
  coins BIGINT NOT NULL,
  message TEXT NULL,
  gift_code VARCHAR(32) NULL,
  gift_name VARCHAR(64) NULL,
  quantity INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (donation_id),
  KEY idx_donations_author (author_id),
  KEY idx_donations_donor (donor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS withdrawals (
  withdrawal_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  coins BIGINT NOT NULL,
  method VARCHAR(191) NULL,
  details TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending, approved, processed, declined',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  PRIMARY KEY (withdrawal_id),
  KEY idx_withdrawals_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS author_applications (
  application_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  pen_name VARCHAR(191) NULL,
  bio TEXT NULL,
  samples TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending, approved, declined',
  admin_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (application_id),
  KEY idx_author_app_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 13. Table: banners, ads, notification_state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS banners (
  banner_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NULL,
  image_url VARCHAR(500) NULL,
  link VARCHAR(500) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (banner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ads (
  ad_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NULL,
  video_url VARCHAR(500) NULL,
  link VARCHAR(500) NULL,
  placement VARCHAR(50) NOT NULL DEFAULT 'interstitial',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ad_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_state (
  user_id VARCHAR(191) NOT NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  type VARCHAR(32) NOT NULL,
  story_id VARCHAR(191) NOT NULL,
  chapter_id VARCHAR(191) NOT NULL,
  chapter_no INT NULL,
  story_title VARCHAR(255) NULL,
  chapter_title VARCHAR(255) NULL,
  actor_name VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notification_user_chapter (user_id, type, chapter_id),
  KEY idx_notifications_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fcm_tokens (
  token VARCHAR(512) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  platform VARCHAR(16) NOT NULL DEFAULT 'android',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_fcm_tokens_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Dữ liệu hạt giống mặc định (Seed Data)
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO genres (genre_id, name, description) VALUES
(1, 'Tiên hiệp', 'Truyện tu tiên, tu chân, phi thăng'),
(2, 'Kiếm hiệp', 'Truyện võ hiệp giang hồ, kiếm khách anh hùng'),
(3, 'Huyền huyễn', 'Thế giới huyền bí, dị giới, ma pháp tu luyện'),
(4, 'Đô thị', 'Bối cảnh cuộc sống hiện đại, thương trường, đời thường'),
(5, 'Lịch sử', 'Dã sử, cung đấu, chiến tranh lịch sử và quân sự'),
(6, 'Khoa huyễn', 'Khoa học viễn tưởng, không gian, mạt thế tương lai'),
(7, 'Đồng nhân', 'Phóng tác dựa trên tác phẩm, nhân vật nổi tiếng có sẵn'),
(8, 'Kỳ ảo', 'Thần thoại phương Tây, sinh vật huyền bí, phiêu lưu'),
(9, 'Trinh thám', 'Phá án, suy luận logic, tâm lý tội phạm'),
(10, 'Ngôn tình', 'Tình cảm đôi lứa ngọt ngào hoặc trắc trở, thanh xuân');

-- AI safety, durable jobs, request budgets and provider usage
CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id CHAR(36) PRIMARY KEY, trace_id CHAR(36) NULL, user_id VARCHAR(191) NULL,
    task VARCHAR(32) NOT NULL, provider VARCHAR(255) NOT NULL,
    requested_model VARCHAR(191) NOT NULL, response_model VARCHAR(191) NULL,
    status VARCHAR(32) NOT NULL, latency_ms INT UNSIGNED NOT NULL,
    prompt_tokens BIGINT UNSIGNED NULL, completion_tokens BIGINT UNSIGNED NULL,
    cached_tokens BIGINT UNSIGNED NULL, reasoning_tokens BIGINT UNSIGNED NULL,
    finish_reason VARCHAR(32) NULL, provider_cost DECIMAL(20,8) NULL,
    cost_unit VARCHAR(32) NULL, error_code VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ai_usage_time (created_at, task), KEY idx_ai_usage_user (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_request_quotas (
    bucket_key CHAR(64) PRIMARY KEY, hits INT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL, KEY idx_quota_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_moderation_jobs (
    comment_id VARCHAR(191) PRIMARY KEY, content_hash CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued', attempts INT NOT NULL DEFAULT 0,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_until DATETIME NULL, lease_token CHAR(36) NULL, last_error VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_jobs_ready (status, available_at, lease_until)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
