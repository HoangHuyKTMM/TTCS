# Đợt sửa AI — 01/10/2026

Cập nhật 02/10: đã sửa tiếp các lỗi đăng nhập, quyền đọc và tìm kiếm; TypeScript hiện đạt. Kết quả mới: [kiểm thử chức năng](function-testing-2026-10-02.md). Các số liệu bên dưới ghi nhận đợt sửa ngày 01/10.

Đã sửa trực tiếp mã backend, mobile và dashboard. Migration bổ sung đã chạy trên database local; giữ nguyên truyện, chương, tài khoản và hội thoại cũ.

## Hành vi sau sửa

- Hội thoại được kiểm tra chủ sở hữu trước khi đọc hoặc ghi. Guest nhận token ngẫu nhiên 256-bit; DB chỉ lưu hash. Hội thoại guest cũ không có token phải mở lại. Hai màn chat mobile gửi token ở lượt tiếp theo và reset khi hội thoại không còn được phép truy cập.
- Recap tối đa **10 chương**, lấy vị trí không vượt chương published đã mở trong `chapter_views`. Không dùng chương cuối khi thiếu vị trí. Chỉ gửi chương từng mở và published; gửi đầy đủ nội dung thay vì 1.200 ký tự đầu. Guest vẫn theo visitor IP của cơ chế đọc hiện có; người chung IP có thể chung lịch sử mở chương. Đăng nhập cho phép tách tiến độ theo user.
- Cache có `source_hash` bao gồm nội dung đầy đủ, model và phiên bản prompt. Sửa/ẩn/giữ chương làm nguồn khác đi, cache cũ không được dùng. Bản dài trên 650 ký tự vẫn được đọc. Single-flight gộp request cùng reader, khóa MySQL ngăn các process tạo cùng khoảng đồng thời; tối đa ba khóa tóm tắt giữ connection và 20 request chờ để tránh chiếm hết pool. Cache hit vẫn đọc nguồn để kiểm tra quyền và phiên bản.
- Câu có các/lớn/buổi không bị heuristic nhầm từ tục. Thảo luận tình tiết bạo lực không bị block chỉ vì từ khóa nhạy cảm. Điểm AI phải là JSON số trong [0,1] hoặc một số đúng định dạng; không lấy năm/điểm phần trăm trong văn bản. Bình luận tối đa 2.000 ký tự, không âm thầm cắt đoạn cuối.
- Hàng đợi kiểm duyệt nằm trong MySQL, có claim bằng row lock, lease token, khôi phục lease hết hạn, retry tối đa ba lượt và reconciliation khi insert chưa enqueue. API lỗi/output sai giữ pending rồi chuyển admin, không tự approved hoặc shadowban bằng fallback. Vùng vàng cũng có log. Apply verdict và quyết định admin dùng transaction, kiểm tra revision và tránh ghi đè quyết định đã có.
- Deadline mặc định kiểm duyệt/đối chiếu 15 giây, signal truyền tới fetch và timer được clear. Wrapper không gọi lại chỉ vì gặp lỗi tools bất kỳ. Nhà cung cấp vẫn có thể tính tiền phần đã xử lý trước khi hủy; đây không phải cam kết miễn phí khi timeout.
- Gợi ý truy xuất tối đa tám ứng viên, không đọc toàn catalog rồi gửi 60 truyện. Model trả IDs; server xác thực và dựng tên/card từ DB. Tool ghi thư viện yêu cầu ý định lưu rõ và truyện đang hiển thị. Like được ghi bằng transaction chống trùng khi đồng thời; lời xác nhận lưu được dựng từ kết quả công cụ thật.
- SimHash dùng xếp ứng viên; xét top-k thay vì chỉ một fingerprint, không giới hạn corpus tại 5.000 dòng. Điểm hiển thị là Jaccard cụm năm từ. Không còn gán cố định 15% hoặc coi tỷ lệ bit là % đạo văn. Cờ đỏ cần giống nguyên văn hoặc Hamming ≤3 kèm Jaccard ≥0,8 và bằng chứng. LLM nhận đoạn bằng chứng hoặc đầy đủ văn bản nhỏ, không mặc định 1.000 ký tự đầu.
- Chương mới/sửa nội dung ở trạng thái pending trước khi kiểm tra. Verdict, fingerprint và log lưu bằng transaction kiểm tra content hash. Lỗi kiểm tra giữ pending và tạo log hỗ trợ admin. Log revision cũ thành `superseded`, không giả là admin đã duyệt. Sửa/xóa chương còn kiểm tra chapter thuộc book trong URL.
- Quota IP/user/actual model call dùng MySQL, không bị reset khi đổi `X-Forwarded-For`; proxy chỉ được tin khi cấu hình rõ. Endpoint duplicate giới hạn author/admin và quota riêng. Parser body có giới hạn riêng cho chat/comment/duplicate. Bỏ log tiền tố key.
- Lưu model được yêu cầu/model gateway trả, token input/output/cached/reasoning nếu có, latency, finish reason, lỗi, provider cost và đơn vị. Cost gateway mặc định `unknown`, không suy đoán USD. Thêm tab **Token và chi phí AI** trong dashboard, thống kê 30 ngày; endpoint chỉ admin đọc. Có Langfuse generation và xử lý HTTP lỗi, URL không tồn tại khi thiếu project ID. Gateway model được namespace theo host để tránh áp nhầm biểu phí model chính thức.

