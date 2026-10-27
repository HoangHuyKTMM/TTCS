# Kết nối Langfuse — 02/10/2026

Đã xác thực bộ khóa người dùng cung cấp với Langfuse US, lấy Project ID qua API và lưu cấu hình trong `admin-dashboard/server/.env`. File này được Git bỏ qua; không ghi khóa vào báo cáo hoặc frontend.

Project: [My Project](https://us.cloud.langfuse.com/project/cmur4kuk502ofad0dnfz1erw2).

## Sửa tích hợp

- Chuyển trace/generation từ legacy ingestion sang OTLP HTTP/JSON, gửi header `x-langfuse-ingestion-version: 4` theo [hướng dẫn Langfuse](https://langfuse.com/integrations/native/opentelemetry).
- Giữ UUID trong dữ liệu app, chuyển thành 32 ký tự hex khi gửi OTLP và tạo URL Langfuse; metadata `app_trace_id` giúp đối chiếu với database.
- Gửi Input/Output thực tế của lời gọi model và kết quả kiểm duyệt, token, model, thời gian, trạng thái và lỗi. Nội dung prompt không được đưa thêm vào bảng thống kê chi phí MySQL.
- Giữ báo giá VND trong metadata `provider_cost`/`cost_unit`; không ghi số VND vào trường cost của Langfuse vốn dùng USD.
- Thêm liên kết mở trace ở tab mới trong chi tiết kiểm duyệt để đọc được khi trình duyệt không cho nhúng iframe.

## Xác minh

API xác thực project thành công. Trace [langfuse-connection-check](https://us.cloud.langfuse.com/project/cmur4kuk502ofad0dnfz1erw2/traces/14422429793447c29447b9f522d492ff) được gửi bằng OTLP và đọc lại qua Observations API v2; Input/Output đều có dữ liệu. Đây là trace kiểm tra kết nối, không gọi model AI và không phát sinh request trả phí cho provider AI.

API đọc trace cũ trả HTTP 410; việc đọc lại dùng `GET /api/public/v2/observations` với `traceId`, `fromStartTime`, `toStartTime`. Bằng chứng không chứa khóa: `.test-artifacts/langfuse-connection-check.json`.

Kiểm thử backend: **138/138 đạt**; build dashboard đạt. Test mới xác minh hợp đồng OTLP, liên kết ID, Input/Output, token, không nhầm VND thành USD, phát hiện partial rejection/HTTP lỗi và giữ nguyên kết quả AI khi Langfuse lỗi. Các lượt kiểm thử tự động dùng gateway cục bộ.

## Áp dụng cho backend đang chạy

Cấu hình và mã nguồn đã lưu, nhưng backend cổng 4000 vẫn là tiến trình cũ. Công cụ tự động bị chặn khi yêu cầu dừng/khởi động lại tiến trình (`blocked by policy`); chưa thực hiện được bước này. Dừng backend trong terminal của nó bằng Ctrl+C rồi chạy từ thư mục gốc:

```powershell
npm --prefix admin-dashboard/server start
```

Sau khi khởi động lại, các thao tác AI mới sẽ gửi trace. Trong Langfuse, chọn project, mở Traces và chọn thời gian phù hợp. Lượt kiểm thử AI trước đó đã tắt Langfuse, nên không tự xuất hiện trong project. Không chạy lại AI trả phí với ngân sách 4.000 VND đã dùng cho lượt kiểm thử trước.
