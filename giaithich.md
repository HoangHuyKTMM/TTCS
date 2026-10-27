# Giải thích code Reader App

Tài liệu này đọc code đang có trong repo và giải thích từng luồng đi qua file nào. Đây là bản hướng dẫn đọc mã, không phải báo cáo hội đồng.

Reader App 1.0.0 là hệ đọc truyện chữ tiếng Việt. Ba tiến trình cùng chạy lúc phát triển:

| Tiến trình | Thư mục | Lệnh | Cổng |
|---|---|---|---|
| App Android | gốc repo, `src/` | `npx expo start --dev-client --port 8081` | Metro 8081 |
| API | `admin-dashboard/server` | `node index.js` | 4000 |
| Dashboard web | `admin-dashboard/frontend` | `npm run dev` | 5173 |

Cơ sở dữ liệu là MySQL `app_doc_truyen`. API bật MySQL khi `USE_MYSQL=true` trong `admin-dashboard/server/.env`. App và dashboard không giữ catalog riêng. Cả hai gọi API, API đọc và ghi MySQL.

Điểm vào app là `package.json` trường `main`: `expo-router/entry`. Màn hình nằm trong `src/app`.

---

## 1. Bản đồ file

### App di động

| File | Việc nó làm |
|---|---|
| `src/app/index.tsx` | Splash 5 giây, rồi vào `/home` |
| `src/app/home.tsx` | Màn chào: Đăng nhập, Tạo tài khoản, hoặc Khám phá không cần đăng nhập. Có token thì nhảy thẳng vào tab Khám phá |
| `src/app/_layout.tsx` | Khung gốc: theme, bàn phím, stack điều hướng, mở chương khi bấm thông báo chương mới |
| `src/app/(tabs)/_layout.tsx` | Năm tab: Khám phá, Theo dõi, Thư viện, Xếp hạng, Tài khoản |
| `src/app/(tabs)/explore.tsx` | Re-export `src/app/explore.tsx` |
| `src/app/explore.tsx` | Trang chủ catalog: banner, 5 truyện mới cập nhật, thể loại |
| `src/app/search.tsx` | Tìm truyện, tác giả, lọc thể loại |
| `src/app/book/[id].tsx` | Chi tiết truyện: giới thiệu, mục lục, bình luận, đọc tiếp, tải offline, tặng quà |
| `src/app/reader/[id].tsx` | Màn đọc chương, cuộn dọc, chương trước/sau, ưu tiên file offline |
| `src/app/chatbot.tsx` | Trợ lý đọc ở ngoài sách |
| `src/components/ReaderAgentSheet.tsx` | Tấm trợ lý trượt lên từ màn đọc |
| `src/app/(auth)/login.tsx`, `register.tsx` | Form đăng nhập và đăng ký |
| `src/app/(tabs)/library.tsx` | Đang đọc, Đã thích, Đã tải |
| `src/app/(tabs)/follow.tsx` | Bảng tin tác giả đang theo dõi |
| `src/app/(tabs)/rank.tsx` | Xếp hạng theo lượt xem chương và lượt thích |
| `src/app/(tabs)/profile.tsx`, `src/app/profile.tsx`, `src/app/account.tsx` | Tài khoản, ví, VIP, tác giả |
| `src/app/author/create.tsx`, `manage.tsx`, `[id].tsx` | Tác giả tạo truyện, sửa truyện, trang tác giả |
| `src/app/notifications.tsx` | Danh sách thông báo trong app |
| `src/lib/api.ts` | Mọi lời gọi HTTP tới API cổng 4000 |
| `src/lib/auth.ts` | JWT, Google, Facebook, đăng xuất |
| `src/lib/reading.ts`, `readingProgress.js` | Bookmark “Đọc tiếp” trên máy và trên server |
| `src/lib/offline.ts` | Tải chương thành file JSON |
| `src/lib/homeFeed.ts` | Chọn 5 truyện “mới cập nhật” |
| `src/lib/ads.ts` | Ai được thấy video quảng cáo |
| `src/lib/pushNotifications.ts` | Đăng ký token FCM |
| `src/components/AppTheme.tsx`, `src/theme.ts` | Cỡ chữ, giãn dòng, nền đêm |
| `src/components/KeyboardSafe.tsx` | Đẩy form lên khi bàn phím Android che ô nhập |
| `src/components/AdInterstitial.tsx` | Video toàn màn hình |
| `src/components/QRPaymentModal.tsx` | QR nạp xu |
| `src/components/AuthorGiftCard.tsx`, `giftVisuals.tsx`, `giftMotion.tsx` | Tặng quà và hiệu ứng |
| `src/components/StoryFlashcards.tsx` | Thẻ gợi ý truyện trong chat |
| `src/components/ChapterImportModal.tsx`, `src/lib/chapterImport.ts`, `src/lib/docxText.ts` | Nhập chương từ txt/docx |

### API

