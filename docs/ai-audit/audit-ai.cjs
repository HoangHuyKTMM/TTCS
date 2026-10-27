// Current regression suite. Historical probes and results are retained separately.
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const result = spawnSync(process.execPath, ['--test', 'test/ai.test.js', 'test/ai-recommendations.test.js', 'test/ai-comments.test.js', 'test/ai-duplicates.test.js'], {
  cwd: path.join(__dirname, '../../admin-dashboard/server'), stdio: 'inherit', windowsHide: true
})
process.exitCode = result.status ?? 1
