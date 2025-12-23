// Direct MySQL update script
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function updateCovers() {
  let connection;
  try {
    // Direct connection without .env
    connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: '123456',
      database: 'app_doc_truyen'
    });
    
    console.log('Connected to MySQL');
    
    // Check table structure first
    const [columns] = await connection.query("SHOW COLUMNS FROM stories");
    console.log('Table columns:', columns.map(c => c.Field).join(', '));
    
    // Get all books
    const [books] = await connection.query('SELECT story_id, title, cover_image FROM stories');
    console.log(`Found ${books.length} books`);
    
    // Get all cover files
    const coversDir = path.join(__dirname, 'public', 'covers');
    const coverFiles = fs.readdirSync(coversDir).filter(f => 
      f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg')
    );
    console.log(`Found ${coverFiles.length} cover images`);
    
    // Update each book
    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      
      // Skip if has cover
      if (book.cover_image) {
        console.log(`Book ${book.story_id} "${book.title}" already has cover`);
        continue;
      }
      
      // Assign cover
      const coverFile = coverFiles[i % coverFiles.length];
      const coverUrl = `/covers/${coverFile}`;
      
      await connection.query('UPDATE stories SET cover_image = ? WHERE story_id = ?', [coverUrl, book.story_id]);
      console.log(`Updated book ${book.story_id} "${book.title}" -> ${coverUrl}`);
    }
    
    console.log('Done!');
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (connection) {
      await connection.end();
    }
    process.exit(0);
  }
}

updateCovers();
