const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const agent = require('../chat_agent')
const integrity = require('../integrity')
const runtime = require('../ai_runtime')

process.env.AI_API_BASE = 'https://audit.invalid/v1'
process.env.AI_API_KEY = 'fixture-only'
process.env.AI_MODEL = 'fixture-model'
delete process.env.LANGFUSE_PUBLIC_KEY
delete process.env.LANGFUSE_SECRET_KEY
const originalFetch = global.fetch
after(() => { global.fetch = originalFetch; runtime.configure(null) })

function dbFixture(extra = {}) {
  let cache = null
  return {
    getBookById: async id => ({ id, title: 'Truyện thật', genre: 'Tiên hiệp' }),
    getVerifiedReadingChapter: async () => 20,
    getChaptersInRange: async (_id, _from, to) => [{ chapter_no: to, title: 'Chìa khóa', content: 'Lan tìm được chiếc chìa khóa đồng trong khu vườn.' }],
    getStorySummaryCache: async (_id, _from, _to, hash) => cache?.source_hash === hash ? cache.summary_text : null,
    saveStorySummaryCache: async row => { cache = row },
    searchStoriesFulltext: async () => [{ id: 's1', title: 'Truyện thật' }],
    getProgressByUser: async () => [],
    ...extra
  }
}
const complete = async () => ({ content: '• Lan nhặt chìa khóa.', toolCalls: [] })

