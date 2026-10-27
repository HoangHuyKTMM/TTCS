const langfuse = require('./langfuse')

const DAY = 86400000
class ReadError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status }
}

function text(value, name, max = 200) {
  if (value == null) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ReadError('invalid_query', `Tham số ${name} không hợp lệ.`, 400)
  }
  return value
}

function range(query = {}) {
  const now = Date.now()
  const from = query.from == null ? now - 30 * DAY : Date.parse(text(query.from, 'from'))
  const to = query.to == null ? now : Date.parse(text(query.to, 'to'))
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 90 * DAY) {
    throw new ReadError('invalid_range', 'Chọn khoảng thời gian hợp lệ, tối đa 90 ngày.', 400)
  }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

async function request(endpoint, params) {
  const pub = process.env.LANGFUSE_PUBLIC_KEY, secret = process.env.LANGFUSE_SECRET_KEY
  if (!pub || !secret) throw new ReadError('langfuse_not_configured', 'Chưa cấu hình kết nối Langfuse trên server.', 503)
  try {
    const url = new URL(`${langfuse.host()}/api/public/v2/${endpoint}`)
    url.search = new URLSearchParams(params).toString()
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: {
      Authorization: `Basic ${Buffer.from(`${pub}:${secret}`).toString('base64')}`, Accept: 'application/json'
    } })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ReadError('langfuse_auth_failed', 'Langfuse từ chối truy cập. Kiểm tra khóa và vùng máy chủ.', 503)
      if (response.status === 429) throw new ReadError('langfuse_rate_limited', 'Langfuse đang giới hạn lượt đọc. Thử lại sau.', 429)
      throw new ReadError('langfuse_unavailable', 'Không đọc được dữ liệu từ Langfuse.')
    }
    const payload = await response.json()
    if (!Array.isArray(payload?.data)) throw new ReadError('langfuse_invalid_response', 'Langfuse trả về dữ liệu không hợp lệ.')
    return payload
  } catch (error) {
    if (error instanceof ReadError) throw error
    throw new ReadError('langfuse_unavailable', 'Kết nối Langfuse thất bại hoặc hết thời gian chờ.')
  }
}

function numeric(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null
}

function json(value) {
  if (typeof value !== 'string') return value ?? null
  try { return JSON.parse(value) } catch { return value }
}

function observation(row) {
  const metadata = row.metadata || {}
  const latency = numeric(row.latency)
  const duration = row.endTime ? Date.parse(row.endTime) - Date.parse(row.startTime) : NaN
  return {
    id: row.id, trace_id: row.traceId, parent_id: row.parentObservationId ?? null,
    name: row.name, type: row.type, level: row.level, status_message: row.statusMessage,
    start_time: row.startTime, end_time: row.endTime, model: row.model, environment: row.environment,
    latency_ms: latency == null ? (Number.isFinite(duration) ? duration : null) : latency * 1000,
    input: json(row.input), output: json(row.output), metadata,
    usage: row.usageDetails || {}, cost_usd: numeric(row.totalCost),
    provider_cost: numeric(metadata.provider_cost), cost_unit: metadata.cost_unit || 'unknown',
    trace_url: row.traceId ? langfuse.traceUrl(row.traceId) : null
  }
}

async function observations(query = {}, id) {
  const window = range(query)
  const cursor = text(query.cursor, 'cursor', 4000)
  const name = text(query.name, 'name')
  if (id != null && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    throw new ReadError('invalid_trace_id', 'Trace ID không hợp lệ.', 400)
  }
  const params = { fromStartTime: window.from, toStartTime: window.to, limit: '50',
    fields: id ? 'core,basic,io,metadata,model,usage,metrics' : 'core,basic,metadata,model,usage,metrics',
    environment: process.env.LANGFUSE_ENVIRONMENT || 'development' }
  if (id) params.traceId = langfuse.traceId(id)
  else params.type = 'GENERATION'
  if (cursor) params.cursor = cursor
  if (name) params.name = name
  const payload = await request('observations', params)
  return { source: 'langfuse', ...window, data: payload.data.map(observation), next_cursor: payload.meta?.cursor || null }
}

function metric(row = {}) {
  return { requests: numeric(row.count_count) ?? 0, input_tokens: numeric(row.sum_inputTokens),
    output_tokens: numeric(row.sum_outputTokens), total_tokens: numeric(row.sum_totalTokens),
    cost_usd: numeric(row.sum_totalCost), average_latency_ms: numeric(row.avg_latency), p95_latency_ms: numeric(row.p95_latency) }
}

async function metrics(query = {}) {
  const window = range(query)
  const name = text(query.name, 'name')
  const filters = [{ column: 'type', operator: '=', value: 'GENERATION', type: 'string' },
    { column: 'environment', operator: '=', value: process.env.LANGFUSE_ENVIRONMENT || 'development', type: 'string' }]
  if (name) filters.push({ column: 'name', operator: '=', value: name, type: 'string' })
  const base = { view: 'observations', filters, fromTimestamp: window.from, toTimestamp: window.to,
    metrics: [{ measure: 'count', aggregation: 'count' },
      ...['inputTokens', 'outputTokens', 'totalTokens', 'totalCost'].map(measure => ({ measure, aggregation: 'sum' })),
      { measure: 'latency', aggregation: 'avg' }, { measure: 'latency', aggregation: 'p95' }], config: { row_limit: 1000 } }
  const queries = [
    { ...base, dimensions: [] },
    { ...base, dimensions: [{ field: 'name' }, { field: 'providedModelName' }, { field: 'level' }] },
    { ...base, dimensions: [], timeDimension: { granularity: 'day' }, orderBy: [{ field: 'time_dimension', direction: 'asc' }] }
  ]
  const [summary, grouped, daily] = await Promise.all(queries.map(q => request('metrics', { query: JSON.stringify(q) })))
  return { source: 'langfuse', ...window, environment: process.env.LANGFUSE_ENVIRONMENT || 'development',
    summary: metric(summary.data[0]),
    grouped: grouped.data.map(row => ({ task: row.name, model: row.providedModelName, level: row.level, ...metric(row) })),
    daily: daily.data.map(row => ({ date: row.time_dimension, ...metric(row) })),
    grouped_truncated: grouped.data.length >= base.config.row_limit }
}

module.exports = { ReadError, range, observations, metrics }
