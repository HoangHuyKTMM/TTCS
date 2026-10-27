const mysql = require('mysql2/promise')
const { getGift } = require('./gifts')
const { chooseStoredChapter } = require('../../src/lib/readingProgress')

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

async function closePool() {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
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
    if (mineOnly) clauses.push('a.user_id = ?')
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
    const [rows] = mineOnly ? await p.query(sql, [userId]) : await p.query(sql)
    console.log('[getBooks] Query succeeded, rows:', rows.length)
    let chapterCounts = {}
    try {
      const ids = (rows || []).map(r => r && r.story_id).filter(Boolean)
      chapterCounts = await getChapterCountsByStoryIds(ids, !mineOnly)
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
      chapterCounts = await getChapterCountsByStoryIds(ids, true)
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

function decodePageCursor(cursor, expectedSort) {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
    if (!value || value.sort !== expectedSort || value.id == null) throw new Error('invalid_cursor')
    return value
  } catch (error) {
    throw Object.assign(new Error('invalid_cursor'), { code: 'invalid_cursor' })
  }
}

function encodePageCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function getBookPage({ limit = 24, cursor, sort = 'recent', genre, userId, likedOnly = false } = {}) {
  const p = await initPool()
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 24))
  const order = likedOnly ? 'liked' : sort
  if (!['recent', 'views', 'likes', 'recommended', 'liked'].includes(order)) throw Object.assign(new Error('invalid_sort'), { code: 'invalid_sort' })
  if (order === 'liked' && !userId) throw Object.assign(new Error('authorization_required'), { code: 'authorization_required' })
  const pageCursor = decodePageCursor(cursor, order)
  const params = []
  const filters = ['(s.is_hidden IS NULL OR s.is_hidden = 0)']
  if (genre && String(genre).trim() && String(genre).trim() !== 'Tất cả') {
    filters.push('s.genre LIKE ?')
    params.push(`%${String(genre).trim()}%`)
  }
  if (order === 'liked') {
    params.push(String(userId))
    filters.push('EXISTS (SELECT 1 FROM likes ul WHERE ul.user_id = ? AND ul.story_id = s.story_id)')
  }

  let cursorWhere = ''
  const outerParams = []
  if (pageCursor) {
    if (order === 'recent') {
      cursorWhere = 'WHERE (page.created_at < ? OR (page.created_at = ? AND page.id < ?))'
      outerParams.push(pageCursor.created_at, pageCursor.created_at, pageCursor.id)
    } else if (order === 'liked') {
      cursorWhere = 'WHERE (page.liked_at < ? OR (page.liked_at = ? AND page.id < ?))'
      outerParams.push(pageCursor.liked_at, pageCursor.liked_at, pageCursor.id)
    } else {
      const expr = order === 'views' ? 'page.views' : order === 'likes' ? 'page.likes_count' : '(page.views + page.likes_count * 3)'
      cursorWhere = `WHERE (${expr} < ? OR (${expr} = ? AND page.id < ?))`
      outerParams.push(Number(pageCursor.value), Number(pageCursor.value), pageCursor.id)
    }
  }

  const inner = `SELECT
      s.story_id AS id, s.title, s.description, s.genre, s.cover_image AS cover_url,
      a.pen_name AS author, s.created_at,
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id=s.story_id AND c.status='published') AS chapters_count,
      (SELECT COUNT(*) FROM likes l WHERE l.story_id=s.story_id) AS likes_count,
      (SELECT COUNT(*) FROM chapter_views v WHERE v.story_id=s.story_id) AS views,
      ${order === 'liked' ? '(SELECT MAX(ul.created_at) FROM likes ul WHERE ul.user_id = ? AND ul.story_id=s.story_id) AS liked_at' : 'NULL AS liked_at'}
    FROM stories s LEFT JOIN authors a ON a.author_id=s.author_id
    WHERE ${filters.join(' AND ')}`
  if (order === 'liked') params.unshift(String(userId))
  const orderBy = order === 'recent' ? 'page.created_at DESC, page.id DESC'
    : order === 'views' ? 'page.views DESC, page.id DESC'
      : order === 'likes' ? 'page.likes_count DESC, page.id DESC'
        : order === 'liked' ? 'page.liked_at DESC, page.id DESC'
          : '(page.views + page.likes_count * 3) DESC, page.id DESC'
  // query(), not execute(): MySQL rejects a prepared LIMIT placeholder
  // with "Incorrect arguments to mysqld_stmt_execute".
  const [rows] = await p.query(
    `SELECT page.* FROM (${inner}) page ${cursorWhere} ORDER BY ${orderBy} LIMIT ?`,
    [...params, ...outerParams, safeLimit + 1]
  )
  const hasMore = rows.length > safeLimit
  const books = (hasMore ? rows.slice(0, safeLimit) : rows).map(row => ({
    ...row,
    id: String(row.id),
    likes_count: Number(row.likes_count || 0),
    views: Number(row.views || 0),
    chapters_count: Number(row.chapters_count || 0),
    cover_url: row.cover_url || null,
    liked: order === 'liked',
  }))
  let nextCursor = null
  if (hasMore && books.length) {
    const last = books[books.length - 1]
    const value = order === 'recent' ? { sort: order, created_at: last.created_at, id: last.id }
      : order === 'liked' ? { sort: order, liked_at: last.liked_at, id: last.id }
        : { sort: order, value: order === 'views' ? last.views : order === 'likes' ? last.likes_count : last.views + last.likes_count * 3, id: last.id }
    nextCursor = encodePageCursor(value)
  }
  return { books, nextCursor, hasMore }
}

// Bulk fetch chapter counts for a list of story ids (supports story_id or book_id schemas)
async function getChapterCountsByStoryIds(ids = [], publishedOnly = false) {
  if (!ids || ids.length === 0) return {}
  const p = await initPool()
  const placeholders = ids.map(() => '?').join(', ')
  const candidates = await getChaptersFkCandidates(p)
  let rows = []
  const statusClause = publishedOnly ? " AND (status = 'published' OR status IS NULL)" : ''
  for (const fkCol of candidates) {
    try {
      const [r] = await p.execute(
        `SELECT ${fkCol} AS sid, COUNT(*) AS chapters_count
         FROM chapters
         WHERE ${fkCol} IN (${placeholders})${statusClause}
         GROUP BY ${fkCol}`,
        ids
      )
      rows = r || []
      break
    } catch (e) {
      if (publishedOnly && e && e.code === 'ER_BAD_FIELD_ERROR') {
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
        } catch (e2) { /* try next candidate */ }
      }
    }
  }
  const map = {}
  for (const r of rows || []) {
    map[String(r.sid)] = Number(r.chapters_count || 0)
  }
  return map
}

function penNameSlug(name) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40)
  return slug || 'author'
}

// Exact pen_name reuses that author. An unknown name gets its own user and author row.
// Never attach a typed name to an existing admin (or any other) author row.
async function resolveAuthorId(p, { author, author_id } = {}) {
  if (author_id) return author_id
  const pen = typeof author === 'string' ? author.trim() : ''
  if (!pen) return null
  const [exact] = await p.execute('SELECT author_id FROM authors WHERE pen_name = ? LIMIT 1', [pen])
  if (exact && exact[0]) return exact[0].author_id
  const email = `pen.${penNameSlug(pen)}.${Date.now()}@readerapp.local`
  const fullname = pen.slice(0, 100)
  const penStored = pen.slice(0, 191)
  const [userIns] = await p.execute(
    'INSERT INTO users (fullname, email, password_hash, role, created_at) VALUES (?, ?, NULL, ?, NOW())',
    [fullname, email, 'author']
  )
  const [authorIns] = await p.execute(
    'INSERT INTO authors (user_id, pen_name, bio, created_at) VALUES (?, ?, ?, NOW())',
    [userIns.insertId, penStored, null]
  )
  return authorIns.insertId
}

