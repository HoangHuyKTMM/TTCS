const mysql = require('./mysql')

// Helper làm sạch nội dung HTML chương truyện
function cleanChapterContent(html) {
  if (!html) return ''
  let cleaned = html
    .replace(/<div class=["']ads-holder["'][\s\S]*?<\/div>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<ins[\s\S]*?<\/ins>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&hellip;/gi, '...')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned
}

// Map thể loại tiếng Việt vào genres ID
async function mapGenres(pool, storyId, genreNames, primaryGenre) {
  const [dbGenres] = await pool.query('SELECT genre_id, name FROM genres')
  const matchedGenreIds = new Set()
  const requestedGenres = [...new Set([...(genreNames || []), primaryGenre].filter(Boolean))]

  for (const gName of requestedGenres) {
    const name = String(gName).trim().slice(0, 100)
    if (!name) continue
    const key = name.toLocaleLowerCase('vi').trim()
    const exact = dbGenres.find(g => String(g.name).toLocaleLowerCase('vi').trim() === key)
    const partial = exact || dbGenres.find(g => {
      const dbKey = String(g.name).toLocaleLowerCase('vi').trim()
      return key.includes(dbKey) || dbKey.includes(key)
    })

    if (partial) {
      matchedGenreIds.add(partial.genre_id)
      continue
    }

    // Preserve source genres missing from the app's initial seed list.
    await pool.query('INSERT IGNORE INTO genres (name) VALUES (?)', [name])
    const [created] = await pool.query('SELECT genre_id FROM genres WHERE name = ? LIMIT 1', [name])
    if (created.length > 0) matchedGenreIds.add(created[0].genre_id)
  }

  // Do not silently mislabel an unrecognized source genre as Tiên Hiệp.
  if (matchedGenreIds.size === 0) {
    await pool.query("INSERT IGNORE INTO genres (name) VALUES ('Khác')")
    const [other] = await pool.query("SELECT genre_id FROM genres WHERE name = 'Khác' LIMIT 1")
    if (other.length > 0) matchedGenreIds.add(other[0].genre_id)
  }

  for (const gId of matchedGenreIds) {
    await pool.query('INSERT IGNORE INTO story_genres (story_id, genre_id) VALUES (?, ?)', [storyId, gId])
  }
}

// Lấy hoặc tạo author
async function getOrCreateAuthor(pool, authorName) {
  const penName = authorName ? authorName.trim() : 'Tác giả ẩn danh'
  
  // Kiểm tra author đã tồn tại chưa
  const [existing] = await pool.query('SELECT author_id FROM authors WHERE pen_name = ? LIMIT 1', [penName])
  if (existing.length > 0) {
    return existing[0].author_id
  }

  // Tạo user tương ứng
  const emailSlug = penName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'author'
  const email = `${emailSlug}_${Date.now().toString().slice(-4)}@readerapp.local`
  
  const [uRes] = await pool.query(
    'INSERT INTO users (fullname, email, password_hash, role, auth_method) VALUES (?, ?, ?, ?, ?)',
    [penName, email, '$2a$10$abcdefghijklmnopqrstuv', 'author', 'email']
  )
  const userId = uRes.insertId

  const [aRes] = await pool.query(
    'INSERT INTO authors (user_id, pen_name, bio) VALUES (?, ?, ?)',
    [userId, penName, `Tác giả ${penName}`]
  )
  return aRes.insertId
}

module.exports = {
  cleanChapterContent,
  mapGenres,
  getOrCreateAuthor
}
