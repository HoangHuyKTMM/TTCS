const crypto = require('node:crypto')

// Additive migration, also used by the normal migration runner. No user/content deletion.
async function installSchema(pool) {
  for (const [table, column, definition] of [
    ['conversations', 'guest_token_hash', 'CHAR(64) NULL'],
    ['story_summary_cache', 'source_hash', 'CHAR(64) NULL'],
    ['comments', 'agent_reason', 'VARCHAR(255) NULL'],
    ['chapters', 'content_format', "VARCHAR(20) NOT NULL DEFAULT 'html'"]
  ]) {
    const [rows] = await pool.execute('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column])
    if (!rows.length) {
      try { await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`) }
      catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e }
    }
  }
  const [statusColumns] = await pool.execute("SELECT TABLE_NAME,COLUMN_TYPE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='status' AND TABLE_NAME IN ('chapters','moderation_logs')")
  if (statusColumns.find(c => c.TABLE_NAME === 'chapters')?.COLUMN_DEFAULT !== 'pending_review') {
    await pool.query("ALTER TABLE chapters ALTER COLUMN status SET DEFAULT 'pending_review'")
  }
  if (!statusColumns.find(c => c.TABLE_NAME === 'moderation_logs')?.COLUMN_TYPE.includes("'superseded'")) {
    await pool.query("ALTER TABLE moderation_logs MODIFY COLUMN status ENUM('pending_review','approved_by_admin','penalized_by_admin','superseded') NOT NULL DEFAULT 'pending_review'")
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id CHAR(36) PRIMARY KEY, trace_id CHAR(36) NULL, user_id VARCHAR(191) NULL,
    task VARCHAR(32) NOT NULL, provider VARCHAR(255) NOT NULL,
    requested_model VARCHAR(191) NOT NULL, response_model VARCHAR(191) NULL,
    status VARCHAR(32) NOT NULL, latency_ms INT UNSIGNED NOT NULL,
    prompt_tokens BIGINT UNSIGNED NULL, completion_tokens BIGINT UNSIGNED NULL,
    cached_tokens BIGINT UNSIGNED NULL, reasoning_tokens BIGINT UNSIGNED NULL,
    finish_reason VARCHAR(32) NULL, provider_cost DECIMAL(20,8) NULL,
    cost_unit VARCHAR(32) NULL, error_code VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ai_usage_time (created_at, task), KEY idx_ai_usage_user (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_request_quotas (
    bucket_key CHAR(64) PRIMARY KEY, hits INT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL, KEY idx_quota_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_moderation_jobs (
    comment_id VARCHAR(191) PRIMARY KEY, content_hash CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued', attempts INT NOT NULL DEFAULT 0,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_until DATETIME NULL, lease_token CHAR(36) NULL, last_error VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_jobs_ready (status, available_at, lease_until)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS user_notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id VARCHAR(191) NOT NULL, type VARCHAR(32) NOT NULL,
    story_id VARCHAR(191) NOT NULL, chapter_id VARCHAR(191) NOT NULL, chapter_no INT NULL,
    story_title VARCHAR(255) NULL, chapter_title VARCHAR(255) NULL, actor_name VARCHAR(191) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id),
    UNIQUE KEY uk_notification_user_chapter (user_id,type,chapter_id), KEY idx_notifications_user_time (user_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS fcm_tokens (
    token VARCHAR(512) NOT NULL, user_id VARCHAR(191) NOT NULL, platform VARCHAR(16) NOT NULL DEFAULT 'android',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (token), KEY idx_fcm_tokens_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

function hashText(value) { return crypto.createHash('sha256').update(String(value)).digest('hex') }
function attach(db) {
  const pool = () => db.initPool()
  let activeSummaryLocks = 0
  const summaryWaiters = []
  db.consumeAiQuota = async (scope, key, max, windowMs) => {
    const p = await pool()
    const start = Math.floor(Date.now() / windowMs) * windowMs
    const bucket = hashText(`${scope}:${key}:${start}`)
    const conn = await p.getConnection()
    try {
      await conn.beginTransaction()
      // UPDATE acquires an exclusive lock directly; INSERT IGNORE followed by
      // FOR UPDATE can deadlock when concurrent duplicate inserts upgrade locks.
      await conn.execute('INSERT INTO ai_request_quotas (bucket_key, hits, expires_at) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE hits=hits', [bucket, new Date(start + windowMs)])
      const [rows] = await conn.execute('SELECT hits FROM ai_request_quotas WHERE bucket_key = ? FOR UPDATE', [bucket])
      if (rows[0].hits >= max) { await conn.rollback(); return false }
      await conn.execute('UPDATE ai_request_quotas SET hits = hits + 1 WHERE bucket_key = ?', [bucket])
      await conn.commit()
      return true
    } catch (e) { await conn.rollback(); throw e }
    finally { conn.release() }
  }
  db.cleanupAiQuotas = async () => (await pool()).execute('DELETE FROM ai_request_quotas WHERE expires_at < NOW() LIMIT 1000')
  db.recordAiUsage = async r => {
    const u = r.usage || {}
    const integer = v => Number.isSafeInteger(v) && v >= 0 ? v : null
    const cost = Number(u.x_ckey?.cost)
    await (await pool()).execute(`INSERT INTO ai_usage_logs
      (id,trace_id,user_id,task,provider,requested_model,response_model,status,latency_ms,
       prompt_tokens,completion_tokens,cached_tokens,reasoning_tokens,finish_reason,provider_cost,cost_unit,error_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      r.id, r.traceId || null, r.userId || null, r.task || 'chat', r.provider,
      r.requestedModel, r.responseModel || null, r.status, r.latencyMs,
      integer(u.prompt_tokens), integer(u.completion_tokens), integer(u.prompt_tokens_details?.cached_tokens),
      integer(u.completion_tokens_details?.reasoning_tokens), r.finishReason || null,
      u.x_ckey && Number.isFinite(cost) ? cost : null,
      u.x_ckey ? String(process.env.AI_PROVIDER_COST_UNIT || 'unknown').slice(0, 32) : null, r.errorCode || null
    ])
  }
  db.getAiUsageStats = async () => {
    const [rows] = await (await pool()).execute(`SELECT task, requested_model, response_model, status,
      COUNT(*) requests, SUM(prompt_tokens) prompt_tokens, SUM(completion_tokens) completion_tokens,
      SUM(cached_tokens) cached_tokens, AVG(latency_ms) average_latency_ms,
      SUM(provider_cost) provider_cost, cost_unit
      FROM ai_usage_logs WHERE created_at >= NOW() - INTERVAL 30 DAY
      GROUP BY task, requested_model, response_model, status, cost_unit`)
    return rows
  }
  db.getConversationForReader = async (id, userId, token) => {
    const [rows] = await (await pool()).execute(
      userId ? 'SELECT id FROM conversations WHERE id = ? AND user_id = ? LIMIT 1'
        : 'SELECT id FROM conversations WHERE id = ? AND user_id IS NULL AND guest_token_hash = ? LIMIT 1',
      [id, userId || hashText(token || '')])
    return rows[0] || null
  }
  db.getVerifiedReadingChapter = async (readerKey, storyId) => {
    if (!readerKey) return null
    const [rows] = await (await pool()).execute(`SELECT MAX(c.chapter_no) chapter_no FROM chapter_views v
      JOIN chapters c ON c.chapter_id = v.chapter_id AND c.story_id = v.story_id
      WHERE v.user_id = ? AND v.story_id = ? AND c.status = 'published'`, [readerKey, storyId])
    return Number(rows[0]?.chapter_no) || null
  }
  db.withSummaryLock = async (key, fn) => {
    // Reserve at most three of the ten DB connections for long-running work.
    // Quota, usage logging and the moderation worker retain free connections.
    if (activeSummaryLocks >= 3) {
      if (summaryWaiters.length >= 20) throw Object.assign(new Error('Summary queue is full'), { code: 'ai_busy' })
      await new Promise(resolve => summaryWaiters.push(resolve))
    } else activeSummaryLocks++
    let conn
    const name = 'ai-summary:' + hashText(key).slice(0, 48)
    try {
      conn = await (await pool()).getConnection()
      const [rows] = await conn.execute('SELECT GET_LOCK(?, 5) acquired', [name])
      if (Number(rows[0]?.acquired) !== 1) throw Object.assign(new Error('Summary is being generated'), { code: 'ai_busy' })
      return await fn()
    } finally {
      if (conn) {
        await conn.execute('SELECT RELEASE_LOCK(?)', [name]).catch(() => {})
        conn.release()
      }
      const next = summaryWaiters.shift()
      if (next) next()
      else activeSummaryLocks--
    }
  }
  db.enqueueCommentModeration = async comment => {
    await (await pool()).execute(`INSERT INTO ai_moderation_jobs (comment_id,content_hash) VALUES (?,?)
      ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash),status='queued',attempts=0,
      available_at=NOW(),lease_until=NULL,lease_token=NULL`, [comment.id, hashText(comment.content)])
  }
  db.claimCommentModeration = async () => {
    const conn = await (await pool()).getConnection()
    try {
      await conn.beginTransaction()
      const [rows] = await conn.execute(`SELECT * FROM ai_moderation_jobs WHERE
        (status='queued' AND available_at <= NOW()) OR (status='running' AND lease_until < NOW())
        ORDER BY available_at,comment_id LIMIT 1 FOR UPDATE SKIP LOCKED`)
      if (!rows.length) { await conn.commit(); return null }
      const job = rows[0], token = crypto.randomUUID()
      await conn.execute(`UPDATE ai_moderation_jobs SET status='running',attempts=attempts+1,
        lease_until=DATE_ADD(NOW(), INTERVAL 120 SECOND),lease_token=? WHERE comment_id=?`, [token, job.comment_id])
      await conn.commit()
      return { ...job, attempts: job.attempts + 1, lease_token: token }
    } catch (e) { await conn.rollback(); throw e }
    finally { conn.release() }
  }
  db.finishCommentModeration = async (job, errorCode) => {
    const retry = errorCode && job.attempts < 3
    await (await pool()).execute(`UPDATE ai_moderation_jobs SET status=?,last_error=?,
      available_at=DATE_ADD(NOW(), INTERVAL ? SECOND),lease_until=NULL,lease_token=NULL
      WHERE comment_id=? AND lease_token=?`, [retry ? 'queued' : errorCode ? 'failed' : 'done', errorCode || null,
      retry ? 15 * job.attempts : 0, job.comment_id, job.lease_token])
  }
  db.applyCommentModeration = async (comment, verdict) => {
    const conn = await (await pool()).getConnection()
    try {
      await conn.beginTransaction()
      const [rows] = await conn.execute('SELECT content,status FROM comments WHERE comment_id=? FOR UPDATE', [comment.id])
      if (!rows[0] || rows[0].status !== 'pending' || hashText(rows[0].content) !== hashText(comment.content)) {
        await conn.rollback(); return false
      }
      await conn.execute(`UPDATE comments SET status=?,toxicity_score=?,moderation_label=?,is_negative=?,agent_reason=? WHERE comment_id=?`,
        [verdict.status, verdict.score, verdict.zone === 'green' ? 'clean' : 'toxic', verdict.score >= 0.5 ? 1 : 0,
          verdict.fallbackReason || verdict.source, comment.id])
      if (verdict.zone !== 'green') await conn.execute(`INSERT INTO moderation_logs
        (target_type,target_id,violation_type,confidence_score,evidence_data,trace_id,status)
        VALUES ('comment',?,'toxicity',?,?,?,'pending_review')`,
        [comment.id, verdict.score, JSON.stringify(verdict.evidence), verdict.traceId || null])
      await conn.commit()
      return true
    } catch (e) { await conn.rollback(); throw e }
    finally { conn.release() }
  }
  db.persistChapterReview = async ({ storyId, chapterId, contentHash, fingerprint, status, log }) => {
    const conn = await (await pool()).getConnection()
    try {
      await conn.beginTransaction()
      const [rows] = await conn.execute('SELECT content,status,story_id FROM chapters WHERE chapter_id=? FOR UPDATE', [chapterId])
      if (!rows[0] || String(rows[0].story_id) !== String(storyId) || hashText(rows[0].content) !== contentHash || rows[0].status !== 'pending_review') {
        throw Object.assign(new Error('Chapter version has changed'), { code: 'review_conflict' })
      }
      const [existing] = await conn.execute('SELECT id FROM chapter_fingerprints WHERE chapter_id=? LIMIT 1', [chapterId])
      if (existing.length) await conn.execute('UPDATE chapter_fingerprints SET story_id=?,simhash_64=? WHERE chapter_id=?', [storyId, fingerprint, chapterId])
      else await conn.execute('INSERT INTO chapter_fingerprints (story_id,chapter_id,simhash_64) VALUES (?,?,?)', [storyId, chapterId, fingerprint])
      // New evidence supersedes logs of the old content revision.
      await conn.execute("UPDATE moderation_logs SET status='superseded' WHERE target_type='chapter' AND target_id=? AND status='pending_review'", [chapterId])
      if (log) await conn.execute(`INSERT INTO moderation_logs (target_type,target_id,violation_type,confidence_score,matched_target_id,evidence_data,trace_id,status)
        VALUES ('chapter',?,'plagiarism',?,?,?,?,'pending_review')`,
        [chapterId, log.score, log.matchedId, JSON.stringify(log.evidence), log.traceId])
      await conn.execute('UPDATE chapters SET status=? WHERE chapter_id=?', [status, chapterId])
      await conn.commit()
      if (status === 'published' && typeof db.notifyChapterPublished === 'function') {
        try { await db.notifyChapterPublished(chapterId) } catch (error) { console.error('[notifications] chapter publish failed:', error.code || error.message) }
      }
      return true
    } catch (e) { await conn.rollback(); throw e }
    finally { conn.release() }
  }
  db.getPublishedChapterContent = async id => {
    const [rows] = await (await pool()).execute(`SELECT c.content,c.status FROM chapters c JOIN stories s ON s.story_id=c.story_id
      WHERE c.chapter_id=? AND c.status='published' AND (s.is_hidden=0 OR s.is_hidden IS NULL)`, [id])
    return rows[0] || null
  }
  db.getVisibleBookById = async id => {
    const [rows] = await (await pool()).execute(`SELECT s.story_id AS id,s.title,s.description,s.genre,s.cover_image,s.free_chapters,a.user_id AS author_user_id,
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id=s.story_id AND c.status='published') chapters_count
      FROM stories s LEFT JOIN authors a ON a.author_id=s.author_id
      WHERE s.story_id=? AND (s.is_hidden=0 OR s.is_hidden IS NULL) LIMIT 1`, [id])
    return rows[0] || null
  }
  db.getAgentProgress = async userId => {
    const [rows] = await (await pool()).execute(`SELECT h.story_id,h.chapter_no,s.title,s.genre
      FROM reading_history h JOIN stories s ON s.story_id=h.story_id
      WHERE h.user_id=? AND (s.is_hidden=0 OR s.is_hidden IS NULL) ORDER BY h.last_read_at DESC LIMIT 12`, [userId])
    return rows
  }
  db.decideModeration = async (logId, action, reviewerId) => {
    if (!['approve', 'reject'].includes(action)) throw Object.assign(new Error('Invalid moderation action'), { code: 'invalid_action' })
    const conn = await (await pool()).getConnection()
    try {
      await conn.beginTransaction()
      const [rows] = await conn.execute('SELECT * FROM moderation_logs WHERE id=?', [logId])
      const log = rows[0]
      if (!log || log.status !== 'pending_review') throw Object.assign(new Error('Already reviewed or missing'), { code: 'review_conflict' })
      const approve = action === 'approve', status = approve ? 'approved_by_admin' : 'penalized_by_admin'
      const evidence = typeof log.evidence_data === 'string' ? JSON.parse(log.evidence_data) : log.evidence_data || {}
      const table = log.target_type === 'comment' ? 'comments' : 'chapters'
      const pk = log.target_type === 'comment' ? 'comment_id' : 'chapter_id'
      const [targets] = await conn.execute(`SELECT content FROM ${table} WHERE ${pk}=? FOR UPDATE`, [log.target_id])
      // Lock the target before its logs, matching the worker's lock order.
      const [current] = await conn.execute('SELECT status FROM moderation_logs WHERE id=? FOR UPDATE', [logId])
      if (current[0]?.status !== 'pending_review') throw Object.assign(new Error('Already reviewed'), { code: 'review_conflict' })
      if (!targets[0] || (evidence.content_hash && hashText(targets[0].content) !== evidence.content_hash)) {
        throw Object.assign(new Error('Content has changed; review the current version'), { code: 'review_conflict' })
      }
      await conn.execute(`UPDATE ${table} SET status=? WHERE ${pk}=?`, [approve ? table === 'comments' ? 'approved' : 'published' : 'rejected', log.target_id])
      if (table === 'comments') await conn.execute('UPDATE comments SET reviewed_by=COALESCE(?,reviewed_by),reviewed_at=NOW() WHERE comment_id=?', [reviewerId == null ? null : String(reviewerId), log.target_id])
      // Resolve every pending log of this exact target. The target lock serializes decisions.
      await conn.execute('UPDATE moderation_logs SET status=? WHERE target_type=? AND target_id=? AND status=\'pending_review\'', [status, log.target_type, log.target_id])
      await conn.commit()
      if (table === 'chapters' && approve && typeof db.notifyChapterPublished === 'function') {
        try { await db.notifyChapterPublished(log.target_id) } catch (error) { console.error('[notifications] chapter publish failed:', error.code || error.message) }
      }
      return { ok: true, status }
    } catch (e) { await conn.rollback(); throw e }
    finally { conn.release() }
  }
  // Reconcile pending comments left behind by a crash between insert and enqueue.
  db.reconcileCommentModeration = async () => (await pool()).execute(`INSERT IGNORE INTO ai_moderation_jobs (comment_id,content_hash)
    SELECT CAST(c.comment_id AS CHAR), SHA2(c.content,256) FROM comments c
    LEFT JOIN moderation_logs l ON l.target_type='comment' AND l.target_id=c.comment_id AND l.status='pending_review'
    WHERE c.status='pending' AND l.id IS NULL LIMIT 500`)
}

module.exports = { installSchema, attach, hashText }
