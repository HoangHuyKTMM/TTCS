const mysql = require('mysql2/promise')

let pool = null

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

// Map functions to existing schema (stories, chapters, users, reading_history, authors, categories)
async function getBooks(opts = {}) {
  const userId = opts.userId || null
  const mineOnly = !!opts.mineOnly && !!userId
  const p = await initPool()
  try {
    // Use LEFT JOINs for better performance than subqueries
    const sql = `
      SELECT DISTINCT
        s.story_id,
        s.title,
        s.author_id,
        a.user_id as author_user_id,
        a.pen_name as author_name,
        s.description,
        s.cover_image,
        s.status,
        s.created_at,
        s.updated_at,
        s.genre,
        COUNT(c.chapter_id) as chapters_count,
        GROUP_CONCAT(DISTINCT g.name SEPARATOR ', ') as genre_names
      FROM stories s
      LEFT JOIN authors a ON s.author_id = a.author_id
      LEFT JOIN chapters c ON s.story_id = c.story_id
      LEFT JOIN story_genres sg ON s.story_id = sg.story_id
      LEFT JOIN genres g ON sg.genre_id = g.genre_id
      ${mineOnly ? 'WHERE (a.user_id = ? OR s.author_id = ?)' : ''}
      GROUP BY s.story_id
      ORDER BY s.created_at DESC
    `
    const [rows] = mineOnly ? await p.query(sql, [userId, userId]) : await p.query(sql)
    console.log('[getBooks] Query succeeded, rows:', rows.length)
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
        chapters_count: r.chapters_count,
        genre: genreValue
      }
    })
  } catch (e) {
    console.error('[getBooks] Error:', e.message)
    // Fallback - simple query without joins
    const [rows] = await p.query(`
      SELECT s.*
      FROM stories s
      ORDER BY s.created_at DESC
    `)
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
        chapters_count: 0,
        genre: r.genre || null
      }
    })
  }
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
  const [rows] = await p.execute(`
    SELECT s.*, a.user_id as author_user_id, a.pen_name as author_name
    FROM stories s
    LEFT JOIN authors a ON s.author_id = a.author_id
    WHERE s.story_id = ?
  `, [id])
  if (!rows || rows.length === 0) return null
  const book = rows[0]
  const [chapters] = await p.execute('SELECT * FROM chapters WHERE story_id = ? ORDER BY chapter_no ASC, created_at ASC', [id])
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
  book.chapters = chapters.map(c => ({ ...c, id: String(c.chapter_id) }))
  book.genres = genres.map(g => ({ id: String(g.genre_id), name: g.name }))
  book.genre = genres.map(g => g.name).join(', ') || book.genre
  return book
}

async function createChapter(bookId, { title, content }) {
  const p = await initPool()
  // determine next chapter_no
  const [rows] = await p.execute('SELECT COALESCE(MAX(chapter_no),0) as max_no FROM chapters WHERE story_id = ?', [bookId])
  const nextNo = (rows && rows[0] && rows[0].max_no ? rows[0].max_no : 0) + 1
  const [res] = await p.execute('INSERT INTO chapters (story_id, chapter_no, title, content, created_at) VALUES (?, ?, ?, ?, NOW())', [bookId, nextNo, title, content])
  const id = res.insertId
  const [r2] = await p.execute('SELECT * FROM chapters WHERE chapter_id = ?', [id])
  return r2 && r2[0] ? r2[0] : null
}

async function getChaptersByBook(bookId) {
  const p = await initPool()
  const [rows] = await p.execute('SELECT * FROM chapters WHERE story_id = ? ORDER BY chapter_no ASC, created_at ASC', [bookId])
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
  const [rows] = await p.execute('SELECT * FROM chapters WHERE story_id = ? AND chapter_id = ?', [bookId, chapterId])
  if (!rows || !rows[0]) return null
  const r = rows[0]
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
    const [rows] = await p.execute('SELECT * FROM chapters WHERE story_id = ? AND chapter_no = ? LIMIT 1', [bookId, chapterNo])
    if (!rows || !rows[0]) return null
    const r = rows[0]
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
  if (content !== undefined) { parts.push('content = ?'); params.push(content) }
  if (parts.length === 0) return null
  params.push(id)
  const sql = `UPDATE chapters SET ${parts.join(', ')} WHERE chapter_id = ?`
  const [res] = await p.execute(sql, params)
  const [rows] = await p.execute('SELECT * FROM chapters WHERE chapter_id = ?', [id])
  return rows && rows[0] ? { ...rows[0], id: String(rows[0].chapter_id) } : null
}