| File | Việc nó làm |
|---|---|
| `admin-dashboard/server/index.js` | Express: route, JWT, paywall, ví, SePay, gắn AI |
| `admin-dashboard/server/mysql.js` | Mọi câu SQL: truyện, chương, ví, tiến độ, thống kê |
| `admin-dashboard/server/schema.sql` | Định nghĩa bảng |
| `admin-dashboard/server/migrate.js` | Thêm cột và bảng khi khởi động, chạy lại được |
| `admin-dashboard/server/chat_agent.js` | Tóm tắt và gợi ý |
| `admin-dashboard/server/integrity.js` | Chấm bình luận và đối chiếu chương |
| `admin-dashboard/server/ai_runtime.js` | Timeout 25 giây, hạn mức, chọn khóa API |
| `admin-dashboard/server/ai_store.js` | Cache tóm tắt, job kiểm duyệt, hội thoại, vân tay chương |
| `admin-dashboard/server/recommendation_cache.js` | Gộp và giới hạn số lệnh gợi ý đang chạy |
| `admin-dashboard/server/gifts.js` | Bảng giá quà |
| `admin-dashboard/server/firebase_auth.js` | Kiểm token Firebase rồi cấp JWT của app |
| `admin-dashboard/server/push.js` | Gửi FCM khi có chương mới |
| `admin-dashboard/server/langfuse.js`, `langfuse_read.js`, `langfuse_routes.js` | Gửi trace khi có đủ hai khóa Langfuse |

### Dashboard

| File | Việc nó làm |
|---|---|
| `admin-dashboard/frontend/src/App.jsx` | Sidebar theo hash: tổng quan, sách, chương, thể loại, banner, quảng cáo, người dùng, giao dịch, bình luận |
| `admin-dashboard/frontend/src/api.js` | Gọi API cổng 4000, token `admin_token` |
| `admin-dashboard/frontend/src/ModerationPanel.jsx` | Hàng chờ kiểm duyệt, Diff hai cột, Cho xuất bản / Khóa |
| `admin-dashboard/frontend/src/LangfusePanel.jsx` | Khung trace nếu có khóa |
| `admin-dashboard/frontend/login.html` | Đăng nhập admin |

---

## 2. Luồng mở app

```
index.tsx  --5 giây-->  home.tsx
                              |
              đã có token ----+----> (tabs)/explore
              chưa có token --+----> nút Đăng nhập / Đăng ký / Khám phá
```

1. `src/app/index.tsx` hiện `src/assets/splash.png` trong 5 giây, rồi `router.replace('/home')`.
2. `src/app/home.tsx` gọi `Auth.getToken()`. Có JWT thì `replace` sang `/(tabs)/explore`. Không có thì hiện ba nút.
3. `src/app/_layout.tsx` bọc toàn app bằng `AppThemeProvider` và `KeyboardPush`. Trên Android, nếu thông báo FCM có `type = new_chapter` thì đẩy sang `/reader/[id]` với `id` và `ch`.
4. Tab mặc định trong `src/app/(tabs)/_layout.tsx` là `explore`, nhãn Khám phá.

Theme không dùng Redux. `src/components/AppTheme.tsx` giữ cỡ chữ mặc định 18 (kẹp 14–28) và giãn dòng 1.6, 1.75 hoặc 2. Đổi theme không reset theo từng chương.

---

## 3. Luồng app gọi API

Mọi request đi qua `request()` trong `src/lib/api.ts`.

Thứ tự địa chỉ trên Android:

1. `http://192.168.1.241:4000` (máy dev trên Wi-Fi)
2. `http://127.0.0.1:4000` (chỉ tới được API nếu đã `adb reverse` đúng máy)
3. `EXPO_PUBLIC_API_BASE` và `app.json` → `extra.apiBase`
4. `http://10.0.2.2:4000` (chỉ emulator Android)
5. `http://localhost:4000`

Hàm thử lần lượt. Base nào trả lời được thì các lần sau dùng base đó. Header đăng nhập là `Authorization: Bearer <JWT>`. JWT nằm ở SecureStore khóa `reader_app_token` (`src/lib/auth.ts`). Trên web, cùng khóa đó nằm trong `localStorage`.

`EXPO_PUBLIC_*` được gắn vào bundle lúc Metro biến đổi file. Đổi `.env` thì phải khởi động lại Metro. Sửa hằng trong `api.ts` thì reload là đủ.

---

## 4. Luồng đăng ký, đăng nhập, đăng xuất

### Email

1. `src/app/(auth)/register.tsx` gọi `Auth.register` → `apiRegister` → `POST /auth/register`.
2. `admin-dashboard/server/index.js` tạo user, mật khẩu băm bằng bcrypt. Route này không trả JWT.
3. `login.tsx` gọi `POST /auth/login`. Server trả JWT hạn 30 ngày.
4. `src/lib/auth.ts` ghi token, user, và phương thức đăng nhập vào SecureStore, rồi gọi `hydrateReadingProgress()`.

### Google và Facebook

