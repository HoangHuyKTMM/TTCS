# 📚 Reader App - Ứng Dụng Đọc Truyện Việt Nam

> Ứng dụng đọc truyện di động với React Native (Expo), backend Express.js, và admin dashboard. Hỗ trợ đăng nhập mạng xã hội, đọc offline, ví coin, và chatbot AI.

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  Mobile App     │◄─────►│  Backend API     │◄─────►│  MySQL Database │
│  (Expo Router)  │       │  (Express.js)    │       │                 │
└─────────────────┘       └──────────────────┘       └─────────────────┘
                                   ▲
                                   │
                          ┌────────┴────────┐
                          │ Admin Dashboard │
                          │  (React + Vite) │
                          └─────────────────┘
```

- **Mobile**: `src/` - React Native + Expo SDK 54, Expo Router v6
- **Backend**: `admin-dashboard/server/` - Express.js, JWT auth, dual storage (MySQL/JSON)
- **Admin**: `admin-dashboard/frontend/` - React + Vite

## 🚀 Bắt Đầu Nhanh

### Bước 1: Cài đặt dependencies
```powershell
# Cài đặt tất cả: mobile + backend + admin dashboard
.\install_all.bat
```

### Bước 2: Cấu hình Backend

#### 2.1. Tạo Database MySQL
```powershell
# Tạo database
mysql -u root -p -e "CREATE DATABASE reader_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Import schema với seed data
mysql -u root -p reader_app < admin-dashboard/server/schema.sql

# Tạo admin user
cd admin-dashboard/server
node scripts/create_admin.js admin@example.com password123 "Admin Name"
```

#### 2.2. Cấu hình Backend `.env`
Tạo file `admin-dashboard/server/.env`:
```env
USE_MYSQL=true
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=reader_app

JWT_SECRET=your_random_jwt_secret_key_here
ADMIN_REG_SECRET=your_admin_registration_secret

# Grok AI API (tùy chọn - cho chatbot)
GROK_API_KEY=xai-your-api-key-here
```

**Lưu ý**: Nếu không dùng MySQL, backend tự động dùng `data.json` (xem console log "MySQL mode enabled")

### Bước 3: Chạy toàn bộ hệ thống
```powershell
.\run_all.bat

