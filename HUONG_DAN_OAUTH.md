# 🔐 Hướng Dẫn Cấu Hình Google & Facebook Login

> **Quan trọng**: Google và Facebook login chỉ hoạt động trên **development build** hoặc **production build**, KHÔNG chạy trên Expo Go!

## 📋 Tổng Quan

App hỗ trợ 3 phương thức đăng nhập:
1. ✉️ **Email/Password** - Hoạt động ngay, không cần config thêm
2. 🔵 **Google** - Cần Firebase Console + SHA-1
3. 🔵 **Facebook** - Cần Facebook Developers + Key Hash

---

## 🔵 PHẦN 1: GOOGLE SIGN-IN

### Bước 1: Tạo Firebase Project

1. Truy cập: https://console.firebase.google.com
2. Click **"Add project"** (hoặc dùng project có sẵn)
3. Nhập tên project → Next → Next → Create project
4. Đợi khởi tạo xong → **Continue**

### Bước 2: Thêm Android App vào Firebase

1. Trong Firebase Console, click biểu tượng **Android** (⚙️ hoặc icon robot)
2. Điền thông tin:
   ```
   Android package name: com.dinhhung1508.readerapp
   App nickname (optional): Reader App
   Debug signing certificate SHA-1: [Để trống lúc này, sẽ thêm sau]
   ```
3. Click **"Register app"**
4. **Tải file `google-services.json`** 
5. **QUAN TRỌNG**: Copy file này vào 2 nơi:
   ```
   E:\TTCS\Appdoctruyen\Reader_app\google-services.json
   E:\TTCS\Appdoctruyen\Reader_app\android\app\google-services.json
   ```
6. Click **Next** → **Next** → **Continue to console**

### Bước 3: Bật Google Sign-In

1. Trong Firebase Console, vào menu bên trái → **Authentication**
2. Click tab **"Sign-in method"**
3. Tìm **Google** trong danh sách
4. Click vào **Google** → Bật **Enable**
5. Nhập email hỗ trợ (email của bạn)
6. Click **Save**

### Bước 4: Lấy SHA-1 Fingerprint

SHA-1 là "dấu vân tay" của app để Google xác minh. Có 2 loại:

#### A) SHA-1 Debug (Cho Development)

Mở **PowerShell** và chạy:

```powershell
keytool -list -v -keystore $env:USERPROFILE\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android
```

Tìm dòng **SHA-1**:
```
SHA1: CE:41:5A:F5:3A:28:23:5A:AB:00:D7:EB:52:6B:B2:6A:90:3C:58:89
```

Copy chuỗi này (có dạng XX:XX:XX:XX:...)

#### B) SHA-1 Production (Cho Release Build)

Nếu bạn có keystore riêng cho production:

```powershell
keytool -list -v -keystore path\to\your\release.keystore -alias your-alias-name
```

Nhập password khi được hỏi → Copy SHA-1

### Bước 5: Thêm SHA-1 vào Firebase

1. Trong Firebase Console → **Project Settings** (biểu tượng ⚙️)
2. Cuộn xuống → Tìm app Android (`com.dinhhung1508.readerapp`)
3. Click vào app → Cuộn xuống phần **"SHA certificate fingerprints"**
4. Click **"Add fingerprint"**
5. Paste SHA-1 vừa copy
6. Click **Save**

### Bước 6: Tải Lại google-services.json MỚI

⚠️ **QUAN TRỌNG**: Sau khi thêm SHA-1, BẮT BUỘC phải tải lại file mới!

1. Vẫn trong **Project Settings** → App Android
2. Click nút **"Download google-services.json"**
3. **Thay thế** file cũ ở 2 vị trí:
   ```
   E:\TTCS\Appdoctruyen\Reader_app\google-services.json
   E:\TTCS\Appdoctruyen\Reader_app\android\app\google-services.json
   ```

### Bước 7: Build App

Google login **KHÔNG hoạt động** trên Expo Go. Phải build:

```powershell
# Build development (recommended cho test)
eas build --platform android --profile development

# Hoặc build local (nhanh hơn)
npm run android
```

### Bước 8: Test Google Login

1. Cài đặt APK vừa build lên điện thoại/emulator
2. Mở app → Vào màn hình Login
3. Click nút **"Login with Google"**
4. Chọn tài khoản Google
5. Nếu thành công → Vào được app ✅

### ❌ Xử Lý Lỗi Google Login

**Lỗi: "DEVELOPER_ERROR"**
- **Nguyên nhân**: SHA-1 không khớp hoặc chưa tải lại `google-services.json` mới
- **Giải pháp**: 
  1. Xác nhận SHA-1 đã được thêm vào Firebase
  2. Tải lại `google-services.json` mới
  3. Rebuild app