1. App native lấy credential Google hoặc Facebook (`src/lib/auth.ts`). Expo Go không có module này. Cần bản dev client.
2. Firebase xác thực trên máy.
3. App gửi ID token lên `POST /auth/firebase`.
4. `admin-dashboard/server/firebase_auth.js` kiểm token. Server cấp JWT riêng của app, không dùng token Firebase làm phiên đọc truyện.

### Đăng xuất

`Auth.logout` trong `src/lib/auth.ts`:

1. Trên Android, gỡ token FCM bằng `DELETE /push/device`.
2. Sign out Google và Firebase.
3. Xóa `reader_app_token`, user, và khóa phương thức đăng nhập.

Tiến độ đọc theo user (`reader_app_reading:u:{id}`) vẫn nằm trên máy. File offline của user đó cũng còn, cho đến khi người dùng xóa trong Thư viện.

### Bốn role

`user`, `vip`, `author`, `admin`. Role nằm trên bảng `users`. Mỗi request chương, server đọc lại role từ MySQL để VIP vừa mua có hiệu lực ngay, không cần đăng nhập lại. Đoạn này nằm trong `GET /books/:bookId/chapters/:chapterId` của `index.js`.

---

## 5. Luồng khám phá, tìm kiếm, chi tiết truyện

### Khám phá

`src/app/explore.tsx`:

1. `apiFetchBooks` với `limit 50`, `sort=recent` → `GET /books`.
2. `pickHomeRecommendations` trong `src/lib/homeFeed.ts` chọn 5 truyện. Làm mới thì `previousUpdated` buộc một bộ khác.
3. Màn hình chỉ vẽ `books.slice(0, 5)`. “Tìm thêm” đẩy sang `/search`.
4. Banner là `GET /banners`, tách khỏi video quảng cáo. Banner không lọc VIP.
5. Mỗi phiên, Khám phá có thể phát một video placement `home` qua `AdInterstitial`.

### Tìm kiếm

`src/app/search.tsx` gọi `GET /books/search`. Route này tìm `LIKE`. Đây không phải FULLTEXT của trợ lý AI. FULLTEXT chỉ nằm trong `search_stories` của `chat_agent.js`, trên cột `stories.title` và `stories.description`.

### Chi tiết

`src/app/book/[id].tsx` gọi `GET /books/:id` và `GET /books/:id/chapters`.

Màn này ghép: giới thiệu, danh sách chương, bình luận (`GET/POST /books/:id/comments`), nút đọc tiếp, nút tải offline, và `AuthorGiftCard`.

Nếu API trả lỗi khi tải sách, màn này gán `defaultBook`. Đó là sách giả để không vỡ layout. Chương thật không đi theo đường đó.

### Xếp hạng

`src/app/(tabs)/rank.tsx` và khối “Top truyện” của dashboard cùng đọc số từ API.

`getStats` trong `mysql.js` đếm `COUNT(*)` của `chapter_views` và `likes`. Truyện ẩn và truyện có cả hai số bằng 0 bị bỏ. Cột `stories.views` là số nhập cũ khi crawl, không phải số trên bảng xếp hạng.

---

## 6. Luồng đọc một chương

```
reader/[id].tsx
    |
    +-- getOfflineChapter() có chữ --> vẽ file local, dừng
    |
    +-- apiFetchChapterByNumber --> GET /books/:bookId/chapters/:chapterId
                                        |
                                        +-- chương chưa published: chỉ chủ truyện và admin
                                        +-- chương > free_chapters: 403 chapter_locked
                                        +-- khách / user trong phần miễn phí: trần ngày
                                        +-- VIP, author, admin, chủ truyện: bỏ tường và trần
```

File màn đọc: `src/app/reader/[id].tsx`. File quyết định khóa: `admin-dashboard/server/index.js`, handler `GET /books/:bookId/chapters/:chapterId`.

Thứ tự trên server:

1. Tìm chương theo số hoặc theo id. Không có thì 404.
2. Đọc lại role từ MySQL.
3. Chương có `status` khác `published`: người thường nhận 403 `chapter_pending_moderation`. Chủ truyện và admin vẫn đọc được.
4. Khách và `user` mở chương có số lớn hơn `stories.free_chapters` (mặc định 3) thì 403 `chapter_locked`.
5. Chương còn trong phần miễn phí: khách bị trần `GUEST_DAILY_LIMIT` (mặc định 3 chương/ngày), thành viên thường bị trần 10 chương/ngày. Hết trần thì 429. Chương được mở có cờ `ad_required: true`.
6. VIP, author, admin và chủ truyện bỏ cả tường chương lẫn trần ngày, `ad_required: false`, và server ghi `chapter_views`.

Trên app, `shouldShowAds` trong `src/lib/ads.ts` quyết định có phát video hay không khi `ad_required` là true:

- Khách: có quảng cáo.
- `admin` và `author`: không.
- `vip` còn `vip_until` trong tương lai: không.
- `vip` hết hạn: có, sau khi server đã hạ role về `user`.

