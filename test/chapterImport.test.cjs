const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadChapterImport({ platform = 'android', read = async () => 'Nội dung tiếng Việt', fetch,
  extractDocxText = () => 'Nội dung Word tiếng Việt' } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/chapterImport.ts'), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  const modules = {
    'react-native': { Platform: { OS: platform } },
    'expo-file-system/legacy': { readAsStringAsync: read, EncodingType: { UTF8: 'utf8', Base64: 'base64' } },
    'base64-js': { toByteArray: value => Uint8Array.from(Buffer.from(value, 'base64')) },
    './docxText': { extractDocxText, MAX_WORD_FILE_BYTES: 10 * 1024 * 1024 },
  }
  vm.runInNewContext(js, { module, exports: module.exports, Error, fetch, require: name => {
    if (!(name in modules)) throw new Error('Unexpected import: ' + name)
    return modules[name]
  } })
  return module.exports
}

test('UTF-8 text import keeps Vietnamese text and normalizes BOM and line endings', () => {
  const { prepareChapterDraft } = loadChapterImport()
  const draft = prepareChapterDraft('Chương 1 - Khởi đầu.TXT', '\uFEFFĐêm đã xuống.\r\n\r\nCô bước ra ngoài.\rSáng hôm sau.\n')
  assert.equal(draft.title, 'Chương 1 - Khởi đầu')
  assert.equal(draft.content, 'Đêm đã xuống.\n\nCô bước ra ngoài.\nSáng hôm sau.')
  assert.equal(prepareChapterDraft('Chương 2.md', '# Tiêu đề\nNội dung').content, '# Tiêu đề\nNội dung')
})

test('invalid extensions, empty files, corrupt encoding and oversized chapters are rejected', () => {
  const { prepareChapterDraft, MAX_CHAPTER_CHARACTERS } = loadChapterImport()
  assert.throws(() => prepareChapterDraft('chapter.pdf', 'abc'), /Chỉ hỗ trợ/)
  assert.throws(() => prepareChapterDraft('empty.txt', '\uFEFF \r\n'), /không có nội dung/)
  assert.throws(() => prepareChapterDraft('binary.txt', 'abc\u0000'), /UTF-8/)
  assert.throws(() => prepareChapterDraft('corrupt.txt', 'abc\uFFFD'), /UTF-8/)
  assert.throws(() => prepareChapterDraft('long.txt', 'a'.repeat(MAX_CHAPTER_CHARACTERS + 1)), /80.000/)
  assert.equal(prepareChapterDraft('limit.txt', 'a'.repeat(MAX_CHAPTER_CHARACTERS)).content.length, MAX_CHAPTER_CHARACTERS)
})

test('native picker files are read as UTF-8 in numeric filename order without changing the selection', async () => {
  const reads = []
  const { readChapterFiles } = loadChapterImport({ read: async (uri, opts) => {
    reads.push([uri, opts.encoding])
    return 'Nội dung ' + uri
  } })
  const files = [10, 2, 1].map(number => ({ name: `Chương ${number}.txt`, uri: `file:///${number}` }))
  const result = await readChapterFiles(files)
  assert.deepEqual(Array.from(result.drafts, draft => draft.title), ['Chương 1', 'Chương 2', 'Chương 10'])
  assert.deepEqual(reads, [['file:///1', 'utf8'], ['file:///2', 'utf8'], ['file:///10', 'utf8']])
  assert.deepEqual(files.map(file => file.name), ['Chương 10.txt', 'Chương 2.txt', 'Chương 1.txt'])
  assert.equal(result.errors.length, 0)
})

test('web reads the original browser File or falls back to its URI', async () => {
  const { readChapterFiles } = loadChapterImport({ platform: 'web',
    read: () => { throw new Error('Native API must not be used on web') },
    fetch: async uri => ({ ok: uri === 'blob:chapter', text: async () => 'Chương đọc bằng URI' }),
  })
  const result = await readChapterFiles([
    { name: '1.txt', uri: 'blob:first', file: { text: async () => 'Đọc từ File' } },
    { name: '2.md', uri: 'blob:chapter' },
    { name: '3.txt', uri: 'blob:missing' },
  ])
  assert.deepEqual(Array.from(result.drafts, draft => draft.content), ['Đọc từ File', 'Chương đọc bằng URI'])
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /3.txt.*Không đọc được/)
})

test('unreadable files do not prevent valid files from being previewed', async () => {
  const reads = []
  const { readChapterFiles } = loadChapterImport({ read: async uri => {
    reads.push(uri)
    if (uri === 'bad') throw new Error('Không mở được file')
    return 'Nội dung hợp lệ'
  } })
  const result = await readChapterFiles([
    { name: '1.txt', uri: 'bad' },
    { name: '2.pdf', uri: 'wrong-type' },
    { name: '3.txt', uri: 'too-large', size: 1000000 },
    { name: '4.txt', uri: 'good' },
  ])
  assert.deepEqual(Array.from(result.drafts, draft => draft.fileName), ['4.txt'])
  assert.equal(result.errors.length, 3)
  assert.deepEqual(reads, ['bad', 'good'])
})

