// Historical probes expecting the vulnerable implementation before fixes.
// Use audit-ai.cjs for the current regression suite. Do not overwrite baseline evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const agent = require('../../admin-dashboard/server/chat_agent');
const integrity = require('../../admin-dashboard/server/integrity');

const results = [];
async function probe(id, title, run) {
  try {
    const evidence = await run();
    results.push({ id, title, ...evidence });
  } catch (error) {
    results.push({ id, title, harness_error: error.message });
  }
}
function fixture(overrides = {}) {
  return {
    getBookById: async id => ({ id, title: 'Truyện thử nghiệm' }),
    getStorySummaryCache: async () => null,
    getChaptersInRange: async (_id, from, to) => [{ chapter_no: to, content: 'Lan tìm thấy chìa khóa trong vườn.', title: 'Chìa khóa' }],
    getMaxChapterNo: async () => 100,
    saveStorySummaryCache: async () => {},
    ...overrides
  };
}

(async () => {
  // An inert fake key permits injected completions without reading real secrets.
  process.env.AI_API_BASE = 'https://audit.invalid/v1';
  process.env.AI_API_KEY = 'audit-fixture-only';
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  const complete = async () => ({ content: '• Lan tìm thấy chìa khóa.', toolCalls: [] });

  await probe('A01', 'First chapter uses no model', async () => {
    let calls = 0;
    const answer = await agent.getCatchUpSummary(fixture(), 's1', 1, async () => { calls++; return complete(); });
    assert.equal(calls, 0);
    return { verdict: 'pass', calls, calledModel: answer.calledModel };
  });
  await probe('A02', 'Short cached summary is reused', async () => {
    let calls = 0;
    const answer = await agent.getCatchUpSummary(fixture({ getStorySummaryCache: async () => 'Bản tóm tắt hợp lệ.' }), 's1', 20, async () => { calls++; return complete(); });
    assert.equal(calls, 0);
    return { verdict: 'pass', calls, cached: answer.cached };
  });
  await probe('A03', 'Long valid cached summary is regenerated', async () => {
    let calls = 0;
    await agent.getCatchUpSummary(fixture({ getStorySummaryCache: async () => 'a'.repeat(651) }), 's1', 20, async () => { calls++; return complete(); });
    assert.equal(calls, 1);
    return { verdict: 'issue_reproduced', cacheChars: 651, unexpectedModelCalls: calls };
  });
  await probe('A04', 'Concurrent identical misses duplicate model calls', async () => {
    let cache = null, calls = 0;
    const db = fixture({ getStorySummaryCache: async () => cache, saveStorySummaryCache: async row => { cache = row.summary_text; } });
    const delayed = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return complete(); };
    await Promise.all([agent.getCatchUpSummary(db, 's1', 20, delayed), agent.getCatchUpSummary(db, 's1', 20, delayed)]);
    assert.equal(calls, 2);
    return { verdict: 'issue_reproduced', concurrentRequests: 2, modelCalls: calls };
  });
  await probe('A05', 'Ending of a long chapter is absent from summary prompt', async () => {
    let prompt = '';
    await agent.getCatchUpSummary(fixture({ getChaptersInRange: async () => [{ chapter_no: 19, content: 'Mở đầu. '.repeat(220) + 'TWIST_AT_END: Lan là thủ phạm.' }] }), 's1', 20, async req => { prompt = req.messages[1].content; return complete(); });
    assert.equal(prompt.includes('TWIST_AT_END'), false);
    return { verdict: 'issue_reproduced', endingIncluded: false };
  });
  await probe('A06', 'Client chapter overrides existing server progress', async () => {
    let progressReads = 0, range = null;
    const db = fixture({ getProgressByUser: async () => { progressReads++; return [{ book_id: 's1', chapter_no: 5 }]; }, getChaptersInRange: async (_id, from, to) => { range = [from, to]; return [{ chapter_no: to, content: 'Sự kiện về sau.' }]; } });
    await agent.handleChatRequest({ db, userId: 'reader1', body: { message: 'Tóm tắt', book_id: 's1', chapter_no: 100, intent: 'recap' }, complete });
    assert.deepEqual(range, [85, 99]);
    return { verdict: 'issue_reproduced', serverProgress: 5, clientProgress: 100, progressReads, fetchedRange: range };
  });
  await probe('A07', 'Missing progress defaults to latest chapter', async () => {
    let range = null;
    const db = fixture({ getChaptersInRange: async (_id, from, to) => { range = [from, to]; return [{ chapter_no: to, content: 'Sự kiện về sau.' }]; } });
    await agent.handleChatRequest({ db, userId: null, body: { message: 'Tóm tắt', book_id: 's1', intent: 'recap' }, complete });
    assert.deepEqual(range, [85, 99]);
    return { verdict: 'issue_reproduced', missingProgress: true, fetchedRange: range };
  });
  await probe('A08', 'Foreign conversation ID is loaded without ownership check', async () => {
    let loaded = null, secretReachedModel = false;
    const db = fixture({ getBooks: async () => [], listMessages: async id => { loaded = id; return [{ role: 'user', content: 'PRIVATE_OTHER_USER' }]; }, addMessage: async () => ({ id: 1 }) });
    const answer = await agent.handleChatRequest({ db, userId: 'reader2', body: { message: 'Gợi ý', conversation_id: 123, intent: 'recommend' }, complete: async req => { secretReachedModel = req.messages.some(m => m.content.includes('PRIVATE_OTHER_USER')); return complete(); } });
    assert.equal(secretReachedModel, true);
    return { verdict: 'issue_reproduced', loadedConversation: loaded, otherUserHistoryReachedModel: secretReachedModel, status: answer.status };
  });
  await probe('A09', 'Recap chip asks for ten chapters but retrieves fifteen', async () => {
    const window = agent.catchUpWindow(20);
    assert.deepEqual(window, { fromChapter: 5, toChapter: 19 });
    return { verdict: 'issue_reproduced', uiChapters: 10, retrievedChapters: window.toChapter - window.fromChapter + 1, window };
  });
  await probe('A10', 'Unsupported recommended title is accepted', async () => {
    const answer = await agent.handleChatRequest({ db: fixture({ getBooks: async () => [{ id: 's1', title: 'Truyện có thật' }] }), userId: null, body: { message: 'Gợi ý truyện', intent: 'recommend' }, complete: async () => ({ content: 'Bạn nên đọc **TRUYEN_KHONG_TON_TAI**.', toolCalls: [] }) });
    assert.equal(answer.payload.reply.includes('TRUYEN_KHONG_TON_TAI'), true);
    return { verdict: 'issue_reproduced', ungroundedReplyAccepted: true, bookCards: answer.payload.books.length };
  });
  await probe('A11', 'Favorite write has no explicit user intent gate', async () => {
    let saved = 0, turns = 0;
    const db = fixture({ getBooks: async () => [{ id: 's1', title: 'Truyện thử nghiệm' }], getProgressByUser: async () => [], createLike: async () => { saved++; return { id: 'like1' }; } });
    const call = { id: 'tool1', type: 'function', function: { name: 'save_to_favorites', arguments: '{"story_id":"s1"}' } };
    await agent.handleChatRequest({ db, userId: 'reader1', body: { message: 'Chỉ gợi ý truyện cho tôi', intent: 'recommend' }, complete: async () => ++turns === 1 ? { content: '', toolCalls: [call], message: { role: 'assistant', content: null, tool_calls: [call] } } : complete() });
    assert.equal(saved, 1);
    return { verdict: 'issue_reproduced', requestedAction: 'recommend', favoriteWrites: saved };
  });
  await probe('A12', 'Regex rejects benign discussion of sensitive fiction', async () => {
    const text = 'Truyện phê phán khủng bố và lên án bạo lực rất rõ.';
    const answer = integrity.intakeComment(text);
    assert.equal(answer.insert, false);
    return { verdict: 'issue_reproduced', text, rejected: !answer.insert };
  });
  await probe('A13', 'Heuristic confuses ordinary Vietnamese with profanity', async () => {
    const text = 'Các nhân vật có bước trưởng thành lớn trong buổi gặp mặt.';
    const score = integrity.heuristicToxicity(text);
    assert.equal(score, 0.92);
    return { verdict: 'issue_reproduced', text, score, zone: integrity.zoneFromToxicity(score) };
  });
  await probe('A14', 'Score parser accepts an unrelated year as maximum toxicity', async () => {
    const score = await integrity.scoreToxicity('Truyện hay.', async () => ({ content: 'Năm 2026, điểm độc hại là 0.1' }));
    assert.equal(score, 1);
    return { verdict: 'issue_reproduced', modelOutput: 'Năm 2026, điểm độc hại là 0.1', parsedScore: score };
  });
  await probe('A15', 'Toxic ending beyond 2000 characters is not sent to model', async () => {
    let sent = '';
    await integrity.scoreToxicity('Bình luận bình thường. '.repeat(120) + 'TOXIC_END_MARKER', async req => { sent = req.messages[1].content; return { content: '0.1' }; });
    assert.equal(sent.includes('TOXIC_END_MARKER'), false);
    return { verdict: 'issue_reproduced', sentChars: sent.length, endingIncluded: false };
  });
  await probe('A16', 'Middle toxicity zone creates no admin review log', async () => {
    let logs = 0;
    const answer = await integrity.runCommentScore({ db: { applyCommentScore: async () => {}, insertModerationLog: async () => { logs++; } }, comment: { id: 'c1', content: 'Bình luận thử nghiệm' }, complete: async () => ({ content: '0.7' }) });
    assert.equal(logs, 0);
    return { verdict: 'issue_reproduced', score: answer.score, status: answer.status, moderationLogs: logs };
  });
  await probe('A17', 'Exact duplicate is flagged without requiring LLM', async () => {
    const content = 'Lan mở cánh cửa cũ và tìm thấy chiếc hộp gỗ dưới chân cầu thang.';
    const db = { listChapterFingerprints: async () => [{ chapter_id: 'old', story_id: 'other', simhash_64: integrity.simhash64(content).toString() }], getChapterContentById: async () => ({ content }) };
    const answer = await integrity.analyzeContentSimilarity(db, { content });
    assert.equal(answer.hamming, 0);
    assert.equal(answer.zone, 'red');
    return { verdict: 'pass', hamming: answer.hamming, zone: answer.zone };
  });
  await probe('A18', 'Moderation invents 15 percent after dismissing collision', async () => {
    const content = 'Lan mở cánh cửa cũ và tìm thấy chiếc hộp gỗ dưới chân cầu thang.';
    const hash = integrity.simhash64(content) ^ ((1n << 20n) - 1n);
    const answer = await integrity.analyzeContentSimilarity({ listChapterFingerprints: async () => [{ chapter_id: 'old', simhash_64: hash.toString() }], getChapterContentById: async () => ({ content: 'Quả táo.' }) }, { content });
    assert.equal(answer.hamming, 20);
    assert.equal(answer.similarity_pct, 15);
    return { verdict: 'issue_reproduced', hamming: answer.hamming, bitAgreementPct: 68.75, displayedPct: answer.similarity_pct, zone: answer.zone };
  });
  await probe('A19', 'Plagiarism LLM sees only first 1000 characters', async () => {
    let prompt = '';
    await integrity.aiAnalyzePlagiarism('Phần đầu khác nhau. '.repeat(100) + 'COPIED_END_MARKER', 'Mở đầu khác. '.repeat(100) + 'COPIED_END_MARKER', {}, async req => { prompt = req.messages[1].content; return { content: 'Phân tích thử nghiệm.' }; });
    assert.equal(prompt.includes('COPIED_END_MARKER'), false);
    return { verdict: 'issue_reproduced', copiedEndingIncluded: false };
  });
  await probe('A20', 'HTTP rejection from telemetry is reported as stored', async () => {
    const oldFetch = global.fetch;
    process.env.LANGFUSE_PUBLIC_KEY = 'audit-public';
    process.env.LANGFUSE_SECRET_KEY = 'audit-secret';
    try {
      global.fetch = async () => ({ ok: false, status: 401 });
      const answer = await integrity.recordTrace('audit-trace');
      assert.equal(answer.stored, true);
      return { verdict: 'issue_reproduced', httpStatus: 401, reportedStored: answer.stored };
    } finally {
      global.fetch = oldFetch;
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
  });
  const report = { auditDate: '2026-10-01', method: 'synthetic fixtures; injected model responses; no network or production DB', results };
  fs.writeFileSync(path.join(__dirname, 'offline-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.some(r => r.harness_error) ? 1 : 0;
  // Current score helpers leave race timers alive. All probes have settled.
  process.exit(process.exitCode);
})();
