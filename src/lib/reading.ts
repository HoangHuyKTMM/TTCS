import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Auth from './auth'
import { API_BASE, apiGetProgress, apiGetReadingHistory, apiSaveProgress } from './api'
import { chooseReadingBookmark, mergeReadingBookmarks } from './readingProgress'

const KEY = 'reader_app_reading'

export type ReadingItem = {
  bookId: string
  chapter?: string
  chapterNo?: number
  title?: string
  cover?: string
  genre?: string
  progressPct?: number
  updated_at?: string
}

function absCover(cover?: string | null): string | undefined {
  if (!cover) return undefined
  const s = String(cover)
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:')) return s
  return `${API_BASE}${s.startsWith('/') ? s : `/${s}`}`
}

function fromServerRow(r: any): ReadingItem | null {
  if (!r || r.error) return null
  const bookId = String(r.book_id || r.story_id || '')
  if (!bookId) return null
  const chapterNoRaw = r.chapter_no != null ? Number(r.chapter_no) : NaN
  const pctRaw = r.progress_pct != null ? Number(r.progress_pct) : NaN
  const last = r.last_read_at ? new Date(r.last_read_at) : null
  return {
    bookId,
    chapter: r.chapter_id ? String(r.chapter_id) : (Number.isFinite(chapterNoRaw) ? String(chapterNoRaw) : undefined),
    chapterNo: Number.isFinite(chapterNoRaw) && chapterNoRaw > 0 ? chapterNoRaw : undefined,
    title: r.title || undefined,
    cover: absCover(r.cover_url || r.cover),
    genre: r.genre || undefined,
    progressPct: Number.isFinite(pctRaw) ? pctRaw : undefined,
    updated_at: last && !Number.isNaN(last.getTime()) ? last.toISOString() : undefined,
  }
}

function mergeItems(local?: ReadingItem | null, remote?: ReadingItem | null): ReadingItem | null {
  return mergeReadingBookmarks(local, remote)
}

async function ownerId(): Promise<string | null> {
  try {
    const user = await Auth.getUser()
    const id = user && (user.id || user.user_id)
    return id ? String(id) : null
  } catch (e) {
    return null
  }
}

function storageKey(owner: string | null) {
  return owner ? `${KEY}:u:${owner}` : `${KEY}:guest`
}

async function readRaw(): Promise<Record<string, ReadingItem>> {
  try {
    const s = await AsyncStorage.getItem(storageKey(await ownerId()))
    if (!s) return {}
    const parsed = JSON.parse(s)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    return {}
  }
}

async function writeRaw(obj: Record<string, ReadingItem>) {
  try {
    await AsyncStorage.setItem(storageKey(await ownerId()), JSON.stringify(obj))
  } catch (e) {
    // ignore
  }
}

function sortItems(items: ReadingItem[]) {
  items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  return items
}

async function pushItemToServer(item: ReadingItem): Promise<ReadingItem | null> {
  const token = await Auth.getToken()
  if (!token || !item || !item.bookId) return null
  try {
    const saved = await apiSaveProgress({
      book_id: String(item.bookId),
      chapter_id: item.chapter,
      chapter_no: item.chapterNo,
      progress: item.progressPct,
    }, token)
    return fromServerRow(saved)
  } catch (e) {
    return null
  }
}

export async function saveReadingProgress(item: ReadingItem) {
  const map = await readRaw()
  const key = String(item.bookId)
  const prev = map[key] || {}
  const kept = chooseReadingBookmark(prev, {
    ...item,
    bookId: key,
    cover: absCover(item.cover) || prev.cover,
  })
  const next: ReadingItem = {
    ...kept,
    bookId: key,
    updated_at: new Date().toISOString(),
  }
  map[key] = next
  await writeRaw(map)
  const remote = await pushItemToServer(next)
  const merged = mergeItems(next, remote)
  if (merged && (merged.chapterNo !== next.chapterNo || merged.progressPct !== next.progressPct)) {
    map[key] = { ...merged, bookId: key, updated_at: next.updated_at }
    await writeRaw(map)
  }
}

export async function getReadingList(): Promise<ReadingItem[]> {
  const local = await readRaw()
  const token = await Auth.getToken()
  if (token) {
    try {
      const list: any = await apiGetReadingHistory(token)
      if (Array.isArray(list)) {
        const next: Record<string, ReadingItem> = {}
        for (const row of list) {
          const remote = fromServerRow(row)
          if (!remote) continue
          next[remote.bookId] = mergeItems(local[remote.bookId], remote) as ReadingItem
        }
        for (const [id, item] of Object.entries(local)) {
          if (item && item.bookId && !next[id]) next[id] = item
        }
        await writeRaw(next)
        return sortItems(Object.values(next))
      }
    } catch (e) {
      // offline: keep this account's cache
    }
  }
  return sortItems(Object.values(local).filter((item) => item && item.bookId))
}

export async function clearReadingFor(bookId: string) {
  const map = await readRaw()
  delete map[String(bookId)]
  await writeRaw(map)
}

export async function getReadingProgress(bookId: string): Promise<ReadingItem | null> {
  const key = String(bookId)
  const map = await readRaw()
  let local = map[key] || null
  const token = await Auth.getToken()
  if (!token) return local
  try {
    const row: any = await apiGetProgress(key, token)
    const remote = fromServerRow(row)
    const merged = mergeItems(local, remote)
    if (merged) {
      map[key] = merged
      await writeRaw(map)
    }
    return merged
  } catch (e) {
    return local
  }
}

/** Push local cache to server then pull remote history. Called after login. */
export async function hydrateReadingProgress() {
  const token = await Auth.getToken()
  if (!token) return
  const guestKey = `${KEY}:guest`
  let guestMap: Record<string, ReadingItem> = {}
  try {
    const raw = await AsyncStorage.getItem(guestKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') guestMap = parsed
    }
  } catch (e) {
    guestMap = {}
  }
  const map = await readRaw()
  for (const [id, item] of Object.entries(guestMap)) {
    if (!item || !item.bookId) continue
    const merged = mergeItems(map[id], item)
    if (merged) map[id] = merged
  }
  if (Object.keys(guestMap).length) {
    await writeRaw(map)
    try { await AsyncStorage.removeItem(guestKey) } catch (e) { /* ignore */ }
  }
  for (const item of Object.values(map)) {
    await pushItemToServer(item)
  }
  try {
    const list: any = await apiGetReadingHistory(token)
    if (!Array.isArray(list)) return
    const fresh = await readRaw()
    const next: Record<string, ReadingItem> = {}
    for (const row of list) {
      const remote = fromServerRow(row)
      if (!remote) continue
      next[remote.bookId] = mergeItems(fresh[remote.bookId], remote) as ReadingItem
    }
    for (const [id, item] of Object.entries(fresh)) {
      if (item && item.bookId && !next[id]) next[id] = item
    }
    await writeRaw(next)
  } catch (e) {
    // ignore
  }
}

export default { saveReadingProgress, getReadingList, clearReadingFor, getReadingProgress, hydrateReadingProgress }
