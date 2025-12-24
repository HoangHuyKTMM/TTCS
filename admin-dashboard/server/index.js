require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const shortid = require('shortid');

const useMysql = (process.env.USE_MYSQL || 'false').toLowerCase() === 'true'

const app = express();
console.log('GROK_API_KEY loaded:', process.env.GROK_API_KEY ? 'YES (starts with ' + process.env.GROK_API_KEY.substring(0, 10) + '...)' : 'NO');
app.use(cors());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
// increase JSON body size to allow JSON-based base64 uploads for covers
app.use(express.json({ limit: '20mb' }));

// allow clients that send raw JSON without Content-Type header (e.g. Postman raw body without header)
// We'll capture plain text bodies (but skip multipart) and attempt to JSON.parse when appropriate.
app.use(express.text({
  type: (req) => {
    const ct = req.headers['content-type'] || ''
    if (!ct) return true // no content-type -> try to capture raw
    if (ct.indexOf('multipart/form-data') !== -1) return false
    if (ct.indexOf('application/json') !== -1) return false
    // parse text/* and other types that are not multipart
    return ct.startsWith('text/') || false
  },
  // increase text body limit as well to handle larger payloads
  limit: '20mb'
}))

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
const upload = multer({ storage })
// separate storage for banners
const bannerStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, bannersDir) },
  filename: function (req, file, cb) {
    const ext = file.originalname.split('.').pop()
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    cb(null, name)
  }
})
const bannerUpload = multer({ storage: bannerStorage })

const DATA_PATH = path.join(__dirname, 'data.json');

