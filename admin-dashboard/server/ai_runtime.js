const { AsyncLocalStorage } = require('node:async_hooks')
const crypto = require('node:crypto')

const context = new AsyncLocalStorage()
let store = null
function configure(db) { store = db }
function withContext(values, fn) { return context.run({ traceId: crypto.randomUUID(), ...values }, fn) }
function currentContext() { return context.getStore() || {} }
function positiveInt(value, fallback, max = 1000000) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback
}
function aiError(code, message) { return Object.assign(new Error(message), { code }) }

// The same signal reaches fetch. The race also protects injected/non-cooperative clients.
async function withDeadline(operation, timeoutMs, parentSignal) {
  const controller = new AbortController()
  let timer, onAbort
  const cancelled = new Promise((_, reject) => {
    onAbort = () => { controller.abort(parentSignal?.reason); reject(aiError('ai_cancelled', 'AI request cancelled')) }
    if (parentSignal?.aborted) return onAbort()
    parentSignal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      controller.abort(aiError('ai_timeout', 'AI request timed out'))
      reject(aiError('ai_timeout', 'AI request timed out'))
    }, timeoutMs)
  })
  try {
    if (controller.signal.aborted) return await cancelled
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), cancelled])
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onAbort)
  }
}

async function reserveCall() {
  if (!store) return
  const { userId } = currentContext()
  const daily = positiveInt(process.env.AI_DAILY_CALL_LIMIT, 1000)
  const perUser = positiveInt(process.env.AI_USER_DAILY_CALL_LIMIT, 100)
  if (userId && !await store.consumeAiQuota('model-user', userId, perUser, 86400000)) {
    throw aiError('ai_budget_exceeded', 'Daily AI request quota reached')
  }
  if (!await store.consumeAiQuota('model-global', 'all', daily, 86400000)) {
    throw aiError('ai_budget_exceeded', 'Daily AI request quota reached')
  }
}

async function recordUsage(record) {
  const event = { id: crypto.randomUUID(), ...currentContext(), ...record }
  if (store) {
    try { await store.recordAiUsage(event) } catch (e) { console.error('[ai-usage]', e.code || 'store_failed') }
  }
  return event
}

module.exports = { configure, withContext, currentContext, positiveInt, aiError, withDeadline, reserveCall, recordUsage }
