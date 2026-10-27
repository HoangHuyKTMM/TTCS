# AI thật: chất lượng, fallback và chi phí — 02/10/2026

Ngân sách người dùng cho phép: **4.000 VND**. Provider: `api.xah.io`; model cấu hình `ngovutuananh/gpt-5.5-xhigh`. Kiểm thử dùng đăng nhập, HTTP, MySQL và worker thật trên database tạm; gateway chuyển request tới provider thật và giữ response nguyên bản. Bootstrap dữ liệu dùng gateway cục bộ, chỉ bật provider thật khi bắt đầu đánh giá.

Kết quả cuối theo từng ID: **50/50 khớp kỳ vọng**, gồm 25 bình luận và 25 mẫu nội dung truyện. Đây là tổng hợp bằng chứng mới nhất từ các lượt chạy và kiểm tra lại, không phải 50 ca chạy lại trên cùng prompt cuối. `review` chấp nhận vùng vàng hoặc đỏ, đều cần admin xem xét; không buộc model trả một số điểm chính xác.

## Mức độ sử dụng AI thật

- 24 bình luận có điểm từ model thật; 1 quảng cáo cờ bạc bị chặn ngay tại intake, không gọi AI.
- 25 mẫu truyện đều đối chiếu fingerprint/Jaccard thật với chương nguồn trong MySQL. 4 mẫu có thêm nhận xét AI thật; 14 mẫu vùng vàng/đỏ giữ bằng chứng cục bộ khi thiếu nhận xét do timeout hoặc chặn ngân sách. 7 mẫu vùng xanh được xử lý cục bộ.
- Fallback không tự xuất bản nội dung đáng ngờ: vùng vàng/đỏ vẫn giữ chương và đưa admin duyệt. Phân tích model là phần bổ sung cho bằng chứng trùng lặp.
- 50 luồng API đa vai trò và 9 luồng UI chạy riêng với gateway có thể điều khiển để kiểm tra quyền, worker, retry, duyệt, xuất bản và hiển thị; xem [báo cáo toàn luồng](role-flows-2026-10-02.md).

## Chi phí

Endpoint danh sách model trả đơn vị VND, input 960 VND/triệu token, output 1.440 VND/triệu token, phí tối thiểu 37,44 VND/request. Mỗi request thành công trong lượt này có `usage.cost=37.44`; ghi đơn vị VND vào thống kê backend. Các giá trị là cấu hình provider tại thời điểm kiểm thử, không giả định đó là giá chung của model.

| Lượt | Request upstream | Phí đã xác nhận (VND) | Dự phòng timeout (VND) | Bằng chứng |
| --- | ---: | ---: | ---: | --- |
| Probe | 1 | 37,44 | 0 | [JSON](live-integrity-probe-2026-10-02.json) |
| Lượt 1 | 28 | 1.010,88 | 250 | [JSON](live-integrity-first-pass-2026-10-02.json) |
| Lượt 2 | 32 | 973,44 | 1.500 | [JSON](live-integrity-second-pass-2026-10-02.json) |
| Kiểm tra lại | 4 | 112,32 | 75 | [JSON](live-integrity-recheck-2026-10-02.json) |
| Tổng | **65** | **2.134,08** | **1.825** | [Tổng hợp](live-integrity-results-2026-10-02.json) |

57 request có phí trả về; 8 request timeout chưa có thông tin hóa đơn. Tổng đã ghi nhận cộng dự phòng **3.959,08 VND**, còn **40,92 VND** trong ngân sách. Dự phòng là ước tính, chưa chứng minh phí cuối của các timeout. Đã dừng request trả phí; các ca còn lại tiếp tục kiểm tra đối chiếu cục bộ. Không ghi API key, JWT hay header Authorization vào artifact.

Gateway giữ dự phòng trước mỗi request, kiểm tra tiền còn lại trước khi chuyển upstream và chặn khi không đủ. Phí không rõ được giữ trong dự phòng. Retry của worker cũng đi qua kiểm soát này. Các lệnh kiểm thử mặc định không bật provider thật.

## Phát hiện và sửa

1. LC14 công kích người đọc từng nhận điểm vùng xanh. Prompt cũ đặt công kích nhẹ trong khoảng 0,4–0,6, cắt qua ngưỡng công khai/chờ duyệt. Prompt mới phân biệt phê bình nội dung và công kích con người; lượt kiểm tra lại trả 0,65, vùng vàng, chỉ owner thấy trước khi admin duyệt. Những ca còn lại có bằng chứng từ lượt trước, chưa chạy lại toàn bộ với prompt mới.
2. Prompt duplicate cũ khiến model kết luận “đạo văn” và đề xuất hình phạt từ bằng chứng câu chữ. Prompt mới chỉ yêu cầu mô tả điểm giống/khác, nhắc admin xác minh nguồn và quyền sử dụng. LD01 và LD07 sau sửa trả nhận xét theo yêu cầu. Độ tương đồng không chứng minh quyền sở hữu.
3. Thời hạn 15 giây hủy nhiều phản hồi chậm và có thể làm worker retry tốn thêm tiền. Tăng thời hạn moderation/plagiarism lên 25 giây; LD01 trả phản hồi sau 17,126 giây. LD06 vẫn timeout ở 25 giây, chứng minh cần fallback và chưa thể coi provider luôn đáp ứng kịp.
4. Runner cũ đọc trạng thái comment trước khi worker hoàn tất ghi log vùng đỏ. Đọc lại hàng sau khi chờ đã sửa sai lệch báo cáo LC16; đây là lỗi harness, không phải lỗi chất lượng model.