// Save base64 avatar to disk, return relative URL
function saveDataUrlToAvatar(dataUrl) {
  try {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || '')
    if (!match) return null
    const mime = match[1]
    const base64 = match[2]
    const buf = Buffer.from(base64, 'base64')
    // limit avatar size to 4MB
    if (!buf || buf.length === 0 || buf.length > 4 * 1024 * 1024) return null
    let ext = 'jpg'
    if (mime === 'image/png') ext = 'png'
    else if (mime === 'image/webp') ext = 'webp'
    else if (mime === 'image/jpeg' || mime === 'image/jpg') ext = 'jpg'
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

// Save data URL (base64) image to covers folder and return relative URL; returns null on failure
function saveDataUrlToCover(dataUrl) {
  try {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || '')
    if (!match) return null
    const mime = match[1]
    const base64 = match[2]
    const buf = Buffer.from(base64, 'base64')
    // limit to 8MB to avoid abuse
    if (!buf || buf.length === 0 || buf.length > 8 * 1024 * 1024) return null
    let ext = 'jpg'
    if (mime === 'image/png') ext = 'png'
    else if (mime === 'image/webp') ext = 'webp'
    else if (mime === 'image/jpeg' || mime === 'image/jpg') ext = 'jpg'
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const full = path.join(coversDir, name)
    fs.writeFileSync(full, buf)
    return `/covers/${name}`
  } catch (e) {
    console.error('saveDataUrlToCover err', e)
    return null
  }
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
      const rows = await db.getBooks({ userId: currentUserId, mineOnly })
      console.log('[GET /books] Got', rows.length, 'rows')

      if (!rows) {
        console.log('[GET /books] No rows returned')
        return res.json([])
      }

      // map chapters_count to chapters array length for compatibility, include genre
      const books = []
      for (const r of rows) {
        try {
          const book = {
            id: String(r.id || r.story_id),
            title: r.title,
            author: r.author || r.author_id,
            author_id: r.author_id ? String(r.author_id) : null,
            author_user_id: r.author_user_id ? String(r.author_user_id) : null,
            description: r.description,
            genre: r.genre,
            chapters: new Array(parseInt(r.chapters_count) || 0),
            cover_url: r.cover_url ? `${req.protocol}://${req.get('host')}${r.cover_url}` : null
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
    res.json(data.books);
  } catch (err) {
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

// Subscribe user to VIP (user self or admin)
app.post('/users/:id/vip', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id
    // only allow the user themselves or admin to perform vip upgrade
    if (!req.user) return res.status(401).json({ error: 'missing authorization' })
    if (String(req.user.id) !== String(id) && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })

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
app.post('/books', async (req, res) => {
  try {
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
      // require admin or author auth (or allow dev bypass)
      const headerBypass = String(req.headers['x-bypass-auth'] || req.headers['x-dev-token'] || '').toLowerCase() === 'true'
      const localReq = (req.hostname === 'localhost') || (req.ip === '::1') || (req.ip && req.ip.startsWith('127.')) || ((req.get && req.get('host') || '').startsWith('localhost'))
      const bypass = headerBypass && (process.env.ALLOW_DEV_TOKENS === 'true' || localReq)
      let payload = null
      if (!bypass) {
        const auth = req.headers.authorization
        if (!auth) return res.status(401).json({ error: 'missing authorization' })
        const parts = auth.split(' ')
        if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'invalid authorization format' })
        const token = parts[1]
        try {
          payload = require('jsonwebtoken').verify(token, JWT_SECRET)
          // Always trust latest role from DB (token may be stale after upgrade)
          let effectiveRole = payload && payload.role
          if (payload && payload.id) {
            try {
              const fresh = await db.getUserById(payload.id)
              if (fresh && fresh.role) effectiveRole = fresh.role
            } catch (err) {
              console.error('refresh role failed', err)
            }
          }
          if (!effectiveRole || (effectiveRole !== 'admin' && effectiveRole !== 'author')) return res.status(403).json({ error: 'forbidden' })
          payload.role = effectiveRole
        } catch (e) {
          console.error('auth verify failed', e)
          return res.status(401).json({ error: 'invalid token' })
        }
      }
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
    const book = { id, title, author: author || null, description: description || null, chapters: [] }
    if (cover_url) book.cover_url = cover_url
    if (genre) book.genre = genre
    data.books.unshift(book)
    writeData(data)
    return res.status(201).json(book)
  } catch (err) {
    console.error('POST /books err', err)
    res.status(500).json({ error: err && err.message ? err.message : 'internal' })
  }
})

// POST /books/upload (multipart) - supports file upload for clients that need it
app.post('/books/upload', upload.single('cover'), async (req, res) => {
  try {
    const { title, author, description } = req.body || {}
    if (!title) return res.status(400).json({ error: 'title required' })
    if (useMysql) {
      const headerBypass = String(req.headers['x-bypass-auth'] || req.headers['x-dev-token'] || '').toLowerCase() === 'true'
      const localReq = (req.hostname === 'localhost') || (req.ip === '::1') || (req.ip && req.ip.startsWith('127.')) || ((req.get && req.get('host') || '').startsWith('localhost'))
      const bypass = headerBypass && (process.env.ALLOW_DEV_TOKENS === 'true' || localReq)
      if (!bypass) {
        const auth = req.headers.authorization
        if (!auth) return res.status(401).json({ error: 'missing authorization' })
        const parts = auth.split(' ')
        if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'invalid authorization format' })
        const token = parts[1]
        try {
          const payload = require('jsonwebtoken').verify(token, JWT_SECRET)
          if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
        } catch (e) { console.error('auth verify failed', e); return res.status(401).json({ error: 'invalid token' }) }
      }
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

// POST /banners (admin) - supports multipart/form-data with field 'banner'
app.post('/banners', authMiddleware, bannerUpload.single('banner'), async (req, res) => {
  try {
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
app.put('/banners/:id', authMiddleware, bannerUpload.single('banner'), async (req, res) => {
  try {
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
function getUserFromAuthHeader(req) {
  const auth = req.headers.authorization
  if (!auth) return null
  const parts = auth.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  const token = parts[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    return payload
  } catch (e) { return null }
}

// GET /books/:id
app.get('/books/:id', async (req, res) => {
  try {
    const user = getUserFromAuthHeader(req)
    if (useMysql) {
      const book = await db.getBookById(req.params.id)
      if (!book) return res.status(404).json({ error: 'not found' })
      // normalize id
      book.id = String(book.id)
      if (book.cover_url && book.cover_url.startsWith('/')) {
        book.cover_url = `${req.protocol}://${req.get('host')}${book.cover_url}`
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

// POST /books/:id/chapters { title, content } - author/admin only
app.post('/books/:id/chapters', authMiddleware, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content required' });
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
        const isLegacyMatch = ownerAuthorId && String(req.user.id) === ownerAuthorId // legacy schemas storing user_id in author_id
        if (!isOwnerByUser && !isOwnerByAuthor && !isLegacyMatch) {
          return res.status(403).json({ error: 'not your story' })
        }
      }
      const chapter = await db.createChapter(req.params.id, { title, content })
      chapter.id = String(chapter.id)
      return res.status(201).json(chapter)
    }
    // file-mode fallback (dev only)
    const data = readData();
    const book = data.books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'book not found' });
    const chapter = {
      id: shortid.generate(),
      title,
      content,
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
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me'

async function authMiddleware(req, res, next) {
  // Dev bypass: allow header 'x-bypass-auth: true' to act as admin when ALLOW_DEV_TOKENS=true
  // or when the request originates from localhost (makes local dev easier)
  const _hdr = String(req.headers['x-bypass-auth'] || req.headers['x-dev-token'] || '').toLowerCase() === 'true'
  const _local = (req.hostname === 'localhost') || (req.ip === '::1') || (req.ip && req.ip.startsWith('127.')) || ((req.get && req.get('host') || '').startsWith('localhost'))
  if (_hdr && (process.env.ALLOW_DEV_TOKENS === 'true' || _local)) {
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
        if (fresh && fresh.role) req.user.role = fresh.role
      } catch (err) {
        console.error('authMiddleware refresh role err', err)
      }
    }
    next()
  } catch (err) {
    return res.status(401).json({ error: 'invalid token' })
  }
}

// Auth endpoints
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body
    if (!email || !password) return res.status(400).json({ error: 'email & password required' })
    if (!useMysql) return res.status(400).json({ error: 'register requires MySQL mode' })
    const existing = await db.getUserByEmail(email)
    if (existing) return res.status(400).json({ error: 'email exists' })
    const hash = await bcrypt.hash(password, 10)
    const user = await db.createUser({ email, password_hash: hash, name, role: 'user' })
    res.status(201).json(user)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// PUT /books/:bookId/chapters/:chapterId - admin edit chapter
app.put('/books/:bookId/chapters/:chapterId', authMiddleware, async (req, res) => {
  try {
    const id = req.params.chapterId
    const { title, content } = req.body
    if (useMysql) {
      if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
      const updated = await db.updateChapter(id, { title, content })
      if (!updated) return res.status(404).json({ error: 'not found' })
      return res.json(updated)
    }
    // file-mode: update chapter in data.json
    const data = readData()
    const book = data.books.find(b => b.id === req.params.bookId)
    if (!book) return res.status(404).json({ error: 'book not found' })
    const ch = (book.chapters || []).find(c => String(c.id) === String(id))
    if (!ch) return res.status(404).json({ error: 'chapter not found' })
    if (title !== undefined) ch.title = title
    if (content !== undefined) ch.content = content
    writeData(data)
    return res.json(ch)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /books/:bookId/chapters/:chapterId - admin delete chapter
app.delete('/books/:bookId/chapters/:chapterId', authMiddleware, async (req, res) => {
  try {
    const id = req.params.chapterId
    console.log(`[DELETE] /books/${req.params.bookId}/chapters/${id} useMysql=${useMysql} user=${req.user && req.user.email ? req.user.email : req.user && req.user.id ? req.user.id : 'unknown'}`)
    if (useMysql) {
      if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
      try {
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
    const book = data.books.find(b => b.id === req.params.bookId)
    if (!book) return res.status(404).json({ error: 'book not found' })
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
// POST /books/:id/comments - authenticated users
app.post('/books/:id/comments', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const bookId = req.params.id
    const { content, parent_id } = req.body
    if (!content) return res.status(400).json({ error: 'content required' })
    const comment = await db.createComment(bookId, { user_id: userId, content, parent_id })
    res.status(201).json(comment)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /books/:id/comments - public list
app.get('/books/:id/comments', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const bookId = req.params.id
    const list = await db.getComments(bookId, { status: 'approved' })
    res.json(list)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
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
    const updated = await db.updateComment(id, { status: 'rejected', reviewed_by: req.user.id, content: req.body && req.body.content ? req.body.content : undefined })
    if (reason) updated.admin_reason = reason
    if (!updated) return res.status(404).json({ error: 'not found' })
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
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const result = await db.deleteComment(id)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Likes
// POST /books/:id/like - like a story
app.post('/books/:id/like', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const bookId = req.params.id
    const row = await db.createLike(userId, bookId)
    res.status(201).json(row)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// DELETE /books/:id/like - remove like
app.delete('/books/:id/like', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const bookId = req.params.id
    const row = await db.deleteLike(userId, bookId)
    res.json(row)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// GET /books/:id/likes - public count
app.get('/books/:id/likes', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const bookId = req.params.id
    const user = getUserFromAuthHeader(req)
    const [cnt, liked] = await Promise.all([
      db.getLikesCount(bookId),
      user ? db.hasUserLiked(user.id, bookId) : false
    ])
    res.json({ count: cnt, liked: !!liked })
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

// Follows
// POST /follows { followee_id } - authenticated user follows someone
app.post('/follows', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const followerId = req.user.id
    const { followee_id } = req.body
    if (!followee_id) return res.status(400).json({ error: 'followee_id required' })
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
    const p = await require('./mysql').initPool()
    const [rows] = await p.execute('SELECT follower_id FROM follows WHERE follow_id = ?', [id])
    if (!rows || !rows[0]) return res.status(404).json({ error: 'not found' })
    if (String(rows[0].follower_id) !== String(req.user.id)) return res.status(403).json({ error: 'forbidden' })
    const result = await db.deleteFollow(id)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// Update book (admin only) - accepts JSON { title, author, description, cover_url, genre }
app.put('/books/:id', async (req, res) => {
  try {
    const id = req.params.id
    const { title, author, description, genre } = req.body || {}
    console.log('[PUT /books/:id] Received body:', JSON.stringify(req.body, null, 2))
    console.log('[PUT /books/:id] Extracted genre:', genre)
    const cover_url = req.body ? (req.body.cover_url || req.body.coverUrl || req.body.coverUrl) : undefined
    // If using MySQL, require admin auth and use db.updateBook
    if (useMysql) {
      const headerBypass = String(req.headers['x-bypass-auth'] || req.headers['x-dev-token'] || '').toLowerCase() === 'true'
      const localReq = (req.hostname === 'localhost') || (req.ip === '::1') || (req.ip && req.ip.startsWith('127.')) || ((req.get && req.get('host') || '').startsWith('localhost'))
      const bypass = headerBypass && (process.env.ALLOW_DEV_TOKENS === 'true' || localReq)
      if (!bypass) {
        const auth = req.headers.authorization
        if (!auth) return res.status(401).json({ error: 'missing authorization' })
        const parts = auth.split(' ')
        if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'invalid authorization format' })
        const token = parts[1]
        try {
          const payload = require('jsonwebtoken').verify(token, JWT_SECRET)
          if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
          console.log(`[PUT] /books/${id} by user=${payload.email || payload.id || 'unknown'}`)
        } catch (e) {
          console.error('auth verify failed', e)
          return res.status(401).json({ error: 'invalid token' })
        }
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
app.post('/books/:id/upload', upload.single('cover'), async (req, res) => {
  try {
    const id = req.params.id
    if (useMysql) {
      const auth = req.headers.authorization
      if (!auth) return res.status(401).json({ error: 'missing authorization' })
      const parts = auth.split(' ')
      if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'invalid authorization format' })
      const token = parts[1]
      try {
        const payload = require('jsonwebtoken').verify(token, JWT_SECRET)
        if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
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
app.post('/uploads/cover-json', async (req, res) => {
  try {
    const { filename, data } = req.body || {}
    if (!filename || !data) return res.status(400).json({ error: 'filename and data (base64) required' })
    // sanitize filename a bit
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename.replace(/[^a-zA-Z0-9.\-]/g, '')}`
    const outPath = path.join(coversDir, safeName)
    const buffer = Buffer.from(data, 'base64')
    fs.writeFileSync(outPath, buffer)
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
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
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

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'email & password required' })
    if (!useMysql) return res.status(400).json({ error: 'login requires MySQL mode' })
    const user = await db.getUserByEmail(email)
    if (!user) return res.status(400).json({ error: 'invalid credentials' })
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

// Payments: client notifies server of successful payment -> record and upgrade to VIP
app.post('/payments', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    const { amount, provider, provider_ref, months, days } = req.body || {}
    // record payment
    const payment = await db.createPayment({ user_id: userId, amount: amount || 0, provider: provider || null, provider_ref: provider_ref || null, months: months || null, days: days || null })
    // upgrade user to VIP based on months/days (or default 1 month)
    const m = months || (days ? undefined : 1)
    const d = days || undefined
    try {
      const ok = await db.updateUserVip(userId, { months: m, days: d, role: 'vip' })
      const updated = await db.getUserById(userId)
      return res.json({ success: true, payment, user: updated })
    } catch (e) {
      console.error('vip upgrade after payment failed', e)
      return res.status(500).json({ error: 'upgrade_failed', payment })
    }
  } catch (err) {
    console.error(err)
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
    try { await db.createPayment({ user_id: targetUserId, amount: amount || 0, provider: 'admin', provider_ref: note || 'admin-topup', months: null, days: null }) } catch (e) { console.error('admin createPayment err', e) }
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
    const { coins, amount, method, note, evidence_url, provider_ref } = req.body || {}
    if (!coins || Number(coins) <= 0) return res.status(400).json({ error: 'coins required' })
    const reqRow = await db.createTopupRequest({ user_id: userId, coins: Number(coins), amount: amount || null, method: method || 'manual', note, evidence_url, provider_ref })
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
    const existing = await db.getTopupRequestById(id)
    if (!existing) return res.status(404).json({ error: 'not found' })
    if (existing.status !== 'pending') return res.status(400).json({ error: 'already_processed', status: existing.status })
    const coins = req.body && req.body.coins ? Number(req.body.coins) : Number(existing.coins || 0)
    const admin_note = req.body && req.body.admin_note ? req.body.admin_note : null
    const updated = await db.setTopupRequestStatus(id, { status: 'approved', admin_id: req.user.id, admin_note, coins })
    const wallet = await db.creditWallet(existing.user_id, coins)
    try { await db.createPayment({ user_id: existing.user_id, amount: existing.amount || 0, provider: existing.method || 'manual', provider_ref: existing.provider_ref || `topup#${id}`, months: null, days: null }) } catch (e) { console.error('record payment err', e) }
    res.json({ success: true, request: updated, wallet })
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
    if (existing.status !== 'pending') return res.status(400).json({ error: 'already_processed', status: existing.status })
    const admin_note = req.body && req.body.admin_note ? req.body.admin_note : null
    const updated = await db.setTopupRequestStatus(id, { status: 'rejected', admin_id: req.user.id, admin_note })
    res.json({ success: true, request: updated })
  } catch (err) {
    console.error('reject topup err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /wallet/topup - credit coins to wallet (client-side: after successful bank payment, or admin credit)
app.post('/wallet/topup', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    const { coins, amount, provider, provider_ref } = req.body || {}
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    if (!coins || Number(coins) <= 0) return res.status(400).json({ error: 'coins required' })
    // record payment (coins purchase) if amount/provider provided
    if (amount || provider) {
      try { await db.createPayment({ user_id: userId, amount: amount || 0, provider: provider || 'bank', provider_ref: provider_ref || null, months: null, days: null }) } catch (e) { console.error('createPayment err', e) }
    }
    const w = await db.creditWallet(userId, Number(coins))
    res.json(w)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /wallet/buy-vip - spend coins to become VIP
app.post('/wallet/buy-vip', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user && req.user.id
    const { cost_coins, months, days } = req.body || {}
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    if (!cost_coins || Number(cost_coins) <= 0) return res.status(400).json({ error: 'cost_coins required' })
    // attempt debit
    const debit = await db.debitWallet(userId, Number(cost_coins))
    if (debit && debit.error) return res.status(400).json({ error: 'insufficient_funds', balance: debit.balance })
    // record payment using provider 'coin'
    try { await db.createPayment({ user_id: userId, amount: 0, provider: 'coin', provider_ref: null, months: months || null, days: days || null }) } catch (e) { console.error('createPayment err', e) }
    // upgrade to vip
    try {
      await db.updateUserVip(userId, { months: months || undefined, days: days || undefined, role: 'vip' })
      const updated = await db.getUserById(userId)
      return res.json({ success: true, wallet: debit, user: updated })
    } catch (e) {
      console.error('upgrade via coins failed', e)
      // refund coins on failure
      try { await db.creditWallet(userId, Number(cost_coins)) } catch (ee) { console.error('refund err', ee) }
      return res.status(500).json({ error: 'upgrade_failed' })
    }
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
    const { cost_coins } = req.body || {}
    if (!userId) return res.status(401).json({ error: 'missing authorization' })
    if (!cost_coins || Number(cost_coins) <= 0) return res.status(400).json({ error: 'cost_coins required' })
    const debit = await db.debitWallet(userId, Number(cost_coins))
    if (debit && debit.error) return res.status(400).json({ error: 'insufficient_funds', balance: debit.balance })
    try { await db.createPayment({ user_id: userId, amount: 0, provider: 'coin', provider_ref: 'buy-author', months: null, days: null }) } catch (e) { console.error('createPayment err', e) }
    try { await db.promoteUserToAuthor(userId, { pen_name: null, bio: null }) } catch (e) { console.error('promote author err', e) }
    const updated = await db.getUserById(userId)
    return res.json({ success: true, wallet: debit, user: updated })
  } catch (err) {
    console.error('buy-author err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Donate coins to a story's author
app.post('/books/:id/donate', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const donorId = req.user && req.user.id
    if (!donorId) return res.status(401).json({ error: 'missing authorization' })
    const storyId = req.params.id
    const { coins, message } = req.body || {}
    if (!coins || Number(coins) <= 0) return res.status(400).json({ error: 'coins required' })
    const book = await db.getBookById(storyId)
    if (!book) return res.status(404).json({ error: 'story not found' })
    const authorId = book.author_id || book.author_id || book.author || null
    if (!authorId) return res.status(400).json({ error: 'story has no author' })
    // debit donor
    const debit = await db.debitWallet(donorId, Number(coins))
    if (debit && debit.error) return res.status(400).json({ error: 'insufficient_funds', balance: debit.balance })
    // credit author
    const credit = await db.creditWallet(authorId, Number(coins))
    // record donation
    const donation = await db.createDonation({ donor_id: donorId, story_id: storyId, author_id: authorId, coins: Number(coins), message: message || null })
    // record payment row for audit
    try { await db.createPayment({ user_id: donorId, amount: 0, provider: 'donation', provider_ref: JSON.stringify({ donation_id: donation.donation_id }), months: null, days: null }) } catch (e) { console.error('createPayment err', e) }
    return res.json({ success: true, donation, donor_wallet: debit, author_wallet: credit })
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
    // check balance
    const bal = await db.getWallet(userId)
    if (!bal || Number(bal.balance) < Number(coins)) return res.status(400).json({ error: 'insufficient_funds', balance: bal ? bal.balance : 0 })
    // debit wallet immediately to reserve funds
    const debit = await db.debitWallet(userId, Number(coins))
    if (debit && debit.error) return res.status(400).json({ error: 'insufficient_funds', balance: debit.balance })
    // record withdrawal request
    const w = await db.createWithdrawal({ user_id: userId, coins: Number(coins), method: method || 'bank', details: details || null })
    return res.json({ success: true, withdrawal: w, wallet: debit })
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
    // fetch current withdrawal
    const all = await db.getWithdrawals()
    const found = all.find(r => String(r.withdrawal_id) === String(id))
    if (!found) return res.status(404).json({ error: 'not found' })
    // if declining, refund coins
    if (status === 'declined') {
      try { await db.creditWallet(found.user_id, Number(found.coins || 0)) } catch (e) { console.error('refund err', e) }
    }
    const updated = await db.updateWithdrawalStatus(id, { status })
    // if approved/processed, record a payout payment row for bookkeeping
    if (status === 'processed' || status === 'approved') {
      try { await db.createPayment({ user_id: found.user_id, amount: 0, provider: 'payout', provider_ref: JSON.stringify({ withdrawal_id: id }), months: null, days: null }) } catch (e) { console.error('createPayment err', e) }
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
    // For providers, validate signature in production. Here we accept JSON body with user_id and months/days/amount/provider_ref
    const { user_id, amount, provider, provider_ref, months, days, secret } = req.body || {}
    // optional shared secret for basic validation
    if (process.env.PAYMENT_WEBHOOK_SECRET && process.env.PAYMENT_WEBHOOK_SECRET !== String(secret || '')) {
      return res.status(403).json({ error: 'invalid secret' })
    }
    if (!user_id) return res.status(400).json({ error: 'user_id required' })
    const payment = await db.createPayment({ user_id, amount: amount || 0, provider: provider || null, provider_ref: provider_ref || null, months: months || null, days: days || null })
    // upgrade
    try {
      await db.updateUserVip(user_id, { months: months || undefined, days: days || undefined, role: 'vip' })
    } catch (e) { console.error('webhook upgrade err', e) }
    return res.json({ success: true, payment })
  } catch (err) {
    console.error('payments webhook err', err)
    res.status(500).json({ error: 'internal' })
  }
})

// Chapters endpoints
app.get('/books/:id/chapters', async (req, res) => {
  try {
    if (useMysql) {
      const chapters = await db.getChaptersByBook(req.params.id)
      return res.json(chapters)
    }
    const data = readData();
    const book = data.books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'not found' });
    res.json(book.chapters || []);
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/books/:bookId/chapters/:chapterId', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    // optional auth: guests may access up to 3 chapters
    let user = null
    const auth = req.headers.authorization
    if (auth && String(auth).startsWith('Bearer ')) {
      const token = auth.split(' ')[1]
      try { user = require('jsonwebtoken').verify(token, JWT_SECRET) } catch (e) { user = null }
    }
    let foundBy = null
    let chapter = await db.getChapterById(req.params.bookId, req.params.chapterId)
    if (chapter) foundBy = 'id'
    // If not found by primary chapter_id, try treating the param as a chapter number (chapter_no)
    if (!chapter) {
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
    // Fallback: if chapter still missing or has empty content, try loading from chapters list
    if ((!chapter || !chapter.content) && useMysql) {
      try {
        const list = await db.getChaptersByBook(req.params.bookId)
        if (Array.isArray(list) && list.length) {
          // try find by chapter_no or by index
          const maybeNum = Number(req.params.chapterId)
          let found = null
          if (!isNaN(maybeNum)) {
            found = list.find(c => Number(c.chapter_no || c.chapterNo || c.chapter_no) === maybeNum) || list[maybeNum - 1]
          }
          if (!found) found = list[0]
          if (found) {
            chapter = found
            foundBy = 'list'
          }
        }
      } catch (e) {
        console.error('fallback getChaptersByBook err', e)
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

    // Guest: allow a limited number of distinct chapters per day based on visitor (IP-based)
    if (role === 'guest') {
      try {
        const guestLimit = Number(process.env.GUEST_DAILY_LIMIT || 3)
        // derive a visitor key from IP / forwarded-for header
        const ip = String(req.headers['x-forwarded-for'] || req.ip || req.connection && req.connection.remoteAddress || 'unknown')
        const visitorKey = `visitor:${ip}`
        const already = await db.hasViewedChapterToday(visitorKey, String(chapter.id))
        const count = await db.countUserDistinctChapterViewsToday(visitorKey)
        if (!already && count >= guestLimit) {
          return res.status(429).json({ error: 'guest_limit_reached', message: `Guests can read ${guestLimit} chapters per day`, allowed_chapters: guestLimit, ad_required: true })
        }
        // record a view for guests using the visitor key
        try { await db.recordChapterView(visitorKey, req.params.bookId, String(chapter.id)) } catch (e) { console.error('record guest view err', e) }
        return res.json(Object.assign({}, chapter, { ad_required: true }))
      } catch (e) {
        console.error('guest chapter access err', e)
        return res.status(500).json({ error: 'internal' })
      }
    }

    // Regular user: allow but enforce daily limit of 10 distinct chapters (ads required)
    if (role === 'user') {
      const userId = String(user.id)
      const already = await db.hasViewedChapterToday(userId, String(chapter.id))
      const count = await db.countUserDistinctChapterViewsToday(userId)
      if (!already && count >= 10) return res.status(429).json({ error: 'limit_reached', message: 'Daily limit of 10 chapters reached' })
      // record view if not already
      try { await db.recordChapterView(userId, req.params.bookId, String(chapter.id)) } catch (e) { console.error('record view err', e) }
      return res.json(Object.assign({}, chapter, { ad_required: true }))
    }

    // VIP / author / admin: full access without ads
    return res.json(Object.assign({}, chapter, { ad_required: false }))
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

// Reading progress
app.post('/progress', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const userId = req.user.id
    const { book_id, chapter_id, progress } = req.body
    if (!book_id) return res.status(400).json({ error: 'book_id required' })
    const row = await db.upsertProgress({ user_id: userId, book_id, chapter_id, progress })
    res.json(row)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

app.get('/users/:userId/progress', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId
    if (req.user.id !== userId && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    // optional query param book_id
    const bookId = req.query.book_id
    if (bookId) {
      const row = await db.getProgressByUserBook(userId, bookId)
      return res.json(row || {})
    }
    // otherwise fetch all progress rows for user
    // simple query via pool
    const p = await require('./mysql').initPool()
    const [rows] = await p.execute('SELECT * FROM reading_progress WHERE user_id = ? ORDER BY updated_at DESC', [userId])
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal' })
  }
})

const PORT = process.env.PORT || 4000;
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
  console.log('Debug token endpoint enabled at POST /debug/token (ALLOW_DEV_TOKENS=true)')
}
// Debug: dump chapters for a book (dev only)
if (process.env.ALLOW_DEV_TOKENS === 'true') {
  app.get('/debug/books/:id/chapters', async (req, res) => {
    try {
      const id = req.params.id
      const chapters = await db.getChaptersByBook(id)
      return res.json({ book_id: id, count: (chapters || []).length, chapters })
    } catch (e) {
      console.error('debug chapters err', e)
      return res.status(500).json({ error: 'internal', detail: String(e && (e.stack || e.message || e)) })
    }
  })
  console.log('Debug chapters endpoint enabled at GET /debug/books/:id/chapters (ALLOW_DEV_TOKENS=true)')
}

// ==================== COMMENTS API ====================
// GET /books/:id/comments - public list of comments for a book
app.get('/books/:id/comments', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    const bookId = req.params.id
    const comments = await db.getComments(bookId, { status: 'approved' })
    res.json(comments || [])
  } catch (err) {
    console.error('GET /books/:id/comments err', err)
    res.status(500).json({ error: 'internal', message: err.message })
  }
})

// POST /books/:id/comments - create a new comment (requires auth)
app.post('/books/:id/comments', async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })

    // Parse auth token
    let userId = null
    const auth = req.headers.authorization
    if (auth) {
      const parts = auth.split(' ')
      if (parts.length === 2 && parts[0] === 'Bearer') {
        try {
          const payload = jwt.verify(parts[1], JWT_SECRET)
          userId = payload && payload.id ? payload.id : null
        } catch (e) {
          return res.status(401).json({ error: 'invalid token' })
        }
      }
    }

    if (!userId) {
      return res.status(401).json({ error: 'missing authorization' })
    }

    const bookId = req.params.id
    const { content, parent_id } = req.body || {}

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content required' })
    }

    // Check content for negativity using Grok API (xAI)
    let isNegative = false
    let negativeProbability = 0
    const GROK_KEY = process.env.GROK_API_KEY
    if (GROK_KEY) {
      console.log(`[Grok] Checking: "${content.trim()}"`);
      try {
        const grokRes = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROK_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: "grok-4-1-fast-non-reasoning",
            messages: [
              { role: "system", content: "Bạn là robot kiểm duyệt bình luận thô tục cực kỳ khắt khe. Nếu bình luận chứa từ bậy, tiếng lóng thô lỗ (lol, cút, xàm, ngu, đm, vcl, ...) hoặc xúc phạm người khác, hãy trả về 'tieu cuc'. Ngược lại trả về 'binh thuong'. Chỉ trả về 1 từ duy nhất." },
              { role: "user", content: content.trim() }
            ],
            temperature: 0
          })
        })
        const grokData = await grokRes.json()
        if (grokData && grokData.choices && grokData.choices[0]) {
          const answer = (grokData.choices[0].message.content || '').toLowerCase().trim()
          console.log(`[Grok] Raw Answer: "${answer}"`);
          if (answer.includes('tieu cuc') || answer.includes('tiêu cực') || answer.includes('toxic')) {
            isNegative = true
            negativeProbability = 99
          } else if (answer.includes('binh thuong') || answer.includes('bình thường')) {
            isNegative = false
          } else {
            // Nếu Grok trả về lạ, mặc định coi là tiêu cực nếu không phải 'binh thuong'
            isNegative = !answer.includes('binh thuong');
          }
        } else {
          console.log('[Grok] Error response:', JSON.stringify(grokData));
        }
      } catch (e) {
        console.error('[Grok] Fetch failed:', e.message)
      }
    } else {
      console.warn('[Grok] Missing GROK_API_KEY');
    }


    const comment = await db.createComment(bookId, {
      user_id: userId,
      content: content.trim(),
      parent_id: parent_id || null,
      is_negative: isNegative ? 1 : 0,
      negative_probability: negativeProbability
    })

    res.status(201).json(comment)
  } catch (err) {
    console.error('POST /books/:id/comments err', err)
    res.status(500).json({ error: 'internal', message: err.message })
  }
})

// GET /comments - admin: list all comments with optional filters
app.get('/comments', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const { status, limit } = req.query || {}
    const comments = await db.getComments(null, { status, limit: limit ? parseInt(limit) : 100 })
    res.json(comments || [])
  } catch (err) {
    console.error('GET /comments err', err)
    res.status(500).json({ error: 'internal', message: err.message })
  }
})

// PUT /comments/:id - admin: update comment (approve/reject)
app.put('/comments/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const { content, enabled, status } = req.body || {}
    const updated = await db.updateComment(id, {
      content,
      enabled,
      status,
      reviewed_by: req.user.email || req.user.id
    })
    if (!updated) return res.status(404).json({ error: 'not found' })
    res.json(updated)
  } catch (err) {
    console.error('PUT /comments/:id err', err)
    res.status(500).json({ error: 'internal', message: err.message })
  }
})

// DELETE /comments/:id - admin: delete comment
app.delete('/comments/:id', authMiddleware, async (req, res) => {
  try {
    if (!useMysql) return res.status(400).json({ error: 'requires MySQL mode' })
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const id = req.params.id
    const result = await db.deleteComment(id)
    res.json(result)
  } catch (err) {
    console.error('DELETE /comments/:id err', err)
    res.status(500).json({ error: 'internal', message: err.message })
  }
})

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