test('native Word files are read as base64 and decoded before extraction', async () => {
  let readOptions, extracted
  const { readChapterFiles } = loadChapterImport({
    read: async (_uri, options) => { readOptions = options; return 'AQID' },
    extractDocxText: bytes => { extracted = Array.from(bytes); return 'Nội dung Word' },
  })
  const result = await readChapterFiles([{ name: '1.docx', uri: 'file:///1' }])
  assert.equal(readOptions.encoding, 'base64')
  assert.deepEqual(extracted, [1, 2, 3])
  assert.deepEqual(Array.from(result.drafts, draft => draft.content), ['Nội dung Word'])
  assert.equal(result.errors.length, 0)
})

test('web Word files read binary data from the File or its URI', async () => {
  const extracted = []
  const { readChapterFiles } = loadChapterImport({
    platform: 'web',
    read: () => { throw new Error('Native API must not be used on web') },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer }),
    extractDocxText: bytes => { extracted.push(Array.from(bytes)); return 'Nội dung Word' },
  })
  const result = await readChapterFiles([
    { name: '1.docx', uri: 'blob:first', file: { text: async () => 'unused', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } },
    { name: '2.docx', uri: 'blob:second' },
  ])
  assert.deepEqual(extracted, [[1, 2, 3], [4, 5, 6]])
  assert.equal(result.drafts.length, 2)
  assert.equal(result.errors.length, 0)
})

test('all edited drafts are validated before submitting any chapters', async () => {
  const { prepareChapterDraft, submitImportedChapters } = loadChapterImport()
  let calls = 0
  const drafts = ['1.txt', '2.txt'].map(name => prepareChapterDraft(name, 'Nội dung'))
  drafts[1].title = ' '
  const result = await submitImportedChapters(drafts, async () => { calls++; return { id: '1' } })
  assert.equal(calls, 0)
  assert.equal(result.savedIds.length, 0)
  assert.match(result.error, /2.txt.*tiêu đề/)
})

test('chapters are published sequentially and retain moderation status and progress', async () => {
  const { prepareChapterDraft, submitImportedChapters } = loadChapterImport()
  const titles = [], progress = []
  let running = 0
  const drafts = ['1.txt', '2.txt', '3.txt'].map(name => prepareChapterDraft(name, 'Nội dung'))
  const result = await submitImportedChapters(drafts, async payload => {
    assert.equal(running, 0)
    running++
    titles.push(payload.title)
    await new Promise(setImmediate)
    running--
    return { id: payload.title, status: payload.title === '1' ? 'published' : 'pending_review' }
  }, (draft, completed) => progress.push([draft.fileName, completed]))
  assert.deepEqual(titles, ['1', '2', '3'])
  assert.deepEqual(progress, [['1.txt', 1], ['2.txt', 2], ['3.txt', 3]])
  assert.equal(result.savedIds.length, 3)
  assert.equal(result.pendingCount, 2)
  assert.equal(result.error, null)
})

test('partial failure stops later submissions and retry excludes chapters already saved', async () => {
  const { prepareChapterDraft, submitImportedChapters } = loadChapterImport()
  const drafts = ['1.txt', '2.txt', '3.txt'].map(name => prepareChapterDraft(name, 'Nội dung'))
  const calls = []
  const first = await submitImportedChapters(drafts, async payload => {
    calls.push(payload.title)
    return payload.title === '2' ? { error: 'network' } : { id: payload.title }
  })
  assert.deepEqual(calls, ['1', '2'])
  assert.deepEqual(Array.from(first.savedIds), ['1.txt'])
  assert.match(first.error, /2.txt.*kết nối/)
  const remaining = drafts.filter(draft => !first.savedIds.includes(draft.id))
  const retried = []
  const second = await submitImportedChapters(remaining, async payload => {
    retried.push(payload.title)
    return { id: payload.title }
  })
  assert.deepEqual(retried, ['2', '3'])
  assert.equal(second.savedIds.length, 2)
  assert.equal(second.error, null)
})

test('permission errors, thrown errors and unexpected responses are not treated as success', async () => {
  const { prepareChapterDraft, submitImportedChapters } = loadChapterImport()
  const drafts = [prepareChapterDraft('1.txt', 'Nội dung')]
  for (const response of [{ error: 'forbidden' }, null, 'Internal Server Error', {}]) {
    const result = await submitImportedChapters(drafts, async () => response)
    assert.equal(result.savedIds.length, 0)
    assert.ok(result.error)
  }
  const result = await submitImportedChapters(drafts, async () => { throw new Error('Lỗi máy chủ') })
  assert.equal(result.savedIds.length, 0)
  assert.match(result.error, /Lỗi máy chủ/)
})
