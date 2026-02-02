# Daily Chapter Unlocking Feature

## Tổng quan

Thay đổi logic giới hạn chương từ **cố định** sang **progressive theo ngày**:

### Trước đây:
- **Guest**: Chỉ đọc được 3 chương đầu (cố định)
- **User thường**: Chỉ đọc được 10 chương đầu (cố định)
- **VIP/Author/Admin**: Không giới hạn

### Bây giờ:
- **Guest**: Mỗi ngày mở thêm **3 chương** mới
  - Ngày 1: Đọc được đến chương 3
  - Ngày 2: Đọc được đến chương 6
  - Ngày 3: Đọc được đến chương 9
  - ...

- **User thường**: Mỗi ngày mở thêm **10 chương** mới
  - Ngày 1: Đọc được đến chương 10
  - Ngày 2: Đọc được đến chương 20
  - Ngày 3: Đọc được đến chương 30
  - ...

- **VIP/Author/Admin**: Vẫn không giới hạn

## Cách hoạt động

### 1. Database Schema

Tạo bảng `reading_starts` để tracking thời điểm bắt đầu đọc truyện:

```sql
CREATE TABLE reading_starts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,     -- user_id hoặc IP (cho guest)
  story_id BIGINT UNSIGNED NOT NULL,
  started_at DATE NOT NULL,          -- Ngày bắt đầu đọc truyện này
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (user_id, story_id)
)
```

### 2. Thuật toán

```javascript
// 1. Lấy hoặc tạo ngày bắt đầu đọc
SELECT started_at FROM reading_starts 
WHERE user_id = ? AND story_id = ?

// 2. Nếu chưa có, tạo mới với ngày hôm nay
INSERT INTO reading_starts (user_id, story_id, started_at) 
VALUES (?, ?, CURDATE())

// 3. Tính số ngày đã đọc
daysSinceStart = floor((today - started_at) / (24 * 60 * 60 * 1000))

// 4. Tính số chương được phép
allowedChapters = (daysSinceStart + 1) * chaptersPerDay

// 5. Kiểm tra giới hạn
if (effectiveChapterNo > allowedChapters) {
  return 403 "Daily limit reached"
}
```

### 3. Backend Changes

**File**: `admin-dashboard/server/index.js`

#### Guest Logic:
```javascript
const chaptersPerDay = 3
const daysSinceStart = Math.floor((today - startDate) / (1000 * 60 * 60 * 24))
const allowedChapters = (daysSinceStart + 1) * chaptersPerDay

if (effectiveChapterNo > allowedChapters) {
  return res.status(403).json({ 
    error: 'daily_limit_reached', 
    message: `Khách được đọc ${chaptersPerDay} chương mới mỗi ngày. Hôm nay bạn có thể đọc đến chương ${allowedChapters}.`,
    allowed_chapters: allowedChapters,
    days_reading: daysSinceStart + 1
  })
}
```

#### User Logic:
```javascript
const chaptersPerDay = 10
// Same calculation as guest but with 10 chapters/day
```

## Migration

### Chạy migration:

```bash
# Option 1: Via MySQL CLI
mysql -u root -p reader_app < admin-dashboard/server/migrations/run_migration.sql

# Option 2: Tự động khi start server
# Server sẽ tự tạo bảng nếu chưa có
npm run start
```

### Verify:

```sql
-- Check table exists
SHOW TABLES LIKE 'reading_starts';

-- Check structure
DESC reading_starts;

-- Test data
SELECT * FROM reading_starts LIMIT 10;
```

## Testing

### Test Guest (3 chapters/day):

```bash
# Ngày 1 - Đọc chapter 1-3: OK
curl -X GET http://localhost:4000/books/1/chapters/1

# Ngày 1 - Đọc chapter 4: 403 Forbidden
curl -X GET http://localhost:4000/books/1/chapters/4

# Simulate ngày 2 (thủ công update DB):
UPDATE reading_starts SET started_at = DATE_SUB(CURDATE(), INTERVAL 1 DAY) 
WHERE story_id = 1;

# Ngày 2 - Đọc chapter 6: OK (allowed = 6)
curl -X GET http://localhost:4000/books/1/chapters/6

# Ngày 2 - Đọc chapter 7: 403 Forbidden
curl -X GET http://localhost:4000/books/1/chapters/7
```

### Test User (10 chapters/day):

```bash
# Login first
TOKEN="your_jwt_token"

# Ngày 1 - Đọc chapter 10: OK
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/books/1/chapters/10

# Ngày 1 - Đọc chapter 11: 403 Forbidden
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/books/1/chapters/11
```

## Frontend Changes

Không cần thay đổi frontend. Response từ backend đã có thông tin:

```json
{
  "error": "daily_limit_reached",
  "message": "Khách được đọc 3 chương mới mỗi ngày. Hôm nay bạn có thể đọc đến chương 6.",
  "allowed_chapters": 6,
  "current_chapter": 7,
  "chapters_per_day": 3,
  "days_reading": 2
}
```

Frontend có thể hiển thị:
- `allowed_chapters`: Số chương hiện được phép
- `days_reading`: Số ngày đã đọc
- `chapters_per_day`: Tốc độ unlock

## Benefits

1. **Tăng engagement**: User quay lại hàng ngày để đọc thêm chương
2. **Fair distribution**: Không bị giới hạn cứng, có thể đọc thêm theo thời gian
3. **Monetization**: Tăng động lực upgrade VIP để đọc không giới hạn
4. **Analytics**: Track được user retention qua `reading_starts` table

## Configuration

Có thể điều chỉnh tốc độ unlock trong code:

```javascript
// admin-dashboard/server/index.js

// Guest - line ~2810
const chaptersPerDay = 3  // Change to 5, 10, etc.

// User - line ~2870
const chaptersPerDay = 10 // Change to 15, 20, etc.
```

## Rollback

Nếu cần quay lại logic cũ:

```bash
# Restore from git
git checkout HEAD -- admin-dashboard/server/index.js

# Drop table
mysql -u root -p -e "DROP TABLE reader_app.reading_starts"
```