# Hoặc chạy riêng từng service:
.\run_server.bat      # Backend: http://localhost:4000
.\run_frontend.bat    # Admin: http://localhost:5173
.\run_mobile.bat      # Mobile: Expo DevTools
```

**Chức năng tự động của `.bat` scripts**:
- Kiểm tra và cài `node_modules` nếu thiếu
- Kill process trên port 4000, 5173, 8081 tránh conflict
- Khởi động service trong terminal riêng

### Kiểm thử tự động

Yêu cầu Node.js 22 trở lên. Tại thư mục gốc, cài dependencies và chạy bộ test mặc định:

```powershell
npm ci
npm ci --prefix admin-dashboard/server
npm test
```

`npm test` chạy test cho nhập chương và feed mobile, sau đó chạy hồi quy AI backend với database/provider giả lập. Bộ mặc định không cần `.env`, MySQL hoặc API key AI. Có thể chạy riêng từng phần:

```powershell
npm run test:mobile
npm run test:backend
npm run typecheck
npm ci --prefix admin-dashboard/frontend
npm --prefix admin-dashboard/frontend run build
```

GitHub Actions tự chạy test, kiểm tra TypeScript và build dashboard trên mỗi push và pull request.

Kiểm thử tích hợp backend với MySQL là tùy chọn. Cấu hình `admin-dashboard/server/.env` để kết nối MySQL có quyền tạo/xóa database tạm, rồi bật suite bằng:

```powershell
$env:AI_DB_TEST = '1'
npm --prefix admin-dashboard/server run test:db
Remove-Item Env:AI_DB_TEST
```

Suite này chỉ tạo rồi xóa database có tiền tố `reader_ai_test_`; không chạy trong `npm test` và không gọi provider AI trả phí.


---

## 🔐 Cấu Hình Xác Thực (Firebase Auth)

App hỗ trợ 3 phương thức đăng nhập: **Email/Password**, **Google**, **Facebook**

### Bước 1: Cấu hình Firebase Project

1. Truy cập [Firebase Console](https://console.firebase.google.com)
2. Tạo project mới hoặc dùng project có sẵn (project hiện tại: `newsai-793dc`)
3. Vào **Project Settings** → **General**
4. Thêm Android app:
   - Package name: `com.dinhhung1508.readerapp`
   - Tải `google-services.json`, copy vào:
     - `google-services.json` (root project)
     - `android/app/google-services.json`

### Bước 2: Bật Authentication Providers

#### Email/Password (Mặc định)
1. Vào **Authentication** → **Sign-in method**
2. Bật **Email/Password** provider

#### Google Sign-In
1. Vào **Authentication** → **Sign-in method**
2. Bật **Google** provider
3. **Web client ID** đã được cấu hình trong code:
   ```
   220903784873-rn1gdgqifur44r8am7a0h8mb0meh11v5.apps.googleusercontent.com
   ```
4. ⚠️ **Quan trọng**: Khi build APK mới, cần:
   - Lấy SHA-1 fingerprint của build
   - Thêm vào Firebase Console → Project Settings → SHA certificate fingerprints
   - Tải lại `google-services.json` mới
   - (Xem chi tiết trong `BUILD_INSTRUCTIONS.md`)

#### Facebook Login
1. Tạo app trên [Facebook Developers](https://developers.facebook.com)
2. Lấy **App ID** và **Client Token**
3. Cấu hình trong **3 nơi**:

**a) File `app.json`**:
```json
["react-native-fbsdk-next", {
  "appID": "839158852294313",
  "clientToken": "5ad9da7855d33289fec2b5c14f5304c1",
  "displayName": "Reader_app",
  "scheme": "fb839158852294313"
}]
```

**b) File `android/app/src/main/res/values/strings.xml`**:
```xml
<string name="facebook_app_id">839158852294313</string>
<string name="fb_login_protocol_scheme">fb839158852294313</string>
<string name="facebook_client_token">5ad9da7855d33289fec2b5c14f5304c1</string>
```

**c) Facebook Developer Console**:
- Thêm Android platform
- Package name: `com.dinhhung1508.readerapp`
- Class name: `com.dinhhung1508.readerapp.MainActivity`
- Key Hash (lấy bằng lệnh):
  ```powershell
  keytool -exportcert -alias androiddebugkey -keystore %USERPROFILE%\.android\debug.keystore -storepass android | openssl sha1 -binary | openssl base64
  ```

### Luồng Xác Thực

```
Firebase Auth (Google/Facebook/Email)
         ↓
   Firebase ID Token
         ↓
Backend: POST /auth/firebase
         ↓
    JWT Token (custom)
         ↓
Stored in SecureStore (native) / localStorage (web)
```

**Lưu ý quan trọng**:
- Google/Facebook login **chỉ hoạt động trong development build**, không chạy trên Expo Go
- Code dùng dynamic imports (`await import()`) để tránh crash trên web
- File `src/lib/auth.ts` xử lý cả native và web platform


---

## 📦 Build & Deploy

### Cấu hình API Base URL

Mobile app cần biết địa chỉ backend server:

**Development (máy thật)**:
- Sửa `app.json` → `extra.apiBase`: `"http://192.168.x.x:4000"` (IP máy dev)
- Hoặc sửa `eas.json` → profiles → `env.EXPO_PUBLIC_API_BASE`

**Android Emulator**: Tự động dùng `http://10.0.2.2:4000` (localhost của emulator)

### Build với EAS (Expo Application Services)

#### 1. Đăng nhập EAS
```powershell
eas login
```

#### 2. Build Development (có dev tools, debug)
```powershell
eas build --platform android --profile development
```
- Dùng cho test Google/Facebook login
- Kích thước lớn hơn (~80MB)
- Có React Dev Menu (shake device)

#### 3. Build Preview (production-like APK)
```powershell
eas build --platform android --profile preview
```
- APK thử nghiệm, không có dev tools
- Nhỏ gọn hơn development
- Dùng cho UAT