**Lỗi: "SIGN_IN_CANCELLED"**
- **Nguyên nhân**: User tự cancel
- **Giải pháp**: Không phải lỗi, user có thể thử lại

**Lỗi: "NETWORK_ERROR"**
- **Nguyên nhân**: Không có internet
- **Giải pháp**: Kiểm tra kết nối mạng

---

## 🔵 PHẦN 2: FACEBOOK LOGIN

### Bước 1: Tạo Facebook App

1. Truy cập: https://developers.facebook.com
2. Click **"My Apps"** (góc trên bên phải)
3. Click **"Create App"**
4. Chọn loại: **"Consumer"** (cho app người dùng cuối)
5. Click **Next**
6. Điền thông tin:
   ```
   App name: Reader App
   App contact email: [Email của bạn]
   ```
7. Click **"Create App"**
8. Xác thực security check (nếu có)

### Bước 2: Lấy App ID & Client Token

1. Sau khi tạo app, vào **Dashboard**
2. Hoặc vào **Settings** → **Basic**
3. Copy 2 thông tin này:
   ```
   App ID: 839158852294313 (ví dụ)
   Client Token: 5ad9da7855d33289fec2b5c14f5304c1 (ví dụ)
   ```

### Bước 3: Thêm Platform Android

1. Vẫn trong **Settings** → **Basic**
2. Cuộn xuống → Click **"+ Add Platform"**
3. Chọn **"Android"**
4. Điền thông tin:
   ```
   Package Name: com.dinhhung1508.readerapp
   Class Name: com.dinhhung1508.readerapp.MainActivity
   ```

### Bước 4: Lấy Key Hash

Mở **PowerShell** và chạy:

```powershell
keytool -exportcert -alias androiddebugkey -keystore $env:USERPROFILE\.android\debug.keystore -storepass android | openssl sha1 -binary | openssl base64
```

⚠️ **Lưu ý**: Cần cài OpenSSL trên Windows:
- Download: https://slproweb.com/products/Win32OpenSSL.html
- Hoặc dùng Git Bash (đã có OpenSSL sẵn)

Kết quả sẽ ra dạng:
```
X7oKfkSxPXFIvH5zH6F6vMj3Cxg=
```

Copy chuỗi này.

### Bước 5: Thêm Key Hash vào Facebook

1. Vẫn trong **Settings** → **Basic** → Platform **Android**
2. Tìm trường **"Key Hashes"**
3. Paste key hash vừa copy
4. Click **"Save Changes"** (nút dưới cùng trang)

### Bước 6: Bật Facebook Login

1. Trong menu bên trái, tìm **"Products"** (hoặc **"Add Product"**)
2. Tìm **"Facebook Login"** → Click **"Set Up"**
3. Chọn platform **"Android"**
4. Skip các bước hướng dẫn (đã config rồi)
5. Vào **Facebook Login** → **Settings**
6. Bật **"Client OAuth Login"** và **"Embedded Browser OAuth Login"**
7. Thêm vào **Valid OAuth Redirect URIs**:
   ```
   fb839158852294313://authorize/
   ```
   (Thay `839158852294313` bằng App ID của bạn)
8. Click **"Save Changes"**

### Bước 7: Cập Nhật Code

#### File 1: `app.json`

Mở file `E:\TTCS\Appdoctruyen\Reader_app\app.json`, tìm phần `plugins`:

```json
"plugins": [
  "expo-router",
  "expo-font",
  "@react-native-firebase/app",
  "@react-native-firebase/auth",
  "@react-native-google-signin/google-signin",
  [
    "react-native-fbsdk-next",
    {
      "appID": "839158852294313",           // ← Thay bằng App ID của bạn
      "clientToken": "5ad9da7855d33289fec2b5c14f5304c1",  // ← Thay bằng Client Token
      "displayName": "Reader_app",
      "scheme": "fb839158852294313"         // ← fb + App ID của bạn
    }
  ]
]
```

#### File 2: `android/app/src/main/res/values/strings.xml`

Mở file này (hoặc tạo nếu chưa có):

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Reader_app</string>
    
    <!-- Facebook Configuration -->
    <string name="facebook_app_id">839158852294313</string>
    <string name="fb_login_protocol_scheme">fb839158852294313</string>
    <string name="facebook_client_token">5ad9da7855d33289fec2b5c14f5304c1</string>
</resources>
```

Thay các giá trị bằng App ID và Client Token của bạn.

### Bước 8: Chuyển App Mode từ Development sang Live

⚠️ **QUAN TRỌNG**: App Facebook mặc định ở chế độ Development (chỉ admin/tester dùng được)

1. Trong Facebook App Dashboard, góc trên → Tìm toggle **"App Mode"**
2. Nếu đang **"In development"** → Click toggle để chuyển sang **"Live"**
3. Xác nhận các bước (có thể cần điền thêm thông tin)
4. Sau khi Live → Mọi người đều dùng được Facebook login

### Bước 9: Build & Test

```powershell
# Build lại app (vì đã sửa app.json và strings.xml)
eas build --platform android --profile development

