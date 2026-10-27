// Explicitly enabled integration suite. Creates and drops only its own temporary database.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')
const { spawn } = require('node:child_process')
const mysql = require('mysql2/promise')
const dotenv = require('dotenv')
const jwt = require('jsonwebtoken')
const { installSchema, hashText } = require('../ai_store')
const enabled = process.env.AI_DB_TEST === '1'
let admin, db, child, gateway, base, testDatabase, created = false
const secret = 'integration-fixture-only'
const pause = ms => new Promise(r => setTimeout(r, ms))
const request = (route, body, userId, headers = {}) => fetch(base + route, {
  method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
    ...(userId ? { Authorization: 'Bearer ' + jwt.sign({ id: String(userId), role: userId === 1 ? 'admin' : 'user' }, secret) } : {}), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body)
})

before(async () => {
  if (!enabled) return
  const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env')))
  const options = { host: env.MYSQL_HOST || '127.0.0.1', port: Number(env.MYSQL_PORT || 3306), user: env.MYSQL_USER || 'root', password: env.MYSQL_PASSWORD || '', multipleStatements: true }
  admin = await mysql.createConnection(options)
  testDatabase = 'reader_ai_test_' + crypto.randomBytes(6).toString('hex')
  assert.match(testDatabase, /^reader_ai_test_[a-f0-9]{12}$/)
  await admin.query(`CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  created = true
  const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8').replaceAll('app_doc_truyen', testDatabase)
  await admin.query(schema)
  process.env.MYSQL_HOST = options.host
  process.env.MYSQL_PORT = String(options.port)
  process.env.MYSQL_USER = options.user
  process.env.MYSQL_PASSWORD = options.password
  process.env.MYSQL_DATABASE = testDatabase
  db = require('../mysql')
  await installSchema(await db.initPool())
  const pool = await db.initPool()
  await pool.query("INSERT INTO users (user_id,fullname,email,role) VALUES (1,'Admin test','admin@test.invalid','admin'),(2,'Reader test','reader@test.invalid','user') ON DUPLICATE KEY UPDATE role=VALUES(role)")
  await pool.query("INSERT INTO authors (author_id,user_id,pen_name) VALUES (101,1,'Tác giả test')")
  await pool.query("INSERT INTO stories (story_id,author_id,title,description,genre) VALUES (101,101,'Truyện test','Truyện thử nghiệm','Tiên hiệp')")
  await pool.query("INSERT INTO chapters (chapter_id,story_id,chapter_no,title,content,status) VALUES (101,101,1,'Một','Nội dung đã xuất bản','published'),(102,101,2,'Hai','Nội dung bị giữ','pending_review'),(103,101,3,'Ba','Nội dung chưa mở','published')")
  await db.recordChapterView('2', '101', '101')
  await db.recordChapterView('2', '101', '102')
  gateway = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* drain synthetic payload */ }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'fixture-model', usage: { prompt_tokens: 10, completion_tokens: 5, x_ckey: { cost: 1 } },
      choices: [{ message: { role: 'assistant', content: '{"story_ids":["101"]}' }, finish_reason: 'stop' }] }))
  })
  await new Promise(r => gateway.listen(0, '127.0.0.1', r))
  // Reserve an available local port for this child; retry readiness below.
  const portServer = http.createServer()
  await new Promise(r => portServer.listen(0, '127.0.0.1', r))
  const port = portServer.address().port
  await new Promise(r => portServer.close(r))
  base = 'http://127.0.0.1:' + port
  child = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), windowsHide: true,
    env: { ...process.env, USE_MYSQL: 'true', PORT: String(port), JWT_SECRET: secret, SEPAY_LOCAL: 'false',
      AI_WORKER_ENABLED: 'false', TRUST_PROXY: '', AI_API_BASE: 'http://127.0.0.1:' + gateway.address().port,
      AI_API_KEY: 'fixture-only', AI_MODEL: 'fixture-model', LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.resume(); child.stderr.resume()
  let ready = false
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    if (child.exitCode != null) throw new Error('Integration server exited')
    await pause(100)
  }
  assert.equal(ready, true, 'Integration server ready')
})

after(async () => {
  if (!enabled) return
  if (child && child.exitCode == null) { const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited }
  if (gateway) await new Promise(r => gateway.close(r))
  if (db) await db.closePool()
  if (admin) {
    if (created) {
      assert.match(testDatabase, /^reader_ai_test_[a-f0-9]{12}$/)
      await admin.query(`DROP DATABASE \`${testDatabase}\``)
    }
    await admin.end()
  }
})

