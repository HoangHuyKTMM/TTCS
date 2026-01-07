import Constants from 'expo-constants'

const extra = (Constants.expoConfig?.extra || {}) as any
export const API_BASE = extra.apiBase || process.env.EXPO_PUBLIC_API_BASE || 'http://10.0.2.2:4000' // use EXPO_PUBLIC_API_BASE or extra.apiBase; default to Android emulator loopback

console.log('[API] API_BASE:', API_BASE)
console.log('[API] process.env.EXPO_PUBLIC_API_BASE:', process.env.EXPO_PUBLIC_API_BASE)
console.log('[API] extra.apiBase:', extra.apiBase)

async function request(path: string, opts: RequestInit = {}) {
  const url = `${API_BASE}${path}`
  console.log('[API] Fetching:', url)
  try {
    const res = await fetch(url, opts)
    const text = await res.text()
    try { return JSON.parse(text) } catch (e) { return text }
  } catch (err: any) {
    // network error (DNS, refused, offline)
    console.error('[API] Fetch error:', url, err)
    return { error: 'network', message: String(err && err.message ? err.message : err) }
  }
}

export async function apiRegister(name: string, email: string, password: string) {
  return request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password })
  })
}

export async function apiLogin(email: string, password: string) {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
}

export async function apiFetchBooks(token?: string, opts?: { mine?: boolean }) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const mine = opts && opts.mine ? '?mine=true' : ''
  return request(`/books${mine}`, { headers })
}

// Genres (public)
export async function apiFetchGenres(token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/genres', { headers })
}

export async function apiFetchChapters(bookId: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/books/${bookId}/chapters`, { headers })
}

export async function apiFetchChapter(bookId: string, chapterId: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/books/${bookId}/chapters/${chapterId}`, { headers })
}

export async function apiFetchBook(bookId: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/books/${bookId}`, { headers })
}

export async function apiGetMe(token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/me', { headers })
}

export async function apiSubscribeVip(userId: string, body: any = {}, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/users/${userId}/vip`, { method: 'POST', headers, body: JSON.stringify(body) })
}

export async function apiApplyAuthor(body: any = {}, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/author/apply', { method: 'POST', headers, body: JSON.stringify(body) })
}

export async function apiGetAuthorApplications(token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/author/applications', { headers })
}

export async function apiUpdateAuthorApplication(id: string, body: any = {}, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/author/applications/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) })
}

export default { apiRegister, apiLogin, apiFetchBooks, apiFetchChapters, apiFetchChapter, apiFetchBook, apiGetMe, apiSubscribeVip }
// Wallet helpers
export async function apiGetWallet(token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/wallet', { headers })
}

export async function apiTopUpWallet(coins: number, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/wallet/topup', { method: 'POST', headers, body: JSON.stringify({ coins }) })
}

// Wallet: top-up requests (manual approval)
export async function apiCreateTopupRequest(payload: { coins: number; amount?: number; method?: string; note?: string; evidence_url?: string; provider_ref?: string }, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/wallet/topup-request', { method: 'POST', headers, body: JSON.stringify(payload) })
}

export async function apiListTopupRequests(token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/wallet/topup-requests', { headers })
}

export async function apiBuyVipWithCoins(cost_coins: number, body: any = {}, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/wallet/buy-vip', { method: 'POST', headers, body: JSON.stringify({ cost_coins, ...body }) })
}

export async function apiBuyAuthorWithCoins(cost_coins: number, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/wallet/buy-author', { method: 'POST', headers, body: JSON.stringify({ cost_coins }) })
}

export async function apiDonateCoins(bookId: string, coins: number, message?: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/books/${bookId}/donate`, { method: 'POST', headers, body: JSON.stringify({ coins, message }) })
}

// Update current user's avatar
export async function apiUpdateAvatar(avatar_url: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/me/avatar', { method: 'POST', headers, body: JSON.stringify({ avatar_url }) })
}

// Change password (auth)
export async function apiChangePassword(old_password: string, new_password: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/me/password', { method: 'POST', headers, body: JSON.stringify({ old_password, new_password }) })
}

// Author: create book
export async function apiCreateBook(payload: { title: string; author?: string; description?: string; cover_url?: string; genre?: string }, token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request('/books', { method: 'POST', headers, body: JSON.stringify(payload) })
}

// Author: create chapter
export async function apiCreateChapter(bookId: string, payload: { title: string; content: string }, token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request(`/books/${bookId}/chapters`, { method: 'POST', headers, body: JSON.stringify(payload) })
}

// Likes / Favorites
export async function apiLikeBook(bookId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  return request(`/books/${bookId}/like`, { method: 'POST', headers })
}

export async function apiUnlikeBook(bookId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  return request(`/books/${bookId}/like`, { method: 'DELETE', headers })
}

export async function apiGetLikes(bookId: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/books/${bookId}/likes`, { headers })
}