#### 4. Build Production (AAB cho Google Play)
```powershell
eas build --platform android --profile production
```
- Tạo Android App Bundle (.aab)
- Upload lên Google Play Store
- Tối ưu kích thước theo device

#### 5. Build Local (không cần EAS)
```powershell
npm run android
```
- Cần Android SDK + environment setup
- Nhanh hơn cho iteration
- Chỉ tạo development build

### ⚠️ Lưu Ý Quan Trọng Khi Build

**SHA-1 Fingerprint thay đổi**:
- Mỗi build có SHA-1 fingerprint khác nhau
- Google Sign-In sẽ **bị lỗi** nếu không update Firebase
- **Giải pháp**:
  1. Lấy SHA-1 từ build mới (xem `BUILD_INSTRUCTIONS.md`)
  2. Thêm vào Firebase Console → Project Settings → SHA certificate fingerprints
  3. Tải lại `google-services.json` mới
  4. Copy vào root + `android/app/`
  5. Rebuild app

### Xem Danh Sách Build
```powershell
eas build:list                    # Tất cả builds
eas build:view <BUILD_ID>         # Chi tiết 1 build
eas build:cancel <BUILD_ID>       # Hủy build đang chạy
```


---

## 📁 Cấu Trúc Project Chi Tiết

```
Reader_app/
├── .github/
│   ├── copilot-instructions.md    # Hướng dẫn cho AI coding agents
│   └── workflows/ci.yml           # Test, typecheck và build trên GitHub Actions
│
├── admin-dashboard/
│   ├── frontend/                  # Admin Dashboard (React + Vite)
│   │   ├── src/
│   │   │   ├── App.jsx           # Main dashboard UI
│   │   │   └── api.js            # API client cho admin
│   │   ├── login.html            # Admin login page
│   │   ├── register.html         # Admin registration
│   │   └── package.json
│   │
│   └── server/                    # Backend API (Express.js)
│       ├── index.js              # 🔥 Main server file (~3000 lines, TẤT CẢ endpoints)
│       ├── mysql.js              # MySQL connection helper
│       ├── schema.sql            # Database schema + seed data
│       ├── .env                  # ⚠️ KHÔNG commit file này
│       ├── public/               # Static file serving
│       │   ├── covers/           # Book covers (upload)
│       │   ├── banners/          # Banner images
│       │   ├── avatars/          # User avatars
│       │   └── ad-media/videos/  # Ad videos
│       ├── scripts/
│       │   ├── create_admin.js   # Tạo admin user
│       │   └── seed_db.js        # Seed sample data
│       ├── test/
│       │   ├── ai.test.js        # Hồi quy AI dùng fixture
│       │   └── ai-db.test.js     # Tích hợp MySQL (chạy riêng)
│       └── data.json             # Fallback storage (nếu không dùng MySQL)
│
├── android/                       # Android native code
│   ├── app/
│   │   ├── build.gradle          # Package name config
│   │   ├── google-services.json  # ⚠️ Firebase config (KHÔNG commit)
│   │   └── src/main/res/values/
│   │       └── strings.xml       # Facebook App ID
│   └── build.gradle
│
├── src/                           # Mobile App Source
│   ├── app/                      # 📱 Screens (Expo Router v6)
│   │   ├── _layout.tsx           # Root Stack Navigator
│   │   ├── index.tsx             # Splash/Landing
│   │   ├── home.tsx              # Main feed
│   │   ├── search.tsx            # Search books
│   │   ├── chatbot.tsx           # AI chatbot (Grok)
│   │   ├── (auth)/               # Auth screens (grouped route)
│   │   │   ├── login.tsx
│   │   │   └── register.tsx
│   │   ├── (tabs)/               # Bottom tabs (grouped route)
│   │   │   ├── explore.tsx
│   │   │   ├── library.tsx
│   │   │   ├── profile.tsx
│   │   │   ├── rank.tsx
│   │   │   └── follow.tsx
│   │   ├── book/
│   │   │   └── [id].tsx          # Book detail (dynamic route)
│   │   ├── reader/
│   │   │   └── [id].tsx          # Chapter reader
│   │   └── author/
│   │       ├── [id].tsx          # Author profile
│   │       └── create.tsx        # Create story (author only)
│   │
│   ├── components/               # Reusable components
│   │   ├── AdBanner.tsx          # Banner ads
│   │   ├── AdInterstitial.tsx   # Fullscreen ads
│   │   ├── CustomAlert.tsx      # Alert dialog
│   │   └── QRPaymentModal.tsx   # Payment QR code
│   │
│   ├── lib/                      # Core utilities
│   │   ├── api.ts               # 🔥 API client (~40 functions, all prefixed `api*`)
│   │   ├── auth.ts              # Auth logic (Firebase + JWT)
│   │   ├── firebase.ts          # Firebase web config
│   │   ├── offline.ts           # Offline reading (FileSystem + SecureStore)
│   │   ├── reading.ts           # Reading progress tracker
│   │   └── ads.ts               # Ad management
│   │
│   └── types/                    # TypeScript types (inferred from usage)
│
├── test/                          # Test tự động cho tiện ích mobile
│   ├── homeFeed.test.cjs
│   └── chapterImport.test.cjs
│
├── app.json                      # Expo config (plugins, package name, apiBase)
├── eas.json                      # EAS build profiles (dev/preview/production)
├── package.json                  # Mobile dependencies
├── tsconfig.json                 # TypeScript config
│
├── google-services.json          # ⚠️ Firebase (root copy, KHÔNG commit)
│
├── run_all.bat                   # 🚀 Chạy tất cả services
├── run_server.bat                # Chạy backend only
├── run_frontend.bat              # Chạy admin dashboard only
├── run_mobile.bat                # Chạy mobile app only
├── install_all.bat               # Cài tất cả dependencies
│
├── README.md                     # File này
└── BUILD_INSTRUCTIONS.md         # Hướng dẫn build chi tiết
```

