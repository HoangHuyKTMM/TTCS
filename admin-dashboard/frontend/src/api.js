const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

function isUnauthorized(res) {
  return res && (res.status === 401 || res.status === 403)
}

function getToken() {
  try { return localStorage.getItem('admin_token') } catch (e) { return null }
}

function withAuth(headers = {}) {
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  else headers['X-Bypass-Auth'] = 'true' // server allows local dev bypass when request is from localhost
  return headers
}

export async function fetchBooks() {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books`, { headers })
  return res.json()
}

export async function createBook(payload) {
 const token = getToken()
  // If payload contains a coverFile we will upload the file via a JSON base64 endpoint
  if (payload && payload.coverFile) {
    // read file into base64 (browser File)
    const b64 = await fileToBase64(payload.coverFile)
    const filename = payload.coverFile.name || `cover-${Date.now()}.jpg`
    const headers1 = { 'Content-Type': 'application/json' }
    if (token) headers1['Authorization'] = `Bearer ${token}`
    else headers1['X-Bypass-Auth'] = 'true'
    const upRes = await fetch(`${API_BASE}/uploads/cover-json`, { method: 'POST', headers: headers1, body: JSON.stringify({ filename, data: b64.replace(/^data:.*;base64,/, '') }) })
    const upJson = await upRes.json()
    if (!upRes.ok) return upJson
    const cover_url = upJson.path || upJson.url || null
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    else headers['X-Bypass-Auth'] = 'true'
    const body = { title: payload.title, author: payload.author, description: payload.description, genre: payload.genre}
    if (cover_url) body.cover_url = cover_url
    const res = await fetch(`${API_BASE}/books`, { method: 'POST', headers, body: JSON.stringify(body) })
    return res.json()
  }
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })
  return res.json()
}

export async function fetchBanners() {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/banners`, { headers })
  return res.json()
}

// Video Ads
export async function fetchAdsAdmin() {
  const headers = withAuth({ 'Content-Type': 'application/json' })
  const res = await fetch(`${API_BASE}/ads/admin`, { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json && (json.error || json.message) ? (json.error || json.message) : `HTTP ${res.status}` }
  return json
}

export async function createAd(payload) {
  const fd = new FormData()
  fd.append('title', payload.title || '')
  fd.append('link', payload.link || '')
  fd.append('placement', payload.placement || 'interstitial')
  fd.append('enabled', payload.enabled ? '1' : '0')
  if (payload.videoFile) fd.append('video', payload.videoFile)
  const headers = withAuth({})
  const res = await fetch(`${API_BASE}/ads`, { method: 'POST', headers, body: fd })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json && (json.error || json.message) ? (json.error || json.message) : `HTTP ${res.status}` }
  return json
}

export async function updateAd(id, payload) {
  const fd = new FormData()
  if (payload.title !== undefined) fd.append('title', payload.title || '')
  if (payload.link !== undefined) fd.append('link', payload.link || '')
  if (payload.placement !== undefined) fd.append('placement', payload.placement || 'interstitial')
  if (payload.enabled !== undefined) fd.append('enabled', payload.enabled ? '1' : '0')
  if (payload.videoFile) fd.append('video', payload.videoFile)
  const headers = withAuth({})
  const res = await fetch(`${API_BASE}/ads/${id}`, { method: 'PUT', headers, body: fd })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json && (json.error || json.message) ? (json.error || json.message) : `HTTP ${res.status}` }
  return json
}

export async function deleteAd(id) {
  const headers = withAuth({ 'Content-Type': 'application/json' })
  const res = await fetch(`${API_BASE}/ads/${id}`, { method: 'DELETE', headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json && (json.error || json.message) ? (json.error || json.message) : `HTTP ${res.status}` }
  return json
}

export async function createBanner(payload) {
  const token = getToken()
  if (payload && payload.bannerFile) {
    const fd = new FormData()
    fd.append('title', payload.title || '')
    fd.append('link', payload.link || '')
    fd.append('enabled', payload.enabled ? '1' : '0')
    fd.append('banner', payload.bannerFile)
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${API_BASE}/banners`, { method: 'POST', headers, body: fd })
    return res.json()
  }
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/banners`, { method: 'POST', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteBanner(id) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/banners/${id}`, { method: 'DELETE', headers })
  return res.json()
}

export async function updateBanner(id, payload) {
  const token = getToken()
  if (payload && payload.bannerFile) {
    const fd = new FormData()
    if (payload.title !== undefined) fd.append('title', payload.title)
    if (payload.link !== undefined) fd.append('link', payload.link)
    if (payload.enabled !== undefined) fd.append('enabled', payload.enabled ? '1' : '0')
    fd.append('banner', payload.bannerFile)
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${API_BASE}/banners/${id}`, { method: 'PUT', headers, body: fd })
    return res.json()
  }
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/banners/${id}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function createChapter(bookId, payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books/${bookId}/chapters`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })
  return res.json()
}

export async function updateChapter(bookId, chapterId, payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books/${bookId}/chapters/${chapterId}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteChapter(bookId, chapterId) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books/${bookId}/chapters/${chapterId}`, { method: 'DELETE', headers })
  return res.json()
}

export async function fetchStats() {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/stats`, { headers })
  return res.json()
}

export async function getBookById(id) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books/${id}`, { headers })
  return res.json()
}

