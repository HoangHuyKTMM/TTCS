# Báo cáo thẩm định AI Reader App

Ngày kiểm tra: **01/10/2026**. Phạm vi: mã hiện tại trong workspace, gồm cả thay đổi chưa commit. Đây là đánh giá độc lập về khả năng vận hành; không phải xác nhận tất cả mục đã tích trong checkpoint đều đạt chất lượng.

**Bản ghi trước khi sửa.** Các thay đổi sau đánh giá và kết quả nghiệm thu được ghi tại [fixes.md](fixes.md); dữ liệu bên dưới giữ nguyên để đối chiếu trước/sau.

**Kết luận:** Chức năng đủ để trình diễn một trợ lý đọc truyện có công cụ và một pipeline kiểm duyệt. Chưa nên vận hành rộng trước khi sửa quyền truy cập hội thoại, kiểm duyệt dự phòng, ranh giới nội dung đọc và đo chi phí. Nâng model chưa phải ưu tiên đầu tiên.

## 1. Phương pháp và giới hạn

- Đọc backend, truy vấn MySQL, mobile, dashboard và `docs/checkpoint.md`.
- Chạy **20 phép thử cục bộ** bằng dữ liệu giả và phản hồi mô hình được tiêm: 3 hành vi nền hoạt động, 17 tình huống tái hiện hạn chế hoặc lỗi. Các tình huống được chọn có chủ đích để tìm điểm yếu; **không suy ra tỷ lệ chính xác 15% hay tỷ lệ lỗi 85% của toàn hệ thống**.
- Đọc database bằng truy vấn SELECT trực tiếp, không gọi helper có thể tạo bảng hoặc sửa schema.
- Gọi **6 yêu cầu API thật** bằng dữ liệu giả: 4 kiểm tra kết nối/khả năng cơ bản, 2 kiểm tra đúng helper/prompt độc hại đang dùng. Không lưu hội thoại/bình luận mới vào DB. Mẫu quá nhỏ để suy ra p95 hoặc chất lượng tổng thể của model.
- Không sửa code chạy ứng dụng, `.env` hoặc checkpoint. Chỉ thêm bộ chứng cứ đánh giá trong thư mục này. Không chạy lại API khi kiểm tra cú pháp.

Chứng cứ:

- [Probes trước khi sửa](audit-ai-baseline.cjs), [kết quả trước khi sửa](offline-results.json).
- [Snapshot database](db-snapshot.json).
- [Bốn lượt API cơ bản](live-results.json).
- [Hai lượt kiểm duyệt đúng production prompt](production-toxicity-results.json).

Chạy lại phần cục bộ từ thư mục gốc:

```powershell
node docs/ai-audit/audit-ai.cjs
```

Lệnh này hiện chạy suite hồi quy của bản sửa, không gọi mạng hoặc DB. `offline-results.json` được giữ làm chứng cứ trước sửa.

## 2. Các chức năng đã tồn tại và điểm thẩm định

Điểm dưới đây là nhận định kỹ thuật theo bằng chứng triển khai, chưa phải benchmark chất lượng model. Điểm cao yêu cầu đồng thời có chức năng, ràng buộc dữ liệu, xử lý lỗi và chứng cứ kiểm thử.

| Hạng mục | Điểm /10 | Khả năng đã có | Hạn chế quyết định |
|---|---:|---|---|
| Tóm tắt chương đã đọc | 5 | Cửa sổ chương, cache dùng chung, không gọi model ở chương đầu, fallback | Mất phần cuối chương; thiếu ràng buộc tiến độ/quyền; cache bỏ qua bản dài |
| Gợi ý và công cụ | 6 | FULLTEXT, tiến độ, thẻ truyện, lưu like, hội thoại server | Chưa xác thực tên truyện đầu ra; luôn gửi catalog; công cụ ghi chưa có chốt ý định |
| Kiểm duyệt bình luận | 3 | Regex, worker, điểm độc hại, shadowban, admin vùng đỏ | Fallback tiếng Việt sai; timeout sát latency thật; vùng vàng thiếu hàng chờ |
| Phát hiện sao chép chương | 5 | SimHash 64-bit, snippets, phân tích LLM, admin duyệt | Điểm không phải % đạo văn; chỉ chọn một ứng viên; phân tích lấy đầu chương |
| Quyền truy cập và giới hạn | 2 | JWT, admin routes, limit chat theo user/IP | Hội thoại thiếu ownership; tin header IP; endpoint duplicate thiếu quota/role riêng |
| Theo dõi và kiểm soát chi phí | 2 | Có trace UUID và hàm ingestion | Chưa cấu hình Langfuse; không lưu usage/model thực/cost; không có ngân sách token |

