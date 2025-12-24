import Constants from 'expo-constants'

const extra = (Constants.expoConfig?.extra || {}) as any
export const API_BASE = extra.apiBase || 'http://192.168.2.9:4000' // adjust to your dev machine IP or ngrok

async function request(path: string, opts: RequestInit = {}) {
  const url = `${API_BASE}${path}`
  try {
    const res = await fetch(url, opts)
    const text = await res.text()
    try { return JSON.parse(text) } catch (e) { return text }
  } catch (err: any) {
    // network error (DNS, refused, offline)
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
