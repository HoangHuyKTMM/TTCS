import React, { useEffect, useState } from 'react'
import LangfusePanel, { LangfuseTrace } from './LangfusePanel'
import {
  decideModerationLog,
  fetchModerationLog,
  fetchModerationLogs,
  checkDuplicateText,
  backfillFingerprints,
  fetchAiUsage
} from './api'

export default function ModerationPanel() {
  const [tab, setTab] = useState('queue') // 'queue' | 'checker'
  const [logs, setLogs] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [usage, setUsage] = useState([])

  async function loadUsage() {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAiUsage()
      if (!Array.isArray(result?.usage)) throw new Error('usage unavailable')
      setUsage(result.usage)
    } catch (e) { setError('Không tải được thống kê AI') }
    finally { setLoading(false) }
  }

  // Real-time duplicate checker state
  const [checkTitle, setCheckTitle] = useState('')
  const [checkContent, setCheckContent] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const rows = await fetchModerationLogs('pending_review')
      setLogs(Array.isArray(rows) ? rows : [])
      if (rows && rows.error) setError(rows.error)
    } catch (e) {
      setError('Không tải được hàng chờ kiểm duyệt')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function openLog(id) {
    setError('')
    try {
      const detail = await fetchModerationLog(id)
      setSelected(detail && detail.id ? detail : null)
    } catch (e) {
      setError('Không tải được chi tiết mục kiểm duyệt')
    }
  }

  async function decide(action) {
    if (!selected) return
    setError('')
    try {
      await decideModerationLog(selected.id, action)
      setSuccess(action === 'approve' ? 'Đã duyệt xuất bản thành công' : 'Đã khóa nội dung vi phạm')
      setTimeout(() => setSuccess(''), 4000)
      setSelected(null)
      await load()
    } catch (e) {
      setError('Thao tác duyệt/khóa thất bại')
    }
  }

  async function handleBackfill() {
    if (!window.confirm('Hệ thống sẽ quét và tạo vân tay SimHash cho toàn bộ các chương trong cơ sở dữ liệu. Tiếp tục?')) return
    setBackfilling(true)
    setError('')
    try {
      const res = await backfillFingerprints()
      if (res && res.success) {
        setSuccess(`Đồng bộ vân tay thành công! Đã xử lý ${res.processed}/${res.total} chương.`)
      } else {
        setError(res?.message || 'Đồng bộ vân tay thất bại')
      }
    } catch (e) {
      setError('Lỗi khi gọi API đồng bộ vân tay')
    } finally {
      setBackfilling(false)
    }
  }

  async function handleRunCheck() {
    if (!checkContent.trim()) {
      alert('Vui lòng nhập nội dung cần kiểm tra')
      return
    }
    setChecking(true)
    setCheckResult(null)
    setError('')
    try {
      const res = await checkDuplicateText({
        title: checkTitle.trim(),
        content: checkContent.trim()
      })
      if (res && !res.error) {
        setCheckResult(res)
      } else {
        setError(res?.message || res?.error || 'Kiểm tra thất bại')
      }
    } catch (e) {
      setError('Lỗi kết nối máy chủ phân tích AI')
    } finally {
      setChecking(false)
    }
  }

  const zone = selected && selected.evidence_data && selected.evidence_data.zone
  const showDiff = selected && (zone === 'yellow' || zone === 'red' || selected.violation_type === 'plagiarism' || selected.violation_type === 'toxicity')
  const isComment = selected?.target_type === 'comment'
  const zoneLabel = zone === 'red' ? (isComment ? 'Vùng Đỏ (Độc hại cao)' : 'Vùng Đỏ (Trùng lặp cao)') : zone === 'yellow' ? 'Vùng Vàng (Cần duyệt)' : 'Cần đối chiếu'
  const zoneClass = zone === 'red' ? 'diff-red' : 'diff-yellow'
  const similarityPct = selected?.evidence_data?.similarity_pct ?? (selected?.confidence_score ? Math.round(selected.confidence_score * 100) : 0)

  return (
    <div>
      {/* Navigation sub-tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, borderBottom: '2px solid #e2e8f0', marginBottom: 16 }}>
        <button
          className={`btn ${tab === 'queue' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setTab('queue'); setSelected(null) }}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none' }}
        >
          📋 Hàng chờ kiểm duyệt AI ({logs.length})
        </button>
        <button
          className={`btn ${tab === 'checker' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('checker')}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none' }}
        >
          🔍 Công cụ phân tích trùng lặp tức thời
        </button>
        <button className={`btn ${tab === 'usage' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setTab('usage'); loadUsage() }}>
          Token và chi phí AI
        </button>
        <button className={`btn ${tab === 'langfuse' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('langfuse')}>Langfuse</button>
      </div>

      {error ? <div className="alert error" style={{ marginBottom: 12 }}>{error}</div> : null}
      {success ? <div className="alert success" style={{ marginBottom: 12, backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '10px 14px', borderRadius: 8 }}>{success}</div> : null}

      {tab === 'langfuse' && <LangfusePanel />}

      {tab === 'usage' && <div>
        <p>Thống kê 30 ngày gần nhất. Chi phí do nhà cung cấp báo; đơn vị “unknown” cần đối soát trước khi quy đổi thành tiền.</p>
        <button className="btn btn-secondary" disabled={loading} onClick={loadUsage}>Tải lại</button>
        <div className="table"><table><thead><tr>
          <th>Tác vụ</th><th>Model phản hồi</th><th>Trạng thái</th><th>Lần gọi</th><th>Input token</th><th>Output token</th><th>Input cache</th><th>Thời gian TB</th><th>Chi phí báo cáo</th>
        </tr></thead><tbody>
          {usage.length === 0 && <tr><td colSpan="9">Chưa có lượt gọi AI được ghi nhận.</td></tr>}
          {usage.map((row, i) => <tr key={i}>
            <td>{row.task}</td><td>{row.response_model || row.requested_model}</td><td>{row.status}</td><td>{row.requests}</td>
            <td>{row.prompt_tokens ?? '—'}</td><td>{row.completion_tokens ?? '—'}</td><td>{row.cached_tokens ?? '—'}</td>
            <td>{(Number(row.average_latency_ms) / 1000).toFixed(2)} s</td><td>{row.provider_cost == null ? '—' : `${row.provider_cost} ${row.cost_unit || 'unknown'}`}</td>
          </tr>)}
        </tbody></table></div>
      </div>}

      {/* TAB 1: MODERATION QUEUE */}
      {tab === 'queue' && (
        <div>
          <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              Các chương truyện bị phát hiện tương đồng SimHash và bình luận độc hại cần quản trị viên duyệt trước khi xuất bản.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-small" onClick={handleBackfill} disabled={backfilling}>
                {backfilling ? 'Đang đồng bộ...' : '⚡ Đồng bộ vân tay kho truyện'}
              </button>
              <button className="btn btn-primary btn-small" onClick={load} disabled={loading}>
                {loading ? 'Đang tải...' : '🔄 Tải lại'}
              </button>
            </div>
          </div>

          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Loại</th>
                  <th>Phát hiện</th>
                  <th>Điểm đối chiếu</th>
                  <th>Vùng</th>
                  <th>Truyện đối chiếu</th>
                  <th>Thời gian</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                      🎉 Không có mục nào đang chờ kiểm duyệt!
                    </td>
                  </tr>
                )}
                {logs.map((row) => {
                  const rZone = row.evidence_data?.zone || (row.confidence_score > 0.85 ? 'red' : 'yellow')
                  const rPct = row.evidence_data?.similarity_pct ?? Math.round((row.confidence_score || 0) * 100)
                  const matchedStory = row.evidence_data?.matched_story_title || (row.matched_target_id ? `ID: ${row.matched_target_id}` : '-')
                  return (
                    <tr key={row.id}>
                      <td><strong>#{row.id}</strong></td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, background: row.target_type === 'chapter' ? '#e0f2fe' : '#f1f5f9', color: row.target_type === 'chapter' ? '#0369a1' : '#334155' }}>
                          {row.target_type === 'chapter' ? 'Chương truyện' : 'Bình luận'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: row.violation_type === 'plagiarism' ? '#b91c1c' : '#c2410c' }}>
                          {row.violation_type === 'plagiarism' ? '⚠️ Cần đối chiếu nội dung' : '⛔ Kiểm duyệt bình luận'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: rZone === 'red' ? '#dc2626' : '#d97706' }}>
                          {rPct}% {row.target_type === 'chapter' ? 'Jaccard' : 'toxic'}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 700,
                          backgroundColor: rZone === 'red' ? '#fee2e2' : '#fef3c7',
                          color: rZone === 'red' ? '#991b1b' : '#92400e'
                        }}>
                          {rZone === 'red' ? 'Đỏ' : 'Vàng'}
                        </span>
                      </td>
                      <td style={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {matchedStory}
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>
                        {row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : ''}
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-small" onClick={() => openLog(row.id)}>
                          Xem chi tiết
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* DETAIL & DIFF VIEWER */}
          {showDiff && selected.diff && (
            <div style={{ marginTop: 24, padding: 18, backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #cbd5e1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, color: '#0f172a' }}>
                  {isComment ? 'Kiểm duyệt bình luận' : 'Đối chiếu trùng lặp'} — <span style={{ color: zone === 'red' ? '#dc2626' : '#d97706' }}>{zoneLabel} ({similarityPct}% {isComment ? 'điểm độc hại' : 'Jaccard'})</span>
                </h3>
                <button className="btn btn-ghost btn-small" onClick={() => setSelected(null)}>✕ Đóng</button>
              </div>

              {/* Matched Story Info Box */}
              {selected.evidence_data && selected.evidence_data.matched_story_title && (
                <div style={{ backgroundColor: '#fff', padding: '10px 14px', borderRadius: 8, marginBottom: 14, border: '1px solid #e2e8f0' }}>
                  <strong>Nguồn nghi vấn:</strong> Truyện <em>"{selected.evidence_data.matched_story_title}"</em> — Chương {selected.evidence_data.matched_chapter_no || ''}: "{selected.evidence_data.matched_chapter_title || ''}" (Hamming: {selected.evidence_data.hamming}/64)
                </div>
              )}

              {/* AI Semantic Analysis Box */}
              {selected.diff.ai_analysis && (
                <div style={{ backgroundColor: '#eff6ff', padding: '12px 16px', borderRadius: 8, marginBottom: 14, borderLeft: '4px solid #3b82f6' }}>
                  <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>🤖 Nhận định phân tích của AI:</div>
                  <div style={{ color: '#1e293b', fontSize: 14, lineHeight: 1.5 }}>{selected.diff.ai_analysis}</div>
                </div>
              )}

              {/* Highlighted Matched Snippets */}
              {selected.diff.matched_snippets && selected.diff.matched_snippets.length > 0 && (
                <div style={{ backgroundColor: '#fff', padding: 14, borderRadius: 8, marginBottom: 14, border: '1px solid #fecaca' }}>
                  <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 8 }}>
                    📌 Các đoạn văn bản trùng khớp phát hiện được ({selected.diff.matched_snippets.length}):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {selected.diff.matched_snippets.map((snip, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 8, backgroundColor: '#fef2f2', borderRadius: 6, fontSize: 13 }}>
                        <div>
                          <strong>Nội dung mới ({snip.similarity}%):</strong>
                          <p style={{ margin: '4px 0 0', color: '#991b1b' }}>"{snip.snippetA}"</p>
                        </div>
                        <div>
                          <strong>Bản đối chiếu:</strong>
                          <p style={{ margin: '4px 0 0', color: '#334155' }}>"{snip.snippetB}"</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Two Column Text Comparison */}
              <div className="diff-grid">
                <div className={`diff-col ${zoneClass}`}>
                  <header style={{ fontWeight: 700 }}>
                    {selected.diff.left.story_title ? `[${selected.diff.left.story_title}] ` : ''}
                    {selected.diff.left.title}
                  </header>
                  <pre style={{ maxHeight: 400, overflowY: 'auto' }}>{selected.diff.left.text}</pre>
                </div>
                <div className="diff-col">
                  <header style={{ fontWeight: 700 }}>
                    {selected.diff.right.story_title ? `[${selected.diff.right.story_title}] ` : ''}
                    {selected.diff.right.title}
                  </header>
                  <pre style={{ maxHeight: 400, overflowY: 'auto' }}>{selected.diff.right.text}</pre>
                </div>
              </div>

              {/* Actions */}
              <div className="actions" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 12 }}>
                <button
                  className="btn btn-ghost"
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={() => decide('reject')}
                >
                  🚫 Khóa nội dung (Vi phạm)
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => decide('approve')}
                >
                  ✓ Duyệt cho phép xuất bản
                </button>
              </div>

            </div>
          )}
          {selected?.trace_id && <LangfuseTrace traceId={selected.trace_id} at={selected.created_at} url={selected.trace_url} />}
        </div>
      )}

      {/* TAB 2: REAL-TIME DUPLICATE CHECKER */}
      {tab === 'checker' && (
        <div style={{ backgroundColor: '#fff', padding: 20, borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, color: '#0f172a' }}>
            🔍 Công cụ phân tích trùng lặp tức thời bằng AI
          </h3>
          <p className="muted" style={{ marginBottom: 16 }}>
            Dán văn bản bất kỳ để quét so khớp vân tay SimHash 64-bit và thuật toán AI với toàn bộ kho truyện trên hệ thống.
          </p>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Tiêu đề chương / truyện (tùy chọn):</label>
            <input
              type="text"
              className="input"
              placeholder="VD: Chương 1: Sự khởi đầu..."
              value={checkTitle}
              onChange={(e) => setCheckTitle(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Nội dung văn bản cần kiểm tra:</label>
            <textarea
              className="input"
              placeholder="Dán nội dung chương truyện vào đây để phân tích..."
              rows={10}
              value={checkContent}
              onChange={(e) => setCheckContent(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Độ dài: {checkContent.trim().length} ký tự</span>
            <button className="btn btn-primary" onClick={handleRunCheck} disabled={checking}>
              {checking ? '⏳ Đang phân tích SimHash & AI...' : '🚀 Bắt đầu phân tích trùng lặp'}
            </button>
          </div>

          {/* CHECK RESULTS DISPLAY */}
          {checkResult && (
            <div style={{ marginTop: 24, padding: 18, borderRadius: 10, border: `2px solid ${checkResult.zone === 'red' ? '#ef4444' : checkResult.zone === 'yellow' ? '#f59e0b' : '#10b981'}`, backgroundColor: checkResult.zone === 'red' ? '#fef2f2' : checkResult.zone === 'yellow' ? '#fffbeb' : '#f0fdf4' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h4 style={{ margin: 0, color: checkResult.zone === 'red' ? '#b91c1c' : checkResult.zone === 'yellow' ? '#b45309' : '#047857' }}>
                  {checkResult.zone === 'red' ? '🔴 Có dấu hiệu sao chép rõ' : checkResult.zone === 'yellow' ? '🟡 Có đoạn cần đối chiếu' : '🟢 Chưa phát hiện đoạn tương đồng rõ'}
                </h4>
                <span style={{ fontWeight: 800, fontSize: 18, color: checkResult.zone === 'red' ? '#b91c1c' : checkResult.zone === 'yellow' ? '#b45309' : '#047857' }}>
                  {checkResult.similarity_pct}% Jaccard cụm 5 từ
                </span>
              </div>

              <p style={{ margin: '8px 0', fontSize: 14, color: '#1e293b' }}>
                {checkResult.message}
              </p>

              {checkResult.matched_chapter && (
                <div style={{ marginTop: 12, padding: 12, backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <strong>Chương trùng khớp nhất:</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13 }}>
                    <li><strong>Truyện:</strong> {checkResult.matched_chapter.story_title || 'Không rõ'}</li>
                    <li><strong>Chương:</strong> {checkResult.matched_chapter.chapter_no || ''}: {checkResult.matched_chapter.chapter_title || ''}</li>
                    <li><strong>Khoảng cách Hamming:</strong> {checkResult.hamming} / 64 bit</li>
                  </ul>
                </div>
              )}

              {checkResult.ai_analysis && (
                <div style={{ marginTop: 12, padding: 12, backgroundColor: '#eff6ff', borderRadius: 8, borderLeft: '4px solid #3b82f6' }}>
                  <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>🤖 Đánh giá từ mô hình AI:</div>
                  <div style={{ fontSize: 13, color: '#1e293b' }}>{checkResult.ai_analysis}</div>
                </div>
              )}

              {checkResult.matched_snippets && checkResult.matched_snippets.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>
                    📋 Các câu / đoạn văn bản tương đồng:
                  </div>
                  {checkResult.matched_snippets.map((snip, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 10, backgroundColor: '#fff', borderRadius: 6, marginBottom: 6, fontSize: 13, border: '1px solid #fed7aa' }}>
                      <div>
                        <strong style={{ color: '#c2410c' }}>Đoạn văn của bạn:</strong>
                        <p style={{ margin: '4px 0 0' }}>"{snip.snippetA}"</p>
                      </div>
                      <div>
                        <strong style={{ color: '#0369a1' }}>Đoạn văn đối chiếu ({snip.similarity}%):</strong>
                        <p style={{ margin: '4px 0 0' }}>"{snip.snippetB}"</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
