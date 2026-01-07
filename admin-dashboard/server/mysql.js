const mysql = require('mysql2/promise')

let pool = null

// Detect whether chapters table links to stories via story_id or book_id.
// Different environments in this project have used different schemas, so we probe once and cache.
let _chaptersFkCol = null
let _chaptersPkCol = null
let _chaptersHasChapterNo = null
let _chaptersContentCol = null

// Follows table schema varies across environments (e.g. follower_id/followee_id vs user_id/story_id).
// Probe once and cache the detected column names.
let _followsIdCol = null
let _followsFollowerCol = null
let _followsFolloweeCol = null
let _followsCreatedAtCol = null

async function getFollowsColumnMap(p) {
  if (_followsIdCol && _followsFollowerCol && _followsFolloweeCol) {
    return {
      idCol: _followsIdCol,
      followerCol: _followsFollowerCol,
      followeeCol: _followsFolloweeCol,
      createdAtCol: _followsCreatedAtCol
    }
  }

  // Defaults (used when table doesn't exist yet or probing fails)
  let idCol = _followsIdCol || 'follow_id'
  let followerCol = _followsFollowerCol || 'follower_id'
  let followeeCol = _followsFolloweeCol || 'followee_id'
  let createdAtCol = _followsCreatedAtCol || 'created_at'

  try {
    const [cols] = await p.execute('SHOW COLUMNS FROM follows')
    const names = new Set((cols || []).map(c => String(c.Field || '').toLowerCase()).filter(Boolean))

    const pick = (candidates, fallback) => {
      for (const c of candidates) {
        if (names.has(c)) return c
      }
      return fallback
    }

    idCol = pick(['follow_id', 'id'], idCol)
    // Prefer canonical names if they exist
    followerCol = pick(['user_id', 'follower_id'], followerCol)
    followeeCol = pick(['story_id', 'book_id', 'followee_id', 'target_id', 'followed_id', 'following_id'], followeeCol)
    createdAtCol = pick(['created_at', 'createdat', 'created_time', 'created_on'], createdAtCol)

    // If createdAtCol is not actually present, treat it as absent.
    if (createdAtCol && !names.has(String(createdAtCol).toLowerCase())) createdAtCol = null
    // If idCol is not present, treat it as absent.
    if (idCol && !names.has(String(idCol).toLowerCase())) idCol = null

    // Cache for future calls
    _followsIdCol = idCol
    _followsFollowerCol = followerCol
    _followsFolloweeCol = followeeCol
    _followsCreatedAtCol = createdAtCol
  } catch (e) {
    // ignore; keep defaults
  }

  return { idCol, followerCol, followeeCol, createdAtCol }
}

async function getChaptersFkCandidates(p) {
  if (_chaptersFkCol) {
    return _chaptersFkCol === 'story_id' ? ['story_id', 'book_id'] : ['book_id', 'story_id']
  }
  try {
    const [cols] = await p.execute('SHOW COLUMNS FROM chapters')
    const names = new Set((cols || []).map(c => String(c.Field || '').toLowerCase()).filter(Boolean))
    if (names.has('story_id')) _chaptersFkCol = 'story_id'
    else if (names.has('book_id')) _chaptersFkCol = 'book_id'
  } catch (e) {
    // ignore; fall back to trying both
  }
  if (_chaptersFkCol) {
    return _chaptersFkCol === 'story_id' ? ['story_id', 'book_id'] : ['book_id', 'story_id']
  }
  return ['story_id', 'book_id']
}

async function getChaptersPkCandidates(p) {
  if (_chaptersPkCol) {
    return _chaptersPkCol === 'chapter_id' ? ['chapter_id', 'id'] : ['id', 'chapter_id']
  }
  try {
    const [cols] = await p.execute('SHOW COLUMNS FROM chapters')
    const names = new Set((cols || []).map(c => String(c.Field || '').toLowerCase()).filter(Boolean))
    if (names.has('chapter_id')) _chaptersPkCol = 'chapter_id'
    else if (names.has('id')) _chaptersPkCol = 'id'
    _chaptersHasChapterNo = names.has('chapter_no')
    const contentCandidates = ['content', 'body', 'text', 'chapter_content', 'chapter_body']
    _chaptersContentCol = contentCandidates.find(c => names.has(c)) || null
  } catch (e) {
    // ignore
  }
  if (_chaptersPkCol) {
    return _chaptersPkCol === 'chapter_id' ? ['chapter_id', 'id'] : ['id', 'chapter_id']
  }
  return ['chapter_id', 'id']
}

async function getChaptersHasChapterNo(p) {
  if (_chaptersHasChapterNo !== null) return !!_chaptersHasChapterNo
  try { await getChaptersPkCandidates(p) } catch (e) { }
  if (_chaptersHasChapterNo !== null) return !!_chaptersHasChapterNo
  return true
}

async function getChaptersContentColumn(p) {
  if (_chaptersContentCol !== null) return _chaptersContentCol
  try { await getChaptersPkCandidates(p) } catch (e) { }
  return _chaptersContentCol || 'content'
}

