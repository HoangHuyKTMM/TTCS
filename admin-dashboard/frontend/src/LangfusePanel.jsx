import React, { useEffect, useRef, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import 'chart.js/auto'
import { fetchLangfuseMetrics, fetchLangfuseObservations, fetchLangfuseTrace } from './api'

const number = value => value == null ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 6 })
const seconds = value => value == null ? '—' : `${number(value / 1000)} s`
const formatJson = value => value == null ? 'Không có dữ liệu' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const dateText = value => value ? new Date(value).toLocaleString('vi-VN') : '—'
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function initialDates() {
  const end = new Date(), start = new Date()
  start.setDate(start.getDate() - 29)
  return { start: localDate(start), end: localDate(end) }
}

function dateRange(start, end) {
  const from = new Date(`${start}T00:00:00`), to = new Date(`${end}T00:00:00`)
  to.setDate(to.getDate() + 1)
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || to - from > 90 * 86400000) {
    throw new Error('Chọn khoảng thời gian hợp lệ, tối đa 90 ngày.')
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

export function LangfuseTrace({ traceId, from, to, at, url }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const request = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    let query = { from, to }
    // Moderation items may be older than the dashboard's default 30-day window.
    const anchor = at ? Date.parse(at) : NaN
    if (!from && !to && Number.isFinite(anchor)) query = {
      from: new Date(anchor - 86400000).toISOString(), to: new Date(anchor + 86400000).toISOString()
    }
    request.current = { controller, query }
    setResult(null); setError(''); setLoading(true); setMoreLoading(false)
    fetchLangfuseTrace(traceId, query, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [traceId, from, to, at, reload])

  async function loadMore() {
    const { controller, query } = request.current
    setMoreLoading(true); setError('')
    try {
      const page = await fetchLangfuseTrace(traceId, { ...query, cursor: result.next_cursor }, controller.signal)
      if (!controller.signal.aborted) setResult(previous => ({ ...page, data: [...previous.data, ...page.data.filter(row => !previous.data.some(old => old.id === row.id))] }))
    } catch (e) { if (!controller.signal.aborted) setError(e.message) }
    finally { if (!controller.signal.aborted) setMoreLoading(false) }
  }

  return <section className="langfuse-trace">
    <div className="actions">
      <h4>Chi tiết trace AI</h4>
      <button className="btn btn-secondary btn-small" disabled={loading || moreLoading} onClick={() => setReload(v => v + 1)}>Tải lại trace</button>
      {(result?.url || url) && <a href={result?.url || url} target="_blank" rel="noopener noreferrer">Mở trên Langfuse ↗</a>}
    </div>
    {loading && <p role="status">Đang tải chi tiết từ Langfuse...</p>}
    {error && <p className="alert error" role="alert">{error}</p>}
    {result?.data.length === 0 && <p>Chưa có dữ liệu trace trong khoảng thời gian này. Dữ liệu mới có thể cần thêm thời gian để xuất hiện; hãy tải lại.</p>}
    {result?.data.map(row => <details key={row.id} className="langfuse-observation" open>
      <summary><strong>{row.name || row.type}</strong> · {row.type} · {row.level || 'DEFAULT'}</summary>
      <p className="muted">{dateText(row.start_time)} · {row.model || 'Không có model'} · {seconds(row.latency_ms)}</p>
      <p>Input token: {number(row.usage.input)} · Output token: {number(row.usage.output)} · Chi phí Langfuse: {number(row.cost_usd)} USD
        {row.provider_cost != null && <> · Nhà cung cấp báo: {number(row.provider_cost)} {row.cost_unit}</>}</p>
      {row.status_message && <p role="status">{row.status_message}</p>}
      <div className="langfuse-io">
        <div><h5>Prompt / Input</h5><pre>{formatJson(row.input)}</pre></div>
        <div><h5>Phản hồi / Output</h5><pre>{formatJson(row.output)}</pre></div>
      </div>
      <details><summary>Thông tin bổ sung</summary><pre>{formatJson(row.metadata)}</pre></details>
    </details>)}
    {result?.next_cursor && <button className="btn btn-secondary" disabled={moreLoading} onClick={loadMore}>{moreLoading ? 'Đang tải...' : 'Tải thêm dữ liệu trace'}</button>}
  </section>
}

export default function LangfusePanel() {
  const [dates, setDates] = useState(initialDates)
  const [task, setTask] = useState('')
  const [query, setQuery] = useState(() => { const d = initialDates(); return dateRange(d.start, d.end) })
  const [metrics, setMetrics] = useState(null)
  const [observations, setObservations] = useState(null)
  const [metricsError, setMetricsError] = useState('')
  const [listError, setListError] = useState('')
  const [filterError, setFilterError] = useState('')
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const request = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    setMetrics(null); setObservations(null); setSelected(null); setMetricsError(''); setListError('')
    setMetricsLoading(true); setListLoading(true); setMoreLoading(false)
    fetchLangfuseMetrics(query, controller.signal).then(data => { if (!controller.signal.aborted) setMetrics(data) })
      .catch(e => { if (!controller.signal.aborted) setMetricsError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setMetricsLoading(false) })
    fetchLangfuseObservations(query, controller.signal).then(data => { if (!controller.signal.aborted) setObservations(data) })
      .catch(e => { if (!controller.signal.aborted) setListError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false) })
    return () => controller.abort()
  }, [query])

  function apply(event) {
    event.preventDefault()
    try { setQuery({ ...dateRange(dates.start, dates.end), name: task.trim() || undefined }); setFilterError('') }
    catch (e) { setFilterError(e.message) }
  }

  async function loadMore() {
    const controller = request.current
    setMoreLoading(true); setListError('')
    try {
      const page = await fetchLangfuseObservations({ ...query, cursor: observations.next_cursor }, controller.signal)
      if (!controller.signal.aborted) setObservations(previous => ({ ...page, data: [...previous.data, ...page.data.filter(row => !previous.data.some(old => old.id === row.id))] }))
    } catch (e) { if (!controller.signal.aborted) setListError(e.message) }
    finally { if (!controller.signal.aborted) setMoreLoading(false) }
  }

  const summary = metrics?.summary
  const chart = { labels: metrics?.daily.map(row => String(row.date).slice(0, 10)) || [],
    datasets: [{ label: 'Lượt gọi AI', data: metrics?.daily.map(row => row.requests) || [], backgroundColor: '#6366f1', borderRadius: 4 }] }

  return <div className="langfuse-panel">
    <h3>Giám sát AI từ Langfuse</h3>
    <form className="langfuse-filters" onSubmit={apply}>
      <label>Từ ngày<input aria-label="Từ ngày" type="date" value={dates.start} required onChange={e => setDates({ ...dates, start: e.target.value })} /></label>
      <label>Đến ngày<input aria-label="Đến ngày" type="date" value={dates.end} required onChange={e => setDates({ ...dates, end: e.target.value })} /></label>
      <label>Tác vụ<input aria-label="Tác vụ" placeholder="Tất cả tác vụ" maxLength={200} value={task} onChange={e => setTask(e.target.value)} /></label>
      <button className="btn btn-primary" type="submit">Áp dụng / Tải lại</button>
    </form>
    {filterError && <p role="alert" className="alert error">{filterError}</p>}
    <p className="muted">Dữ liệu lần gọi model được đọc trực tiếp từ Langfuse{metrics && ` · Môi trường: ${metrics.environment}`}. Chi phí Langfuse tính bằng USD và có thể là ước tính theo model; báo giá VND hiển thị riêng trong chi tiết. “—” nghĩa là chưa có dữ liệu.</p>
    {metricsLoading && <p role="status">Đang tải thống kê từ Langfuse...</p>}
    {metricsError && <p role="alert" className="alert error">{metricsError}</p>}
    {summary && <>
      <div className="kpi-grid langfuse-kpis">
        {[['Lượt gọi model', number(summary.requests)], ['Input token', number(summary.input_tokens)], ['Output token', number(summary.output_tokens)],
          ['Chi phí Langfuse (USD)', number(summary.cost_usd)], ['Thời gian trung bình', seconds(summary.average_latency_ms)], ['Thời gian P95', seconds(summary.p95_latency_ms)]].map(([label, value]) =>
          <div className="kpi" key={label}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div></div>)}
      </div>
      {metrics.daily.length > 0 && <div className="langfuse-chart"><h4>Lượt gọi AI theo ngày (UTC)</h4><Bar data={chart} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }} /></div>}
      <h4>Thống kê theo tác vụ và model</h4>
      {metrics.grouped_truncated && <p>Kết quả nhóm đạt giới hạn 1.000 dòng. Thu hẹp bộ lọc để xem đầy đủ.</p>}
      <div className="table"><table><thead><tr><th>Tác vụ</th><th>Model</th><th>Mức độ</th><th>Lượt gọi</th><th>Input token</th><th>Output token</th><th>Thời gian TB</th><th>USD</th></tr></thead>
        <tbody>{metrics.grouped.length === 0 && <tr><td colSpan="8">Chưa có lần gọi model trong khoảng thời gian đã chọn.</td></tr>}
          {metrics.grouped.map((row, i) => <tr key={i}><td>{row.task}</td><td>{row.model || '—'}</td><td>{row.level}</td><td>{number(row.requests)}</td><td>{number(row.input_tokens)}</td><td>{number(row.output_tokens)}</td><td>{seconds(row.average_latency_ms)}</td><td>{number(row.cost_usd)}</td></tr>)}</tbody>
      </table></div>
    </>}
    <h4>Các lần gọi AI</h4>
    {listLoading && <p role="status">Đang tải danh sách...</p>}
    {listError && <p role="alert" className="alert error">{listError}</p>}
    {observations && <>
      <div className="table"><table><thead><tr><th>Thời gian</th><th>Tác vụ</th><th>Model</th><th>Mức độ</th><th>Token vào / ra</th><th>Thời gian chạy</th><th>Nhà cung cấp báo</th><th></th></tr></thead>
        <tbody>{observations.data.length === 0 && <tr><td colSpan="8">Chưa có dữ liệu. Hãy kiểm tra khoảng thời gian hoặc tải lại sau khi trace được gửi.</td></tr>}
          {observations.data.map(row => <tr key={row.id}><td>{dateText(row.start_time)}</td><td>{row.name}</td><td>{row.model || '—'}</td><td>{row.level}</td><td>{number(row.usage.input)} / {number(row.usage.output)}</td><td>{seconds(row.latency_ms)}</td><td>{row.provider_cost == null ? '—' : `${number(row.provider_cost)} ${row.cost_unit}`}</td>
            <td>{row.trace_id && <button className="btn btn-secondary btn-small" onClick={() => setSelected(row)}>Xem trace</button>}</td></tr>)}</tbody>
      </table></div>
      {observations.next_cursor && <button className="btn btn-secondary" disabled={moreLoading} onClick={loadMore}>{moreLoading ? 'Đang tải...' : 'Tải thêm lần gọi AI'}</button>}
    </>}
    {selected && <div><button className="btn btn-secondary" onClick={() => setSelected(null)}>Đóng chi tiết trace</button>
      <LangfuseTrace traceId={selected.trace_id} from={query.from} to={query.to} url={selected.trace_url} /></div>}
  </div>
}