test('migration can be repeated without deleting content', { skip: !enabled }, async () => {
  await installSchema(await db.initPool())
  const [rows] = await (await db.initPool()).query('SELECT COUNT(*) n FROM chapters')
  assert.equal(rows[0].n, 3)
})
test('SQL range access excludes pending and unviewed chapters', { skip: !enabled }, async () => {
  const chapters = await db.getChaptersInRange('101', 1, 3, { requireViewed: true, readerKey: '2' })
  assert.deepEqual(chapters.map(c => c.chapter_no), [1])
  assert.equal(await db.getVerifiedReadingChapter('2', '101'), 1)
})
test('SQL ownership checks distinguish user and guest token', { skip: !enabled }, async () => {
  const own = await db.createConversation({ user_id: 2, title: 'Owned' })
  assert.ok(await db.getConversationForReader(own.id, '2'))
  assert.equal(await db.getConversationForReader(own.id, '1'), null)
  const token = 'a'.repeat(64)
  const guest = await db.createConversation({ title: 'Guest', guest_token_hash: hashText(token) })
  assert.ok(await db.getConversationForReader(guest.id, null, token))
  assert.equal(await db.getConversationForReader(guest.id, null, 'b'.repeat(64)), null)
})
test('SQL cache validates the content hash', { skip: !enabled }, async () => {
  await db.saveStorySummaryCache({ story_id: '101', from_chapter: 1, to_chapter: 1, summary_text: 'a'.repeat(651), source_hash: 'a'.repeat(64) })
  assert.equal((await db.getStorySummaryCache('101', 1, 1, 'a'.repeat(64))).length, 651)
  assert.equal(await db.getStorySummaryCache('101', 1, 1, 'b'.repeat(64)), null)
})
test('SQL quotas remain exact under concurrent requests', { skip: !enabled }, async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => db.consumeAiQuota('test-race', 'reader', 5, 900000)))
  assert.equal(results.filter(Boolean).length, 5)
})
test('summary locks serialize shared work without starving DB connections', { skip: !enabled }, async () => {
  let active = 0, maximum = 0
  await Promise.all(Array.from({ length: 12 }, () => db.withSummaryLock('shared-summary', async () => {
    active++; maximum = Math.max(maximum, active)
    await (await db.initPool()).query('SELECT 1')
    await pause(5)
    active--
  })))
  assert.equal(maximum, 1)
})
test('durable jobs cannot be claimed twice and stale leases recover', { skip: !enabled }, async () => {
  const comment = await db.createComment('101', { user_id: '2', content: 'Bình luận test', status: 'pending' })
  await db.enqueueCommentModeration(comment)
  const jobs = await Promise.all([db.claimCommentModeration(), db.claimCommentModeration()])
  assert.equal(jobs.filter(Boolean).length, 1)
  const job = jobs.find(Boolean)
  await (await db.initPool()).query('UPDATE ai_moderation_jobs SET lease_until=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE comment_id=?', [comment.id])
  const recovered = await db.claimCommentModeration()
  assert.equal(recovered.comment_id, comment.id)
  assert.notEqual(recovered.lease_token, job.lease_token)
  await db.finishCommentModeration(job)
  const [running] = await (await db.initPool()).query('SELECT status FROM ai_moderation_jobs WHERE comment_id=?', [comment.id])
  assert.equal(running[0].status, 'running')
  await db.finishCommentModeration(recovered)
})
test('moderation verdict and admin decision are atomic and reject stale decisions', { skip: !enabled }, async () => {
  const comment = await db.createComment('101', { user_id: '2', content: 'Thử nghiệm vùng vàng', status: 'pending' })
  await db.applyCommentModeration(comment, { score: 0.7, source: 'model', status: 'shadowbanned', zone: 'yellow', evidence: { content_hash: hashText(comment.content) } })
  const logs = await db.listModerationLogs()
  const log = logs.find(l => l.target_id === Number(comment.id))
  assert.ok(log)
  await db.decideModeration(log.id, 'approve')
  assert.equal((await db.getCommentById(comment.id)).status, 'approved')
  await assert.rejects(db.decideModeration(log.id, 'reject'), { code: 'review_conflict' })
})
test('chapter review cannot publish a changed revision', { skip: !enabled }, async () => {
  await assert.rejects(db.persistChapterReview({ storyId: '101', chapterId: '102', contentHash: hashText('Old version'), fingerprint: '1', status: 'published' }), { code: 'review_conflict' })
  assert.equal((await db.getChapterById('101', '102')).status, 'pending_review')
})
test('concurrent favorite saves create only one like', { skip: !enabled }, async () => {
  const saves = await Promise.all(Array.from({ length: 10 }, () => db.createLike('2', '101')))
  assert.equal(new Set(saves.map(s => s.id)).size, 1)
})
test('two simultaneous admin decisions serialize without deadlocking', { skip: !enabled }, async () => {
  const comment = await db.createComment('101', { user_id: '2', content: 'Concurrent review', status: 'pending' })
  const a = await db.insertModerationLog({ target_type: 'comment', target_id: comment.id, violation_type: 'toxicity', confidence_score: 0.7 })
  const b = await db.insertModerationLog({ target_type: 'comment', target_id: comment.id, violation_type: 'toxicity', confidence_score: 0.7 })
  const decisions = await Promise.allSettled([db.decideModeration(a.id, 'approve'), db.decideModeration(b.id, 'reject')])
  assert.equal(decisions.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(decisions.find(r => r.status === 'rejected').reason.code, 'review_conflict')
})
test('HTTP guest conversation is reusable only with its returned token', { skip: !enabled }, async () => {
  const body = await (await request('/chat', { message: 'Gợi ý truyện' })).json()
  assert.ok(body.conversation_id)
  assert.match(body.conversation_token, /^[a-f0-9]{64}$/)
  assert.equal((await request('/chat', { message: 'Tiếp tục', conversation_id: body.conversation_id })).status, 404)
  assert.equal((await request('/chat', { message: 'Tiếp tục', conversation_id: body.conversation_id, conversation_token: body.conversation_token })).status, 200)
})
test('HTTP role and body limits apply to duplicate and comment APIs', { skip: !enabled }, async () => {
  assert.equal((await request('/integrity/check-duplicate', { content: 'Nội dung' }, 2)).status, 403)
  assert.equal((await request('/books/101/comments', { content: 'a'.repeat(2001) }, 2)).status, 413)
  assert.equal((await request('/chat', { message: 'a'.repeat(20000) })).status, 413)
})
test('forwarded IP spoofing cannot reset the guest quota', { skip: !enabled }, async () => {
  let status
  for (let i = 0; i < 31; i++) status = (await request('/chat', { message: '' }, null, { 'X-Forwarded-For': '203.0.113.' + i })).status
  assert.equal(status, 429)
})
test('AI usage is stored and exposed only to admins', { skip: !enabled }, async () => {
  assert.equal((await request('/moderation/ai-usage', undefined, 2)).status, 403)
  const result = await (await request('/moderation/ai-usage', undefined, 1)).json()
  assert.ok(result.usage.some(r => r.response_model === 'fixture-model' && r.prompt_tokens > 0))
  assert.ok(result.usage.every(r => r.cost_unit === 'unknown'))
})
test('background worker publishes a valid comment using a durable job', { skip: !enabled }, async () => {
  const integrity = require('../integrity')
  const comment = await db.createComment('101', { user_id: '2', content: 'Bình luận worker rất hay', status: 'pending' })
  await db.enqueueCommentModeration(comment)
  const stop = integrity.startCommentWorker({ db, complete: async () => ({ content: '{"score":0.1}' }) })
  try {
    let approved = false
    for (let n = 0; n < 50; n++) {
      if ((await db.getCommentById(comment.id)).status === 'approved') { approved = true; break }
      await pause(100)
    }
    assert.equal(approved, true)
  } finally { await stop() }
})