### Routing Pattern (Expo Router v6)

```typescript
// File-based routing
src/app/
  index.tsx          → /              (splash)
  home.tsx           → /home          
  book/[id].tsx      → /book/123      (dynamic)
  reader/[id].tsx    → /reader/456    (dynamic)
  (auth)/login.tsx   → /login         (grouped, không prefix "(auth)")
  (tabs)/explore.tsx → /explore       (grouped, không prefix "(tabs)")
```

### API Endpoints (Backend)

Tất cả trong `admin-dashboard/server/index.js`:

**Auth**:
- `POST /auth/register` - Email/password registration
- `POST /auth/login` - Email/password login
- `POST /auth/firebase` - Firebase token exchange (Google/Facebook)
- `GET /me` - Get current user info

**Books**:
- `GET /books` - List books (public)
- `GET /books?mine=true` - My books (author)
- `POST /books` - Create book
- `GET /books/:id` - Book detail
- `POST /books/upload` - Upload cover (multipart)
- `POST /books/:id/comments` - Add comment
- `POST /books/:id/like` - Like book
- `POST /books/:id/follow` - Follow book
- `POST /books/:id/donate` - Donate coins to author

**Chapters**:
- `GET /books/:id/chapters` - List chapters
- `GET /books/:id/chapters/:chapterId` - Get chapter content
- `POST /books/:id/chapters` - Add chapter (author)
- `PUT /books/:bookId/chapters/:chapterId` - Update chapter
- `DELETE /books/:bookId/chapters/:chapterId` - Delete chapter

**Wallet**:
- `GET /wallet` - Get wallet balance
- `POST /wallet/topup-request` - Create topup request
- `GET /wallet/topup-requests` - List requests (admin)
- `POST /wallet/buy-vip` - Buy VIP with coins
- `POST /wallet/buy-author` - Buy author role with coins

**Admin**:
- `GET /users` - List users (admin only)
- `PUT /users/:id` - Update user
- `POST /banners` - Create banner (multipart)
- `POST /ads` - Create ad (video upload)
- `GET /genres` - List genres
- `POST /genres` - Create genre (admin)

### Storage Strategy