test('chapter 1 uses no model', async () => {
  let calls = 0
  await agent.getCatchUpSummary(dbFixture(), 's1', 1, async () => { calls++; return complete() })
  assert.equal(calls, 0)
})
test('recap uses every prior chapter, or the chapter the reader names', () => {
  assert.deepEqual(agent.catchUpWindow(20), { fromChapter: 1, toChapter: 19 })
  assert.deepEqual(agent.catchUpWindow(20, 'Tóm tắt các chương đã đọc'), { fromChapter: 1, toChapter: 19 })
  assert.deepEqual(agent.catchUpWindow(20, 'Tóm tắt chương 3'), { fromChapter: 3, toChapter: 3 })
  assert.deepEqual(agent.catchUpWindow(20, 'tóm tắt chương 2 đến chương 8'), { fromChapter: 2, toChapter: 8 })
  assert.deepEqual(agent.catchUpWindow(20, 'Tóm tắt 10 chương trước'), { fromChapter: 10, toChapter: 19 })
  assert.equal(agent.catchUpWindow(1, 'Tóm tắt chương 1'), null)
})
test('who-are-you is answered and is not turned into a book suggestion', async () => {
  let reads = 0
  let calls = 0
  const result = await agent.handleChatRequest({
    db: dbFixture({ getChaptersInRange: async () => { reads++; return [] } }),
    userId: null,
    body: { message: 'Bạn là ai?' },
    complete: async () => { calls++; return { content: 'Tôi là GPT.', toolCalls: [] } }
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.intent, 'chat')
  assert.match(result.payload.reply, /trợ lý đọc/)
  assert.equal(result.payload.reply.includes('GPT'), false)
  assert.equal(result.payload.reply.includes('chưa đủ ý'), false)
  assert.equal(calls, 0)
  assert.equal(reads, 0)
})
test('asking for a genre returns library books when the model is down', async () => {
  const err = new Error('AI HTTP 429')
  err.code = 'ai_request_failed'
  err.status = 429
  let query = ''
  const result = await agent.handleChatRequest({
    db: dbFixture({
      searchStoriesFulltext: async (q) => {
        query = q
        return [{ id: 's1', title: 'Vụ án đêm mưa', genre: 'Trinh thám', description: 'Thám tử theo dấu vết' }]
      }
    }),
    userId: 'u1',
    body: { message: 'Tôi muốn đọc truyện trinh thám' },
    complete: async () => { throw err }
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.intent, 'recommend')
  assert.equal(result.payload.books[0].id, 's1')
  assert.equal(query, 'trinh tham')
  assert.equal(String(result.payload.reply).includes('chưa trả lời được'), false)
  assert.match(result.payload.reply, /Tôi gợi ý các truyện trong thư viện/)
})
test('a named genre with no matches does not invent unrelated books', async () => {
  let recent = 0
  const result = await agent.handleChatRequest({
    db: dbFixture({
      searchStoriesFulltext: async () => [],
      getRecommendationCandidates: async () => { recent++; return [{ id: 'other', title: 'Ngôn tình', genre: 'Ngôn Tình' }] }
    }),
    userId: 'u1',
    body: { message: 'Tôi muốn đọc truyện trinh thám' },
    complete
  })
  assert.equal(recent, 0)
  assert.deepEqual(result.payload.books, [])
  assert.match(result.payload.reply, /Chưa tìm thấy/)
})
test('a dead primary model is retried on the fallback model', async (t) => {
  const previous = process.env.AI_FALLBACK_MODEL
  process.env.AI_FALLBACK_MODEL = 'fallback-model'
  runtime.configure({ consumeAiQuota: async () => true, recordAiUsage: async () => {} })
  const seen = []
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body)
    seen.push(body.model)
    if (seen.length === 1) return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limit' } }) }
    return { ok: true, status: 200, json: async () => ({ model: 'fallback-model', choices: [{ message: { content: 'Duoc.', finish_reason: 'stop' } }] }) }
  }
  t.after(() => {
    process.env.AI_FALLBACK_MODEL = previous
    global.fetch = originalFetch
    runtime.configure(null)
  })
  const result = await agent.chatCompletion({ messages: [{ role: 'user', content: 'Xin truyện' }], task: 'chat' })
  assert.deepEqual(seen, ['fixture-model', 'fallback-model'])
  assert.equal(result.content, 'Duoc.')
})
test('a normal question is sent to the model instead of a suggestion form', async () => {
  let prompt = ''
  const result = await agent.handleChatRequest({
    db: dbFixture(),
    userId: null,
    body: { message: '1 cộng 1 bằng mấy?' },
    complete: async (req) => { prompt = req.messages.at(-1).content; return { content: 'Bằng 2.', toolCalls: [] } }
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.intent, 'chat')
  assert.equal(result.payload.reply, 'Bằng 2.')
  assert.match(prompt, /1 cộng 1/)
  assert.equal(result.payload.needs_clarification, undefined)
})
test('a question about an earlier chapter uses that chapter, not the last ten', async () => {
  let range
  let prompt = ''
  const db = dbFixture({
    getVerifiedReadingChapter: async () => 20,
    getChaptersInRange: async (_id, from, to) => {
      range = [from, to]
      return [{ chapter_no: from, content: 'Sự kiện riêng của chương ba.' }]
    }
  })
  const result = await agent.handleChatRequest({
    db, userId: 'u1', body: { message: 'Chương 3 xảy ra chuyện gì?', book_id: 's1', chapter_no: 20 },
    complete: async (req) => { prompt = req.messages.at(-1).content; return { content: 'Ở chương 3, Lan gặp biển báo.', toolCalls: [] } }
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.intent, 'chat')
  assert.deepEqual(range, [3, 3])
  assert.match(prompt, /Sự kiện riêng của chương ba/)
  assert.equal(result.payload.reply, 'Ở chương 3, Lan gặp biển báo.')
})
test('a plain recap asks for every viewed chapter before the current one', async () => {
  let range
  const db = dbFixture({
    getVerifiedReadingChapter: async () => 20,
    getChaptersInRange: async (_id, from, to) => { range = [from, to]; return [{ chapter_no: 2, content: 'Việc đã đọc' }] }
  })
  await agent.handleChatRequest({ db, userId: 'u1', body: { message: 'Tóm tắt các chương đã đọc', book_id: 's1', chapter_no: 20, intent: 'recap' }, complete })
  assert.deepEqual(range, [1, 19])
})
test('a long read is summarized in parts so an early chapter is still included', async () => {
  const prompts = []
  const db = dbFixture({
    getChaptersInRange: async () => [
      { chapter_no: 1, title: 'Mở', content: 'EARLY_MARKER ' + 'e'.repeat(40000) },
      { chapter_no: 19, title: 'Gần đây', content: 'LATE_MARKER ' + 'l'.repeat(40000) }
    ]
  })
  const model = async (req) => { prompts.push(req.messages.at(-1).content); return { content: '• mốc', toolCalls: [] } }
  const result = await agent.getCatchUpSummary(db, 's1', 20, model)
  assert.ok(prompts.some((item) => item.includes('EARLY_MARKER')))
  assert.ok(prompts.some((item) => item.includes('LATE_MARKER')))
  assert.ok(prompts.length >= 2)
  assert.match(result.summary, /mốc/)
})
test('long cached summaries are reused, with full content ending in the initial prompt', async () => {
  let calls = 0, prompt = ''
  const db = dbFixture({ getChaptersInRange: async () => [{ chapter_no: 19, content: 'Mở đầu. '.repeat(220) + 'TWIST_AT_END' }] })
  const model = async req => { calls++; prompt = req.messages[1].content; return { content: 'a'.repeat(651) } }
  await agent.getCatchUpSummary(db, 's1', 20, model)
  const cached = await agent.getCatchUpSummary(db, 's1', 20, model)
  assert.equal(calls, 1)
  assert.equal(cached.cached, true)
  assert.ok(prompt.includes('TWIST_AT_END'))
})
test('editing content invalidates cache without deleting the old record', async () => {
  let content = 'Phiên bản cũ', calls = 0
  const db = dbFixture({ getChaptersInRange: async () => [{ chapter_no: 19, content }] })
  const model = async () => { calls++; return complete() }
  await agent.getCatchUpSummary(db, 's1', 20, model)
  content = 'Phiên bản mới'
  await agent.getCatchUpSummary(db, 's1', 20, model)
  assert.equal(calls, 2)
})
test('concurrent identical cache misses generate once', async () => {
  let calls = 0
  const db = dbFixture()
  const model = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return complete() }
  await Promise.all([agent.getCatchUpSummary(db, 's1', 20, model), agent.getCatchUpSummary(db, 's1', 20, model)])
  assert.equal(calls, 1)
})
test('guests cannot recap before conversation, chapter, or model work', async () => {
  let reads = 0, created = 0, calls = 0
  const db = dbFixture({
    getChaptersInRange: async () => { reads++; return [] },
    getVerifiedReadingChapter: async () => 20,
    createConversation: async () => { created++; return { id: 1 } },
    addMessage: async () => { created++ }
  })
  const completeSpy = async () => { calls++; return complete() }
  for (const body of [
    { message: 'Tóm tắt giúp tôi', book_id: 's1', chapter_no: 5 },
    { message: 'Tóm tắt 10 chương trước', book_id: 's1', chapter_no: 5, intent: 'recap' }
  ]) {
    const result = await agent.handleChatRequest({ db, userId: null, body, complete: completeSpy })
    assert.equal(result.status, 401)
    assert.equal(result.payload.error, 'login_required')
    assert.equal(result.payload.intent, 'recap')
    assert.match(result.payload.message, /Đăng nhập/)
  }
  assert.equal(reads, 0)
  assert.equal(created, 0)
  assert.equal(calls, 0)
})
test('missing verified progress does not default to the latest chapter', async () => {
  let reads = 0
  const result = await agent.handleChatRequest({ db: dbFixture({ getVerifiedReadingChapter: async () => null,
    getChaptersInRange: async () => { reads++; return [] } }), userId: 'u1', body: { message: 'Tóm tắt', book_id: 's1', intent: 'recap' }, complete })
  assert.equal(result.status, 200)
  assert.equal(reads, 0)
  assert.match(result.payload.reply, /mở một chương/)
})
test('spoofed client progress is clamped and only viewed chapters are requested', async () => {
  let range, permission
  const db = dbFixture({ getVerifiedReadingChapter: async () => 5, getChaptersInRange: async (_id, from, to, reader) => {
    range = [from, to]; permission = reader; return [{ chapter_no: 4, content: 'Sự kiện đã đọc' }]
  } })
  await agent.handleChatRequest({ db, userId: 'u1', body: { message: 'Tóm tắt', book_id: 's1', chapter_no: 100, intent: 'recap' }, complete })
  assert.deepEqual(range, [1, 4])
  assert.equal(permission.readerKey, 'u1')
  assert.equal(permission.requireViewed, true)
})
test('foreign conversations are rejected before history or model access', async () => {
  let reads = 0, calls = 0
  const result = await agent.handleChatRequest({ db: dbFixture({ getConversationForReader: async () => null,
    listMessages: async () => { reads++; return [] } }), userId: 'u2', body: { message: 'Gợi ý', conversation_id: 123 },
    complete: async () => { calls++; return complete() } })
  assert.equal(result.status, 404)
  assert.equal(reads, 0)
  assert.equal(calls, 0)
})
test('guest conversations need a valid secret, and creation returns a new secret', async () => {
  let storedHash
  const db = dbFixture({ createConversation: async row => { storedHash = row.guest_token_hash; return { id: 1 } }, addMessage: async () => {} })
  const created = await agent.handleChatRequest({ db, userId: null, body: { message: 'Gợi ý' }, complete: async () => ({ content: '{"story_ids":["s1"]}', toolCalls: [] }) })
  assert.match(created.payload.conversation_token, /^[a-f0-9]{64}$/)
  assert.match(storedHash, /^[a-f0-9]{64}$/)
  assert.notEqual(storedHash, created.payload.conversation_token)
  const denied = await agent.handleChatRequest({ db, userId: null, body: { message: 'Gợi ý', conversation_id: 1 }, complete })
  assert.equal(denied.status, 404)
})
test('oversized chat inputs are rejected before model access', async () => {
  const result = await agent.handleChatRequest({ db: dbFixture(), body: { message: 'a'.repeat(2001) }, complete })
  assert.equal(result.status, 413)
})
test('ordinary Vietnamese and sensitive fictional discussion are not hard-blocked', () => {
  assert.equal(integrity.heuristicToxicity('Các nhân vật có bước trưởng thành lớn trong buổi gặp mặt.'), 0.08)
  assert.equal(integrity.intakeComment('Truyện phê phán khủng bố và lên án bạo lực.').insert, true)
  assert.equal(integrity.heuristicToxicity('địt mẹ'), 0.92)
  assert.equal(integrity.intakeComment('Đăng ký nhận thưởng https://kuwin.example').insert, false)
})
test('scores reject unrelated numbers, percentages, strings and invalid ranges', () => {
  for (const input of ['Năm 2026, điểm 0.1', '85', 'NaN', '{"score":"0.1"}', '{"score":1.2}', '{"score":-1}']) assert.equal(integrity.parseScore(input), null, input)
  assert.equal(integrity.parseScore('{"score":0.7}'), 0.7)
  assert.equal(integrity.parseScore('0.7'), 0.7)
})
test('unknown classifier output stays pending for review, including benign fallback', async () => {
  let status, evidence
  const db = { applyCommentScore: async (_id, row) => { status = row.status }, insertModerationLog: async row => { evidence = row.evidence_data } }
  await integrity.runCommentScore({ db, comment: { id: 1, content: 'Các chương rất hay.' }, complete: async () => ({ content: 'Năm 2026 điểm 0.1' }) })
  assert.equal(status, 'pending')
  assert.equal(evidence.fallback_reason, 'invalid_score')
})
test('yellow-zone comments appear in the admin review queue', async () => {
  let logs = 0
  const result = await integrity.runCommentScore({ db: { applyCommentScore: async () => {}, insertModerationLog: async () => { logs++ } },
    comment: { id: 1, content: 'đồ ngu' }, complete: async () => ({ content: '{"score":0.7}' }) })
  assert.equal(result.status, 'shadowbanned')
  assert.equal(logs, 1)
})
test('long comments are refused; no unmoderated ending is persisted', () => {
  assert.equal(integrity.intakeComment('a'.repeat(2001)).httpStatus, 413)
})
test('deadline aborts the underlying operation and returns promptly', async () => {
  let receivedSignal
  await assert.rejects(runtime.withDeadline(signal => {
    receivedSignal = signal
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }, 10), { code: 'ai_timeout' })
  assert.equal(receivedSignal.aborted, true)
})
test('parent cancellation is propagated', async () => {
  const parent = new AbortController()
  parent.abort()
  let called = false
  await assert.rejects(runtime.withDeadline(async () => { called = true }, 1000, parent.signal), { code: 'ai_cancelled' })
  assert.equal(called, false)
})
test('usage, actual model and truncated finish reasons are preserved', async t => {
  const events = []
  runtime.configure({ consumeAiQuota: async () => true, recordAiUsage: async e => events.push(e) })
  t.after(() => { global.fetch = originalFetch; runtime.configure(null) })
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ model: 'actual-model', usage: { prompt_tokens: 80, completion_tokens: 20 },
    choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }) })
  const result = await agent.chatCompletion({ messages: [{ role: 'user', content: 'Hello' }], task: 'recap' })
  assert.equal(result.model, 'actual-model')
  assert.equal(result.usage.prompt_tokens, 80)
  assert.equal(events[0].task, 'recap')
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'unfinished' }, finish_reason: 'length' }] }) })
  await assert.rejects(agent.chatCompletion({ messages: [] }), { code: 'ai_truncated' })
  assert.equal(events[1].errorCode, 'ai_truncated')
})
test('quota exhaustion prevents network requests', async t => {
  runtime.configure({ consumeAiQuota: async () => false })
  t.after(() => runtime.configure(null))
  await assert.rejects(agent.chatCompletion({ messages: [] }), { code: 'ai_budget_exceeded' })
})
test('favorite tool refuses writes outside explicit save intent', async () => {
  let writes = 0
  const db = dbFixture({ createLike: async () => { writes++; return { id: 1 } } })
  const denied = await agent.runAgentTool(db, 'u1', 'save_to_favorites', { story_id: 's1' })
  assert.equal(denied.saved, false)
  assert.equal(writes, 0)
  assert.equal(agent.allowsFavoriteSave('Chỉ gợi ý, đừng lưu truyện'), false)
  assert.equal(agent.allowsFavoriteSave('Lưu truyện này vào tủ sách'), true)
  const allowed = await agent.runAgentTool(db, 'u1', 'save_to_favorites', { story_id: 's1' }, { allowSave: true })
  assert.equal(allowed.saved, true)
})
test('recommendations reject invented IDs and never read the full catalog', async () => {
  const db = dbFixture({ getBooks: async () => { throw new Error('full catalog must not be loaded') } })
  const bad = await agent.handleChatRequest({ db, body: { message: 'Gợi ý truyện tiên hiệp' }, complete: async () => ({ content: '{"story_ids":["INVENTED"]}', toolCalls: [] }) })
  assert.equal(bad.payload.reply.includes('INVENTED'), false)
  const good = await agent.handleChatRequest({ db, body: { message: 'Gợi ý truyện kiếm hiệp' }, complete: async () => ({ content: '{"story_ids":["s1"]}', toolCalls: [] }) })
  assert.equal(good.payload.books[0].id, 's1')
})
test('an exact duplicate is flagged with an explicit text metric', async () => {
  const content = 'Lan mở cánh cửa cũ và tìm thấy chiếc hộp gỗ dưới chân cầu thang.'
  const result = await integrity.analyzeContentSimilarity({ listChapterFingerprints: async () => [{ chapter_id: 'old', simhash_64: integrity.simhash64(content).toString() }],
    getChapterContentById: async () => ({ content, status: 'published' }) }, { content })
  assert.equal(result.zone, 'red')
  assert.equal(result.similarity_pct, 100)
  assert.equal(result.similarity_metric, 'five_word_shingle_jaccard')
})
test('hash collisions without text evidence do not invent 15 percent', async () => {
  const content = 'Lan mở cánh cửa cũ và tìm thấy chiếc hộp gỗ dưới chân cầu thang.'
  const hash = integrity.simhash64(content) ^ ((1n << 20n) - 1n)
  const result = await integrity.analyzeContentSimilarity({ listChapterFingerprints: async () => [{ chapter_id: 'old', simhash_64: hash.toString() }],
    getChapterContentById: async () => ({ content: 'Quả táo.', status: 'published' }) }, { content })
  assert.equal(result.zone, 'green')
  assert.equal(result.similarity_pct, 0)
})
test('plagiarism analysis includes the complete ending instead of only 1000 leading characters', async () => {
  let prompt
  await integrity.aiAnalyzePlagiarism('Khởi đầu. '.repeat(180) + 'COPIED_END_MARKER', 'Bối cảnh. '.repeat(180) + 'OTHER_END_MARKER', { snippets: [] },
    async req => { prompt = req.messages[1].content; return { content: 'Phân tích' } })
  assert.ok(prompt.includes('COPIED_END_MARKER'))
})
test('telemetry HTTP failures are not reported as success', async t => {
  process.env.LANGFUSE_PUBLIC_KEY = 'fixture'
  process.env.LANGFUSE_SECRET_KEY = 'fixture'
  t.after(() => { delete process.env.LANGFUSE_PUBLIC_KEY; delete process.env.LANGFUSE_SECRET_KEY; global.fetch = originalFetch })
  global.fetch = async () => ({ ok: false, status: 401 })
  assert.equal((await integrity.recordTrace('test')).stored, false)
  assert.equal(integrity.langfuseTraceUrl('test'), null)
})
test('invalid admin decisions cannot silently reject content', async () => {
  await assert.rejects(integrity.applyModerationDecision({}, { id: 1 }, 'typo'), { code: 'invalid_action' })
})
