/**
 * Database Migration Runner: 003_prd_v1_1_standardization
 * Chuẩn hóa cơ sở dữ liệu MySQL theo PRD v1.1.0 mà không làm mất dữ liệu.
 */
const mysql = require('./mysql')

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  )
  return rows[0].cnt > 0
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  )
  return rows[0].cnt > 0
}

async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE as column_type FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  )
  return rows[0] ? String(rows[0].column_type).toLowerCase() : ''
}

async function runMigration() {
  console.log('🚀 Bắt đầu quá trình Migration cơ sở dữ liệu lên v1.1.0...')
  const pool = await mysql.initPool()
  const conn = await pool.getConnection()

  try {
    // ==========================================================
    // 1. Cập nhật bảng users
    // ==========================================================
    console.log('📦 [1/6] Kiểm tra & Chuẩn hóa bảng `users`...')
    if (!(await columnExists(conn, 'users', 'firebase_uid'))) {
      await conn.query('ALTER TABLE users ADD COLUMN firebase_uid VARCHAR(128) NULL AFTER password_hash')
      console.log('  + Đã thêm cột `firebase_uid` vào bảng `users`')
    } else {
      console.log('  . Cột `firebase_uid` đã tồn tại')
    }

    if (!(await columnExists(conn, 'users', 'auth_method'))) {
      await conn.query('ALTER TABLE users ADD COLUMN auth_method VARCHAR(20) NULL DEFAULT "email" AFTER firebase_uid')
      console.log('  + Đã thêm cột `auth_method` vào bảng `users`')
    } else {
      console.log('  . Cột `auth_method` đã tồn tại')
    }

    if (!(await indexExists(conn, 'users', 'uk_users_firebase_uid'))) {
      await conn.query('ALTER TABLE users ADD UNIQUE KEY uk_users_firebase_uid (firebase_uid)')
      console.log('  + Đã tạo UNIQUE index `uk_users_firebase_uid` cho bảng `users`')
    } else {
      console.log('  . Index `uk_users_firebase_uid` đã tồn tại')
    }

    // ==========================================================
    // 2. Cập nhật bảng stories
    // ==========================================================
    console.log('📦 [2/6] Kiểm tra & Chuẩn hóa bảng `stories`...')
    if (!(await columnExists(conn, 'stories', 'free_chapters'))) {
      await conn.query('ALTER TABLE stories ADD COLUMN free_chapters INT NOT NULL DEFAULT 3 COMMENT "So chuong mien phi cho doc gia"')
      console.log('  + Đã thêm cột `free_chapters` vào bảng `stories`')
    } else {
      console.log('  . Cột `free_chapters` đã tồn tại')
    }

    if (!(await columnExists(conn, 'stories', 'is_hidden'))) {
      await conn.query('ALTER TABLE stories ADD COLUMN is_hidden TINYINT(1) NOT NULL DEFAULT 0')
      console.log('  + Đã thêm cột `is_hidden` vào bảng `stories`')
    } else {
      console.log('  . Cột `is_hidden` đã tồn tại')
    }

    // ==========================================================
    // 3. Cập nhật bảng comments (Ops & Moderation Agent)
    // ==========================================================
    console.log('📦 [3/6] Kiểm tra & Chuẩn hóa bảng `comments`...')
    if (!(await columnExists(conn, 'comments', 'moderation_label'))) {
      await conn.query('ALTER TABLE comments ADD COLUMN moderation_label VARCHAR(32) NOT NULL DEFAULT "clean"')
      console.log('  + Đã thêm cột `moderation_label` vào bảng `comments`')
    } else {
      console.log('  . Cột `moderation_label` đã tồn tại')
    }

    if (!(await columnExists(conn, 'comments', 'is_spoiler'))) {
      await conn.query('ALTER TABLE comments ADD COLUMN is_spoiler TINYINT(1) NOT NULL DEFAULT 0')
      console.log('  + Đã thêm cột `is_spoiler` vào bảng `comments`')
    } else {
      console.log('  . Cột `is_spoiler` đã tồn tại')
    }

    if (!(await columnExists(conn, 'comments', 'agent_reason'))) {
      await conn.query('ALTER TABLE comments ADD COLUMN agent_reason VARCHAR(255) NULL')
      console.log('  + Đã thêm cột `agent_reason` vào bảng `comments`')
    } else {
      console.log('  . Cột `agent_reason` đã tồn tại')
    }

    // ==========================================================
    // 4. Tạo các bảng mới theo PRD v1.1.0
    // ==========================================================
    console.log('📦 [4/6] Tạo các bảng mới theo PRD v1.1.0...')

    // topup_intents
    await conn.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('  + Bảng `topup_intents` sẵn sàng.')

    // chapter_recaps
    await conn.query(`
      CREATE TABLE IF NOT EXISTS chapter_recaps (
        recap_id INT AUTO_INCREMENT PRIMARY KEY,
        chapter_id BIGINT UNSIGNED NOT NULL,
        recap_text TEXT NOT NULL,
        model_name VARCHAR(64) NOT NULL DEFAULT 'grok-beta',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_chapter_recap (chapter_id),
        CONSTRAINT fk_recaps_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('  + Bảng `chapter_recaps` giữ lại như cache cũ, không phải luồng Dual-Agent.')

    // reading_starts
    await conn.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('  + Bảng `reading_starts` sẵn sàng.')

    // reading_history (canonical last-read progress)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reading_history (
        history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        story_id VARCHAR(191) NOT NULL,
        chapter_id VARCHAR(191) NULL,
        chapter_no INT NULL,
        progress_pct DECIMAL(5,2) NULL,
        last_read_at DATETIME NULL,
        KEY idx_history_user (user_id, last_read_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    if (!(await columnExists(conn, 'reading_history', 'chapter_no'))) {
      await conn.query('ALTER TABLE reading_history ADD COLUMN chapter_no INT NULL')
      console.log('  + Đã thêm cột `chapter_no` vào `reading_history`')
    }
    if (!(await columnExists(conn, 'reading_history', 'progress_pct'))) {
      await conn.query('ALTER TABLE reading_history ADD COLUMN progress_pct DECIMAL(5,2) NULL')
      console.log('  + Đã thêm cột `progress_pct` vào `reading_history`')
    }
    if (!(await indexExists(conn, 'reading_history', 'uq_history_user_story'))) {
      try {
        await conn.query('ALTER TABLE reading_history ADD UNIQUE KEY uq_history_user_story (user_id, story_id)')
        console.log('  + Đã tạo UNIQUE `uq_history_user_story` cho `reading_history`')
      } catch (e) {
        console.log('  . Bỏ qua UNIQUE `reading_history` (có thể còn dòng trùng user+story)')
      }
    }
    console.log('  + Bảng `reading_history` sẵn sàng.')

    // withdrawals
    await conn.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('  + Bảng `withdrawals` sẵn sàng.')

    // author_applications
    await conn.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('  + Bảng `author_applications` sẵn sàng.')

    // ==========================================================
    // 5. Khởi tạo / Bổ sung dữ liệu hạt giống thể loại nếu trống
    // ==========================================================
    console.log('📦 [5/6] Đồng bộ danh mục thể loại chuẩn (Genres)...')
    await conn.query(`
      INSERT IGNORE INTO genres (name, description) VALUES
      ('Tiên hiệp', 'Truyện tu tiên, tu chân, phi thăng'),
      ('Kiếm hiệp', 'Truyện võ hiệp giang hồ, kiếm khách anh hùng'),
      ('Huyền huyễn', 'Thế giới huyền bí, dị giới, ma pháp tu luyện'),
      ('Đô thị', 'Bối cảnh cuộc sống hiện đại, thương trường, đời thường'),
      ('Lịch sử', 'Dã sử, cung đấu, chiến tranh lịch sử và quân sự'),
      ('Khoa huyễn', 'Khoa học viễn tưởng, không gian, mạt thế tương lai'),
      ('Đồng nhân', 'Phóng tác dựa trên tác phẩm, nhân vật nổi tiếng có sẵn'),
      ('Kỳ ảo', 'Thần thoại phương Tây, sinh vật huyền bí, phiêu lưu'),
      ('Trinh thám', 'Phá án, suy luận logic, tâm lý tội phạm'),
      ('Ngôn tình', 'Tình cảm đôi lứa ngọt ngào hoặc trắc trở, thanh xuân')
    `)
    console.log('  + Danh mục thể loại đã được đồng bộ.')

    // ==========================================================
    // 6. Dual-Agent schema (CP-1). Không tạo plagiarism_checks.
    // ==========================================================
    console.log('📦 [6/7] Dual-Agent: bảng mới và cột trạng thái...')

    if (!(await columnExists(conn, 'chapters', 'status'))) {
      await conn.query(`ALTER TABLE chapters ADD COLUMN status ENUM('draft', 'pending_review', 'published', 'rejected') NOT NULL DEFAULT 'published'`)
      console.log('  + Đã thêm `chapters.status`')
    } else {
      console.log('  . `chapters.status` đã tồn tại')
    }

    if (!(await columnExists(conn, 'chapters', 'content_format'))) {
      await conn.query("ALTER TABLE chapters ADD COLUMN content_format VARCHAR(20) NOT NULL DEFAULT 'html'")
      console.log('  + Đã thêm `chapters.content_format` để phân biệt HTML crawl và plain text tác giả nhập')
    } else {
      console.log('  . `chapters.content_format` đã tồn tại')
    }

    if (!(await columnExists(conn, 'comments', 'toxicity_score'))) {
      await conn.query('ALTER TABLE comments ADD COLUMN toxicity_score FLOAT NOT NULL DEFAULT 0')
      console.log('  + Đã thêm `comments.toxicity_score`')
    } else {
      console.log('  . `comments.toxicity_score` đã tồn tại')
    }

    const commentStatus = await columnType(conn, 'comments', 'status')
    const shadowbanEnum = "enum('pending','approved','shadowbanned','rejected')"
    if (commentStatus !== shadowbanEnum) {
      await conn.query(`UPDATE comments SET status = 'approved' WHERE status IS NULL OR status = ''`)
      await conn.query(`UPDATE comments SET status = 'rejected' WHERE status NOT IN ('pending', 'approved', 'shadowbanned', 'rejected')`)
      await conn.query(`ALTER TABLE comments MODIFY COLUMN status ENUM('pending', 'approved', 'shadowbanned', 'rejected') NOT NULL DEFAULT 'approved'`)
      console.log('  + `comments.status` nhận giá trị shadowbanned')
    } else {
      console.log('  . `comments.status` đã có shadowbanned')
    }

    if (!(await indexExists(conn, 'stories', 'ft_story_search'))) {
      await conn.query('ALTER TABLE stories ADD FULLTEXT INDEX ft_story_search (title, description)')
      console.log('  + Đã tạo FULLTEXT `ft_story_search`')
    } else {
      console.log('  . FULLTEXT `ft_story_search` đã tồn tại')
    }

    await conn.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NULL,
        title VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_conv_user (user_id),
        CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await conn.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await conn.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await conn.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('  + story_summary_cache, conversations, messages, chapter_fingerprints, moderation_logs sẵn sàng.')

    const [donationTable] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donations'`
    )
    if (donationTable[0] && Number(donationTable[0].cnt) > 0) {
      if (!(await columnExists(conn, 'donations', 'gift_code'))) {
        await conn.query('ALTER TABLE donations ADD COLUMN gift_code VARCHAR(32) NULL')
        console.log('  + Đã thêm `donations.gift_code`')
      }
      if (!(await columnExists(conn, 'donations', 'gift_name'))) {
        await conn.query('ALTER TABLE donations ADD COLUMN gift_name VARCHAR(64) NULL')
        console.log('  + Đã thêm `donations.gift_name`')
      }
      if (!(await columnExists(conn, 'donations', 'quantity'))) {
        await conn.query('ALTER TABLE donations ADD COLUMN quantity INT NOT NULL DEFAULT 1')
        console.log('  + Đã thêm `donations.quantity`')
      }
    }

    // ==========================================================
    // 7. Kiểm tra tính toàn vẹn (Schema Integrity Check)
    // ==========================================================
    console.log('\n🔍 [7/7] Bắt đầu kiểm tra tính toàn vẹn (Schema Integrity Check)...')

    await require('./ai_store').installSchema(conn)
    const expectedTables = [
      'users', 'authors', 'stories', 'genres', 'story_genres', 'chapters',
      'chapter_recaps', 'comments', 'reading_history',
      'reading_starts', 'likes', 'chapter_views', 'follows', 'author_follows',
      'wallets', 'topup_intents', 'topup_requests', 'payments', 'donations',
      'withdrawals', 'author_applications', 'banners', 'ads', 'notification_state',
      'story_summary_cache', 'conversations', 'messages', 'chapter_fingerprints', 'moderation_logs',
      'ai_usage_logs', 'ai_request_quotas', 'ai_moderation_jobs'
    ]

    const [tableRows] = await conn.query('SHOW TABLES')
    const liveTables = tableRows.map(r => Object.values(r)[0])

    let allOk = true
    for (const tbl of expectedTables) {
      if (liveTables.includes(tbl)) {
        console.log(`  ✓ Bảng [${tbl}] hiện diện`)
      } else {
        console.error(`  ✗ THIẾU BẢNG: [${tbl}]`)
        allOk = false
      }
    }

    if (allOk) {
      console.log(`\n🎉 TOÀN BỘ ${expectedTables.length}/${expectedTables.length} BẢNG ĐÃ SẴN SÀNG.`)
    } else {
      console.warn('\n⚠️ Một số bảng chưa xuất hiện, vui lòng kiểm tra lại log ở trên.')
    }
  } finally {
    conn.release()
  }
}

runMigration()
  .then(() => {
    console.log('\n✨ Database Migration hoàn tất thành công 100%.\n')
    process.exit(0)
  })
  .catch(err => {
    console.error('💥 Migration gặp lỗi:', err)
    process.exit(1)
  })