**Mobile App**:
```typescript
// Authentication tokens
SecureStore (native) / localStorage (web)
Key: "reader_app_token"

// Offline books
FileSystem.documentDirectory/offline/book_<id>.json
Index: SecureStore key "reader_app_offline_index_v1"

// Reading progress
SecureStore key "reader_app_reading_v1"
{
  "<bookId>": {
    "chapterId": "123",
    "position": 0.5,
    "updatedAt": "2026-01-14T..."
  }
}
```

**Backend**:
- MySQL: Production (tables: books, chapters, users, genres, comments, likes, follows, wallet, etc.)
- JSON fallback: `data.json` (nếu `USE_MYSQL=false` hoặc không set)

---

## ⚠️ Các File KHÔNG được push lên Git

Đảm bảo `.gitignore` có các dòng sau:
```
admin-dashboard/server/.env
android/app/google-services.json
*.keystore
```


---

## 🆘 Xử Lý Lỗi Thường Gặp

### 1. Port đã bị sử dụng (4000, 5173, 8081)

**Triệu chứng**: `Error: listen EADDRINUSE: address already in use :::4000`

**Giải pháp**:
```powershell
# Tìm process đang dùng port
Get-NetTCPConnection -LocalPort 4000 | Select-Object OwningProcess

# Kill process
Stop-Process -Id <PID> -Force

# Hoặc kill tất cả Node.js processes
Get-Process | Where-Object {$_.Name -eq "node"} | Stop-Process -Force
```

Script `.bat` tự động làm việc này, nhưng có thể cần quyền admin.

### 2. MySQL Connection Failed

**Triệu chứng**: Backend log `Failed to connect to MySQL` hoặc dùng `data.json`

**Kiểm tra**:
```powershell
# Test MySQL connection
mysql -u root -p -e "SHOW DATABASES;"

# Verify database exists
mysql -u root -p -e "USE reader_app; SHOW TABLES;"
```

**Giải pháp**:
- Đảm bảo MySQL đang chạy
- Check credentials trong `admin-dashboard/server/.env`
- Set `USE_MYSQL=true` trong `.env`
- Import schema nếu chưa: `mysql -u root -p reader_app < admin-dashboard/server/schema.sql`

### 3. Google Sign-In Error: "DEVELOPER_ERROR"

**Triệu chứng**: Google login trả về lỗi `DEVELOPER_ERROR` hoặc fail silently

**Nguyên nhân**: SHA-1 fingerprint không khớp với Firebase Console

**Giải pháp**:
```powershell
# 1. Lấy SHA-1 từ debug keystore
keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android

# 2. Copy SHA-1 fingerprint (dạng: CE:41:5A:F5:...)
# 3. Thêm vào Firebase Console:
#    Project Settings → Your apps → SHA certificate fingerprints → Add fingerprint
# 4. Tải lại google-services.json
# 5. Copy vào root + android/app/
# 6. Rebuild app: eas build --platform android --profile development
```

Xem chi tiết trong `BUILD_INSTRUCTIONS.md`.

### 4. "No development build installed"

**Triệu chứng**: Scan QR với Expo Go, hiện lỗi cần development build

**Nguyên nhân**: Google/Facebook login modules không chạy trên Expo Go

**Giải pháp**:
```powershell
# Build development client
eas build --platform android --profile development

# Hoặc build local (nhanh hơn)
npm run android
```

### 5. API_BASE không đúng / Cannot connect to server

**Triệu chứng**: Mobile app không fetch được data, timeout

**Kiểm tra**:
- Android Emulator: Dùng `10.0.2.2:4000` (tự động)
- Máy thật: Cần IP local của máy dev (vd: `192.168.100.32:4000`)

**Giải pháp**:
```powershell
# 1. Lấy IP máy Windows
ipconfig
# Tìm IPv4 Address của Wi-Fi/Ethernet adapter

# 2. Update app.json
"extra": {
  "apiBase": "http://192.168.100.32:4000"
}

# 3. Hoặc update eas.json
"development": {
  "env": {
    "EXPO_PUBLIC_API_BASE": "http://192.168.100.32:4000"
  }
}

# 4. Restart Metro bundler
# Ctrl+C in terminal → npm start
```

### 6. SDK Location Not Found (Build local)

