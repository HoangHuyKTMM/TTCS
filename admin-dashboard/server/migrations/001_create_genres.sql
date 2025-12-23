-- Migration: Create genres and story_genres tables
-- Date: 2025-12-11

-- Tạo bảng genres
CREATE TABLE IF NOT EXISTS genres (
  genre_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (genre_id),
  UNIQUE KEY uk_genre_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tạo bảng story_genres (junction table)
CREATE TABLE IF NOT EXISTS story_genres (
  story_id BIGINT UNSIGNED NOT NULL,
  genre_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (story_id, genre_id),
  KEY idx_story (story_id),
  KEY idx_genre (genre_id),
  CONSTRAINT fk_story_genre_story FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE,
  CONSTRAINT fk_story_genre_genre FOREIGN KEY (genre_id) REFERENCES genres(genre_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Thêm cột genre vào bảng stories nếu chưa tồn tại
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stories'
    AND COLUMN_NAME = 'genre'
);

SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE stories ADD COLUMN genre VARCHAR(100) NULL COMMENT "Primary genre/category"',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Thêm dữ liệu mẫu
INSERT IGNORE INTO genres (name, description) VALUES
('Tiên hiệp', 'Truyện tu tiên, tu chân'),
('Kiếm hiệp', 'Truyện võ hiệp, kiếm khách'),
('Huyền huyễn', 'Truyện huyền ảo, ma thuật'),
('Đô thị', 'Truyện đời thường, hiện đại'),
('Lịch sử', 'Truyện cổ trang, lịch sử'),
('Khoa huyễn', 'Truyện khoa học viễn tưởng'),
('Đồng nhân', 'Truyện đồng nhân'),
('Kỳ ảo', 'Truyện kỳ ảo, thần thoại'),
('Trinh thám', 'Truyện trinh thám, hình sự'),
('Ngôn tình', 'Truyện tình cảm, lãng mạn');
