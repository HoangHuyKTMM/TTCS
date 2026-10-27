type GenreBook = { genre?: string | null }
type IdentifiedBook = { id: string }

const genreKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('vi-VN')

export function bookHasGenre(book: GenreBook, genre: string): boolean {
  return (book.genre || '').split(',').some(name => genreKey(name) === genreKey(genre))
}

export function getPopulatedCatalogGenres(books: readonly GenreBook[], catalog: readonly string[]): string[] {
  const populated = new Set(getAvailableGenres(books).slice(1).map(genreKey))
  const filters = ['Tất cả']
  for (const value of catalog) {
    const name = value.trim()
    const key = genreKey(name)
    if (!name || !populated.has(key)) continue
    filters.push(name)
    populated.delete(key)
  }
  return filters
}

export function getAvailableGenres(books: readonly GenreBook[], preferredOrder: readonly string[] = []): string[] {
  const names = new Map<string, string>()
  for (const book of books) {
    for (const value of (book.genre || '').split(',')) {
      const name = value.trim()
      const key = genreKey(name)
      if (name && key !== 'tất cả' && !names.has(key)) names.set(key, name)
    }
  }

  const genres: string[] = []
  for (const name of preferredOrder) {
    const key = genreKey(name)
    if (names.has(key)) {
      genres.push(name)
      names.delete(key)
    }
  }
  return ['Tất cả', ...genres, ...Array.from(names.values()).sort((a, b) => a.localeCompare(b, 'vi-VN'))]
}

export function pickHomeRecommendations<T extends IdentifiedBook>(books: readonly T[], previous: readonly IdentifiedBook[] = [], count = 5): T[] {
  const pool = Array.from(new Map(books.map(book => [book.id, book])).values())
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  const selected = pool.slice(0, count)
  const previousIds = new Set(previous.map(book => book.id))
  // Always introduce a different item when the catalog exceeds the visible count.
  if (selected.length === count && selected.every(book => previousIds.has(book.id))) {
    const replacement = pool.slice(count).find(book => !previousIds.has(book.id))
    if (replacement) selected[selected.length - 1] = replacement
  }
  // Small catalogs can still change order, even if the shuffle repeats itself.
  if (selected.length > 1 && selected.every((book, index) => book.id === previous[index]?.id)) {
    selected.push(selected.shift()!)
  }
  return selected
}
