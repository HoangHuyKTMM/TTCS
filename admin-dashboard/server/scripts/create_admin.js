#!/usr/bin/env node
require('dotenv').config()
const bcrypt = require('bcryptjs')
const path = require('path')

async function main() {
  const [,, email, password, name] = process.argv
  if (!email || !password) {
    console.log('Usage: node scripts/create_admin.js email password [name]')
    process.exit(1)
  }
  const mysql = require(path.join(__dirname, '..', 'mysql'))
  try {
    const hash = await bcrypt.hash(password, 10)
    // set role to 'admin' (lowercase) to match new DB enum values
    const user = await mysql.createUser({ email, password_hash: hash, name: name || 'Admin', role: 'admin' })
    if (user) {
      console.log('Admin user created:', user)
    } else {
      console.log('Failed to create admin user')
    }
    process.exit(0)
  } catch (err) {
    console.error('Error creating admin user:', err)
    process.exit(1)
  }
}

main()
