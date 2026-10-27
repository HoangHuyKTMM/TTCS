# 50 test case gợi ý AI và tối ưu fallback — 2026-10-02

File chạy tự động: `admin-dashboard/server/test/ai-recommendations.test.js`. Mỗi TC là một test độc lập, dùng database và provider giả lập. Provider thật không được gọi; lệnh fetch ngoài mock làm test thất bại.

## Chạy lại

```powershell
cd admin-dashboard/server
npm run test:ai:recommend  # 50 test mới
npm test                 # 82 test backend, gồm kiểm tra hồi quy

# Tùy chọn: MySQL + HTTP với provider giả lập trên localhost.
# Cần cấu hình MySQL trong .env; chỉ tạo/xóa database kiểm thử riêng.
$env:AI_DB_TEST='1'
node --test test/ai-db.test.js
```

## Danh sách nghiệm thu

| TC | Tình huống / dữ liệu | Kết quả cần đạt |
| --- | --- | --- |
| 01 | Không có body | 400; không gọi AI. |
| 02 | Body dạng mảng | 400; không gọi AI. |
| 03 | Message dạng object | 400; không gọi AI. |
| 04 | Message chỉ có khoảng trắng | 400; không gọi AI. |
| 05 | Message dài 2001 ký tự | 413; không gọi AI. |
| 06 | Lịch sử làm body vượt 16000 ký tự | 413; không gọi AI. |
| 07 | Chapter bằng 0 | 400; không gọi AI. |
| 08 | ID hội thoại `../1` | 400; không gọi AI. |
| 09 | JSON chọn `s1` hợp lệ | 200; tên/metadata lấy từ DB; một lượt AI. |
| 10 | ID `s2,s1,s2` | Trả `s2,s1`, giữ thứ tự và bỏ trùng. |
| 11 | AI chọn năm truyện hợp lệ | Trả tối đa bốn truyện. |
| 12 | AI chọn ID bịa | Fallback bằng truyện có thật; không hiện ID bịa. |
| 13 | ID bịa ở vị trí thứ năm | Vẫn phát hiện; không chỉ kiểm tra bốn ID đầu. |
| 14 | ID dạng số | Fallback `ungrounded_output`. |
| 15 | JSON sai cú pháp | Fallback ngay; không retry AI. |
| 16 | JSON có code fence | Đọc được JSON; trả truyện hợp lệ. |
| 17 | `story_ids` rỗng | Fallback; không retry AI. |
| 18 | AI tự thêm tên/câu trả lời ngoài JSON ID | Chỉ hiển thị tên và câu trả lời dựng từ DB. |
| 19 | Truyện bị ẩn sau khi cache | Kiểm tra lại visibility; không trả truyện ẩn; không gọi AI lại. |
| 20 | Tìm kiếm không có kết quả | Lấy tối đa tám ứng viên từ DB. |
| 21 | Tìm kiếm và danh sách ứng viên đều trống | 200, danh sách rỗng; không gọi AI. |
| 22 | Thiếu API key | 200 với fallback `ai_unconfigured`; không gọi mạng. |
| 23 | Timeout khi hỏi truyện trinh thám | Fallback chọn truyện trinh thám trong ứng viên; đúng một lần thử AI. |
| 24 | Provider HTTP 429 | Fallback; đúng một request provider, không retry. |
| 25 | Hết quota model | 200 với fallback; không gọi provider. |
| 26 | Provider trả nội dung rỗng | Fallback `ai_empty_response`; usage log ghi lỗi. |
| 27 | Provider trả `finish_reason=length` | Fallback `ai_truncated`; không dùng kết quả bị cắt. |
| 28 | Tool tìm thêm truyện ngoài ứng viên | Chấp nhận ID có bằng chứng; lọc truyện ẩn khỏi kết quả tool. |
| 29 | Cùng tool tìm kiếm bị gọi lặp | Tái sử dụng kết quả tool; chỉ một lần đọc thêm DB. |
| 30 | Query của tool là object | Không đọc DB thêm; trả `invalid_arguments` cho model. |
| 31 | Một lượt có bốn tool | Fallback `ai_tool_limit` trước khi chạy tool. |
| 32 | Model liên tục yêu cầu tool | Dừng sau ba lượt AI; fallback `ai_tool_limit`. |
| 33 | Cấu hình giới hạn một lượt | Không gọi AI lượt thứ hai. |
| 34 | “Chỉ gợi ý, đừng lưu truyện” | Không cung cấp tool lưu; nếu model vẫn yêu cầu thì từ chối ghi. |
| 35 | Tool lưu lặp, rồi model timeout | Ghi một lần mỗi request, xác nhận ID đã lưu; request lưu tiếp theo không dùng cache. |
| 36 | Cùng câu hỏi và ngữ cảnh lặp lại | Request thứ hai `cached=true`; tổng một lượt AI. |
| 37 | Cùng câu hỏi với khoảng trắng thừa | Tái sử dụng cache. |
| 38 | Câu hỏi thay đổi | Gọi AI mới. |
| 39 | Hai tài khoản | Không dùng chung cache cá nhân. |
| 40 | Hai khách có readerKey khác nhau | Không dùng chung cache khách. |
| 41 | Tiến độ đọc thay đổi | Gọi AI mới. |
| 42 | Lịch sử/ngữ cảnh thay đổi | Gọi AI mới. |
| 43 | Metadata ứng viên thay đổi | Gọi AI mới. |
| 44 | Model thay đổi | Gọi AI mới. |
| 45 | Cache thành công hết TTL | Gọi AI mới, `cached=false`. |
| 46 | Hai mươi request giống nhau đồng thời | Một lượt AI; 19 request dùng chung công việc đang chạy. |
| 47 | Cache lỗi và cooldown hết TTL | Trong TTL không gọi lại; sau TTL thử được và hồi phục. |
| 48 | Đổi câu hỏi trong lúc provider lỗi | 429/503 kích hoạt cooldown; 400 không chặn câu hỏi khác. |
| 49 | Cache giới hạn hai mục | Giữ mục vừa dùng; loại mục ít dùng theo LRU. |
| 50 | Giới hạn một request AI đang chạy và prompt lớn | Request khác fallback `ai_busy`; 240 token/lượt; tối đa tám ứng viên, sáu lượt lịch sử × 600 ký tự, sáu tiến độ. |

