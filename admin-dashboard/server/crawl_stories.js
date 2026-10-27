require('dotenv').config()
const mysql = require('./mysql')
const crypto = require('node:crypto')
const { cleanChapterContent, mapGenres, getOrCreateAuthor } = require('./crawl_helper')

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

const STORIES_TO_CRAWL = [
  {
    detailUrl: 'https://truyenfullmoi.net/cham-rai-dong-long.1989/',
    slug: 'cham-rai-dong-long',
    primaryGenre: 'Ngôn Tình'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/thap-nien-70-vo-truoc-cua-dai-lao-ngay-cang-dang-ghet.1422/',
    slug: 'thap-nien-70-vo-truoc-cua-dai-lao-ngay-cang-dang-ghet',
    primaryGenre: 'Ngôn Tình'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/nguoi-khac-tu-tien-ta-tu-menh-menh-nu-chu-cung-khong-cung-bang-ta.1980/',
    slug: 'nguoi-khac-tu-tien-ta-tu-menh-menh-nu-chu-cung-khong-cung-bang-ta',
    primaryGenre: 'Tiên Hiệp'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/xuyen-thu-chi-ba-ai-nam-phoi.1969/',
    slug: 'xuyen-thu-chi-ba-ai-nam-phoi',
    primaryGenre: 'Tiên Hiệp'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/thieu-nien-ca-hanh-chu-moc-nam.1988/',
    slug: 'thieu-nien-ca-hanh-chu-moc-nam',
    primaryGenre: 'Kiếm Hiệp'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/su-huynh-cua-ta-qua-manh.1888/',
    slug: 'su-huynh-cua-ta-qua-manh',
    primaryGenre: 'Kiếm Hiệp'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/chang-re-bac-si.1147/',
    slug: 'chang-re-bac-si',
    primaryGenre: 'Đô Thị'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/dai-lao-huyen-hoc-lai-ngoi-via-he-boi-toan.1977/',
    slug: 'dai-lao-huyen-hoc-lai-ngoi-via-he-boi-toan',
    primaryGenre: 'Đô Thị'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/ky-thuat-vien-bao-tri-thien-tai.1380/',
    slug: 'ky-thuat-vien-bao-tri-thien-tai',
    primaryGenre: 'Khoa Huyễn'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/phe-tho-va-an-nghi.1652/',
    slug: 'phe-tho-va-an-nghi',
    primaryGenre: 'Khoa Huyễn'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/so-13-pho-mink.1666/',
    slug: 'so-13-pho-mink',
    primaryGenre: 'Huyền Huyễn'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/than-that-la-yeu-duoi.1987/',
    slug: 'than-that-la-yeu-duoi',
    primaryGenre: 'Huyền Huyễn'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/trung-sinh-ta-ga-cho-vuong-gia-om-yeu.1968/',
    slug: 'trung-sinh-ta-ga-cho-vuong-gia-om-yeu',
    primaryGenre: 'Lịch Sử'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/bac-tong-phong-luu.132/',
    slug: 'bac-tong-phong-luu',
    primaryGenre: 'Lịch Sử'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/co-ay-o-trong-vuc-sau.1890/',
    slug: 'co-ay-o-trong-vuc-sau',
    primaryGenre: 'Trinh Thám'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/mau-than-ta-la-than-tham.1882/',
    slug: 'mau-than-ta-la-than-tham',
    primaryGenre: 'Trinh Thám'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/so-tay-chan-nuoi-quai-vat.1611/',
    slug: 'so-tay-chan-nuoi-quai-vat',
    primaryGenre: 'Linh Dị'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/vo-han-luu-song-trong-nhan-cach.1477/',
    slug: 'vo-han-luu-song-trong-nhan-cach',
    primaryGenre: 'Linh Dị'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/vong-du-moi-3-cap-duoc-mot-thien-phu-cap-sss.1332/',
    slug: 'vong-du-moi-3-cap-duoc-mot-thien-phu-cap-sss',
    primaryGenre: 'Võng Du'
  },
  {
    detailUrl: 'https://truyenfullmoi.net/dai-luyen-vong-du.789/',
    slug: 'dai-luyen-vong-du',
    primaryGenre: 'Võng Du'
  }
]

const MAX_CHAPTERS_PER_STORY = 30
const REQUEST_DELAY_MS = Math.max(500, Number.parseInt(process.env.CRAWL_REQUEST_DELAY_MS || '1000', 10) || 1000)
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/'

let lastRequestAt = 0

async function waitForRequestSlot() {
  const waitMs = Math.max(0, REQUEST_DELAY_MS - (Date.now() - lastRequestAt))
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
  lastRequestAt = Date.now()
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
}

async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await waitForRequestSlot()
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) })
      if (res.status === 200) {
        return await res.text()
      }
      if (res.status === 404) {
        return null
      }
    } catch (err) {
      if (attempt === maxRetries) throw err
    }
    await new Promise(r => setTimeout(r, 600 * attempt))
  }
  return null
}