**Triệu chứng**: `SDK location not found` khi chạy `npm run android`

**Giải pháp**: Tạo file `android/local.properties`:
```properties
sdk.dir=C:\\Users\\YOUR_USERNAME\\AppData\\Local\\Android\\Sdk
```

Thay `YOUR_USERNAME` bằng tên user Windows của bạn.

### 7. MySQL Character Encoding Issues (Vietnamese text)

**Triệu chứng**: Tiếng Việt lưu vào DB bị lỗi font, hiển thị "???"

**Giải pháp**: Database phải dùng `utf8mb4`:
```sql
-- Check current charset
SHOW VARIABLES LIKE 'character_set%';

-- Recreate database with correct charset
DROP DATABASE reader_app;
CREATE DATABASE reader_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Re-import schema
mysql -u root -p reader_app < admin-dashboard/server/schema.sql
```

### 8. File Upload Failed (Covers/Banners/Avatars)

**Triệu chứng**: Upload ảnh trả về 500 hoặc file không lưu

**Kiểm tra**:
```powershell
# Verify directories exist
ls admin-dashboard/server/public/covers
ls admin-dashboard/server/public/banners
ls admin-dashboard/server/public/avatars
```

**Giải pháp**: Backend tự tạo folder khi start, nhưng có thể cần quyền write:
```powershell
# Tạo folders manually nếu cần
mkdir admin-dashboard\server\public\covers
mkdir admin-dashboard\server\public\banners
mkdir admin-dashboard\server\public\avatars
mkdir admin-dashboard\server\public\ad-media\videos
```

### 9. Expo Go "Error: Couldn't start project"

**Triệu chứng**: Metro bundler không start, port 8081 bị chiếm

**Giải pháp**:
```powershell
# Kill Metro bundler
Stop-Process -Name "node" -Force

# Hoặc kill specific port
Get-NetTCPConnection -LocalPort 8081 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Clear cache và restart
npx expo start -c
```

### 10. TypeScript Errors trong IDE

**Triệu chứng**: VS Code báo lỗi type nhưng code vẫn chạy

**Giải pháp**:
```powershell
# Reinstall dependencies
rm -rf node_modules
rm package-lock.json
npm install

# Restart TypeScript server trong VS Code
# Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

---

## 🔒 Bảo Mật & Best Practices

### Files KHÔNG được commit lên Git

Đảm bảo `.gitignore` có:
```gitignore
# Environment variables
.env
admin-dashboard/server/.env

# Firebase config (chứa API keys)
google-services.json
android/app/google-services.json

# Android keystores
*.keystore
*.jks
key.properties

# Dependencies
node_modules/
admin-dashboard/server/node_modules/
admin-dashboard/frontend/node_modules/

# Build outputs
android/app/build/
android/build/
dist/

