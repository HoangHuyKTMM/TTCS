export type ReadingBookmark = {
  bookId?: string
  chapter?: string
  chapterNo?: number
  title?: string
  cover?: string
  genre?: string
  progressPct?: number
  updated_at?: string
}

export function chapterNumber(item: { chapterNo?: number } | null | undefined): number

export function chooseReadingBookmark<T extends ReadingBookmark>(previous: T | null | undefined, incoming: T): T

export function mergeReadingBookmarks<T extends ReadingBookmark>(local?: T | null, remote?: T | null): T | null

export function chooseStoredChapter(input: {
  storedNo?: unknown
  incomingNo?: unknown
  viewedNo?: unknown
  storedProgress?: unknown
  incomingProgress?: unknown
}): {
  chapterNo: number | null
  progress: number | null
  replaceProgress: boolean
  source: 'empty' | 'incoming' | 'stored' | 'viewed'
}