# Hoặc
npm run android
```

Test:
1. Mở app → Login screen
2. Click **"Login with Facebook"**
3. Đăng nhập bằng tài khoản Facebook
4. Cho phép quyền → Vào được app ✅

### ❌ Xử Lý Lỗi Facebook Login

**Lỗi: "App Not Setup: This app is still in development mode"**
- **Nguyên nhân**: App chưa chuyển sang Live mode hoặc tài khoản test chưa được thêm
- **Giải pháp**: 
  - Chuyển app sang Live mode (Bước 8)
  - Hoặc thêm tài khoản vào **Roles** → **Test Users**

**Lỗi: "Invalid key hash"**
- **Nguyên nhân**: Key hash không đúng
- **Giải pháp**: 
  1. Lấy lại key hash (Bước 4)
  2. Đảm bảo dùng đúng keystore (debug/release)
  3. Thêm vào Facebook Developer Console

**Lỗi: "Can't Load URL"**
- **Nguyên nhân**: Cấu hình OAuth Redirect URI sai
- **Giải pháp**: Kiểm tra lại Bước 6, đảm bảo có `fb[APP_ID]://authorize/`

---

## 🔄 Luồng Hoạt Động

```
1. User click "Login with Google/Facebook"
   ↓
2. Firebase Auth xử lý OAuth flow
   ↓
3. Firebase trả về ID Token
   ↓
4. App gửi ID Token đến Backend API
   POST /auth/firebase
   Body: { firebase_token: "eyJhbG...", auth_method: "google" }
   ↓
5. Backend verify token với Firebase
   ↓
6. Backend tạo/tìm user trong database
   ↓
7. Backend tạo JWT token riêng
   ↓
8. App lưu JWT vào SecureStore
   ↓
9. User đã login ✅
```

---

## 📱 Build Checklist

Trước khi test OAuth login, đảm bảo:

- ✅ `google-services.json` đã copy vào 2 vị trí (root + android/app/)
- ✅ SHA-1 debug đã thêm vào Firebase Console
- ✅ Facebook App ID & Client Token đã update trong `app.json` và `strings.xml`
- ✅ Facebook Key Hash đã thêm vào Facebook Developer Console
- ✅ Facebook App đã chuyển sang **Live mode** (nếu muốn public)
- ✅ Build development hoặc production (KHÔNG dùng Expo Go)
- ✅ Backend server đang chạy (port 4000)

---

## 🆘 Debugging Tips

### Xem Log Firebase

Mở **Android Studio** → **Logcat** → Filter: `firebase`

### Xem Log App

```powershell
# Trong terminal khi chạy app
# Log sẽ hiện trong Metro bundler
```

### Test Backend API

```powershell
# Test endpoint Firebase
curl -X POST http://localhost:4000/auth/firebase `
  -H "Content-Type: application/json" `
  -d '{"firebase_token":"test_token","auth_method":"google"}'
```

### Verify google-services.json

Mở file và kiểm tra:
```json
{
  "project_info": {
    "project_id": "newsai-793dc"  // Phải đúng project
  },
  "client": [
    {
      "client_info": {
        "android_client_info": {
          "package_name": "com.dinhhung1508.readerapp"  // Phải đúng package
        }
      }
    }
  ]
}
```

---

## 📝 Tổng Kết

### Google Login Cần:
1. ✅ Firebase Project
2. ✅ Android App đã đăng ký trong Firebase
3. ✅ SHA-1 fingerprint đã thêm
4. ✅ `google-services.json` đã tải về và copy đúng chỗ
5. ✅ Development/Production build (không phải Expo Go)

### Facebook Login Cần:
1. ✅ Facebook App đã tạo
2. ✅ App ID & Client Token
3. ✅ Platform Android đã thêm
4. ✅ Key Hash đã thêm
5. ✅ `app.json` và `strings.xml` đã update
6. ✅ App mode = Live (nếu muốn public)
7. ✅ Development/Production build

### Sau Khi Hoàn Thành:
- User có thể login bằng Email/Password, Google, hoặc Facebook
- Thông tin user được lưu trong database MySQL
- JWT token được dùng cho các API call tiếp theo
- App hoạt động offline sau khi login (có SecureStore)

---

## 📞 Cần Hỗ Trợ?

Nếu gặp lỗi không có trong hướng dẫn:

1. Check log trong Metro bundler
2. Check log trong Android Studio Logcat
3. Check backend console (terminal chạy `node index.js`)
4. Đọc lại từng bước trong hướng dẫn này
5. Google error message cụ thể: "react native firebase [lỗi]"

---

**Chúc bạn cấu hình thành công! 🎉**
