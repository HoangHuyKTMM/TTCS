const runtime = require('./ai_runtime')

// Per database/process, bounded and short lived. Only read-only selections enter here.
const states = new WeakMap()
function stateFor(db) {
  if (!states.has(db)) states.set(db, { entries: new Map(), flights: new Map(), cooldowns: new Map() })
  return states.get(db)
}

async function select({ db, key, provider, generate, fallback }) {
  const state = stateFor(db)
  const now = Date.now()
  for (const [id, entry] of state.entries) if (entry.expires <= now) state.entries.delete(id)
  for (const [id, expires] of state.cooldowns) if (expires <= now) state.cooldowns.delete(id)
  const limit = runtime.positiveInt(process.env.AI_RECOMMEND_CACHE_MAX_ENTRIES, 500, 5000)
  while (state.entries.size > limit) state.entries.delete(state.entries.keys().next().value)
  const cached = state.entries.get(key)
  if (cached) {
    state.entries.delete(key)
    state.entries.set(key, cached)
    return { ...cached.value, cached: true }
  }
  if (state.flights.has(key)) return { ...await state.flights.get(key), shared: true }
  if (state.cooldowns.has(provider)) return fallback('ai_provider_cooldown')
  if (state.flights.size >= runtime.positiveInt(process.env.AI_RECOMMEND_MAX_INFLIGHT, 50, 200)) return fallback('ai_busy')
  const pending = (async () => {
    let value
    try { value = await generate() }
    catch (error) {
      value = fallback(error.code || 'model_failed')
      // Do not repeatedly hit an unhealthy/rate-limited provider with different prompts.
      if (error.code === 'ai_timeout' || (error.code === 'ai_request_failed' && (!error.status || error.status === 429 || error.status >= 500))) {
        const cooldown = runtime.positiveInt(process.env.AI_RECOMMEND_FAILURE_TTL_MS, 15000, 60000)
        state.cooldowns.set(provider, Date.now() + cooldown)
      }
    }
    const ttl = value.fallback_reason
      ? runtime.positiveInt(process.env.AI_RECOMMEND_FAILURE_TTL_MS, 15000, 60000)
      : runtime.positiveInt(process.env.AI_RECOMMEND_CACHE_TTL_MS, 300000, 3600000)
    while (state.entries.size >= limit) state.entries.delete(state.entries.keys().next().value)
    state.entries.set(key, { value, expires: Date.now() + ttl })
    return value
  })()
  state.flights.set(key, pending)
  try { return await pending } finally { state.flights.delete(key) }
}

module.exports = { select }