async function deleteChapter(id) {
  const p = await initPool()
  const [res] = await p.execute('DELETE FROM chapters WHERE chapter_id = ?', [id])
  return { affectedRows: res.affectedRows }
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
  return rows && rows[0] ? rows[0] : null
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

async function getUsers() {
  const p = await initPool()
  const [rows] = await p.execute('SELECT user_id as id, fullname, email, avatar_url, role, created_at FROM users ORDER BY created_at DESC')
  return rows.map(r => ({ id: String(r.id), fullname: r.fullname, email: r.email, avatar_url: r.avatar_url, role: r.role, created_at: r.created_at }))
}

async function getUserById(id) {
  const p = await initPool()
  try {
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
  await p.execute('DELETE FROM chapters WHERE story_id = ?', [id])
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

// Ensure role/vip_until columns exist (best-effort, safe to call repeatedly)
async function ensureUserRoleAndVipUntilColumns(p) {
  try { await p.execute("ALTER TABLE users ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'user'") } catch (e) { /* ignore if exists */ }
  try { await p.execute("ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'user'") } catch (e) { /* ignore if incompatible or already correct */ }
  try { await p.execute('ALTER TABLE users ADD COLUMN vip_until DATETIME NULL') } catch (e) { /* ignore if exists */ }
}

// Update user's VIP status (sets role and vip_until). If columns are missing or truncated, attempt to add/modify them then retry.
async function updateUserVip(id, { months, days, until, role }) {
  const p = await initPool()
  const roleToSet = (role || 'vip').toString().slice(0, 50)

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
  let vipUntilValue = null
  if (until) {
    vipUntilValue = until // assume ISO or MySQL datetime string provided
  }

  if (months) {
    // use MySQL expression DATE_ADD(NOW(), INTERVAL ? MONTH)
    return runUpdate('UPDATE users SET role = ?, vip_until = DATE_ADD(NOW(), INTERVAL ? MONTH) WHERE user_id = ?', [roleToSet, months, id])
  } else if (days) {
    return runUpdate('UPDATE users SET role = ?, vip_until = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE user_id = ?', [roleToSet, days, id])
  } else if (vipUntilValue) {
    return runUpdate('UPDATE users SET role = ?, vip_until = ? WHERE user_id = ?', [roleToSet, vipUntilValue, id])
  } else {
    // no duration given — just set role
    return runUpdate('UPDATE users SET role = ? WHERE user_id = ?', [roleToSet, id])
  }
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
      reviewed_by VARCHAR(191) NULL,
      reviewed_at DATETIME NULL,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) { /* ignore */ }
  // best-effort schema upgrades for legacy tables
  try { await p.execute('ALTER TABLE comments ADD COLUMN status VARCHAR(32) DEFAULT "pending"') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN reviewed_by VARCHAR(191) NULL') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN reviewed_at DATETIME NULL') } catch (e) { }
  try { await p.execute('ALTER TABLE comments ADD COLUMN enabled TINYINT DEFAULT 1') } catch (e) { }
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
  const [res] = await p.execute('INSERT INTO comments (story_id, user_id, parent_id, content, enabled, status, is_negative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())', [bookId, user_id, parent_id || null, content, 1, 'approved', is_negative || 0])
  const id = res.insertId
  const [rows] = await p.execute('SELECT comment_id as id, story_id, user_id, parent_id, content, enabled, status, is_negative, reviewed_by, reviewed_at, created_at FROM comments WHERE comment_id = ?', [id])
  return rows && rows[0] ? { id: String(rows[0].id), story_id: String(rows[0].story_id), user_id: String(rows[0].user_id), parent_id: rows[0].parent_id ? String(rows[0].parent_id) : null, content: rows[0].content, enabled: !!rows[0].enabled, status: rows[0].status || 'pending', is_negative: !!rows[0].is_negative, reviewed_by: rows[0].reviewed_by || null, reviewed_at: rows[0].reviewed_at || null, created_at: rows[0].created_at } : null
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
  if (userId) {
    const [rows] = await p.execute('SELECT follow_id as id, follower_id, followee_id, created_at FROM follows WHERE follower_id = ? OR followee_id = ? ORDER BY created_at DESC', [userId, userId])
    return rows.map(r => ({ id: String(r.id), follower_id: String(r.follower_id), followee_id: String(r.followee_id), created_at: r.created_at }))
  }
  const [rows] = await p.execute('SELECT follow_id as id, follower_id, followee_id, created_at FROM follows ORDER BY created_at DESC')
  return rows.map(r => ({ id: String(r.id), follower_id: String(r.follower_id), followee_id: String(r.followee_id), created_at: r.created_at }))
}

async function createFollow(followerId, followeeId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  // prevent duplicates
  try {
    const [existing] = await p.execute('SELECT follow_id FROM follows WHERE follower_id = ? AND followee_id = ? LIMIT 1', [followerId, followeeId])
    if (existing && existing[0]) return { id: String(existing[0].follow_id) }
  } catch (e) { }
  const [res] = await p.execute('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, NOW())', [followerId, followeeId])
  const id = res.insertId
  const [rows] = await p.execute('SELECT follow_id as id, follower_id, followee_id, created_at FROM follows WHERE follow_id = ?', [id])
  return rows && rows[0] ? { id: String(rows[0].id), follower_id: String(rows[0].follower_id), followee_id: String(rows[0].followee_id), created_at: rows[0].created_at } : null
}

async function deleteFollow(id) {
  const p = await initPool()
  await ensureFollowsTable(p)
  const [res] = await p.execute('DELETE FROM follows WHERE follow_id = ?', [id])
  return { affectedRows: res.affectedRows }
}

async function deleteFollowByPair(followerId, followeeId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  const [res] = await p.execute('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', [followerId, followeeId])
  return { affectedRows: res.affectedRows }
}

async function countFollowers(followeeId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  try {
    const [rows] = await p.execute('SELECT COUNT(*) as cnt FROM follows WHERE followee_id = ?', [followeeId])
    return rows && rows[0] ? Number(rows[0].cnt) : 0
  } catch (e) { return 0 }
}

async function findFollow(followerId, followeeId) {
  const p = await initPool()
  await ensureFollowsTable(p)
  try {
    const [rows] = await p.execute('SELECT follow_id as id, follower_id, followee_id, created_at FROM follows WHERE follower_id = ? AND followee_id = ? LIMIT 1', [followerId, followeeId])
    return rows && rows[0] ? { id: String(rows[0].id), follower_id: String(rows[0].follower_id), followee_id: String(rows[0].followee_id), created_at: rows[0].created_at } : null
  } catch (e) {
    // Handle case when table structure is different
    console.error('findFollow error (table structure mismatch?):', e.message)
    return null
  }
}

module.exports.getComments = getComments
module.exports.createComment = createComment
module.exports.updateComment = updateComment
module.exports.deleteComment = deleteComment
module.exports.getFollows = getFollows
module.exports.createFollow = createFollow
module.exports.deleteFollow = deleteFollow
module.exports.countFollowers = countFollowers
module.exports.findFollow = findFollow
module.exports.deleteFollowByPair = deleteFollowByPair

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

// Payments helpers
async function createPayment({ user_id, amount, provider, provider_ref, months, days }) {
  const p = await initPool()
  try {
    await p.execute(`CREATE TABLE IF NOT EXISTS payments (
      payment_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191),
      amount DECIMAL(10,2),
      provider VARCHAR(191),
      provider_ref VARCHAR(191),
      months INT DEFAULT NULL,
      days INT DEFAULT NULL,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch (e) {
    // ignore
  }
  const [res] = await p.execute('INSERT INTO payments (user_id, amount, provider, provider_ref, months, days, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', [user_id, amount || 0, provider || null, provider_ref || null, months || null, days || null])
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
  const [rows] = await p.execute('SELECT * FROM payments ORDER BY created_at DESC')
  return rows
}

module.exports.createPayment = createPayment
module.exports.getPayments = getPayments

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

module.exports.recordChapterView = recordChapterView
module.exports.countUserDistinctChapterViewsToday = countUserDistinctChapterViewsToday
module.exports.hasViewedChapterToday = hasViewedChapterToday
module.exports.createLike = createLike
module.exports.deleteLike = deleteLike
module.exports.getLikesCount = getLikesCount
module.exports.hasUserLiked = hasUserLiked

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