// Keep story_genres in step with the comma-separated stories.genre label the admin form saves.
async function syncStoryGenres(p, storyId, genreLabel) {
  try {
    const seen = new Set()
    const names = []
    for (const part of String(genreLabel == null ? '' : genreLabel).split(',')) {
      const name = part.trim().slice(0, 100)
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
    await p.execute('DELETE FROM story_genres WHERE story_id = ?', [storyId])
    for (const name of names) {
      let genreId = null
      const [found] = await p.execute('SELECT genre_id FROM genres WHERE LOWER(name) = LOWER(?) LIMIT 1', [name])
      if (found && found[0]) genreId = found[0].genre_id
      if (!genreId) {
        try {
          const [ins] = await p.execute('INSERT INTO genres (name, description, created_at) VALUES (?, NULL, NOW())', [name])
          genreId = ins.insertId
        } catch (e) {
          if (!(e && e.code === 'ER_DUP_ENTRY')) throw e
          const [again] = await p.execute('SELECT genre_id FROM genres WHERE LOWER(name) = LOWER(?) LIMIT 1', [name])
          if (again && again[0]) genreId = again[0].genre_id
          else throw e
        }
      }
      if (!genreId) continue
      try {
        await p.execute('INSERT INTO story_genres (story_id, genre_id) VALUES (?, ?)', [storyId, genreId])
      } catch (e) {
        if (!(e && e.code === 'ER_DUP_ENTRY')) throw e
      }
    }
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR')) return
    throw e
  }
}

async function createBook({ title, author, description, cover_url, genre, author_id }) {
  const p = await initPool()
  // guard cover length (column often varchar(255))
  const safeCover = cover_url && cover_url.length > 500 ? null : cover_url
  const author_id_local = await resolveAuthorId(p, { author, author_id })
  if (!author_id_local) {
    const err = new Error('author required')
    err.code = 'author_required'
    throw err
  }
  // Some schemas restrict status values; use NULL to allow DB defaults when unsure
  const [res] = await p.execute('INSERT INTO stories (author_id, title, description, status, created_at , cover_image, genre) VALUES (?, ?, ?, ?, NOW(),?,?)', [author_id_local, title, description, null, safeCover || null, genre || null])
  const id = res.insertId
  await syncStoryGenres(p, id, genre)
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
          `INSERT INTO chapters (${fkCol}, chapter_no, title, ${contentCol}, content_format, status, created_at) VALUES (?, ?, ?, ?, 'plain_text', 'pending_review', NOW())`,
          [bookId, nextNo, title, content]
        )
        insertedId = res.insertId
      } else {
        const [res] = await p.execute(
          `INSERT INTO chapters (${fkCol}, title, ${contentCol}, content_format, status, created_at) VALUES (?, ?, ?, 'plain_text', 'pending_review', NOW())`,
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
            `INSERT INTO chapters (${fkCol}, chapter_no, title, status, created_at) VALUES (?, ?, ?, 'pending_review', NOW())`,
            [bookId, nextNo, title]
          )
          insertedId = res2.insertId
        } else {
          const [res2] = await p.execute(
            `INSERT INTO chapters (${fkCol}, title, status, created_at) VALUES (?, ?, 'pending_review', NOW())`,
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
  return (rows || []).map(mapChapterRow)
}

function mapChapterRow(r) {
  const content = r.content || r.body || r.text || r.chapter_content || r.chapter_body || ''
  return {
    id: String(r.chapter_id || r.id || ''),
    chapter_no: r.chapter_no || r.chapterNo || null,
    title: r.title || null,
    content,
    content_format: r.content_format || 'html',
    status: r.status || 'published',
    created_at: r.created_at || null,
  }
}

async function getMaxChapterNo(bookId) {
  const p = await initPool()
  const fkCandidates = await getChaptersFkCandidates(p)
  const hasNo = await getChaptersHasChapterNo(p)
  if (!hasNo) return 0
  for (const fkCol of fkCandidates) {
    try {
      const [rows] = await p.execute(
        `SELECT COALESCE(MAX(chapter_no), 0) AS max_no FROM chapters WHERE ${fkCol} = ?`,
        [bookId]
      )
      return rows && rows[0] ? Number(rows[0].max_no) || 0 : 0
    } catch (e) { }
  }
  return 0
}

async function getChaptersInRange(bookId, fromChapter, toChapter, reader = {}) {
  const p = await initPool()
  const fkCandidates = await getChaptersFkCandidates(p)
  const hasNo = await getChaptersHasChapterNo(p)
  if (!hasNo) return []
  const contentCol = await getChaptersContentColumn(p)
  for (const fkCol of fkCandidates) {
    try {
      const [rows] = await p.execute(
        `SELECT chapter_no, title, \`${contentCol}\` AS content FROM chapters c
         WHERE ${fkCol} = ? AND chapter_no BETWEEN ? AND ? AND c.status = 'published'
         ${reader.requireViewed ? `AND EXISTS (SELECT 1 FROM chapter_views v WHERE v.chapter_id=c.chapter_id AND v.story_id=c.${fkCol} AND v.user_id=?)` : ''}
         ORDER BY chapter_no ASC`,
        reader.requireViewed ? [bookId, fromChapter, toChapter, reader.readerKey || ''] : [bookId, fromChapter, toChapter]
      )
      return (rows || []).map(mapChapterRow)
    } catch (e) { }
  }
  return []
}

async function getStorySummaryCache(storyId, fromChapter, toChapter, sourceHash) {
  const p = await initPool()
  const [rows] = await p.execute(
    'SELECT summary_text FROM story_summary_cache WHERE story_id = ? AND from_chapter = ? AND to_chapter = ? AND source_hash = ? LIMIT 1',
    [storyId, fromChapter, toChapter, sourceHash || null]
  )
  return rows && rows[0] && rows[0].summary_text ? String(rows[0].summary_text) : null
}

async function saveStorySummaryCache({ story_id, from_chapter, to_chapter, summary_text, source_hash }) {
  const p = await initPool()
  await p.execute(
    `INSERT INTO story_summary_cache (story_id, from_chapter, to_chapter, summary_text, source_hash)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), source_hash=VALUES(source_hash)`,
    [story_id, from_chapter, to_chapter, String(summary_text || ''), source_hash || null]
  )
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
    content_format: r.content_format || 'html',
    status: r.status || 'published',
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
    content_format: r.content_format || 'html',
      status: r.status || 'published',
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
    parts.push("content_format = 'plain_text'")
  }
  if (parts.length === 0) return null
  const pkCandidates = await getChaptersPkCandidates(p)
  for (const pkCol of pkCandidates) {
    try {
      const sql = `UPDATE chapters SET ${parts.join(', ')}${content !== undefined ? ", status = 'pending_review'" : ''} WHERE ${pkCol} = ?`
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
  // Top stories by in-app chapter opens and likes. Same counts the reader app shows.
  try {
    const [tops] = await p.execute(`
      SELECT s.story_id AS id, s.title AS title,
             COALESCE(v.views_count, 0) AS views,
             COALESCE(l.likes_count, 0) AS likes
      FROM stories s
      LEFT JOIN (
        SELECT story_id, COUNT(*) AS views_count
        FROM chapter_views
        GROUP BY story_id
      ) v ON v.story_id = s.story_id
      LEFT JOIN (
        SELECT story_id, COUNT(*) AS likes_count
        FROM likes
        GROUP BY story_id
      ) l ON l.story_id = s.story_id
      WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
        AND (COALESCE(v.views_count, 0) > 0 OR COALESCE(l.likes_count, 0) > 0)
      ORDER BY views DESC, likes DESC, s.story_id ASC
      LIMIT 6
    `)
    stats.top_books = (tops || []).map(r => ({
      id: String(r.id),
      title: r.title,
      views: Number(r.views || 0),
      likes: Number(r.likes || 0),
    }))
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

let _readingHistoryCols = null

async function ensureReadingHistoryTable() {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS reading_history (
      history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id VARCHAR(191) NOT NULL,
      story_id VARCHAR(191) NOT NULL,
      chapter_id VARCHAR(191) NULL,
      chapter_no INT NULL,
      progress_pct DECIMAL(5,2) NULL,
      last_read_at DATETIME NULL,
      PRIMARY KEY (history_id),
      UNIQUE KEY uq_history_user_story (user_id, story_id),
      KEY idx_history_user (user_id, last_read_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  try { await p.execute('ALTER TABLE reading_history ADD COLUMN chapter_no INT NULL') } catch (e) { }
  try { await p.execute('ALTER TABLE reading_history ADD COLUMN progress_pct DECIMAL(5,2) NULL') } catch (e) { }
  try { await p.execute('ALTER TABLE reading_history ADD UNIQUE KEY uq_history_user_story (user_id, story_id)') } catch (e) { }
  _readingHistoryCols = null
  return p
}

async function getReadingHistoryColumns(p) {
  if (_readingHistoryCols) return _readingHistoryCols
  const cols = new Set()
  try {
    const [rows] = await p.execute('SHOW COLUMNS FROM reading_history')
    for (const r of rows || []) cols.add(String(r.Field || '').toLowerCase())
  } catch (e) { }
  _readingHistoryCols = cols
  return cols
}

function mapProgressRow(r) {
  if (!r) return null
  const chapterNo = r.chapter_no != null ? Number(r.chapter_no) : null
  const pct = r.progress_pct != null ? Number(r.progress_pct) : null
  return {
    history_id: r.history_id,
    user_id: r.user_id != null ? String(r.user_id) : null,
    book_id: String(r.story_id || r.book_id || ''),
    story_id: String(r.story_id || r.book_id || ''),
    chapter_id: r.chapter_id != null ? String(r.chapter_id) : null,
    chapter_no: Number.isFinite(chapterNo) && chapterNo > 0 ? chapterNo : null,
    progress_pct: Number.isFinite(pct) ? pct : null,
    last_read_at: r.last_read_at || null,
    title: r.title || r.story_title || null,
    cover_url: r.cover_url || r.cover || null,
    genre: r.genre || null
  }
}

async function enrichProgressRow(p, row) {
  const mapped = mapProgressRow(row)
  if (!mapped || !mapped.story_id) return mapped
  try {
    const [stories] = await p.execute('SELECT title, cover_image AS cover_url, genre FROM stories WHERE story_id = ? LIMIT 1', [mapped.story_id])
    if (stories && stories[0]) {
      mapped.title = stories[0].title || mapped.title
      mapped.cover_url = stories[0].cover_url || mapped.cover_url
      mapped.genre = stories[0].genre || mapped.genre
    }
  } catch (e) { }
  if (!mapped.chapter_no && mapped.chapter_id) {
    try {
      const ch = await getChapterById(mapped.story_id, mapped.chapter_id)
      if (ch && ch.chapter_no) mapped.chapter_no = Number(ch.chapter_no)
    } catch (e) { }
  }
  return mapped
}

function applyFurthestView(mapped, viewed) {
  if (!mapped || !viewed) return mapped
  const current = Number(mapped.chapter_no) || 0
  if (viewed.chapter_no > current) {
    mapped.chapter_no = viewed.chapter_no
    mapped.chapter_id = viewed.chapter_id
    mapped.progress_pct = null
  }
  return mapped
}

async function furthestViewedChapter(p, userId, bookId) {
  try {
    const [rows] = await p.execute(
      `SELECT c.chapter_no, CAST(c.chapter_id AS CHAR) AS chapter_id
       FROM chapter_views v
       INNER JOIN chapters c ON c.chapter_id = v.chapter_id
       WHERE v.user_id = ? AND v.story_id = ?
       ORDER BY c.chapter_no DESC
       LIMIT 1`,
      [String(userId), String(bookId)]
    )
    const row = rows && rows[0]
    const no = row ? Number(row.chapter_no) : 0
    if (!Number.isFinite(no) || no <= 0) return null
    return { chapter_no: Math.floor(no), chapter_id: row.chapter_id != null ? String(row.chapter_id) : null }
  } catch (e) {
    return null
  }
}

async function furthestViewedByUser(p, userId) {
  try {
    const [rows] = await p.execute(
      `SELECT CAST(c.story_id AS CHAR) AS story_id, c.chapter_no, CAST(c.chapter_id AS CHAR) AS chapter_id
       FROM chapters c
       INNER JOIN (
         SELECT c2.story_id AS story_id, MAX(c2.chapter_no) AS chapter_no
         FROM chapter_views v
         INNER JOIN chapters c2 ON c2.chapter_id = v.chapter_id
         WHERE v.user_id = ?
         GROUP BY c2.story_id
       ) m ON m.story_id = c.story_id AND m.chapter_no = c.chapter_no`,
      [String(userId)]
    )
    const map = new Map()
    for (const row of rows || []) {
      const id = String(row.story_id || '')
      const no = Number(row.chapter_no)
      if (!id || !Number.isFinite(no) || no <= 0 || map.has(id)) continue
      map.set(id, { chapter_no: Math.floor(no), chapter_id: row.chapter_id != null ? String(row.chapter_id) : null })
    }
    return map
  } catch (e) {
    return new Map()
  }
}

async function upsertProgress({ user_id, book_id, chapter_id, chapter_no, progress }) {
  const p = await ensureReadingHistoryTable()
  const cols = await getReadingHistoryColumns(p)
  let incomingNo = chapter_no != null && Number(chapter_no) > 0 ? Math.floor(Number(chapter_no)) : null
  let incomingId = chapter_id != null && String(chapter_id).trim() !== '' ? String(chapter_id) : null
  const pctRaw = progress != null ? Number(progress) : null
  const incomingPct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, pctRaw)) : null

  if (incomingNo) {
    try {
      const ch = await getChapterByNumber(book_id, incomingNo)
      if (ch && ch.id) incomingId = String(ch.id)
    } catch (e) { }
  } else if (incomingId) {
    try {
      const ch = await getChapterById(book_id, incomingId)
      if (ch && ch.chapter_no) incomingNo = Number(ch.chapter_no)
    } catch (e) { }
  }

  const [existingRows] = await p.execute(
    'SELECT chapter_id, chapter_no, progress_pct FROM reading_history WHERE user_id = ? AND story_id = ? LIMIT 1',
    [user_id, book_id]
  )
  const existing = existingRows && existingRows[0] ? existingRows[0] : null
  const viewed = await furthestViewedChapter(p, user_id, book_id)
  const choice = chooseStoredChapter({
    storedNo: existing && existing.chapter_no,
    incomingNo,
    viewedNo: viewed && viewed.chapter_no,
    storedProgress: existing && existing.progress_pct,
    incomingProgress: incomingPct,
  })

  let chapNo = choice.chapterNo
  let chapId = incomingId
  if (choice.source === 'stored' && existing) {
    chapNo = Number(existing.chapter_no) || chapNo
    chapId = existing.chapter_id != null ? String(existing.chapter_id) : chapId
  } else if (choice.source === 'viewed' && viewed) {
    chapNo = viewed.chapter_no
    chapId = viewed.chapter_id || chapId
  }

  const last_read_at = new Date()
  const sets = ['chapter_id = ?', 'last_read_at = ?']
  const setParams = [chapId, last_read_at]
  if (cols.has('chapter_no')) { sets.push('chapter_no = ?'); setParams.push(chapNo) }
  if (cols.has('progress_pct') && choice.replaceProgress) {
    if (choice.progress == null) sets.push('progress_pct = NULL')
    else { sets.push('progress_pct = ?'); setParams.push(choice.progress) }
  }

  const [upd] = await p.execute(
    `UPDATE reading_history SET ${sets.join(', ')} WHERE user_id = ? AND story_id = ?`,
    [...setParams, user_id, book_id]
  )
  if (upd && upd.affectedRows > 0) {
    return getProgressByUserBook(user_id, book_id)
  }

  const insertCols = ['user_id', 'story_id', 'chapter_id', 'last_read_at']
  const insertVals = [user_id, book_id, chapId, last_read_at]
  if (cols.has('chapter_no')) { insertCols.push('chapter_no'); insertVals.push(chapNo) }
  if (cols.has('progress_pct') && choice.progress != null) { insertCols.push('progress_pct'); insertVals.push(choice.progress) }
  const placeholders = insertCols.map(() => '?').join(', ')
  try {
    await p.execute(`INSERT INTO reading_history (${insertCols.join(', ')}) VALUES (${placeholders})`, insertVals)
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      await p.execute(
        `UPDATE reading_history SET ${sets.join(', ')} WHERE user_id = ? AND story_id = ?`,
        [...setParams, user_id, book_id]
      )
    } else {
      throw e
    }
  }
  return getProgressByUserBook(user_id, book_id)
}

async function getProgressByUserBook(userId, bookId) {
  const p = await ensureReadingHistoryTable()
  const [rows] = await p.execute('SELECT * FROM reading_history WHERE user_id = ? AND story_id = ? LIMIT 1', [userId, bookId])
  if (!rows || !rows[0]) return null
  const mapped = await enrichProgressRow(p, rows[0])
  return applyFurthestView(mapped, await furthestViewedChapter(p, userId, bookId))
}

async function getProgressByUser(userId) {
  const p = await ensureReadingHistoryTable()
  try {
    const [rows] = await p.execute(
      `SELECT h.*, s.title, s.cover_image AS cover_url, s.genre
       FROM reading_history h
       LEFT JOIN stories s ON s.story_id = h.story_id
       WHERE h.user_id = ?
       ORDER BY h.last_read_at DESC`,
      [userId]
    )
    const furthest = await furthestViewedByUser(p, userId)
    const list = []
    for (const row of rows || []) {
      const mapped = mapProgressRow(row)
      if (mapped && !mapped.chapter_no && mapped.chapter_id) {
        try {
          const ch = await getChapterById(mapped.story_id, mapped.chapter_id)
          if (ch && ch.chapter_no) mapped.chapter_no = Number(ch.chapter_no)
        } catch (e) { }
      }
      if (mapped) list.push(applyFurthestView(mapped, furthest.get(String(mapped.story_id))))
    }
    return list
  } catch (e) {
    const [rows] = await p.execute('SELECT * FROM reading_history WHERE user_id = ? ORDER BY last_read_at DESC', [userId])
    const furthest = await furthestViewedByUser(p, userId)
    const list = []
    for (const row of rows || []) {
      const mapped = await enrichProgressRow(p, row)
      if (mapped) list.push(applyFurthestView(mapped, furthest.get(String(mapped.story_id))))
    }
    return list
  }
}

module.exports = {
  initPool,
  getBooks,
  getBookPage,
  createBook,
  getBookById,
  createChapter,
  getChaptersByBook,
  getChaptersInRange,
  getMaxChapterNo,
  getStorySummaryCache,
  saveStorySummaryCache,
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
  getProgressByUser,
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
  // Empty author is ignored. A real pen name resolves to that author, or a new user+author row.
  let author_id = null
  if (typeof author === 'string' && author.trim()) {
    author_id = await resolveAuthorId(p, { author })
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
  await p.execute(sql, params)
  if (genre !== undefined) await syncStoryGenres(p, id, genre)
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

// Author unlock is permanent. Only a monthly VIP role expires. If an older expiry hid an author's stories, unhide once.
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
  if (row.role === 'author') {
    try {
      const [hidden] = await p.execute(
        `SELECT 1 FROM stories s
         JOIN authors a ON s.author_id = a.author_id
         WHERE a.user_id = ? AND s.is_hidden = 1
         LIMIT 1`,
        [userId]
      )
      if (hidden && hidden[0]) await setAuthorStoriesHiddenByUserId(userId, false, p)
    } catch (e) { /* ignore */ }
    return { role: row.role, vip_until: row.vip_until }
  }
  const now = Date.now()
  const expired = row.vip_until ? new Date(row.vip_until).getTime() <= now : false
  if (expired && row.role === 'vip') {
    try { await p.execute('UPDATE users SET role = ?, vip_until = NULL WHERE user_id = ?', ['user', userId]) } catch (e) { /* ignore */ }
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
  const hasDays = days != null && Number(days) > 0
  const monthsToAdd = hasDays ? 0 : Math.max(1, Math.floor(Number(months || 1)) || 1)
  const daysToAdd = hasDays ? Math.max(1, Math.floor(Number(days))) : 0

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

  // Stack from the later of now and the current vip_until. Days win when the caller sends a positive day count.
  const intervalSql = hasDays
    ? 'UPDATE users SET role = ?, vip_until = DATE_ADD(GREATEST(NOW(), IFNULL(vip_until, NOW())), INTERVAL ? DAY) WHERE user_id = ?'
    : 'UPDATE users SET role = ?, vip_until = DATE_ADD(GREATEST(NOW(), IFNULL(vip_until, NOW())), INTERVAL ? MONTH) WHERE user_id = ?'
  const ok = await runUpdate(intervalSql, [roleToSet, hasDays ? daysToAdd : monthsToAdd, id])

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
  try { await p.execute('ALTER TABLE comments ADD COLUMN toxicity_score FLOAT NOT NULL DEFAULT 0') } catch (e) { }
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
    if (opts.publicFeed) {
      where.push('c.enabled = 1')
      if (opts.viewerId) {
        where.push(`(c.status = 'approved' OR (c.user_id = ? AND c.status IN ('shadowbanned', 'pending')))`)
        params.push(opts.viewerId)
      } else {
        where.push(`c.status = 'approved'`)
      }
    } else if (statusFilter) { where.push('c.status = ?'); params.push(statusFilter) }
    else if (!includeAll) { where.push('c.status = "approved"') }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
    const limitSql = limit ? ' LIMIT ' + limit + (offset ? ' OFFSET ' + offset : '') : ''
    const [rows] = await p.execute(`
      SELECT c.comment_id as id, c.story_id, c.user_id, c.parent_id, c.content, c.enabled, c.status, c.is_negative, c.toxicity_score, c.reviewed_by, c.reviewed_at, c.created_at,
             (c.status='pending' AND EXISTS (SELECT 1 FROM moderation_logs ml WHERE ml.target_type='comment' AND ml.target_id=c.comment_id AND ml.status='pending_review')) AS awaiting_admin,
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
      awaiting_admin: !!r.awaiting_admin,
      is_negative: !!r.is_negative,
      toxicity_score: r.toxicity_score != null ? Number(r.toxicity_score) : 0,
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

async function createComment(bookId, { user_id, content, parent_id, is_negative, negative_probability, status }) {
  const p = await initPool()
  await ensureCommentsTable(p)
  const nextStatus = status || 'approved'

  const runInsert = async () => {
    const [res] = await p.execute(
      'INSERT INTO comments (story_id, user_id, parent_id, content, enabled, status, is_negative, negative_probability, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [bookId, user_id, parent_id || null, content, 1, nextStatus, is_negative || 0, negative_probability || 0]
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
  const conn = await p.getConnection()
  try {
  await conn.beginTransaction()
  const [current] = await conn.execute('SELECT content FROM comments WHERE comment_id=? FOR UPDATE', [id])
  if (!current[0]) { await conn.rollback(); return null }
  const changed = content !== undefined && content !== current[0].content
  const nextStatus = status !== undefined ? status : changed ? 'pending' : undefined
  const parts = []
  const params = []
  if (content !== undefined) { parts.push('content = ?'); params.push(content) }
  if (enabled !== undefined) { parts.push('enabled = ?'); params.push(enabled ? 1 : 0) }
  if (nextStatus !== undefined) { parts.push('status = ?'); params.push(nextStatus) }
  if (nextStatus === 'pending') {
    parts.push("reviewed_by=NULL", "reviewed_at=NULL", "toxicity_score=0", "is_negative=0", "moderation_label='pending'", "agent_reason=NULL")
  } else {
    if (reviewed_by !== undefined) { parts.push('reviewed_by = ?'); params.push(reviewed_by) }
    if (nextStatus !== undefined) parts.push('reviewed_at = NOW()')
  }
  if (parts.length === 0) { await conn.rollback(); return null }
  params.push(id)
  const sql = `UPDATE comments SET ${parts.join(', ')} WHERE comment_id = ?`
  await conn.execute(sql, params)
  if (changed || nextStatus !== undefined) {
    const logStatus = nextStatus === 'approved' ? 'approved_by_admin' : nextStatus === 'rejected' ? 'penalized_by_admin' : 'superseded'
    await conn.execute("UPDATE moderation_logs SET status=? WHERE target_type='comment' AND target_id=? AND status='pending_review'", [logStatus, id])
  }
  if (nextStatus === 'pending') {
    await conn.execute(`INSERT INTO ai_moderation_jobs (comment_id,content_hash) VALUES (?,?)
      ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash),status='queued',attempts=0,
      available_at=NOW(),lease_until=NULL,lease_token=NULL`, [id, require('./ai_store').hashText(content ?? current[0].content)])
  } else if (['approved', 'rejected', 'shadowbanned'].includes(nextStatus)) {
    await conn.execute("UPDATE ai_moderation_jobs SET status='done',lease_until=NULL,lease_token=NULL WHERE comment_id=?", [id])
  }
  const [rows] = await conn.execute('SELECT comment_id as id, story_id, user_id, parent_id, content, enabled, status, reviewed_by, reviewed_at, created_at FROM comments WHERE comment_id = ?', [id])
  await conn.commit()
  return rows && rows[0] ? { id: String(rows[0].id), story_id: String(rows[0].story_id), user_id: String(rows[0].user_id), parent_id: rows[0].parent_id ? String(rows[0].parent_id) : null, content: rows[0].content, enabled: !!rows[0].enabled, status: rows[0].status || 'approved', reviewed_by: rows[0].reviewed_by || null, reviewed_at: rows[0].reviewed_at || null, created_at: rows[0].created_at } : null
  } catch (error) { await conn.rollback(); throw error }
  finally { conn.release() }
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
    const sql = `SELECT ${selectId}, ${followerCol} as follower_id, ${followeeCol} as followee_id, ${selectCreated} FROM follows WHERE ${followerCol} = ? ${orderBy}`
    const [rows] = await p.execute(sql, [userId])
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
    chapterCounts = await getChapterCountsByStoryIds(ids, true)
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
            AND (c.status = 'published' OR c.status IS NULL)
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
            AND (c.status = 'published' OR c.status IS NULL)
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

// Notifications: aggregate events for current user
// For authors: likes on your stories, follows of you, donations to you
// For followers: new stories + chapters from authors you follow
async function ensurePushTables(p) {
  await p.execute(`CREATE TABLE IF NOT EXISTS user_notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id VARCHAR(191) NOT NULL, type VARCHAR(32) NOT NULL,
    story_id VARCHAR(191) NOT NULL, chapter_id VARCHAR(191) NOT NULL, chapter_no INT NULL,
    story_title VARCHAR(255) NULL, chapter_title VARCHAR(255) NULL, actor_name VARCHAR(191) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id),
    UNIQUE KEY uk_notification_user_chapter (user_id,type,chapter_id), KEY idx_notifications_user_time (user_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await p.execute(`CREATE TABLE IF NOT EXISTS fcm_tokens (
    token VARCHAR(512) NOT NULL, user_id VARCHAR(191) NOT NULL, platform VARCHAR(16) NOT NULL DEFAULT 'android',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (token), KEY idx_fcm_tokens_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

async function registerFcmToken(userId, token, platform = 'android') {
  const p = await initPool()
  await ensurePushTables(p)
  await p.execute(`INSERT INTO fcm_tokens (token,user_id,platform) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),platform=VALUES(platform),updated_at=NOW()`,
  [String(token), String(userId), String(platform)])
  return { ok: true }
}

async function removeFcmToken(userId, token) {
  const p = await initPool()
  await ensurePushTables(p)
  const [result] = await p.execute('DELETE FROM fcm_tokens WHERE user_id=? AND token=?', [String(userId), String(token)])
  return { ok: true, removed: result.affectedRows > 0 }
}

async function notifyChapterPublished(chapterId) {
  const p = await initPool()
  await ensurePushTables(p)
  await ensureAuthorFollowsTable(p)
  const [rows] = await p.execute(`SELECT c.chapter_id,c.chapter_no,c.title AS chapter_title,s.story_id,s.title AS story_title,
    COALESCE(a.pen_name,'Tác giả') AS actor_name,a.user_id AS author_user_id
    FROM chapters c JOIN stories s ON s.story_id=c.story_id
    LEFT JOIN authors a ON a.author_id=s.author_id WHERE c.chapter_id=? AND c.status='published' LIMIT 1`, [String(chapterId)])
  const chapter = rows[0]
  if (!chapter) return { notified: 0 }
  const [inserted] = await p.execute(`INSERT IGNORE INTO user_notifications
    (user_id,type,story_id,chapter_id,chapter_no,story_title,chapter_title,actor_name,created_at)
    SELECT af.user_id,'new_chapter',s.story_id,c.chapter_id,c.chapter_no,s.title,c.title,COALESCE(a.pen_name,'Tác giả'),NOW()
    FROM chapters c JOIN stories s ON s.story_id=c.story_id
    LEFT JOIN authors a ON a.author_id=s.author_id
    JOIN author_follows af ON af.author_id=s.author_id
    WHERE c.chapter_id=? AND c.status='published' AND (a.user_id IS NULL OR af.user_id<>a.user_id)`, [String(chapterId)])
  if (!inserted.affectedRows) return { notified: 0 }

  const [tokens] = await p.execute(`SELECT DISTINCT ft.token FROM fcm_tokens ft
    JOIN user_notifications n ON n.user_id=ft.user_id
    WHERE n.type='new_chapter' AND n.chapter_id=?`, [String(chapterId)])
  if (tokens.length) {
    const delivery = require('./push').sendNewChapter(tokens.map(row => row.token), {
        storyId: chapter.story_id,
        storyTitle: chapter.story_title,
        chapterId: chapter.chapter_id,
        chapterNo: chapter.chapter_no,
        chapterTitle: chapter.chapter_title || `Chương ${chapter.chapter_no || ''}`,
      })
    void delivery.then(async deliveryErrors => {
      const invalid = deliveryErrors.filter(item => ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(item.code)).map(item => item.token)
      for (const token of invalid) await p.execute('DELETE FROM fcm_tokens WHERE token=?', [token])
    }).catch(error => {
      console.error('[push] Unable to send chapter notification:', error.code || error.message)
    })
  }
  return { notified: inserted.affectedRows }
}

async function getNotifications(userId, opts = {}) {
  if (!userId) return []
  const limit = Math.max(1, Math.min(50, Number.parseInt(opts.limit, 10) || 30))
  const offset = Math.max(0, Number.parseInt(opts.offset, 10) || 0)
  const need = Math.min(200, limit + offset)

  const p = await initPool()
  try { await ensurePushTables(p) } catch (e) { /* existing installs are upgraded by the migration runner */ }

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
      gift_code VARCHAR(32) NULL,
      gift_name VARCHAR(64) NULL,
      quantity INT NOT NULL DEFAULT 1,
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

  // === NOTIFICATIONS FOR AUTHORS (if user is an author) ===

  // Likes on stories authored by this user
  let likeRows = []
  if (authorIds && authorIds.length) {
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
        WHERE a.user_id = ?
          AND l.user_id <> ?
        ORDER BY l.created_at DESC
        LIMIT ?
      `, [userId, userId, need])
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
          WHERE s.author_id IN (SELECT author_id FROM authors WHERE user_id = ?)
            AND l.user_id <> ?
          ORDER BY l.created_at DESC
          LIMIT ?
        `, [userId, userId, need])
        likeRows = rows || []
      } catch (e2) {
        likeRows = []
      }
    }
  }

  // New followers of this author (only if user is an author)
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

  // Donations received by this user (only if user is an author)
  let donationRows = []
  if (authorIds && authorIds.length) {
    try {
      await ensureDonationGiftColumns(p)
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
          d.message,
          d.gift_code,
          d.gift_name,
          d.quantity
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
  }

  // === NOTIFICATIONS FOR FOLLOWERS ===
  // New stories + chapters from authors the user follows

  let followedAuthorStories = []
  let followedAuthorChapters = []
  try {
    await ensurePushTables(p)
    const [rows] = await p.execute(`SELECT id AS event_id,created_at,story_id,chapter_id,chapter_no,
      story_title,chapter_title,actor_name FROM user_notifications
      WHERE user_id=? AND type='new_chapter' ORDER BY created_at DESC LIMIT ?`, [String(userId), need])
    followedAuthorChapters = rows || []
  } catch (e) { /* migrations may not have run yet */ }

  try {
    // Get list of authors this user follows
    const [followedAuthors] = await p.execute(`
      SELECT author_id
      FROM author_follows
      WHERE user_id = ?
    `, [userId])

    const followedAuthorIds = (followedAuthors || []).map(r => r.author_id).filter(Boolean)

    if (followedAuthorIds.length > 0) {
      const placeholders = followedAuthorIds.map(() => '?').join(', ')

      // Get new stories from followed authors
      try {
        const [storyRows] = await p.query(`
          SELECT
            s.story_id,
            s.title as story_title,
            s.created_at,
            s.cover_image,
            a.author_id,
            a.pen_name as author_name,
            a.user_id as author_user_id
          FROM stories s
          JOIN authors a ON s.author_id = a.author_id
          WHERE s.author_id IN (${placeholders})
            AND (s.is_hidden IS NULL OR s.is_hidden = 0)
          ORDER BY s.created_at DESC
          LIMIT ?
        `, [...followedAuthorIds, need])
        followedAuthorStories = storyRows || []
      } catch (e) {
        console.error('Error fetching followed author stories:', e)
      }

    }
  } catch (e) {
    console.error('Error fetching followed authors notifications:', e)
  }

  // Trending rank notification: your stories' current position on the "Thịnh hành" board.
  // The Rank tab sorts by views descending, where views = COUNT(*) chapter_views.
  // We only compute ranks for the global top N to keep this lightweight.
  let rankItems = []
  if (authorIds && authorIds.length) {
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
          WHERE a.user_id = ?
            AND (s.is_hidden IS NULL OR s.is_hidden = 0)
        `, [userId])

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
      message: r.message || null,
      gift_code: r.gift_code || null,
      gift_name: r.gift_name || null,
      gift_emoji: r.gift_code && getGift(r.gift_code) ? getGift(r.gift_code).emoji : null,
      quantity: r.quantity !== undefined && r.quantity !== null ? Number(r.quantity) : null
    }
  })

  // New stories from followed authors
  const newStories = (followedAuthorStories || []).map(r => {
    const created_ts = normalizeDate(r.created_at)
    return {
      id: `new_story:${r.story_id}`,
      type: 'new_story',
      created_at: r.created_at,
      created_ts,
      actor_user_id: r.author_user_id ? String(r.author_user_id) : null,
      actor_name: r.author_name || null,
      actor_avatar_url: null,
      story_id: r.story_id ? String(r.story_id) : null,
      story_title: r.story_title || null,
      author_id: r.author_id ? String(r.author_id) : null,
      coins: null,
      message: null
    }
  })

  // New chapters from followed authors
  const newChapters = (followedAuthorChapters || []).map(r => {
    const created_ts = normalizeDate(r.created_at)
    return {
      id: `new_chapter:${r.chapter_id}`,
      type: 'new_chapter',
      created_at: r.created_at,
      created_ts,
      actor_user_id: null,
      actor_name: r.actor_name || null,
      actor_avatar_url: null,
      story_id: r.story_id ? String(r.story_id) : null,
      story_title: r.story_title || null,
      chapter_id: r.chapter_id ? String(r.chapter_id) : null,
      chapter_no: r.chapter_no !== undefined && r.chapter_no !== null ? Number(r.chapter_no) : null,
      chapter_title: r.chapter_title || null,
      author_id: r.author_id ? String(r.author_id) : null,
      coins: null,
      message: null
    }
  })

  const combined = ([]).concat(rankItems, likes, follows, donations, newStories, newChapters)
    .sort((a, b) => Number(b.created_ts) - Number(a.created_ts))

  // Get user's last_seen_at timestamp to determine read/unread status
  let lastSeenTs = 0
  try {
    await ensureNotificationStateTable(p)
    const [rows] = await p.execute('SELECT last_seen_at FROM notification_state WHERE user_id = ? LIMIT 1', [userId])
    if (rows && rows[0] && rows[0].last_seen_at) {
      lastSeenTs = new Date(rows[0].last_seen_at).getTime()
    }
  } catch (e) {
    // ignore and treat as no last_seen
  }

  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
  const now = Date.now()

  // Filter notifications: only show if less than 1 week old OR unread
  const filtered = combined
    .map(item => {
      const itemTs = item.created_ts || 0
      const itemAge = now - itemTs
      const isUnread = !lastSeenTs || lastSeenTs === 0 || itemTs > lastSeenTs

      // Add is_unread flag to each notification
      return {
        ...item,
        is_unread: isUnread
      }
    })
    .filter(item => {
      const itemTs = item.created_ts || 0
      const itemAge = now - itemTs

      // Show if: less than 1 week old OR unread (regardless of age)
      return itemAge < ONE_WEEK_MS || item.is_unread
    })

  return filtered.slice(offset, offset + limit)
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

  try {
    await ensurePushTables(p)
    const [rows] = await p.execute("SELECT MAX(created_at) AS last_at FROM user_notifications WHERE user_id=? AND type='new_chapter'", [String(userId)])
    if (toTs(rows && rows[0] && rows[0].last_at) > lastSeenTs) return { has_unread: true, last_seen_at: lastSeen }
  } catch (e) { /* ignore until the push schema is available */ }

  // Likes
  try {
    const [rows] = await p.query(`
      SELECT MAX(l.created_at) as last_at
      FROM likes l
      JOIN stories s ON s.story_id = l.story_id
      LEFT JOIN authors a ON s.author_id = a.author_id
      WHERE a.user_id = ?
        AND l.user_id <> ?
    `, [userId, userId])
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
module.exports.registerFcmToken = registerFcmToken
module.exports.removeFcmToken = removeFcmToken
module.exports.notifyChapterPublished = notifyChapterPublished
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
async function ensurePaymentsSchema(p) {
  const pool = p || await initPool()
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS payments (
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
    try { await pool.execute('ALTER TABLE payments ADD COLUMN coins BIGINT'); } catch (e) { /* ignore if exists */ }
  } catch (e) {
    // ignore
  }
  return pool
}

async function createPayment({ user_id, amount, provider, provider_ref, months, days, coins }) {
  const p = await ensurePaymentsSchema()
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
    await ensureDonationGiftColumns(p)
  } catch (e) { /* ignore */ }
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS donations (
      donation_id INT AUTO_INCREMENT PRIMARY KEY,
      donor_id VARCHAR(191),
      story_id VARCHAR(191),
      author_id VARCHAR(191),
      coins BIGINT,
      message TEXT,
      gift_code VARCHAR(32) NULL,
      gift_name VARCHAR(64) NULL,
      quantity INT NOT NULL DEFAULT 1,
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
  return (rows || []).map((row) => {
    const gift = row.gift_code ? getGift(row.gift_code) : null
    return { ...row, gift_emoji: gift ? gift.emoji : null }
  })
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

function mapWalletRow(row) {
  if (!row) return null
  return { id: String(row.id || row.wallet_id), user_id: String(row.user_id), balance: Number(row.balance) }
}

async function ensureWalletRowOnConn(conn, userId) {
  await conn.execute(
    'INSERT INTO wallets (user_id, balance, updated_at) SELECT ?, 0, NOW() FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM wallets WHERE user_id = ?)',
    [userId, userId]
  )
}

async function debitWallet(userId, amount) {
  const p = await initPool()
  const n = Number(amount || 0)
  if (!Number.isFinite(n) || n <= 0) return { error: 'invalid_amount', balance: 0 }
  await p.execute('INSERT INTO wallets (user_id, balance, updated_at) SELECT ?, 0, NOW() FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM wallets WHERE user_id = ?)', [userId, userId])
  const [res] = await p.execute('UPDATE wallets SET balance = balance - ?, updated_at = NOW() WHERE user_id = ? AND balance >= ?', [n, userId, n])
  if (!res.affectedRows) {
    const [rows] = await p.execute('SELECT balance FROM wallets WHERE user_id = ? LIMIT 1', [userId])
    const balance = rows && rows[0] ? Number(rows[0].balance) : 0
    return { error: 'insufficient_funds', balance }
  }
  const [r2] = await p.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [userId])
  return mapWalletRow(r2 && r2[0])
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
  const sql = `UPDATE topup_requests SET ${updates.join(', ')} WHERE request_id = ? AND status = 'pending'`
  params.push(id)
  const [res] = await p.execute(sql, params)
  const row = await getTopupRequestById(id)
  if (!res.affectedRows) {
    return { error: row ? 'already_processed' : 'not_found', status: row && row.status, request: row }
  }
  return row
}

async function approvePendingTopupRequest(id, { admin_id, admin_note, coins }) {
  const p = await ensureTopupTable()
  await ensurePaymentsSchema(p)
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS wallets (
      wallet_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) UNIQUE,
      balance BIGINT DEFAULT 0,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  const conn = await p.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.execute('SELECT * FROM topup_requests WHERE request_id = ? LIMIT 1 FOR UPDATE', [id])
    const existing = rows && rows[0]
    if (!existing) {
      await conn.rollback()
      return { error: 'not_found' }
    }
    if (String(existing.status) !== 'pending') {
      await conn.rollback()
      return { error: 'already_processed', status: existing.status }
    }
    const creditCoins = (coins != null && Number(coins) > 0) ? Number(coins) : Number(existing.coins || 0)
    if (!Number.isFinite(creditCoins) || creditCoins <= 0) {
      await conn.rollback()
      return { error: 'invalid_coins' }
    }
    const [upd] = await conn.execute(
      `UPDATE topup_requests SET status = 'approved', admin_id = ?, admin_note = ?, coins = ?, processed_at = NOW() WHERE request_id = ? AND status = 'pending'`,
      [admin_id || null, admin_note || null, creditCoins, id]
    )
    if (!upd.affectedRows) {
      await conn.rollback()
      return { error: 'already_processed' }
    }
    await ensureWalletRowOnConn(conn, existing.user_id)
    await conn.execute('UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE user_id = ?', [creditCoins, existing.user_id])
    await conn.execute(
      'INSERT INTO payments (user_id, amount, coins, provider, provider_ref, months, days, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NOW())',
      [existing.user_id, existing.amount || 0, creditCoins, existing.method || 'manual', existing.provider_ref || `topup#${id}`]
    )
    const [wrows] = await conn.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [existing.user_id])
    await conn.commit()
    const request = await getTopupRequestById(id)
    return { request, wallet: mapWalletRow(wrows && wrows[0]) }
  } catch (e) {
    try { await conn.rollback() } catch (ee) { }
    throw e
  } finally {
    conn.release()
  }
}

