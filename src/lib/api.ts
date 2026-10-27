import Constants from 'expo-constants'
import { Platform } from 'react-native'

const extra = (Constants.expoConfig?.extra || {}) as any

// This PC is 192.168.1.241 on Wi-Fi. The phone (192.168.1.214) can reach that
// address directly. 10.0.2.2 exists only inside the Android emulator.
// 127.0.0.1 on a real phone is the phone itself unless USB reverse is set
// with the phone selected: adb -s e3ab33ab reverse tcp:4000 tcp:4000
// A bare `adb reverse` fails while the emulator is also attached.
const LAN_API_BASE = 'http://192.168.1.241:4000'
const CANDIDATE_BASES = [
  Platform.OS === 'android' ? LAN_API_BASE : 'http://localhost:4000',
  Platform.OS === 'android' ? 'http://127.0.0.1:4000' : 'http://localhost:4000',
  process.env.EXPO_PUBLIC_API_BASE,
  extra.apiBase,
  Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000',
  'http://localhost:4000',
].filter(Boolean) as string[]

const UNIQUE_BASES = Array.from(new Set(CANDIDATE_BASES))

let activeApiBase = Platform.OS === 'android' ? LAN_API_BASE : 'http://localhost:4000'
if (UNIQUE_BASES.length > 0 && !UNIQUE_BASES[0].includes('192.168.9.141')) {
  activeApiBase = UNIQUE_BASES[0]
}

export let API_BASE = activeApiBase

async function request(path: string, opts: RequestInit = {}) {
  const tryBases = [activeApiBase, ...UNIQUE_BASES.filter(b => b !== activeApiBase && !b.includes('192.168.9.141'))]

  let lastErr: any = null
  for (const base of tryBases) {
    const url = `${base}${path}`
    try {
      const res = await fetch(url, opts)
      if (activeApiBase !== base) {
        activeApiBase = base
        API_BASE = base
        console.log('[API] Connected and switched API_BASE to:', base)
      }
      const text = await res.text()
      try { return JSON.parse(text) } catch (e) { return text }
    } catch (err: any) {
      lastErr = err
    }
  }

  console.error('[API] Fetch error (all bases failed):', path, lastErr)
  return { error: 'network', message: String(lastErr && lastErr.message ? lastErr.message : lastErr) }
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

export type BookPage = { books: any[]; nextCursor: string | null; hasMore: boolean }
export type BookPageOptions = { limit?: number; cursor?: string | null; sort?: 'recent' | 'views' | 'likes' | 'recommended'; genre?: string }

export async function apiFetchBooks(token?: string, opts?: ({ mine?: boolean } & BookPageOptions) | undefined) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const params = new URLSearchParams()
  if (opts?.mine) params.set('mine', 'true')
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.sort) params.set('sort', opts.sort)
  if (opts?.genre && opts.genre !== 'Tất cả') params.set('genre', opts.genre)
  const query = params.toString()
  return request(`/books${query ? `?${query}` : ''}`, { headers })
}

export async function apiFetchLikedBooks(token: string, opts?: { limit?: number; cursor?: string | null }): Promise<BookPage | any> {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const params = new URLSearchParams()
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts?.cursor) params.set('cursor', opts.cursor)
  const query = params.toString()
  return request(`/books/liked${query ? `?${query}` : ''}`, { headers })
}

export async function apiSearchBooks(query: string, opts?: { genre?: string; limit?: number; cursor?: string | null }, token?: string): Promise<BookPage | any> {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const params = new URLSearchParams({ q: query })
  if (opts?.genre && opts.genre !== 'Tất cả') params.set('genre', opts.genre)
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts?.cursor) params.set('cursor', opts.cursor)
  return request(`/books/search?${params.toString()}`, { headers })
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