`AdInterstitial.tsx` chỉ phát placement `home`, `book-open`, và `reader`. Gắn component mà không truyền placement thì video đóng ngay. Nút bỏ qua khóa trong `minSecondsToSkip` (mặc định 15 giây). Khám phá dùng `home` một lần mỗi phiên. Chi tiết sách dùng `book-open`. Màn đọc chỉ phát khi vừa `ad_required` vừa `shouldShowAds`.

Tiêu đề trong trang đọc chỉ là “Chương N”. Chữ đọc theo chiều dọc. Nếu response không có chữ và cũng không có trường `error`, màn đọc dùng `mockChapterText`. Payload có `{ error }`, kể cả trần ngày của khách, được hiện ra và không đi vào chương giả.

---

## 7. Luồng “Đọc tiếp”

Bookmark là chương cao nhất từng mở, không phải chương vừa thoát.

| Tầng | File | Quy tắc |
|---|---|---|
| Máy | `src/lib/readingProgress.js` hàm `chooseReadingBookmark` | Chương lớn hơn thắng. Mở chương cũ không kéo mốc lùi và không lấy phần trăm cuộn của chương cũ |
| Máy, theo tài khoản | `src/lib/reading.ts` | Khách: AsyncStorage `reader_app_reading:guest`. User: `reader_app_reading:u:{userId}` |
| Server | `mysql.js` `upsertProgress`, `applyFurthestView` | Max của bản đang lưu, bản vừa gửi, và chương xa nhất trong `chapter_views` |
| Cột | `reading_history.chapter_no` | Chương xa nhất. `progress_pct` là vị trí cuộn trong chương đó |

Khi một lượt xem xa hơn thắng, server xóa `progress_pct` cũ. Thanh cam trên UI là phần trăm cuộn của chương xa nhất, không phải phần trăm cả bộ.

Đăng nhập gọi `hydrateReadingProgress`:

1. Đọc map khách.
2. Gộp vào map của user bằng chương cao hơn.
3. Xóa khóa khách.
4. `POST /progress` từng mục.
5. `GET` lịch sử server và gộp lần nữa theo chương xa nhất.

Hai tài khoản trên một máy không dùng chung khóa. Khóa chung cũ `reader_app_reading` đã bỏ vì nó lộ tiến độ sang tài khoản khác.

Thư viện “Đang đọc” đọc lịch sử này. Dòng không có tên truyện bị bỏ. Câu SQL phải lấy `stories.cover_image` rồi đặt bí danh `cover_url`. Bảng `stories` không có cột `cover_url`.

---

## 8. Luồng tải offline

Không có API “tải sách”. Client tự tải từng chương rồi ghi file.

`src/lib/offline.ts`:

1. `currentScope()` trả `u_{userId}` hoặc `guest`.
2. Mục lục nằm ở SecureStore, khóa `reader_app_offline_index_v1_{scope}`.
3. Nội dung là `offline/{scope}/book_{id}.json`.
4. Chương đầu rỗng thì hủy. Lỗi ở chương sau thì vẫn ghi file và đánh dấu `partial: true`.

`src/app/book/[id].tsx` nút Tải về gọi `handleDownloadOffline`. `src/app/reader/[id].tsx` gọi `getOfflineChapter` trước API. Chương đã có chữ trong file thì không gọi mạng, kể cả khi tác giả đã sửa chương trên server. Muốn bản mới thì xóa bản tải rồi tải lại. Tab Thư viện → Đã tải đọc index này. Nút Xóa gỡ file của đúng scope.

---

## 9. Luồng theo dõi, thích, thông báo

Có hai kiểu theo dõi:

- `author_follows`: theo dõi tác giả. Bảng tin `GET /following/feed` và thông báo chương mới dùng bảng này.
- `follows`: theo dõi truyện. Tách khỏi bảng tin tác giả.

`src/app/(tabs)/follow.tsx` chỉ gọi feed khi có token. Khách thấy feed rỗng. Bài cũ hơn 3 ngày bị lọc. Gợi ý tác giả dùng lại `pickHomeRecommendations` với 4 mục.

Thích truyện là `POST /books/:id/like`, ghi bảng `likes`. Tab Thư viện “Đã thích” gọi `apiFetchLikedBooks`. Trợ lý AI lưu tủ sách cũng ghi vào `likes` qua `createLike`, nên tab này thấy cùng một dòng.

Thông báo trong app: `GET /notifications`, `GET /notifications/unread`, `POST /notifications/seen`. Màn hình là `src/app/notifications.tsx`.

Đẩy nền: app đăng ký token ở `src/lib/pushNotifications.ts` → `POST /push/device`. Server gửi ở `admin-dashboard/server/push.js`. Bấm thông báo chương mới thì `_layout.tsx` mở đúng chương.

---

## 10. Luồng tiền: nạp xu, VIP, tác giả, quà, rút

Giá và số dư nằm trên server. App không được quyết định số xu trừ.