module.exports.createTopupRequest = createTopupRequest
module.exports.getTopupRequestById = getTopupRequestById
module.exports.listTopupRequests = listTopupRequests
module.exports.setTopupRequestStatus = setTopupRequestStatus

// Topup Intents helpers (SePay / Automated Payment)
async function ensureTopupIntentsTable() {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS topup_intents (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) {
    // table might already exist
  }
  return p
}

async function createTopupIntent({ user_id, coins, amount, payment_code, account_no, expires_in_minutes = 15 }) {
  const p = await ensureTopupIntentsTable()
  const minutes = Math.max(1, Math.floor(Number(expires_in_minutes || 15) || 15))
  await p.execute(
    `INSERT INTO topup_intents (user_id, coins, amount, payment_code, account_no, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${minutes} MINUTE), NOW())`,
    [user_id, Number(coins), Number(amount), payment_code, account_no || '', 'pending']
  )
  const [rows] = await p.execute('SELECT * FROM topup_intents WHERE payment_code = ? LIMIT 1', [payment_code])
  return rows && rows[0] ? rows[0] : null
}

async function getTopupIntentByCode(payment_code) {
  const p = await ensureTopupIntentsTable()
  const [rows] = await p.execute('SELECT * FROM topup_intents WHERE payment_code = ? LIMIT 1', [String(payment_code || '')])
  return rows && rows[0] ? rows[0] : null
}