export async function fetchUsers() {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/users`, { headers })
  if (isUnauthorized(res)) return { error: 'unauthorized', status: res.status }
  return res.json()
}

export async function updateBook(id, payload) {
  const token = getToken()
  // if client supplied a coverFile, upload it using JSON base64 endpoint then call PUT with cover_url
  if (payload && payload.coverFile) {
    const b64 = await fileToBase64(payload.coverFile)
    const filename = payload.coverFile.name || `cover-${Date.now()}.jpg`
    const headers1 = { 'Content-Type': 'application/json' }
    if (token) headers1['Authorization'] = `Bearer ${token}`
    else headers1['X-Bypass-Auth'] = 'true'
    const upRes = await fetch(`${API_BASE}/uploads/cover-json`, { method: 'POST', headers: headers1, body: JSON.stringify({ filename, data: b64.replace(/^data:.*;base64,/, '') }) })
    const upJson = await upRes.json()
    if (!upRes.ok) return upJson
    const cover_url = upJson.path || upJson.url || null
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    else headers['X-Bypass-Auth'] = 'true'
    const body = { }
    if (payload.title !== undefined) body.title = payload.title
    if (payload.author !== undefined) body.author = payload.author
    if (payload.description !== undefined) body.description = payload.description
    if (payload.genre !== undefined) body.genre = payload.genre
    if (cover_url) body.cover_url = cover_url
    const res = await fetch(`${API_BASE}/books/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) })
    return res.json()
  }
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books/${id}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
  return res.json()
}

// Browser helper: convert File to base64 data URL
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = (e) => reject(e)
      reader.readAsDataURL(file)
    } catch (e) { reject(e) }
  })
}

export async function deleteBook(id) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books/${id}`, { method: 'DELETE', headers })
  return res.json()
}

export async function updateUser(id, payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/users/${id}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function createUser(payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/users`, { method: 'POST', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteUser(id) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE', headers })
  return res.json()
}

export async function login(payload) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return res.json()
}

export async function register(payload) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return res.json()
}

export async function fetchPayments() {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/payments`, { headers })
  return res.json()
}

export async function fetchDonations() {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/donations`, { headers })
  return res.json()
}

// Comments API
export async function fetchComments(opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const params = new URLSearchParams()
  if (opts.bookId) params.set('book_id', opts.bookId)
  if (opts.status) params.set('status', opts.status)
  if (opts.limit) params.set('limit', String(opts.limit))
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${API_BASE}/comments${qs}`, { headers })
  return res.json()
}

export async function createComment(bookId, payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/books/${bookId}/comments`, { method: 'POST', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function adminDeleteComment(id) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/comments/${id}`, { method: 'DELETE', headers })
  return res.json()
}

export async function adminUpdateComment(id, payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/comments/${id}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
  return res.json()
}

// Follows API
export async function fetchFollows(userId) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const url = userId ? `${API_BASE}/follows?user_id=${encodeURIComponent(userId)}` : `${API_BASE}/follows`
  const res = await fetch(url, { headers })
  return res.json()
}

export async function createFollow(payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/follows`, { method: 'POST', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteFollow(id) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/follows/${id}`, { method: 'DELETE', headers })
  return res.json()
}

// Genres API
export async function fetchGenres() {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/genres`, { headers })
  return res.json()
}

export async function createGenre(payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/genres`, { method: 'POST', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function updateGenre(id, payload) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/genres/${id}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteGenre(id) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/genres/${id}`, { method: 'DELETE', headers })
  return res.json()
}

// Admin: direct wallet credit
export async function adminCreditWallet(userId, coins, note) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/users/${userId}/wallet/topup`, { method: 'POST', headers, body: JSON.stringify({ coins, note }) })
  return res.json()
}

// Coin / top-up requests (admin)
export async function fetchTopupRequests(status) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  const res = await fetch(`${API_BASE}/wallet/topup-requests${qs}`, { headers })
  if (isUnauthorized(res)) return { error: 'unauthorized', status: res.status }
  return res.json()
}

export async function approveTopupRequest(id, payload = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/wallet/topup-requests/${id}/approve`, { method: 'POST', headers, body: JSON.stringify(payload) })
  return res.json()
}

export async function rejectTopupRequest(id, payload = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/wallet/topup-requests/${id}/reject`, { method: 'POST', headers, body: JSON.stringify(payload) })
  return res.json()
}

// Admin update user avatar
export async function adminUpdateUserAvatar(userId, avatar_url) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/users/${userId}/avatar`, { method: 'POST', headers, body: JSON.stringify({ avatar_url }) })
  return res.json()
}