// Follows
export async function apiFollowBook(bookId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  return request(`/books/${bookId}/follow`, { method: 'POST', headers })
}

export async function apiUnfollowBook(bookId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  return request(`/books/${bookId}/follow`, { method: 'DELETE', headers })
}

// Authors
export type AuthorItem = {
  id: string
  author_id?: string
  user_id?: string | null
  pen_name?: string | null
  avatar_url?: string | null
  followers_count?: number
  books_count?: number
  is_following?: boolean
}

export type FollowingFeedItem = {
  id: string
  type: 'story' | 'chapter'
  created_at: string
  author_id?: string | null
  author_user_id?: string | null
  author_name?: string | null
  story_id?: string | null
  story_title?: string | null
  cover_url?: string | null
  genre?: string | null
  likes_count?: number
  views?: number
  chapter_id?: string | null
  chapter_no?: number | null
  chapter_title?: string | null
}

export async function apiFetchAuthors(token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/authors', { headers })
}

export async function apiFetchAuthorBooks(authorId: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/authors/${authorId}/books`, { headers })
}

export async function apiFollowAuthor(authorId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  return request(`/authors/${authorId}/follow`, { method: 'POST', headers })
}

export async function apiUnfollowAuthor(authorId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  return request(`/authors/${authorId}/follow`, { method: 'DELETE', headers })
}

export async function apiFetchFollowingFeed(token: string, opts?: { limit?: number; offset?: number }) {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  const limit = opts && typeof opts.limit === 'number' ? opts.limit : 20
  const offset = opts && typeof opts.offset === 'number' ? opts.offset : 0
  const qs = `?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`
  return request(`/following/feed${qs}`, { headers })
}

// Public feed (no login required)
export async function apiFetchPublicFeed(opts?: { limit?: number; offset?: number }) {
  const headers: any = { 'Content-Type': 'application/json' }
  const limit = opts && typeof opts.limit === 'number' ? opts.limit : 20
  const offset = opts && typeof opts.offset === 'number' ? opts.offset : 0
  const qs = `?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`
  return request(`/feed${qs}`, { headers })
}

// Notifications (auth)
export type NotificationItem = {
  id: string
  type: 'like' | 'follow' | 'donation' | 'rank'
  created_at: string
  actor_user_id?: string | null
  actor_name?: string | null
  actor_avatar_url?: string | null
  story_id?: string | null
  story_title?: string | null
  rank?: number | null
  views?: number | null
  coins?: number | null
  message?: string | null
}

export async function apiFetchNotifications(token: string, opts?: { limit?: number; offset?: number }) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const limit = opts && typeof opts.limit === 'number' ? opts.limit : 30
  const offset = opts && typeof opts.offset === 'number' ? opts.offset : 0
  const qs = `?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`
  return request(`/notifications${qs}`, { headers })
}

export async function apiHasUnreadNotifications(token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request(`/notifications/unread`, { headers })
}

export async function apiMarkNotificationsSeen(token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request(`/notifications/seen`, { method: 'POST', headers })
}

// Comments
export async function apiFetchComments(bookId: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  return request(`/books/${bookId}/comments`, { headers })
}

export async function apiPostComment(bookId: string, content: string, parent_id?: string | null, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/books/${bookId}/comments`, { method: 'POST', headers, body: JSON.stringify({ content, parent_id }) })
}

export async function apiDeleteComment(commentId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  return request(`/comments/${encodeURIComponent(String(commentId))}`, { method: 'DELETE', headers })
}

// Ads (public)
export type VideoAd = {
  id: string | number
  title?: string
  link_url?: string
  link?: string
  video_url: string
  placement?: string
  enabled?: boolean | number
}

export async function apiFetchAds(placement?: string) {
  const qs = placement ? `?placement=${encodeURIComponent(placement)}` : ''
  const res: any = await request(`/ads${qs}`, { headers: { 'Content-Type': 'application/json' } })
  if (!Array.isArray(res)) return res

  // Normalize video_url to absolute URLs for the app.
  return res.map((a: any) => {
    const raw = a?.video_url
    let video_url = typeof raw === 'string' && raw
      ? (raw.startsWith('http') ? raw : `${API_BASE}${raw}`)
      : ''

    // If backend generated an absolute URL using "localhost", replace it with API_BASE host.
    // This commonly breaks on Android emulator/real devices.
    try {
      if (video_url && video_url.startsWith('http')) {
        const u = new URL(video_url)
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          const base = new URL(API_BASE)
          u.hostname = base.hostname
          u.port = base.port
          u.protocol = base.protocol
          video_url = u.toString()
        }
      }
    } catch {
      // ignore URL parse errors
    }

    const link_url = a?.link_url || a?.link || ''
    return { ...a, video_url, link_url }
  }) as VideoAd[]
}