## Chạy lại

Runner: `admin-dashboard/server/scripts/test_ai_live_integrity.js`. Yêu cầu ngân sách mới được cho phép và cấu hình provider sẵn có trong `.env`; kết nối database có quyền tạo/xóa database tạm. Không chạy lại với toàn bộ 4.000 VND của lượt đã chi này.

```powershell
# Thay bằng ngân sách mới đã được cho phép trước khi chạy:
$env:AI_TEST_BUDGET_VND = '<ngân sách mới>'
npm --prefix admin-dashboard/server run test:ai:live
```

`AI_LIVE_CASE_IDS` chọn ID, `AI_LIVE_RESERVE_VND` điều chỉnh dự phòng/request, `AI_LIVE_REPORT_NAME` đặt tên artifact mới. Runner chỉ hỗ trợ provider báo giá VND; thiếu ngân sách hoặc đơn vị giá sai sẽ dừng trước request sinh nội dung. Cấu hình live không được bật trong `npm test`.

## 50 kết quả mới nhất

Các mẫu dùng nội dung tự viết. Cột nguồn phân biệt verdict AI, intake và đối chiếu cục bộ; nhận xét AI của duplicate không quyết định điểm Jaccard. JSON tổng hợp chứa file bằng chứng gốc, score, status, nguồn khớp, latency và thông tin nhận xét cho từng ca.

| ID | Mẫu | Kỳ vọng | Kết quả | Nguồn |
| --- | --- | --- | --- | --- |
| LC01 | Văn minh | green | green | AI |
| LC02 | Phê bình cốt truyện | green | green | AI |
| LC03 | Từ thông thường | green | green | AI |
| LC04 | Trích dẫn bạo lực trong truyện | green | green | AI |
| LC05 | Cảnh buồn | green | green | AI |
| LC06 | Chê nhịp truyện | green | green | AI |
| LC07 | Lịch sự bất đồng | green | green | AI |
| LC08 | Emoji khen | green | green | AI |
| LC09 | Không dấu | green | green | AI |
| LC10 | Tiếng Anh | green | green | AI |
| LC11 | Bàn luận có chữ casino | green | green | AI |
| LC12 | Khen ngắn | green | green | AI |
| LC13 | Bình luận dài văn minh | green | green | AI |
| LC14 | Công kích người đọc | review | yellow | AI |
| LC15 | Xúc phạm trực tiếp | review | yellow | AI |
| LC16 | Chửi tác giả | review | yellow | AI |
| LC17 | Chửi không dấu | review | yellow | AI |
| LC18 | Chửi tách chữ | review | red | AI |
| LC19 | Chửi có emoji | review | yellow | AI |
| LC20 | Đe dọa đánh | red | red | AI |
| LC21 | Đe dọa giết trực tiếp | red | red | AI |
| LC22 | Prompt injection độc hại | red | red | AI |
| LC23 | JSON giả kèm đe dọa | red | red | AI |
| LC24 | Mắng cả cộng đồng | review | yellow | AI |
| LC25 | Intake quảng cáo cờ bạc | intake | intake | Intake |
| LD01 | Nguyên văn | red | red | Jaccard + AI |
| LD02 | Thêm khoảng trắng | red | red | Jaccard + AI |
| LD03 | Unicode NFD | red | red | Jaccard |
| LD04 | Viết hoa | red | red | Jaccard + AI |
| LD05 | Đổi dấu câu | red | red | Jaccard |
| LD06 | Đổi xuống dòng | red | red | Jaccard |
| LD07 | Đổi tên nhân vật | review | red | Jaccard + AI |
| LD08 | Thêm một câu cuối | review | red | Jaccard |
| LD09 | Đổi thứ tự câu | review | yellow | Jaccard |
| LD10 | Sao chép đoạn đầu | review | yellow | Jaccard |
| LD11 | Sao chép đoạn cuối | review | yellow | Jaccard |
| LD12 | Chèn đoạn riêng ở đầu | review | yellow | Jaccard |
| LD13 | Chèn đoạn riêng ở cuối | review | yellow | Jaccard |
| LD14 | Sao chép hai lần | review | red | Jaccard |
| LD15 | Đổi một chi tiết | review | red | Jaccard |
| LD16 | Đổi ngôi kể | review | yellow | Jaccard |
| LD17 | Lược một câu | review | yellow | Jaccard |
| LD18 | Nội dung mới khoa học | green | green | Jaccard |
| LD19 | Nội dung mới nấu ăn | green | green | Jaccard |
| LD20 | Nội dung mới thể thao | green | green | Jaccard |
| LD21 | Nội dung mới âm nhạc | green | green | Jaccard |
| LD22 | Cùng ý tưởng nhưng cách kể khác | green | green | Jaccard |
| LD23 | Nội dung ngắn mới | green | green | Jaccard |
| LD24 | Chỉ có tên nhân vật | green | green | Jaccard |
| LD25 | Tiêu đề khác nhưng nguyên văn | red | red | Jaccard |
