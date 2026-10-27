import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import { apiFetchBook, apiFetchChapters, apiFetchChapter } from './api'
import * as Auth from './auth'

const INDEX_KEY = 'reader_app_offline_index_v1'
// expo-file-system v19 ships a new API; legacy exports exist at runtime but their TS types are not exposed via the package "types" entry.
// Use a narrowly-scoped any alias to keep strict TS happy.
const FS: any = FileSystem as any
const BASE_DIR = `${FS.documentDirectory || ''}offline/`

export type OfflineBookMeta = {
  bookId: string
  title?: string
  cover?: string | null
  genre?: string
  chaptersCount?: number
  downloadedAt?: string
  bytes?: number
  partial?: boolean
  savedCount?: number
}

type OfflineBookFile = {
  meta: OfflineBookMeta
  chapters: Array<{ chapterNo: number; title?: string; content: string }>
}

async function currentScope(): Promise<string> {
  try {
    const user = await Auth.getUser()
    const id = user && (user.id || user.user_id)
    if (id != null && String(id)) {
      const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_')
      return `u_${safe}`
    }
  } catch {
    // guest
  }
  return 'guest'
}

function indexKeyFor(scope: string) {
  return `${INDEX_KEY}_${scope}`
}

function scopeDir(scope: string) {
  return `${BASE_DIR}${scope}/`
}

function filePathFor(scope: string, bookId: string) {
  return `${scopeDir(scope)}book_${encodeURIComponent(String(bookId))}.json`
}

async function ensureDir(scope: string) {
  try {
    const dir = scopeDir(scope)
    const info = await FS.getInfoAsync(dir)
    if (!info.exists) {
      await FS.makeDirectoryAsync(dir, { intermediates: true })
    }
  } catch {
    // ignore
  }
}

async function readIndex(scope: string): Promise<Record<string, OfflineBookMeta>> {
  try {
    const s = await SecureStore.getItemAsync(indexKeyFor(scope))
    if (!s) return {}
    return JSON.parse(s)
  } catch {
    return {}
  }
}

async function writeIndex(scope: string, map: Record<string, OfflineBookMeta>) {
  try {
    await SecureStore.setItemAsync(indexKeyFor(scope), JSON.stringify(map))
  } catch {
    // ignore
  }
}

export async function listOfflineBooks(): Promise<OfflineBookMeta[]> {
  const scope = await currentScope()
  const map = await readIndex(scope)
  const arr = Object.values(map)
  arr.sort((a, b) => (b.downloadedAt || '').localeCompare(a.downloadedAt || ''))
  return arr
}

export async function isBookDownloaded(bookId: string): Promise<boolean> {
  const scope = await currentScope()
  const fp = filePathFor(scope, bookId)
  try {
    const info = await FS.getInfoAsync(fp)
    return !!info.exists
  } catch {
    return false
  }
}

export async function removeOfflineBook(bookId: string) {
  const scope = await currentScope()
  await ensureDir(scope)
  const fp = filePathFor(scope, bookId)
  try {
    await FS.deleteAsync(fp, { idempotent: true })
  } catch {
    // ignore
  }
  const map = await readIndex(scope)
  delete map[String(bookId)]
  await writeIndex(scope, map)
}

