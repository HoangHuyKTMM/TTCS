import * as SecureStore from 'expo-secure-store'
import * as Auth from './auth'

const KEY = 'reader_app_reading'

export type ReadingItem = {
  bookId: string
  chapter?: string
  chapterNo?: number
  title?: string
  cover?: string
  genre?: string
  updated_at?: string
}

async function readRaw(): Promise<Record<string, ReadingItem>> {
  try {
    const s = await SecureStore.getItemAsync(KEY)
    if (!s) return {}
    return JSON.parse(s || '{}')
  } catch (e) {
    return {}
  }
}

async function writeRaw(obj: Record<string, ReadingItem>) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(obj))
  } catch (e) {
    // ignore
  }
}

export async function saveReadingProgress(item: ReadingItem) {
  const map = await readRaw()
  const key = String(item.bookId)
  map[key] = { ...(map[key] || {}), ...item, updated_at: (new Date()).toISOString() }
  await writeRaw(map)
}

export async function getReadingList(): Promise<ReadingItem[]> {
  const map = await readRaw()
  const arr = Object.values(map)
  // sort by updated_at desc
  arr.sort((a, b) => (b.updated_at || '')!.localeCompare(a.updated_at || ''))
  return arr
}

export async function clearReadingFor(bookId: string) {
  const map = await readRaw()
  delete map[String(bookId)]
  await writeRaw(map)
}

export default { saveReadingProgress, getReadingList, clearReadingFor }
