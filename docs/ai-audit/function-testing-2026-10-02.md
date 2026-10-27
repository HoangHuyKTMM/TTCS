# Kiểm thử chức năng và sửa lỗi — 2026-10-02

Kiểm tra tự động tập trung vào AI, đăng ký/đăng nhập, tìm kiếm, quyền đọc chương và duyệt nội dung. Các lỗi dưới đây được tái hiện bằng TypeScript hoặc kiểm tra hồi quy trước khi sửa. MySQL/HTTP chạy trên database tạm và server riêng, với provider AI giả lập, không gọi AI trả phí.

| Lỗi đã phát hiện | Kết quả sửa |
| --- | --- |
| Token Firebase giả vẫn cấp JWT cho email của tài khoản khác | Firebase Admin SDK xác minh token trước khi truy cập DB. UID/email/name/provider lấy từ token đã xác minh, không lấy từ payload. Liên kết email cần email đã xác minh; UID khác đã liên kết bị từ chối. |
| Giả header `Host: localhost` và `x-bypass-auth`/`x-dev-token` để có quyền admin | Chỉ cho bypass khi `ALLOW_DEV_TOKENS=true`, `NODE_ENV=development` và socket thực đến từ loopback. |
| Màn đăng ký có 3 lỗi TypeScript: hàm không tồn tại và social login sai chữ ký | Đăng ký email dùng backend; Google/Facebook dùng cùng luồng nền tảng với màn đăng nhập. |
| Bấm social login ngay khi mở ứng dụng gây lỗi provider chưa khởi tạo | Chờ promise khởi tạo SDK trước khi đăng nhập. |
| Backend từ chối nhưng ứng dụng vẫn lưu Firebase token như JWT và báo thành công | Chỉ lưu phiên khi HTTP thành công và trả token của backend; lỗi được hiển thị. |
| Agent tìm nhiều lượt làm mất truyện tìm được trước đó | Gộp kết quả theo ID, giữ dữ liệu xác thực cho toàn bộ lượt công cụ. |
| Đã lưu vào tủ sách nhưng lượt AI tiếp theo lỗi nên không báo đã lưu | Giữ và xác nhận các ID đã lưu, kể cả khi lượt tiếp theo timeout/hết quota. Không gọi lại thao tác ghi. |
| Tham số tìm kiếm sai kiểu vẫn đến DB | Kiểm tra kiểu, độ dài và giới hạn 8 kết quả trước khi gọi công cụ. |
| Đăng ký sai kiểu trả 500; mật khẩu yếu/quá dài được nhận; login tài khoản không có password hash lỗi 500 | Kiểm tra email/password/name; giới hạn bcrypt 72 byte; trả 400 cho dữ liệu hoặc thông tin đăng nhập không hợp lệ. |
| API chi tiết truyện/danh sách chương trả toàn bộ nội dung, vượt giới hạn đọc | Người đọc nhận metadata; nội dung qua endpoint đọc có kiểm tra quyền/quota. Admin/tác giả của truyện giữ nội dung để sửa bản thảo. |
| Truyện ẩn vẫn đọc được qua endpoint chương | Kiểm tra truyện còn hiển thị trước khi trả danh sách/nội dung. |
| ID chương không tồn tại trả nhầm chương đầu | Bỏ fallback sang chương bất kỳ; trả 404 nếu không tìm được đúng ID/số chương. |
| `/books/search` bị route `/books/:id` chặn; SQL tham chiếu cột không tồn tại | Đặt route tìm kiếm trước route ID, tính likes/số chương published bằng dữ liệu thật; lọc truyện ẩn và kiểm tra phân trang. |

Kiểm tra tác giả phát hiện thiếu trường chủ sở hữu ở helper metadata mới; đã bổ sung JOIN tác giả và xác nhận tác giả đọc được chương pending của mình, người khác nhận 403. Kiểm tra 15 phiên Firebase đồng thời phát hiện deadlock khi khóa khoảng trống của UID/email mới; đã dùng isolation READ COMMITTED cho transaction này, giữ row lock và ràng buộc UNIQUE. Phiên trả kết nối transaction trước khi lấy kết nối để cập nhật role, tránh nghẽn pool.

## Kết quả nghiệm thu

- 32 kiểm tra backend: 29 AI và 3 xác minh Firebase — đạt.
- 26 kiểm tra MySQL/HTTP, gồm transaction, race, quyền truy cập, đăng ký → đăng nhập → `/me`, tìm kiếm và worker — đạt.
- 5 kiểm tra đăng nhập phía ứng dụng với SDK/backend giả lập — đạt.
- `npm run typecheck` — đạt, 0 lỗi.
- Dashboard `npm run build` — đạt.
- Expo export web — đạt; bản build local nằm trong `.test-artifacts/web` và được git bỏ qua.
- Node syntax cho các file backend sửa trong đợt này — đạt.
- 0 lời gọi AI trả phí; database chính giữ 10 truyện, 291 chương, 5 hội thoại, 14 tin nhắn; không còn database kiểm thử tạm.

## Chạy lại

```powershell
# Tại thư mục gốc
npm run test:auth
npm run typecheck

cd admin-dashboard/server
npm test
$env:AI_DB_TEST='1'
node --test test/ai-db.test.js
```

Backend có thêm dependency `firebase-admin`. Khi cập nhật sang máy khác cần `npm install` tại `admin-dashboard/server`. `FIREBASE_PROJECT_ID` mặc định là project hiện dùng trong client (`newsai-793dc`), có thể đặt lại trong `.env`. Server xác minh theo [tài liệu Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens). Database local đã có `firebase_uid`, `auth_method`, `avatar_url`; máy dùng schema cũ cần có các cột này theo `schema.sql`.

Khởi động lại backend đang chạy để các bản sửa có hiệu lực. Không dùng header bypass cho bản production.

## Giới hạn kiểm thử

Chưa chạy thao tác thủ công trên thiết bị Android/iOS, OAuth thật với Google/Facebook, giao dịch ngân hàng thật, hoặc benchmark chất lượng/chi phí provider AI thật. Bản build web thành công không thay thế kiểm thử giao diện và native. Kiểm tra liên kết tài khoản dùng claims giả lập sau bước xác minh; kiểm tra token giả/sai thuật toán/sai project dùng Firebase Admin SDK thật. `verifyIdToken` hiện xác minh chữ ký/project/thời hạn; chưa bật kiểm tra token đã bị thu hồi vì cần quyền dịch vụ Firebase. Không kết luận toàn bộ ứng dụng đã hết lỗi.