async function initPool() {
  if (pool) return pool
  const host = process.env.MYSQL_HOST || '127.0.0.1'
  const port = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306
  const user = process.env.MYSQL_USER || 'root'
  const password = process.env.MYSQL_PASSWORD || '123456'
  const database = process.env.MYSQL_DATABASE || 'app_doc_truyen'

  pool = mysql.createPool({ host, port, user, password, database, waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4' })
  return pool
}

// Ensure stories table has a visibility flag (best-effort, safe to call repeatedly)
async function ensureStoriesHiddenColumn(p) {
  try { await p.execute('ALTER TABLE stories ADD COLUMN is_hidden TINYINT(1) NOT NULL DEFAULT 0') } catch (e) { /* ignore if exists */ }
  try { await p.execute('ALTER TABLE stories MODIFY COLUMN is_hidden TINYINT(1) NOT NULL DEFAULT 0') } catch (e) { /* ignore */ }
}

// Hide or unhide all stories that belong to a given author user id
async function setAuthorStoriesHiddenByUserId(userId, hidden, existingPool = null) {
  if (!userId) return false
  const p = existingPool || await initPool()
  try { await ensureStoriesHiddenColumn(p) } catch (e) { /* ignore */ }
  let authorIds = []
  try {
    const [rows] = await p.execute('SELECT author_id FROM authors WHERE user_id = ?', [userId])
    authorIds = (rows || []).map(r => r.author_id).filter(Boolean)
  } catch (e) {
    return false
  }
  if (!authorIds.length) return false
  const placeholders = authorIds.map(() => '?').join(', ')
  const sql = `UPDATE stories SET is_hidden = ? WHERE author_id IN (${placeholders})`
  const [res] = await p.execute(sql, [hidden ? 1 : 0, ...authorIds])
  return res && res.affectedRows >= 0
}

// Map functions to existing schema (stories, chapters, users, reading_history, authors, categories)
async function getBooks(opts = {}) {
  const userId = opts.userId || null
  const mineOnly = !!opts.mineOnly && !!userId
  const p = await initPool()
  try {
    await ensureStoriesHiddenColumn(p)
    // Ensure tables exist so the LEFT JOIN aggregates don't crash on fresh DBs.
    // (If these tables don't exist yet, the query would throw and we'd fall back to a minimal listing with 0 stats.)
    try {
      await p.execute(`CREATE TABLE IF NOT EXISTS likes (
        like_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(191),
        story_id VARCHAR(191),
        created_at DATETIME
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    } catch (e) { /* ignore */ }
    try {
      await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
        view_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(191),
        story_id VARCHAR(191),
        chapter_id VARCHAR(191),
        viewed_at DATETIME
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    } catch (e) { /* ignore */ }
    const clauses = ['(s.is_hidden IS NULL OR s.is_hidden = 0)']
    if (mineOnly) clauses.push('(a.user_id = ? OR s.author_id = ?)')
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    // Use LEFT JOINs for better performance than per-row subqueries.
    // IMPORTANT: This query must be compatible with sql_mode=ONLY_FULL_GROUP_BY.
    // We therefore aggregate any selected columns not present in GROUP BY using MAX().
    const sql = `
      SELECT
        s.story_id,
        MAX(s.title) as title,
        MAX(s.author_id) as author_id,
        MAX(a.user_id) as author_user_id,
        MAX(a.pen_name) as author_name,
        MAX(s.description) as description,
        MAX(s.cover_image) as cover_image,
        MAX(s.status) as status,
        MAX(s.created_at) as created_at,
        MAX(s.updated_at) as updated_at,
        MAX(s.genre) as genre,
        0 as chapters_count,
        GROUP_CONCAT(DISTINCT g.name SEPARATOR ', ') as genre_names,
        MAX(COALESCE(l.likes_count, 0)) as likes_count,
        MAX(COALESCE(v.views_count, 0)) as views_count
      FROM stories s
      LEFT JOIN authors a ON s.author_id = a.author_id
      LEFT JOIN story_genres sg ON s.story_id = sg.story_id
      LEFT JOIN genres g ON sg.genre_id = g.genre_id
      LEFT JOIN (
        SELECT story_id, COUNT(*) as likes_count
        FROM likes
        GROUP BY story_id
      ) l ON l.story_id = s.story_id
      LEFT JOIN (
        SELECT story_id, COUNT(*) as views_count
        FROM chapter_views
        GROUP BY story_id
      ) v ON v.story_id = s.story_id
      ${where}
      GROUP BY s.story_id
      ORDER BY MAX(s.created_at) DESC
    `
    const [rows] = mineOnly ? await p.query(sql, [userId, userId]) : await p.query(sql)
    console.log('[getBooks] Query succeeded, rows:', rows.length)
    let chapterCounts = {}
    try {
      const ids = (rows || []).map(r => r && r.story_id).filter(Boolean)
      chapterCounts = await getChapterCountsByStoryIds(ids)
    } catch (e) {
      chapterCounts = {}
    }
    return rows.map(r => {
      const genreValue = r.genre_names || r.genre || null
      return {
        story_id: r.story_id,
        id: String(r.story_id),
        title: r.title,
        author_id: r.author_id,
        author_user_id: r.author_user_id,
        author: r.author_name,
        description: r.description,
        cover_image: r.cover_image,
        cover_url: r.cover_image,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        chapters_count: (chapterCounts && chapterCounts[String(r.story_id)] !== undefined) ? chapterCounts[String(r.story_id)] : (r.chapters_count || 0),
        genre: genreValue,
        likes_count: Number(r.likes_count || 0),
        views: Number(r.views_count || 0)
      }
    })
  } catch (e) {
    console.error('[getBooks] Error:', e.message)
    // Fallback - simple query without joins
    const [rows] = await p.query(`
      SELECT s.*
      FROM stories s
      WHERE s.is_hidden IS NULL OR s.is_hidden = 0
      ORDER BY s.created_at DESC
    `)
    let chapterCounts = {}
    try {
      const ids = (rows || []).map(r => r && r.story_id).filter(Boolean)
      chapterCounts = await getChapterCountsByStoryIds(ids)
    } catch (e2) {
      chapterCounts = {}
    }
    return rows.map(r => {
      return {
        story_id: r.story_id,
        id: String(r.story_id),
        title: r.title,
        author_id: r.author_id,
        author_user_id: null,
        author: null,
        description: r.description,
        cover_image: r.cover_image,
        cover_url: r.cover_image,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        chapters_count: (chapterCounts && chapterCounts[String(r.story_id)] !== undefined) ? chapterCounts[String(r.story_id)] : 0,
        genre: r.genre || null,
        likes_count: 0,
        views: 0
      }
    })
  }
}

// Bulk fetch chapter counts for a list of story ids (supports story_id or book_id schemas)
async function getChapterCountsByStoryIds(ids = []) {
  if (!ids || ids.length === 0) return {}
  const p = await initPool()
  const placeholders = ids.map(() => '?').join(', ')
  const candidates = await getChaptersFkCandidates(p)
  let rows = []
  for (const fkCol of candidates) {
    try {
      const [r] = await p.execute(
        `SELECT ${fkCol} AS sid, COUNT(*) AS chapters_count
         FROM chapters
         WHERE ${fkCol} IN (${placeholders})
         GROUP BY ${fkCol}`,
        ids
      )
      rows = r || []
      break
    } catch (e) {
      // try next candidate
    }
  }
  const map = {}
  for (const r of rows || []) {
    map[String(r.sid)] = Number(r.chapters_count || 0)
  }
  return map
}

async function createBook({ title, author, description, cover_url, genre, author_id }) {
  const p = await initPool()
  // guard cover length (column often varchar(255))
  const safeCover = cover_url && cover_url.length > 500 ? null : cover_url
  // prefer explicit author_id (e.g., when creator is an author)
  let author_id_local = author_id || null
  // find or create author by name if provided and no explicit id
  if (!author_id_local && author) {
    const [a] = await p.execute('SELECT author_id FROM authors WHERE pen_name = ? LIMIT 1', [author])
    if (a && a[0]) {
      author_id_local = a[0].author_id
    } else {
      // some schemas include a user_id column on authors which may be NOT NULL
      // pick an existing admin user or any user as the author.user_id
      let authorUserId = null
      try {
        const [adm] = await p.execute('SELECT user_id FROM users WHERE role = ? LIMIT 1', ['admin'])
        if (adm && adm[0]) authorUserId = adm[0].user_id
        if (!authorUserId) {
          const [firstUser] = await p.execute('SELECT user_id FROM users LIMIT 1')
          if (firstUser && firstUser[0]) authorUserId = firstUser[0].user_id
        }
      } catch (e) {
        // ignore and leave authorUserId null
      }
      // fallback to 0 if still null (some schemas may accept 0 or have FK disabled)
      const uid = authorUserId || 0
      // if a row for this user_id already exists (unique constraint), reuse it
      try {
        const [existingByUser] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [uid])
        if (existingByUser && existingByUser[0]) {
          author_id_local = existingByUser[0].author_id
        } else {
          const [ins] = await p.execute('INSERT INTO authors (user_id, pen_name, bio, created_at) VALUES (?, ?, ?, NOW())', [uid, author, null])
          author_id_local = ins.insertId
        }
      } catch (e) {
        // if insert failed due to duplicate key on user_id, try to read existing by user_id
        try {
          const [exists] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [uid])
          if (exists && exists[0]) author_id_local = exists[0].author_id
        } catch (ee) {
          // ignore and leave author_id null
        }
      }
    }
  }
  // Some schemas restrict status values; use NULL to allow DB defaults when unsure
  const [res] = await p.execute('INSERT INTO stories (author_id, title, description, status, created_at , cover_image, genre) VALUES (?, ?, ?, ?, NOW(),?,?)', [author_id_local, title, description, null, safeCover || null, genre || null])
  const id = res.insertId
  const [rows] = await p.execute('SELECT * FROM stories WHERE story_id = ?', [id])
  if (!rows || !rows[0]) return null
  const row = rows[0]
  row.id = String(row.story_id)
  return row
}

// Ensure an author row exists for a given user_id; return author_id or null
async function getOrCreateAuthorIdByUserId(userId) {
  if (!userId) return null
  const p = await initPool()
  try {
    const [existing] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [userId])
    if (existing && existing[0]) return existing[0].author_id
  } catch (e) {
    // fall through to ensure table
  }
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS authors (
      author_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      pen_name VARCHAR(191),
      bio TEXT,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  try {
    const [existing] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [userId])
    if (existing && existing[0]) return existing[0].author_id
    // build a fallback pen_name from user profile
    let pen = `Author ${userId}`
    try {
      const [uRows] = await p.execute('SELECT fullname, email FROM users WHERE user_id = ? LIMIT 1', [userId])
      if (uRows && uRows[0]) {
        pen = uRows[0].fullname || uRows[0].email || pen
      }
    } catch (e) { }
    const [ins] = await p.execute('INSERT INTO authors (user_id, pen_name, bio, created_at) VALUES (?, ?, ?, NOW())', [userId, pen || `Author ${userId}`, null])
    return ins.insertId
  } catch (e) {
    try {
      const [existing] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [userId])
      if (existing && existing[0]) return existing[0].author_id
    } catch (ee) { }
    return null
  }
}

async function getBookById(id) {
  const p = await initPool()
  try { await ensureStoriesHiddenColumn(p) } catch (e) { /* ignore */ }
  const [rows] = await p.execute(`
    SELECT s.*, a.user_id as author_user_id, a.pen_name as author_name
    FROM stories s
    LEFT JOIN authors a ON s.author_id = a.author_id
    WHERE s.story_id = ? AND (s.is_hidden IS NULL OR s.is_hidden = 0)
  `, [id])
  if (!rows || rows.length === 0) return null
  const book = rows[0]
  let chapters = []
  try {
    const fkCandidates = await getChaptersFkCandidates(p)
    for (const fkCol of fkCandidates) {
      try {
        const hasNo = await getChaptersHasChapterNo(p)
        if (hasNo) {
          const [crows] = await p.execute(`SELECT * FROM chapters WHERE ${fkCol} = ? ORDER BY chapter_no ASC, created_at ASC`, [id])
          chapters = crows || []
          break
        }
        const [crows] = await p.execute(`SELECT * FROM chapters WHERE ${fkCol} = ? ORDER BY created_at ASC`, [id])
        chapters = crows || []
        break
      } catch (e) {
        // try next fk column / order
        try {
          const [crows2] = await p.execute(`SELECT * FROM chapters WHERE ${fkCol} = ? ORDER BY created_at ASC`, [id])
          chapters = crows2 || []
          break
        } catch (e2) {
          // continue
        }
      }
    }
  } catch (e) {
    chapters = []
  }
  // get genres for this book (gracefully handle if tables don't exist)
  let genres = []
  try {
    const [genreRows] = await p.execute(`
      SELECT g.genre_id, g.name
      FROM story_genres sg
      JOIN genres g ON sg.genre_id = g.genre_id
      WHERE sg.story_id = ?
    `, [id])
    genres = genreRows || []
  } catch (e) {
    // genres tables don't exist yet
  }
  // normalize
  book.id = String(book.story_id)
  book.cover_url = book.cover_image
  book.author_user_id = book.author_user_id || null
  book.author = book.author_name || book.author
  book.chapters = (chapters || []).map(c => ({ ...c, id: String(c.chapter_id || c.id || '') }))
  book.chapters_count = chapters.length
  book.genres = genres.map(g => ({ id: String(g.genre_id), name: g.name }))
  book.genre = genres.map(g => g.name).join(', ') || book.genre
  return book
}

async function createChapter(bookId, { title, content }) {
  const p = await initPool()
  const fkCandidates = await getChaptersFkCandidates(p)
  const pkCandidates = await getChaptersPkCandidates(p)
  const hasNo = await getChaptersHasChapterNo(p)
  const contentCol = await getChaptersContentColumn(p)

  // determine next chapter_no (best-effort)
  let nextNo = 1
  if (hasNo) {
    for (const fkCol of fkCandidates) {
      try {
        const [rows] = await p.execute(`SELECT COALESCE(MAX(chapter_no),0) as max_no FROM chapters WHERE ${fkCol} = ?`, [bookId])
        nextNo = (rows && rows[0] && rows[0].max_no ? rows[0].max_no : 0) + 1
        break
      } catch (e) {
        // try next
      }
    }
  }

  // insert row (schema compatible)
  let insertedId = null
  let insertedPkCol = null
  for (const fkCol of fkCandidates) {
    try {
      if (hasNo) {
        const [res] = await p.execute(
          `INSERT INTO chapters (${fkCol}, chapter_no, title, ${contentCol}, created_at) VALUES (?, ?, ?, ?, NOW())`,
          [bookId, nextNo, title, content]
        )
        insertedId = res.insertId
      } else {
        const [res] = await p.execute(
          `INSERT INTO chapters (${fkCol}, title, ${contentCol}, created_at) VALUES (?, ?, ?, NOW())`,
          [bookId, title, content]
        )
        insertedId = res.insertId
      }
      insertedPkCol = pkCandidates[0]
      break
    } catch (e1) {
      // If content column is wrong, try inserting without content.
      try {
        if (hasNo) {
          const [res2] = await p.execute(
            `INSERT INTO chapters (${fkCol}, chapter_no, title, created_at) VALUES (?, ?, ?, NOW())`,
            [bookId, nextNo, title]
          )
          insertedId = res2.insertId
        } else {
          const [res2] = await p.execute(
            `INSERT INTO chapters (${fkCol}, title, created_at) VALUES (?, ?, NOW())`,
            [bookId, title]
          )
          insertedId = res2.insertId
        }
        insertedPkCol = pkCandidates[0]
        break
      } catch (e2) {
        // try next fk column
      }
    }
  }

  if (!insertedId) return null

  // fetch row by either chapter_id or id
  for (const pkCol of pkCandidates) {
    try {
      const [r2] = await p.execute(`SELECT * FROM chapters WHERE ${pkCol} = ? LIMIT 1`, [insertedId])
      if (r2 && r2[0]) return { ...r2[0], id: String(r2[0].chapter_id || r2[0].id || insertedId) }
    } catch (e) {
      // try next
    }
  }
  return null
}

async function getChaptersByBook(bookId) {
  const p = await initPool()
  let rows = []
  const fkCandidates = await getChaptersFkCandidates(p)
  for (const fkCol of fkCandidates) {
    try {
      const hasNo = await getChaptersHasChapterNo(p)
      if (hasNo) {
        const [r] = await p.execute(`SELECT * FROM chapters WHERE ${fkCol} = ? ORDER BY chapter_no ASC, created_at ASC`, [bookId])
        rows = r || []
        break
      }
      const [r] = await p.execute(`SELECT * FROM chapters WHERE ${fkCol} = ? ORDER BY created_at ASC`, [bookId])
      rows = r || []
      break
    } catch (e) {
      try {
        const [r2] = await p.execute(`SELECT * FROM chapters WHERE ${fkCol} = ? ORDER BY created_at ASC`, [bookId])
        rows = r2 || []
        break
      } catch (e2) {
        // continue
      }
    }
  }
  return (rows || []).map(r => {
    const content = r.content || r.body || r.text || r.chapter_content || r.chapter_body || ''
    return {
      id: String(r.chapter_id || r.id || ''),
      chapter_no: r.chapter_no || r.chapterNo || null,
      title: r.title || null,
      content,
      created_at: r.created_at || null,
    }
  })
}

async function getChapterById(bookId, chapterId) {
  const p = await initPool()
  const fkCandidates = await getChaptersFkCandidates(p)
  const pkCandidates = await getChaptersPkCandidates(p)
  let r = null
  for (const fkCol of fkCandidates) {
    for (const pkCol of pkCandidates) {
      try {
        const [rows] = await p.execute(`SELECT * FROM chapters WHERE ${fkCol} = ? AND ${pkCol} = ? LIMIT 1`, [bookId, chapterId])
        if (rows && rows[0]) { r = rows[0]; break }
      } catch (e) {
        // try next
      }
    }
    if (r) break
  }
  if (!r) return null
  const content = r.content || r.body || r.text || r.chapter_content || r.chapter_body || ''
  return {
    id: String(r.chapter_id || r.id || ''),
    chapter_no: r.chapter_no || r.chapterNo || null,
    title: r.title || null,
    content,
    created_at: r.created_at || null,
  }
}

// Lookup chapter by its sequence number (chapter_no) within a story
async function getChapterByNumber(bookId, chapterNo) {
  const p = await initPool()
  try {
    const fkCandidates = await getChaptersFkCandidates(p)
    const hasNo = await getChaptersHasChapterNo(p)
    if (!hasNo) return null
    let r = null
    for (const fkCol of fkCandidates) {
      try {
        const [rows] = await p.execute(`SELECT * FROM chapters WHERE ${fkCol} = ? AND chapter_no = ? LIMIT 1`, [bookId, chapterNo])
        if (rows && rows[0]) { r = rows[0]; break }
      } catch (e) {
        // try next
      }
    }
    if (!r) return null
    const content = r.content || r.body || r.text || r.chapter_content || r.chapter_body || ''
    return {
      id: String(r.chapter_id || r.id || ''),
      chapter_no: r.chapter_no || r.chapterNo || null,
      title: r.title || null,
      content,
      created_at: r.created_at || null,
    }
  } catch (e) {
    return null
  }
}

async function updateChapter(id, { title, content }) {
  const p = await initPool()
  const parts = []
  const params = []
  if (title !== undefined) { parts.push('title = ?'); params.push(title) }
  if (content !== undefined) {
    const contentCol = await getChaptersContentColumn(p)
    parts.push(`${contentCol} = ?`)
    params.push(content)
  }
  if (parts.length === 0) return null
  const pkCandidates = await getChaptersPkCandidates(p)
  for (const pkCol of pkCandidates) {
    try {
      const sql = `UPDATE chapters SET ${parts.join(', ')} WHERE ${pkCol} = ?`
      const runParams = [...params, id]
      await p.execute(sql, runParams)
      const [rows] = await p.execute(`SELECT * FROM chapters WHERE ${pkCol} = ? LIMIT 1`, [id])
      return rows && rows[0] ? { ...rows[0], id: String(rows[0].chapter_id || rows[0].id || '') } : null
    } catch (e) {
      // try next pk
    }
  }
  return null
}

async function deleteChapter(id) {
  const p = await initPool()
  const pkCandidates = await getChaptersPkCandidates(p)
  for (const pkCol of pkCandidates) {
    try {
      const [res] = await p.execute(`DELETE FROM chapters WHERE ${pkCol} = ?`, [id])
      return { affectedRows: res.affectedRows }
    } catch (e) {
      // try next
    }
  }
  return { affectedRows: 0 }
}

async function getStats() {
  const p = await initPool()
  const stats = {}
  try {
    const [b] = await p.execute('SELECT COUNT(*) as cnt FROM stories')
    stats.books = b && b[0] ? Number(b[0].cnt) : 0
  } catch (e) { stats.books = 0 }
  try {
    const [u] = await p.execute('SELECT COUNT(*) as cnt FROM users')
    stats.users = u && u[0] ? Number(u[0].cnt) : 0
  } catch (e) { stats.users = 0 }
  try {
    const [c] = await p.execute('SELECT COUNT(*) as cnt FROM chapters')
    stats.chapters = c && c[0] ? Number(c[0].cnt) : 0
  } catch (e) { stats.chapters = 0 }
  try {
    const [bn] = await p.execute('SELECT COUNT(*) as cnt FROM banners')
    stats.banners = bn && bn[0] ? Number(bn[0].cnt) : 0
  } catch (e) { stats.banners = 0 }
  try {
    const [cm] = await p.execute('SELECT COUNT(*) as cnt FROM comments')
    stats.comments = cm && cm[0] ? Number(cm[0].cnt) : 0
  } catch (e) { stats.comments = 0 }
  try {
    // try to compute income from payments table if exists
    const [pay] = await p.execute("SELECT COALESCE(SUM(amount),0) as income FROM payments")
    stats.income = pay && pay[0] ? Number(pay[0].income) : 0
  } catch (e) {
    // if payments table doesn't exist, fallback to 0
    stats.income = 0
  }
  // income this month
  try {
    const [payMonth] = await p.execute("SELECT COALESCE(SUM(amount),0) as income FROM payments WHERE YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW())")
    stats.income_this_month = payMonth && payMonth[0] ? Number(payMonth[0].income) : 0
  } catch (e) {
    stats.income_this_month = 0
  }
  // active users: in last 24 hours and last 15 minutes (using reading_history.last_read_at)
  try {
    const [a24] = await p.execute("SELECT COUNT(DISTINCT user_id) as cnt FROM reading_history WHERE last_read_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")
    stats.active_users_24h = a24 && a24[0] ? Number(a24[0].cnt) : 0
  } catch (e) { stats.active_users_24h = 0 }
  try {
    const [a15] = await p.execute("SELECT COUNT(DISTINCT user_id) as cnt FROM reading_history WHERE last_read_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)")
    stats.active_users_15m = a15 && a15[0] ? Number(a15[0].cnt) : 0
  } catch (e) { stats.active_users_15m = 0 }
  // try to compute top read books using reading_history as proxy
  try {
    const [tops] = await p.execute(`
      SELECT s.story_id as id, s.title as title, COUNT(r.history_id) as readers
      FROM reading_history r
      JOIN stories s ON r.story_id = s.story_id
      GROUP BY r.story_id
      ORDER BY readers DESC
      LIMIT 6
    `)
    stats.top_books = (tops || []).map(r => ({ id: String(r.id), title: r.title, readers: Number(r.readers) }))
  } catch (e) {
    stats.top_books = []
  }

  // new users: today and last 7 days
  try {
    const [newToday] = await p.execute("SELECT COUNT(*) as cnt FROM users WHERE DATE(created_at) = CURDATE()")
    stats.new_users_today = newToday && newToday[0] ? Number(newToday[0].cnt) : 0
  } catch (e) { stats.new_users_today = 0 }
  try {
    const [new7] = await p.execute("SELECT COUNT(*) as cnt FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)")
    stats.new_users_7d = new7 && new7[0] ? Number(new7[0].cnt) : 0
  } catch (e) { stats.new_users_7d = 0 }

  // vip users and authors counts
  try {
    const [vip] = await p.execute("SELECT COUNT(*) as cnt FROM users WHERE role IN ('vip','premium')")
    stats.vip_users = vip && vip[0] ? Number(vip[0].cnt) : 0
  } catch (e) { stats.vip_users = 0 }
  try {
    const [auth] = await p.execute("SELECT COUNT(*) as cnt FROM users WHERE role = 'author'")
    stats.authors = auth && auth[0] ? Number(auth[0].cnt) : 0
  } catch (e) { stats.authors = 0 }
  return stats
}

async function createUser({ email, password_hash, name, role }) {
  const p = await initPool()
  // default role to 'user' (lowercase) if not provided
  const roleToSet = role ? String(role).toLowerCase() : 'user'
  // attempt to insert role if column exists; fall back if not
  try {
    const [res] = await p.execute('INSERT INTO users (fullname, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, NOW())', [name || null, email, password_hash, roleToSet])
    const id = res.insertId
    const [rows] = await p.execute('SELECT user_id as id, fullname, email, avatar_url, role, created_at FROM users WHERE user_id = ?', [id])
    if (!rows || !rows[0]) return null
    return { id: String(rows[0].id), email: rows[0].email, name: rows[0].fullname, role: rows[0].role }
  } catch (err) {
    // if users table doesn't have role column, insert without role and ignore
    const [res] = await p.execute('INSERT INTO users (fullname, email, password_hash, created_at) VALUES (?, ?, ?, NOW())', [name || null, email, password_hash])
    const id = res.insertId
    const [rows] = await p.execute('SELECT user_id as id, fullname, email, avatar_url, created_at FROM users WHERE user_id = ?', [id])
    if (!rows || !rows[0]) return null
    return { id: String(rows[0].id), email: rows[0].email, name: rows[0].fullname }
  }
}

async function getUserByEmail(email) {
  const p = await initPool()
  const [rows] = await p.execute('SELECT * FROM users WHERE email = ?', [email])
  if (!rows || !rows[0]) return null
  const refreshed = await refreshUserVipStatus(rows[0].user_id)
  if (refreshed) {
    rows[0].role = refreshed.role
    rows[0].vip_until = refreshed.vip_until
  }
  return rows[0]
}

// reading_history as progress/bookmark store
async function createBookmark({ user_id, book_id, chapter_id, position, note }) {
  const p = await initPool()
  // map to reading_history by inserting a row representing last read
  const last_read_at = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const [res] = await p.execute('INSERT INTO reading_history (user_id, story_id, chapter_id, last_read_at) VALUES (?, ?, ?, ?)', [user_id, book_id, chapter_id || null, last_read_at])
  const id = res.insertId
  const [rows] = await p.execute('SELECT * FROM reading_history WHERE history_id = ?', [id])
  return rows && rows[0] ? rows[0] : null
}

async function getBookmarksByUser(userId) {
  const p = await initPool()
  const [rows] = await p.execute('SELECT * FROM reading_history WHERE user_id = ? ORDER BY last_read_at DESC', [userId])
  return rows
}

// Fetch author row by user_id
async function getAuthorByUserId(userId) {
  const p = await initPool()
  try {
    const [rows] = await p.execute('SELECT author_id, user_id, pen_name, bio, created_at FROM authors WHERE user_id = ? LIMIT 1', [userId])
    return rows && rows[0] ? rows[0] : null
  } catch (e) {
    return null
  }
}

async function upsertProgress({ user_id, book_id, chapter_id, progress }) {
  const p = await initPool()
  const last_read_at = new Date().toISOString().slice(0, 19).replace('T', ' ')
  // attempt update
  const [upd] = await p.execute('UPDATE reading_history SET chapter_id = ?, last_read_at = ? WHERE user_id = ? AND story_id = ?', [chapter_id || null, last_read_at, user_id, book_id])
  if (upd && upd.affectedRows && upd.affectedRows > 0) {
    const [rows] = await p.execute('SELECT * FROM reading_history WHERE user_id = ? AND story_id = ?', [user_id, book_id])
    return rows && rows[0] ? rows[0] : null
  }
  const [ins] = await p.execute('INSERT INTO reading_history (user_id, story_id, chapter_id, last_read_at) VALUES (?, ?, ?, ?)', [user_id, book_id, chapter_id || null, last_read_at])
  const [rows] = await p.execute('SELECT * FROM reading_history WHERE history_id = ?', [ins.insertId])
  return rows && rows[0] ? rows[0] : null
}

async function getProgressByUserBook(userId, bookId) {
  const p = await initPool()
  const [rows] = await p.execute('SELECT * FROM reading_history WHERE user_id = ? AND story_id = ?', [userId, bookId])
  return rows && rows[0] ? rows[0] : null
}

module.exports = {
  initPool,
  getBooks,
  createBook,
  getBookById,
  createChapter,
  getChaptersByBook,
  updateChapter,
  deleteChapter,
  getChapterById,
  createUser,
  getUserByEmail,
  getUserById,
  // new
  getUsers,
  updateBook,
  deleteBook,
  updateUser,
  deleteUser,
  updateBookCover,
  createBookmark,
  getBookmarksByUser,
  upsertProgress,
  getProgressByUserBook,
  getChapterCountsByStoryIds,
  getAuthorByUserId,
  getOrCreateAuthorIdByUserId,
  getStats
}

// Banners table helpers
async function getBanners() {
  const p = await initPool()
  const [rows] = await p.execute('SELECT banner_id as id, title, image_url, link, enabled, created_at FROM banners ORDER BY created_at DESC')
  return rows.map(r => ({ id: String(r.id), title: r.title, image_url: r.image_url, link: r.link, enabled: !!r.enabled, created_at: r.created_at }))
}

async function createBanner({ title, image_url, link, enabled }) {
  const p = await initPool()
  const [res] = await p.execute('INSERT INTO banners (title, image_url, link, enabled, created_at) VALUES (?, ?, ?, ?, NOW())', [title || null, image_url || null, link || null, enabled ? 1 : 0])
  const id = res.insertId
  const [rows] = await p.execute('SELECT banner_id as id, title, image_url, link, enabled, created_at FROM banners WHERE banner_id = ?', [id])
  return rows && rows[0] ? { id: String(rows[0].id), title: rows[0].title, image_url: rows[0].image_url, link: rows[0].link, enabled: !!rows[0].enabled, created_at: rows[0].created_at } : null
}

async function updateBanner(id, { title, image_url, link, enabled }) {
  const p = await initPool()
  const parts = []
  const params = []
  if (title !== undefined) { parts.push('title = ?'); params.push(title) }
  if (image_url !== undefined) { parts.push('image_url = ?'); params.push(image_url) }
  if (link !== undefined) { parts.push('link = ?'); params.push(link) }
  if (enabled !== undefined) { parts.push('enabled = ?'); params.push(enabled ? 1 : 0) }
  if (parts.length === 0) return null
  params.push(id)
  const sql = `UPDATE banners SET ${parts.join(', ')} WHERE banner_id = ?`
  const [res] = await p.execute(sql, params)
  const [rows] = await p.execute('SELECT banner_id as id, title, image_url, link, enabled, created_at FROM banners WHERE banner_id = ?', [id])
  return rows && rows[0] ? { id: String(rows[0].id), title: rows[0].title, image_url: rows[0].image_url, link: rows[0].link, enabled: !!rows[0].enabled, created_at: rows[0].created_at } : null
}

async function deleteBanner(id) {
  const p = await initPool()
  const [res] = await p.execute('DELETE FROM banners WHERE banner_id = ?', [id])
  return { affectedRows: res.affectedRows }
}

module.exports.getBanners = getBanners
module.exports.createBanner = createBanner
module.exports.updateBanner = updateBanner
module.exports.deleteBanner = deleteBanner

// Video Ads table helpers
async function ensureAdsTable(p) {
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS ads (
      ad_id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) DEFAULT NULL,
      video_url VARCHAR(500) DEFAULT NULL,
      link VARCHAR(500) DEFAULT NULL,
      placement VARCHAR(50) DEFAULT 'interstitial',
      enabled TINYINT(1) DEFAULT 1,
      created_at DATETIME,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
}

async function getAds(opts = {}) {
  const p = await initPool()
  await ensureAdsTable(p)
  const placement = opts.placement ? String(opts.placement) : null
  const admin = !!opts.admin

  const clauses = []
  const params = []
  if (!admin) clauses.push('enabled = 1')
  if (placement) { clauses.push('placement = ?'); params.push(placement) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const [rows] = await p.execute(
    `SELECT ad_id as id, title, video_url, link, placement, enabled, created_at, updated_at
     FROM ads
     ${where}
     ORDER BY COALESCE(updated_at, created_at) DESC, ad_id DESC`,
    params
  )
  return (rows || []).map(r => ({
    id: String(r.id),
    title: r.title,
    video_url: r.video_url,
    link: r.link,
    placement: r.placement || 'interstitial',
    enabled: !!r.enabled,
    created_at: r.created_at,
    updated_at: r.updated_at
  }))
}

async function createAd({ title, video_url, link, placement, enabled }) {
  const p = await initPool()
  await ensureAdsTable(p)
  const plc = placement ? String(placement).slice(0, 50) : 'interstitial'
  const [res] = await p.execute(
    'INSERT INTO ads (title, video_url, link, placement, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
    [title || null, video_url || null, link || null, plc, enabled ? 1 : 0]
  )
  const id = res.insertId
  const [rows] = await p.execute('SELECT ad_id as id, title, video_url, link, placement, enabled, created_at, updated_at FROM ads WHERE ad_id = ?', [id])
  return rows && rows[0] ? {
    id: String(rows[0].id),
    title: rows[0].title,
    video_url: rows[0].video_url,
    link: rows[0].link,
    placement: rows[0].placement || 'interstitial',
    enabled: !!rows[0].enabled,
    created_at: rows[0].created_at,
    updated_at: rows[0].updated_at
  } : null
}

async function updateAd(id, { title, video_url, link, placement, enabled }) {
  const p = await initPool()
  await ensureAdsTable(p)
  const parts = []
  const params = []
  if (title !== undefined) { parts.push('title = ?'); params.push(title) }
  if (video_url !== undefined) { parts.push('video_url = ?'); params.push(video_url) }
  if (link !== undefined) { parts.push('link = ?'); params.push(link) }
  if (placement !== undefined) { parts.push('placement = ?'); params.push(placement ? String(placement).slice(0, 50) : 'interstitial') }
  if (enabled !== undefined) { parts.push('enabled = ?'); params.push(enabled ? 1 : 0) }
  if (parts.length === 0) return null
  parts.push('updated_at = NOW()')
  params.push(id)
  const sql = `UPDATE ads SET ${parts.join(', ')} WHERE ad_id = ?`
  await p.execute(sql, params)
  const [rows] = await p.execute('SELECT ad_id as id, title, video_url, link, placement, enabled, created_at, updated_at FROM ads WHERE ad_id = ?', [id])
  return rows && rows[0] ? {
    id: String(rows[0].id),
    title: rows[0].title,
    video_url: rows[0].video_url,
    link: rows[0].link,
    placement: rows[0].placement || 'interstitial',
    enabled: !!rows[0].enabled,
    created_at: rows[0].created_at,
    updated_at: rows[0].updated_at
  } : null
}

async function deleteAd(id) {
  const p = await initPool()
  await ensureAdsTable(p)
  const [res] = await p.execute('DELETE FROM ads WHERE ad_id = ?', [id])
  return { affectedRows: res.affectedRows }
}

module.exports.getAds = getAds
module.exports.createAd = createAd
module.exports.updateAd = updateAd
module.exports.deleteAd = deleteAd

async function getUsers() {
  const p = await initPool()
  try {
    // ensure wallets table exists with balance column
    await p.execute(`CREATE TABLE IF NOT EXISTS wallets (
      wallet_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) UNIQUE,
      balance BIGINT DEFAULT 0,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    // include coin balance (if wallet exists) using LEFT JOIN; fall back to 0 when null
    const [rows] = await p.execute(`
      SELECT u.user_id as id, u.fullname, u.email, u.avatar_url, u.role, u.created_at,
             COALESCE(w.balance, 0) as coins
      FROM users u
      LEFT JOIN wallets w ON w.user_id = u.user_id
      ORDER BY u.created_at DESC
    `)
    return rows.map(r => ({ id: String(r.id), fullname: r.fullname, email: r.email, avatar_url: r.avatar_url, role: r.role, created_at: r.created_at, coins: Number(r.coins || 0) }))
  } catch (e) {
    // if wallets table or columns are missing, fall back gracefully without coins to avoid 500
    const [rows] = await p.execute('SELECT user_id as id, fullname, email, avatar_url, role, created_at FROM users ORDER BY created_at DESC')
    return rows.map(r => ({ id: String(r.id), fullname: r.fullname, email: r.email, avatar_url: r.avatar_url, role: r.role, created_at: r.created_at, coins: 0 }))
  }
}

async function getUserById(id) {
  const p = await initPool()
  try {
    await refreshUserVipStatus(id)
    const [rows] = await p.execute('SELECT user_id as id, fullname, email, avatar_url, role, vip_until, created_at FROM users WHERE user_id = ? LIMIT 1', [id])
    return rows && rows[0] ? { id: String(rows[0].id), fullname: rows[0].fullname, email: rows[0].email, avatar_url: rows[0].avatar_url, role: rows[0].role, vip_until: rows[0].vip_until || null, created_at: rows[0].created_at } : null
  } catch (e) {
    // fallback if vip_until column doesn't exist
    const [rows] = await p.execute('SELECT user_id as id, fullname, email, avatar_url, role, created_at FROM users WHERE user_id = ? LIMIT 1', [id])
    return rows && rows[0] ? { id: String(rows[0].id), fullname: rows[0].fullname, email: rows[0].email, avatar_url: rows[0].avatar_url, role: rows[0].role, vip_until: null, created_at: rows[0].created_at } : null
  }
}

async function updateBookCover(id, coverUrl) {
  const p = await initPool()
  try {
    const [res] = await p.execute('UPDATE stories SET cover_image = ? WHERE story_id = ?', [coverUrl, id])
    return res && res.affectedRows ? true : false
  } catch (err) {
    // if column doesn't exist, ignore
    return false
  }
}

async function updateBook(id, { title, author, description, genre }) {
  const p = await initPool()
  // handle author similar to createBook
  let author_id = null
  if (author) {
    const [a] = await p.execute('SELECT author_id FROM authors WHERE pen_name = ? LIMIT 1', [author])
    if (a && a[0]) {
      author_id = a[0].author_id
    } else {
      // some schemas include a user_id column on authors which may be NOT NULL
      // pick an existing admin user or any user as the author.user_id
      let authorUserId = null
      try {
        const [adm] = await p.execute('SELECT user_id FROM users WHERE role = ? LIMIT 1', ['admin'])
        if (adm && adm[0]) authorUserId = adm[0].user_id
        if (!authorUserId) {
          const [firstUser] = await p.execute('SELECT user_id FROM users LIMIT 1')
          if (firstUser && firstUser[0]) authorUserId = firstUser[0].user_id
        }
      } catch (e) {
        // ignore and leave authorUserId null
      }
      // fallback to 0 if still null (some schemas may accept 0 or have FK disabled)
      const uid = authorUserId || 0
      // if a row for this user_id already exists (unique constraint), reuse it
      try {
        const [existingByUser] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [uid])
        if (existingByUser && existingByUser[0]) {
          author_id = existingByUser[0].author_id
        } else {
          const [ins] = await p.execute('INSERT INTO authors (user_id, pen_name, bio, created_at) VALUES (?, ?, ?, NOW())', [uid, author, null])
          author_id = ins.insertId
        }
      } catch (e) {
        try {
          const [exists] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [uid])
          if (exists && exists[0]) author_id = exists[0].author_id
        } catch (ee) { }
      }
    }
  }
  const parts = []
  const params = []
  if (author_id !== null) { parts.push('author_id = ?'); params.push(author_id) }
  if (title !== undefined) { parts.push('title = ?'); params.push(title) }
  if (description !== undefined) { parts.push('description = ?'); params.push(description || null) }
  if (genre !== undefined) { parts.push('genre = ?'); params.push(genre || null) }
  if (parts.length === 0) return getBookById(id)
  params.push(id)
  const sql = `UPDATE stories SET ${parts.join(', ')} WHERE story_id = ?`
  const [res] = await p.execute(sql, params)
  // return updated book
  return getBookById(id)
}

async function deleteBook(id) {
  const p = await initPool()
  // delete chapters then story
  try {
    const fkCandidates = await getChaptersFkCandidates(p)
    for (const fkCol of fkCandidates) {
      try { await p.execute(`DELETE FROM chapters WHERE ${fkCol} = ?`, [id]); break } catch (e) { }
    }
  } catch (e) {
    // ignore
  }
  const [res] = await p.execute('DELETE FROM stories WHERE story_id = ?', [id])
  return { affectedRows: res.affectedRows }
}

async function updateUser(id, { fullname, role, email }) {
  const p = await initPool()
  const roleToSet = role ? String(role).toLowerCase() : null
  const parts = []
  const params = []
  if (fullname !== undefined) { parts.push('fullname = ?'); params.push(fullname) }
  if (email !== undefined) { parts.push('email = ?'); params.push(email) }
  if (roleToSet !== null) { parts.push('role = ?'); params.push(roleToSet) }
  if (parts.length === 0) return null
  params.push(id)
  const sql = `UPDATE users SET ${parts.join(', ')} WHERE user_id = ?`
  const [res] = await p.execute(sql, params)
  const [rows] = await p.execute('SELECT user_id as id, fullname, email, avatar_url, role, created_at FROM users WHERE user_id = ?', [id])
  return rows && rows[0] ? { id: String(rows[0].id), fullname: rows[0].fullname, email: rows[0].email, role: rows[0].role, avatar_url: rows[0].avatar_url, created_at: rows[0].created_at } : null
}

async function ensureUserAvatarColumn(p) {
  try { await p.execute('ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL') } catch (e) { /* ignore */ }
}

async function updateUserAvatar(id, avatarUrl) {
  const p = await initPool()
  await ensureUserAvatarColumn(p)
  const safe = avatarUrl && avatarUrl.length > 500 ? avatarUrl.slice(0, 500) : avatarUrl
  const [res] = await p.execute('UPDATE users SET avatar_url = ? WHERE user_id = ?', [safe, id])
  return res && res.affectedRows ? true : false
}

async function ensureUserPasswordHashColumn(p) {
  try { await p.execute('ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL') } catch (e) { /* ignore */ }
}

// Return password_hash for auth operations (never expose via public APIs)
async function getUserPasswordHashById(id) {
  const p = await initPool()
  await ensureUserPasswordHashColumn(p)
  const [rows] = await p.execute('SELECT password_hash FROM users WHERE user_id = ? LIMIT 1', [id])
  return rows && rows[0] ? (rows[0].password_hash || null) : null
}

async function updateUserPasswordHash(id, passwordHash) {
  const p = await initPool()
  await ensureUserPasswordHashColumn(p)
  const [res] = await p.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [passwordHash, id])
  return res && res.affectedRows ? true : false
}

// Normalize user role based on vip_until expiry; downgrade and hide author stories when expired
async function refreshUserVipStatus(userId) {
  if (!userId) return null
  const p = await initPool()
  try { await ensureUserRoleAndVipUntilColumns(p) } catch (e) { /* ignore */ }
  let row = null
  try {
    const [rows] = await p.execute('SELECT user_id, role, vip_until FROM users WHERE user_id = ? LIMIT 1', [userId])
    row = rows && rows[0] ? rows[0] : null
  } catch (e) {
    return null
  }
  if (!row) return null
  const now = Date.now()
  const expired = row.vip_until ? new Date(row.vip_until).getTime() <= now : false
  if (expired && (row.role === 'vip' || row.role === 'author')) {
    try { await p.execute('UPDATE users SET role = ?, vip_until = NULL WHERE user_id = ?', ['user', userId]) } catch (e) { /* ignore */ }
    if (row.role === 'author') {
      try { await setAuthorStoriesHiddenByUserId(userId, true, p) } catch (e) { /* ignore */ }
    }
    return { role: 'user', vip_until: null }
  }
  return { role: row.role, vip_until: row.vip_until }
}

// Ensure role/vip_until columns exist (best-effort, safe to call repeatedly)
async function ensureUserRoleAndVipUntilColumns(p) {
  try { await p.execute("ALTER TABLE users ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'user'") } catch (e) { /* ignore if exists */ }
  try { await p.execute("ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'user'") } catch (e) { /* ignore if incompatible or already correct */ }
  try { await p.execute('ALTER TABLE users ADD COLUMN vip_until DATETIME NULL') } catch (e) { /* ignore if exists */ }
}

// Update user's VIP status (sets role and vip_until). If columns are missing or truncated, attempt to add/modify them then retry.
async function updateUserVip(id, { months, days, until, role } = {}) {
  const p = await initPool()
  const roleToSet = (role || 'vip').toString().slice(0, 50)
  const monthsToAdd = 1 // fixed to 1 month as requested

  const shouldRetryForSchema = (e) => e && (
    e.code === 'ER_BAD_FIELD_ERROR' ||
    e.code === 'WARN_DATA_TRUNCATED' ||
    e.code === 'ER_TRUNCATED_WRONG_VALUE' ||
    e.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD'
  )

  const runUpdate = async (sql, params) => {
    try {
      const [res] = await p.execute(sql, params)
      return res && res.affectedRows ? true : false
    } catch (e) {
      if (shouldRetryForSchema(e)) {
        await ensureUserRoleAndVipUntilColumns(p)
        const [res2] = await p.execute(sql, params)
        return res2 && res2.affectedRows ? true : false
      }
      throw e
    }
  }

  // compute vip_until based on input
  if (until) {
    const ok = await runUpdate('UPDATE users SET role = ?, vip_until = ? WHERE user_id = ?', [roleToSet, until, id])
    if (roleToSet === 'author') {
      try { await getOrCreateAuthorIdByUserId(id); await setAuthorStoriesHiddenByUserId(id, false, p) } catch (e) { /* ignore */ }
    }
    return ok
  }

  const ok = await runUpdate('UPDATE users SET role = ?, vip_until = DATE_ADD(NOW(), INTERVAL ? MONTH) WHERE user_id = ?', [roleToSet, monthsToAdd, id])
  if (roleToSet === 'author') {
    try { await getOrCreateAuthorIdByUserId(id); await setAuthorStoriesHiddenByUserId(id, false, p) } catch (e) { /* ignore */ }
  }
  return ok
}

async function deleteUser(id) {
  const p = await initPool()
  const [res] = await p.execute('DELETE FROM users WHERE user_id = ?', [id])
  return { affectedRows: res.affectedRows }
}

// Comments helpers
async function ensureCommentsTable(p) {
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS comments (
      comment_id INT AUTO_INCREMENT PRIMARY KEY,
      story_id VARCHAR(191),
      user_id VARCHAR(191),
      parent_id INT NULL,
      content TEXT,
      enabled TINYINT DEFAULT 1,
      status VARCHAR(32) DEFAULT 'pending',
      is_negative TINYINT DEFAULT 0,
      negative_probability INT DEFAULT 0,
      reviewed_by VARCHAR(191) NULL,
      reviewed_at DATETIME NULL,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
  // best-effort schema upgrades for legacy tables
  try { await p.execute('ALTER TABLE comments ADD COLUMN parent_id INT NULL') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN status VARCHAR(32) DEFAULT "pending"') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN reviewed_by VARCHAR(191) NULL') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN reviewed_at DATETIME NULL') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN enabled TINYINT DEFAULT 1') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN is_negative TINYINT DEFAULT 0') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN negative_probability INT DEFAULT 0') } catch (e) { }
  try { await p.execute('UPDATE comments SET status = "approved" WHERE status IS NULL') } catch (e) { }
}