async function markTopupIntentConsumed(payment_code) {
  const p = await ensureTopupIntentsTable()
  const [res] = await p.execute("UPDATE topup_intents SET status = 'consumed' WHERE payment_code = ? AND status = 'pending'", [payment_code])
  return { consumed: !!(res && res.affectedRows), intent: await getTopupIntentByCode(payment_code) }
}

async function consumeAndCreditIntent({ payment_code, user_id, min_amount, provider, provider_ref, amount_received }) {
  const p = await ensureTopupIntentsTable()
  await ensurePaymentsSchema(p)
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS wallets (
      wallet_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) UNIQUE,
      balance BIGINT DEFAULT 0,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  const conn = await p.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.execute('SELECT * FROM topup_intents WHERE payment_code = ? LIMIT 1 FOR UPDATE', [String(payment_code)])
    const intent = rows && rows[0]
    if (!intent) {
      await conn.rollback()
      return { ok: false, code: 'not_found' }
    }
    if (user_id && String(intent.user_id) !== String(user_id)) {
      await conn.rollback()
      return { ok: false, code: 'forbidden' }
    }

    const [wExisting] = await conn.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [intent.user_id])
    const existingWallet = mapWalletRow(wExisting && wExisting[0])

    if (String(intent.status) === 'consumed') {
      await conn.commit()
      return { ok: true, already_credited: true, intent, wallet: existingWallet, coins: Number(intent.coins) }
    }
    if (String(intent.status) !== 'pending') {
      await conn.rollback()
      return { ok: false, code: 'invalid_status', intent }
    }
    const [expRows] = await conn.execute(
      "SELECT CASE WHEN expires_at <= NOW() THEN 1 ELSE 0 END AS expired FROM topup_intents WHERE payment_code = ? LIMIT 1",
      [String(payment_code)]
    )
    if (expRows && expRows[0] && Number(expRows[0].expired) === 1) {
      await conn.execute("UPDATE topup_intents SET status = 'expired' WHERE payment_code = ? AND status = 'pending'", [String(payment_code)])
      await conn.commit()
      return { ok: false, code: 'expired', intent: { ...intent, status: 'expired' } }
    }
    if (min_amount != null && Number(min_amount) < Number(intent.amount)) {
      await conn.rollback()
      return { ok: false, code: 'amount_mismatch', intent }
    }

    const [upd] = await conn.execute(
      "UPDATE topup_intents SET status = 'consumed' WHERE payment_code = ? AND status = 'pending' AND expires_at > NOW()",
      [String(payment_code)]
    )
    if (!upd.affectedRows) {
      await conn.rollback()
      return { ok: true, already_credited: true, intent, wallet: existingWallet, coins: Number(intent.coins) }
    }

    const coins = Number(intent.coins)
    await ensureWalletRowOnConn(conn, intent.user_id)
    await conn.execute('UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE user_id = ?', [coins, intent.user_id])

    const payAmount = amount_received != null ? Number(amount_received) : Number(intent.amount)
    await conn.execute(
      'INSERT INTO payments (user_id, amount, coins, provider, provider_ref, months, days, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NOW())',
      [intent.user_id, payAmount, coins, provider || 'sepay', provider_ref || String(payment_code)]
    )

    const [w2] = await conn.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [intent.user_id])
    await conn.commit()
    return { ok: true, already_credited: false, intent: { ...intent, status: 'consumed' }, wallet: mapWalletRow(w2 && w2[0]), coins }
  } catch (e) {
    try { await conn.rollback() } catch (ee) { }
    throw e
  } finally {
    conn.release()
  }
}

