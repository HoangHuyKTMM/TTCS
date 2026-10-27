// Always load env from this folder so running the server from workspace root still works.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const cheerio = require('cheerio');
const shortid = require('shortid');
const integrity = require('./integrity');
const giftsCatalog = require('./gifts');
const chatAgent = require('./chat_agent');
const aiRuntime = require('./ai_runtime');
const { firebaseSession } = require('./firebase_auth');
const { installSchema: installAiSchema } = require('./ai_store');

const useMysql = (process.env.USE_MYSQL || 'false').toLowerCase() === 'true'

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',').map(v => v.trim()).filter(Boolean) : false);
app.use((req, res, next) => aiRuntime.withContext({ userId: optionalUserId(req) }, next));
app.use(cors());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
// increase JSON body size to allow JSON-based base64 uploads for covers
function requestBodyLimit(req) {
  if (req.path.startsWith('/auth/')) return '16kb'
  if (req.path === '/chat') return '16kb'
  if (/^\/books\/[^/]+\/comments$/.test(req.path)) return '12kb'
  if (req.path.startsWith('/integrity/')) return '350kb'
  if (req.path === '/uploads/cover-json') return '12mb'
  return '20mb'
}
app.use((req, res, next) => express.json({ limit: requestBodyLimit(req) })(req, res, next));

// allow clients that send raw JSON without Content-Type header (e.g. Postman raw body without header)
// We'll capture plain text bodies (but skip multipart) and attempt to JSON.parse when appropriate.
app.use((req, res, next) => express.text({
  type: (req) => {
    const ct = req.headers['content-type'] || ''
    if (!ct) return true // no content-type -> try to capture raw
    if (ct.indexOf('multipart/form-data') !== -1) return false
    if (ct.indexOf('application/json') !== -1) return false
    // parse text/* and other types that are not multipart
    return ct.startsWith('text/') || false
  },
  // increase text body limit as well to handle larger payloads
  limit: requestBodyLimit(req)
})(req, res, next))

// coerce text body that looks like JSON into req.body object
app.use((req, res, next) => {
  try {
    if (req && req.body && typeof req.body === 'string') {
      const s = req.body.trim()
      if ((s.startsWith('{') || s.startsWith('['))) {
        try {
          req.body = JSON.parse(s)
          // small debug log when we coerce
          console.log('info: coerced text body to JSON for', req.method, req.path)
        } catch (e) {
          // ignore parse errors
        }
      }
    }
  } catch (e) {
    // swallow
  }
  next()
})

// serve uploaded covers
const coversDir = path.join(__dirname, 'public', 'covers')
try { require('fs').mkdirSync(coversDir, { recursive: true }) } catch (e) { }
app.use('/covers', express.static(coversDir))
// serve uploaded banners
const bannersDir = path.join(__dirname, 'public', 'banners')
try { require('fs').mkdirSync(bannersDir, { recursive: true }) } catch (e) { }
app.use('/banners', express.static(bannersDir))
// serve uploaded avatars
const avatarsDir = path.join(__dirname, 'public', 'avatars')
try { require('fs').mkdirSync(avatarsDir, { recursive: true }) } catch (e) { }
app.use('/avatars', express.static(avatarsDir))

// serve uploaded ad media (videos)
const adMediaDir = path.join(__dirname, 'public', 'ad-media')
const adVideosDir = path.join(adMediaDir, 'videos')
try { require('fs').mkdirSync(adVideosDir, { recursive: true }) } catch (e) { }
app.use('/ad-media', express.static(adMediaDir))

// file upload for covers
const multer = require('multer')
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, coversDir) },
  filename: function (req, file, cb) {
    const ext = file.originalname.split('.').pop()
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    cb(null, name)
  }
})
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
function imageFileFilter(req, file, cb) {
  if (IMAGE_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) return cb(null, true)
  return cb(Object.assign(new Error('invalid_image'), { code: 'INVALID_IMAGE' }))
}
function imageUploadMiddleware(middleware, field) {
  return (req, res, next) => middleware.single(field)(req, res, err => {
    if (!err) return next()
    const tooLarge = err.code === 'LIMIT_FILE_SIZE'
    return res.status(tooLarge ? 413 : 415).json({ error: tooLarge ? 'image_too_large' : 'invalid_image' })
  })
}
const VIDEO_TYPES = new Map([['video/mp4', 'mp4'], ['video/webm', 'webm']])
function videoFileFilter(req, file, cb) {
  const expectedExt = VIDEO_TYPES.get(String(file.mimetype || '').toLowerCase())
  const fileExt = path.extname(file.originalname || '').slice(1).toLowerCase()
  if (expectedExt && expectedExt === fileExt) return cb(null, true)
  return cb(Object.assign(new Error('invalid_video'), { code: 'INVALID_VIDEO' }))
}
function videoUploadMiddleware(middleware, field) {
  return (req, res, next) => middleware.single(field)(req, res, err => {
    if (!err) return next()
    const tooLarge = err.code === 'LIMIT_FILE_SIZE'
    return res.status(tooLarge ? 413 : 415).json({ error: tooLarge ? 'video_too_large' : 'invalid_video' })
  })
}
function adminUploadGuard(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  next()
}
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 20 }, fileFilter: imageFileFilter })
// separate storage for banners
const bannerStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, bannersDir) },
  filename: function (req, file, cb) {
    const ext = file.originalname.split('.').pop()
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    cb(null, name)
  }
})
const bannerUpload = multer({ storage: bannerStorage, limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 20 }, fileFilter: imageFileFilter })

// separate storage for ad videos
const adVideoStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, adVideosDir) },
  filename: function (req, file, cb) {
    const ext = (file.originalname || '').split('.').pop() || 'mp4'
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'mp4'
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
    cb(null, name)
  }
})
const adVideoUpload = multer({
  storage: adVideoStorage,
  limits: { fileSize: 120 * 1024 * 1024, files: 1, fields: 20 }, // up to 120MB for short videos
  fileFilter: videoFileFilter
})

const DATA_PATH = path.join(__dirname, 'data.json');

// Save base64 avatar to disk, return relative URL
function saveDataUrlToAvatar(dataUrl) {
  try {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || '')
    if (!match) return null
    const image = decodeImageBase64(match[2])
    if (!image || image.buffer.length > 4 * 1024 * 1024) return null
    const mimeExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[match[1].toLowerCase()]
    if (!mimeExt || mimeExt !== image.ext) return null
    const { buffer: buf, ext } = image
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const full = path.join(avatarsDir, name)
    fs.writeFileSync(full, buf)
    return `/avatars/${name}`
  } catch (e) {
    console.error('saveDataUrlToAvatar err', e)
    return null
  }
}

let db = null
if (useMysql) {
  try {
    db = require('./mysql')
    console.log('MySQL mode enabled')
  } catch (err) {
    console.error('Failed to load mysql helper:', err)
    process.exit(1)
  }
}

function readData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { books: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function canEditFileBook(book, user) {
  if (user?.role === 'admin') return true
  if (user?.role !== 'author' || !book || !user.id) return false
  const ownerIds = [book.author_user_id, book.user_id, book.owner_user_id, book.owner_id]
    .filter(value => value != null && String(value).trim())
  return ownerIds.some(id => String(id) === String(user.id))
}

function rasterImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer)) return null
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'gif'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

function validateUploadedRaster(req, res) {
  if (!req.file) return true
  try {
    const buffer = fs.readFileSync(req.file.path)
    const detected = rasterImageExtension(buffer)
    const named = path.extname(req.file.filename || '').slice(1).toLowerCase()
    if (detected && detected === named) return true
  } catch (e) { }
  try { fs.unlinkSync(req.file.path) } catch (e) { }
  res.status(400).json({ error: 'invalid_image' })
  return false
}

function validateUploadedVideo(req, res) {
  if (!req.file) return true
  let descriptor = null
  try {
    descriptor = fs.openSync(req.file.path, 'r')
    const header = Buffer.alloc(16)
    const read = fs.readSync(descriptor, header, 0, header.length, 0)
    const ext = path.extname(req.file.filename || '').slice(1).toLowerCase()
    const isMp4 = ext === 'mp4' && read >= 12 && header.toString('ascii', 4, 8) === 'ftyp'
    const isWebm = ext === 'webm' && read >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    if (isMp4 || isWebm) return true
  } catch (e) { }
  finally { if (descriptor != null) try { fs.closeSync(descriptor) } catch (e) { } }
  try { fs.unlinkSync(req.file.path) } catch (e) { }
  res.status(400).json({ error: 'invalid_video' })
  return false
}

function decodeImageBase64(value) {
  if (typeof value !== 'string' || !value || value.length > 12 * 1024 * 1024
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null
  const buffer = Buffer.from(value, 'base64')
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) return null
  const ext = rasterImageExtension(buffer)
  return ext ? { buffer, ext } : null
}

// Save data URL (base64) image to covers folder and return relative URL; returns null on failure
function saveDataUrlToCover(dataUrl) {
  try {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || '')
    if (!match) return null
    const image = decodeImageBase64(match[2])
    if (!image) return null
    const mimeExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[match[1].toLowerCase()]
    if (!mimeExt || mimeExt !== image.ext) return null
    const { buffer: buf, ext } = image
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const full = path.join(coversDir, name)
    fs.writeFileSync(full, buf)
    return `/covers/${name}`
  } catch (e) {
    console.error('saveDataUrlToCover err', e)
    return null
  }
}

function formatCoverUrl(req, coverUrl) {
  if (!coverUrl) return null
  const s = String(coverUrl).trim()
  if (!s) return null
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:')) return s
  if (s.startsWith('/')) return `${req.protocol}://${req.get('host')}${s}`
  return `${req.protocol}://${req.get('host')}/${s}`
}

function chapterForReader(chapter) {
  const result = { ...chapter }
  const raw = String(result.content || '')
  // Crawled chapters are stored as plain text, but the column default is html.
  // Cheerio's element-only walk drops that text and the reader shows an empty chapter.
  if (result.content_format === 'plain_text' || !/<\/?[a-z][^>]*>/i.test(raw)) {
    result.content_format = 'plain_text'
    return result
  }
  const html = raw
  const $ = cheerio.load(html, {}, false)
  $('script,style,iframe,ins,noscript,svg, .ads-holder, .ad-holder, .ad-slot, .ad-container, .adsbygoogle, .advertisement, .quangcao, [id*="ad-"], [id*="ads"], [class*="advert"], [class*="quangcao"], [data-ad], [data-advertisement]').remove()
  const blockTags = new Set(['p', 'div', 'section', 'article', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'tr'])
  const ignoredTag = new Set(['script', 'style', 'iframe', 'ins', 'noscript', 'svg', 'canvas', 'form'])
  const readNode = node => {
    if (node.type === 'text') return node.data || ''
    if (node.type !== 'tag' && node.type !== 'root') return ''
    const tag = String(node.name || '').toLowerCase()
    const attrs = node.attribs || {}
    const selectorText = `${attrs.id || ''} ${attrs.class || ''}`
    if (ignoredTag.has(tag) || /(^|[\s_-])(ads?|advertisement|advert)([\s_-]|$)/i.test(selectorText)) return ''
    if (tag === 'br') return '\n'
    const text = (node.children || []).map(readNode).join('')
    return blockTags.has(tag) ? `\n\n${text}\n\n` : text
  }
  const body = $.root().contents().toArray().map(readNode).join('')
  result.content = body
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t ]+/g, ' ').trim())
    .filter(line => !/^(quảng cáo|advertisement|xem quảng cáo)$/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  result.content_format = 'plain_text'
  return result
}

// GET /books
app.get('/books', async (req, res) => {
  console.log('[GET /books] Request received')
  try {
    if (useMysql) {
      console.log('[GET /books] Fetching books from MySQL')
      // optional auth to support mine=true
      let currentUserId = null
      const auth = req.headers.authorization
      if (auth) {
        const parts = auth.split(' ')
        if (parts.length === 2 && parts[0] === 'Bearer') {
          try {
            const payload = require('jsonwebtoken').verify(parts[1], JWT_SECRET)
            currentUserId = payload && payload.id ? String(payload.id) : null
          } catch (e) {
            // ignore invalid token for public listing
          }
        }
      }

      const mineOnly = req.query && String(req.query.mine || '').toLowerCase() === 'true'
      const wantsPage = req.query && ['limit', 'cursor', 'sort', 'genre', 'liked'].some(key => req.query[key] !== undefined)
      if (wantsPage && !mineOnly) {
        const page = await db.getBookPage({
          limit: req.query.limit,
          cursor: req.query.cursor,
          sort: req.query.sort || 'recent',
          genre: req.query.genre,
          userId: currentUserId,
          likedOnly: String(req.query.liked || '').toLowerCase() === 'true',
        })
        return res.json({ ...page, books: page.books.map(book => ({ ...book, cover_url: formatCoverUrl(req, book.cover_url) })) })
      }
      const rows = await db.getBooks({ userId: currentUserId, mineOnly })
      console.log('[GET /books] Got', rows.length, 'rows')

      // prefetch liked ids for current user (if any) to tag list items
      let likedSet = null
      if (currentUserId) {
        try {
          const likedIds = await db.getUserLikedBookIds(currentUserId)
          likedSet = new Set(likedIds.map(id => String(id)))
        } catch (e) {
          likedSet = null
        }
      }

      if (!rows) {
        console.log('[GET /books] No rows returned')
        return res.json([])
      }

      // map chapters_count to chapters array length for compatibility, include genre
      const books = []
      for (const r of rows) {
        try {
          const chapterCount = (Number.parseInt(r.chapters_count, 10) || 0) || (Array.isArray(r.chapters) ? r.chapters.length : 0)
          const book = {
            id: String(r.id || r.story_id),
            title: r.title,
            author: r.author || r.author_id,
            author_id: r.author_id ? String(r.author_id) : null,
            author_user_id: r.author_user_id ? String(r.author_user_id) : null,
            description: r.description,
            genre: r.genre,
            chapters_count: chapterCount,
            chapters: new Array(chapterCount),
            likes_count: typeof r.likes_count === 'number' ? r.likes_count : Number(r.likes_count || 0),
            views: typeof r.views === 'number' ? r.views : Number(r.views_count || r.views || 0),
            cover_url: formatCoverUrl(req, r.cover_url || r.cover_image),
            liked: likedSet ? likedSet.has(String(r.id || r.story_id)) : false
          }
          books.push(book)
        } catch (mapErr) {
          console.error('[GET /books] Error mapping book:', mapErr, 'row:', r)
        }
      }

      console.log('[GET /books] Sending', books.length, 'books')
      return res.json(books)
    }
    const data = readData();
    // file-mode: ensure likes/views fields exist so mobile can display stats
    const books = (data.books || []).map(b => {
      const likes_count = Number(b.likes_count || b.likes || b.favorites || 0)
      const views = Number(b.views || b.view_count || b.reads || b.total_views || 0)
      const chapters_count = Array.isArray(b.chapters) ? b.chapters.length : (Number(b.chapters_count || 0) || 0)
      return Object.assign({}, b, { likes_count, views, chapters_count, cover_url: formatCoverUrl(req, b.cover_url || b.cover_image) })
    })
    res.json(books);
  } catch (err) {
    if (err && (err.code === 'invalid_cursor' || err.code === 'invalid_sort')) return res.status(400).json({ error: err.code })
    console.error('[GET /books] Error:', err)
    res.status(500).json({ error: 'internal', message: err.message })
  }
});

// Users list (admin only)
app.get('/users', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const users = await db.getUsers()
    res.json(users)
  } catch (err) {
    console.error(err)
    if (process.env.ALLOW_DEV_TOKENS === 'true') return res.status(500).json({ error: 'internal', detail: String(err && (err.stack || err.message || err)) })
    res.status(500).json({ error: 'internal' })
  }
})

// Cursor-paginated stories liked by the authenticated reader.
app.get('/books/liked', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const page = await db.getBookPage({ limit: req.query.limit, cursor: req.query.cursor, userId: req.user.id, likedOnly: true })
    return res.json({ ...page, books: page.books.map(book => ({ ...book, cover_url: formatCoverUrl(req, book.cover_url) })) })
  } catch (err) {
    const code = err && err.code
    if (code === 'invalid_cursor') return res.status(400).json({ error: 'invalid_cursor' })
    console.error('GET /books/liked err', err)
    return res.status(500).json({ error: 'internal' })
  }
})

