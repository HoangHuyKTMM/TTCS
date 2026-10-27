const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadHomeFeed(random = Math.random) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/homeFeed.ts'), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  const math = Object.create(Math)
  math.random = random
  vm.runInNewContext(js, { module, exports: module.exports, Math: math })
  return module.exports
}

const ids = books => Array.from(books, book => book.id)
const catalog = count => Array.from({ length: count }, (_, index) => ({ id: String(index), title: `Truyện ${index}` }))

test('quick filters include only populated genres, split multiple genres and remove duplicates', () => {
  const { getAvailableGenres } = loadHomeFeed()
  const genres = getAvailableGenres([
    { genre: ' Ngôn tình, Hiện đại ' },
    { genre: 'ngôn tình, Trinh thám, , Trinh thám' },
    { genre: null },
    { genre: '' },
  ], ['Tất cả', 'Ngôn tình', 'Cổ đại', 'Hiện đại'])
  assert.deepEqual(Array.from(genres), ['Tất cả', 'Ngôn tình', 'Hiện đại', 'Trinh thám'])
  assert.deepEqual(Array.from(getAvailableGenres([])), ['Tất cả'])
})

test('recommendations contain five distinct stories without modifying the catalog', () => {
  const { pickHomeRecommendations } = loadHomeFeed()
  const books = catalog(12)
  const before = ids(books)
  const selected = pickHomeRecommendations([...books, books[0]])
  assert.equal(selected.length, 5)
  assert.equal(new Set(ids(selected)).size, 5)
  assert.ok(selected.every(book => books.includes(book)))
  assert.deepEqual(ids(books), before)
})

test('a repeating shuffle still introduces a different story when more than five exist', () => {
  const { pickHomeRecommendations } = loadHomeFeed(() => 0.999)
  const books = catalog(6)
  let previous = books.slice(0, 5)
  for (let event = 0; event < 20; event++) {
    const next = pickHomeRecommendations(books, previous)
    assert.equal(next.length, 5)
    assert.equal(new Set(ids(next)).size, 5)
    assert.ok(next.some(book => !ids(previous).includes(book.id)))
    previous = next
  }
})

test('small catalogs keep all available stories and change order after a repeating shuffle', () => {
  const { pickHomeRecommendations } = loadHomeFeed(() => 0.999)
  for (const size of [2, 3, 4, 5]) {
    const books = catalog(size)
    const selected = pickHomeRecommendations(books, books)
    assert.equal(selected.length, size)
    assert.notDeepEqual(ids(selected), ids(books))
    assert.deepEqual(ids(selected).sort(), ids(books).sort())
  }
  assert.deepEqual(ids(pickHomeRecommendations([])), [])
  assert.deepEqual(ids(pickHomeRecommendations(catalog(1), catalog(1))), ['0'])
})

test('refreshes use the latest catalog and drop stories that are no longer available', () => {
  const { pickHomeRecommendations } = loadHomeFeed()
  const previous = catalog(10)
  const latest = [{ id: 'new-1' }, { id: 'new-2' }]
  assert.deepEqual(ids(pickHomeRecommendations(latest, previous)).sort(), ['new-1', 'new-2'])
})

test('successive random selections keep five unique stories and change the group', () => {
  const { pickHomeRecommendations } = loadHomeFeed()
  const books = catalog(20)
  let previous = []
  for (let event = 0; event < 200; event++) {
    const next = pickHomeRecommendations(books, previous)
    assert.equal(next.length, 5)
    assert.equal(new Set(ids(next)).size, 5)
    assert.ok(next.some(book => !ids(previous).includes(book.id)))
    previous = next
  }
})
