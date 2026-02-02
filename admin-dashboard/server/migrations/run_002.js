// Run migration: Add free_chapters column to books table
const mysql = require('mysql2/promise');
require('dotenv').config();

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'reader_app',
  });

  try {
    console.log('Adding free_chapters column...');
    
    // Add column if not exists
    await connection.query(`
      ALTER TABLE books 
      ADD COLUMN IF NOT EXISTS free_chapters INT NOT NULL DEFAULT 3 
      COMMENT 'Number of free chapters for non-VIP users'
    `);
    
    // Update existing books
    await connection.query(`
      UPDATE books SET free_chapters = 3 
      WHERE free_chapters IS NULL OR free_chapters = 0
    `);
    
    console.log('✅ Migration completed successfully!');
    console.log('All books now have free_chapters = 3 (first 3 chapters free)');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
  } finally {
    await connection.end();
  }
}

runMigration();
