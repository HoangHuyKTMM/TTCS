const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
const db = require('../mysql')
const { installSchema } = require('../ai_store')

async function main() {
  try { await installSchema(await db.initPool()); console.log('AI safety migration complete') }
  finally { await db.closePool() }
}
if (require.main === module) main().catch(e => { console.error(e.code || e.message); process.exitCode = 1 })
module.exports = main