export async function apiFetchChapterByNumber(bookId: string, chapterNo: number, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/books/${bookId}/chapters/${chapterNo}?by=number`, { headers })
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

export default { apiRegister, apiLogin, apiFetchBooks, apiFetchChapters, apiFetchChapter, apiFetchBook, apiGetMe }
// Wallet helpers
export type ReadingProgressRow = {
  history_id?: number
  user_id?: string
  book_id: string
  story_id?: string
  chapter_id?: string | null
  chapter_no?: number | null
  progress_pct?: number | null
  last_read_at?: string | null
  title?: string | null
  cover_url?: string | null
  genre?: string | null
}

export async function apiSaveProgress(
  payload: { book_id: string; chapter_id?: string; chapter_no?: number; progress?: number },
  token: string
) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request('/progress', { method: 'POST', headers, body: JSON.stringify(payload) })
}

export async function apiGetProgress(bookId: string, token: string): Promise<ReadingProgressRow | any> {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request(`/progress?book_id=${encodeURIComponent(bookId)}`, { headers })
}

export async function apiGetReadingHistory(token: string): Promise<ReadingProgressRow[] | any> {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request('/progress', { headers })
}

export async function apiListChatSessions(token: string) {
  return request('/chat/conversations', { headers: { Authorization: `Bearer ${token}` } })
}

export async function apiGetChatMessages(conversationId: string, token: string) {
  return request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function apiChat(
  payload: {
    message: string
    history?: { role: 'user' | 'assistant'; content: string }[]
    book_id?: string
    chapter_no?: number
    intent?: 'recommend' | 'recap' | 'auto'
    conversation_id?: string | number
    conversation_token?: string
  },
  token?: string
) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return request('/chat', { method: 'POST', headers, body: JSON.stringify(payload) })
}

export async function apiGetWallet(token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/wallet', { headers })
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

// Wallet: SePay Automated Top-up Intent
export type TopupIntent = {
  intent_id?: number
  user_id: string
  coins: number
  amount: number
  payment_code: string
  account_no: string
  bank_name: string
  account_name: string
  status: 'pending' | 'consumed' | 'expired'
  qr_url: string
  vietqr_url: string
  expires_at?: string
  local_mode?: boolean
}

export async function apiLocalSepayPay(paymentCode: string, token?: string): Promise<{ success: boolean; paid: boolean; already_credited?: boolean; message?: string; wallet?: any; coins?: number; error?: string }> {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/sepay/local-pay', { method: 'POST', headers, body: JSON.stringify({ paymentCode }) })
}

export async function apiCreateTopupIntent(coins: number, token?: string): Promise<{ success: boolean; intent: TopupIntent; error?: string }> {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request('/wallet/topup-intent', { method: 'POST', headers, body: JSON.stringify({ coins }) })
}

export async function apiCheckTopupIntentStatus(code: string, token?: string): Promise<{ success: boolean; status: string; is_paid: boolean; coins?: number; amount?: number; wallet?: any; error?: string }> {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/wallet/topup-intent/${encodeURIComponent(code)}/status`, { headers })
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

export type GiftItem = {
  code: string
  name: string
  emoji: string
  coins: number
}

export async function apiFetchGifts(): Promise<GiftItem[]> {
  const res: any = await request('/gifts')
  if (Array.isArray(res)) return res
  if (res && Array.isArray(res.gifts)) return res.gifts
  return []
}

export async function apiFetchRecentGifts(bookId: string, limit = 8) {
  return request(`/books/${encodeURIComponent(bookId)}/gifts?limit=${encodeURIComponent(String(limit))}`)
}