### Nạp xu

1. App mở `src/components/QRPaymentModal.tsx`.
2. `POST /wallet/topup-intent` tạo mã `RD…`, số tiền = xu × 100 VND, hết hạn 15 phút, ghi `topup_intents`.
3. App hỏi `GET /wallet/topup-intent/:code/status` mỗi 3 giây.
4. Cộng tiền đúng một lần trong `consumeAndCreditIntent` (`mysql.js`), khóa dòng bằng `FOR UPDATE`. Thiếu tiền hoặc hết hạn thì không cộng.

Hai đường cộng tiền:

- `POST /sepay/webhook` với header `Authorization: Apikey …`.
- `POST /wallet/verify-payment` hỏi giao dịch ngân hàng khi có token SePay.

Trên máy demo, `isSepayLocal()` đúng khi `NODE_ENV` không phải production và `SEPAY_LOCAL` là true. Nút xác nhận gọi `POST /sepay/local-pay` và cộng xu tại chỗ, không gọi ngân hàng. Production luôn tắt nhánh này.

Admin cộng xu tay là `POST /users/:id/wallet/topup`, nằm ở màn Người dùng, không có mục sidebar riêng tên “Nạp xu”. Sổ cái là route hash `#transactions`.

### Mua VIP

`POST /wallet/buy-vip` trong `index.js`:

1. Trừ `VIP_COST_COINS` (mặc định 500) bằng `debitWallet`.
2. `updateUserVip` đặt role `vip` và cộng 1 tháng vào `vip_until`. Hàm này cộng tháng, không dùng số tháng do client gửi khi không truyền `days`.
3. Nâng cấp lỗi thì cộng lại xu.

`refreshUserVipStatus` trong `mysql.js`: role `vip` hết hạn thì hạ về `user` và xóa `vip_until`.

### Mua quyền tác giả

`POST /wallet/buy-author`:

1. Giá gốc 800 xu. Còn ít nhất 15 ngày VIP thì 300 xu.
2. Trừ ví, `promoteUserToAuthor`, rồi `updateUserVip` với role `author` và cộng 1 tháng VIP.
3. Mở các truyện đang ẩn của tác giả đó.
4. Thất bại thì hoàn xu và kéo role lại nếu vừa nâng.

Hết tháng cộng kèm, `refreshUserVipStatus` không thu role `author` và không giấu truyện. Nếu truyện đang ẩn, hàm này mở lại. `shouldShowAds` cũng không hiện quảng cáo cho mọi role `author`.

### Tặng quà

Catalog trong `admin-dashboard/server/gifts.js`:

| Mã | Tên | Xu |
|---|---|---|
| rose | Hoa hồng | 10 |
| milktea | Trà sữa | 50 |
| lion | Sư tử | 100 |
| rocket | Tên lửa | 200 |
| crown | Vương miện | 500 |

`POST /books/:id/donate` chỉ nhận `gift_code` và `quantity` từ 1 đến 20. Thành tiền = giá × số lượng. Cần đăng nhập, đủ số dư, không tự tặng, không tặng admin.

`transferGift` trong `mysql.js` trừ ví người tặng, cộng ví tác giả, và ghi `donations` trong một transaction. Thiếu tiền thì rollback. Dòng `payments` được ghi sau commit. Lỗi ở dòng sổ này không rút lại xu.

UI là `AuthorGiftCard` trên trang sách. Hiệu ứng ở `giftMotion.tsx`. Máy chưa build lại native module thì rơi về animation thường.

### Rút xu

`POST /withdrawals` gọi `createWithdrawalReserved`: trừ ví và tạo đơn `pending` trong một transaction. Admin `PUT /withdrawals/:id`. Từ chối chỉ hoàn xu khi đơn vẫn `pending`, có `FOR UPDATE`, nên bấm hai lần không cộng đúp. Sidebar dashboard chưa có mục đơn rút riêng.

---

## 11. Luồng tác giả đăng chương

```
author/manage.tsx hoặc ChapterImportModal
        |
        POST /books/:id/chapters
        |
        createChapter  --> status pending_review
        |
        integrity.reviewChapter
              |
              +-- xanh  --> published
              +-- vàng hoặc đỏ --> giữ pending_review + moderation_logs
              +-- lỗi đối chiếu --> giữ pending_review, không tự xuất bản
```

Quyền ghi: admin, hoặc author đúng chủ truyện. Người khác nhận 403. Nội dung 1–80.000 ký tự. Đoạn này là `POST /books/:id/chapters` trong `index.js`, thuật toán ở `integrity.js` hàm `reviewChapter`.

Cách chấm vùng:

