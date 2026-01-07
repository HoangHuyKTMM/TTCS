# Hướng dẫn Build App với EAS

## Bước 1: Thêm SHA-1 vào Firebase Console

**SHA-1 Debug Key của bạn:**
```
CE:41:5A:F5:3A:28:23:5A:AB:00:D7:EB:52:6B:B2:6A:90:3C:58:89
```

### Các bước thêm SHA-1:

1. Mở Firebase Console: https://console.firebase.google.com/
2. Chọn project: **newsai-793dc**
3. Click vào biểu tượng **bánh răng** → **Project Settings**
4. Chọn tab **"Your apps"**
5. Tìm app Android: `com.dinhhung1508.readerapp`
6. Cuộn xuống phần **"SHA certificate fingerprints"**
7. Click **"Add fingerprint"**
8. Paste SHA-1: `CE:41:5A:F5:3A:28:23:5A:AB:00:D7:EB:52:6B:B2:6A:90:3C:58:89`
9. Click **"Save"**
10. **Tải lại file google-services.json** mới
11. Thay thế cả 2 file:
    - `google-services.json` (thư mục root)
    - `android/app/google-services.json`

---

## Bước 2: Đăng nhập EAS

```bash
# Đăng nhập vào EAS (nếu chưa có account, tạo tại https://expo.dev/signup)
eas login

# Hoặc đăng nhập bằng web browser
eas login --web
```

---

## Bước 3: Cấu hình Project (chỉ cần làm 1 lần đầu)

```bash
# Khởi tạo EAS trong project
eas build:configure
```

---

## Bước 4: Build App

### Build APK cho Development/Testing (nhanh hơn):

```bash
# Build APK development
eas build --platform android --profile development

# Build APK preview (không có dev tools)
eas build --platform android --profile preview
```

### Build AAB cho Production (Google Play Store):

```bash
# Build Android App Bundle cho production
eas build --platform android --profile production
```

---

## Bước 5: Tải và Cài đặt

Sau khi build xong:

1. EAS sẽ hiển thị link tải file APK/AAB
2. Tải về điện thoại và cài đặt
3. Hoặc quét QR code từ terminal

**Xem tất cả builds:**
```bash
eas build:list
```

---

## Các lệnh hữu ích khác:

### Xem trạng thái build:
```bash
eas build:list
```

### Xem chi tiết 1 build:
```bash
eas build:view BUILD_ID
```

### Hủy build đang chạy:
```bash
eas build:cancel BUILD_ID
```

### Build local (không qua cloud):
```bash
# Yêu cầu cài Android Studio và SDK
eas build --platform android --local
```

---

## Lưu ý quan trọng:

1. **SHA-1 rất quan trọng** cho Firebase Auth (Google/Facebook login)
2. Mỗi keystore có SHA-1 khác nhau:
   - Debug keystore (development): `CE:41:5A:F5:3A:28:23:5A:AB:00:D7:EB:52:6B:B2:6A:90:3C:58:89`
   - Release keystore (production): Cần tạo và thêm SHA-1 khác
3. **Để lấy SHA-1** bất kỳ lúc nào:
   ```bash
   keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
   ```

---

## Troubleshooting:

### Lỗi "UNAUTHORIZED_CLIENT" khi đăng nhập Google:
- Kiểm tra SHA-1 đã thêm vào Firebase chưa
- Đảm bảo package name đúng: `com.dinhhung1508.readerapp`
- Tải lại google-services.json mới sau khi thêm SHA-1

### Build thất bại:
- Kiểm tra log: `eas build:view BUILD_ID`
- Xem credentials: `eas credentials`
- Clear cache: `npm cache clean --force`

### Quên mật khẩu EAS:
- Reset tại: https://expo.dev/forgot-password

---

## Build cho Production (Release):

Khi sẵn sàng release lên Google Play Store:

1. **Tạo release keystore** (hoặc để EAS tạo tự động)
2. **Lấy SHA-1 của release keystore**
3. **Thêm SHA-1 release vào Firebase** (giữ nguyên debug SHA-1)
4. **Build production AAB:**
   ```bash
   eas build --platform android --profile production
   ```
5. **Upload lên Google Play Console**

---

## Cấu trúc EAS.json hiện tại:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      // Sẽ build AAB mặc định cho Google Play
    }
  }
}
```

---

**Bắt đầu ngay:** Sau khi thêm SHA-1 vào Firebase, chạy:

```bash
eas login
eas build --platform android --profile preview
```