Nếu trọng số lần lượt là 25%, 20%, 20%, 15%, 10%, 10%, mức sẵn sàng vận hành theo thang này là **4,2/10**. Điểm đánh giá kiến trúc và ràng buộc hiện tại, không đánh giá công sức phát triển hay mức thông minh của model.

Hai “agent” hiện là workflow chuyên biệt. Trợ lý gợi ý có vòng gọi công cụ tối đa bốn lượt; tóm tắt là nhánh cố định. Integrity là pipeline thuật toán + chấm điểm + hỗ trợ admin. Chưa có truy xuất ngữ nghĩa bằng embedding, bộ nhớ tri thức nhân vật/sự kiện, hoặc tập đánh giá tự động chất lượng tiếng Việt.

## 3. Dữ liệu và kiểm tra API thực tế

DB có 10 truyện, 291 chương, 291 fingerprints, 1 cache tóm tắt, 5 hội thoại, 14 tin nhắn, 0 moderation logs. Có index FULLTEXT `stories(title,description)`. Một bình luận đang shadowban. Những con số này xác nhận cấu trúc và dữ liệu đã tồn tại; chưa chứng minh hàng chờ admin hoạt động tốt ở tải thật.

**234/291 chương dài hơn 1.200 ký tự.** Nếu áp dụng giới hạn 1.200 ký tự cho từng chương của corpus hiện tại, chỉ giữ khoảng **62,94% ký tự gốc**. Đây là tỷ lệ ký tự được giữ, không phải tỷ lệ sự kiện được hiểu. Dấu mốc ở cuối chương bị mất hoàn toàn trong phép thử A05.

Cấu hình đọc từ backend: gateway `https://api.xah.io/v1`, model cấu hình `ngovutuananh/gpt-5.5-xhigh`; phản hồi gateway tự khai model `gpt-5.5-xhigh`. Tên này chưa xác nhận danh tính model phía sau gateway hoặc biểu phí. Không có Langfuse public key, secret key hay project ID trong cấu hình backend kiểm tra.

| Lượt thật | Kết quả | Thời gian quan sát |
|---|---|---:|
| L01, chấm bình luận lành tính với prompt ngắn | `0.0` | 4,61 s |
| L02, chấm câu xúc phạm với prompt ngắn | `0.25` | 10,24 s |
| L03, tóm tắt 3 chương giả | Đúng 3 sự kiện cung cấp, không thêm sự kiện | 18,55 s |
| L04, tìm tiên hiệp | Gọi `search_stories` với query `tiên hiệp` | 4,34 s |
| P01, bình luận lành tính với prompt production | Model `0.02`, helper dùng model | 7,98 s |
| P02, câu xúc phạm với prompt production | Helper fallback `0.78` lúc 8,01 s; model `0.8` về sau | 9,62 s để model xong |

L02 dùng prompt rút gọn nên không dùng để kết luận classifier production sai. So sánh P01/P02 với L01/L02 cho thấy prompt và deadline ảnh hưởng nhiều; cần benchmark cùng prompt trước khi chọn model.

Gateway báo tổng 1.361 prompt tokens và 244 completion tokens, tổng cộng 1.605 tokens cho sáu lượt. Hai lượt yêu cầu `max_tokens=16` nhưng gateway báo 61 và 48 completion tokens. Chưa biết đó là reasoning tokens hay cách thống kê của gateway; **không xem `max_tokens` hiện tại là bảo đảm trần hóa đơn**. Mỗi response có `usage.x_ckey.cost=37.44`, tổng 224.64 đơn vị được báo; chưa xác minh tiền tệ/đơn vị hoặc cách đối soát. Không quy đổi số này sang USD/VND.

