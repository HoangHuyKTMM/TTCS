const read = require('./langfuse_read')
const langfuse = require('./langfuse')

module.exports = function registerLangfuseRoutes(app, authMiddleware, requireAdmin) {
  const handler = operation => async (req, res) => {
    if (!requireAdmin(req, res)) return
    res.set('Cache-Control', 'no-store')
    try { res.json(await operation(req)) }
    catch (error) {
      const known = error instanceof read.ReadError
      res.status(known ? error.status : 502).json({ error: known ? error.code : 'langfuse_unavailable',
        message: known ? error.message : 'Không đọc được dữ liệu từ Langfuse.' })
    }
  }
  app.get('/moderation/langfuse/metrics', authMiddleware, handler(req => read.metrics(req.query)))
  app.get('/moderation/langfuse/observations', authMiddleware, handler(req => read.observations(req.query)))
  app.get('/moderation/traces/:traceId', authMiddleware, handler(async req => ({
    ...(await read.observations(req.query, req.params.traceId)),
    trace_id: req.params.traceId, url: langfuse.traceUrl(req.params.traceId)
  })))
}
