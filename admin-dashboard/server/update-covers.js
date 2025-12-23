// Script to update book covers in database
require('dotenv').config()
const db = require('./mysql')
const fs = require('fs')
const path = require('path')

async function updateCovers() {
  try {
    // Get all books
    const books = await db.getBooks()
    console.log(`Found ${books.length} books`)

    // Get all cover images
    const coversDir = path.join(__dirname, 'public', 'covers')
    const coverFiles = fs.readdirSync(coversDir).filter(f => 
      f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg')
    )
    console.log(`Found ${coverFiles.length} cover images`)

    // Assign covers to books (cycle through available covers)
    for (let i = 0; i < books.length; i++) {
      const book = books[i]
      // Skip if book already has a cover
      if (book.cover_url) {
        console.log(`Book ${book.id} "${book.title}" already has cover: ${book.cover_url}`)
        continue
      }

      // Assign a cover (cycle through available covers)
      const coverFile = coverFiles[i % coverFiles.length]
      const coverUrl = `/covers/${coverFile}`
      
      await db.updateBookCover(book.id, coverUrl)
      console.log(`Updated book ${book.id} "${book.title}" with cover: ${coverUrl}`)
    }

    console.log('Done!')
    process.exit(0)
  } catch (err) {
    console.error('Error:', err)
    process.exit(1)
  }
}

updateCovers()