## 4. Các vấn đề cần xử lý theo ưu tiên

### P0 — Sửa trước khi mở rộng người dùng

**1. Hội thoại thiếu kiểm tra chủ sở hữu.** `chat_agent.js:486` lấy history từ `conversation_id` client gửi; `mysql.js:listMessages` chỉ lọc ID hội thoại. A08 cho thấy lịch sử của người khác được chuyển vào model. Nếu có `addMessage`, request còn ghi thêm tin vào hội thoại đó. Chưa khai thác trên tài khoản thật.

Cải tiến: truy vấn hội thoại theo cả ID và user ID trước khi đọc/ghi; trả 404/403 khi không sở hữu. Guest dùng định danh phiên không đoán được, không cho ID số đơn lẻ làm quyền truy cập. Áp dụng cùng quyền cho mọi endpoint history tương lai.

**2. Fallback độc hại nhầm từ tiếng Việt thông dụng.** `integrity.js:62` bỏ dấu rồi bắt `cac`, `lon`, `buoi`. Câu “Các nhân vật có bước trưởng thành lớn trong buổi gặp mặt.” nhận **0.92** từ fallback. Khi API lỗi/timeout, bình luận lành tính có thể vào vùng đỏ. Regex còn từ chối cả câu lên án khủng bố (A12).

Cải tiến: tránh bắt từ tục sau khi xóa dấu một cách mù quáng; dùng ngữ cảnh, cụm từ, dữ liệu tiếng Việt có nhãn. Chỉ block tức thì mẫu spam/đe dọa có độ chắc chắn cao. Khi model lỗi và rule chưa chắc, giữ pending có lý do và cho worker retry. Không phạt bằng một score dự phòng chưa được hiệu chỉnh.

**3. Chống spoiler và quyền nội dung chưa thành ràng buộc server.** `handleRecap` ưu tiên `chapter_no` client; thiếu tiến độ thì chọn chương mới nhất. A06: tiến độ server 5, client gửi 100, server lấy 85–99. A07: guest không có tiến độ cũng lấy 85–99. `getChaptersInRange` không lọc `status=published`; nhánh recap không áp dụng điều kiện truy cập chương như endpoint đọc.

Cải tiến: phân biệt vị trí hiện đang mở với giới hạn chương được phép truy cập; đối chiếu tiến độ/entitlement phía server. Không dùng chương mới nhất làm mặc định khi chưa biết người đọc ở đâu. Chỉ truy xuất chương được công bố và được phép đọc, trước vị trí đã xác nhận. Prompt chống spoiler chỉ là lớp bổ sung. Quy tắc ưu tiên client hiện có trong checkpoint là đặc tả đã chọn, nhưng đặc tả đó cần sửa để đáp ứng cam kết chống spoiler.

### P1 — Chất lượng và tiền API

**4. Cache tóm tắt chưa ổn định.** Bản cache dài hơn 650 ký tự bị bỏ qua (`chat_agent.js:281`, A03), dù đã lưu thành công. Hai cache miss đồng thời gọi model hai lần (A04). Cache key không có content hash/prompt version/model; sửa nội dung chương chưa vô hiệu hóa cache. Bản cache thật hiện dài 641 ký tự, vì vậy chưa thấy điều kiện >650 xảy ra trong DB hiện có.

Cải tiến: xác nhận độ dài/chất lượng khi tạo, không lấy độ dài làm lý do gọi lại mọi lần đọc. Thêm content version + prompt version, cơ chế vô hiệu hóa theo khoảng ảnh hưởng; gộp các request cùng khóa đang chạy. Dùng lock theo khóa nếu có nhiều process.