// Update user (admin only)
app.put('/users/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const { fullname, role, email } = req.body
    const updated = await db.updateUser(id, { fullname, role, email })
    if (!updated) return res.status(404).json({ error: 'not found' })
    res.json(updated)
  } catch (err) {
    console.error(err)
    if (process.env.ALLOW_DEV_TOKENS === 'true') return res.status(500).json({ error: 'internal', detail: String(err && (err.stack || err.message || err)) })
    res.status(500).json({ error: 'internal' })
  }
})

// Subscribe user to VIP (admin only)
app.post('/users/:id/vip', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id
    if (!req.user) return res.status(401).json({ error: 'missing authorization' })
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })

    const { months, days, until } = req.body || {}
    if (!useMysql) {
      // file-mode: update users in data.json
      const data = readData()
      const users = data.users || []
      const user = users.find(u => String(u.id) === String(id))
      if (!user) return res.status(404).json({ error: 'not found' })
      // compute vip_until
      let vipUntil = null
      if (until) vipUntil = until
      else if (months) vipUntil = new Date(Date.now() + Number(months) * 30 * 24 * 60 * 60 * 1000).toISOString()
      else if (days) vipUntil = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString()
      if (vipUntil) user.vip_until = vipUntil
      user.role = 'vip'
      data.users = users
      writeData(data)
      return res.json({ success: true, vip_until: user.vip_until })
    }

    // MySQL mode: use helper
    try {
      console.log('[VIP] updateUserVip params:', { id, months, days, until })
      const ok = await db.updateUserVip(id, { months, days, until, role: 'vip' })
      if (!ok) {
        console.error('[VIP] updateUserVip returned falsy')
        return res.status(500).json({ error: 'failed' })
      }
      const updated = await db.getUserById(id)
      return res.json({ success: true, user: updated })
    } catch (e) {
      console.error('[VIP] updateUserVip error', e && e.stack ? e.stack : e)
      // in dev allow returning error details
      if (process.env.ALLOW_DEV_TOKENS === 'true') return res.status(500).json({ error: 'internal', detail: String(e && (e.stack || e.message || e)) })
      return res.status(500).json({ error: 'internal' })
    }
  } catch (err) {
    console.error('POST /users/:id/vip handler err', err && err.stack ? err.stack : err)
    if (process.env.ALLOW_DEV_TOKENS === 'true') return res.status(500).json({ error: 'internal', detail: String(err && (err.stack || err.message || err)) })
    res.status(500).json({ error: 'internal' })
  }
})

// Create user (admin only)
app.post('/users', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const { fullname, email, password, role } = req.body
    if (!email || !password) return res.status(400).json({ error: 'email & password required' })
    const existing = await db.getUserByEmail(email)
    if (existing) return res.status(400).json({ error: 'email exists' })
    const hash = await bcrypt.hash(password, 10)
    const user = await db.createUser({ email, password_hash: hash, name: fullname, role: role || 'user' })
    res.status(201).json(user)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Delete user (admin only)
app.delete('/users/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    // prevent deleting other admin accounts
    try {
      const target = await db.getUserById(id)
      if (target && target.role === 'admin') {
        return res.status(403).json({ error: 'cannot delete admin user' })
      }
    } catch (e) {
      // ignore and proceed to attempt deletion
    }
    const result = await db.deleteUser(id)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /books { title, author, description, cover_url, genre }
// Accept JSON payload for easier clients. If you need to upload a file, use /books/upload
app.post('/books', authMiddleware, async (req, res) => {
  try {
    if (!['admin', 'author'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' })
    const { title, author, description, genre } = req.body || {}
    let cover_url = req.body ? (req.body.cover_url || req.body.coverUrl || req.body.coverUrl) : undefined
    // If cover is base64 data URL, save to /covers and use short path to satisfy DB length constraints
    if (cover_url && typeof cover_url === 'string' && cover_url.startsWith('data:')) {
      const saved = saveDataUrlToCover(cover_url)
      if (saved) {
        cover_url = saved
      } else {
        console.warn('cover data URL invalid or too large, dropping')
        cover_url = null
      }
    }
    if (!title) return res.status(400).json({ error: 'title required' })

    // cover_image column is typically VARCHAR(255); guard against huge data URLs
    if (cover_url && cover_url.length > 500) {
      console.warn('cover_url too long, dropping value')
      cover_url = null
    }

    if (useMysql) {
      const payload = req.user
      // proceed with MySQL creation
      let creatorAuthorId = null
      if (payload && payload.role === 'author') {
        try {
          creatorAuthorId = await db.getOrCreateAuthorIdByUserId(payload.id)
          if (!creatorAuthorId && db.promoteUserToAuthor) {
            // attempt to create author profile then retry
            await db.promoteUserToAuthor(payload.id, { pen_name: null, bio: null })
            creatorAuthorId = await db.getOrCreateAuthorIdByUserId(payload.id)
          }
        } catch (e) {
          console.error('getOrCreateAuthorIdByUserId failed', e)
        }
        if (!creatorAuthorId) return res.status(400).json({ error: 'author_profile_missing' })
      }
      const book = await db.createBook({ title, author, description, cover_url, genre, author_id: creatorAuthorId })
      book.id = String(book.id)
      book.chapters = []
      // if creator is an author, set stories.author_id to the user id
      if (payload && payload.role === 'author' && creatorAuthorId) {
        try {
          const p = await db.initPool()
          await p.execute('UPDATE stories SET author_id = ? WHERE story_id = ?', [creatorAuthorId, book.id])
          const updated = await db.getBookById(book.id)
          return res.status(201).json(updated)
        } catch (e) { console.error('set author_id err', e) }
      }
      if (cover_url) {
        // store relative path if possible
        const u = cover_url.startsWith('/') ? cover_url : cover_url
        try { await db.updateBookCover(book.id, u) } catch (e) { console.error('updateBookCover err', e) }
        book.cover_url = cover_url
      }
      return res.status(201).json(book)
    }

    // file-based fallback: persist into data.json (no auth required)
    const data = readData()
    data.books = data.books || []
    const id = shortid.generate()
    const book = { id, title, author: author || null, description: description || null, chapters: [],
      author_user_id: req.user.role === 'author' ? String(req.user.id) : null }
    if (cover_url) book.cover_url = cover_url
    if (genre) book.genre = genre
    data.books.unshift(book)
    writeData(data)
    return res.status(201).json(book)
  } catch (err) {
    console.error('POST /books err', err)
    if (err && err.code === 'author_required') return res.status(400).json({ error: 'author required' })
    res.status(500).json({ error: err && err.message ? err.message : 'internal' })
  }
})

// POST /books/upload (multipart) - supports file upload for clients that need it
app.post('/books/upload', authMiddleware, (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  next()
}, imageUploadMiddleware(upload, 'cover'), async (req, res) => {
  try {
    if (!validateUploadedRaster(req, res)) return
    const { title, author, description } = req.body || {}
    if (!title) return res.status(400).json({ error: 'title required' })
    if (useMysql) {
      const book = await db.createBook({ title, author, description })
      book.id = String(book.id)
      book.chapters = []
      if (req.file) {
        const coverUrl = `/covers/${req.file.filename}`
        try { await db.updateBookCover(book.id, coverUrl) } catch (e) { console.error(e) }
        book.cover_url = `${req.protocol}://${req.get('host')}${coverUrl}`
      }
      return res.status(201).json(book)
    }
    // file-based
    const data = readData()
    data.books = data.books || []
    const id = shortid.generate()
    const book = { id, title, author: author || null, description: description || null, chapters: [] }
    if (req.file) {
      const coverUrl = `/covers/${req.file.filename}`
      book.cover_url = `${req.protocol}://${req.get('host')}${coverUrl}`
    }
    data.books.unshift(book)
    writeData(data)
    return res.status(201).json(book)
  } catch (err) {
    console.error('POST /books/upload err', err)
    if (err && err.code === 'author_required') return res.status(400).json({ error: 'author required' })
    res.status(500).json({ error: err && err.message ? err.message : 'internal' })
  }
})

// POST /books/import - import book from text content (auto-split chapters)
app.post('/books/import', authMiddleware, async (req, res) => {
  try {
    const { title, content, author, description, cover_url, genre } = req.body || {}
    
    const role = req.user.role
    if (role !== 'admin' && role !== 'author') {
      return res.status(403).json({ error: 'forbidden', message: 'Chỉ tác giả/admin mới được import truyện' })
    }

    if (typeof title !== 'string' || !title.trim() || title.trim().length > 255
        || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'invalid_title_or_content' })
    }
    if (content.length > 4_000_000) return res.status(413).json({ error: 'import_too_large' })
    if (author != null && (typeof author !== 'string' || author.length > 255)
        || description != null && (typeof description !== 'string' || description.length > 20000)
        || cover_url != null && (typeof cover_url !== 'string' || cover_url.length > 500)
        || genre != null && (typeof genre !== 'string' || genre.length > 255)) {
      return res.status(400).json({ error: 'invalid_book_metadata' })
    }

    const chapterPattern = /(?:^|\n)(?:chương|chapter)\s*(\d+|[ivxlcdm]+)[:\s\-–—]*([^\n]*)/gi
    const matches = [...content.matchAll(chapterPattern)]
    const chapterPlans = []
    if (matches.length > 0) {
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i]
        const chapterNum = match[1]
        const chapterTitle = match[2].trim() || `Chương ${chapterNum}`
        const startIndex = match.index + match[0].length
        const endIndex = i < matches.length - 1 ? matches[i + 1].index : content.length
        const chapterContent = content.substring(startIndex, endIndex).trim()
        if (chapterContent) chapterPlans.push({ title: chapterTitle, content: chapterContent })
      }
    } else {
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
      for (let i = 0; i < paragraphs.length; i += 50) {
        chapterPlans.push({ title: `Chương ${chapterPlans.length + 1}`, content: paragraphs.slice(i, i + 50).join('\n\n') })
      }
    }
    if (!chapterPlans.length) return res.status(400).json({ error: 'no_chapters_found' })
    if (chapterPlans.length > 100 || chapterPlans.some(ch => ch.content.length > 80000 || ch.title.length > 255)) {
      return res.status(413).json({ error: 'import_chapter_limit_exceeded', max_chapters: 100, max_chapter_chars: 80000 })
    }

    if (useMysql) {
      await aiReady
      if (!await enforceAiQuota(req, res, 'book-import', 2)) return
      // Create book first
      let creatorAuthorId = null
      if (role === 'author') {
        try {
          creatorAuthorId = await db.getOrCreateAuthorIdByUserId(req.user.id)
        } catch (e) { console.error('get/create author id failed', e) }
        if (!creatorAuthorId) return res.status(400).json({ error: 'author_profile_missing' })
      }
      
      const book = await db.createBook({ 
        title: title.trim(),
        author: author || req.user.email || 'Tác giả', 
        description: description || '', 
        cover_url: cover_url || null,
        genre: genre || null,
        author_id: creatorAuthorId
      })
      
      for (const plan of chapterPlans) {
        try {
          const createdCh = await db.createChapter(book.story_id || book.id, plan)
          if (createdCh && (createdCh.chapter_id || createdCh.id)) {
            const chId = String(createdCh.chapter_id || createdCh.id)
            await integrity.reviewChapter(db, {
              storyId: book.story_id || book.id,
              chapterId: chId,
              content: plan.content,
              complete: chatAgent.chatCompletion
            }).catch(async e => {
              console.error('[integrity] import review error', e && e.message)
              await db.insertModerationLog({ target_type: 'chapter', target_id: chId, violation_type: 'plagiarism', confidence_score: 0,
                evidence_data: { zone: 'unknown', fallback_reason: 'review_failed', content_hash: require('./ai_store').hashText(plan.content) } }).catch(() => {})
            })
          }
        } catch (e) {
          console.error('Failed to create chapter', e)
        }
      }
      
      // Fetch complete book with chapters
      const fullBook = await db.getBookById(book.story_id || book.id)
      return res.status(201).json(fullBook)
    }
    
    return res.status(500).json({ error: 'MySQL mode required' })
  } catch (err) {
    console.error('POST /books/import err', err)
    res.status(500).json({ error: err && err.message ? err.message : 'internal' })
  }
})