export async function apiSendGift(bookId: string, giftCode: string, quantity: number, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return request(`/books/${encodeURIComponent(bookId)}/donate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ gift_code: giftCode, quantity }),
  })
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

// Author: update book
export async function apiUpdateBook(bookId: string, payload: { title?: string; description?: string; cover_url?: string; genre?: string }, token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request(`/books/${bookId}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
}

// Author: delete book
export async function apiDeleteBook(bookId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request(`/books/${bookId}`, { method: 'DELETE', headers })
}

// Author: update chapter
export async function apiUpdateChapter(bookId: string, chapterId: string, payload: { title?: string; content?: string }, token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request(`/books/${bookId}/chapters/${chapterId}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
}

// Author: delete chapter
export async function apiDeleteChapter(bookId: string, chapterId: string, token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request(`/books/${bookId}/chapters/${chapterId}`, { method: 'DELETE', headers })
}

// Author: import book from text file
export async function apiImportBook(payload: { title: string; content: string; author?: string; description?: string; cover_url?: string; genre?: string }, token: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request('/books/import', { method: 'POST', headers, body: JSON.stringify(payload) })
}

// AI Duplicate / Plagiarism Check
export type CheckDuplicateResult = {
  zone: 'green' | 'yellow' | 'red'
  hamming: number | null
  similarity: number
  similarity_pct: number
  is_duplicate: boolean
  matched_chapter?: {
    chapter_id: string | number
    story_id: string | number
    story_title?: string
    chapter_no?: number
    chapter_title?: string
  } | null
  matched_snippets?: { snippetA: string; snippetB?: string; similarity: number }[]
  ai_analysis?: string | null
  message: string
}

export async function apiCheckDuplicate(
  payload: { content: string; title?: string; chapterId?: string; storyId?: string },
  token: string
): Promise<CheckDuplicateResult | any> {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request('/integrity/check-duplicate', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })
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
  type: 'like' | 'follow' | 'donation' | 'rank' | 'new_story' | 'new_chapter'
  created_at: string
  actor_user_id?: string | null
  actor_name?: string | null
  actor_avatar_url?: string | null
  story_id?: string | null
  story_title?: string | null
  chapter_id?: string | null
  chapter_no?: number | null
  chapter_title?: string | null
  rank?: number | null
  views?: number | null
  coins?: number | null
  message?: string | null
  gift_code?: string | null
  gift_name?: string | null
  gift_emoji?: string | null
  quantity?: number | null
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

export async function apiRegisterPushToken(token: string, pushToken: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request('/push/device', { method: 'POST', headers, body: JSON.stringify({ token: pushToken, platform: 'android' }) })
}

export async function apiRemovePushToken(token: string, pushToken: string) {
  const headers: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  return request('/push/device', { method: 'DELETE', headers, body: JSON.stringify({ token: pushToken }) })
}

// Comments
export async function apiFetchComments(bookId: string, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
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

// Check payment via bank API
export type CheckPaymentResult = {
  status: string
  message: string
  paid: boolean
}

export async function apiCheckPayment(account_no: string, content: string, amount: number): Promise<CheckPaymentResult> {
  const BANK_API_URL = 'https://bank.dinhmanhhung.net/check-payment'
  try {
    const res = await fetch(BANK_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ account_no, content, amount })
    })
    const data = await res.json()
    return data as CheckPaymentResult
  } catch (err: any) {
    console.error('[API] Check payment error:', err)
    return { status: 'error', message: String(err?.message || err), paid: false }
  }
}

// Verify payment and auto-credit coins (calls backend which checks bank API and credits wallet)
export type VerifyPaymentResult = {
  success: boolean
  paid: boolean
  already_credited?: boolean
  message: string
  wallet?: { coins: number; balance: number }
  error?: string
}

export async function apiVerifyAndCreditPayment(paymentCode: string, token: string): Promise<VerifyPaymentResult> {
  const headers: any = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  return request('/wallet/verify-payment', {
    method: 'POST',
    headers,
    body: JSON.stringify({ paymentCode })
  })
}

export async function apiFetchBanners() {
  const res: any = await request('/banners')
  if (!Array.isArray(res)) return res
  return res.map((b: any) => {
    const raw = b?.image_url
    let image_url = typeof raw === 'string' && raw
      ? (raw.startsWith('http') ? raw : `${API_BASE}${raw}`)
      : null
    try {
      if (image_url && image_url.startsWith('http')) {
        const u = new URL(image_url)
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '10.0.2.2') {
          const base = new URL(API_BASE)
          u.hostname = base.hostname
          u.port = base.port
          u.protocol = base.protocol
          image_url = u.toString()
        }
      }
    } catch {
      // ignore URL parse errors
    }
    return { ...b, image_url }
  })
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