async function getComments(bookId, opts = {}) {
  const p = await initPool()
  await ensureCommentsTable(p)
  const includeAll = !!opts.includeAll
  const statusFilter = opts.status
  const limit = opts.limit ? Number(opts.limit) : null
  const offset = opts.offset ? Number(opts.offset) : null
  try {
    const params = []
    const where = []
    if (bookId) { where.push('c.story_id = ?'); params.push(bookId) }
    if (!includeAll && statusFilter) { where.push('c.status = ?'); params.push(statusFilter) }
    else if (!includeAll) { where.push('c.status = "approved"') }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
    const limitSql = limit ? ' LIMIT ' + limit + (offset ? ' OFFSET ' + offset : '') : ''
    const [rows] = await p.execute(`
      SELECT c.comment_id as id, c.story_id, c.user_id, c.parent_id, c.content, c.enabled, c.status, c.is_negative, c.reviewed_by, c.reviewed_at, c.created_at,
             u.fullname as user_name, u.avatar_url as user_avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.user_id
      ${whereSql} ORDER BY c.created_at DESC${limitSql}`, params)
    return rows.map(r => ({
      id: String(r.id),
      story_id: String(r.story_id),
      user_id: String(r.user_id),
      user_name: r.user_name || null,
      user_avatar: r.user_avatar || null,
      parent_id: r.parent_id ? String(r.parent_id) : null,
      content: r.content,
      enabled: !!r.enabled,
      status: r.status || 'approved',
      is_negative: !!r.is_negative,
      reviewed_by: r.reviewed_by || null,
      reviewed_at: r.reviewed_at || null,
      created_at: r.created_at
    }))
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === '42S02')) {
      await ensureCommentsTable(p)
      return []
    }
    throw e
  }
}

