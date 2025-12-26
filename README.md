# 📚 Reader App - Hướng Dẫn Cài Đặt

## 🚀 Bắt Đầu Nhanh

### Bước 1: Cài đặt thư viện
```bash
# Chạy file này để cài đặt tất cả
.\install_all.bat
```

### Bước 2: Cấu hình môi trường

#### 2.1. Tạo file `.env` cho Backend Server
Tạo file `admin-dashboard/server/.env` với nội dung:
```env
USE_MYSQL=true
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=reader_app

JWT_SECRET=your_jwt_secret_key_here

# Grok AI API (tùy chọn - cho chatbot AI)
GROK_API_KEY=xai-your-api-key-here
```

### Bước 3: Chạy ứng dụng
```bash
.\run_all.bat
```

---

## 🔐 Cấu Hình Đăng Nhập Mạng Xã Hội

### A. Google Sign-In

#### 1. Tạo Project trên Firebase Console
1. Truy cập https://console.firebase.google.com
2. Tạo project mới hoặc sử dụng project có sẵn
3. Vào **Project Settings** → **General**
4. Thêm Android app với package name: `com.dinhhung1508.readerapp`
5. Tải file `google-services.json` và đặt vào:
   - `android/app/google-services.json`

#### 2. Bật Google Sign-In trong Firebase
1. Vào **Authentication** → **Sign-in method**
2. Bật **Google** provider
3. Copy **Web client ID** (dạng: `xxxx.apps.googleusercontent.com`)

#### 3. Cập nhật Web Client ID
Mở file `src/lib/auth.ts`, tìm và thay thế:
```typescript
GoogleSignin.configure({
  webClientId: 'YOUR_WEB_CLIENT_ID_HERE.apps.googleusercontent.com',
  offlineAccess: true,
})
```

---

### B. Facebook Login

#### 1. Tạo App trên Facebook Developers
1. Truy cập https://developers.facebook.com
2. Tạo App mới (chọn loại "Consumer")
3. Vào **Settings** → **Basic**:
   - Copy **App ID** (ví dụ: `839158852294313`)
   - Copy **Client Token** (ví dụ: `5ad9da7855d33289fec2b5c14f5304c1`)

#### 2. Cấu hình Android
1. Vào **Settings** → **Basic** → thêm platform **Android**
2. Nhập:
   - Package Name: `com.dinhhung1508.readerapp`
   - Class Name: `com.dinhhung1508.readerapp.MainActivity`
   - Key Hashes: (chạy lệnh bên dưới để lấy)

**Lấy Key Hash (Windows):**
```bash
keytool -exportcert -alias androiddebugkey -keystore %USERPROFILE%\.android\debug.keystore -storepass android | openssl sha1 -binary | openssl base64
```

#### 3. Cập nhật thông tin Facebook trong code

**File: `app.json`** - Tìm phần `react-native-fbsdk-next`:
```json
["react-native-fbsdk-next", {
  "appID": "YOUR_FACEBOOK_APP_ID",
  "clientToken": "YOUR_FACEBOOK_CLIENT_TOKEN",
  "displayName": "Reader_app",
  "scheme": "fbYOUR_FACEBOOK_APP_ID"
}]
```

**File: `android/app/src/main/res/values/strings.xml`:**
```xml
<string name="facebook_app_id">YOUR_FACEBOOK_APP_ID</string>
<string name="fb_login_protocol_scheme">fbYOUR_FACEBOOK_APP_ID</string>
<string name="facebook_client_token">YOUR_FACEBOOK_CLIENT_TOKEN</string>
```

---

## 📱 Build App

### Development Build (cần cho Google/Facebook Login)
```bash
# Build trên cloud (khuyến nghị)
eas build --platform android --profile development

# Hoặc build local (cần Android SDK)
npx expo run:android
```

### Production Build
```bash
eas build --platform android --profile production
```

---

## 📁 Cấu Trúc Project

```
TTCS/
├── admin-dashboard/
│   ├── frontend/          # Admin web dashboard
│   └── server/            # Backend API (Node.js + MySQL)
│       └── .env           # ⚠️ Cần tạo file này
├── android/               # Android native code
│   └── app/
│       ├── google-services.json  # ⚠️ Cần thay bằng file của bạn
│       └── src/main/res/values/strings.xml  # Facebook config
├── src/
│   ├── app/               # Màn hình ứng dụng
│   └── lib/
│       ├── auth.ts        # Google/Facebook login logic
│       └── api.ts         # API calls
├── app.json               # Expo config (Facebook plugin)
├── run_all.bat            # Chạy tất cả dịch vụ
└── README.md              # File này
```

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

### Lỗi: "Port 4000 is already in use"
```bash
# Windows
Get-NetTCPConnection -LocalPort 4000 | Select OwningProcess
Stop-Process -Id <PID> -Force
```

### Lỗi: "SDK location not found"
Tạo file `android/local.properties`:
```
sdk.dir=C:/Users/YOUR_USERNAME/AppData/Local/Android/Sdk
```

### Lỗi: "Facebook Login cần development build"
Facebook/Google Login không chạy được trên Expo Go. Cần build development build:
```bash
eas build --platform android --profile development
```

---

## 📞 Liên Hệ

- **Developer**: Đinh Hưng
- **Email**: dinhhung1508@gmail.com
- **Project**: TTCS - Ứng dụng đọc truyện