async function crawlStoryMetadata(item) {
  console.log(`\n============================================================`)
  console.log(`📖 Đang lấy thông tin truyện: ${item.slug} ...`)
  const html = await fetchWithRetry(item.detailUrl)
  if (!html) {
    console.error(`❌ Không tải được trang truyện: ${item.detailUrl}`)
    return null
  }

  // Tên truyện (theme hiện tại đặt tên trong h1)
  let title = item.slug
  const titleM = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
                 html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                 html.match(/<title>([^<]+)<\/title>/i)
  if (titleM && titleM[1]) {
    title = titleM[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim()
      .replace(/^Truyện\s+/i, '').replace(/\s+Full(?:\s*[-|].*)?$/i, '').trim()
  }

  // Tác giả
  let author = 'Khuyết Danh'
  const authorM = html.match(/itemprop=["']author["'][^>]*>([^<]+)<\/a>/i) ||
                  html.match(/itemprop=["']author["'][^>]*title=["']([^"']+)["']/i) ||
                  html.match(/Tác giả:[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)
  if (authorM && authorM[1]) {
    author = authorM[1].trim()
  }

  // Ảnh bìa
  let coverImage = null
  const coverTag = html.match(/<img\b(?=[^>]*itemprop=["']image["'])[^>]*>/i) ||
                   html.match(/<div[^>]*class=["']book["'][^>]*>[\s\S]*?<img\b[^>]*>/i)
  const coverM = (coverTag && coverTag[0].match(/(?:src|data-src|data-original|lazysrc)=["']([^"']+)["']/i)) ||
                 html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
  if (coverM && coverM[1]) {
    coverImage = new URL(coverM[1], item.detailUrl).href
  }

  // Mô tả truyện
  let description = ''
  const descM = html.match(/<div[^>]*class=["'][^"']*desc-text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                html.match(/itemprop=["']description["'][^>]*>([\s\S]*?)<\/div>/i)
  if (descM && descM[1]) {
    description = descM[1]
    description = cleanChapterContent(description)
  }

  // Thể loại
  const genreMatches = [...html.matchAll(/itemprop=["']genre["'][^>]*>([^<]+)<\/a>/gi)]
  const genres = [...new Set(genreMatches.map(m => m[1].trim()).filter(Boolean))]
  const primaryGenre = genres[0] || item.primaryGenre
  const attribution = `Nguồn: ${title} — ${item.detailUrl} | Tác giả: ${author} | Giấy phép: CC BY 4.0 (${CC_BY_URL}). Nội dung đã được làm sạch định dạng HTML.`
  description = [description, attribution].filter(Boolean).join('\n\n')

  return {
    title,
    author,
    coverImage,
    description,
    genres: genres.length > 0 ? genres : [item.primaryGenre],
    primaryGenre
  }
}

async function crawlChapter(storySlug, chapterNo) {
  const url = `https://truyenfullmoi.net/${storySlug}/chuong-${chapterNo}.html`
  const html = await fetchWithRetry(url)
  if (!html) return null

  // Tiêu đề chương
  let title = `Chương ${chapterNo}`
  const titleM = html.match(/<a\b(?=[^>]*class=["'][^"']*chapter-title[^"']*["'])[^>]*>([\s\S]*?)<\/a>/i) ||
                 html.match(/<h2[^>]*class=["']chapter-title["'][^>]*>([\s\S]*?)<\/h2>/i) ||
                 html.match(/<title>([^<]+)<\/title>/i)
  if (titleM && titleM[1]) {
    title = cleanChapterContent(titleM[1]).replace(/\s+/g, ' ').trim() || title
  }

  // Nội dung chương
  let content = ''
  const contentM = html.match(/<div[^>]*class=["'][^"']*chapter-c[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                   html.match(/<div[^>]*class=["'][^"']*chapter_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
  if (contentM && contentM[1]) {
    content = cleanChapterContent(contentM[1])
  }

  if (!content || content.length < 50) return null

  return {
    chapterNo,
    title,
    content
  }
}

async function main() {
  console.log(`🚀 Crawl ${STORIES_TO_CRAWL.length} truyện, tối đa ${MAX_CHAPTERS_PER_STORY} chương/truyện; nghỉ ${REQUEST_DELAY_MS}ms giữa các request.`)
  const pool = await mysql.initPool()

  let totalStoriesCreated = 0
  let totalChaptersCreated = 0

  for (let sIdx = 0; sIdx < STORIES_TO_CRAWL.length; sIdx++) {
    const item = STORIES_TO_CRAWL[sIdx]
    const meta = await crawlStoryMetadata(item)
    if (!meta) continue

    // 1. Tạo tác giả
    const authorId = await getOrCreateAuthor(pool, meta.author)

    // 2. Tạo hoặc cập nhật truyện trong bảng stories
    let storyId = null
    const [existStory] = await pool.query('SELECT story_id FROM stories WHERE title = ? LIMIT 1', [meta.title])
    if (existStory.length > 0) {
      storyId = existStory[0].story_id
      await pool.query(
        `UPDATE stories SET 
          description = ?, cover_image = ?, genre = ?, updated_at = NOW() 
         WHERE story_id = ?`,
        [meta.description, meta.coverImage, meta.primaryGenre, storyId]
      )
      console.log(`  🔄 Truyện đã tồn tại (ID: ${storyId}), cập nhật metadata.`)
    } else {
      const [sRes] = await pool.query(
        `INSERT INTO stories 
          (author_id, title, description, cover_image, status, views, genre, free_chapters, is_hidden, created_at) 
         VALUES (?, ?, ?, ?, 'ongoing', 0, ?, 3, 0, NOW())`,
        [
          authorId,
          meta.title,
          meta.description,
          meta.coverImage,
          meta.primaryGenre
        ]
      )
      storyId = sRes.insertId
      console.log(`  ✅ Đã tạo truyện mới: "${meta.title}" (ID: ${storyId})`)
    }

    // 3. Map thể loại vào story_genres
    await mapGenres(pool, storyId, meta.genres, meta.primaryGenre)

    // 4. Crawl 30 chương cho truyện
    console.log(`  📚 Bắt đầu tải các chương cho "${meta.title}"...`)
    let chapSuccessCount = 0

    for (let cNo = 1; cNo <= MAX_CHAPTERS_PER_STORY; cNo++) {
      try {
        const chap = await crawlChapter(item.slug, cNo)
        if (!chap) {
          console.log(`    ⚠️ Không tìm thấy chương ${cNo}, dừng crawl truyện này.`)
          break
        }

        // Lưu vào bảng chapters
        const [existingRows] = await pool.query(
          'SELECT chapter_id, content FROM chapters WHERE story_id = ? AND chapter_no = ? LIMIT 1',
          [storyId, chap.chapterNo]
        )
        const existingChapter = existingRows && existingRows[0]
        const contentChanged = !!existingChapter && String(existingChapter.content || '') !== String(chap.content || '')
        const needsReview = !existingChapter || contentChanged
        await pool.query(
          `INSERT INTO chapters (story_id, chapter_no, title, content, status, created_at)
           VALUES (?, ?, ?, ?, 'pending_review', NOW())
           ON DUPLICATE KEY UPDATE
             status = IF(NOT (BINARY content <=> BINARY VALUES(content)), 'pending_review', status),
             title = VALUES(title), content = VALUES(content), updated_at = NOW()`,
          [storyId, chap.chapterNo, chap.title, chap.content]
        )
        if (needsReview) {
          let chapterId = existingChapter && existingChapter.chapter_id
          if (chapterId == null) {
            const [savedRows] = await pool.query(
              'SELECT chapter_id FROM chapters WHERE story_id = ? AND chapter_no = ? LIMIT 1', [storyId, chap.chapterNo])
            chapterId = savedRows && savedRows[0] && savedRows[0].chapter_id
          }
          if (chapterId != null) {
            if (contentChanged) {
              // A fingerprint/log belongs to the previous content revision.
              try { await pool.query('DELETE FROM chapter_fingerprints WHERE chapter_id = ?', [chapterId]) } catch (e) { }
              try {
                await pool.query(`UPDATE moderation_logs SET status = 'superseded'
                  WHERE target_type = 'chapter' AND target_id = ? AND status = 'pending_review'`, [chapterId])
              } catch (e) { }
            }
            // New and changed crawler content has no AI verdict; put it in the
            // human queue and bind the decision to this exact revision.
            try {
              await pool.query(`INSERT INTO moderation_logs
                (target_type, target_id, violation_type, confidence_score, evidence_data, trace_id, status)
                VALUES ('chapter', ?, 'plagiarism', 0, ?, NULL, 'pending_review')`, [chapterId,
                JSON.stringify({ zone: 'unknown', fallback_reason: contentChanged ? 'content_changed_outside_review' : 'imported_outside_review',
                  content_hash: hashText(chap.content) })])
            } catch (e) { console.warn(`[moderation] could not queue chapter ${chapterId}:`, e.message) }
          }
        }
        chapSuccessCount++
        totalChaptersCreated++
        process.stdout.write(`    ✓ Đã lưu chương ${cNo}: ${chap.title.slice(0, 35)}...\r`)
      } catch (cErr) {
        console.error(`\n    ❌ Lỗi tải chương ${cNo}:`, cErr.message)
      }
    }

    console.log(`\n  🎉 Hoàn thành truyện "${meta.title}": ${chapSuccessCount} chương!`)
    totalStoriesCreated++
  }

  console.log(`\n============================================================`)
  console.log(`🎊 TỔNG KẾT QUÁ TRÌNH CRAWL:`)
  console.log(`- Số truyện đã nạp vào DB: ${totalStoriesCreated}/${STORIES_TO_CRAWL.length}`)
  console.log(`- Tổng số chương đã lưu: ${totalChaptersCreated}`)
  console.log(`============================================================\n`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('💥 Lỗi trong quá trình crawl:', err)
    process.exit(1)
  })
