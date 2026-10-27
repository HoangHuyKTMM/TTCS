# Dữ liệu Langfuse trong dashboard — 02/10/2026

Dashboard có tab **Kiểm duyệt AI → Langfuse** để đọc dữ liệu từ project Langfuse đã cấu hình trên backend.

## Giao diện

- Bộ lọc từ ngày/đến ngày (bao gồm ngày kết thúc theo múi giờ trình duyệt), tối đa 90 ngày, và tên tác vụ chính xác.
- Tổng lượt gọi model, token vào/ra, chi phí USD, độ trễ trung bình và P95.
- Biểu đồ lượt gọi theo ngày UTC và bảng theo tác vụ/model/mức độ.
- Danh sách generation phân trang bằng cursor; chọn **Xem trace** để đọc Input/Output, token, model, thời gian, mức độ và metadata. Chi tiết trace cũng có phân trang và nút tải lại.
- Trong hàng chờ kiểm duyệt, chi tiết trace hiển thị trực tiếp bằng giao diện dashboard. Khoảng thời gian đọc lấy quanh `created_at` của mục kiểm duyệt để xem được cả mục cũ hơn 30 ngày.

## API backend

Các route đều dùng `authMiddleware` và `requireAdmin` hiện có, trả `Cache-Control: no-store`. Không cần thêm migration hoặc dependency. Khóa public/secret chỉ được dùng ở backend, không chuyển xuống frontend.

| Route | Dữ liệu |
| --- | --- |
| `GET /moderation/langfuse/metrics?from=ISO&to=ISO&name=chat` | Tổng hợp, nhóm tác vụ/model/mức độ, chuỗi theo ngày |
| `GET /moderation/langfuse/observations?from=ISO&to=ISO&name=chat&cursor=...` | Generation, 50 dòng/trang, không tải Input/Output |
| `GET /moderation/traces/:traceId?from=ISO&to=ISO&cursor=...` | Observation của trace, có Input/Output, giữ `trace_id` và `url` của route cũ |

`from`, `to`, `name`, `cursor` là tùy chọn. Mặc định đọc 30 ngày gần nhất. Đọc cùng `LANGFUSE_ENVIRONMENT` với bộ xuất OTLP, mặc định `development`. UUID của app được chuyển thành 32 ký tự hex khi đọc Langfuse.

Thống kê chỉ tính observation loại `GENERATION`, tránh đếm span kiểm duyệt thành lượt gọi model. API thống kê giới hạn nhóm ở 1.000 dòng; giao diện báo khi chạm giới hạn. Độ trễ Metrics API dùng milliseconds; Observations API trả seconds, được chuyển về milliseconds trước khi hiển thị. Input/Output chuỗi JSON được parse khi hợp lệ, chuỗi khác được giữ nguyên và hiển thị qua React text.

Chi phí chuẩn của Langfuse dùng **USD**, có thể là ước tính theo giá model. Báo giá nhà cung cấp lấy từ metadata `provider_cost` / `cost_unit`, hiển thị riêng (ví dụ VND), không cộng vào USD. Thiếu chi phí được giữ là `null` và hiển thị “—”. Tab thống kê chi phí MySQL hiện có vẫn dùng dữ liệu báo giá nhà cung cấp.

## Xác minh

- Backend: **150/150** kiểm thử đạt, gồm hợp đồng API v2, cursor, đơn vị tiền/thời gian, validation, lỗi upstream và quyền route.
- Kiểm thử tài khoản và vai trò với HTTP/MySQL sandbox: **50/50** đạt; guest, reader, VIP, author không đọc được hai route Langfuse mới.
- Dashboard build thành công.
- Trình duyệt: **10 kiểm tra** đạt với dashboard thật, các route backend thật và Langfuse fixture cục bộ: thống kê/biểu đồ, phân trang generation, phân trang trace/Input/Output, tiền tệ, escape nội dung prompt, khoảng thời gian không hợp lệ, bộ lọc tác vụ, màn hình nhỏ, HTTP 429 và dữ liệu rỗng.
- API Langfuse thật: ba truy vấn Metrics API v2 thành công, chưa có generation trong khoảng đã đọc; trace kiểm tra kết nối đọc được Input/Output. Không phát sinh lời gọi model AI trả phí.
- Ảnh và kết quả trình duyệt: `.test-artifacts/langfuse-dashboard/desktop.png`, `mobile.png`, `result.json`.
- Đã xác định backend cổng 4000 thuộc thư mục `Reader_app/admin-dashboard/server`, khởi động lại với mã nguồn mới và kiểm tra ba route Langfuse đều trả HTTP 401 khi chưa đăng nhập.

Chạy lại:

```powershell
npm --prefix admin-dashboard/server test
npm --prefix admin-dashboard/server run test:ai:roles
npm --prefix admin-dashboard/frontend run build
node scripts/test-langfuse-dashboard.cjs
```

Kiểm thử trình duyệt cần Playwright và Chromium, cùng dashboard ở `http://localhost:5173`. Có thể đặt `LANGFUSE_ADMIN_URL` và `LANGFUSE_CHROMIUM_PATH` nếu dùng URL hoặc trình duyệt khác.

## Tài liệu API

- [Langfuse Public API và Observations API v2](https://langfuse.com/docs/api-and-data-platform/features/public-api)
- [Metrics API v2](https://langfuse.com/docs/metrics/features/metrics-api)
- [Ví dụ thống kê v2, alias cột và đơn vị độ trễ](https://langfuse.com/guides/cookbook/example_metrics_api_v2)

Dữ liệu chỉ xuất hiện sau khi đã gửi trace lên Langfuse. Các lần gọi AI trước đây tắt xuất Langfuse không tự có trong dashboard Langfuse.