export async function downloadBookOffline(
  bookId: string,
  opts?: { token?: string; onProgress?: (p: { done: number; total: number }) => void }
): Promise<OfflineBookMeta> {
  const scope = await currentScope()
  await ensureDir(scope)

  const token = opts?.token
  const onProgress = opts?.onProgress

  // Get book metadata
  const book: any = await apiFetchBook(String(bookId), token)
  const title = book?.title || book?.name || `Truyện #${bookId}`
  const cover = book?.cover_url || null
  const genre = book?.genre || book?.category || book?.type

  // Get chapters list (to determine total)
  const chaptersList: any = await apiFetchChapters(String(bookId), token)
  const total = Array.isArray(chaptersList) ? chaptersList.length : (Number(book?.chapters_count) || (Array.isArray(book?.chapters) ? book.chapters.length : 0) || 0)

  const chapters: OfflineBookFile['chapters'] = []
  const fetchCount = Math.max(1, total)
  let partial = false

  for (let i = 1; i <= fetchCount; i++) {
    // Prefer explicit chapter id from list if available
    let chId: string = String(i)
    if (Array.isArray(chaptersList) && chaptersList[i - 1]) {
      const c = chaptersList[i - 1]
      chId = String(c.id || c.chapter_id || c.chapter_no || i)
    }

    let ch: any = null
    try {
      ch = await apiFetchChapter(String(bookId), chId, token)
    } catch (e) {
      if (chapters.length === 0) throw e
      partial = true
      break
    }
    const content = typeof ch?.content === 'string' ? ch.content : (typeof ch?.body === 'string' ? ch.body : (typeof ch?.text === 'string' ? ch.text : ''))
    if (!content || ch?.error) {
      if (chapters.length === 0) {
        const err: any = new Error(ch?.message ? String(ch.message) : 'Không tải được chương')
        err.code = ch?.error || 'empty_chapter'
        throw err
      }
      partial = true
      break
    }
    const chTitle = ch?.title || (Array.isArray(chaptersList) && chaptersList[i - 1] ? (chaptersList[i - 1].title || chaptersList[i - 1].name) : undefined)

    const listed = Array.isArray(chaptersList) ? chaptersList[i - 1] : null
    chapters.push({ chapterNo: Number(ch?.chapter_no || listed?.chapter_no || listed?.chapterNo || i), title: chTitle, content })
    onProgress?.({ done: chapters.length, total: fetchCount })
  }

  if (chapters.length === 0) {
    throw new Error('Không tải được chương nào')
  }

  const meta: OfflineBookMeta = {
    bookId: String(bookId),
    title,
    cover,
    genre,
    chaptersCount: chapters.length,
    savedCount: chapters.length,
    partial,
    downloadedAt: new Date().toISOString(),
  }

  const file: OfflineBookFile = { meta, chapters }
  const fp = filePathFor(scope, bookId)
  const json = JSON.stringify(file)
  await FS.writeAsStringAsync(fp, json)

  try {
    const info = await FS.getInfoAsync(fp)
    if (info.exists && typeof info.size === 'number') meta.bytes = info.size
  } catch {
    // ignore
  }

  const map = await readIndex(scope)
  map[String(bookId)] = meta
  await writeIndex(scope, map)

  return meta
}

export async function getOfflineChapter(bookId: string, chapterNo: number): Promise<{ content: string; title?: string; chaptersTotal?: number; chapterNumbers?: number[]; bookTitle?: string; cover?: string | null; genre?: string } | null> {
  const scope = await currentScope()
  const fp = filePathFor(scope, bookId)
  try {
    const info = await FS.getInfoAsync(fp)
    if (!info.exists) return null
    const raw = await FS.readAsStringAsync(fp)
    const data = JSON.parse(raw) as OfflineBookFile
    const total = Array.isArray(data?.chapters) ? data.chapters.length : undefined
    const ch = Array.isArray(data?.chapters) ? data.chapters.find(c => Number(c.chapterNo) === Number(chapterNo)) : null
    if (!ch || !ch.content) return null
    return {
      content: ch.content,
      title: ch.title,
      chaptersTotal: total,
      chapterNumbers: data.chapters.map(c => Number(c.chapterNo)),
      bookTitle: data.meta?.title,
      cover: data.meta?.cover,
      genre: data.meta?.genre,
    }
  } catch {
    return null
  }
}

export function formatBytes(bytes?: number) {
  const b = Number(bytes || 0)
  if (!b || !Number.isFinite(b)) return ''
  if (b < 1024) return `${b} B`
  const kb = b / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}