1. `simhash64` băm chương. Giá trị lưu `BIGINT UNSIGNED` dạng chuỗi vì lớn hơn số nguyên an toàn của JavaScript.
2. Lấy tối đa 8 vân tay chương đã xuất bản gần nhất trong `chapter_fingerprints`.
3. Jaccard trên cụm 5 từ, kèm đoạn trùng rút bởi `extractMatchedSnippets`.
4. Không có đoạn trùng: xanh, `published`.
5. Trùng khít, hoặc Hamming không quá 3 và Jaccard từ 0,8: đỏ, `pending_review`.
6. Còn bằng chứng chữ: vàng, `pending_review`.
7. Chỉ vàng và đỏ mới gọi model để viết nhận xét cho admin. Nhận xét không đổi vùng và không kết luận bản quyền.

Nhập hàng loạt từ máy: `src/lib/chapterImport.ts` đọc txt, `src/lib/docxText.ts` đọc docx, UI là `ChapterImportModal.tsx`. Test khóa luật này ở `test/chapterImport.test.cjs`.

Sửa chương: `PUT /books/:bookId/chapters/:chapterId`. Xóa: `DELETE` cùng đường.

---

## 12. Luồng bình luận và kiểm duyệt

```
POST /books/:id/comments
    |
    intakeComment
        |-- rỗng: 400
        |-- dài hơn 2000 ký tự: 413
        |-- quảng cáo cờ bạc rõ: 400, không ghi
        |-- còn lại: INSERT status = pending + job ai_moderation_jobs
                |
                worker mỗi 1 giây, một job một lúc
                |
                assessToxicity --> điểm 0..1
                      |-- < 0.5 xanh: approved, người khác thấy
                      |-- 0.5..0.8 vàng: shadowbanned, chỉ tác giả thấy
                      |-- > 0.8 đỏ: pending, admin duyệt
                      |-- văn xuôi / timeout / hết khóa: heuristic, vẫn pending
```

Code chặn đầu vào và chấm điểm: `admin-dashboard/server/integrity.js`. Worker khởi động ở cuối `index.js` khi `AI_WORKER_ENABLED` không phải `false`. Hàng đợi và transaction cập nhật trạng thái: `ai_store.js` (`enqueueCommentModeration`, `claimCommentModeration`, `applyCommentModeration`).

Ai thấy bình luận: `getComments` trong `mysql.js`. Feed công khai chỉ lấy `approved`. Người viết vẫn thấy bình luận của mình khi status là `pending` hoặc `shadowbanned`.

Vàng và đỏ, và cả điểm hỏng, đều có dòng `moderation_logs` vì zone không phải xanh. Admin xử lý ở `ModerationPanel.jsx` qua:

- `GET /moderation/logs`
- `GET /moderation/logs/:id`
- `POST /moderation/logs/:id/decision`

Cho xuất bản đặt published/approved và `approved_by_admin`. Khóa đặt rejected và `penalized_by_admin`. Diff hai cột đọc `selected.diff.left` và `right`.

Heuristic khi model không trả JSON: tục nặng có dấu khoảng 0,92, cụm kiểu “đồ ngu” khoảng 0,78, câu thường khoảng 0,08. “các / lớn / buổi” không bị bỏ dấu rồi kết án. Điểm heuristic không được tự duyệt.

---

## 13. Luồng trợ lý đọc

Hai chỗ gọi cùng `apiChat` trong `src/lib/api.ts`, tức `POST /chat`:

- Ngoài sách: `src/app/chatbot.tsx`.
- Trong chương: `src/components/ReaderAgentSheet.tsx`. Chip “Tóm tắt 10 chương trước”. Tấm trượt khoảng 68% màn hình, nút ẩn khi cuộn xuống (`src/lib/readerAgentScroll.js`).

`POST /chat` trong `index.js`:

1. Bắt buộc MySQL.
2. Bearer thì lấy `userId`, không có thì khách.
3. `enforceAiQuota` phạm vi chat: 30 lần / 15 phút theo user và theo IP.
4. `chat_agent.handleChatRequest`.

`detectIntent` trong `chat_agent.js`: body gửi sẵn `recap` hoặc `recommend` thì dùng đúng ý đó. Không thì nhìn từ khóa (“tóm tắt”, “chương trước” → recap; “gợi ý”, “thể loại” → recommend). Còn lại là recommend.

### Tóm tắt

Chỉ user đăng nhập. Khách nhận 401 `login_required` trước khi tạo hội thoại và trước khi gọi model. App cũng chặn chip nếu chưa có token.

Khi đã đăng nhập (`handleRecap`):

