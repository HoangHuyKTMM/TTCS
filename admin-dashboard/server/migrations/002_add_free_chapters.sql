-- Add free_chapters column to books table
-- This defines how many chapters are free for regular users (non-VIP)
-- Default: 3 chapters

ALTER TABLE books 
ADD COLUMN IF NOT EXISTS free_chapters INT NOT NULL DEFAULT 3 
COMMENT 'Number of free chapters for non-VIP users';

-- Update existing books to have default 3 free chapters if needed
UPDATE books SET free_chapters = 3 WHERE free_chapters IS NULL OR free_chapters = 0;
