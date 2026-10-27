const path = require('path')
const crypto = require('node:crypto')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const mysql = require('mysql2/promise')

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function cleanText(html) {
  if (!html) return ''
  let text = String(html)
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<div class=["']ads-holder["'][\s\S]*?<\/div>/gi, '')
    .replace(/<ins[\s\S]*?<\/ins>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&hellip;/gi, '...')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  })

  console.log('Fetching chapters...')
  const [rows] = await conn.query('SELECT chapter_id, content FROM chapters')
  console.log(`Found ${rows.length} chapters. Cleaning HTML tags...`)

  let updatedCount = 0
  for (const row of rows) {
    if (row.content && (row.content.includes('<') || row.content.includes('&'))) {
      const cleaned = cleanText(row.content)
      if (cleaned !== String(row.content)) {
        // Cleaning changes the reviewed text. Return it to moderation and drop
        // integrity data tied to the previous revision.
        await conn.query("UPDATE chapters SET content = ?, status = 'pending_review' WHERE chapter_id = ?", [cleaned, row.chapter_id])
        try { await conn.query('DELETE FROM chapter_fingerprints WHERE chapter_id = ?', [row.chapter_id]) } catch (e) { }
        try {
          await conn.query(`UPDATE moderation_logs SET status = 'superseded'
            WHERE target_type = 'chapter' AND target_id = ? AND status = 'pending_review'`, [row.chapter_id])
          await conn.query(`INSERT INTO moderation_logs
            (target_type, target_id, violation_type, confidence_score, evidence_data, trace_id, status)
            VALUES ('chapter', ?, 'plagiarism', 0, ?, NULL, 'pending_review')`, [row.chapter_id,
            JSON.stringify({ zone: 'unknown', fallback_reason: 'content_cleaned_outside_review', content_hash: hashText(cleaned) })])
        } catch (e) { console.warn(`[moderation] could not queue cleaned chapter ${row.chapter_id}:`, e.message) }
        updatedCount++
      }
    }
  }

  console.log(`✅ Cleaned ${updatedCount} / ${rows.length} chapters successfully!`)
  await conn.end()
}

main().catch(err => {
  console.error('Error cleaning chapters:', err)
  process.exit(1)
})
