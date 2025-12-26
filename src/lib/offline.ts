import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import { apiFetchBook, apiFetchChapters, apiFetchChapter } from './api'

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
}

type OfflineBookFile = {
  meta: OfflineBookMeta
  chapters: Array<{ chapterNo: number; title?: string; content: string }>
}

function filePathFor(bookId: string) {
  return `${BASE_DIR}book_${encodeURIComponent(String(bookId))}.json`
}

async function ensureDir() {
  try {
    const info = await FS.getInfoAsync(BASE_DIR)
    if (!info.exists) {
      await FS.makeDirectoryAsync(BASE_DIR, { intermediates: true })
    }
  } catch {
    // ignore
  }
}

async function readIndex(): Promise<Record<string, OfflineBookMeta>> {
  try {
    const s = await SecureStore.getItemAsync(INDEX_KEY)
    if (!s) return {}
    return JSON.parse(s)
  } catch {
    return {}
  }
}

async function writeIndex(map: Record<string, OfflineBookMeta>) {
  try {
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export async function listOfflineBooks(): Promise<OfflineBookMeta[]> {
  const map = await readIndex()
  const arr = Object.values(map)
  arr.sort((a, b) => (b.downloadedAt || '').localeCompare(a.downloadedAt || ''))
  return arr
}

export async function isBookDownloaded(bookId: string): Promise<boolean> {
  const fp = filePathFor(bookId)
  try {
    const info = await FS.getInfoAsync(fp)
    return !!info.exists
  } catch {
    return false
  }
}

export async function removeOfflineBook(bookId: string) {
  await ensureDir()
  const fp = filePathFor(bookId)
  try {
    await FS.deleteAsync(fp, { idempotent: true })
  } catch {
    // ignore
  }
  const map = await readIndex()
  delete map[String(bookId)]
  await writeIndex(map)
}

export async function downloadBookOffline(
  bookId: string,
  opts?: { token?: string; onProgress?: (p: { done: number; total: number }) => void }
): Promise<OfflineBookMeta> {
  await ensureDir()

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

  for (let i = 1; i <= fetchCount; i++) {
    // Prefer explicit chapter id from list if available
    let chId: string = String(i)
    if (Array.isArray(chaptersList) && chaptersList[i - 1]) {
      const c = chaptersList[i - 1]
      chId = String(c.id || c.chapter_id || c.chapter_no || i)
    }

    const ch: any = await apiFetchChapter(String(bookId), chId, token)
    const content = typeof ch?.content === 'string' ? ch.content : (typeof ch?.body === 'string' ? ch.body : (typeof ch?.text === 'string' ? ch.text : ''))
    const chTitle = ch?.title || (Array.isArray(chaptersList) && chaptersList[i - 1] ? (chaptersList[i - 1].title || chaptersList[i - 1].name) : undefined)

    chapters.push({ chapterNo: i, title: chTitle, content: content || '' })
    onProgress?.({ done: i, total: fetchCount })
  }

  const meta: OfflineBookMeta = {
    bookId: String(bookId),
    title,
    cover,
    genre,
    chaptersCount: fetchCount,
    downloadedAt: new Date().toISOString(),
  }

  const file: OfflineBookFile = { meta, chapters }
  const fp = filePathFor(bookId)
  const json = JSON.stringify(file)
  await FS.writeAsStringAsync(fp, json)

  try {
    const info = await FS.getInfoAsync(fp)
    if (info.exists && typeof info.size === 'number') meta.bytes = info.size
  } catch {
    // ignore
  }

  const map = await readIndex()
  map[String(bookId)] = meta
  await writeIndex(map)

  return meta
}

export async function getOfflineChapter(bookId: string, chapterNo: number): Promise<{ content: string; title?: string; chaptersTotal?: number } | null> {
  const fp = filePathFor(bookId)
  try {
    const info = await FS.getInfoAsync(fp)
    if (!info.exists) return null
    const raw = await FS.readAsStringAsync(fp)
    const data = JSON.parse(raw) as OfflineBookFile
    const total = Array.isArray(data?.chapters) ? data.chapters.length : undefined
    const idx = Math.max(1, Number(chapterNo)) - 1
    const ch = Array.isArray(data?.chapters) ? data.chapters[idx] : null
    if (!ch || !ch.content) return null
    return { content: ch.content, title: ch.title, chaptersTotal: total }
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