## Thay đổi giảm chi phí

| Cơ chế | Trước | Sau (mặc định) |
| --- | --- | --- |
| Số lượt AI tối đa/request gợi ý | 4 | 3; có thể đặt 1–4. |
| Giới hạn output mỗi lượt gợi ý | 700 token | 240; cấu hình tối đa 700. |
| Lặp câu hỏi cùng dữ liệu/ngữ cảnh | Gọi AI lại | Cache 5 phút. |
| Request trùng đồng thời | Gọi AI riêng | Gộp một công việc đang chạy. |
| Provider timeout/network lỗi/429/5xx | Request mới tiếp tục gọi | Cooldown 15 giây theo endpoint/model. |
| Kết quả lỗi/JSON không hợp lệ | Không cache | Cache fallback 15 giây. |
| Thư viện rỗng | Vẫn có thể gọi AI | Bỏ qua model khi DB xác nhận không có ứng viên. |
| Thiếu key/hết quota | Lỗi 500/429 ở luồng gợi ý | 200 với gợi ý từ thư viện; không gọi provider. |
| Tool lặp trong một request | Chạy lại | Dùng lại kết quả, tránh ghi tủ sách trùng. |

Cấu hình nằm trong `.env.example`: `AI_RECOMMEND_MAX_ROUNDS`, `AI_RECOMMEND_MAX_TOKENS`, `AI_RECOMMEND_CACHE_TTL_MS`, `AI_RECOMMEND_CACHE_MAX_ENTRIES`, `AI_RECOMMEND_FAILURE_TTL_MS`, `AI_RECOMMEND_MAX_INFLIGHT`. Không bắt buộc thêm biến vào `.env` để dùng mặc định. Khởi động lại backend để nạp code mới.

Cache tối đa 500 mục/DB/process; tối đa 50 công việc gợi ý đang chạy. Khóa cache gồm người đọc, câu hỏi, model/endpoint, ứng viên, tiến độ và lịch sử đã giới hạn. Mọi kết quả, kể cả fallback/cache, kiểm tra lại truyện đang hiển thị và lấy metadata mới từ DB trước khi trả. Yêu cầu có quyền lưu tủ sách không cache hoặc gộp với request khác. Tin nhắn lưu `cached`, `shared`, `fallback`, `fallback_reason` để kiểm tra sau.

## Kết quả và giới hạn

- 50/50 test mới đạt; toàn bộ 82/82 test backend đạt.
- 26/26 test MySQL/HTTP đạt trên database tạm và provider giả lập localhost.
- Test 46 giảm từ 20 xuống một lượt model trong tình huống giống nhau và cùng ngữ cảnh: ít hơn 95% số lượt gọi ở tình huống này.
- Giới hạn output mặc định giảm từ 700 xuống 240 token/lượt. Đây là giới hạn, không phải số token thực dùng hay mức tiết kiệm tiền đã đo.
- Không phát sinh lời gọi AI trả phí từ kiểm thử.

Cache/cooldown/gộp request có phạm vi một process backend, chưa chia sẻ giữa nhiều instance. Rate limit HTTP và quota model hiện tại vẫn áp dụng; thay đổi trả 200 khi hết quota chỉ dành cho fallback gợi ý. Cache không tái sử dụng khi ngữ cảnh hội thoại thay đổi. Fallback chỉ tìm từ tối đa tám ứng viên DB bằng từ khóa, không thay thế toàn bộ khả năng hiểu yêu cầu tự do của AI. Chưa đo chất lượng model thật với giới hạn 240 token hoặc chi phí tiền thực tế của provider.
