-- Migration: Add Firebase Auth columns to users table
-- Run this script on your MySQL database: mysql -u hung -p app_doc_truyen < add_firebase_columns.sql

-- Add firebase_uid column (stores Firebase user ID)
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128) NULL AFTER password_hash;

-- Add auth_method column (stores: 'email', 'google', 'facebook', 'apple')
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_method VARCHAR(20) DEFAULT 'email' AFTER firebase_uid;

-- Create index for faster lookup by firebase_uid
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);

-- If your MySQL doesn't support IF NOT EXISTS for ALTER TABLE, use these instead:
-- ALTER TABLE users ADD COLUMN firebase_uid VARCHAR(128) NULL;
-- ALTER TABLE users ADD COLUMN auth_method VARCHAR(20) DEFAULT 'email';