// Banners endpoints
// GET /banners - public list
app.get('/banners', async (req, res) => {
  try {
    if (useMysql) {
      const rows = await db.getBanners()
      // make image urls absolute
      const list = rows.map(r => ({ ...r, image_url: r.image_url && r.image_url.startsWith('/') ? `${req.protocol}://${req.get('host')}${r.image_url}` : r.image_url }))
      return res.json(list)
    }
    // fallback to file storage
    const bf = path.join(__dirname, 'data', 'banners.json')
    try { const raw = fs.readFileSync(bf, 'utf-8'); return res.json(JSON.parse(raw)) } catch (e) { return res.json([]) }
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Video Ads endpoints
// GET /ads?placement=interstitial - public list of enabled video ads
app.get('/ads', async (req, res) => {
  try {
    const placement = req.query.placement ? String(req.query.placement) : null
    if (useMysql) {
      const rows = await db.getAds({ placement, admin: false })
      const list = (rows || []).map(r => ({
        ...r,
        video_url: r.video_url && r.video_url.startsWith('/') ? `${req.protocol}://${req.get('host')}${r.video_url}` : r.video_url
      }))
      return res.json(list)
    }
    const af = path.join(__dirname, 'data', 'ads.json')
    let arr = []
    try { arr = JSON.parse(fs.readFileSync(af, 'utf-8')) } catch (e) { arr = [] }
    arr = (arr || []).filter(a => a && a.enabled)
    if (placement) arr = arr.filter(a => String(a.placement || 'interstitial') === placement)
    // make urls absolute
    arr = arr.map(a => ({
      ...a,
      video_url: a.video_url && a.video_url.startsWith('/') ? `${req.protocol}://${req.get('host')}${a.video_url}` : a.video_url
    }))
    return res.json(arr)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /ads/admin - admin list (includes disabled)
app.get('/ads/admin', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const placement = req.query.placement ? String(req.query.placement) : null
    const rows = await db.getAds({ placement, admin: true })
    const list = (rows || []).map(r => ({
      ...r,
      video_url: r.video_url && r.video_url.startsWith('/') ? `${req.protocol}://${req.get('host')}${r.video_url}` : r.video_url
    }))
    return res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /ads (admin) - supports multipart/form-data with field 'video'
app.post('/ads', authMiddleware, adminUploadGuard, videoUploadMiddleware(adVideoUpload, 'video'), async (req, res) => {
  try {
    if (!validateUploadedVideo(req, res)) return
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const { title, link, enabled, placement } = req.body || {}
    const videoUrl = req.file ? `/ad-media/videos/${req.file.filename}` : null
    try {
      const ad = await db.createAd({ title, video_url: videoUrl, link, placement, enabled: enabled === 'true' || enabled === '1' })
      if (ad && ad.video_url && ad.video_url.startsWith('/')) ad.video_url = `${req.protocol}://${req.get('host')}${ad.video_url}`
      return res.status(201).json(ad)
    } catch (e) {
      // fallback: persist to file
      const af = path.join(__dirname, 'data', 'ads.json')
      let arr = []
      try { arr = JSON.parse(fs.readFileSync(af, 'utf-8')) } catch (e) { }
      const id = String(Date.now())
      const obj = {
        id,
        title: title || null,
        video_url: videoUrl ? `${req.protocol}://${req.get('host')}${videoUrl}` : null,
        link: link || null,
        placement: placement || 'interstitial',
        enabled: enabled === 'true' || enabled === '1',
        created_at: new Date().toISOString()
      }
      arr.unshift(obj)
      fs.mkdirSync(path.dirname(af), { recursive: true })
      fs.writeFileSync(af, JSON.stringify(arr, null, 2))
      return res.status(201).json(obj)
    }
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// PUT /ads/:id (admin)
app.put('/ads/:id', authMiddleware, adminUploadGuard, videoUploadMiddleware(adVideoUpload, 'video'), async (req, res) => {
  try {
    if (!validateUploadedVideo(req, res)) return
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const { title, link, enabled, placement } = req.body || {}
    const videoUrl = req.file ? `/ad-media/videos/${req.file.filename}` : undefined
    const updated = await db.updateAd(id, {
      title,
      link,
      placement,
      enabled: enabled === undefined ? undefined : (enabled === 'true' || enabled === '1'),
      video_url: videoUrl
    })
    if (!updated) return res.status(404).json({ error: 'not found' })
    if (updated.video_url && updated.video_url.startsWith('/')) updated.video_url = `${req.protocol}://${req.get('host')}${updated.video_url}`
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /ads/:id (admin)
app.delete('/ads/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const result = await db.deleteAd(id)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /banners (admin) - supports multipart/form-data with field 'banner'
app.post('/banners', authMiddleware, adminUploadGuard, imageUploadMiddleware(bannerUpload, 'banner'), async (req, res) => {
  try {
    if (!validateUploadedRaster(req, res)) return
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const { title, link, enabled } = req.body
    const imageUrl = req.file ? `/banners/${req.file.filename}` : null
    try {
      const banner = await db.createBanner({ title, image_url: imageUrl, link, enabled: enabled === 'true' || enabled === '1' })
      if (banner && banner.image_url && banner.image_url.startsWith('/')) banner.image_url = `${req.protocol}://${req.get('host')}${banner.image_url}`
      return res.status(201).json(banner)
    } catch (e) {
      // fallback: persist to file
      const bf = path.join(__dirname, 'data', 'banners.json')
      let arr = []
      try { arr = JSON.parse(fs.readFileSync(bf, 'utf-8')) } catch (e) { }
      const id = String((arr.length ? Number(arr[0].id || 0) + arr.length + 1 : 1))
      const obj = { id, title, image_url: imageUrl ? `${req.protocol}://${req.get('host')}${imageUrl}` : null, link, enabled: enabled === 'true' || enabled === '1', created_at: new Date().toISOString() }
      arr.unshift(obj)
      fs.mkdirSync(path.dirname(bf), { recursive: true })
      fs.writeFileSync(bf, JSON.stringify(arr, null, 2))
      return res.status(201).json(obj)
    }
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// PUT /banners/:id (admin)
app.put('/banners/:id', authMiddleware, adminUploadGuard, imageUploadMiddleware(bannerUpload, 'banner'), async (req, res) => {
  try {
    if (!validateUploadedRaster(req, res)) return
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const { title, link, enabled } = req.body
    const imageUrl = req.file ? `/banners/${req.file.filename}` : undefined
    const updated = await db.updateBanner(id, { title, link, enabled: enabled === undefined ? undefined : (enabled === 'true' || enabled === '1'), image_url: imageUrl })
    if (!updated) return res.status(404).json({ error: 'not found' })
    if (updated.image_url && updated.image_url.startsWith('/')) updated.image_url = `${req.protocol}://${req.get('host')}${updated.image_url}`
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /banners/:id (admin)
app.delete('/banners/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const result = await db.deleteBanner(id)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Genres/Categories endpoints
// GET /genres - public list
app.get('/genres', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const list = await db.getGenres()
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /genres (admin) - create new genre
app.post('/genres', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const { name, description } = req.body
    if (!name) return res.status(400).json({ error: 'name required' })
    const genre = await db.createGenre({ name, description })
    if (genre && genre.error) return res.status(400).json({ error: genre.error })
    res.status(201).json(genre)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// PUT /genres/:id (admin)
app.put('/genres/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const { name, description } = req.body
    const updated = await db.updateGenre(id, { name, description })
    if (!updated) return res.status(404).json({ error: 'not found' })
    if (updated.error) return res.status(400).json({ error: updated.error })
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /genres/:id (admin)
app.delete('/genres/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const result = await db.deleteGenre(id)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /books/:id/genres/:genreId - link story to genre (admin)
app.post('/books/:id/genres/:genreId', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const result = await db.linkStoryGenre(req.params.id, req.params.genreId)
    if (result.error) return res.status(400).json({ error: result.error })
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /books/:id/genres/:genreId - unlink story from genre (admin)
app.delete('/books/:id/genres/:genreId', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const result = await db.unlinkStoryGenre(req.params.id, req.params.genreId)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// helper: parse bearer token if provided (optional)
async function getUserFromAuthHeader(req) {
  const bypassHeader = String(req.headers['x-bypass-auth'] || req.headers['x-dev-token'] || '').toLowerCase() === 'true'
  const remoteAddress = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  const isLocal = remoteAddress === '::1' || remoteAddress.startsWith('127.')
  if (bypassHeader && process.env.ALLOW_DEV_TOKENS === 'true' && process.env.NODE_ENV === 'development' && isLocal) {
    return { id: 'dev_admin', email: 'dev@local', role: 'admin' }
  }
  const auth = req.headers.authorization
  if (!auth) return null
  const parts = auth.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  const token = parts[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (!useMysql) return payload
    if (!payload?.id) return null
    const fresh = await db.getUserById(payload.id)
    return fresh ? { ...payload, ...fresh } : null
  } catch (e) { return null }
}

// ==================== ADVANCED SEARCH ====================
// GET /books/search - Cursor-paginated FULLTEXT title and description search.
app.get('/books/search', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const { q, genre, limit = 20, cursor } = req.query
    if ([q, genre, cursor].some(v => v != null && (typeof v !== 'string' || v.length > 500))) return res.status(400).json({ error: 'invalid_search' })
    const pageLimit = Number(limit)
    if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 50) return res.status(400).json({ error: 'invalid_pagination' })
    const page = await db.searchStoriesFulltextPage({ query: q, genre, limit: pageLimit, cursor })
    return res.json({ ...page, books: page.books.map(book => ({ ...book, cover_url: formatCoverUrl(req, book.cover_url) })) })
  } catch (err) {
    if (err && err.code === 'invalid_cursor') return res.status(400).json({ error: 'invalid_cursor' })
    console.error('GET /books/search err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /books/:id
app.get('/books/:id', async (req, res) => {
  try {
    const user = await getUserFromAuthHeader(req)
    if (useMysql) {
      const book = await db.getBookById(req.params.id)
      if (!book) return res.status(404).json({ error: 'not found' })
      // normalize id
      book.id = String(book.id)
      book.cover_url = formatCoverUrl(req, book.cover_url || book.cover_image)

      let role = user && user.role ? String(user.role).toLowerCase() : 'guest'
      if (user && user.id) {
        try {
          const fresh = await db.getUserById(user.id)
          if (fresh && fresh.role) role = String(fresh.role).toLowerCase()
        } catch (e) {}
      }
      const isAuthorOwner = user && (String(book.author_user_id) === String(user.id) || String(book.user_id) === String(user.id))
      if (role !== 'admin' && !isAuthorOwner) {
        book.chapters = (book.chapters || []).filter(c => c.status === 'published').map(chapterMetadata)
        book.chapters_count = book.chapters.length
      }

      // attach social metadata
      const [likesCount, followersCount, liked, followRow] = await Promise.all([
        db.getLikesCount(book.id),
        db.countFollowers(book.id),
        user ? db.hasUserLiked(user.id, book.id) : false,
        user ? db.findFollow(user.id, book.id) : null
      ])
      book.likes_count = likesCount
      book.followers_count = followersCount
      book.liked = !!liked
      book.follow = followRow
      return res.json(book)
    }
    const data = readData();
    const book = data.books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'not found' });
    // file-mode: normalize stats fields
    book.cover_url = formatCoverUrl(req, book.cover_url || book.cover_image)
    book.likes_count = Number(book.likes_count || book.likes || book.favorites || 0)
    book.views = Number(book.views || book.view_count || book.reads || book.total_views || 0)
    book.chapters_count = Array.isArray(book.chapters) ? book.chapters.length : (Number(book.chapters_count || 0) || 0)
    res.json(book);
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
});

// GET /stats - public basic stats; can be extended or protected
app.get('/stats', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const stats = await db.getStats()
    res.json(stats)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Authors may see their own overlap and scores. Other books' prose stays in the moderation log for admins.
function redactForeignChapterText(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const snippets = Array.isArray(payload.matched_snippets)
    ? payload.matched_snippets.map((snippet) => ({
      similarity: snippet && snippet.similarity != null ? snippet.similarity : null,
      snippetA: snippet && snippet.snippetA != null ? snippet.snippetA : null,
    }))
    : []
  return Object.assign({}, payload, { matched_snippets: snippets, ai_analysis: null })
}

// POST /books/:id/chapters { title, content } - author/admin only
app.post('/books/:id/chapters', authMiddleware, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (typeof title !== 'string' || typeof content !== 'string' || !title.trim() || !content.trim()) return res.status(400).json({ error: 'title and content required' });
    if (content.length > 80000) return res.status(413).json({ error: 'content_too_large' });
    await aiReady
    if (useMysql) {
      const book = await db.getBookById(req.params.id)
      if (!book) return res.status(404).json({ error: 'book not found' })
      const role = req.user.role
      const ownerAuthorId = book.author_id ? String(book.author_id) : null
      const ownerUserId = book.author_user_id ? String(book.author_user_id) : null
      let currentAuthorId = null
      if (role === 'author') {
        try {
          currentAuthorId = await db.getOrCreateAuthorIdByUserId(req.user.id)
        } catch (e) { /* ignore */ }
      }
      if (role !== 'admin') {
        if (role !== 'author') return res.status(403).json({ error: 'forbidden' })
        // allow if the story belongs to this author's user_id or author_id
        const isOwnerByUser = ownerUserId && String(req.user.id) === ownerUserId
        const isOwnerByAuthor = ownerAuthorId && currentAuthorId && String(currentAuthorId) === ownerAuthorId
        if (!isOwnerByUser && !isOwnerByAuthor) {
          return res.status(403).json({ error: 'not your story' })
        }
      }
      const chapter = await db.createChapter(req.params.id, { title, content })
      chapter.id = String(chapter.id)
      try {
        const verdict = await integrity.reviewChapter(db, {
          storyId: req.params.id,
          chapterId: chapter.id,
          content,
          complete: chatAgent.chatCompletion
        })
        chapter.status = verdict.status
        chapter.moderation = {
          zone: verdict.zone,
          hamming: verdict.hamming,
          similarity: verdict.similarity,
          similarity_pct: verdict.similarity_pct,
          matched_chapter_id: verdict.matched_chapter_id,
          matched_story_title: verdict.matched_story_title,
          matched_chapter_title: verdict.matched_chapter_title,
          matched_snippets: verdict.matched_snippets,
          ai_analysis: verdict.ai_analysis,
          trace_id: verdict.trace_id
        }
        if (req.user.role !== 'admin') chapter.moderation = redactForeignChapterText(chapter.moderation)
      } catch (reviewErr) {
        console.error('[integrity] chapter', reviewErr && reviewErr.message)
        chapter.status = 'pending_review'
        chapter.moderation = { zone: 'unknown', fallback_reason: 'review_failed' }
        await db.insertModerationLog({ target_type: 'chapter', target_id: chapter.id, violation_type: 'plagiarism', confidence_score: 0,
          evidence_data: { zone: 'unknown', fallback_reason: 'review_failed', content_hash: require('./ai_store').hashText(content) } }).catch(() => {})
      }
      return res.status(201).json(chapter)
    }
    // file-mode fallback (dev only)
    const data = readData();
    const book = data.books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'book not found' });
    if (!canEditFileBook(book, req.user)) return res.status(403).json({ error: 'forbidden' });
    const chapter = {
      id: shortid.generate(),
      title,
      content,
      status: 'pending_review',
      createdAt: new Date().toISOString()
    };
    book.chapters.push(chapter);
    writeData(data);
    res.status(201).json(chapter);
  } catch (err) {
    console.error(err)
    if (process.env.ALLOW_DEV_TOKENS === 'true') return res.status(500).json({ error: err && err.message ? err.message : 'internal' })
    res.status(500).json({ error: 'internal' })
  }
});

// simple health
app.get('/', (req, res) => res.send('Admin server running'));

const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const aiCfg = chatAgent.resolveAiConfig()
console.log(`AI chat: ${aiCfg.configured ? 'key ready' : 'missing AI_API_KEY'} base=${aiCfg.base} model=${aiCfg.model}`)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me'

function optionalUserId(req) {
  const auth = req.headers.authorization
  if (!auth || !String(auth).startsWith('Bearer ')) return null
  try {
    const payload = jwt.verify(String(auth).split(' ')[1], JWT_SECRET)
    return payload && payload.id ? String(payload.id) : null
  } catch (e) {
    return null
  }
}
const COIN_VND = Math.max(1, Number(process.env.COIN_VND || 100) || 100)
const VIP_COST_COINS = Math.max(1, Number(process.env.VIP_COST_COINS || 500) || 500)
const AUTHOR_COST_BASE = Math.max(1, Number(process.env.AUTHOR_COST_BASE || 800) || 800)
const AUTHOR_COST_VIP = Math.max(1, Number(process.env.AUTHOR_COST_VIP || 300) || 300)
const MIN_VIP_DAYS_FOR_DISCOUNT = Math.max(0, Number(process.env.MIN_VIP_DAYS_FOR_DISCOUNT || 15) || 15)

function isProductionEnv() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production'
}

function generateTopupPaymentCode() {
  return 'RD' + crypto.randomBytes(5).toString('hex').toUpperCase()
}

function extractSepayPaymentCode(body) {
  const parts = [body && body.code, body && body.content, body && body.description]
  for (const part of parts) {
    const m = String(part || '').toUpperCase().match(/RD[0-9A-Z]{4,}/)
    if (m) return m[0]
  }
  const full = parts.filter(Boolean).join(' ').toUpperCase()
  const m = full.match(/RD[0-9A-Z]{4,}/)
  return m ? m[0] : null
}

function isSepayLocal() {
  if (isProductionEnv()) return false
  const flag = String(process.env.SEPAY_LOCAL || '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

function sepayLocalApiKey() {
  return String(process.env.SEPAY_API_KEY || '').trim() || 'local-sepay'
}

function sepayWebhookAuthorized(req) {
  const configuredApiKey = String(process.env.SEPAY_API_KEY || '').trim()
  const authHeader = String(req.headers['authorization'] || '')
  const token = authHeader.replace(/^(Apikey|Bearer)\s+/i, '').trim()
  if (configuredApiKey && (token === configuredApiKey || authHeader === configuredApiKey)) return true
  if (!isSepayLocal()) return false
  const localKey = sepayLocalApiKey()
  return token === localKey || authHeader === localKey
}

async function findMatchingBankTransfer(intent) {
  const accountNo = process.env.SEPAY_ACCOUNT_NO || intent.account_no
  const sepayApiToken = String(process.env.SEPAY_API_TOKEN || '').trim()
  if (sepayApiToken) {
    try {
      const sepayRes = await fetch(`https://my.sepay.vn/userapi/transactions/list?account_number=${encodeURIComponent(accountNo)}&limit=50`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${sepayApiToken}`, 'Content-Type': 'application/json' }
      })
      const data = await sepayRes.json()
      const txList = data && (data.transactions || data.data || [])
      if (Array.isArray(txList) && txList.length) {
        const code = String(intent.payment_code).toUpperCase()
        const matched = txList.find((tx) => {
          const content = String(tx.transaction_content || tx.content || tx.code || '').toUpperCase()
          const amt = Number(tx.amount_in || tx.transferAmount || 0)
          return content.includes(code) && amt >= Number(intent.amount)
        })
        if (matched) {
          const amt = Number(matched.amount_in || matched.transferAmount || intent.amount)
          return { paid: true, provider_ref: `sepay_${matched.id || matched.reference_number || intent.payment_code}`, amount: amt }
        }
      }
    } catch (sepayErr) {
      console.error('[verify-payment] SePay API query error:', sepayErr)
    }
  }

  const bankApiUrl = process.env.BANK_API_URL || 'https://bank.dinhmanhhung.net/check-payment'
  try {
    const res = await fetch(bankApiUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_no: accountNo,
        content: intent.payment_code,
        amount: Number(intent.amount)
      })
    })
    const data = await res.json()
    if (data && data.paid) {
      return { paid: true, provider_ref: String(intent.payment_code), amount: Number(intent.amount) }
    }
  } catch (bankErr) {
    console.error('[verify-payment] bank API error:', bankErr)
  }
  return { paid: false }
}

async function authMiddleware(req, res, next) {
  // Local development bypass requires explicit configuration; Host is client input.
  const _hdr = String(req.headers['x-bypass-auth'] || req.headers['x-dev-token'] || '').toLowerCase() === 'true'
  const remoteAddress = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  const _local = remoteAddress === '::1' || remoteAddress.startsWith('127.')
  if (_hdr && process.env.ALLOW_DEV_TOKENS === 'true' && process.env.NODE_ENV === 'development' && _local) {
    req.user = { id: 'dev_admin', email: 'dev@local', role: 'admin' }
    return next()
  }
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'missing authorization' })
  const parts = auth.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'invalid authorization format' })
  const token = parts[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    // Refresh role from DB so upgraded accounts (author/admin) work without re-login
    if (useMysql && payload && payload.id) {
      try {
        const fresh = await db.getUserById(payload.id)
        if (!fresh) return res.status(401).json({ error: 'account_unavailable' })
        req.user.role = fresh.role
      } catch (err) {
        console.error('authMiddleware refresh role err', err)
        return res.status(503).json({ error: 'authentication_unavailable' })
      }
    }
    next()
  } catch (err) {
    return res.status(401).json({ error: 'invalid token' })
  }
}

// Auth endpoints
function validCredentials(email, password) {
  return typeof email === 'string' && email.trim().length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && typeof password === 'string' && password.length > 0 && Buffer.byteLength(password, 'utf8') <= 72
}

app.post('/auth/register', async (req, res) => {
  try {
    const { email: rawEmail, password, name } = req.body || {}
    if (!validCredentials(rawEmail, password) || password.length < 6 || (name != null && (typeof name !== 'string' || !name.trim() || name.length > 100))) {
      return res.status(400).json({ error: 'invalid_credentials', message: 'Email không hợp lệ hoặc mật khẩu cần ít nhất 6 ký tự và tối đa 72 byte.' })
    }
    const email = rawEmail.trim().toLowerCase()
    if (!useMysql) return res.status(400).json({ error: 'register requires MySQL mode' })
    const existing = await db.getUserByEmail(email)
    if (existing) return res.status(400).json({ error: 'email exists' })
    const hash = await bcrypt.hash(password, 10)
    const user = await db.createUser({ email, password_hash: hash, name, role: 'user' })
    res.status(201).json(user)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'email exists' })
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Firebase identity comes exclusively from the verified ID token.
app.post('/auth/firebase', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'Firebase auth requires MySQL mode' })
    const session = await firebaseSession(db, req.body?.idToken)
    const token = jwt.sign({ id: session.user.id, email: session.user.email, role: session.user.role }, JWT_SECRET, { expiresIn: '30d' })
    return res.status(session.created ? 201 : 200).json({ token, user: session.user })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.code, message: error.message })
    console.error('[Firebase Auth]', error.code || 'internal')
    return res.status(500).json({ error: 'internal', message: 'Không thể đăng nhập Firebase. Thử lại sau.' })
  }
})

// PUT /books/:bookId/chapters/:chapterId - admin or author edit chapter
app.put('/books/:bookId/chapters/:chapterId', authMiddleware, async (req, res) => {
  try {
    await aiReady
    if (req.body?.content !== undefined && (typeof req.body.content !== 'string' || !req.body.content.trim())) return res.status(400).json({ error: 'invalid_content' })
    if (req.body?.content?.length > 80000) return res.status(413).json({ error: 'content_too_large' })
    const id = req.params.chapterId
    const bookId = req.params.bookId
    const { title, content } = req.body
    const userId = req.user?.id
    const userRole = req.user?.role
    
    if (useMysql) {
      // Check if user is admin or author
      if (userRole !== 'admin' && userRole !== 'author') {
        return res.status(403).json({ error: 'forbidden' })
      }
      
      // If author, verify ownership of the book
      if (userRole === 'author') {
        const book = await db.getBookById(bookId)
        if (!book) return res.status(404).json({ error: 'book not found' })
        
        const bookOwnerId = book.author_user_id || book.user_id
        if (String(bookOwnerId) !== String(userId)) {
          return res.status(403).json({ error: 'not your book' })
        }
      }
      
      if (!await db.getChapterById(bookId, id)) return res.status(404).json({ error: 'not found' })
      const updated = await db.updateChapter(id, { title, content })
      if (!updated) return res.status(404).json({ error: 'not found' })

      if (content) {
        try {
          const verdict = await integrity.reviewChapter(db, {
            storyId: bookId,
            chapterId: id,
            content,
            complete: chatAgent.chatCompletion
          })
          updated.status = verdict.status
          updated.moderation = {
            zone: verdict.zone,
            hamming: verdict.hamming,
            similarity: verdict.similarity,
            similarity_pct: verdict.similarity_pct,
            matched_chapter_id: verdict.matched_chapter_id,
            matched_story_title: verdict.matched_story_title,
            matched_chapter_title: verdict.matched_chapter_title,
            matched_snippets: verdict.matched_snippets,
            ai_analysis: verdict.ai_analysis,
            trace_id: verdict.trace_id
          }
          if (req.user.role !== 'admin') updated.moderation = redactForeignChapterText(updated.moderation)
        } catch (reviewErr) {
          console.error('[integrity] update chapter review error:', reviewErr && reviewErr.message)
          updated.status = 'pending_review'
          updated.moderation = { zone: 'unknown', fallback_reason: 'review_failed' }
          await db.insertModerationLog({ target_type: 'chapter', target_id: id, violation_type: 'plagiarism', confidence_score: 0,
            evidence_data: { zone: 'unknown', fallback_reason: 'review_failed', content_hash: require('./ai_store').hashText(content) } }).catch(() => {})
        }
      }
      return res.json(updated)
    }
    // file-mode: update chapter in data.json
    const data = readData()
    const book = data.books.find(b => b.id === bookId)
    if (!book) return res.status(404).json({ error: 'book not found' })
    if (!canEditFileBook(book, req.user)) return res.status(403).json({ error: 'forbidden' })
    const ch = (book.chapters || []).find(c => String(c.id) === String(id))
    if (!ch) return res.status(404).json({ error: 'chapter not found' })
    if (title !== undefined) ch.title = title
    if (content !== undefined) {
      ch.content = content
      ch.status = 'pending_review'
    }
    writeData(data)
    return res.json(ch)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /books/:bookId/chapters/:chapterId - admin or author delete chapter
app.delete('/books/:bookId/chapters/:chapterId', authMiddleware, async (req, res) => {
  try {
    const id = req.params.chapterId
    const bookId = req.params.bookId
    const userId = req.user?.id
    const userRole = req.user?.role
    
    console.log(`[DELETE] /books/${bookId}/chapters/${id} useMysql=${useMysql} user=${req.user && req.user.email ? req.user.email : req.user && req.user.id ? req.user.id : 'unknown'}`)
    
    if (useMysql) {
      // Check if user is admin or author
      if (userRole !== 'admin' && userRole !== 'author') {
        return res.status(403).json({ error: 'forbidden' })
      }
      
      // If author, verify ownership of the book
      if (userRole === 'author') {
        const book = await db.getBookById(bookId)
        if (!book) return res.status(404).json({ error: 'book not found' })
        
        const bookOwnerId = book.author_user_id || book.user_id
        if (String(bookOwnerId) !== String(userId)) {
          return res.status(403).json({ error: 'not your book' })
        }
      }
      
      try {
        if (!await db.getChapterById(bookId, id)) return res.status(404).json({ error: 'not found' })
        const result = await db.deleteChapter(id)
        return res.json(result)
      } catch (err) {
        console.error('db.deleteChapter error', err && err.stack ? err.stack : err)
        // in dev mode include message
        if (process.env.ALLOW_DEV_TOKENS === 'true') return res.status(500).json({ error: String(err && err.message ? err.message : err) })
        return res.status(500).json({ error: 'internal' })
      }
    }
    // file-mode: remove chapter from data.json
    const data = readData()
    const book = data.books.find(b => b.id === bookId)
    if (!book) return res.status(404).json({ error: 'book not found' })
    if (!canEditFileBook(book, req.user)) return res.status(403).json({ error: 'forbidden' })
    const idx = (book.chapters || []).findIndex(c => String(c.id) === String(id))
    if (idx === -1) return res.status(404).json({ error: 'chapter not found' })
    const removed = book.chapters.splice(idx, 1)
    writeData(data)
    return res.json({ deleted: removed[0] || null })
  } catch (err) {
    console.error('DELETE chapter handler err', err && err.stack ? err.stack : err)
    if (process.env.ALLOW_DEV_TOKENS === 'true') return res.status(500).json({ error: String(err && err.message ? err.message : err) })
    res.status(500).json({ error: 'internal' })
  }
})

// Comments
// POST /books/:id/comments - create a new comment (requires auth)
app.post('/books/:id/comments', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const bookId = req.params.id
    const { content, parent_id } = req.body || {}

    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content required' })
    }

    const gate = integrity.intakeComment(content)
    if (!gate.insert) {
      return res.status(gate.httpStatus).json({ error: gate.error, message: gate.message })
    }
    if (!await db.getVisibleBookById(bookId)) return res.status(404).json({ error: 'book not found' })
    if (parent_id != null) {
      if (!/^[1-9]\d*$/.test(String(parent_id))) return res.status(400).json({ error: 'invalid_parent' })
      const parent = await db.getCommentById(parent_id)
      if (!parent || String(parent.story_id) !== String(bookId) || !parent.enabled
          || (parent.status !== 'approved' && !(String(parent.user_id) === String(userId) && ['pending', 'shadowbanned'].includes(parent.status)))) {
        return res.status(400).json({ error: 'invalid_parent', message: 'Bình luận cha không tồn tại hoặc không thể trả lời.' })
      }
    }
    if (!await enforceAiQuota(req, res, 'comment', 30)) return

    const comment = await db.createComment(bookId, {
      user_id: userId,
      content: content.trim(),
      parent_id: parent_id || null,
      is_negative: 0,
      negative_probability: 0,
      status: 'pending'
    })
    await integrity.scheduleCommentScore({
      db,
      comment: { id: comment.id, content: content.trim() },
      complete: chatAgent.chatCompletion
    })
    res.status(201).json(comment)
  } catch (err) {
    console.error('POST /books/:id/comments err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /books/:id/comments - public list
app.get('/books/:id/comments', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const bookId = req.params.id
    await aiReady
    if (!await db.getVisibleBookById(bookId)) return res.status(404).json({ error: 'book not found' })
    const list = await db.getComments(bookId, { publicFeed: true, viewerId: optionalUserId(req) })
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

function requireAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' })
    return false
  }
  return true
}

app.get('/moderation/logs', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!requireAdmin(req, res)) return
    const status = req.query.status || 'pending_review'
    const rows = await db.listModerationLogs(status)
    res.json(rows.map((row) => ({ ...row, trace_url: row.trace_id ? integrity.langfuseTraceUrl(row.trace_id) : null })))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/moderation/logs/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!requireAdmin(req, res)) return
    const log = await db.getModerationLog(req.params.id)
    if (!log) return res.status(404).json({ error: 'not found' })
    const diff = await integrity.buildModerationDiff(db, log)
    res.json({
      ...log,
      trace_url: log.trace_id ? integrity.langfuseTraceUrl(log.trace_id) : null,
      diff
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.post('/moderation/logs/:id/decision', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!requireAdmin(req, res)) return
    const log = await db.getModerationLog(req.params.id)
    if (!log) return res.status(404).json({ error: 'not found' })
    const result = await integrity.applyModerationDecision(db, log, req.body && req.body.action, req.user.id)
    res.json(result)
  } catch (err) {
    if (err.code === 'invalid_action') return res.status(400).json({ error: 'invalid_action' })
    if (err.code === 'review_conflict') return res.status(409).json({ error: 'review_conflict', message: 'Nội dung hoặc quyết định đã thay đổi. Hãy tải lại.' })
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

require('./langfuse_routes')(app, authMiddleware, requireAdmin)

// POST /integrity/check-duplicate - Real-time AI duplicate analysis for authors & admin
app.post('/integrity/check-duplicate', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!['author', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' })
    const { content, title, chapterId, storyId } = req.body || {}
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' })
    }
    if (content.length > 80000) return res.status(413).json({ error: 'content_too_large' })
    if (chapterId != null) {
      if (!storyId) return res.status(400).json({ error: 'story_id_required' })
      const book = await db.getBookById(storyId)
      const chapter = book && await db.getChapterById(storyId, chapterId)
      if (!chapter) return res.status(404).json({ error: 'chapter not found' })
      if (req.user.role !== 'admin' && String(book.author_user_id) !== String(req.user.id)) return res.status(403).json({ error: 'not your story' })
    }
    if (!await enforceAiQuota(req, res, 'duplicate', 10)) return

    const analysis = await integrity.analyzeContentSimilarity(db, {
      storyId,
      chapterId,
      content: content.trim(),
      title: title ? String(title).trim() : '',
      complete: chatAgent.chatCompletion
    })

    const body = req.user.role === 'admin' ? analysis : redactForeignChapterText(analysis)
    return res.json(body)
  } catch (err) {
    console.error('POST /integrity/check-duplicate err', err)
    return res.status(500).json({ error: 'internal', message: err?.message || String(err) })
  }
})

// POST /integrity/backfill - Backfill fingerprints for all existing chapters (Admin only)
app.post('/integrity/backfill', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden', message: 'Chỉ Admin mới có quyền thực hiện' })
    }
    const result = await integrity.backfillFingerprints(db)
    return res.json({ success: true, ...result })
  } catch (err) {
    console.error('POST /integrity/backfill err', err)
    return res.status(500).json({ error: 'internal', message: err?.message || String(err) })
  }
})

// GET /comments?book_id= - admin only (or extendable)
app.get('/comments', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const bookId = req.query.book_id
    const status = req.query.status || undefined
    const limit = req.query.limit || 50
    const offset = req.query.offset || 0
    const list = await db.getComments(bookId, { includeAll: true, status, limit, offset })
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Admin update comment
app.put('/comments/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const { content, enabled, status } = req.body
    if ((content !== undefined && (typeof content !== 'string' || !content.trim() || content.length > 2000))
        || (enabled !== undefined && typeof enabled !== 'boolean')
        || (status !== undefined && !['pending', 'approved', 'shadowbanned', 'rejected'].includes(status))) {
      return res.status(400).json({ error: 'invalid_comment_update' })
    }
    const updated = await db.updateComment(id, { content, enabled, status, reviewed_by: req.user.id })
    if (!updated) return res.status(404).json({ error: 'not found' })
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Admin approve/reject convenience endpoints
app.post('/comments/:id/approve', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const updated = await db.updateComment(id, { status: 'approved', reviewed_by: req.user.id })
    if (!updated) return res.status(404).json({ error: 'not found' })
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.post('/comments/:id/reject', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const reason = req.body && req.body.reason ? String(req.body.reason) : null
    if (req.body?.content !== undefined && (typeof req.body.content !== 'string' || !req.body.content.trim() || req.body.content.length > 2000)) {
      return res.status(400).json({ error: 'invalid_comment_update' })
    }
    const updated = await db.updateComment(id, { status: 'rejected', reviewed_by: req.user.id, content: req.body && req.body.content ? req.body.content : undefined })
    if (!updated) return res.status(404).json({ error: 'not found' })
    if (reason) updated.admin_reason = reason
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Admin delete comment
app.delete('/comments/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const id = req.params.id
    if (!req.user) return res.status(401).json({ error: 'missing authorization' })

    // Admin can delete any comment
    if (req.user.role === 'admin') {
      const result = await db.deleteComment(id)
      return res.json(result)
    }

    // Normal user: can only delete their own comments
    const c = await db.getCommentById(id)
    if (!c) return res.status(404).json({ error: 'not found' })
    if (String(c.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'forbidden' })

    const result = await db.deleteCommentByUser(id, req.user.id)
    return res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Likes
// POST /books/:id/like - like a story
app.post('/books/:id/like', authMiddleware, async (req, res) => {
  try {
    if (useMysql) {
      const userId = req.user.id
      const bookId = req.params.id
      const row = await db.createLike(userId, bookId)
      return res.status(201).json(row)
    }
    // file-mode fallback: bump likes_count (no per-user uniqueness)
    const data = readData()
    const book = (data.books || []).find(b => String(b.id) === String(req.params.id))
    if (!book) return res.status(404).json({ error: 'not found' })
    book.likes_count = Number(book.likes_count || 0) + 1
    writeData(data)
    return res.status(201).json({ id: shortid.generate(), likes_count: book.likes_count })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /books/:id/like - remove like
app.delete('/books/:id/like', authMiddleware, async (req, res) => {
  try {
    if (useMysql) {
      const userId = req.user.id
      const bookId = req.params.id
      const row = await db.deleteLike(userId, bookId)
      return res.json(row)
    }
    // file-mode fallback
    const data = readData()
    const book = (data.books || []).find(b => String(b.id) === String(req.params.id))
    if (!book) return res.status(404).json({ error: 'not found' })
    book.likes_count = Math.max(0, Number(book.likes_count || 0) - 1)
    writeData(data)
    return res.json({ affectedRows: 1, likes_count: book.likes_count })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /books/:id/likes - public count
app.get('/books/:id/likes', async (req, res) => {
  try {
    if (useMysql) {
      const bookId = req.params.id
      const user = await getUserFromAuthHeader(req)
      const [cnt, liked] = await Promise.all([
        db.getLikesCount(bookId),
        user ? db.hasUserLiked(user.id, bookId) : false
      ])
      return res.json({ count: cnt, liked: !!liked })
    }
    // file-mode fallback
    const data = readData()
    const book = (data.books || []).find(b => String(b.id) === String(req.params.id))
    if (!book) return res.status(404).json({ error: 'not found' })
    return res.json({ count: Number(book.likes_count || 0), liked: false })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /books/:id/follow - follow a story (auth)
app.post('/books/:id/follow', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const followerId = req.user.id
    const bookId = req.params.id
    const row = await db.createFollow(followerId, bookId)
    res.status(201).json(row)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /books/:id/follow - unfollow a story (auth)
app.delete('/books/:id/follow', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const followerId = req.user.id
    const bookId = req.params.id
    const result = await db.deleteFollowByPair(followerId, bookId)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Authors (public listing, follow authors)
// GET /authors - list authors with follower/books counts; optional auth to include is_following
app.get('/authors', async (req, res) => {
  try {
    if (useMysql) {
      const user = await getUserFromAuthHeader(req)
      const rows = await db.getAuthors({ userId: user ? user.id : null })
      const authors = (rows || []).map(r => ({
        id: String(r.author_id),
        author_id: String(r.author_id),
        user_id: r.user_id ? String(r.user_id) : null,
        pen_name: r.pen_name || null,
        avatar_url: r.avatar_url ? (String(r.avatar_url).startsWith('/') ? `${req.protocol}://${req.get('host')}${r.avatar_url}` : String(r.avatar_url)) : null,
        followers_count: Number(r.followers_count || 0),
        books_count: Number(r.books_count || 0),
        is_following: !!r.is_following
      }))
      return res.json(authors)
    }

    // file-mode fallback: unique authors from data.json
    const data = readData()
    const map = new Map()
    for (const b of (data.books || [])) {
      const a = (b && (b.author || b.author_name || b.pen_name)) ? String(b.author || b.author_name || b.pen_name) : 'Không rõ'
      const cur = map.get(a) || { id: a, pen_name: a, followers_count: 0, books_count: 0, is_following: false }
      cur.books_count += 1
      map.set(a, cur)
    }
    return res.json(Array.from(map.values()))
  } catch (err) {
    console.error('GET /authors err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /authors/:id/books - list books by author_id
app.get('/authors/:id/books', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const authorId = req.params.id
    const rows = await db.getBooksByAuthorId(authorId)
    const books = (rows || []).map(r => {
      const chapterCount = (Number.parseInt(r.chapters_count, 10) || 0) || (Array.isArray(r.chapters) ? r.chapters.length : 0)
      return {
        id: String(r.id || r.story_id),
        story_id: String(r.story_id || r.id),
        title: r.title,
        author: r.author || r.author_id,
        author_id: r.author_id ? String(r.author_id) : null,
        author_user_id: r.author_user_id ? String(r.author_user_id) : null,
        description: r.description,
        genre: r.genre,
        chapters_count: chapterCount,
        chapters: new Array(chapterCount),
        likes_count: typeof r.likes_count === 'number' ? r.likes_count : Number(r.likes_count || 0),
        views: typeof r.views === 'number' ? r.views : Number(r.views_count || r.views || 0),
        cover_url: formatCoverUrl(req, r.cover_url || r.cover_image),
      }
    })
    res.json(books)
  } catch (err) {
    console.error('GET /authors/:id/books err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /authors/:id/follow - follow an author (auth)
app.post('/authors/:id/follow', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const authorId = req.params.id
    // Prevent self-follow (user following their own author profile)
    try {
      const author = await db.getAuthorById(authorId)
      if (author && author.user_id && String(author.user_id) === String(userId)) {
        return res.status(400).json({ error: 'cannot_follow_self', message: 'Không thể tự theo dõi chính mình.' })
      }
    } catch (e) {
      // ignore lookup errors and proceed (create will still be validated elsewhere)
    }
    const row = await db.createAuthorFollow(userId, authorId)
    res.status(201).json(row)
  } catch (err) {
    console.error('POST /authors/:id/follow err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /authors/:id/follow - unfollow an author (auth)
app.delete('/authors/:id/follow', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const authorId = req.params.id
    const result = await db.deleteAuthorFollowByPair(userId, authorId)
    res.json(result)
  } catch (err) {
    console.error('DELETE /authors/:id/follow err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /following/feed - authenticated user's feed (new stories + new chapters from followed authors)
app.get('/following/feed', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })

    const limit = Math.min(50, Number.parseInt(String(req.query.limit || '20'), 10) || 20)
    const offset = Math.max(0, Number.parseInt(String(req.query.offset || '0'), 10) || 0)

    const rows = await db.getFollowingFeed(userId, { limit, offset })

    const items = (rows || []).map(r => ({
      id: String(r.id),
      type: r.type,
      created_at: r.created_at,
      author_id: r.author_id,
      author_user_id: r.author_user_id,
      author_name: r.author_name,
      story_id: r.story_id,
      story_title: r.story_title,
      genre: r.genre,
      likes_count: Number(r.likes_count || 0),
      views: Number(r.views || 0),
      chapter_id: r.chapter_id,
      chapter_no: r.chapter_no,
      chapter_title: r.chapter_title,
      cover_url: formatCoverUrl(req, r.cover_image || r.cover_url),
    }))

    res.json(items)
  } catch (err) {
    console.error('GET /following/feed err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /feed - public feed (new stories + new chapters globally)
app.get('/feed', async (req, res) => {
  try {
    if (useMysql) {
      const limit = Math.min(50, Number.parseInt(String(req.query.limit || '20'), 10) || 20)
      const offset = Math.max(0, Number.parseInt(String(req.query.offset || '0'), 10) || 0)
      const rows = await db.getPublicFeed({ limit, offset })
      const items = (rows || []).map(r => ({
        id: String(r.id),
        type: r.type,
        created_at: r.created_at,
        author_id: r.author_id,
        author_user_id: r.author_user_id,
        author_name: r.author_name,
        story_id: r.story_id,
        story_title: r.story_title,
        genre: r.genre,
        likes_count: Number(r.likes_count || 0),
        views: Number(r.views || 0),
        chapter_id: r.chapter_id,
        chapter_no: r.chapter_no,
        chapter_title: r.chapter_title,
        cover_url: formatCoverUrl(req, r.cover_image || r.cover_url),
      }))
      return res.json(items)
    }

    // file-mode fallback: use latest books only
    const data = readData()
    const books = (data.books || []).slice().reverse().slice(0, 20).map((b, idx) => ({
      id: `story:${String(b.id || idx)}`,
      type: 'story',
      created_at: b.created_at || new Date().toISOString(),
      author_id: null,
      author_user_id: null,
      author_name: b.author || 'Tác giả',
      story_id: String(b.id || idx),
      story_title: b.title || b.name || 'Truyện',
      genre: b.genre || null,
      likes_count: Number(b.likes_count || b.likes || 0),
      views: Number(b.views || b.view_count || 0),
      chapter_id: null,
      chapter_no: null,
      chapter_title: null,
      cover_url: formatCoverUrl(req, b.cover_url || b.cover_image),
    }))
    return res.json(books)
  } catch (err) {
    console.error('GET /feed err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Follows
// POST /follows { followee_id } - authenticated user follows someone
app.post('/follows', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const followerId = req.user.id
    const followee_id = (req.body && (req.body.followee_id || req.body.story_id || req.body.book_id || req.body.followed_id || req.body.target_id))
    if (!followee_id) return res.status(400).json({ error: 'followee_id (or story_id/book_id) required' })
    const row = await db.createFollow(followerId, followee_id)
    res.status(201).json(row)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /follows?user_id= - admin can list all or filter; normal users can list their own
app.get('/follows', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const queryUser = req.query.user_id
    if (req.user.role === 'admin') {
      const list = await db.getFollows(queryUser)
      return res.json(list)
    }
    // normal user - only allow own
    const list = await db.getFollows(req.user.id)
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /follows/:id - admin or owner (follower) may remove
app.delete('/follows/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const id = req.params.id
    // admin can delete any; otherwise ensure the follower is the requester
    if (req.user.role === 'admin') {
      const result = await db.deleteFollow(id)
      return res.json(result)
    }
    // check ownership
    const row = await db.getFollowById(id)
    if (!row) return res.status(404).json({ error: 'not found' })
    if (String(row.follower_id) !== String(req.user.id)) return res.status(403).json({ error: 'forbidden' })
    const result = await db.deleteFollow(id)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Update book (admin only) - accepts JSON { title, author, description, cover_url, genre }
app.put('/books/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id
    const { title, author, description, genre } = req.body || {}
    console.log('[PUT /books/:id] Received body:', JSON.stringify(req.body, null, 2))
    console.log('[PUT /books/:id] Extracted genre:', genre)
    const cover_url = req.body ? (req.body.cover_url || req.body.coverUrl || req.body.coverUrl) : undefined
    // If using MySQL, require admin or author auth
    if (useMysql) {
      if (!['admin', 'author'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' })
      if (req.user.role === 'author') {
        const book = await db.getBookById(id)
        if (!book) return res.status(404).json({ error: 'book not found' })
        if (String(book.author_user_id || book.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'not your book' })
      }
      console.log('payload:', { title: title || null, author: author || null, cover_url: cover_url || null, genre: genre || null })
      const updated = await db.updateBook(id, { title, author, description, genre })
      if (!updated) return res.status(404).json({ error: 'not found' })
      // if cover_url provided, try to update cover_url
      if (cover_url) {
        try { await db.updateBookCover(id, cover_url) } catch (e) { console.error('updateBookCover err', e) }
        if (updated && typeof updated === 'object') updated.cover_url = cover_url
      }
      return res.json(updated)
    }

    // file-based fallback: update data.json
    const data = readData()
    const idx = (data.books || []).findIndex(b => String(b.id) === String(id))
    if (idx === -1) return res.status(404).json({ error: 'not found' })
    const book = data.books[idx]
    if (title !== undefined) book.title = title
    if (author !== undefined) book.author = author
    if (description !== undefined) book.description = description
    if (genre !== undefined) book.genre = genre
    if (cover_url) {
      book.cover_url = cover_url
    }
    writeData(data)
    return res.json(book)
  } catch (err) {
    console.error('Error updating book:', err && err.stack ? err.stack : err)
    res.status(500).json({ error: err && err.message ? err.message : 'internal' })
  }
})

// POST /books/:id/upload - multipart update for cover file
app.post('/books/:id/upload', authMiddleware, (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  next()
}, imageUploadMiddleware(upload, 'cover'), async (req, res) => {
  try {
    if (!validateUploadedRaster(req, res)) return
    const id = req.params.id
    if (useMysql) {
      try {
        if (!req.file) return res.status(400).json({ error: 'file required' })
        const coverUrl = `/covers/${req.file.filename}`
        await db.updateBookCover(id, coverUrl)
        const book = await db.getBookById(id)
        if (book && book.cover_url && book.cover_url.startsWith('/')) book.cover_url = `${req.protocol}://${req.get('host')}${book.cover_url}`
        return res.json(book)
      } catch (e) { console.error('auth verify failed', e); return res.status(401).json({ error: 'invalid token' }) }
    }
    // file-based
    if (!req.file) return res.status(400).json({ error: 'file required' })
    const data = readData()
    const idx = (data.books || []).findIndex(b => String(b.id) === String(id))
    if (idx === -1) return res.status(404).json({ error: 'not found' })
    const coverUrl = `/covers/${req.file.filename}`
    data.books[idx].cover_url = `${req.protocol}://${req.get('host')}${coverUrl}`
    writeData(data)
    return res.json(data.books[idx])
  } catch (err) {
    console.error('Error uploading cover:', err)
    res.status(500).json({ error: err && err.message ? err.message : 'internal' })
  }
})

// POST /uploads/cover-json - accept JSON { filename, data } where data is base64 (no data: prefix)
app.post('/uploads/cover-json', authMiddleware, async (req, res) => {
  try {
    if (!['admin', 'author'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' })
    const { filename, data } = req.body || {}
    if (typeof filename !== 'string' || !filename.trim() || typeof data !== 'string' || !data) return res.status(400).json({ error: 'filename and data (base64) required' })
    if (data.length > 12 * 1024 * 1024) return res.status(413).json({ error: 'image_too_large' })
    const image = decodeImageBase64(data)
    if (!image) return res.status(400).json({ error: 'invalid_image' })
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${image.ext}`
    const outPath = path.join(coversDir, safeName)
    fs.writeFileSync(outPath, image.buffer)
    const coverUrl = `/covers/${safeName}`
    return res.json({ url: `${req.protocol}://${req.get('host')}${coverUrl}`, path: coverUrl })
  } catch (err) {
    console.error('uploads cover-json err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Delete book (admin only)
app.delete('/books/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const id = req.params.id
    const userId = req.user?.id
    const userRole = req.user?.role
    
    // Check if user is admin or author of this book
    if (userRole !== 'admin' && userRole !== 'author') {
      return res.status(403).json({ error: 'forbidden' })
    }
    
    // If author, verify ownership
    if (userRole === 'author') {
      const book = await db.getBookById(id)
      if (!book) return res.status(404).json({ error: 'book not found' })
      
      // Check if user owns this book (author_user_id or user_id matches)
      const bookOwnerId = book.author_user_id || book.user_id
      if (String(bookOwnerId) !== String(userId)) {
        return res.status(403).json({ error: 'not your book' })
      }
    }
    
    const result = await db.deleteBook(id)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Admin registration (protected by a secret in .env)
app.post('/auth/register-admin', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'register requires MySQL mode' })
    const { email, password, name, secret } = req.body
    if (!email || !password || !secret) return res.status(400).json({ error: 'email, password and secret required' })
    const adminSecret = process.env.ADMIN_REG_SECRET || ''
    if (!adminSecret || secret !== adminSecret) return res.status(403).json({ error: 'invalid admin secret' })
    const existing = await db.getUserByEmail(email)
    if (existing) return res.status(400).json({ error: 'email exists' })
    const hash = await bcrypt.hash(password, 10)
    const user = await db.createUser({ email, password_hash: hash, name, role: 'admin' })
    res.status(201).json(user)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Authenticated user info
app.get('/me', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const id = req.user && req.user.id
    if (!id) return res.status(401).json({ error: 'missing authorization' })
    const u = await db.getUserById(id)
    if (!u) return res.status(404).json({ error: 'not found' })
    // attach author_id if exists
    try {
      const authorRow = await db.getAuthorByUserId(id)
      if (authorRow && authorRow.author_id) u.author_id = String(authorRow.author_id)
    } catch (e) { /* ignore */ }
    return res.json(u)
  } catch (err) {
    console.error('/me err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Notifications (auth): who liked your stories, who followed you, and donations received.
app.get('/notifications', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const { limit, offset } = req.query || {}
    const items = await db.getNotifications(userId, { limit, offset })
    return res.json(items)
  } catch (err) {
    console.error('GET /notifications err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Notifications unread indicator (auth)
app.get('/notifications/unread', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const state = await db.hasUnreadNotifications(userId)
    return res.json(state)
  } catch (err) {
    console.error('GET /notifications/unread err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Mark notifications as seen (auth)
app.post('/notifications/seen', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const ok = await db.markNotificationsSeen(userId)
    return res.json(ok)
  } catch (err) {
    console.error('POST /notifications/seen err', err)
    res.status(500).json({ error: 'internal' })
  }
})

app.post('/push/device', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    const platform = req.body?.platform === 'android' ? 'android' : null
    if (!token || token.length > 512 || !platform) return res.status(400).json({ error: 'invalid_device_token' })
    return res.json(await db.registerFcmToken(req.user.id, token, platform))
  } catch (err) {
    console.error('POST /push/device err', err)
    return res.status(500).json({ error: 'internal' })
  }
})

app.delete('/push/device', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    if (!token || token.length > 512) return res.status(400).json({ error: 'invalid_device_token' })
    return res.json(await db.removeFcmToken(req.user.id, token))
  } catch (err) {
    console.error('DELETE /push/device err', err)
    return res.status(500).json({ error: 'internal' })
  }
})

app.post('/auth/login', async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body || {}
    if (!validCredentials(rawEmail, password)) return res.status(400).json({ error: 'invalid credentials' })
    const email = rawEmail.trim().toLowerCase()
    if (!useMysql) return res.status(400).json({ error: 'login requires MySQL mode' })
    const user = await db.getUserByEmail(email)
    if (!user || !user.password_hash) return res.status(400).json({ error: 'invalid credentials' })
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) return res.status(400).json({ error: 'invalid credentials' })
    const payload = { id: String(user.user_id || user.id || ''), email: user.email, role: user.role }
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, user: { id: String(user.user_id || user.id || ''), email: user.email, name: user.name || user.fullname || '', role: user.role } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Payments: admin records a payment (optional VIP upgrade when months/days provided)
app.post('/payments', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const { user_id, amount, provider, provider_ref, months, days } = req.body || {}
    const targetUserId = user_id || (req.user && req.user.id)
    if (!targetUserId) return res.status(400).json({ error: 'user_id required' })
    const payment = await db.createPayment({ user_id: targetUserId, amount: amount || 0, provider: provider || null, provider_ref: provider_ref || null, months: months || null, days: days || null })
    if (months || days) {
      try {
        await db.updateUserVip(targetUserId, { months: months || undefined, days: days || undefined, role: 'vip' })
        const updated = await db.getUserById(targetUserId)
        return res.json({ success: true, payment, user: updated })
      } catch (e) {
        console.error('vip upgrade after payment failed', e)
        return res.status(500).json({ error: 'upgrade_failed', payment })
      }
    }
    return res.json({ success: true, payment })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Admin: list all payments (VIP purchases, admin topups, etc.)
app.get('/payments', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const list = await db.getPayments()
    res.json(list)
  } catch (err) {
    console.error('get payments err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Admin: list all donations (who donated to which author)
app.get('/donations', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const list = await db.getDonationsAdmin()
    res.json(list)
  } catch (err) {
    console.error('get donations err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Wallet endpoints
// GET /wallet - returns coin balance for authenticated user
app.get('/wallet', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const w = await db.getWallet(userId)
    res.json(w)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /users/:id/wallet/topup - admin directly credits coins to a user
app.post('/users/:id/wallet/topup', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const targetUserId = req.params.id
    const { coins, amount, note } = req.body || {}
    if (!coins || Number(coins) <= 0) return res.status(400).json({ error: 'coins required' })
    const wallet = await db.creditWallet(targetUserId, Number(coins))
    try { await db.createPayment({ user_id: targetUserId, amount: amount || 0, coins: Number(coins), provider: 'admin', provider_ref: note || 'admin-topup', months: null, days: null }) } catch (e) { console.error('admin createPayment err', e) }
    res.json({ success: true, wallet })
  } catch (err) {
    console.error('admin topup err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /wallet/topup-request - user submits a top-up order for admin approval
app.post('/wallet/topup-request', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const { coins, method, note, evidence_url, provider_ref } = req.body || {}
    const coinsNum = Math.floor(Number(coins))
    if (!Number.isFinite(coinsNum) || coinsNum <= 0) return res.status(400).json({ error: 'coins required' })
    const amountNum = coinsNum * COIN_VND
    const reqRow = await db.createTopupRequest({ user_id: userId, coins: coinsNum, amount: amountNum, method: method || 'manual', note, evidence_url, provider_ref })
    res.status(201).json(reqRow)
  } catch (err) {
    console.error('topup-request err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /wallet/topup-requests - user sees own requests; admin sees all
app.get('/wallet/topup-requests', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user) return res.status(401).json({ error: 'missing authorization' })
    const { status } = req.query || {}
    const filter = { status: status || undefined }
    if (req.user.role !== 'admin') filter.user_id = req.user.id
    const list = await db.listTopupRequests(filter)
    res.json(list)
  } catch (err) {
    console.error('list topup-requests err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /wallet/topup-requests/:id/approve - admin approves and credits wallet
app.post('/wallet/topup-requests/:id/approve', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const admin_note = req.body && req.body.admin_note ? req.body.admin_note : null
    const coins = req.body && req.body.coins != null ? Number(req.body.coins) : undefined
    const result = await db.approvePendingTopupRequest(id, { admin_id: req.user.id, admin_note, coins })
    if (result && result.error === 'not_found') return res.status(404).json({ error: 'not found' })
    if (result && result.error === 'already_processed') return res.status(400).json({ error: 'already_processed', status: result.status })
    if (result && result.error) return res.status(400).json({ error: result.error })
    res.json({ success: true, request: result.request, wallet: result.wallet })
  } catch (err) {
    console.error('approve topup err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /wallet/topup-requests/:id/reject - admin rejects
app.post('/wallet/topup-requests/:id/reject', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const existing = await db.getTopupRequestById(id)
    if (!existing) return res.status(404).json({ error: 'not found' })
    const admin_note = req.body && req.body.admin_note ? req.body.admin_note : null
    const updated = await db.setTopupRequestStatus(id, { status: 'rejected', admin_id: req.user.id, admin_note })
    if (updated && updated.error === 'already_processed') return res.status(400).json({ error: 'already_processed', status: updated.status })
    if (updated && updated.error === 'not_found') return res.status(404).json({ error: 'not found' })
    res.json({ success: true, request: updated })
  } catch (err) {
    console.error('reject topup err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /wallet/topup - admin credits coins (self-serve mint is forbidden)
app.post('/wallet/topup', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const { user_id, coins, amount, provider, provider_ref } = req.body || {}
    const targetUserId = user_id || (req.user && req.user.id)
    const coinsNum = Math.floor(Number(coins))
    if (!targetUserId) return res.status(400).json({ error: 'user_id required' })
    if (!Number.isFinite(coinsNum) || coinsNum <= 0) return res.status(400).json({ error: 'coins required' })
    try { await db.createPayment({ user_id: targetUserId, amount: amount || (coinsNum * COIN_VND), coins: coinsNum, provider: provider || 'admin', provider_ref: provider_ref || 'admin-topup', months: null, days: null }) } catch (e) { console.error('createPayment err', e) }
    const w = await db.creditWallet(targetUserId, coinsNum)
    res.json(w)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /wallet/topup-intent - create a payment intent for SePay automated bank topup
app.post('/wallet/topup-intent', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })

    const { coins } = req.body || {}
    const coinsNum = Math.floor(Number(coins))
    if (!Number.isFinite(coinsNum) || coinsNum <= 0) return res.status(400).json({ error: 'coins required' })
    if (coinsNum > 1000000) return res.status(400).json({ error: 'coins too large' })
    const amountNum = coinsNum * COIN_VND

    const bankName = process.env.SEPAY_BANK_NAME || 'MBBank'
    const accountNo = process.env.SEPAY_ACCOUNT_NO || '123406072004'
    const accountName = process.env.SEPAY_ACCOUNT_NAME || 'Hoang Van Huy'

    let intent = null
    let paymentCode = null
    for (let attempt = 0; attempt < 5; attempt++) {
      paymentCode = generateTopupPaymentCode()
      try {
        intent = await db.createTopupIntent({
          user_id: userId,
          coins: coinsNum,
          amount: amountNum,
          payment_code: paymentCode,
          account_no: accountNo,
          expires_in_minutes: 15
        })
        if (intent) break
      } catch (e) {
        if (e && e.code === 'ER_DUP_ENTRY') continue
        throw e
      }
    }
    if (!intent) return res.status(500).json({ error: 'internal' })

    // SePay QR image URL
    const qrUrl = `https://qr.sepay.vn/img?acc=${encodeURIComponent(accountNo)}&bank=${encodeURIComponent(bankName)}&amount=${amountNum}&des=${encodeURIComponent(paymentCode)}`
    // VietQR fallback image URL
    const vietQrUrl = `https://img.vietqr.io/image/${encodeURIComponent(bankName)}-${encodeURIComponent(accountNo)}-compact2.jpg?amount=${amountNum}&addInfo=${encodeURIComponent(paymentCode)}&accountName=${encodeURIComponent(accountName)}`

    res.status(201).json({
      success: true,
      intent: {
        ...intent,
        bank_name: bankName,
        account_no: accountNo,
        account_name: accountName,
        qr_url: qrUrl,
        vietqr_url: vietQrUrl,
        local_mode: isSepayLocal()
      }
    })
  } catch (err) {
    console.error('[topup-intent] Error:', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /wallet/topup-intent/:code/status - check status of topup intent (used for client polling)
app.get('/wallet/topup-intent/:code/status', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const { code } = req.params
    if (!code) return res.status(400).json({ error: 'code required' })

    const intent = await db.getTopupIntentByCode(code)
    if (!intent) return res.status(404).json({ error: 'intent not found' })

    if (req.user && req.user.role !== 'admin' && String(req.user.id) !== String(intent.user_id)) {
      return res.status(403).json({ error: 'forbidden' })
    }

    let status = intent.status
    if (status === 'pending' && intent.expires_at && new Date(intent.expires_at).getTime() <= Date.now()) {
      status = 'expired'
    }
    let wallet = null
    const isPaid = status === 'consumed'
    if (isPaid) {
      wallet = await db.getWallet(intent.user_id)
    }

    res.json({
      success: true,
      status,
      is_paid: isPaid,
      coins: intent.coins,
      amount: intent.amount,
      wallet: wallet
    })
  } catch (err) {
    console.error('[topup-intent status] Error:', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /sepay/local-pay - credit a pending intent on this machine. Ignored in production.
app.post('/sepay/local-pay', authMiddleware, async (req, res) => {
  try {
    if (!isSepayLocal()) return res.status(404).json({ success: false, paid: false, error: 'not_found' })
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const paymentCode = String((req.body || {}).paymentCode || '').trim().toUpperCase()
    if (!paymentCode) return res.status(400).json({ success: false, paid: false, message: 'Mã thanh toán không hợp lệ' })

    const intent = await db.getTopupIntentByCode(paymentCode)
    if (!intent) return res.status(404).json({ success: false, paid: false, message: 'Không tìm thấy yêu cầu nạp' })
    if (req.user.role !== 'admin' && String(intent.user_id) !== String(userId)) {
      return res.status(403).json({ success: false, paid: false, message: 'Không có quyền xác nhận giao dịch này' })
    }

    const result = await db.consumeAndCreditIntent({
      payment_code: paymentCode,
      user_id: intent.user_id,
      min_amount: Number(intent.amount),
      provider: 'sepay',
      provider_ref: `local_${paymentCode}`,
      amount_received: Number(intent.amount)
    })
    if (result && result.ok) {
      console.log(`[SePay local] Credited ${result.coins} xu to user ${intent.user_id} for ${paymentCode}`)
      return res.json({
        success: true,
        paid: true,
        already_credited: !!result.already_credited,
        local_mode: true,
        message: `Đã cộng ${intent.coins} xu (SePay local, không qua ngân hàng).`,
        wallet: result.wallet,
        coins: result.coins
      })
    }
    if (result && result.code === 'expired') {
      return res.json({ success: false, paid: false, message: 'Mã thanh toán đã hết hạn. Vui lòng tạo mã QR mới.' })
    }
    return res.json({ success: false, paid: false, message: 'Không cộng được xu cho mã này.' })
  } catch (err) {
    console.error('[SePay local] Error:', err)
    res.status(500).json({ success: false, paid: false, message: 'Lỗi hệ thống' })
  }
})

// POST /sepay/webhook - Automated Webhook from SePay gateway
app.post('/sepay/webhook', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!sepayWebhookAuthorized(req)) {
      console.warn('[SePay Webhook] Unauthorized access attempt')
      return res.status(401).json({ success: false, message: 'Unauthorized SePay API key' })
    }

    const {
      id,
      gateway,
      accountNumber,
      content,
      transferType,
      transferAmount,
      referenceCode,
      description
    } = req.body || {}

    console.log('[SePay Webhook] Received:', { id, gateway, accountNumber, content, transferType, transferAmount, referenceCode })

    if (transferType && String(transferType).toLowerCase() !== 'in') {
      return res.json({ success: true, message: 'Ignored outgoing transfer' })
    }

    const amountReceived = Number(transferAmount || 0)
    if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
      return res.json({ success: true, message: 'Ignored zero/negative transfer amount' })
    }

    const paymentCode = extractSepayPaymentCode(req.body || {})
    if (!paymentCode) {
      console.warn('[SePay Webhook] No payment code in transfer content:', { content, amountReceived })
      return res.json({ success: false, message: 'No matching intent found for transaction' })
    }

    const intent = await db.getTopupIntentByCode(paymentCode)
    if (!intent) {
      console.warn('[SePay Webhook] No matching intent:', { paymentCode, amountReceived })
      return res.json({ success: false, message: 'No matching intent found for transaction' })
    }

    if (amountReceived < Number(intent.amount)) {
      console.warn('[SePay Webhook] Amount mismatch:', { paymentCode, amountReceived, expected: intent.amount })
      return res.json({ success: false, message: 'Transfer amount is below intent amount' })
    }

    const providerRef = id ? `sepay_${id}` : (referenceCode ? `sepay_ref_${referenceCode}` : paymentCode)
    const result = await db.consumeAndCreditIntent({
      payment_code: paymentCode,
      min_amount: amountReceived,
      provider: 'sepay',
      provider_ref: providerRef,
      amount_received: amountReceived
    })

    if (result && result.ok && result.already_credited) {
      return res.json({ success: true, message: 'Transaction already processed', user_id: intent.user_id, coins: Number(intent.coins), wallet: result.wallet })
    }
    if (!result || !result.ok) {
      const code = result && result.code
      if (code === 'expired') return res.json({ success: false, message: 'Intent expired' })
      if (code === 'amount_mismatch') return res.json({ success: false, message: 'Transfer amount is below intent amount' })
      return res.json({ success: false, message: 'Unable to credit intent' })
    }

    console.log(`[SePay Webhook] SUCCESS: Credited ${result.coins} coins to user ${intent.user_id}.`)
    return res.json({
      success: true,
      message: 'Topup credited successfully',
      user_id: intent.user_id,
      coins: result.coins,
      wallet: result.wallet
    })
  } catch (err) {
    console.error('[SePay Webhook] Error:', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// POST /wallet/verify-payment - verify payment against bank/SePay then credit stored intent coins
app.post('/wallet/verify-payment', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })

    const paymentCode = String((req.body || {}).paymentCode || '').trim().toUpperCase()
    if (!paymentCode) return res.status(400).json({ error: 'paymentCode required', success: false, paid: false, message: 'Mã thanh toán không hợp lệ' })

    const intent = await db.getTopupIntentByCode(paymentCode)
    if (!intent) return res.status(404).json({ error: 'not found', success: false, paid: false, message: 'Không tìm thấy yêu cầu nạp' })
    if (req.user.role !== 'admin' && String(intent.user_id) !== String(userId)) {
      return res.status(403).json({ error: 'forbidden', success: false, paid: false, message: 'Không có quyền xác thực giao dịch này' })
    }

    if (String(intent.status) === 'consumed') {
      const wallet = await db.getWallet(intent.user_id)
      return res.json({
        success: true,
        paid: true,
        already_credited: true,
        message: `Thanh toán thành công! Đã cộng ${intent.coins} xu vào tài khoản.`,
        wallet
      })
    }

    if (String(intent.status) === 'expired' || (intent.expires_at && new Date(intent.expires_at).getTime() <= Date.now())) {
      return res.json({ success: false, paid: false, message: 'Mã thanh toán đã hết hạn. Vui lòng tạo mã QR mới.' })
    }

    const bank = await findMatchingBankTransfer(intent)
    if (!bank.paid) {
      return res.json({
        success: false,
        paid: false,
        message: 'Chưa tìm thấy giao dịch chuyển khoản phù hợp. Vui lòng kiểm tra lại nội dung chuyển khoản hoặc đợi hệ thống xử lý trong giây lát.'
      })
    }

    const result = await db.consumeAndCreditIntent({
      payment_code: paymentCode,
      user_id: intent.user_id,
      min_amount: bank.amount,
      provider: 'sepay',
      provider_ref: bank.provider_ref,
      amount_received: bank.amount
    })

    if (result && result.ok) {
      return res.json({
        success: true,
        paid: true,
        already_credited: !!result.already_credited,
        message: `Thanh toán thành công! Đã cộng ${intent.coins} xu vào tài khoản.`,
        wallet: result.wallet
      })
    }

    if (result && result.code === 'expired') {
      return res.json({ success: false, paid: false, message: 'Mã thanh toán đã hết hạn. Vui lòng tạo mã QR mới.' })
    }
    if (result && result.code === 'amount_mismatch') {
      return res.json({ success: false, paid: false, message: 'Số tiền chuyển khoản chưa đủ so với yêu cầu nạp.' })
    }

    return res.json({
      success: false,
      paid: false,
      message: 'Chưa tìm thấy giao dịch chuyển khoản phù hợp. Vui lòng kiểm tra lại nội dung chuyển khoản hoặc đợi hệ thống xử lý trong giây lát.'
    })
  } catch (err) {
    console.error('[verify-payment] Error:', err)
    res.status(500).json({ success: false, paid: false, message: 'Lỗi hệ thống', error: 'internal' })
  }
})

// POST /wallet/buy-vip - spend coins to become VIP
app.post('/wallet/buy-vip', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const cost = VIP_COST_COINS
    const debit = await db.debitWallet(userId, cost)
    if (debit && debit.error) return res.status(400).json({ error: 'insufficient_funds', balance: debit.balance, expected_cost: cost })
    let ok = false
    try {
      ok = await db.updateUserVip(userId, { months: 1, role: 'vip' })
    } catch (e) {
      console.error('upgrade via coins failed', e)
      ok = false
    }
    if (!ok) {
      try { await db.creditWallet(userId, cost) } catch (ee) { console.error('refund err', ee) }
      return res.status(500).json({ error: 'upgrade_failed' })
    }
    try { await db.createPayment({ user_id: userId, amount: 0, coins: -cost, provider: 'coin', provider_ref: null, months: 1, days: null }) } catch (e) { console.error('createPayment err', e) }
    const updated = await db.getUserById(userId)
    return res.json({ success: true, wallet: debit, user: updated, cost_coins: cost })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /wallet/buy-author - spend coins to become author
app.post('/wallet/buy-author', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })

    const currentUser = await db.getUserById(userId)
    if (!currentUser) return res.status(404).json({ error: 'user not found' })

    let expectedCost = AUTHOR_COST_BASE
    let vipDaysLeft = 0

    if (currentUser.vip_until) {
      const vipUntilTime = new Date(currentUser.vip_until).getTime()
      const now = Date.now()
      if (vipUntilTime > now) {
        vipDaysLeft = Math.ceil((vipUntilTime - now) / (1000 * 60 * 60 * 24))
        if (vipDaysLeft >= MIN_VIP_DAYS_FOR_DISCOUNT) {
          expectedCost = AUTHOR_COST_VIP
        }
      }
    }

    const debit = await db.debitWallet(userId, expectedCost)
    if (debit && debit.error) {
      return res.status(400).json({
        error: 'insufficient_funds',
        balance: debit.balance,
        expected_cost: expectedCost,
        vip_days_left: vipDaysLeft
      })
    }
    let authorRowId = null
    let vipOk = false
    try {
      authorRowId = await db.promoteUserToAuthor(userId, { pen_name: null, bio: null })
      vipOk = await db.updateUserVip(userId, { role: 'author' })
    } catch (e) {
      console.error('promote author err', e)
    }
    const updated = await db.getUserById(userId)
    const roleNow = updated && String(updated.role || '').toLowerCase()
    if (!authorRowId || vipOk !== true || roleNow !== 'author') {
      try { await db.creditWallet(userId, expectedCost) } catch (ee) { console.error('refund err', ee) }
      if (roleNow === 'author' && String(currentUser.role || '').toLowerCase() !== 'author') {
        try { await db.updateUser(userId, { role: currentUser.role || 'user' }) } catch (ee) { console.error('revert author role err', ee) }
      }
      return res.status(500).json({ error: 'upgrade_failed' })
    }
    try { await db.createPayment({ user_id: userId, amount: 0, coins: -expectedCost, provider: 'coin', provider_ref: 'buy-author', months: 1, days: null }) } catch (e) { console.error('createPayment err', e) }
    return res.json({ success: true, wallet: debit, user: updated, cost_coins: expectedCost, vip_days_left: vipDaysLeft })
  } catch (err) {
    console.error('buy-author err', err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/gifts', (req, res) => {
  res.json(giftsCatalog.GIFTS)
})

app.get('/books/:id/gifts', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const storyId = req.params.id
    const book = await db.getBookById(storyId)
    if (!book) return res.status(404).json({ error: 'story not found' })
    const list = await db.getRecentStoryGifts(storyId, req.query.limit)
    res.json(list)
  } catch (err) {
    console.error('recent gifts err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Send a catalog gift. Price is server-side; the client cannot choose the coin amount.
app.post('/books/:id/donate', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const donorId = req.user && req.user.id
    if (!donorId) return res.status(401).json({ error: 'missing authorization', message: 'Đăng nhập để tặng quà.' })
    const storyId = req.params.id
    const { gift_code, quantity } = req.body || {}
    const gift = giftsCatalog.getGift(gift_code)
    if (!gift) return res.status(400).json({ error: 'unknown_gift', message: 'Quà không hợp lệ.' })
    const qty = Number(quantity == null ? 1 : quantity)
    if (!Number.isInteger(qty) || qty < giftsCatalog.MIN_QTY || qty > giftsCatalog.MAX_QTY) {
      return res.status(400).json({ error: 'invalid_quantity', message: 'Số lượng quà từ 1 đến 20.' })
    }
    const coins = gift.coins * qty
    const book = await db.getBookById(storyId)
    if (!book) return res.status(404).json({ error: 'story not found' })

    // resolve recipient user id: prefer linked author_user_id; otherwise only use author_id if it maps to a user
    let recipientUserId = book.author_user_id || null
    if (!recipientUserId && book.author_id) {
      try {
        const maybeUser = await db.getUserById(book.author_id)
        if (maybeUser && maybeUser.id) recipientUserId = String(maybeUser.id)
      } catch (e) { /* ignore */ }
    }

    if (!recipientUserId) return res.status(400).json({ error: 'story has no linked author user' })
    if (String(recipientUserId) === String(donorId)) return res.status(400).json({ error: 'cannot_donate_to_self' })

    // block donations to admin accounts
    try {
      const recipient = await db.getUserById(recipientUserId)
      if (recipient && String(recipient.role || '').toLowerCase() === 'admin') {
        return res.status(400).json({ error: 'recipient_not_allowed', message: 'Không thể tặng xu cho tài khoản admin.' })
      }
    } catch (e) { /* ignore */ }
    const transferred = await db.transferGift({
      donor_id: donorId,
      story_id: storyId,
      author_id: recipientUserId,
      coins,
      message: null,
      gift_code: gift.code,
      gift_name: gift.name,
      quantity: qty,
    })
    if (transferred && transferred.error) {
      return res.status(400).json({ error: 'insufficient_funds', balance: transferred.balance, message: 'Số xu không đủ để tặng quà này.' })
    }
    const donation = transferred && transferred.donation
    try { await db.createPayment({ user_id: donorId, amount: 0, coins: -coins, provider: 'donation', provider_ref: JSON.stringify({ donation_id: donation && donation.donation_id, gift_code: gift.code, quantity: qty }), months: null, days: null }) } catch (e) { console.error('createPayment err', e) }
    return res.json({
      success: true,
      donation,
      gift: { code: gift.code, name: gift.name, emoji: gift.emoji, coins: gift.coins, quantity: qty, total_coins: coins },
      donor_wallet: transferred.donor_wallet,
    })
  } catch (err) {
    console.error('donate err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Author application endpoints
// POST /author/apply - user applies to become an author
app.post('/author/apply', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const { pen_name, bio, samples } = req.body || {}
    if (!pen_name) return res.status(400).json({ error: 'pen_name required' })
    const app = await db.createAuthorApplication({ user_id: userId, pen_name, bio, samples })
    res.status(201).json(app)
  } catch (err) {
    console.error('author apply err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /author/applications - admin list all applications; user can list their own
app.get('/author/applications', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (req.user.role === 'admin') {
      const all = await db.getAuthorApplications()
      return res.json(all)
    }
    const mine = await db.getAuthorApplications(req.user.id)
    res.json(mine)
  } catch (err) {
    console.error('get author apps err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// PUT /author/applications/:id - admin approves/declines
app.put('/author/applications/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const { status, admin_note } = req.body || {}
    if (!status) return res.status(400).json({ error: 'status required' })
    const updated = await db.updateAuthorApplicationStatus(id, { status, admin_note })
    // if approved, promote user to author
    if (status === 'approved' && updated && updated.user_id) {
      try { await db.promoteUserToAuthor(updated.user_id, { pen_name: updated.pen_name, bio: updated.bio }) } catch (e) { console.error('promote err', e) }
    }
    res.json(updated)
  } catch (err) {
    console.error('update author app err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /authors/:id/donations - list donations for an author (author or admin)
app.get('/authors/:id/donations', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const authorId = req.params.id
    if (String(req.user.id) !== String(authorId) && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const list = await db.getDonationsByAuthor(authorId)
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /withdrawals - author requests withdrawal of coins
app.post('/withdrawals', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    // only authors (or admin) can request withdrawals
    if (!(req.user.role === 'author' || req.user.role === 'admin')) return res.status(403).json({ error: 'forbidden' })
    const { coins, method, details } = req.body || {}
    if (!coins || Number(coins) <= 0) return res.status(400).json({ error: 'coins required' })
    const reserved = await db.createWithdrawalReserved({ user_id: userId, coins: Number(coins), method: method || 'bank', details: details || null })
    if (reserved && reserved.error) return res.status(400).json({ error: 'insufficient_funds', balance: reserved.balance })
    return res.json({ success: true, withdrawal: reserved.withdrawal, wallet: reserved.wallet })
  } catch (err) {
    console.error('withdrawal err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /withdrawals - list withdrawals (admin sees all, user sees own)
app.get('/withdrawals', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (req.user.role === 'admin') {
      const all = await db.getWithdrawals()
      return res.json(all)
    }
    const list = await db.getWithdrawals(req.user.id)
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// PUT /withdrawals/:id - admin approves/declines/processes a withdrawal
app.put('/withdrawals/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const { status } = req.body || {}
    if (!status) return res.status(400).json({ error: 'status required' })
    const decided = await db.decideWithdrawal(id, { status })
    if (decided && decided.error === 'not_found') return res.status(404).json({ error: 'not found' })
    if (decided && decided.error === 'already_processed') return res.status(409).json({ error: 'already_processed' })
    const updated = decided && decided.withdrawal
    if (updated && (status === 'processed' || status === 'approved')) {
      try { await db.createPayment({ user_id: updated.user_id, amount: 0, coins: -Number(updated.coins || 0), provider: 'payout', provider_ref: JSON.stringify({ withdrawal_id: id }), months: null, days: null }) } catch (e) { console.error('createPayment err', e) }
    }
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Optional: provider webhook (public) that can be used by payment provider to notify server
app.post('/payments/webhook', async (req, res) => {
  try {
    const configured = String(process.env.PAYMENT_WEBHOOK_SECRET || '').trim()
    const provided = String((req.body && req.body.secret) || req.headers['x-webhook-secret'] || '')
    if (!configured || configured !== provided) {
      return res.status(403).json({ error: 'invalid secret' })
    }
    const { user_id, amount, provider, provider_ref, months, days } = req.body || {}
    if (!user_id) return res.status(400).json({ error: 'user_id required' })
    const payment = await db.createPayment({ user_id, amount: amount || 0, provider: provider || null, provider_ref: provider_ref || null, months: months || null, days: days || null })
    if (months || days) {
      try {
        await db.updateUserVip(user_id, { months: months || undefined, days: days || undefined, role: 'vip' })
      } catch (e) { console.error('webhook upgrade err', e) }
    }
    return res.json({ success: true, payment })
  } catch (err) {
    console.error('payments webhook err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Chapters endpoints
function chapterMetadata(chapter) {
  return { id: String(chapter.id || chapter.chapter_id), chapter_no: chapter.chapter_no,
    title: chapter.title, status: chapter.status, created_at: chapter.created_at }
}

app.get('/books/:id/chapters', async (req, res) => {
  try {
    if (useMysql) {
      const book = await db.getVisibleBookById(req.params.id)
      if (!book) return res.status(404).json({ error: 'not found' })
      let chapters = await db.getChaptersByBook(req.params.id)
      const user = await getUserFromAuthHeader(req)
      let role = user && user.role ? String(user.role).toLowerCase() : 'guest'
      if (user && user.id) {
        try {
          const fresh = await db.getUserById(user.id)
          if (fresh && fresh.role) role = String(fresh.role).toLowerCase()
        } catch (e) {}
      }

      let isAuthorOwner = false
      if (user && user.id) {
        try {
          const bookOwnerId = book?.author_user_id || book?.user_id
          if (bookOwnerId && String(bookOwnerId) === String(user.id)) {
            isAuthorOwner = true
          }
        } catch (e) {}
      }

      if (role !== 'admin' && !isAuthorOwner) {
        chapters = (chapters || []).filter(c => c.status === 'published').map(chapterMetadata)
      }

      return res.json(chapters)
    }
    const data = readData();
    const book = data.books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'not found' });
    const user = await getUserFromAuthHeader(req)
    const canSeePending = canEditFileBook(book, user)
    const chapters = Array.isArray(book.chapters) ? book.chapters : []
    return res.json(canSeePending ? chapters : chapters.filter(c => !c.status || c.status === 'published'))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/books/:bookId/chapters/:chapterId', async (req, res) => {
  try {
    if (!useMysql) {
      // file-mode: return chapter content and increment story views
      const data = readData()
      const book = (data.books || []).find(b => String(b.id) === String(req.params.bookId))
      if (!book) return res.status(404).json({ error: 'not found' })
      const chapters = Array.isArray(book.chapters) ? book.chapters : []
      const raw = String(req.params.chapterId)
      const maybeNum = Number(raw)

      let chapter = null
      let chapterNo = 0
      if (!isNaN(maybeNum) && Number.isFinite(maybeNum) && maybeNum >= 1) {
        chapterNo = maybeNum
        chapter = chapters[maybeNum - 1] || null
      } else {
        chapter = chapters.find(c => String(c.id) === raw) || null
        if (chapter) {
          const idx = chapters.indexOf(chapter)
          chapterNo = idx >= 0 ? idx + 1 : 0
        }
      }

      if (!chapter) return res.status(404).json({ error: 'not found' })
      if (chapter.status && chapter.status !== 'published') {
        const user = await getUserFromAuthHeader(req)
        if (!canEditFileBook(book, user)) return res.status(403).json({ error: 'chapter_pending_moderation', status: chapter.status })
      }

      // increment views
      book.views = Number(book.views || 0) + 1
      writeData(data)

      return res.json(chapterForReader({
        id: String(chapter.id || raw),
        chapter_no: chapter.chapter_no || chapter.chapterNo || chapterNo || null,
        title: chapter.title || (chapterNo ? `Chương ${chapterNo}` : 'Chương'),
        content: chapter.content || chapter.body || chapter.text || '',
        content_format: chapter.content_format || 'plain_text',
        ad_required: false,
      }))
    }
    // optional auth: guests may access up to 3 chapters
    const visibleStory = await db.getVisibleBookById(req.params.bookId)
    if (!visibleStory) return res.status(404).json({ error: 'not found' })
    const user = await getUserFromAuthHeader(req)
    let foundBy = null
    const byNumber = req.query.by === 'number'
    if (byNumber && !/^[1-9]\d*$/.test(req.params.chapterId)) return res.status(400).json({ error: 'invalid_chapter_number' })
    let chapter = byNumber ? await db.getChapterByNumber(req.params.bookId, Number(req.params.chapterId)) : await db.getChapterById(req.params.bookId, req.params.chapterId)
    if (chapter) foundBy = 'id'
    // If not found by primary chapter_id, try treating the param as a chapter number (chapter_no)
    if (!chapter && !byNumber) {
      const maybeNum = Number(req.params.chapterId)
      if (!isNaN(maybeNum)) {
        try {
          chapter = await db.getChapterByNumber(req.params.bookId, maybeNum)
          if (chapter) foundBy = 'number'
        } catch (e) {
          console.error('fallback getChapterByNumber err', e)
        }
      }
    }
    // debug log to help troubleshoot missing content
    try {
      console.log(`[GET chapter] book=${req.params.bookId} param=${req.params.chapterId} foundBy=${foundBy} chapterId=${chapter && chapter.id ? chapter.id : 'null'} chapterNo=${chapter && chapter.chapter_no ? chapter.chapter_no : 'null'} title=${chapter && chapter.title ? chapter.title : 'null'} contentLen=${chapter && chapter.content ? String((chapter.content || '').length) : '0'}`)
    } catch (e) { /* ignore logging errors */ }
    if (!chapter) return res.status(404).json({ error: 'not found' })
    const chapterNo = chapter.chapter_no || chapter.chapterNo || 0
    // Refresh role from DB so newly upgraded VIP/author users bypass limits immediately without re-login
    let role = user && user.role ? String(user.role).toLowerCase() : 'guest'
    if (useMysql && user && user.id) {
      try {
        const fresh = await db.getUserById(user.id)
        if (fresh && fresh.role) role = String(fresh.role).toLowerCase()
        // attach fresh info for downstream if needed
        req.user = Object.assign({}, user, fresh || {})
      } catch (e) {
        console.error('refresh user role err', e)
      }
    }

    let isAuthorOwner = false
    if (user && user.id) {
      const bookOwnerId = visibleStory.author_user_id || visibleStory.user_id
      if (bookOwnerId && String(bookOwnerId) === String(user.id)) isAuthorOwner = true
    }

    // Check moderation status: only the book owner or admin can view pending_review / rejected chapters
    if (useMysql && chapter.status && chapter.status !== 'published') {
      if (role !== 'admin' && !isAuthorOwner) {
        return res.status(403).json({
          error: 'chapter_pending_moderation',
          status: chapter.status,
          message: chapter.status === 'rejected'
            ? 'Chương này đã bị từ chối xuất bản do vi phạm tiêu chuẩn cộng đồng.'
            : 'Chương này đang trong hàng chờ duyệt của Quản trị viên (Human-in-the-loop).'
        })
      }
    }

    const privileged = role === 'vip' || role === 'author' || role === 'admin' || isAuthorOwner
    const freeCount = Math.max(0, Number(visibleStory.free_chapters != null ? visibleStory.free_chapters : 3) || 0)
    const chapterNumber = Number(chapter.chapter_no || chapter.chapterNo || 0)
    if (!privileged && chapterNumber > freeCount) {
      return res.status(403).json({
        error: 'chapter_locked',
        message: `Chương này cần VIP. ${freeCount} chương đầu được đọc miễn phí.`,
        free_chapters: freeCount,
      })
    }

    if (!privileged && (role === 'guest' || role === 'user')) {
      const guestLimit = Number(process.env.GUEST_DAILY_LIMIT || 3)
      const limit = role === 'guest' ? guestLimit : 10
      const viewerId = role === 'guest' ? `visitor:${String(req.ip || 'unknown')}` : String(user.id)
      let reserved
      try {
        reserved = await db.reserveChapterRead({
          userId: viewerId,
          bookId: req.params.bookId,
          chapterId: String(chapter.id),
          limit,
        })
      } catch (e) {
        console.error('reserve chapter read err', e)
        return res.status(500).json({ error: 'internal' })
      }
      if (!reserved || reserved.error === 'busy') {
        return res.status(503).json({ error: 'busy', message: 'Hệ thống đang bận. Thử lại sau.' })
      }
      if (reserved.error === 'limit') {
        if (role === 'guest') {
          return res.status(429).json({ error: 'guest_limit_reached', message: `Guests can read ${guestLimit} chapters per day`, allowed_chapters: guestLimit, ad_required: true })
        }
        return res.status(429).json({ error: 'limit_reached', message: 'Daily limit of 10 chapters reached' })
      }
      return res.json(Object.assign(chapterForReader(chapter), { ad_required: true }))
    }

    // VIP, author, admin, and the book owner skip the paywall and the daily cap.
    try {
      const uid = user && user.id ? String(user.id) : 'unknown'
      await db.recordChapterView(uid, req.params.bookId, String(chapter.id))
    } catch (e) {
      console.error('record privileged view err', e)
    }
    return res.json(Object.assign(chapterForReader(chapter), { ad_required: false }))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Bookmarks
app.post('/bookmarks', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const { book_id, chapter_id, position, note } = req.body
    if (!book_id) return res.status(400).json({ error: 'book_id required' })
    const bm = await db.createBookmark({ user_id: userId, book_id, chapter_id, position, note })
    res.status(201).json(bm)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/users/:userId/bookmarks', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId
    if (req.user.id !== userId && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const bms = await db.getBookmarksByUser(userId)
    res.json(bms)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

async function sendUserProgress(req, res, userId) {
  if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
  const bookId = req.query.book_id
  if (bookId) {
    const row = await db.getProgressByUserBook(userId, bookId)
    return res.json(row || {})
  }
  const rows = await db.getProgressByUser(userId)
  return res.json(rows)
}

// Reading progress (current user)
app.post('/progress', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const { book_id, chapter_id, chapter_no, progress } = req.body || {}
    if (!book_id) return res.status(400).json({ error: 'book_id required' })
    const row = await db.upsertProgress({ user_id: userId, book_id, chapter_id, chapter_no, progress })
    res.json(row)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/progress', authMiddleware, async (req, res) => {
  try {
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    await sendUserProgress(req, res, userId)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/users/:userId/progress', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId
    if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    await sendUserProgress(req, res, userId)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

const PORT = process.env.PORT || 4000;
if (isProductionEnv()) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev_secret_change_me') {
    console.error('[boot] JWT_SECRET must be set to a strong value in production')
    process.exit(1)
  }
  if (!String(process.env.PAYMENT_WEBHOOK_SECRET || '').trim()) {
    console.error('[boot] PAYMENT_WEBHOOK_SECRET is required in production')
    process.exit(1)
  }
}
// show a quick debug summary on start
console.log(`Server starting on port ${PORT} (USE_MYSQL=${useMysql})`)
if (process.env.JWT_SECRET) console.log(`JWT_SECRET set (${String(process.env.JWT_SECRET).length} chars)`)

// Debug helper: allow generating a signed admin token when ALLOW_DEV_TOKENS=true
if (process.env.ALLOW_DEV_TOKENS === 'true') {
  app.post('/debug/token', (req, res) => {
    try {
      const { email, role, id } = req.body || {}
      const payload = { id: String(id || 'dev_admin'), email: email || 'dev@local', role: role || 'admin' }
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' })
      return res.json({ token, payload })
    } catch (err) {
      console.error('debug token err', err)
      return res.status(500).json({ error: 'internal' })
    }
  })
  console.log('Debug token endpoint enabled at POST /debug/token (ALLOW_DEV_TOKENS=true)')
}

// Update current user's avatar (user/vip/author/admin)
app.post('/me/avatar', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const { avatar_url } = req.body || {}
    if (!avatar_url || typeof avatar_url !== 'string') return res.status(400).json({ error: 'avatar_url required' })
    let stored = avatar_url
    if (avatar_url.startsWith('data:')) {
      const saved = saveDataUrlToAvatar(avatar_url)
      if (!saved) return res.status(400).json({ error: 'invalid_image' })
      stored = saved
    }
    if (stored.length > 500) return res.status(400).json({ error: 'avatar_url too long' })
    const ok = await db.updateUserAvatar(userId, stored)
    if (!ok) return res.status(500).json({ error: 'update_failed' })
    const updated = await db.getUserById(userId)
    if (updated && updated.avatar_url && updated.avatar_url.startsWith('/')) {
      updated.avatar_url = `${req.protocol}://${req.get('host')}${updated.avatar_url}`
    }
    return res.json(updated)
  } catch (err) {
    console.error('POST /me/avatar err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Change current user's password
app.post('/me/password', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })

    const { old_password, new_password } = req.body || {}
    if (!old_password || !new_password) return res.status(400).json({ error: 'old_password and new_password required' })
    if (typeof old_password !== 'string' || typeof new_password !== 'string') return res.status(400).json({ error: 'invalid payload' })
    if (new_password.length < 6) return res.status(400).json({ error: 'weak_password', message: 'Mật khẩu mới phải có ít nhất 6 ký tự.' })

    const currentHash = await db.getUserPasswordHashById(userId)
    if (!currentHash) return res.status(400).json({ error: 'no_password_set' })

    const ok = await bcrypt.compare(old_password, currentHash)
    if (!ok) return res.status(400).json({ error: 'invalid_old_password', message: 'Mật khẩu hiện tại không đúng.' })

    const nextHash = await bcrypt.hash(new_password, 10)
    const updated = await db.updateUserPasswordHash(userId, nextHash)
    if (!updated) return res.status(500).json({ error: 'update_failed' })
    return res.json({ success: true })
  } catch (err) {
    console.error('POST /me/password err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Admin: update any user's avatar
app.post('/users/:id/avatar', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const targetUserId = req.params.id
    const { avatar_url } = req.body || {}
    if (!avatar_url || typeof avatar_url !== 'string') return res.status(400).json({ error: 'avatar_url required' })
    let stored = avatar_url
    if (avatar_url.startsWith('data:')) {
      const saved = saveDataUrlToAvatar(avatar_url)
      if (!saved) return res.status(400).json({ error: 'invalid_image' })
      stored = saved
    }
    if (stored.length > 500) return res.status(400).json({ error: 'avatar_url too long' })
    const ok = await db.updateUserAvatar(targetUserId, stored)
    if (!ok) return res.status(500).json({ error: 'update_failed' })
    const updated = await db.getUserById(targetUserId)
    if (updated && updated.avatar_url && updated.avatar_url.startsWith('/')) {
      updated.avatar_url = `${req.protocol}://${req.get('host')}${updated.avatar_url}`
    }
    return res.json(updated)
  } catch (err) {
    console.error('POST /users/:id/avatar err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// ==================== AI CHATBOT ====================
async function enforceAiQuota(req, res, scope, limit, userId = req.user?.id) {
  await aiReady
  const ip = req.ip || 'unknown'
  const allowedIp = await db.consumeAiQuota(scope + '-ip', ip, userId ? limit * 4 : limit, 900000)
  if (!allowedIp) {
    res.status(429).json({ error: 'rate_limited', message: 'Đã đạt giới hạn yêu cầu. Thử lại sau.' })
    return false
  }
  const allowedUser = !userId || await db.consumeAiQuota(scope + '-user', String(userId), limit, 900000)
  if (!allowedUser) {
    res.status(429).json({ error: 'rate_limited', message: 'Đã đạt giới hạn yêu cầu. Thử lại sau.' })
    return false
  }
  return true
}

app.get('/moderation/ai-usage', authMiddleware, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    await aiReady
    res.json({ period_days: 30, usage: await db.getAiUsageStats() })
  } catch (e) { res.status(503).json({ error: 'ai_usage_unavailable' }) }
})

function readerIdFromAuth(req) {
  const auth = req.headers.authorization
  if (!auth || !String(auth).startsWith('Bearer ')) return null
  try {
    const payload = jwt.verify(String(auth).split(' ')[1], JWT_SECRET)
    return payload && payload.id ? String(payload.id) : null
  } catch (e) {
    return null
  }
}

app.get('/chat/conversations', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = readerIdFromAuth(req)
    if (!userId) return res.status(401).json({ error: 'login_required', message: 'Đăng nhập để xem lịch sử chat.' })
    const conversations = await db.listConversations(userId)
    return res.json({ conversations })
  } catch (err) {
    console.error('GET /chat/conversations err', err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/chat/conversations/:id/messages', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = readerIdFromAuth(req)
    if (!userId) return res.status(401).json({ error: 'login_required', message: 'Đăng nhập để xem lịch sử chat.' })
    const id = String(req.params.id || '')
    if (!/^[1-9]\d{0,18}$/.test(id)) return res.status(400).json({ error: 'invalid_conversation' })
    const owned = await db.getConversationForReader(id, userId)
    if (!owned) return res.status(404).json({ error: 'conversation_not_found' })
    const messages = await db.listMessages(id, 40)
    return res.json({ messages })
  } catch (err) {
    console.error('GET /chat/conversations/:id/messages err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /chat - recommend books or recap previous chapters
app.post('/chat', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const ip = String(req.ip || 'unknown')
    let userId = null
    const auth = req.headers.authorization
    if (auth && String(auth).startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(auth.split(' ')[1], JWT_SECRET)
        userId = payload && payload.id ? String(payload.id) : null
      } catch (e) { }
    }
    if (!await enforceAiQuota(req, res, 'chat', 30, userId)) return
    const result = await aiRuntime.withContext({ userId }, () => chatAgent.handleChatRequest({
      db, userId, readerKey: userId || ('visitor:' + ip), body: req.body || {}
    }))
    return res.status(result.status || 200).json(result.payload)
  } catch (err) {
    console.error('POST /chat err', err)
    res.status(500).json({ error: 'internal', message: 'Agent chưa trả lời được. Thử lại sau.' })
  }
})

const aiReady = useMysql ? installAiSchemaPromise() : Promise.resolve()
async function installAiSchemaPromise() {
  const pool = await db.initPool()
  await installAiSchema(pool)
  aiRuntime.configure(db)
  if (process.env.AI_WORKER_ENABLED !== 'false') integrity.startCommentWorker({ db, complete: chatAgent.chatCompletion })
}
aiReady.catch(e => console.error('[ai-schema]', e.code || 'migration_failed'))

const server = app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`)
  if (isSepayLocal()) {
    console.log(`[SePay local] Webhook http://127.0.0.1:${PORT}/sepay/webhook`)
    console.log('[SePay local] Header Authorization: Apikey ' + sepayLocalApiKey())
    console.log('[SePay local] App dùng nút xác nhận trên QR để cộng xu, không gọi ngân hàng.')
  }
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n[server] Port ${PORT} is already in use.`)
    console.error('[server] Close the other process using this port, or start this server on a different port.')
    console.error('[server] Tip (Windows): run `Get-NetTCPConnection -LocalPort 4000 | Select OwningProcess` then `Stop-Process -Id <pid> -Force`')
    console.error('[server] Or set PORT in admin-dashboard/server/.env, e.g. PORT=4001')
    process.exit(1)
  }
  console.error('\n[server] listen error:', err)
  process.exit(1)
})