1. Không có `book_id`: bảo chọn một truyện đang đọc. Không tự lấy truyện đầu danh sách. Chatbot gọi `getReadingList()` để hiện lựa chọn. Danh sách rỗng thì không gọi model.
2. Phải có chương đã mở trong `chapter_views` (`getVerifiedReadingChapter`). Số chương client gửi bị kẹp xuống số đã xác minh.
3. Câu xin một chương bằng hoặc sau chương hiện tại thì từ chối, không gọi model.
4. `catchUpWindow`: từ `max(1, hiện tại - 10)` đến `hiện tại - 1`. Hằng `RECAP_WINDOW = 10`.
5. Chương 1 không có cửa sổ. Trả câu “chương mở đầu, chưa có sự kiện trước đó”, không gọi model.
6. Cache `story_summary_cache` theo `(story_id, from_chapter, to_chapter)` và hash nội dung. Trúng cache thì không gọi model. Sửa chương làm hash đổi nên cache cũ không được dùng.
7. Tổng chữ vượt `AI_RECAP_MAX_CHARS` (mặc định 60.000, trần 85.000) thì không gọi model.
8. Model lỗi thì trả câu cố định và không ghi cache.
9. Cùng một cửa sổ dùng `GET_LOCK` của MySQL. Tối đa 3 lệnh model cùng lúc và 20 người chờ. Người thứ 24 nhận 429 `ai_busy`. Logic khóa nằm ở `ai_store.js` hàm `withSummaryLock`.

Từ chatbot, bấm tóm tắt một truyện thì điều hướng `/reader/[id]?ch=&recap=1`. Màn đọc mở sheet và tự gửi “Tóm tắt 10 chương trước”.

`ChatSessionBar.tsx`: “Phiên mới” chỉ xóa id hội thoại trên máy. Hội thoại cũ vẫn ở server. “Lịch sử” cần đăng nhập, gọi `GET /chat/conversations` và `GET /chat/conversations/:id/messages`. Server kiểm chủ hội thoại bằng `getConversationForReader`.

Chấm đang gõ là `TypingDots.tsx`, nằm trong bong bóng chat.

### Gợi ý

Khách dùng được.

1. `recommendationClarification`: câu chưa có thể loại, tâm trạng, hoặc truyện mốc thì trả câu hỏi và `books: []`. “Cùng vibe” chỉ đi tiếp khi đã có tên truyện từ `book_id` hoặc tiến độ. Sau câu hỏi, “gì cũng được” thì được chọn đại.
2. `searchStoriesFulltext`: `MATCH ... AGAINST` trên tên và mô tả, tối đa 8 ứng viên. `LIKE` chỉ khi `MATCH` lỗi.
3. Model được gọi tối đa 3 vòng công cụ. Công cụ agent thấy được: `get_user_progress`, `search_stories`, `save_to_favorites`. `get_catchup_summary` là hàm nội bộ, không phải công cụ của model.
4. `save_to_favorites` chỉ chạy khi câu có ý lưu rõ (`allowsFavoriteSave`).
5. Kết quả cuối phải là JSON `story_ids`. Một ID không nằm trong ứng viên làm bỏ cả danh sách. Server trả tối đa 4 thẻ thư viện và ghi đây là đường dự phòng.
6. Thiếu khóa AI: vẫn trả thẻ thư viện, `fallback_reason=ai_unconfigured`, không trả 500.
7. Lệnh gợi ý chỉ đọc bị trần `AI_RECOMMEND_MAX_INFLIGHT` (mặc định 50). Hết trần thì trả catalog, không gọi model. Câu có ý lưu tủ sách không đi vào cache và không đi vào trần 50 này. Code ở `recommendation_cache.js`.

Thẻ vẽ bằng `StoryFlashcards.tsx` khi intent là recommend và có sách, tối đa 4. Mặt trước là bìa, tên, thể loại, số chương. Mặt sau là mô tả cắt 180 ký tự và nút Đọc truyện. `toBookCard` trong `chat_agent.js` tạo các trường đó.

Hạn mức gọi model theo ngày nằm ở `ai_runtime.js`: 100 lần mỗi user (`AI_USER_DAILY_CALL_LIMIT`) và 1.000 lần cả hệ thống (`AI_DAILY_CALL_LIMIT`). Mỗi lệnh có `AbortSignal` 25 giây. Hết giờ thì `ai_timeout`. Không có stream. Provider timeout hoặc HTTP 429/5xx thì provider đó nghỉ 15 giây.

Model theo việc: `AI_CHAT_MODEL`, `AI_RECAP_MODEL`, `AI_MODERATION_MODEL`, `AI_PLAGIARISM_MODEL`. Không có thì dùng `AI_MODEL`. Host khác `api.x.ai` chỉ gửi `AI_API_KEY`. Host `api.x.ai` thử `XAI_API_KEY`, rồi `GROK_API_KEY`, rồi `AI_API_KEY`.

---

## 14. Luồng dashboard

Dashboard là Vite/React, không phải Expo. Điều hướng bằng hash trong `App.jsx`, không dùng React Router của app.

| Hash | Màn | API chính |
|---|---|---|
| `#dashboard` | Tổng quan, top truyện | `GET /stats` |
| `#books`, `#book:id` | Sửa sách, tải bìa | `POST/PUT /books`, `POST /books/:id/upload` |
| `#chapters:id` | Sửa chương của một sách | `PUT /books/:bookId/chapters/:chapterId` |
| `#genres` | Thể loại | `/genres` |
| `#banners` | Banner ảnh | `/banners` |
| `#ads` | Video, placement home / book-open / reader | `/ads` |
| `#users` | Role và cộng xu tay | `/users`, `POST /users/:id/wallet/topup` |
| `#transactions` | Sổ VIP, xu, quà. SePay tự động ghi nhãn riêng | `/payments`, `/donations` |
| `#comments` | Bình luận | `/comments` |
| `#integrity` | Hàng chờ AI | `/moderation/logs` |

