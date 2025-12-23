-- Schema for admin-dashboard Reader app
-- Create database before running: CREATE DATABASE reader_admin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Table: genres (categories)
CREATE TABLE IF NOT EXISTS genres (
  genre_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (genre_id),
  UNIQUE KEY uk_genre_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: books
CREATE TABLE IF NOT EXISTS books (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255) DEFAULT '',
  description TEXT DEFAULT NULL,
  genre VARCHAR(100) DEFAULT NULL COMMENT 'Primary genre/category',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: story_genres (junction table for many-to-many relationship)
CREATE TABLE IF NOT EXISTS story_genres (
  story_id BIGINT UNSIGNED NOT NULL,
  genre_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (story_id, genre_id),
  KEY idx_story (story_id),
  KEY idx_genre (genre_id),
  CONSTRAINT fk_story_genre_story FOREIGN KEY (story_id) REFERENCES books(id) ON DELETE CASCADE,
  CONSTRAINT fk_story_genre_genre FOREIGN KEY (genre_id) REFERENCES genres(genre_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: chapters
CREATE TABLE IF NOT EXISTS chapters (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  book_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_book (book_id),
  CONSTRAINT fk_chapter_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sample seed (optional)
-- Insert sample genres
INSERT INTO genres (name, description) VALUES
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

INSERT INTO books (title, author, description, genre) VALUES
('Mẫu: Truyện A', 'Tác giả A', 'Mô tả mẫu cho Truyện A', 'Tiên hiệp');

INSERT INTO chapters (book_id, title, content) VALUES
(1, 'Chương 1', 'Nội dung chương 1...'),
(1, 'Chương 2', 'Nội dung chương 2...');

-- Link story to genres
INSERT INTO story_genres (story_id, genre_id) VALUES
(1, 1);