## Cấu hình và migration

`AI_MODEL`/key/base hiện có vẫn là giá trị mặc định. Không tự chuyển nhà cung cấp hoặc model trong `.env`. Có thể ghi đè theo tác vụ qua `AI_CHAT_MODEL`, `AI_RECAP_MODEL`, `AI_MODERATION_MODEL`, `AI_PLAGIARISM_MODEL`.

Giới hạn mặc định: 1.000 lượt model/ngày toàn hệ thống, 100/user/ngày; lượt tool tiếp theo cũng được đặt chỗ quota. Quota là giới hạn lần gọi, **không phải trần tiền tuyệt đối** khi chưa xác minh billing/token cap của gateway. Request failures cũng có thể tiêu thụ quota đặt chỗ. Body và chiều dài input được giới hạn độc lập.

Khoảng recap hơn 60.000 ký tự trả thông báo giới hạn, không cắt nguồn rồi gọi đó là bản tóm tắt đủ. Có thể cấu hình `AI_RECAP_MAX_CHARS` tới 85.000; cần đo token và chi phí trước khi tăng. Chưa có map-reduce/cache summary theo từng chương.

Backend khởi động kiểm tra migration AI và mở worker sau khi schema sẵn sàng. Chạy riêng:

```powershell
cd admin-dashboard/server
npm run migrate:ai
```

Schema thêm `conversations.guest_token_hash`, `story_summary_cache.source_hash`, `ai_usage_logs`, `ai_request_quotas`, `ai_moderation_jobs`; cập nhật mặc định chapter và trạng thái log. Migration có thể chạy lại. Trên local đã chạy thành công. Backend đang chạy từ trước cần khởi động lại để nạp mã mới; frontend/mobile cần reload.

## Kiểm tra

- 26 kiểm tra hồi quy Node: đã qua.
- 16 kiểm tra tích hợp MySQL/HTTP: dùng database tạm riêng, provider giả local, không gọi API AI trả phí; kiểm tra migration lặp, quyền SQL, hash cache, quota đồng thời, khóa summary, lease recovery, quyết định admin, like idempotency, HTTP session/role/body/IP và usage. Database tạm được xóa sau mỗi lượt.
- Vite build dashboard: đã qua.
- Kiểm tra cú pháp Node các module sửa: đã qua.
- `npx tsc --noEmit` toàn project: còn ba lỗi tại `src/app/(auth)/register.tsx` về `registerWithFirebase` và chữ ký hàm đăng nhập mạng xã hội. Các lỗi ở phần đăng ký, ngoài nhóm thay đổi AI; chưa sửa trong đợt này.

Tổng hợp kết quả và kiểm tra database sau migration: [fix-validation.json](fix-validation.json). 10 truyện, 291 chương, 5 hội thoại và 14 tin nhắn vẫn giữ nguyên số lượng. Các lượt kiểm tra bản sửa dùng provider giả local; không phát sinh lời gọi AI trả phí.

Chạy hồi quy:

```powershell
node docs/ai-audit/audit-ai.cjs
```

Chạy tích hợp, yêu cầu MySQL local và quyền tạo database tạm:

```powershell
cd admin-dashboard/server
$env:AI_DB_TEST='1'
node --test test/ai-db.test.js
```

`report.md`, `offline-results.json`, `live-results.json`, `production-toxicity-results.json` là chứng cứ **trước khi sửa**. `audit-ai-baseline.cjs` giữ các probes tái hiện hành vi cũ; dùng suite hiện tại để nghiệm thu bản sửa.

## Phần cần làm tiếp bằng dữ liệu và tải thực

Benchmark tiếng Việt đủ lớn, p95, biểu phí/đơn vị gateway và cấu hình Langfuse thật chưa được xác minh. Top-k toàn chương chưa bảo đảm tìm mọi trường hợp chép đoạn nhỏ hoặc diễn đạt lại; cần fingerprints theo đoạn/LSH khi corpus lớn. Tóm tắt theo chương, routing model theo benchmark và guest session riêng cho tiến độ cần đợt triển khai tiếp. Không có cam kết chất lượng hoặc mức giảm hóa đơn khi chưa đo workload thật.