**5. Tóm tắt có thể thiếu sự kiện quan trọng.** Mỗi chương chỉ gửi 1.200 ký tự đầu (`chat_agent.js:297`). Tăng model không thể phục hồi dữ liệu chưa được gửi. Nút “10 chương” lại đọc tối đa 15; đây là lựa chọn được ghi rõ trong checkpoint, nhưng nhãn UI chưa khớp hành vi. History recap chỉ thay lời dẫn “Tiếp tục cuộc trò chuyện”, không tham gia phân tích câu hỏi tiếp theo.

Cải tiến: tóm tắt đầy đủ một lần theo content hash khi xuất bản/có nhu cầu; lưu sự kiện, nhân vật, chương nguồn. Ghép tóm tắt chương để tạo recap theo vị trí đọc. Chuẩn hóa cửa sổ 10 hoặc đổi nhãn 15. Câu hỏi về nhân vật cần một nhánh hỏi đáp truy xuất các chương được phép đọc, không chỉ trả lại recap chung.

**6. Timeout không hủy yêu cầu model.** `scoreToxicity` race 8 s, `aiAnalyzePlagiarism` race 10 s, còn fetch chung có timeout 25 s. P02 chứng minh model chạy tiếp sau khi helper đã fallback. Timer của race cũng không được clear khi model xong trước.

Cải tiến: truyền AbortSignal/deadline xuyên suốt, clear timer trong finally, ghi `fallback_reason`. Hủy ở client không bảo đảm provider ngừng tính tiền; phải đối soát. Với worker nền, đặt deadline theo số đo thật và lưu pending thay vì buộc fallback sai lúc 8 s. Không tự động retry mọi lỗi vì có thể nhân chi phí.

**7. Chấm độc hại thiếu schema chặt.** Parser lấy số đầu tiên bất kỳ; “Năm 2026, điểm độc hại là 0.1” bị đọc thành 1 (A14). Chỉ gửi 2.000 ký tự đầu (A15). Vùng vàng chỉ shadowban, không tạo log để panel hàng chờ xem xét (A16). Queue nằm trong RAM, chạy tuần tự, không khôi phục sau restart; nếu mỗi job 8 s thì một process chỉ hoàn tất khoảng 7,5 job/phút ở nhịp đó.

Cải tiến: JSON schema `{score, categories, reason}`, score hữu hạn trong [0,1], reject output sai. Giới hạn chiều dài bình luận hợp lý từ request thay vì lưu phần không được kiểm duyệt. Queue bền vững bằng bảng jobs MySQL trước khi cần thêm Redis; có attempt, lease, idempotency, retry và reconciliation pending. Tạo log vùng vàng, lưu nguồn quyết định rule/model/fallback và phiên bản nội dung. Ngưỡng score phải hiệu chỉnh theo tập dữ liệu; không gọi score là xác suất đúng đã được chứng minh.

**8. SimHash bị diễn giải quá mức.** `1 - distance/64` là mức khớp bit, không phải phần trăm câu chữ sao chép hoặc bằng chứng kết luận bản quyền. Với 38.070 cặp chương khác truyện hiện có, **37.164 cặp (97,62%)** rơi vào raw-yellow trước bước snippets; không phải tỷ lệ chương bị chặn, vì code có bước hạ vùng vàng khi không có snippets. Khi hạ vùng, code gán similarity 15% tùy ý (A18). Vùng đỏ không có bước xác thực snippets tương tự.