# Local config
android/local.properties
```

### Sensitive Information Checklist

**Backend `.env`**:
```env
JWT_SECRET=           # Sinh random: openssl rand -base64 32
MYSQL_PASSWORD=       # Strong password
ADMIN_REG_SECRET=     # Secret để đăng ký admin
GROK_API_KEY=         # API key cho Grok AI
```

**Firebase**:
- `google-services.json` chứa API keys → **KHÔNG commit**
- SHA-1 fingerprints → Chỉ admin Firebase có quyền xem

**Facebook**:
- App Secret → **KHÔNG** hardcode trong code
- Client Token → Có thể để trong `app.json` (ít nhạy cảm hơn)

### Production Deployment Checklist

**Backend**:
- [ ] Set `USE_MYSQL=true` và config MySQL production
- [ ] Change JWT_SECRET to random string
- [ ] Set up HTTPS (không dùng HTTP cho production)
- [ ] Enable CORS chỉ cho domains cụ thể
- [ ] Set up database backups
- [ ] Configure process manager (PM2, systemd)
- [ ] Set up logging (Winston, Morgan)

**Mobile App**:
- [ ] Update `EXPO_PUBLIC_API_BASE` trong `eas.json` production profile
- [ ] Generate production keystore (không dùng debug keystore)
- [ ] Update SHA-1 production keystore vào Firebase
- [ ] Test Google/Facebook login với production build
- [ ] Set up crash reporting (Sentry)
- [ ] Configure app signing cho Google Play

**Admin Dashboard**:
- [ ] Build production: `npm run build`
- [ ] Deploy static files lên CDN/web server
- [ ] Set up authentication cho admin routes
- [ ] Limit admin registration (chỉ với ADMIN_REG_SECRET)

---

## 🎯 Features Overview

### User Features
- ✅ **Authentication**: Email/Password, Google, Facebook login
- ✅ **Browse Books**: By genre, search, trending, new releases
- ✅ **Reading**: Chapter-by-chapter với bookmark progress
- ✅ **Offline Mode**: Download books để đọc không cần mạng
- ✅ **Social**: Comment, like, follow books and authors
- ✅ **Wallet**: Coin system cho VIP, donate tác giả
- ✅ **AI Chatbot**: Grok AI integration
- ✅ **Ads**: Banner và interstitial ads

### Author Features
- ✅ **Author Application**: Apply để trở thành tác giả
- ✅ **Create Books**: Tạo truyện mới với cover upload
- ✅ **Manage Chapters**: Add/Edit/Delete chapters
- ✅ **Receive Donations**: Nhận coin từ độc giả
- ✅ **Analytics**: View stats, likes, follows (có trong API)

### Admin Features
- ✅ **User Management**: CRUD users, assign roles
- ✅ **Content Moderation**: Approve/reject comments, books
- ✅ **Author Approval**: Review author applications
- ✅ **Wallet Management**: Approve topup requests
- ✅ **CMS**: Manage banners, ads, genres
- ✅ **Analytics**: Stats dashboard

---

## 🛠️ Tech Stack

### Mobile App
- **Framework**: React Native 0.81 + Expo SDK 54
- **Navigation**: Expo Router v6 (file-based routing)
- **UI**: React Native built-in components (no UI library)
- **State**: React Context + local state (no Redux)
- **Storage**: expo-secure-store, expo-file-system
- **Auth**: Firebase Auth + custom JWT
- **Video**: expo-av
- **Markdown**: react-native-markdown-display

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL (với fallback JSON file)
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **File Upload**: Multer
- **AI**: Grok API integration

### Admin Dashboard
- **Framework**: React 19 (no Next.js, plain React)
- **Build Tool**: Vite
- **Styling**: Plain CSS (`styles.css`)
- **API Client**: Fetch API

### DevOps
- **Build**: EAS (Expo Application Services)
- **Platform**: Android (iOS có thể thêm sau)
- **Package Manager**: npm

---

## 📚 Learning Resources

### Expo & React Native
- [Expo Docs](https://docs.expo.dev)
- [Expo Router v6](https://docs.expo.dev/router/introduction/)
- [React Native Docs](https://reactnative.dev/docs/getting-started)

### Firebase
- [Firebase Console](https://console.firebase.google.com)
- [Firebase Auth Docs](https://firebase.google.com/docs/auth)
- [React Native Firebase](https://rnfirebase.io/)

### EAS Build
- [EAS Build Docs](https://docs.expo.dev/build/introduction/)
- [EAS CLI Reference](https://docs.expo.dev/build-reference/eas-cli/)

### MySQL
- [MySQL Docs](https://dev.mysql.com/doc/)
- [Node MySQL2](https://github.com/sidorares/node-mysql2)

---

## 📞 Support & Contact

- **Developer**: Hoàng Huy
- **Email**: hoanghuy10a1gtc@gmail.com
- **Project**: TTCS - Vietnamese E-Book Reader App
- **Repository**: Private (HoangHuyKTMM/TTCS)

### Reporting Issues

1. Check xem issue đã có trong "Xử Lý Lỗi Thường Gặp" chưa
2. Check console logs (backend + mobile)
3. Include:
   - Error message đầy đủ
   - Steps to reproduce
   - Platform (Android Emulator / Real device)
   - Build type (development / preview / production)

---

## 📄 License

Private project - All rights reserved.

---

**Last Updated**: January 14, 2026  
**Version**: 1.0.0