Đăng nhập admin ghi `admin_token` vào `localStorage`. `admin-dashboard/frontend/src/api.js` gửi Bearer đó về `http://localhost:4000`. API tắt thì màn hình hiện cảnh báo trong trang, không chặn bằng hộp thoại.

Làm mới `#chapters:id` làm rơi id sách vì hash không còn phần sau dấu hai chấm theo cách trang khôi phục. Bảng giao dịch ẩn dòng VND không có xu dương và không có thời hạn VIP.

---

## 15. Bảng MySQL và file nào đụng tới

Định nghĩa ở `admin-dashboard/server/schema.sql`. Cột thêm sau này ở `migrate.js` và `migrations/004_dual_agent_cp1.sql`.

| Nhóm | Bảng | Ai ghi |
|---|---|---|
| Tài khoản | `users`, `authors` | `index.js` đăng ký, Firebase, mua VIP, mua tác giả |
| Truyện | `stories`, `chapters`, `genres`, `story_genres` | Route sách và chương. Ảnh bìa là `cover_image`, API đặt bí danh `cover_url` |
| Đọc | `reading_history`, `chapter_views`, `reading_starts`, `bookmarks` | `POST /progress`, lúc mở chương |
| Cộng đồng | `comments`, `likes`, `follows`, `author_follows` | Bình luận, tim, theo dõi |
| Tiền | `wallets`, `topup_intents`, `topup_requests`, `payments`, `donations`, `withdrawals` | Ví, SePay, quà, rút |
| AI | `story_summary_cache`, `conversations`, `messages`, `chapter_fingerprints`, `moderation_logs`, `ai_moderation_jobs`, `ai_usage_logs`, `ai_request_quotas` | `chat_agent.js`, `integrity.js`, `ai_store.js` |
| Vận hành | `banners`, `ads`, `user_notifications`, `fcm_tokens`, `notification_state`, `author_applications` | Dashboard và push |

`chapter_recaps` là cache tóm tắt từng chương của bản cũ. Code mới không ghi bảng này. Cache đang dùng là `story_summary_cache`, một dòng cho cả cửa sổ 10 chương.

Khóa nghiệp vụ đúng là `story_id`, `chapter_id`, `chapter_no`, `user_id`. Không có bảng `user_reading_progress` và không có cột `chapter_number`.

---

## 16. Thứ tự khi một người đọc từ đầu đến cuối

Một phiên điển hình, để đối chiếu file khi debug:

1. Splash `src/app/index.tsx` → chào `src/app/home.tsx`.
2. Đăng nhập `src/app/(auth)/login.tsx` → `src/lib/auth.ts` → `POST /auth/login` hoặc `POST /auth/firebase`.
3. Gộp tiến độ `src/lib/reading.ts`.
4. Tab Khám phá `src/app/explore.tsx` → `GET /books` và `GET /banners`.
5. Chi tiết `src/app/book/[id].tsx` → `GET /books/:id`. Có thể phát quảng cáo `book-open`.
6. Đọc `src/app/reader/[id].tsx`. Offline trước. Không có file thì `GET` chương, server xét khóa và trần ngày.
7. Cuộn được ghi `progress_pct`. Mở chương xa hơn thì `reading_history.chapter_no` tiến.
8. Tóm tắt: `ReaderAgentSheet.tsx` → `POST /chat` → `chat_agent.js` cửa sổ 10 chương trước.
9. Gợi ý: cùng `POST /chat`, thẻ ở `StoryFlashcards.tsx`.
10. Bình luận: `POST /books/:id/comments` → pending → worker `integrity.js`.
11. Tặng quà: `AuthorGiftCard.tsx` → `POST /books/:id/donate` → `transferGift`.
12. Nạp xu: `QRPaymentModal.tsx` → `POST /wallet/topup-intent` → webhook hoặc local-pay.
13. Admin thấy tiền ở `#transactions`, thấy chương vàng/đỏ ở `#integrity`.

---

## 17. Test khóa luật nào

| Lệnh | File | Khóa |
|---|---|---|
| `npm test` ở gốc | `test/homeFeed.test.cjs`, `test/chapterImport.test.cjs`, `test/readingProgress.test.cjs`, rồi `admin-dashboard/server/test/ai.test.js` | 5 truyện trang chủ, nhập chương, chương xa nhất, hợp đồng AI không gọi mạng |
| `AI_DB_TEST=1` | `admin-dashboard/server/test/ai-db.test.js` | Job kiểm duyệt và MySQL tạm |

Bộ mặc định không mở ví, không gọi model trả phí, và không bấm qua giao diện admin.