async function getPaymentByProviderRef(provider_ref) {
  const p = await initPool()
  const [rows] = await p.execute('SELECT * FROM payments WHERE provider_ref = ? LIMIT 1', [String(provider_ref)])
  return rows && rows[0] ? rows[0] : null
}

module.exports.createTopupIntent = createTopupIntent
module.exports.getTopupIntentByCode = getTopupIntentByCode
module.exports.markTopupIntentConsumed = markTopupIntentConsumed
module.exports.consumeAndCreditIntent = consumeAndCreditIntent
module.exports.getPaymentByProviderRef = getPaymentByProviderRef
module.exports.approvePendingTopupRequest = approvePendingTopupRequest


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
    // A missing table can be created. Any other SQL error must fail the read closed.
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === '42S02')) {
      try {
        await ensureChapterViewsTable(p)
      } catch (ee) { /* ignore */ }
      return 0
    }
    throw e
  }
}

async function ensureChapterViewsTable(p) {
  await p.execute(`CREATE TABLE IF NOT EXISTS chapter_views (
    view_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(191),
    story_id VARCHAR(191),
    chapter_id VARCHAR(191),
    viewed_at DATETIME
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

// Count and insert today's chapter view under one lock so parallel reads cannot both pass the cap.
// Guest keys are visitor ids, not users rows, so this does not lock the users table.
async function reserveChapterRead({ userId, bookId, chapterId, limit }) {
  const p = await initPool()
  await ensureChapterViewsTable(p)
  const cap = Math.max(0, Number(limit) || 0)
  const conn = await p.getConnection()
  const lockName = `cv:${String(userId).slice(0, 50)}`
  let locked = false
  try {
    const [lockRows] = await conn.execute('SELECT GET_LOCK(?, 5) AS got', [lockName])
    const got = lockRows && lockRows[0] ? Number(lockRows[0].got) : 0
    if (got !== 1) return { error: 'busy' }
    locked = true
    await conn.beginTransaction()
    const [alreadyRows] = await conn.execute(
      'SELECT 1 FROM chapter_views WHERE user_id = ? AND chapter_id = ? AND DATE(viewed_at) = CURDATE() LIMIT 1',
      [userId, String(chapterId)]
    )
    if (alreadyRows && alreadyRows[0]) {
      await conn.commit()
      return { ok: true, already: true }
    }
    const [countRows] = await conn.execute(
      'SELECT COUNT(DISTINCT chapter_id) AS cnt FROM chapter_views WHERE user_id = ? AND DATE(viewed_at) = CURDATE()',
      [userId]
    )
    const count = countRows && countRows[0] ? Number(countRows[0].cnt) : 0
    if (count >= cap) {
      await conn.rollback()
      return { error: 'limit', count }
    }
    await conn.execute(
      'INSERT INTO chapter_views (user_id, story_id, chapter_id, viewed_at) VALUES (?, ?, ?, NOW())',
      [userId, bookId, String(chapterId)]
    )
    await conn.commit()
    return { ok: true, already: false }
  } catch (e) {
    try { await conn.rollback() } catch (ee) { /* ignore */ }
    throw e
  } finally {
    if (locked) {
      try { await conn.execute('SELECT RELEASE_LOCK(?)', [lockName]) } catch (e) { /* ignore */ }
    }
    conn.release()
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
  const conn = await (await initPool()).getConnection()
  try {
    await conn.beginTransaction()
    const [users] = await conn.execute('SELECT user_id FROM users WHERE user_id=? FOR UPDATE', [userId])
    const [stories] = await conn.execute('SELECT story_id FROM stories WHERE story_id=? AND (is_hidden=0 OR is_hidden IS NULL)', [bookId])
    if (!users.length || !stories.length) throw Object.assign(new Error('User or story not found'), { code: 'not_found' })
    const [existing] = await conn.execute('SELECT like_id FROM likes WHERE user_id=? AND story_id=? LIMIT 1', [userId, bookId])
    let id = existing[0]?.like_id
    if (!id) {
      const [result] = await conn.execute('INSERT INTO likes (user_id,story_id,created_at) VALUES (?,?,NOW())', [userId,bookId])
      id = result.insertId
    }
    await conn.commit()
    return { id: String(id) }
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
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
module.exports.reserveChapterRead = reserveChapterRead
module.exports.createLike = createLike
module.exports.deleteLike = deleteLike
module.exports.getLikesCount = getLikesCount
module.exports.hasUserLiked = hasUserLiked
module.exports.getUserLikedBookIds = getUserLikedBookIds

module.exports.getChapterByNumber = getChapterByNumber

async function ensureDonationGiftColumns(p) {
  const specs = [
    ['gift_code', 'ALTER TABLE donations ADD COLUMN gift_code VARCHAR(32) NULL'],
    ['gift_name', 'ALTER TABLE donations ADD COLUMN gift_name VARCHAR(64) NULL'],
    ['quantity', 'ALTER TABLE donations ADD COLUMN quantity INT NOT NULL DEFAULT 1'],
  ]
  for (const [name, sql] of specs) {
    try {
      const [rows] = await p.execute(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donations' AND COLUMN_NAME = ?`,
        [name]
      )
      if (rows && rows[0] && Number(rows[0].cnt) > 0) continue
      await p.execute(sql)
    } catch (e) { /* column already present or table missing */ }
  }
}

