#!/usr/bin/env node
require('dotenv').config()
const path = require('path')
const bcrypt = require('bcryptjs')

async function main() {
  const mysql = require(path.join(__dirname, '..', 'mysql'))
  try {
    console.log('Seeding database...')

    // create admin if missing
    const adminEmail = 'admin@example.com'
    const adminPass = 'Admin@1234'
    const adminName = 'Admin User'

    const existingAdmin = await mysql.getUserByEmail(adminEmail)
    if (existingAdmin) {
      console.log('Admin already exists:', adminEmail)
    } else {
      const hash = await bcrypt.hash(adminPass, 10)
      const admin = await mysql.createUser({ email: adminEmail, password_hash: hash, name: adminName, role: 'admin' })
      console.log('Created admin:', admin)
    }

    // create some sample users
    const sampleUsers = [
      { email: 'reader1@example.com', password: 'readerpass', name: 'Reader One' },
      { email: 'reader2@example.com', password: 'readerpass', name: 'Reader Two' }
    ]
    for (const u of sampleUsers) {
      const ex = await mysql.getUserByEmail(u.email)
      if (ex) {
        console.log('User exists:', u.email)
        continue
      }
      const hash = await bcrypt.hash(u.password, 10)
      const created = await mysql.createUser({ email: u.email, password_hash: hash, name: u.name, role: 'user' })
      console.log('Created user:', created.email)
    }

    // create sample books and chapters
    const sampleBooks = [
      { title: 'Truyện Phiêu Lưu', author: 'Nguyễn Văn A', description: 'Một cuộc phiêu lưu kỳ thú.' },
      { title: 'Truyện Tình Yêu', author: 'Lê Thị B', description: 'Câu chuyện tình cảm xúc.' }
    ]

    // Ensure authors exist (authors.user_id may be required and unique)
    const p = await mysql.initPool()
    for (const sb of sampleBooks) {
      const [aRows] = await p.execute('SELECT author_id FROM authors WHERE pen_name = ? LIMIT 1', [sb.author])
      if (aRows && aRows[0]) {
        console.log('Author exists for', sb.author)
        continue
      }
      // create a user to own this author entry
      const authorEmail = sb.author.replace(/\s+/g, '').toLowerCase() + '@example.com'
      let authorUser = await mysql.getUserByEmail(authorEmail)
      if (!authorUser) {
        const hash = await bcrypt.hash('authorpass', 10)
        authorUser = await mysql.createUser({ email: authorEmail, password_hash: hash, name: sb.author, role: 'author' })
        console.log('Created author user:', authorEmail)
      }
      const uid = parseInt(authorUser.id, 10) || 0
      await p.execute('INSERT INTO authors (user_id, pen_name, bio, created_at) VALUES (?, ?, ?, NOW())', [uid, sb.author, null])
      console.log('Inserted authors row for', sb.author)
    }

    for (const sb of sampleBooks) {
      // try to create book
      const book = await mysql.createBook({ title: sb.title, author: sb.author, description: sb.description })
      if (!book) {
        console.log('Failed to create book:', sb.title)
        continue
      }
      console.log('Created book:', book.id, book.title)

      // add two chapters
      await mysql.createChapter(book.id, { title: 'Chương 1', content: 'Nội dung chương 1...' })
      await mysql.createChapter(book.id, { title: 'Chương 2', content: 'Nội dung chương 2...' })
      console.log('Added 2 chapters to', book.title)
    }

    console.log('Seeding complete.')
    process.exit(0)
  } catch (err) {
    console.error('Seeding failed:', err)
    process.exit(1)
  }
}

main()