async function createComment(bookId, { user_id, content, parent_id, is_negative, negative_probability }) {
  const p = await initPool()
  await ensureCommentsTable(p)

  const runInsert = async () => {
    const [res] = await p.execute(
      'INSERT INTO comments (story_id, user_id, parent_id, content, enabled, status, is_negative, negative_probability, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [bookId, user_id, parent_id || null, content, 1, 'approved', is_negative || 0, negative_probability || 0]
    )
    return res
  }

  let res
  try {
    res = await runInsert()
  } catch (e) {
    // if columns missing (legacy table), try to add then retry once
    if (e && (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_FIELD' || e.code === 'ER_NO_DEFAULT_FOR_FIELD')) {
      await ensureCommentsTable(p)
      res = await runInsert()
    } else {
      throw e
    }
  }

  const id = res.insertId
  const [rows] = await p.execute('SELECT comment_id as id, story_id, user_id, parent_id, content, enabled, status, is_negative, negative_probability, reviewed_by, reviewed_at, created_at FROM comments WHERE comment_id = ?', [id])
  return rows && rows[0] ? {
    id: String(rows[0].id),
    story_id: String(rows[0].story_id),
    user_id: String(rows[0].user_id),
    parent_id: rows[0].parent_id ? String(rows[0].parent_id) : null,
    content: rows[0].content,
    enabled: !!rows[0].enabled,
    status: rows[0].status || 'pending',
    is_negative: !!rows[0].is_negative,
    negative_probability: rows[0].negative_probability || 0,
    reviewed_by: rows[0].reviewed_by || null,
    reviewed_at: rows[0].reviewed_at || null,
    created_at: rows[0].created_at
  } : null
}

async function getCommentById(id) {
  const p = await initPool()
  await ensureCommentsTable(p)
  const [rows] = await p.execute(
    `SELECT comment_id as id, story_id, user_id, parent_id, content, enabled, status, is_negative, negative_probability, reviewed_by, reviewed_at, created_at
     FROM comments WHERE comment_id = ? LIMIT 1`,
    [id]
  )
  if (!rows || !rows[0]) return null
  const r = rows[0]
  return {
    id: String(r.id),
    story_id: String(r.story_id),
    user_id: String(r.user_id),
    parent_id: r.parent_id ? String(r.parent_id) : null,
    content: r.content,
    enabled: !!r.enabled,
    status: r.status || 'approved',
    is_negative: !!r.is_negative,
    negative_probability: r.negative_probability || 0,
    reviewed_by: r.reviewed_by || null,
    reviewed_at: r.reviewed_at || null,
    created_at: r.created_at
  }
}

async function deleteCommentByUser(id, userId) {
  const p = await initPool()
  await ensureCommentsTable(p)
  const [res] = await p.execute('DELETE FROM comments WHERE comment_id = ? AND user_id = ?', [id, userId])
  return { affectedRows: res.affectedRows }
}

async function updateComment(id, { content, enabled, status, reviewed_by }) {
  const p = await initPool()
  await ensureCommentsTable(p)
  const parts = []
  const params = []
  if (content !== undefined) { parts.push('content = ?'); params.push(content) }
  if (enabled !== undefined) { parts.push('enabled = ?'); params.push(enabled ? 1 : 0) }
  if (status !== undefined) { parts.push('status = ?'); params.push(status) }
  if (reviewed_by !== undefined) { parts.push('reviewed_by = ?'); params.push(reviewed_by) }
  if (status !== undefined) { parts.push('reviewed_at = NOW()') }
  if (parts.length === 0) return null
  params.push(id)
  const sql = `UPDATE comments SET ${parts.join(', ')} WHERE comment_id = ?`
  await p.execute(sql, params)
  const [rows] = await p.execute('SELECT comment_id as id, story_id, user_id, parent_id, content, enabled, status, reviewed_by, reviewed_at, created_at FROM comments WHERE comment_id = ?', [id])
  return rows && rows[0] ? { id: String(rows[0].id), story_id: String(rows[0].story_id), user_id: String(rows[0].user_id), parent_id: rows[0].parent_id ? String(rows[0].parent_id) : null, content: rows[0].content, enabled: !!rows[0].enabled, status: rows[0].status || 'approved', reviewed_by: rows[0].reviewed_by || null, reviewed_at: rows[0].reviewed_at || null, created_at: rows[0].created_at } : null
}

async function deleteComment(id) {
  const p = await initPool()
  await ensureCommentsTable(p)
  const [res] = await p.execute('DELETE FROM comments WHERE comment_id = ?', [id])
  return { affectedRows: res.affectedRows }
}

// Follows helpers
async function ensureFollowsTable(p) {
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS follows (
      follow_id INT AUTO_INCREMENT PRIMARY KEY,
      follower_id VARCHAR(191),
      followee_id VARCHAR(191),
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
}

async function getFollows(userId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  const { idCol, followerCol, followeeCol, createdAtCol } = await getFollowsColumnMap(p)
  const selectId = idCol ? `${idCol} as id` : 'NULL as id'
  const selectCreated = createdAtCol ? `${createdAtCol} as created_at` : 'NULL as created_at'
  const orderBy = createdAtCol ? `ORDER BY ${createdAtCol} DESC` : (idCol ? `ORDER BY ${idCol} DESC` : '')
  if (userId) {
    const sql = `SELECT ${selectId}, ${followerCol} as follower_id, ${followeeCol} as followee_id, ${selectCreated} FROM follows WHERE ${followerCol} = ? OR ${followeeCol} = ? ${orderBy}`
    const [rows] = await p.execute(sql, [userId, userId])
    return (rows || []).map(r => ({ id: String(r.id), follower_id: String(r.follower_id), followee_id: String(r.followee_id), created_at: r.created_at }))
  }
  const sql = `SELECT ${selectId}, ${followerCol} as follower_id, ${followeeCol} as followee_id, ${selectCreated} FROM follows ${orderBy}`
  const [rows] = await p.execute(sql)
  return (rows || []).map(r => ({ id: String(r.id), follower_id: String(r.follower_id), followee_id: String(r.followee_id), created_at: r.created_at }))
}

async function createFollow(followerId, followeeId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  const { idCol, followerCol, followeeCol, createdAtCol } = await getFollowsColumnMap(p)
  // prevent duplicates
  try {
    const [existing] = await p.execute(`SELECT ${idCol} as id FROM follows WHERE ${followerCol} = ? AND ${followeeCol} = ? LIMIT 1`, [followerId, followeeId])
    if (existing && existing[0]) return { id: String(existing[0].id) }
  } catch (e) { }

  // If the existing table doesn't have created_at (rare), omit it.
  let insertSql = createdAtCol
    ? `INSERT INTO follows (${followerCol}, ${followeeCol}, ${createdAtCol}) VALUES (?, ?, NOW())`
    : `INSERT INTO follows (${followerCol}, ${followeeCol}) VALUES (?, ?)`
  let res
  try {
    ;[res] = await p.execute(insertSql, [followerId, followeeId])
  } catch (e) {
    // Retry without createdAtCol if that column name isn't present / mismatched.
    try {
      insertSql = `INSERT INTO follows (${followerCol}, ${followeeCol}) VALUES (?, ?)`
      ;[res] = await p.execute(insertSql, [followerId, followeeId])
    } catch (e2) {
      throw e
    }
  }
  const id = res.insertId
  if (!idCol) {
    // Can't reliably fetch by id without an id column; return a minimal normalized row.
    return { id: String(id || ''), follower_id: String(followerId), followee_id: String(followeeId), created_at: null }
  }
  const selectCreated = createdAtCol ? `${createdAtCol} as created_at` : 'NULL as created_at'
  const [rows] = await p.execute(`SELECT ${idCol} as id, ${followerCol} as follower_id, ${followeeCol} as followee_id, ${selectCreated} FROM follows WHERE ${idCol} = ?`, [id])
  return rows && rows[0] ? { id: String(rows[0].id), follower_id: String(rows[0].follower_id), followee_id: String(rows[0].followee_id), created_at: rows[0].created_at } : null
}

async function deleteFollow(id) {
  const p = await initPool()
  await ensureFollowsTable(p)
  const { idCol } = await getFollowsColumnMap(p)
  if (!idCol) return { affectedRows: 0 }
  const [res] = await p.execute(`DELETE FROM follows WHERE ${idCol} = ?`, [id])
  return { affectedRows: res.affectedRows }
}

async function deleteFollowByPair(followerId, followeeId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  const { followerCol, followeeCol } = await getFollowsColumnMap(p)
  const [res] = await p.execute(`DELETE FROM follows WHERE ${followerCol} = ? AND ${followeeCol} = ?`, [followerId, followeeId])
  return { affectedRows: res.affectedRows }
}

async function countFollowers(followeeId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  try {
    const { followeeCol } = await getFollowsColumnMap(p)
    const [rows] = await p.execute(`SELECT COUNT(*) as cnt FROM follows WHERE ${followeeCol} = ?`, [followeeId])
    return rows && rows[0] ? Number(rows[0].cnt) : 0
  } catch (e) { return 0 }
}

async function findFollow(followerId, followeeId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  try {
    const { idCol, followerCol, followeeCol, createdAtCol } = await getFollowsColumnMap(p)
    const selectId = idCol ? `${idCol} as id` : 'NULL as id'
    const selectCreated = createdAtCol ? `${createdAtCol} as created_at` : 'NULL as created_at'
    const [rows] = await p.execute(`SELECT ${selectId}, ${followerCol} as follower_id, ${followeeCol} as followee_id, ${selectCreated} FROM follows WHERE ${followerCol} = ? AND ${followeeCol} = ? LIMIT 1`, [followerId, followeeId])
    return rows && rows[0] ? { id: String(rows[0].id), follower_id: String(rows[0].follower_id), followee_id: String(rows[0].followee_id), created_at: rows[0].created_at } : null
  } catch (e) {
    // Handle case when table structure is different
    console.error('findFollow error (table structure mismatch?):', e.message)
    return null
  }
}

async function getFollowById(id) {
  const p = await initPool()
  await ensureFollowsTable(p)
  const { idCol, followerCol, followeeCol, createdAtCol } = await getFollowsColumnMap(p)
  if (!idCol) return null
  const selectCreated = createdAtCol ? `${createdAtCol} as created_at` : 'NULL as created_at'
  const [rows] = await p.execute(`SELECT ${idCol} as id, ${followerCol} as follower_id, ${followeeCol} as followee_id, ${selectCreated} FROM follows WHERE ${idCol} = ? LIMIT 1`, [id])
  return rows && rows[0] ? { id: String(rows[0].id), follower_id: String(rows[0].follower_id), followee_id: String(rows[0].followee_id), created_at: rows[0].created_at } : null
}

module.exports.getComments = getComments
module.exports.createComment = createComment
module.exports.updateComment = updateComment
module.exports.deleteComment = deleteComment
module.exports.getCommentById = getCommentById
module.exports.deleteCommentByUser = deleteCommentByUser
module.exports.getFollows = getFollows
module.exports.createFollow = createFollow
module.exports.deleteFollow = deleteFollow
module.exports.countFollowers = countFollowers
module.exports.findFollow = findFollow
module.exports.deleteFollowByPair = deleteFollowByPair
module.exports.getFollowById = getFollowById

// Author follows (user follows an author)
async function ensureAuthorFollowsTable(p) {
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS author_follows (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      author_id VARCHAR(191),
      created_at DATETIME,
      UNIQUE KEY uniq_user_author (user_id, author_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
}

async function createAuthorFollow(userId, authorId) {
  const p = await initPool()
  await ensureAuthorFollowsTable(p)
  // prevent duplicates
  try {
    const [existing] = await p.execute('SELECT id FROM author_follows WHERE user_id = ? AND author_id = ? LIMIT 1', [userId, authorId])
    if (existing && existing[0]) return { id: String(existing[0].id), user_id: String(userId), author_id: String(authorId) }
  } catch (e) { }

  try {
    const [res] = await p.execute('INSERT INTO author_follows (user_id, author_id, created_at) VALUES (?, ?, NOW())', [userId, authorId])
    const id = res.insertId
    return { id: String(id), user_id: String(userId), author_id: String(authorId) }
  } catch (e) {
    // If UNIQUE constraint hit, fetch existing
    try {
      const [rows] = await p.execute('SELECT id FROM author_follows WHERE user_id = ? AND author_id = ? LIMIT 1', [userId, authorId])
      if (rows && rows[0]) return { id: String(rows[0].id), user_id: String(userId), author_id: String(authorId) }
    } catch (e2) { }
    throw e
  }
}

async function deleteAuthorFollowByPair(userId, authorId) {
  const p = await initPool()
  await ensureAuthorFollowsTable(p)
  const [res] = await p.execute('DELETE FROM author_follows WHERE user_id = ? AND author_id = ?', [userId, authorId])
  return { affectedRows: res.affectedRows }
}

async function hasAuthorFollow(userId, authorId) {
  const p = await initPool()
  await ensureAuthorFollowsTable(p)
  const [rows] = await p.execute('SELECT id FROM author_follows WHERE user_id = ? AND author_id = ? LIMIT 1', [userId, authorId])
  return !!(rows && rows[0])
}

async function countAuthorFollowers(authorId) {
  const p = await initPool()
  await ensureAuthorFollowsTable(p)
  const [rows] = await p.execute('SELECT COUNT(*) as cnt FROM author_follows WHERE author_id = ?', [authorId])
  return rows && rows[0] ? Number(rows[0].cnt || 0) : 0
}

// Public authors listing with aggregates
async function getAuthors(opts = {}) {
  const userId = opts && opts.userId ? String(opts.userId) : null
  const p = await initPool()
  await ensureAuthorFollowsTable(p)
  // Ensure authors table exists (best-effort)
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS authors (
      author_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      pen_name VARCHAR(191),
      bio TEXT,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }

  // Only_full_group_by safe query (aggregate non-grouped columns via MAX)
  const baseSqlWithAvatar = `
    SELECT
      a.author_id,
      MAX(a.user_id) as user_id,
      MAX(a.pen_name) as pen_name,
      MAX(u.avatar_url) as avatar_url,
      MAX(COALESCE(f.followers_count, 0)) as followers_count,
      MAX(COALESCE(b.books_count, 0)) as books_count,
      ${userId ? 'MAX(CASE WHEN uf.user_id IS NULL THEN 0 ELSE 1 END) as is_following' : '0 as is_following'}
    FROM authors a
    LEFT JOIN users u ON u.user_id = a.user_id
    LEFT JOIN (
      SELECT author_id, COUNT(*) as followers_count
      FROM author_follows
      GROUP BY author_id
    ) f ON f.author_id = a.author_id
    LEFT JOIN (
      SELECT author_id, COUNT(*) as books_count
      FROM stories
      GROUP BY author_id
    ) b ON b.author_id = a.author_id
    ${userId ? 'LEFT JOIN author_follows uf ON uf.author_id = a.author_id AND uf.user_id = ?' : ''}
    GROUP BY a.author_id
    ORDER BY MAX(COALESCE(f.followers_count, 0)) DESC, MAX(a.pen_name) ASC
  `

  const baseSqlNoAvatar = `
    SELECT
      a.author_id,
      MAX(a.user_id) as user_id,
      MAX(a.pen_name) as pen_name,
      MAX(COALESCE(f.followers_count, 0)) as followers_count,
      MAX(COALESCE(b.books_count, 0)) as books_count,
      ${userId ? 'MAX(CASE WHEN uf.user_id IS NULL THEN 0 ELSE 1 END) as is_following' : '0 as is_following'}
    FROM authors a
    LEFT JOIN (
      SELECT author_id, COUNT(*) as followers_count
      FROM author_follows
      GROUP BY author_id
    ) f ON f.author_id = a.author_id
    LEFT JOIN (
      SELECT author_id, COUNT(*) as books_count
      FROM stories
      GROUP BY author_id
    ) b ON b.author_id = a.author_id
    ${userId ? 'LEFT JOIN author_follows uf ON uf.author_id = a.author_id AND uf.user_id = ?' : ''}
    GROUP BY a.author_id
    ORDER BY MAX(COALESCE(f.followers_count, 0)) DESC, MAX(a.pen_name) ASC
  `

  let rows = []
  try {
    const out = userId ? await p.query(baseSqlWithAvatar, [userId]) : await p.query(baseSqlWithAvatar)
    rows = out && out[0] ? out[0] : []
  } catch (e) {
    const out = userId ? await p.query(baseSqlNoAvatar, [userId]) : await p.query(baseSqlNoAvatar)
    rows = out && out[0] ? out[0] : []
  }

  return (rows || []).map(r => ({
    author_id: String(r.author_id),
    user_id: r.user_id ? String(r.user_id) : null,
    pen_name: r.pen_name || null,
    avatar_url: r.avatar_url ? String(r.avatar_url) : null,
    followers_count: Number(r.followers_count || 0),
    books_count: Number(r.books_count || 0),
    is_following: !!Number(r.is_following || 0)
  }))
}

// Books by author_id (same shape as getBooks)
async function getBooksByAuthorId(authorId) {
  const p = await initPool()
  await ensureStoriesHiddenColumn(p)
  // Ensure tables exist so aggregates don't crash on fresh DBs.
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS likes (
      like_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
      view_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      chapter_id VARCHAR(191),
      viewed_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }

  const sql = `
    SELECT
      s.story_id,
      MAX(s.title) as title,
      MAX(s.author_id) as author_id,
      MAX(a.user_id) as author_user_id,
      MAX(a.pen_name) as author_name,
      MAX(s.description) as description,
      MAX(s.cover_image) as cover_image,
      MAX(s.status) as status,
      MAX(s.created_at) as created_at,
      MAX(s.updated_at) as updated_at,
      MAX(s.genre) as genre,
      0 as chapters_count,
      GROUP_CONCAT(DISTINCT g.name SEPARATOR ', ') as genre_names,
      MAX(COALESCE(l.likes_count, 0)) as likes_count,
      MAX(COALESCE(v.views_count, 0)) as views_count
    FROM stories s
    LEFT JOIN authors a ON s.author_id = a.author_id
    LEFT JOIN story_genres sg ON s.story_id = sg.story_id
    LEFT JOIN genres g ON sg.genre_id = g.genre_id
    LEFT JOIN (
      SELECT story_id, COUNT(*) as likes_count
      FROM likes
      GROUP BY story_id
    ) l ON l.story_id = s.story_id
    LEFT JOIN (
      SELECT story_id, COUNT(*) as views_count
      FROM chapter_views
      GROUP BY story_id
    ) v ON v.story_id = s.story_id
    WHERE (s.is_hidden IS NULL OR s.is_hidden = 0) AND s.author_id = ?
    GROUP BY s.story_id
    ORDER BY MAX(s.created_at) DESC
  `

  const [rows] = await p.query(sql, [authorId])
  let chapterCounts = {}
  try {
    const ids = (rows || []).map(r => r && r.story_id).filter(Boolean)
    chapterCounts = await getChapterCountsByStoryIds(ids)
  } catch (e) {
    chapterCounts = {}
  }

  return (rows || []).map(r => {
    const genreValue = r.genre_names || r.genre || null
    return {
      story_id: r.story_id,
      id: String(r.story_id),
      title: r.title,
      author_id: r.author_id,
      author_user_id: r.author_user_id,
      author: r.author_name,
      description: r.description,
      cover_image: r.cover_image,
      cover_url: r.cover_image,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      chapters_count: (chapterCounts && chapterCounts[String(r.story_id)] !== undefined) ? chapterCounts[String(r.story_id)] : (r.chapters_count || 0),
      genre: genreValue,
      likes_count: Number(r.likes_count || 0),
      views: Number(r.views_count || 0)
    }
  })
}

async function getAuthorById(authorId) {
  const p = await initPool()
  // Ensure authors table exists (best-effort)
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS authors (
      author_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      pen_name VARCHAR(191),
      bio TEXT,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
  const [rows] = await p.execute('SELECT author_id, user_id, pen_name, bio, created_at FROM authors WHERE author_id = ? LIMIT 1', [authorId])
  return rows && rows[0]
    ? {
      author_id: String(rows[0].author_id),
      user_id: rows[0].user_id ? String(rows[0].user_id) : null,
      pen_name: rows[0].pen_name || null,
      bio: rows[0].bio || null,
      created_at: rows[0].created_at
    }
    : null
}

// Feed: recent new stories + new chapters from followed authors
async function getFollowingFeed(userId, opts = {}) {
  if (!userId) return []
  const limit = Math.max(1, Math.min(50, Number.parseInt(opts.limit, 10) || 20))
  const offset = Math.max(0, Number.parseInt(opts.offset, 10) || 0)
  // Fetch enough items from each source so merge+slice works.
  const need = Math.min(200, limit + offset)

  const p = await initPool()
  await ensureAuthorFollowsTable(p)
  try { await ensureStoriesHiddenColumn(p) } catch (e) { /* ignore */ }

  // Ensure aggregate tables exist (best-effort)
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS likes (
      like_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
      view_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      chapter_id VARCHAR(191),
      viewed_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }

  // Followed author ids
  const [followRows] = await p.execute('SELECT DISTINCT author_id FROM author_follows WHERE user_id = ?', [userId])
  const authorIds = (followRows || []).map(r => String(r.author_id)).filter(Boolean)
  if (!authorIds.length) return []

  const placeholders = authorIds.map(() => '?').join(', ')

  // New stories
  let stories = []
  try {
    const [rows] = await p.query(`
      SELECT
        'story' as item_type,
        s.story_id,
        s.title as story_title,
        s.cover_image,
        s.genre,
        s.created_at,
        a.author_id,
        a.user_id as author_user_id,
        a.pen_name as author_name,
        COALESCE(l.likes_count, 0) as likes_count,
        COALESCE(v.views_count, 0) as views_count
      FROM stories s
      LEFT JOIN authors a ON s.author_id = a.author_id
      LEFT JOIN (
        SELECT story_id, COUNT(*) as likes_count
        FROM likes
        GROUP BY story_id
      ) l ON l.story_id = s.story_id
      LEFT JOIN (
        SELECT story_id, COUNT(*) as views_count
        FROM chapter_views
        GROUP BY story_id
      ) v ON v.story_id = s.story_id
      WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
        AND s.author_id IN (${placeholders})
      ORDER BY s.created_at DESC
      LIMIT ?
    `, [...authorIds, need])
    stories = rows || []
  } catch (e) {
    stories = []
  }

  // New chapters (schema-aware join)
  let chapters = []
  try {
    const fkCandidates = await getChaptersFkCandidates(p)
    const pkCandidates = await getChaptersPkCandidates(p)
    const hasNo = await getChaptersHasChapterNo(p)
    const pkCol = pkCandidates && pkCandidates[0] ? pkCandidates[0] : 'id'

    for (const fkCol of fkCandidates) {
      try {
        const [rows] = await p.query(`
          SELECT
            'chapter' as item_type,
            s.story_id,
            s.title as story_title,
            s.cover_image,
            s.genre,
            c.${pkCol} as chapter_id,
            ${hasNo ? 'c.chapter_no' : 'NULL as chapter_no'},
            c.title as chapter_title,
            c.created_at,
            a.author_id,
            a.user_id as author_user_id,
            a.pen_name as author_name,
            COALESCE(l.likes_count, 0) as likes_count,
            COALESCE(v.views_count, 0) as views_count
          FROM chapters c
          JOIN stories s ON s.story_id = c.${fkCol}
          LEFT JOIN authors a ON s.author_id = a.author_id
          LEFT JOIN (
            SELECT story_id, COUNT(*) as likes_count
            FROM likes
            GROUP BY story_id
          ) l ON l.story_id = s.story_id
          LEFT JOIN (
            SELECT story_id, COUNT(*) as views_count
            FROM chapter_views
            GROUP BY story_id
          ) v ON v.story_id = s.story_id
          WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
            AND s.author_id IN (${placeholders})
          ORDER BY c.created_at DESC
          LIMIT ?
        `, [...authorIds, need])
        chapters = rows || []
        break
      } catch (e) {
        // try next fk candidate
      }
    }
  } catch (e) {
    chapters = []
  }

  const normalizeDate = (d) => {
    try {
      if (!d) return 0
      const t = new Date(d).getTime()
      return Number.isFinite(t) ? t : 0
    } catch { return 0 }
  }

  const combined = ([]).concat(stories || [], chapters || [])
    .map(r => {
      const t = normalizeDate(r.created_at)
      const id = `${r.item_type}:${r.item_type === 'chapter' ? (r.chapter_id || '') : (r.story_id || '')}`
      return {
        id,
        type: r.item_type,
        created_at: r.created_at,
        created_ts: t,
        author_id: r.author_id ? String(r.author_id) : null,
        author_user_id: r.author_user_id ? String(r.author_user_id) : null,
        author_name: r.author_name || null,
        story_id: r.story_id ? String(r.story_id) : null,
        story_title: r.story_title || null,
        cover_image: r.cover_image || null,
        genre: r.genre || null,
        likes_count: Number(r.likes_count || 0),
        views: Number(r.views_count || 0),
        chapter_id: r.chapter_id !== undefined && r.chapter_id !== null ? String(r.chapter_id) : null,
        chapter_no: r.chapter_no !== undefined && r.chapter_no !== null ? Number(r.chapter_no) : null,
        chapter_title: r.chapter_title || null,
      }
    })
    .sort((a, b) => Number(b.created_ts) - Number(a.created_ts))

  return combined.slice(offset, offset + limit)
}

// Public feed: recent new stories + new chapters from all authors
async function getPublicFeed(opts = {}) {
  const limit = Math.max(1, Math.min(50, Number.parseInt(opts.limit, 10) || 20))
  const offset = Math.max(0, Number.parseInt(opts.offset, 10) || 0)
  const need = Math.min(200, limit + offset)

  const p = await initPool()
  try { await ensureStoriesHiddenColumn(p) } catch (e) { /* ignore */ }

  // Ensure aggregate tables exist (best-effort)
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS likes (
      like_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
      view_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      chapter_id VARCHAR(191),
      viewed_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }

  // New stories
  let stories = []
  try {
    const [rows] = await p.query(`
      SELECT
        'story' as item_type,
        s.story_id,
        s.title as story_title,
        s.cover_image,
        s.genre,
        s.created_at,
        a.author_id,
        a.user_id as author_user_id,
        a.pen_name as author_name,
        COALESCE(l.likes_count, 0) as likes_count,
        COALESCE(v.views_count, 0) as views_count
      FROM stories s
      LEFT JOIN authors a ON s.author_id = a.author_id
      LEFT JOIN (
        SELECT story_id, COUNT(*) as likes_count
        FROM likes
        GROUP BY story_id
      ) l ON l.story_id = s.story_id
      LEFT JOIN (
        SELECT story_id, COUNT(*) as views_count
        FROM chapter_views
        GROUP BY story_id
      ) v ON v.story_id = s.story_id
      WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
      ORDER BY s.created_at DESC
      LIMIT ?
    `, [need])
    stories = rows || []
  } catch (e) {
    stories = []
  }

  // New chapters
  let chapters = []
  try {
    const fkCandidates = await getChaptersFkCandidates(p)
    const pkCandidates = await getChaptersPkCandidates(p)
    const hasNo = await getChaptersHasChapterNo(p)
    const pkCol = pkCandidates && pkCandidates[0] ? pkCandidates[0] : 'id'

    for (const fkCol of fkCandidates) {
      try {
        const [rows] = await p.query(`
          SELECT
            'chapter' as item_type,
            s.story_id,
            s.title as story_title,
            s.cover_image,
            s.genre,
            c.${pkCol} as chapter_id,
            ${hasNo ? 'c.chapter_no' : 'NULL as chapter_no'},
            c.title as chapter_title,
            c.created_at,
            a.author_id,
            a.user_id as author_user_id,
            a.pen_name as author_name,
            COALESCE(l.likes_count, 0) as likes_count,
            COALESCE(v.views_count, 0) as views_count
          FROM chapters c
          JOIN stories s ON s.story_id = c.${fkCol}
          LEFT JOIN authors a ON s.author_id = a.author_id
          LEFT JOIN (
            SELECT story_id, COUNT(*) as likes_count
            FROM likes
            GROUP BY story_id
          ) l ON l.story_id = s.story_id
          LEFT JOIN (
            SELECT story_id, COUNT(*) as views_count
            FROM chapter_views
            GROUP BY story_id
          ) v ON v.story_id = s.story_id
          WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
          ORDER BY c.created_at DESC
          LIMIT ?
        `, [need])
        chapters = rows || []
        break
      } catch (e) {
        // try next
      }
    }
  } catch (e) {
    chapters = []
  }

  const normalizeDate = (d) => {
    try {
      if (!d) return 0
      const t = new Date(d).getTime()
      return Number.isFinite(t) ? t : 0
    } catch { return 0 }
  }

  const combined = ([]).concat(stories || [], chapters || [])
    .map(r => {
      const t = normalizeDate(r.created_at)
      const id = `${r.item_type}:${r.item_type === 'chapter' ? (r.chapter_id || '') : (r.story_id || '')}`
      return {
        id,
        type: r.item_type,
        created_at: r.created_at,
        created_ts: t,
        author_id: r.author_id ? String(r.author_id) : null,
        author_user_id: r.author_user_id ? String(r.author_user_id) : null,
        author_name: r.author_name || null,
        story_id: r.story_id ? String(r.story_id) : null,
        story_title: r.story_title || null,
        cover_image: r.cover_image || null,
        genre: r.genre || null,
        likes_count: Number(r.likes_count || 0),
        views: Number(r.views_count || 0),
        chapter_id: r.chapter_id !== undefined && r.chapter_id !== null ? String(r.chapter_id) : null,
        chapter_no: r.chapter_no !== undefined && r.chapter_no !== null ? Number(r.chapter_no) : null,
        chapter_title: r.chapter_title || null,
      }
    })
    .sort((a, b) => Number(b.created_ts) - Number(a.created_ts))

  return combined.slice(offset, offset + limit)
}

// Notifications: aggregate events for current user (likes on your stories, follows of you, donations to you)
async function getNotifications(userId, opts = {}) {
  if (!userId) return []
  const limit = Math.max(1, Math.min(50, Number.parseInt(opts.limit, 10) || 30))
  const offset = Math.max(0, Number.parseInt(opts.offset, 10) || 0)
  const need = Math.min(200, limit + offset)

  const p = await initPool()

  // Ensure tables exist (best-effort)
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS likes (
      like_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }

  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS donations (
      donation_id INT AUTO_INCREMENT PRIMARY KEY,
      donor_id VARCHAR(191),
      story_id VARCHAR(191),
      author_id VARCHAR(191),
      coins BIGINT,
      message TEXT,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }

  // Used by trending/rank (views = COUNT(*) of chapter_views)
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
      view_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      chapter_id VARCHAR(191),
      viewed_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }

  try { await ensureAuthorFollowsTable(p) } catch (e) { /* ignore */ }

  // Resolve this user's author ids (if any)
  let authorIds = []
  try {
    const [arows] = await p.execute('SELECT author_id FROM authors WHERE user_id = ?', [userId])
    authorIds = (arows || []).map(r => r && r.author_id ? String(r.author_id) : null).filter(Boolean)
  } catch (e) {
    authorIds = []
  }

  const normalizeDate = (d) => {
    try {
      if (!d) return 0
      const t = new Date(d).getTime()
      return Number.isFinite(t) ? t : 0
    } catch { return 0 }
  }

  // Likes on stories authored by this user
  let likeRows = []
  try {
    const [rows] = await p.query(`
      SELECT
        l.like_id as event_id,
        l.created_at,
        l.user_id as actor_user_id,
        u.fullname as actor_name,
        u.avatar_url as actor_avatar_url,
        s.story_id,
        s.title as story_title
      FROM likes l
      JOIN stories s ON s.story_id = l.story_id
      LEFT JOIN authors a ON s.author_id = a.author_id
      LEFT JOIN users u ON u.user_id = l.user_id
      WHERE (a.user_id = ? OR s.author_id = ?)
        AND l.user_id <> ?
      ORDER BY l.created_at DESC
      LIMIT ?
    `, [userId, userId, userId, need])
    likeRows = rows || []
  } catch (e) {
    // fallback: best-effort without authors join
    try {
      const [rows] = await p.query(`
        SELECT
          l.like_id as event_id,
          l.created_at,
          l.user_id as actor_user_id,
          u.fullname as actor_name,
          u.avatar_url as actor_avatar_url,
          s.story_id,
          s.title as story_title
        FROM likes l
        JOIN stories s ON s.story_id = l.story_id
        LEFT JOIN users u ON u.user_id = l.user_id
        WHERE s.author_id = ?
          AND l.user_id <> ?
        ORDER BY l.created_at DESC
        LIMIT ?
      `, [userId, userId, need])
      likeRows = rows || []
    } catch (e2) {
      likeRows = []
    }
  }

  // New followers of this author
  let followRows = []
  if (authorIds && authorIds.length) {
    try {
      const placeholders = authorIds.map(() => '?').join(', ')
      const [rows] = await p.query(`
        SELECT
          af.id as event_id,
          af.created_at,
          af.user_id as actor_user_id,
          u.fullname as actor_name,
          u.avatar_url as actor_avatar_url
        FROM author_follows af
        LEFT JOIN users u ON u.user_id = af.user_id
        WHERE af.author_id IN (${placeholders})
          AND af.user_id <> ?
        ORDER BY af.created_at DESC
        LIMIT ?
      `, [...authorIds, userId, need])
      followRows = rows || []
    } catch (e) {
      followRows = []
    }
  }

  // Donations received by this user
  let donationRows = []
  try {
    const [rows] = await p.query(`
      SELECT
        d.donation_id as event_id,
        d.created_at,
        d.donor_id as actor_user_id,
        u.fullname as actor_name,
        u.avatar_url as actor_avatar_url,
        d.story_id,
        s.title as story_title,
        d.coins,
        d.message
      FROM donations d
      LEFT JOIN users u ON u.user_id = d.donor_id
      LEFT JOIN stories s ON s.story_id = d.story_id
      WHERE d.author_id = ?
        AND d.donor_id <> ?
      ORDER BY d.created_at DESC
      LIMIT ?
    `, [userId, userId, need])
    donationRows = rows || []
  } catch (e) {
    donationRows = []
  }

  // Trending rank notification: your stories' current position on the "Thịnh hành" board.
  // The Rank tab sorts by views descending, where views = COUNT(*) chapter_views.
  // We only compute ranks for the global top N to keep this lightweight.
  let rankItems = []
  try {
    await ensureStoriesHiddenColumn(p)
    const TOP_N = 200
    const MAX_RANK_ITEMS = 3

    const [topRows] = await p.query(`
      SELECT
        s.story_id,
        s.created_at,
        COALESCE(v.views_count, 0) as views_count,
        v.last_viewed_at
      FROM stories s
      LEFT JOIN (
        SELECT story_id, COUNT(*) as views_count, MAX(viewed_at) as last_viewed_at
        FROM chapter_views
        GROUP BY story_id
      ) v ON v.story_id = s.story_id
      WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
      ORDER BY views_count DESC, s.created_at DESC, s.story_id ASC
      LIMIT ?
    `, [TOP_N])

    const rankMap = new Map()
    for (let i = 0; i < (topRows || []).length; i++) {
      const r = topRows[i]
      if (!r || !r.story_id) continue
      rankMap.set(String(r.story_id), { rank: i + 1, views: Number(r.views_count || 0), last_viewed_at: r.last_viewed_at || null, created_at: r.created_at || null })
    }

    if (rankMap.size) {
      const [myRows] = await p.query(`
        SELECT s.story_id, s.title, s.created_at
        FROM stories s
        LEFT JOIN authors a ON s.author_id = a.author_id
        WHERE (a.user_id = ? OR s.author_id = ?)
          AND (s.is_hidden IS NULL OR s.is_hidden = 0)
      `, [userId, userId])

      const nowTs = Date.now()

      rankItems = (myRows || [])
        .map(r => {
          const sid = r && r.story_id ? String(r.story_id) : null
          if (!sid) return null
          const found = rankMap.get(sid)
          if (!found) return null

          // Use last_viewed_at as a stable-ish "event" time so unread logic works.
          // If there are no views yet, fall back to story created_at.
          const createdAt = found.last_viewed_at || r.created_at || found.created_at || new Date().toISOString()
          let createdTs = 0
          try {
            createdTs = new Date(createdAt).getTime()
            if (!Number.isFinite(createdTs)) createdTs = nowTs
          } catch { createdTs = nowTs }
          return {
            id: `rank:${sid}:${found.rank}`,
            type: 'rank',
            created_at: createdAt,
            created_ts: createdTs - Number(found.rank || 0),
            actor_user_id: null,
            actor_name: 'Hệ thống',
            actor_avatar_url: null,
            story_id: sid,
            story_title: r.title || null,
            rank: Number(found.rank || 0),
            views: Number(found.views || 0),
            coins: null,
            message: null,
          }
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))
        .slice(0, MAX_RANK_ITEMS)
    }
  } catch (e) {
    rankItems = []
  }

  const likes = (likeRows || []).map(r => {
    const created_ts = normalizeDate(r.created_at)
    return {
      id: `like:${r.event_id}`,
      type: 'like',
      created_at: r.created_at,
      created_ts,
      actor_user_id: r.actor_user_id ? String(r.actor_user_id) : null,
      actor_name: r.actor_name || null,
      actor_avatar_url: r.actor_avatar_url || null,
      story_id: r.story_id ? String(r.story_id) : null,
      story_title: r.story_title || null,
      coins: null,
      message: null
    }
  })

  const follows = (followRows || []).map(r => {
    const created_ts = normalizeDate(r.created_at)
    return {
      id: `follow:${r.event_id}`,
      type: 'follow',
      created_at: r.created_at,
      created_ts,
      actor_user_id: r.actor_user_id ? String(r.actor_user_id) : null,
      actor_name: r.actor_name || null,
      actor_avatar_url: r.actor_avatar_url || null,
      story_id: null,
      story_title: null,
      coins: null,
      message: null
    }
  })

  const donations = (donationRows || []).map(r => {
    const created_ts = normalizeDate(r.created_at)
    return {
      id: `donation:${r.event_id}`,
      type: 'donation',
      created_at: r.created_at,
      created_ts,
      actor_user_id: r.actor_user_id ? String(r.actor_user_id) : null,
      actor_name: r.actor_name || null,
      actor_avatar_url: r.actor_avatar_url || null,
      story_id: r.story_id ? String(r.story_id) : null,
      story_title: r.story_title || null,
      coins: r.coins !== undefined && r.coins !== null ? Number(r.coins) : 0,
      message: r.message || null
    }
  })

  const combined = ([]).concat(rankItems, likes, follows, donations)
    .sort((a, b) => Number(b.created_ts) - Number(a.created_ts))

  return combined.slice(offset, offset + limit)
}

async function ensureNotificationStateTable(p) {
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS notification_state (
      user_id VARCHAR(191) PRIMARY KEY,
      last_seen_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
}

async function markNotificationsSeen(userId) {
  if (!userId) return { ok: false }
  const p = await initPool()
  try { await ensureNotificationStateTable(p) } catch (e) { }
  try {
    await p.execute(
      'INSERT INTO notification_state (user_id, last_seen_at) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)',
      [String(userId)]
    )
    const [rows] = await p.execute('SELECT last_seen_at FROM notification_state WHERE user_id = ? LIMIT 1', [String(userId)])
    const last_seen_at = rows && rows[0] ? rows[0].last_seen_at : null
    return { ok: true, last_seen_at }
  } catch (e) {
    return { ok: false }
  }
}

async function hasUnreadNotifications(userId) {
  if (!userId) return { has_unread: false, last_seen_at: null }
  const p = await initPool()
  try { await ensureNotificationStateTable(p) } catch (e) { }
  let lastSeen = null
  try {
    const [rows] = await p.execute('SELECT last_seen_at FROM notification_state WHERE user_id = ? LIMIT 1', [String(userId)])
    lastSeen = rows && rows[0] ? rows[0].last_seen_at : null
  } catch (e) {
    lastSeen = null
  }

  const lastSeenTs = (() => {
    try {
      if (!lastSeen) return 0
      const t = new Date(lastSeen).getTime()
      return Number.isFinite(t) ? t : 0
    } catch { return 0 }
  })()

  const toTs = (d) => {
    try {
      if (!d) return 0
      const t = new Date(d).getTime()
      return Number.isFinite(t) ? t : 0
    } catch { return 0 }
  }

  // Likes
  try {
    const [rows] = await p.query(`
      SELECT MAX(l.created_at) as last_at
      FROM likes l
      JOIN stories s ON s.story_id = l.story_id
      LEFT JOIN authors a ON s.author_id = a.author_id
      WHERE (a.user_id = ? OR s.author_id = ?)
        AND l.user_id <> ?
    `, [userId, userId, userId])
    const lastAtTs = rows && rows[0] ? toTs(rows[0].last_at) : 0
    if (lastAtTs > lastSeenTs) return { has_unread: true, last_seen_at: lastSeen }
  } catch (e) { /* ignore */ }

  // Follows (author_follows)
  try {
    const [arows] = await p.execute('SELECT author_id FROM authors WHERE user_id = ?', [userId])
    const authorIds = (arows || []).map(r => r && r.author_id ? String(r.author_id) : null).filter(Boolean)
    if (authorIds.length) {
      const placeholders = authorIds.map(() => '?').join(', ')
      const [rows] = await p.query(`
        SELECT MAX(af.created_at) as last_at
        FROM author_follows af
        WHERE af.author_id IN (${placeholders})
          AND af.user_id <> ?
      `, [...authorIds, userId])
      const lastAtTs = rows && rows[0] ? toTs(rows[0].last_at) : 0
      if (lastAtTs > lastSeenTs) return { has_unread: true, last_seen_at: lastSeen }
    }
  } catch (e) { /* ignore */ }

  // Donations
  try {
    const [rows] = await p.query(`
      SELECT MAX(d.created_at) as last_at
      FROM donations d
      WHERE d.author_id = ?
        AND d.donor_id <> ?
    `, [userId, userId])
    const lastAtTs = rows && rows[0] ? toTs(rows[0].last_at) : 0
    if (lastAtTs > lastSeenTs) return { has_unread: true, last_seen_at: lastSeen }
  } catch (e) { /* ignore */ }

  // Rank (global top N then filter to user's stories)
  try {
    await ensureStoriesHiddenColumn(p)
    const TOP_N = 200
    const [rows] = await p.query(`
      SELECT
        s.story_id,
        s.author_id,
        a.user_id as author_user_id,
        COALESCE(v.views_count, 0) as views_count,
        v.last_viewed_at,
        s.created_at
      FROM stories s
      LEFT JOIN authors a ON s.author_id = a.author_id
      LEFT JOIN (
        SELECT story_id, COUNT(*) as views_count, MAX(viewed_at) as last_viewed_at
        FROM chapter_views
        GROUP BY story_id
      ) v ON v.story_id = s.story_id
      WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
      ORDER BY views_count DESC, s.created_at DESC, s.story_id ASC
      LIMIT ?
    `, [TOP_N])

    for (const r of (rows || [])) {
      const isMine = (r && r.author_user_id && String(r.author_user_id) === String(userId)) || (r && r.author_id && String(r.author_id) === String(userId))
      if (!isMine) continue
      const t = toTs(r.last_viewed_at || r.created_at)
      if (t > lastSeenTs) return { has_unread: true, last_seen_at: lastSeen }
    }
  } catch (e) { /* ignore */ }

  return { has_unread: false, last_seen_at: lastSeen }
}

module.exports.getAuthors = getAuthors
module.exports.createAuthorFollow = createAuthorFollow
module.exports.deleteAuthorFollowByPair = deleteAuthorFollowByPair
module.exports.hasAuthorFollow = hasAuthorFollow
module.exports.countAuthorFollowers = countAuthorFollowers
module.exports.getBooksByAuthorId = getBooksByAuthorId
module.exports.getAuthorById = getAuthorById
module.exports.getFollowingFeed = getFollowingFeed
module.exports.getPublicFeed = getPublicFeed
module.exports.getNotifications = getNotifications
module.exports.markNotificationsSeen = markNotificationsSeen
module.exports.hasUnreadNotifications = hasUnreadNotifications

// Genres/Categories helpers
async function getGenres() {
  const p = await initPool()
  try {
    const [rows] = await p.execute('SELECT genre_id as id, name, description, created_at FROM genres ORDER BY name ASC')
    return rows.map(r => ({ id: String(r.id), name: r.name, description: r.description, created_at: r.created_at }))
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return []
    throw e
  }
}

async function createGenre({ name, description }) {
  const p = await initPool()
  try {
    const [res] = await p.execute('INSERT INTO genres (name, description, created_at) VALUES (?, ?, NOW())', [name, description || null])
    const id = res.insertId
    const [rows] = await p.execute('SELECT genre_id as id, name, description, created_at FROM genres WHERE genre_id = ?', [id])
    return rows && rows[0] ? { id: String(rows[0].id), name: rows[0].name, description: rows[0].description, created_at: rows[0].created_at } : null
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { error: 'Genres table not created yet. Please run migration.' }
    if (e.code === 'ER_DUP_ENTRY') return { error: 'Genre name already exists' }
    throw e
  }
}

async function updateGenre(id, { name, description }) {
  const p = await initPool()
  const parts = []
  const params = []
  if (name !== undefined) { parts.push('name = ?'); params.push(name) }
  if (description !== undefined) { parts.push('description = ?'); params.push(description) }
  if (parts.length === 0) return null
  params.push(id)
  const sql = `UPDATE genres SET ${parts.join(', ')} WHERE genre_id = ?`
  try {
    const [res] = await p.execute(sql, params)
    const [rows] = await p.execute('SELECT genre_id as id, name, description, created_at FROM genres WHERE genre_id = ?', [id])
    return rows && rows[0] ? { id: String(rows[0].id), name: rows[0].name, description: rows[0].description, created_at: rows[0].created_at } : null
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { error: 'Genres table not created yet. Please run migration.' }
    if (e.code === 'ER_DUP_ENTRY') return { error: 'Genre name already exists' }
    throw e
  }
}

async function deleteGenre(id) {
  const p = await initPool()
  try {
    // delete story_genres links first
    await p.execute('DELETE FROM story_genres WHERE genre_id = ?', [id])
  } catch (e) {
    // ignore if table doesn't exist
  }
  try {
    const [res] = await p.execute('DELETE FROM genres WHERE genre_id = ?', [id])
    return { affectedRows: res.affectedRows }
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { error: 'Genres table not created yet. Please run migration.' }
    throw e
  }
}

async function linkStoryGenre(storyId, genreId) {
  const p = await initPool()
  try {
    await p.execute('INSERT INTO story_genres (story_id, genre_id) VALUES (?, ?)', [storyId, genreId])
    return { success: true }
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { error: 'Story_genres table not created yet. Please run migration.' }
    if (e.code === 'ER_DUP_ENTRY') return { error: 'Link already exists' }
    throw e
  }
}

async function unlinkStoryGenre(storyId, genreId) {
  const p = await initPool()
  try {
    const [res] = await p.execute('DELETE FROM story_genres WHERE story_id = ? AND genre_id = ?', [storyId, genreId])
    return { affectedRows: res.affectedRows }
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { error: 'Story_genres table not created yet. Please run migration.' }
    throw e
  }
}

module.exports.getGenres = getGenres
module.exports.createGenre = createGenre
module.exports.updateGenre = updateGenre
module.exports.deleteGenre = deleteGenre
module.exports.linkStoryGenre = linkStoryGenre
module.exports.unlinkStoryGenre = unlinkStoryGenre
module.exports.updateUserVip = updateUserVip
module.exports.updateUserAvatar = updateUserAvatar
module.exports.getUserPasswordHashById = getUserPasswordHashById
module.exports.updateUserPasswordHash = updateUserPasswordHash

// Payments helpers
async function createPayment({ user_id, amount, provider, provider_ref, months, days, coins }) {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS payments (
      payment_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      amount DECIMAL(10,2),
      coins BIGINT,
      provider VARCHAR(191),
      provider_ref VARCHAR(191),
      months INT DEFAULT NULL,
      days INT DEFAULT NULL,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    // best-effort add coins column for existing tables
    try { await p.execute('ALTER TABLE payments ADD COLUMN coins BIGINT'); } catch (e) { /* ignore if exists */ }
  } catch (e) {
    // ignore
  }
  const [res] = await p.execute('INSERT INTO payments (user_id, amount, coins, provider, provider_ref, months, days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())', [user_id, amount || 0, coins !== undefined ? coins : null, provider || null, provider_ref || null, months || null, days || null])
  const id = res.insertId
  const [rows] = await p.execute('SELECT * FROM payments WHERE payment_id = ?', [id])
  return rows && rows[0] ? rows[0] : null
}

async function getPayments(userId) {
  const p = await initPool()
  if (userId) {
    const [rows] = await p.execute('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC', [userId])
    return rows
  }
  const [rows] = await p.execute(`
    SELECT p.*, u.fullname, u.email
    FROM payments p
    LEFT JOIN users u ON u.user_id = p.user_id
    ORDER BY p.created_at DESC
  `)

  // Fallback: backfill coins for older rows if missing
  for (const row of rows) {
    if (row.coins !== null && row.coins !== undefined) continue
    // topup#<id>
    const topupMatch = typeof row.provider_ref === 'string' ? row.provider_ref.match(/topup#(\d+)/i) : null
    if (topupMatch) {
      try {
        const id = topupMatch[1]
        const [trows] = await p.execute('SELECT coins FROM topup_requests WHERE request_id = ? LIMIT 1', [id])
        if (trows && trows[0] && trows[0].coins !== undefined && trows[0].coins !== null) {
          row.coins = Number(trows[0].coins)
          continue
        }
      } catch (e) { /* ignore */ }
    }
    // donation {donation_id: x}
    if (row.provider === 'donation' && row.provider_ref) {
      let donationId = null
      try {
        const parsed = typeof row.provider_ref === 'string' ? JSON.parse(row.provider_ref) : row.provider_ref
        if (parsed && parsed.donation_id) donationId = parsed.donation_id
      } catch (e) {
        const m = String(row.provider_ref).match(/donation_id[:\s]*([0-9]+)/i)
        if (m) donationId = m[1]
      }
      if (donationId) {
        try {
          const [drows] = await p.execute('SELECT coins FROM donations WHERE donation_id = ? LIMIT 1', [donationId])
          if (drows && drows[0] && drows[0].coins !== undefined && drows[0].coins !== null) {
            row.coins = Number(drows[0].coins) * -1 // donor spent coins
            continue
          }
        } catch (e) { /* ignore */ }
      }
    }
    // payout / withdrawal
    if (row.provider === 'payout' && row.provider_ref) {
      let wid = null
      try {
        const parsed = typeof row.provider_ref === 'string' ? JSON.parse(row.provider_ref) : row.provider_ref
        if (parsed && parsed.withdrawal_id) wid = parsed.withdrawal_id
      } catch (e) {
        const m = String(row.provider_ref).match(/withdrawal_id[:\s]*([0-9]+)/i)
        if (m) wid = m[1]
      }
      if (wid) {
        try {
          const [wrows] = await p.execute('SELECT coins FROM withdrawals WHERE withdrawal_id = ? LIMIT 1', [wid])
          if (wrows && wrows[0] && wrows[0].coins !== undefined && wrows[0].coins !== null) {
            row.coins = -Number(wrows[0].coins)
            continue
          }
        } catch (e) { /* ignore */ }
      }
    }
  }
  return rows
}

// Donations listing for admin
async function getDonationsAdmin() {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS donations (
      donation_id INT AUTO_INCREMENT PRIMARY KEY,
      donor_id VARCHAR(191),
      story_id VARCHAR(191),
      author_id VARCHAR(191),
      coins BIGINT,
      message TEXT,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  const [rows] = await p.execute(`
    SELECT d.*, ud.fullname AS donor_name, ud.email AS donor_email,
           ua.fullname AS author_name, ua.email AS author_email,
           a.pen_name AS author_pen_name, a.user_id AS author_user_id,
           COALESCE(ua.fullname, ua.email, a.pen_name, a.user_id, d.author_id) AS author_display,
           s.title AS story_title
    FROM donations d
    LEFT JOIN users ud ON ud.user_id = d.donor_id
    LEFT JOIN users ua ON ua.user_id = d.author_id
    LEFT JOIN authors a ON a.author_id = d.author_id OR a.user_id = d.author_id
    LEFT JOIN stories s ON s.story_id = d.story_id
    ORDER BY d.created_at DESC
  `)
  return rows
}

module.exports.createPayment = createPayment
module.exports.getPayments = getPayments
module.exports.getDonationsAdmin = getDonationsAdmin

// Wallet / Coins helpers
async function getWallet(userId) {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS wallets (
      wallet_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) UNIQUE,
      balance BIGINT DEFAULT 0,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  const [rows] = await p.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [userId])
  if (rows && rows[0]) return { id: String(rows[0].id), user_id: String(rows[0].user_id), balance: Number(rows[0].balance) }
  // create wallet
  const [ins] = await p.execute('INSERT INTO wallets (user_id, balance, updated_at) VALUES (?, ?, NOW())', [userId, 0])
  return { id: String(ins.insertId), user_id: String(userId), balance: 0 }
}

async function creditWallet(userId, amount) {
  const p = await initPool()
  await p.execute('INSERT INTO wallets (user_id, balance, updated_at) SELECT ?, 0, NOW() FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM wallets WHERE user_id = ?)', [userId, userId])
  const [res] = await p.execute('UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE user_id = ?', [Number(amount || 0), userId])
  const [rows] = await p.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [userId])
  return rows && rows[0] ? { id: String(rows[0].id), user_id: String(rows[0].user_id), balance: Number(rows[0].balance) } : null
}

async function debitWallet(userId, amount) {
  const p = await initPool()
  const [rows] = await p.execute('SELECT balance FROM wallets WHERE user_id = ? LIMIT 1', [userId])
  const balance = rows && rows[0] ? Number(rows[0].balance) : 0
  if (balance < Number(amount || 0)) return { error: 'insufficient_funds', balance }
  await p.execute('UPDATE wallets SET balance = balance - ?, updated_at = NOW() WHERE user_id = ?', [Number(amount || 0), userId])
  const [r2] = await p.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [userId])
  return r2 && r2[0] ? { id: String(r2[0].id), user_id: String(r2[0].user_id), balance: Number(r2[0].balance) } : null
}

module.exports.getWallet = getWallet
module.exports.creditWallet = creditWallet
module.exports.debitWallet = debitWallet

// Top-up requests (manual approval)
async function ensureTopupTable() {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS topup_requests (
      request_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      coins BIGINT,
      amount BIGINT,
      method VARCHAR(64),
      note TEXT,
      evidence_url TEXT,
      provider_ref TEXT,
      status VARCHAR(32) DEFAULT 'pending',
      admin_id VARCHAR(191) NULL,
      admin_note TEXT,
      created_at DATETIME,
      processed_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  return p
}

async function createTopupRequest({ user_id, coins, amount, method, note, evidence_url, provider_ref }) {
  const p = await ensureTopupTable()
  const [res] = await p.execute(
    'INSERT INTO topup_requests (user_id, coins, amount, method, note, evidence_url, provider_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [user_id, Number(coins || 0), amount || null, method || null, note || null, evidence_url || null, provider_ref || null, 'pending']
  )
  const id = res.insertId
  const [rows] = await p.execute('SELECT * FROM topup_requests WHERE request_id = ?', [id])
  return rows && rows[0] ? rows[0] : null
}

async function getTopupRequestById(id) {
  const p = await ensureTopupTable()
  const [rows] = await p.execute('SELECT * FROM topup_requests WHERE request_id = ? LIMIT 1', [id])
  return rows && rows[0] ? rows[0] : null
}

async function listTopupRequests({ user_id, status } = {}) {
  const p = await ensureTopupTable()
  const clauses = []
  const params = []
  if (user_id) { clauses.push('user_id = ?'); params.push(user_id) }
  if (status) { clauses.push('status = ?'); params.push(status) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const [rows] = await p.execute(`SELECT * FROM topup_requests ${where} ORDER BY created_at DESC`, params)
  return rows || []
}

async function setTopupRequestStatus(id, { status, admin_id, admin_note, coins }) {
  const p = await ensureTopupTable()
  const updates = []
  const params = []
  if (status) { updates.push('status = ?'); params.push(status) }
  if (admin_id !== undefined) { updates.push('admin_id = ?'); params.push(admin_id) }
  if (admin_note !== undefined) { updates.push('admin_note = ?'); params.push(admin_note) }
  if (coins !== undefined) { updates.push('coins = ?'); params.push(Number(coins || 0)) }
  updates.push("processed_at = NOW()")
  const sql = `UPDATE topup_requests SET ${updates.join(', ')} WHERE request_id = ?`
  params.push(id)
  await p.execute(sql, params)
  return getTopupRequestById(id)
}

module.exports.createTopupRequest = createTopupRequest
module.exports.getTopupRequestById = getTopupRequestById
module.exports.listTopupRequests = listTopupRequests
module.exports.setTopupRequestStatus = setTopupRequestStatus

// Chapter views (daily limits)
async function recordChapterView(userId, bookId, chapterId) {
  const p = await initPool()
  try {
    // create table if not exists (simple schema)
    await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
      view_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      chapter_id VARCHAR(191),
      viewed_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) {
    // ignore
  }
  await p.execute('INSERT INTO chapter_views (user_id, story_id, chapter_id, viewed_at) VALUES (?, ?, ?, NOW())', [userId, bookId, chapterId])
  return true
}

async function countUserDistinctChapterViewsToday(userId) {
  const p = await initPool()
  try {
    const [rows] = await p.execute('SELECT COUNT(DISTINCT chapter_id) as cnt FROM chapter_views WHERE user_id = ? AND DATE(viewed_at) = CURDATE()', [userId])
    return rows && rows[0] ? Number(rows[0].cnt) : 0
  } catch (e) {
    // If the chapter_views table doesn't exist yet, create it and return 0
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === '42S02')) {
      try {
        await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
          view_id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(191),
          story_id VARCHAR(191),
          chapter_id VARCHAR(191),
          viewed_at DATETIME
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      } catch (ee) { /* ignore */ }
      return 0
    }
    return 0
  }
}

async function hasViewedChapterToday(userId, chapterId) {
  const p = await initPool()
  try {
    const [rows] = await p.execute('SELECT 1 FROM chapter_views WHERE user_id = ? AND chapter_id = ? AND DATE(viewed_at) = CURDATE() LIMIT 1', [userId, chapterId])
    return rows && rows[0] ? true : false
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === '42S02')) {
      try {
        await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
          view_id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(191),
          story_id VARCHAR(191),
          chapter_id VARCHAR(191),
          viewed_at DATETIME
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      } catch (ee) { /* ignore */ }
      return false
    }
    throw e
  }
}

// Likes helpers
async function createLike(userId, bookId) {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS likes (
      like_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      story_id VARCHAR(191),
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  // prevent duplicate
  try {
    const [exists] = await p.execute('SELECT like_id FROM likes WHERE user_id = ? AND story_id = ? LIMIT 1', [userId, bookId])
    if (exists && exists[0]) return { id: String(exists[0].like_id) }
  } catch (e) { }
  const [res] = await p.execute('INSERT INTO likes (user_id, story_id, created_at) VALUES (?, ?, NOW())', [userId, bookId])
  return { id: String(res.insertId) }
}

async function deleteLike(userId, bookId) {
  const p = await initPool()
  const [res] = await p.execute('DELETE FROM likes WHERE user_id = ? AND story_id = ?', [userId, bookId])
  return { affectedRows: res.affectedRows }
}

async function getLikesCount(bookId) {
  const p = await initPool()
  try {
    const [rows] = await p.execute('SELECT COUNT(*) as cnt FROM likes WHERE story_id = ?', [bookId])
    return rows && rows[0] ? Number(rows[0].cnt) : 0
  } catch (e) { return 0 }
}

async function hasUserLiked(userId, bookId) {
  const p = await initPool()
  try {
    const [rows] = await p.execute('SELECT like_id FROM likes WHERE user_id = ? AND story_id = ? LIMIT 1', [userId, bookId])
    return rows && rows[0] ? true : false
  } catch (e) { return false }
}

// Return array of story_ids the user has liked
async function getUserLikedBookIds(userId) {
  const p = await initPool()
  try {
    const [rows] = await p.execute('SELECT story_id FROM likes WHERE user_id = ?', [userId])
    return rows.map(r => String(r.story_id))
  } catch (e) { return [] }
}

module.exports.recordChapterView = recordChapterView
module.exports.countUserDistinctChapterViewsToday = countUserDistinctChapterViewsToday
module.exports.hasViewedChapterToday = hasViewedChapterToday
module.exports.createLike = createLike
module.exports.deleteLike = deleteLike
module.exports.getLikesCount = getLikesCount
module.exports.hasUserLiked = hasUserLiked
module.exports.getUserLikedBookIds = getUserLikedBookIds

module.exports.getChapterByNumber = getChapterByNumber

// Donations: user donates coins to story's author
async function createDonation({ donor_id, story_id, author_id, coins, message }) {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS donations (
      donation_id INT AUTO_INCREMENT PRIMARY KEY,
      donor_id VARCHAR(191),
      story_id VARCHAR(191),
      author_id VARCHAR(191),
      coins BIGINT,
      message TEXT,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  const [res] = await p.execute('INSERT INTO donations (donor_id, story_id, author_id, coins, message, created_at) VALUES (?, ?, ?, ?, ?, NOW())', [donor_id, story_id, author_id, Number(coins || 0), message || null])
  const id = res.insertId
  const [rows] = await p.execute('SELECT * FROM donations WHERE donation_id = ?', [id])
  return rows && rows[0] ? rows[0] : null
}

async function getDonationsByAuthor(authorId) {
  const p = await initPool()
  const [rows] = await p.execute('SELECT * FROM donations WHERE author_id = ? ORDER BY created_at DESC', [authorId])
  return rows
}

// Withdrawals: authors request fiat withdrawal of coins
async function createWithdrawal({ user_id, coins, method, details }) {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS withdrawals (
      withdrawal_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      coins BIGINT,
      method VARCHAR(191),
      details TEXT,
      status VARCHAR(32) DEFAULT 'pending',
      created_at DATETIME,
      processed_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  const [res] = await p.execute('INSERT INTO withdrawals (user_id, coins, method, details, status, created_at) VALUES (?, ?, ?, ?, ?, NOW())', [user_id, Number(coins || 0), method || null, details || null, 'pending'])
  const id = res.insertId
  const [rows] = await p.execute('SELECT * FROM withdrawals WHERE withdrawal_id = ?', [id])
  return rows && rows[0] ? rows[0] : null
}

async function getWithdrawals(userId) {
  const p = await initPool()
  if (userId) {
    const [rows] = await p.execute('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC', [userId])
    return rows
  }
  const [rows] = await p.execute('SELECT * FROM withdrawals ORDER BY created_at DESC')
  return rows
}

async function updateWithdrawalStatus(id, { status }) {
  const p = await initPool()
  const allowed = ['pending', 'approved', 'declined', 'processed']
  if (!allowed.includes(status)) throw new Error('invalid status')
  const q = `UPDATE withdrawals SET status = ?, processed_at = CASE WHEN ? IN ('approved','processed') THEN NOW() ELSE processed_at END WHERE withdrawal_id = ?`
  await p.execute(q, [status, status, id])
  const [rows] = await p.execute('SELECT * FROM withdrawals WHERE withdrawal_id = ?', [id])
  return rows && rows[0] ? rows[0] : null
}

module.exports.createDonation = createDonation
module.exports.getDonationsByAuthor = getDonationsByAuthor
module.exports.createWithdrawal = createWithdrawal
module.exports.getWithdrawals = getWithdrawals
module.exports.updateWithdrawalStatus = updateWithdrawalStatus

// Author application helpers
async function createAuthorApplication({ user_id, pen_name, bio, samples }) {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS author_applications (
      application_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      pen_name VARCHAR(191),
      bio TEXT,
      samples TEXT,
      status VARCHAR(32) DEFAULT 'pending',
      admin_note TEXT,
      created_at DATETIME,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  const [res] = await p.execute('INSERT INTO author_applications (user_id, pen_name, bio, samples, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())', [user_id, pen_name || null, bio || null, samples || null, 'pending'])
  const id = res.insertId
  const [rows] = await p.execute('SELECT * FROM author_applications WHERE application_id = ?', [id])
  return rows && rows[0] ? rows[0] : null
}

async function getAuthorApplications(userId) {
  const p = await initPool()
  if (userId) {
    const [rows] = await p.execute('SELECT * FROM author_applications WHERE user_id = ? ORDER BY created_at DESC', [userId])
    return rows
  }
  const [rows] = await p.execute('SELECT * FROM author_applications ORDER BY created_at DESC')
  return rows
}

async function updateAuthorApplicationStatus(id, { status, admin_note }) {
  const p = await initPool()
  const allowed = ['pending', 'approved', 'declined']
  if (!allowed.includes(status)) throw new Error('invalid status')
  await p.execute('UPDATE author_applications SET status = ?, admin_note = ?, updated_at = NOW() WHERE application_id = ?', [status, admin_note || null, id])
  const [rows] = await p.execute('SELECT * FROM author_applications WHERE application_id = ?', [id])
  return rows && rows[0] ? rows[0] : null
}

async function promoteUserToAuthor(userId, { pen_name, bio }) {
  const p = await initPool()
  // update user role
  try {
    await p.execute('UPDATE users SET role = ? WHERE user_id = ?', ['author', userId])
  } catch (e) { }
  // ensure authors table exists and create author row
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS authors (
      author_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      pen_name VARCHAR(191),
      bio TEXT,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  // try to insert or ignore if exists
  try {
    const [existing] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [userId])
    if (existing && existing[0]) return existing[0].author_id
    // build fallback pen_name
    let pen = pen_name
    if (!pen) {
      try {
        const [uRows] = await p.execute('SELECT fullname, email FROM users WHERE user_id = ? LIMIT 1', [userId])
        if (uRows && uRows[0]) pen = uRows[0].fullname || uRows[0].email || pen
      } catch (e) { }
    }
    if (!pen) pen = `Author ${userId}`
    const [ins] = await p.execute('INSERT INTO authors (user_id, pen_name, bio, created_at) VALUES (?, ?, ?, NOW())', [userId, pen, bio || null])
    return ins.insertId
  } catch (e) {
    // on error, attempt to return existing
    try {
      const [rows] = await p.execute('SELECT author_id FROM authors WHERE user_id = ? LIMIT 1', [userId])
      if (rows && rows[0]) return rows[0].author_id
    } catch (ee) { }
    throw e
  }
}

module.exports.createAuthorApplication = createAuthorApplication
module.exports.getAuthorApplications = getAuthorApplications
module.exports.updateAuthorApplicationStatus = updateAuthorApplicationStatus
module.exports.promoteUserToAuthor = promoteUserToAuthor