async function getRecentStoryGifts(storyId, limit) {
  const p = await initPool()
  await ensureDonationGiftColumns(p)
  const n = Math.min(20, Math.max(1, parseInt(limit, 10) || 8))
  const [rows] = await p.query(
    `SELECT d.gift_code, d.gift_name, d.quantity, d.coins, d.created_at,
            COALESCE(NULLIF(u.fullname, ''), 'Độc giả') AS donor_name
     FROM donations d
     LEFT JOIN users u ON u.user_id = d.donor_id
     WHERE d.story_id = ? AND d.gift_code IS NOT NULL AND d.gift_code <> ''
     ORDER BY d.created_at DESC
     LIMIT ${n}`,
    [storyId]
  )
  return (rows || []).map((row) => {
    const gift = getGift(row.gift_code)
    return {
      gift_code: row.gift_code,
      gift_name: row.gift_name || (gift && gift.name) || 'Quà',
      emoji: gift ? gift.emoji : '🎁',
      quantity: Number(row.quantity || 1),
      coins: Number(row.coins || 0),
      donor_name: row.donor_name || 'Độc giả',
      created_at: row.created_at,
    }
  })
}

// Donations: user sends a priced gift to the story's author
async function ensureDonationsTable(p) {
  await p.execute(`CREATE TABLE IF NOT EXISTS donations (
    donation_id INT AUTO_INCREMENT PRIMARY KEY,
    donor_id VARCHAR(191),
    story_id VARCHAR(191),
    author_id VARCHAR(191),
    coins BIGINT,
    message TEXT,
    gift_code VARCHAR(32) NULL,
    gift_name VARCHAR(64) NULL,
    quantity INT NOT NULL DEFAULT 1,
    created_at DATETIME
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await ensureDonationGiftColumns(p)
}

async function ensureWalletsTable(p) {
  await p.execute(`CREATE TABLE IF NOT EXISTS wallets (
    wallet_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(191) UNIQUE,
    balance BIGINT DEFAULT 0,
    updated_at DATETIME
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

// Debit, credit, and the donation row commit together. DDL runs before the transaction.
async function transferGift({ donor_id, story_id, author_id, coins, message, gift_code, gift_name, quantity }) {
  const p = await initPool()
  await ensureDonationsTable(p)
  await ensureWalletsTable(p)
  const n = Number(coins || 0)
  const qty = Math.max(1, Number(quantity || 1))
  if (!Number.isFinite(n) || n <= 0) return { error: 'invalid_amount', balance: 0 }
  const conn = await p.getConnection()
  try {
    await conn.beginTransaction()
    await ensureWalletRowOnConn(conn, donor_id)
    await ensureWalletRowOnConn(conn, author_id)
    const [debit] = await conn.execute(
      'UPDATE wallets SET balance = balance - ?, updated_at = NOW() WHERE user_id = ? AND balance >= ?',
      [n, donor_id, n]
    )
    if (!debit.affectedRows) {
      const [rows] = await conn.execute('SELECT balance FROM wallets WHERE user_id = ? LIMIT 1', [donor_id])
      const balance = rows && rows[0] ? Number(rows[0].balance) : 0
      await conn.rollback()
      return { error: 'insufficient_funds', balance }
    }
    await conn.execute(
      'UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE user_id = ?',
      [n, author_id]
    )
    const [ins] = await conn.execute(
      'INSERT INTO donations (donor_id, story_id, author_id, coins, message, gift_code, gift_name, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [donor_id, story_id, author_id, n, message || null, gift_code || null, gift_name || null, qty]
    )
    const [donRows] = await conn.execute('SELECT * FROM donations WHERE donation_id = ?', [ins.insertId])
    const [walletRows] = await conn.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [donor_id])
    await conn.commit()
    return { donation: donRows && donRows[0] ? donRows[0] : null, donor_wallet: mapWalletRow(walletRows && walletRows[0]) }
  } catch (e) {
    try { await conn.rollback() } catch (ee) { /* ignore */ }
    throw e
  } finally {
    conn.release()
  }
}

async function createDonation({ donor_id, story_id, author_id, coins, message, gift_code, gift_name, quantity }) {
  const p = await initPool()
  try { await ensureDonationsTable(p) } catch (e) { }
  const qty = Math.max(1, Number(quantity || 1))
  const [res] = await p.execute(
    'INSERT INTO donations (donor_id, story_id, author_id, coins, message, gift_code, gift_name, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [donor_id, story_id, author_id, Number(coins || 0), message || null, gift_code || null, gift_name || null, qty]
  )
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
async function ensureWithdrawalsTable(p) {
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
}

// Reserve coins and insert the withdrawal on one connection. The table is created first.
async function createWithdrawalReserved({ user_id, coins, method, details }) {
  const p = await initPool()
  await ensureWithdrawalsTable(p)
  await ensureWalletsTable(p)
  const n = Number(coins || 0)
  if (!Number.isFinite(n) || n <= 0) return { error: 'invalid_amount', balance: 0 }
  const conn = await p.getConnection()
  try {
    await conn.beginTransaction()
    await ensureWalletRowOnConn(conn, user_id)
    const [res] = await conn.execute(
      'UPDATE wallets SET balance = balance - ?, updated_at = NOW() WHERE user_id = ? AND balance >= ?',
      [n, user_id, n]
    )
    if (!res.affectedRows) {
      const [rows] = await conn.execute('SELECT balance FROM wallets WHERE user_id = ? LIMIT 1', [user_id])
      const balance = rows && rows[0] ? Number(rows[0].balance) : 0
      await conn.rollback()
      return { error: 'insufficient_funds', balance }
    }
    const [ins] = await conn.execute(
      'INSERT INTO withdrawals (user_id, coins, method, details, status, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [user_id, n, method || null, details || null, 'pending']
    )
    const [wrows] = await conn.execute('SELECT * FROM withdrawals WHERE withdrawal_id = ?', [ins.insertId])
    const [walletRows] = await conn.execute('SELECT wallet_id as id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1', [user_id])
    await conn.commit()
    return {
      withdrawal: wrows && wrows[0] ? wrows[0] : null,
      wallet: mapWalletRow(walletRows && walletRows[0])
    }
  } catch (e) {
    try { await conn.rollback() } catch (ee) { /* ignore */ }
    throw e
  } finally {
    conn.release()
  }
}

// Decline refunds once, and only while the row is still pending.
async function decideWithdrawal(id, { status }) {
  const allowed = ['approved', 'declined', 'processed']
  if (!allowed.includes(status)) {
    const err = new Error('invalid status')
    err.code = 'invalid_status'
    throw err
  }
  const p = await initPool()
  await ensureWithdrawalsTable(p)
  await ensureWalletsTable(p)
  const conn = await p.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.execute('SELECT * FROM withdrawals WHERE withdrawal_id = ? FOR UPDATE', [id])
    const found = rows && rows[0]
    if (!found) {
      await conn.rollback()
      return { error: 'not_found' }
    }
    if (String(found.status) !== 'pending') {
      await conn.rollback()
      return { error: 'already_processed', withdrawal: found }
    }
    if (status === 'declined') {
      await ensureWalletRowOnConn(conn, found.user_id)
      await conn.execute(
        'UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE user_id = ?',
        [Number(found.coins || 0), found.user_id]
      )
    }
    if (status === 'approved' || status === 'processed') {
      await conn.execute('UPDATE withdrawals SET status = ?, processed_at = NOW() WHERE withdrawal_id = ?', [status, id])
    } else {
      await conn.execute('UPDATE withdrawals SET status = ? WHERE withdrawal_id = ?', [status, id])
    }
    const [updated] = await conn.execute('SELECT * FROM withdrawals WHERE withdrawal_id = ?', [id])
    await conn.commit()
    return { ok: true, withdrawal: updated && updated[0] ? updated[0] : null }
  } catch (e) {
    try { await conn.rollback() } catch (ee) { /* ignore */ }
    throw e
  } finally {
    conn.release()
  }
}

async function createWithdrawal({ user_id, coins, method, details }) {
  const p = await initPool()
  try { await ensureWithdrawalsTable(p) } catch (e) { }
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
module.exports.transferGift = transferGift
module.exports.getDonationsByAuthor = getDonationsByAuthor
module.exports.getRecentStoryGifts = getRecentStoryGifts
module.exports.createWithdrawal = createWithdrawal
module.exports.createWithdrawalReserved = createWithdrawalReserved
module.exports.decideWithdrawal = decideWithdrawal
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

async function ensureChapterRecapsTable() {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS chapter_recaps (
      recap_id INT AUTO_INCREMENT PRIMARY KEY,
      chapter_id VARCHAR(191) NOT NULL,
      recap_text TEXT NOT NULL,
      model_name VARCHAR(64) NOT NULL DEFAULT 'grok-4.5',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_chapter_recap (chapter_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { }
  return p
}

async function getChapterRecap(chapterId) {
  const p = await ensureChapterRecapsTable()
  const [rows] = await p.execute('SELECT * FROM chapter_recaps WHERE chapter_id = ? LIMIT 1', [String(chapterId)])
  return rows && rows[0] ? rows[0] : null
}

async function saveChapterRecap({ chapter_id, recap_text, model_name }) {
  const p = await ensureChapterRecapsTable()
  await p.execute(
    `INSERT INTO chapter_recaps (chapter_id, recap_text, model_name, created_at) VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE recap_text = VALUES(recap_text), model_name = VALUES(model_name)`,
    [String(chapter_id), String(recap_text || ''), String(model_name || 'grok-4.5')]
  )
  return getChapterRecap(chapter_id)
}

async function applyCommentScore(commentId, { status, toxicity_score, moderation_label }) {
  const p = await initPool()
  const scoreNum = Number(toxicity_score) || 0
  const label = moderation_label || (scoreNum >= 0.5 ? 'toxic' : 'clean')
  const isNeg = scoreNum >= 0.5 ? 1 : 0
  await p.execute(
    'UPDATE comments SET status = ?, toxicity_score = ?, moderation_label = ?, is_negative = ? WHERE comment_id = ?',
    [status, scoreNum, label, isNeg, commentId]
  )
}

async function listChapterFingerprints(exceptChapterId) {
  const p = await initPool()
  const [rows] = await p.execute(
    `SELECT
       cf.chapter_id,
       cf.story_id,
       CAST(cf.simhash_64 AS CHAR) AS simhash_64,
       s.title AS story_title,
       c.chapter_no,
       c.title AS chapter_title
     FROM chapter_fingerprints cf
     LEFT JOIN stories s ON cf.story_id = s.story_id
     LEFT JOIN chapters c ON cf.chapter_id = c.chapter_id
     WHERE cf.chapter_id <> ? AND c.status = 'published' AND (s.is_hidden = 0 OR s.is_hidden IS NULL)
     ORDER BY cf.chapter_id`,
    [exceptChapterId || 0]
  )
  return rows || []
}

async function saveChapterFingerprint({ story_id, chapter_id, simhash_64 }) {
  const p = await initPool()
  await p.execute(
    `INSERT INTO chapter_fingerprints (story_id, chapter_id, simhash_64)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE simhash_64 = VALUES(simhash_64), story_id = VALUES(story_id)`,
    [story_id, chapter_id, String(simhash_64)]
  )
}

async function getAllChaptersForFingerprint(limit = 1000) {
  const p = await initPool()
  const safeLimit = Math.max(1, Math.min(5000, parseInt(limit, 10) || 1000))
  const [rows] = await p.query(
    `SELECT c.chapter_id, c.story_id, c.chapter_no, c.title, c.content
     FROM chapters c
     LEFT JOIN chapter_fingerprints cf ON c.chapter_id = cf.chapter_id
     WHERE cf.chapter_id IS NULL AND c.content IS NOT NULL AND LENGTH(c.content) > 10
     ORDER BY c.chapter_id ASC
     LIMIT ${safeLimit}`
  )
  return rows || []
}

async function setChapterStatus(chapterId, status) {
  const p = await initPool()
  const [result] = await p.execute('UPDATE chapters SET status = ? WHERE chapter_id = ? AND status <> ?', [status, chapterId, status])
  if (result.affectedRows > 0 && status === 'published') await notifyChapterPublished(chapterId)
}

async function insertModerationLog({ target_type, target_id, violation_type, confidence_score, matched_target_id, evidence_data, trace_id }) {
  const p = await initPool()
  const [res] = await p.execute(
    `INSERT INTO moderation_logs
      (target_type, target_id, violation_type, confidence_score, matched_target_id, evidence_data, trace_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review')`,
    [
      target_type,
      target_id,
      violation_type,
      Number(confidence_score) || 0,
      matched_target_id || null,
      evidence_data ? JSON.stringify(evidence_data) : null,
      trace_id || null
    ]
  )
  return { id: res.insertId }
}

async function listModerationLogs(status = 'pending_review') {
  const p = await initPool()
  const [rows] = await p.execute(
    `SELECT id, target_type, target_id, violation_type, confidence_score, matched_target_id, evidence_data, trace_id, status, created_at
     FROM moderation_logs
     WHERE status = ?
     ORDER BY created_at DESC
     LIMIT 1000`,
    [status]
  )
  return (rows || []).map((row) => ({
    ...row,
    id: String(row.id),
    evidence_data: typeof row.evidence_data === 'string' ? JSON.parse(row.evidence_data) : row.evidence_data
  }))
}

async function getModerationLog(id) {
  const p = await initPool()
  const [rows] = await p.execute('SELECT * FROM moderation_logs WHERE id = ? LIMIT 1', [id])
  if (!rows || !rows[0]) return null
  const row = rows[0]
  return {
    ...row,
    id: String(row.id),
    evidence_data: typeof row.evidence_data === 'string' ? JSON.parse(row.evidence_data) : row.evidence_data
  }
}

async function setModerationLogStatus(id, status) {
  const p = await initPool()
  await p.execute('UPDATE moderation_logs SET status = ? WHERE id = ?', [status, id])
}

async function getChapterContentById(chapterId) {
  const p = await initPool()
  const [rows] = await p.execute(
    `SELECT c.chapter_id, c.story_id, c.chapter_no, c.title, c.content, c.status, s.title AS story_title
     FROM chapters c
     LEFT JOIN stories s ON c.story_id = s.story_id
     WHERE c.chapter_id = ? LIMIT 1`,
    [chapterId]
  )
  return rows && rows[0] ? rows[0] : null
}

async function searchStoriesByTaste(phrase, limit = 8) {
  const p = await initPool()
  const q = String(phrase || '').trim()
  if (!q) return []
  const lim = Math.max(1, Math.min(20, Number(limit) || 8))
  const like = '%' + q + '%'
  const [rows] = await p.query(
    `SELECT s.story_id AS id, s.title, s.description, s.genre, s.cover_image,
            (s.genre LIKE ?) AS genre_hit
     FROM stories s
     WHERE (s.genre LIKE ? OR s.title LIKE ? OR s.description LIKE ?)
       AND (s.is_hidden = 0 OR s.is_hidden IS NULL)
     ORDER BY genre_hit DESC, s.story_id DESC
     LIMIT ${lim}`,
    [like, like, like, like]
  )
  const found = rows || []
  const genreHits = found.filter((row) => Number(row.genre_hit) === 1)
  return (genreHits.length ? genreHits : found).map(({ genre_hit, ...row }) => row)
}

async function searchStoriesFulltext(query, limit = 8) {
  const p = await initPool()
  const q = String(query || '').trim()
  if (!q) return []
  const lim = Math.max(1, Math.min(20, Number(limit) || 8))
  try {
    const [rows] = await p.execute(
      `SELECT s.story_id AS id, s.title, s.description, s.genre, s.cover_image
       FROM stories s
       WHERE (MATCH(s.title, s.description) AGAINST (? IN NATURAL LANGUAGE MODE) OR s.genre LIKE ?)
         AND (s.is_hidden = 0 OR s.is_hidden IS NULL)
       ORDER BY MATCH(s.title, s.description) AGAINST (? IN NATURAL LANGUAGE MODE) DESC, s.story_id DESC
       LIMIT ${lim}`,
      [q, '%' + q + '%', q]
    )
    return rows || []
  } catch (e) {
    if (e.code === 'ER_FT_MATCHING_KEY_NOT_FOUND' || e.code === 'ER_PARSE_ERROR') throw e
    console.error('[searchStoriesFulltext]', e.code || e.message)
    return []
  }
}

async function searchStoriesFulltextPage({ query, genre, limit = 20, cursor } = {}) {
  const p = await initPool()
  const q = String(query || '').trim().slice(0, 300)
  if (!q) return { books: [], nextCursor: null, hasMore: false }
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20))
  let pageCursor = null
  if (cursor) {
    try {
      pageCursor = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
      if (!pageCursor || pageCursor.sort !== 'search' || pageCursor.id == null || !Number.isFinite(Number(pageCursor.score))) throw new Error()
    } catch {
      throw Object.assign(new Error('invalid_cursor'), { code: 'invalid_cursor' })
    }
  }
  const params = [q, q]
  const filters = [
    '(MATCH(s.title, s.description) AGAINST (? IN NATURAL LANGUAGE MODE) > 0)',
    '(s.is_hidden IS NULL OR s.is_hidden=0)',
  ]
  if (genre && String(genre).trim() && String(genre).trim() !== 'Tất cả') {
    filters.push('s.genre LIKE ?')
    params.push(`%${String(genre).trim()}%`)
  }
  const inner = `SELECT s.story_id AS id, s.title, s.description, s.genre, s.cover_image AS cover_url,
    a.pen_name AS author, s.created_at,
    (SELECT COUNT(*) FROM chapters c WHERE c.story_id=s.story_id AND c.status='published') AS chapters_count,
    (SELECT COUNT(*) FROM likes l WHERE l.story_id=s.story_id) AS likes_count,
    (SELECT COUNT(*) FROM chapter_views v WHERE v.story_id=s.story_id) AS views,
    MATCH(s.title, s.description) AGAINST (? IN NATURAL LANGUAGE MODE) AS search_score
    FROM stories s LEFT JOIN authors a ON a.author_id=s.author_id WHERE ${filters.join(' AND ')}`
  const cursorWhere = pageCursor ? 'WHERE (page.search_score < ? OR (page.search_score = ? AND page.id < ?))' : ''
  const cursorParams = pageCursor ? [Number(pageCursor.score), Number(pageCursor.score), pageCursor.id] : []
  // query(), not execute(): a prepared LIMIT placeholder fails on this MySQL server.
  const [rows] = await p.query(
    `SELECT page.* FROM (${inner}) page ${cursorWhere} ORDER BY page.search_score DESC, page.id DESC LIMIT ?`,
    [...params, ...cursorParams, safeLimit + 1]
  )
  const hasMore = rows.length > safeLimit
  const books = (hasMore ? rows.slice(0, safeLimit) : rows).map(row => ({
    ...row, id: String(row.id), likes_count: Number(row.likes_count || 0), views: Number(row.views || 0),
    chapters_count: Number(row.chapters_count || 0), cover_url: row.cover_url || null,
  }))
  const last = hasMore ? books[books.length - 1] : null
  const nextCursor = last ? Buffer.from(JSON.stringify({ sort: 'search', score: Number(last.search_score), id: last.id })).toString('base64url') : null
  return { books, nextCursor, hasMore }
}

async function createConversation({ user_id, title, guest_token_hash }) {
  const p = await initPool()
  const [res] = await p.execute(
    'INSERT INTO conversations (user_id, title, guest_token_hash) VALUES (?, ?, ?)',
    [user_id || null, title ? String(title).slice(0, 255) : null, guest_token_hash || null]
  )
  return { id: res.insertId }
}

async function listConversations(userId, limit = 30) {
  const p = await initPool()
  const lim = Math.max(1, Math.min(40, Number(limit) || 30))
  const [rows] = await p.query(
    `SELECT c.id, c.title, c.created_at,
        LEFT((SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1), 80) AS preview,
        (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS updated_at
     FROM conversations c
     WHERE c.user_id = ?
     ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at) DESC
     LIMIT ?`,
    [userId, lim]
  )
  return (rows || []).map((row) => ({
    id: String(row.id),
    title: row.title || null,
    preview: row.preview || '',
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  }))
}

async function listMessages(conversationId, limit = 12) {
  const p = await initPool()
  const lim = Math.max(1, Math.min(40, Number(limit) || 12))
  const [rows] = await p.execute(
    `SELECT id, sender, content, trace_id, created_at
     FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ${lim}`,
    [conversationId]
  )
  return (rows || []).reverse().map((row) => ({
    id: String(row.id),
    role: row.sender === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    trace_id: row.trace_id || null
  }))
}

async function addMessage({ conversation_id, sender, content, metadata, trace_id }) {
  const p = await initPool()
  const [res] = await p.execute(
    `INSERT INTO messages (conversation_id, sender, content, metadata, trace_id) VALUES (?, ?, ?, ?, ?)`,
    [conversation_id, sender, String(content || ''), metadata ? JSON.stringify(metadata) : null, trace_id || null]
  )
  return { id: res.insertId, trace_id: trace_id || null }
}

module.exports.closePool = closePool
module.exports.getChapterRecap = getChapterRecap
module.exports.saveChapterRecap = saveChapterRecap
module.exports.applyCommentScore = applyCommentScore
module.exports.listChapterFingerprints = listChapterFingerprints
module.exports.saveChapterFingerprint = saveChapterFingerprint
module.exports.getAllChaptersForFingerprint = getAllChaptersForFingerprint
module.exports.setChapterStatus = setChapterStatus
module.exports.insertModerationLog = insertModerationLog
module.exports.listModerationLogs = listModerationLogs
module.exports.getModerationLog = getModerationLog
module.exports.setModerationLogStatus = setModerationLogStatus
module.exports.getChapterContentById = getChapterContentById
module.exports.searchStoriesFulltext = searchStoriesFulltext
module.exports.searchStoriesByTaste = searchStoriesByTaste
module.exports.searchStoriesFulltextPage = searchStoriesFulltextPage
module.exports.createConversation = createConversation
module.exports.listConversations = listConversations
module.exports.listMessages = listMessages
module.exports.addMessage = addMessage
module.exports.getChaptersInRange = getChaptersInRange
module.exports.getMaxChapterNo = getMaxChapterNo
module.exports.getStorySummaryCache = getStorySummaryCache
module.exports.saveStorySummaryCache = saveStorySummaryCache

async function getRecommendationCandidates(limit = 8) {
  const [rows] = await (await initPool()).query('SELECT story_id AS id,title,description,genre,cover_image FROM stories WHERE is_hidden=0 OR is_hidden IS NULL ORDER BY updated_at DESC,story_id DESC LIMIT ?', [Math.min(8, Math.max(1, Number(limit) || 8))])
  return rows
}
module.exports.getRecommendationCandidates = getRecommendationCandidates
require('./ai_store').attach(module.exports)
