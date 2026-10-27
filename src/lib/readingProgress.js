function positiveInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function chapterNumber(item) {
  return positiveInt(item && item.chapterNo)
}

function newer(a, b) {
  return String((a && a.updated_at) || '') >= String((b && b.updated_at) || '')
}

// The continue bookmark is the highest chapter ever opened.
// Leaving an earlier chapter must not move it or reuse that chapter's scroll percent.
function chooseReadingBookmark(previous, incoming) {
  const prev = previous || {}
  const next = incoming || {}
  const prevNo = chapterNumber(prev)
  const nextNo = chapterNumber(next)
  if (prevNo > nextNo && nextNo > 0) {
    return {
      ...prev,
      ...next,
      bookId: next.bookId || prev.bookId,
      title: next.title || prev.title,
      cover: next.cover || prev.cover,
      genre: next.genre || prev.genre,
      chapter: prev.chapter || next.chapter,
      chapterNo: prevNo,
      progressPct: prev.progressPct != null ? prev.progressPct : next.progressPct,
    }
  }
  return {
    ...prev,
    ...next,
    bookId: next.bookId || prev.bookId,
    title: next.title || prev.title,
    cover: next.cover || prev.cover,
    genre: next.genre || prev.genre,
    chapter: next.chapter || prev.chapter,
    chapterNo: nextNo > 0 ? nextNo : (prevNo > 0 ? prevNo : next.chapterNo),
    progressPct: next.progressPct != null ? next.progressPct : prev.progressPct,
  }
}

function mergeReadingBookmarks(local, remote) {
  if (!local) return remote || null
  if (!remote) return local
  const localNo = chapterNumber(local)
  const remoteNo = chapterNumber(remote)
  const recent = newer(remote, local) ? remote : local
  const older = recent === remote ? local : remote
  const furthest = localNo === remoteNo ? recent : (localNo > remoteNo ? local : remote)
  const other = furthest === local ? remote : local
  const sameChapter = localNo > 0 && localNo === remoteNo
  return {
    ...other,
    ...recent,
    bookId: furthest.bookId || recent.bookId,
    title: recent.title || older.title,
    cover: recent.cover || older.cover,
    genre: recent.genre || older.genre,
    chapter: furthest.chapter || other.chapter,
    chapterNo: furthest.chapterNo || other.chapterNo,
    progressPct: sameChapter
      ? (recent.progressPct != null ? recent.progressPct : older.progressPct)
      : furthest.progressPct,
    updated_at: recent.updated_at || older.updated_at,
  }
}

function chooseStoredChapter({ storedNo, incomingNo, viewedNo, storedProgress, incomingProgress }) {
  const stored = positiveInt(storedNo)
  const incoming = positiveInt(incomingNo)
  const viewed = positiveInt(viewedNo)
  const chapterNo = Math.max(stored, incoming, viewed)
  if (!chapterNo) {
    return { chapterNo: null, progress: null, replaceProgress: false, source: 'empty' }
  }
  if (incoming === chapterNo) {
    const sameChapter = incoming === stored
    return {
      chapterNo,
      progress: incomingProgress == null ? (sameChapter ? numberOrNull(storedProgress) : null) : Number(incomingProgress),
      replaceProgress: !sameChapter || incomingProgress != null,
      source: 'incoming',
    }
  }
  if (stored === chapterNo) {
    return { chapterNo, progress: numberOrNull(storedProgress), replaceProgress: false, source: 'stored' }
  }
  return { chapterNo, progress: null, replaceProgress: true, source: 'viewed' }
}

function numberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

module.exports = {
  chapterNumber,
  chooseReadingBookmark,
  mergeReadingBookmarks,
  chooseStoredChapter,
}