Cải tiến: dùng SimHash để tìm ứng viên gần trùng; hiệu chỉnh Hamming bằng dữ liệu có nhãn, không đặt ngay một ngưỡng từ paper cho tiếng Việt. Tính tỷ lệ đoạn trùng bằng shingles/Jaccard hoặc coverage để hiển thị, ghi rõ metric và giới hạn. Lấy top-k ứng viên, so sánh các đoạn bằng chứng, để admin quyết định. [Nghiên cứu gốc về phát hiện near-duplicate](https://research.google/pubs/detecting-near-duplicates-for-web-crawling/) cung cấp cơ sở cho fingerprinting, không chứng nhận % đạo văn theo phép tính hiện tại.

**9. So khớp chương thiếu độ bao phủ.** `listChapterFingerprints` LIMIT 5000, không ORDER BY; kho lớn hơn có thể bị bỏ sót. Chỉ đối chiếu best global hash, dễ bỏ qua phần chép từ ứng viên khác. LLM chỉ nhìn 1.000 ký tự đầu mỗi bên (A19); output LLM là văn bản hỗ trợ, chưa thay đổi zone thuật toán. Chương được lưu trước khi review; lỗi review bị catch và response vẫn thành công. Chương mặc định published tạo khoảng thời gian có thể đọc trước kết quả và nguy cơ bỏ qua kiểm duyệt khi lỗi.

Cải tiến: ban đầu pending, publish sau verdict; xử lý trạng thái và log bằng transaction phù hợp. Index ứng viên/LSH cho corpus lớn, fingerprints theo đoạn thay vì chỉ toàn chương. Chỉ gửi các đoạn thực sự trùng và ngữ cảnh cần thiết cho LLM, cache verdict theo hai content hash và prompt version.

**10. Gợi ý và công cụ chưa kiểm soát đầu ra.** Luôn đọc catalog rồi gửi 60 truyện đầu ngay cả khi có search tool; history tối đa 12 tin, mỗi tin 800 ký tự; mỗi lượt tool gửi lại context. A10: tên truyện không tồn tại vẫn được trả cho UI. A11: nếu model yêu cầu `save_to_favorites`, server ghi like dù người dùng chỉ hỏi gợi ý. Catalog khởi đầu không có ID; dùng ID từ kết quả search là đáng tin cậy hơn. Tiến độ có thể truy vấn cả trong code và tool.

Cải tiến: truy xuất 5–8 ứng viên theo query/sở thích trước khi sinh đáp án. Trả JSON chứa story IDs, server xác thực và dựng card. Chỉ bật công cụ ghi sau ý định lưu rõ ràng trong yêu cầu người dùng; xác thực story tồn tại, được hiển thị và không tạo like lặp. Cache progress trong một request, giới hạn số tool calls và tổng token; chặn prompt injection bằng ranh giới dữ liệu + kiểm tra server, không chỉ thêm câu vào system prompt.

**11. Quota chưa bao phủ chi phí.** `/chat` có 30 request/15 phút theo user/IP, nhưng lấy trực tiếp header `x-forwarded-for`. Người gọi guest có thể đổi header để đổi khóa limit. `check-duplicate` có auth nhưng chưa kiểm tra vai trò author/admin hoặc quota AI; trả snippets từ chapter lookup không lọc quyền nội dung. Body toàn server tới 20 MB, message chat chưa có giới hạn riêng.

Cải tiến: thiết lập proxy tin cậy và lấy IP từ Express đã xác thực đường proxy; dùng quota user + IP + token + trần tiền/ngày. Rate limit cả comment/duplicate. Giới hạn body/input riêng từng route, số requests đang chạy, role và quyền xem nguồn snippets. Lưu counter dùng chung khi nhiều process; dọn key hết hạn.

**12. Chưa có số đo tiền/latency thực dụng.** `chatCompletion` bỏ `usage`, model trả thực và finish reason. `recordTrace` chỉ tạo trace, không có generation/span/token/cost; HTTP 401 vẫn báo `stored:true` (A20). UUID trong DB và iframe không đủ để có waterfall hay đo chi phí. `index.js:15` còn log tiền tố API key; nên bỏ.

Cải tiến: trả metadata usage từ wrapper; mỗi lời gọi ghi provider/model thực, input/output/cached/reasoning tokens nếu có, elapsed, finish reason, status, intent, cache hit, fallback, tool round. Ghi generation và spans SQL/cache/tool. Check `res.ok` và lỗi ingestion. Với gateway, ingest cost theo đơn vị đã đối soát; không để hệ thống tự đoán giá từ alias. Có thể bắt đầu bằng một bảng `ai_usage_logs` và dashboard SQL trước khi cấu hình Langfuse. [Tài liệu token/cost của Langfuse](https://langfuse.com/docs/observability/features/token-and-cost-tracking) mô tả usage/cost gắn với generation/embedding và cách ingest chi phí.

## 5. Phương án giảm chi phí theo thứ tự hiệu quả

| Thứ tự | Thay đổi | Vì sao có lợi | Điều kiện kiểm chứng |
|---:|---|---|---|
| 1 | Sửa cache >650 và gộp cùng khóa | Tránh tính lại cùng nội dung | Model calls/cache key, hit rate, refresh reason |
| 2 | Sửa deadline/cancellation, retry có chọn lọc | Tránh kết quả AI bị bỏ phí | Timeout rate, late completions, provider charges |
| 3 | Truy xuất ứng viên trước khi chat | Bớt catalog và context lặp | Input tokens/request, tỷ lệ gợi ý phù hợp |
| 4 | Rule chắc chắn + model nhẹ cho kiểm duyệt | Giảm gọi LLM cho tác vụ phân loại ngắn | False-positive/false-negative theo nhãn tiếng Việt |
| 5 | Cache tóm tắt đầy đủ theo chương/version | Chia sẻ giữa người đọc, dùng lại khi cửa sổ dịch chuyển | Tổng chi phí tạo và ghép/1.000 recap, chất lượng sự kiện |
| 6 | Chỉ LLM cho cặp nghi vấn có bằng chứng | Giảm so sánh vô ích và context | Số cặp nghi vấn, call rate, độ chính xác admin |
| 7 | Router model theo tác vụ | Dành model mạnh cho trường hợp khó | Benchmark cùng prompt, latency và cost/task |
| 8 | Batch việc nền phù hợp | Không cần phản hồi tức thời cho backfill | Giá thật của provider, thời hạn hoàn tất |

Các rule chi phí 0 token vẫn có chi phí CPU/DB. Sửa fallback tiếng Việt trước khi dùng rule để cắt giảm LLM. Không tự triển khai một model lớn chỉ để tiết kiệm: chưa có lưu lượng, giá GPU và số đo chất lượng để chứng minh điểm hòa vốn.

Cache theo chương cũng không tự động rẻ: tạo trước cho mọi truyện ít người đọc có thể tốn hơn tóm tắt theo nhu cầu. Với dữ liệu hiện tại nhỏ, nên tạo khi có người dùng cần, lưu theo hash, chỉ precompute truyện đang có lượt đọc. Đo riêng chi phí tạo chapter summaries và chi phí ghép/tra cứu.

Tách cấu hình dự kiến: `AI_CHAT_MODEL`, `AI_RECAP_MODEL`, `AI_MODERATION_MODEL`, `AI_PLAGIARISM_MODEL`. Chọn model bằng tập đánh giá, không dựa trên hậu tố tên. Chỉ giảm reasoning nếu backend thực sự hỗ trợ và chất lượng đo được vẫn đạt.

### Cách tính và ví dụ minh họa

Nếu provider thu theo token:

```text
Tiền = input_uncached / 1.000.000 × giá_input
     + input_cached / 1.000.000 × giá_cached
     + output_billable / 1.000.000 × giá_output
     + phí tool/khác nếu có
```

Tách cached khỏi uncached để tránh đếm hai lần; reasoning tính theo chính sách provider. Giá gateway hiện chưa có biểu phí xác thực, nên chưa thể đưa hóa đơn USD thực của project.

**Ví dụ nếu dùng trực tiếp xAI**, context ngắn, 10.000 recap/tháng, mỗi cache miss 6.000 input + 300 output tokens, không dùng provider token cache:

| Kịch bản giả định | Grok 4.5 | Grok 4.3 |
|---|---:|---:|
| Giá input /1M | $2,00 | $1,25 |
| Giá output /1M | $6,00 | $2,50 |
| Mỗi recap miss | $0,0138 | $0,00825 |
| 10.000 lượt, không cache ứng dụng | $138,00 | $82,50 |
| 10.000 lượt, 80% cache hit ứng dụng | $27,60 | $16,50 |

Giá từ [xAI Grok 4.5](https://docs.x.ai/developers/models/grok-4.5) và [xAI Grok 4.3](https://docs.x.ai/developers/models/grok-4.3), kiểm tra ngày 01/10/2026. Bảng là phép tính minh họa, không dự báo hóa đơn gateway. Giả định token, lưu lượng và hit rate chưa được đo trong app. Chi phí server, cache invalidation, retries và các tác vụ khác chưa nằm trong bảng. Không thể hứa giảm 80% thực tế trước khi có hit rate.

Nếu gateway tính theo request/credit cố định, giảm context chưa chắc giảm số tiền từng lượt. Chứng cứ hiện có: sáu lượt có số token khác nhau nhưng cùng `x_ckey.cost=37.44`; đây chỉ là dấu hiệu cần đối soát, chưa chứng minh biểu phí cố định. Khi đó tối ưu **số lần gọi, cache, tool round và timeout** có thể quan trọng hơn rút ngắn prompt.

## 6. Lộ trình thực hiện và điều kiện nghiệm thu

**Đợt 1 — quyền và quyết định sai:** chặn hội thoại khác chủ; sửa fallback và parser; xác thực ranh giới chương; chặn đọc pending/ẩn trái quyền; quota duplicate; bỏ log key. Bổ sung kiểm tra các trạng thái lỗi, không tự publish khi review thất bại. Chạy lại probes tương ứng với kết quả mong muốn mới.

**Đợt 2 — chi phí có số đo:** sửa cache length, version và gộp request; deadline truyền xuống fetch; lưu usage/cost/finish reason; đối soát gateway; thêm ngân sách và cảnh báo. So sánh chi phí theo tác vụ trước/sau trên cùng workload.

**Đợt 3 — cải thiện nội dung:** truy xuất ứng viên trước chat; output IDs có xác thực; tóm tắt đủ dữ liệu; top-k và fingerprints đoạn; hàng chờ bền vững; hỗ trợ admin vùng vàng. Cập nhật checkpoint để “đã có code” và “đã nghiệm thu chất lượng” là hai trạng thái rõ ràng.

Tập nghiệm thu đề xuất, không phải chỉ số đã đạt:

- 200–300 bình luận có nhãn: câu thông thường với các/lớn/buổi, khen/chê, xúc phạm, trích truyện bạo lực, spam/link, viết né dấu, prompt injection, và API lỗi. Có hai người gán nhãn cho nhóm dễ tranh luận. Đo confusion matrix, false-positive bình luận lành tính, recall nhóm nghiêm trọng, tỷ lệ fallback.
- 30–50 khoảng truyện: mỗi khoảng có sự kiện đầu/giữa/cuối và chương nguồn; đo độ đúng sự kiện, coverage, hallucination, spoiler và chất lượng khi sửa chương. Người chấm kiểm tra nguồn, không chỉ để một LLM chấm LLM khác.
- 50 câu gợi ý: thể loại, phủ định, truyện ngoài catalog, câu hỏi tiếp nối, yêu cầu lưu/không lưu. Mục tiêu bắt buộc: không trả ID không tồn tại, không ghi like ngoài ý định.
- Các cặp sao chép nguyên văn, sửa nhẹ, chép đoạn cuối, diễn đạt lại, cùng mô típ, cùng đoạn mở đầu mẫu. Đo theo từng kiểu; không đánh đồng cùng mô típ với sao chép.
- Kiểm tra guest/user khác nhau, hội thoại ngoại chủ, chương pending/rejected/ẩn, header IP giả, queue restart, provider 429/5xx/timeout, cache đồng thời.
- Latency p50/p95 và chi phí/1.000 tác vụ phải đo ở nhiều thời điểm. Chốt SLO với workload thật; không suy ra p95 từ sáu lượt kiểm tra này.

Với quy mô hiện tại, ưu tiên MySQL jobs + cache đúng + retrieval FULLTEXT + model routing. Chưa cần thêm vector database hoặc framework agent phức tạp trước khi các lỗi trên được sửa và chất lượng có số đo.
