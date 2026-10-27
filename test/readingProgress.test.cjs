const { test } = require('node:test')
const assert = require('node:assert/strict')
const { chooseReadingBookmark, mergeReadingBookmarks, chooseStoredChapter } = require('../src/lib/readingProgress')

test('leaving an earlier chapter keeps the furthest chapter and its scroll percent', () => {
  const saved = chooseReadingBookmark(
    { bookId: '10', chapterNo: 10, chapter: '271', progressPct: 40, title: 'Truyện' },
    { bookId: '10', chapterNo: 1, chapter: '262', progressPct: 91, title: 'Truyện' }
  )
  assert.equal(saved.chapterNo, 10)
  assert.equal(saved.chapter, '271')
  assert.equal(saved.progressPct, 40)
})

test('opening a later chapter moves the continue bookmark forward', () => {
  const saved = chooseReadingBookmark(
    { bookId: '10', chapterNo: 2, chapter: '263', progressPct: 80 },
    { bookId: '10', chapterNo: 6, chapter: '267', progressPct: 0 }
  )
  assert.equal(saved.chapterNo, 6)
  assert.equal(saved.chapter, '267')
  assert.equal(saved.progressPct, 0)
})

test('merge keeps the highest chapter even when the exit chapter was saved later', () => {
  const merged = mergeReadingBookmarks(
    { bookId: '10', chapterNo: 1, progressPct: 91, updated_at: '2026-10-05T10:00:00.000Z' },
    { bookId: '10', chapterNo: 10, chapter: '271', progressPct: undefined, updated_at: '2026-10-04T10:00:00.000Z' }
  )
  assert.equal(merged.chapterNo, 10)
  assert.equal(merged.chapter, '271')
  assert.equal(merged.progressPct, undefined)
  assert.equal(merged.updated_at, '2026-10-05T10:00:00.000Z')
})

test('chapter views raise the stored exit chapter and drop that chapter\'s scroll percent', () => {
  const choice = chooseStoredChapter({
    storedNo: 1,
    incomingNo: 1,
    viewedNo: 10,
    storedProgress: 91.62,
    incomingProgress: 95,
  })
  assert.equal(choice.chapterNo, 10)
  assert.equal(choice.source, 'viewed')
  assert.equal(choice.progress, null)
  assert.equal(choice.replaceProgress, true)
})

test('a later save updates progress only for that furthest chapter', () => {
  const same = chooseStoredChapter({
    storedNo: 10,
    incomingNo: 10,
    viewedNo: 10,
    storedProgress: 10,
    incomingProgress: 55,
  })
  assert.equal(same.source, 'incoming')
  assert.equal(same.progress, 55)

  const older = chooseStoredChapter({
    storedNo: 10,
    incomingNo: 3,
    viewedNo: 10,
    storedProgress: 55,
    incomingProgress: 90,
  })
  assert.equal(older.source, 'stored')
  assert.equal(older.chapterNo, 10)
  assert.equal(older.replaceProgress, false)
  assert.equal(older.progress, 55)
})
