const crypto = require('node:crypto')

function host() {
  return String(process.env.LANGFUSE_HOST || process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com').replace(/\/+$/, '')
}

// Existing database trace IDs are UUIDs; OTLP requires 16-byte, hex-encoded IDs.
function traceId(value) {
  const hex = String(value || '').replaceAll('-', '').toLowerCase()
  return /^[a-f0-9]{32}$/.test(hex) && !/^0+$/.test(hex) ? hex
    : crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)
}

function traceUrl(id) {
  const project = process.env.LANGFUSE_PROJECT_ID
  return project && id ? `${host()}/project/${encodeURIComponent(project)}/traces/${traceId(id)}` : null
}

function attributes(values) {
  return Object.entries(values).filter(([, v]) => v !== undefined && v !== null).map(([key, value]) => ({
    key, value: { stringValue: typeof value === 'string' ? value : JSON.stringify(value) }
  }))
}

async function exportSpan({ id, observationId, name, type = 'span', userId, startTimeMs = Date.now(), endTimeMs = Date.now(),
  input, output, metadata = {}, extra = {}, failed = false }) {
  const pub = process.env.LANGFUSE_PUBLIC_KEY, secret = process.env.LANGFUSE_SECRET_KEY
  if (!pub || !secret || !id) return { stored: false, trace_id: id || null }
  const end = Math.trunc(endTimeMs), start = Math.min(Math.trunc(startTimeMs), end)
  const spanId = crypto.createHash('sha256').update(String(observationId || crypto.randomUUID())).digest('hex').slice(0, 16)
  const fields = {
    'langfuse.trace.name': name,
    'langfuse.user.id': userId == null ? undefined : String(userId),
    'langfuse.environment': process.env.LANGFUSE_ENVIRONMENT || 'development',
    'langfuse.observation.type': type,
    'langfuse.observation.input': input,
    'langfuse.observation.output': output,
    'langfuse.observation.level': failed ? 'ERROR' : 'DEFAULT',
    'langfuse.observation.metadata.app_trace_id': String(id),
    ...Object.fromEntries(Object.entries(metadata).map(([key, value]) => [`langfuse.observation.metadata.${key}`, value])),
    ...extra
  }
  try {
    const response = await fetch(`${host()}/api/public/otel/v1/traces`, {
      method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Basic ${Buffer.from(`${pub}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/json', 'x-langfuse-ingestion-version': '4' },
      body: JSON.stringify({ resourceSpans: [{ resource: { attributes: attributes({ 'service.name': 'reader-app-backend' }) },
        scopeSpans: [{ scope: { name: 'reader-app' }, spans: [{ traceId: traceId(id), spanId, name,
          kind: 1, startTimeUnixNano: (BigInt(start) * 1000000n).toString(), endTimeUnixNano: (BigInt(end) * 1000000n).toString(),
          attributes: attributes(fields), status: { code: failed ? 2 : 1 } }] }] }] })
    })
    const result = response.ok ? await response.json() : null
    const stored = response.ok && !Number(result?.partialSuccess?.rejectedSpans || 0)
    if (!stored) console.error('[langfuse]', `export_failed HTTP ${response.status}`)
    return { stored, trace_id: id, observation_id: spanId }
  } catch (error) {
    console.error('[langfuse]', error.name || 'export_failed')
    return { stored: false, trace_id: id }
  }
}

function recordGeneration(event) {
  const end = Date.now()
  return exportSpan({ id: event.traceId, observationId: event.id, name: event.task || 'chat', type: 'generation',
    userId: event.userId, startTimeMs: end - event.latencyMs, endTimeMs: end, input: event.input, output: event.output,
    failed: event.status === 'failed', metadata: { provider: event.provider, status: event.status,
      finish_reason: event.finishReason, error_code: event.errorCode, provider_cost: event.usage?.x_ckey?.cost,
      cost_unit: process.env.AI_PROVIDER_COST_UNIT || 'unknown' },
    extra: {
      'langfuse.observation.model.name': event.provider === 'api.x.ai' ? event.responseModel || event.requestedModel
        : `${event.provider}/${event.responseModel || event.requestedModel}`,
      'langfuse.observation.model.parameters': event.modelParameters,
      'langfuse.observation.usage_details': { input: event.usage?.prompt_tokens, output: event.usage?.completion_tokens },
      // Langfuse cost_details is USD. Keep VND quotes in metadata without mislabeling them as USD.
      'langfuse.observation.cost_details': process.env.AI_PROVIDER_COST_UNIT === 'USD' && typeof event.usage?.x_ckey?.cost === 'number'
        ? { total: event.usage.x_ckey.cost } : undefined
    } })
}

module.exports = { host, traceId, traceUrl, exportSpan, recordGeneration }
