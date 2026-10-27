# Checkpoint Dual-Agent

Nguồn: `docs/nangcapAgent.html`, phần agent trong `docs/prd.html` (PR-16 → PR-19).

Ngày mở: 2026-09-29. Cập nhật đối chiếu: 2026-10-01.

## Cách cập nhật

Khi một mục xong, đổi `- [ ]` thành `- [x]` và ghi **Đã hoàn thành** trên cùng dòng.

Mục nào mới làm một phần thì giữ `- [ ]` và **Chưa hoàn thành**. Không tích mục cha khi còn mục con bỏ trống.

Mục đối chiếu và mục con trong CP-1 → CP-4 trùng nội dung thì tích cả hai chỗ.

## Đặc tả đang áp dụng

Nguồn thảo luận: `docs/nangcapAgent.html`. Phần này là hợp đồng đã chốt cho app. Bản HTML dùng tên bảng và tên cột khác (`stories.id`, `chapter_number`, `user_reading_progress.current_chapter`). App giữ tên đang sống trên MySQL: `story_id`, `chapter_id`, `chapter_no`, `user_id`. Tiến độ đọc là `reading_history.chapter_no`. Không tạo bảng tiến độ thứ hai.

Hai agent dùng chung một MySQL `app_doc_truyen`.

- **Agent 1 — Reading Companion** trả lời trong chat: tóm tắt chương đã đọc, gợi ý truyện, thẻ truyện, lưu tủ sách.
- **Agent 2 — Integrity** lọc bình luận và đối chiếu chương mới. Admin duyệt vùng vàng và vùng đỏ.

Lộ trình gắn với PRD: CP-1 là PR-16 (bảng), CP-2 là PR-17 (tóm tắt), CP-3 và CP-4 là PR-18 (lọc và SimHash), phần Diff Viewer và Langfuse của CP-4 là PR-19.

### Dữ liệu

`story_summary_cache` có khóa duy nhất `(story_id, from_chapter, to_chapter)` và `source_hash` của đầy đủ nội dung, model và phiên bản prompt.

`conversations.user_id` được phép rỗng. Xóa user thì cuộc trò chuyện còn, `user_id` về `NULL`. `messages.sender` là `user` hoặc `assistant`. Mỗi lượt assistant có `trace_id`. `metadata` là JSON.

`chapter_fingerprints.simhash_64` là `BIGINT UNSIGNED`. Giá trị vượt quá số an toàn của JavaScript nên lưu và đọc dưới dạng chuỗi thập phân.

`moderation_logs.target_type` là `comment` hoặc `chapter`. `violation_type` là `toxicity`, `spam`, hoặc `plagiarism`. `status` là `pending_review`, `approved_by_admin`, `penalized_by_admin`, hoặc `superseded` (revision cũ).

`chapters.status` là `draft`, `pending_review`, `published`, `rejected`. Chương mới tạo mặc định `pending_review`; chỉ xuất bản sau khi kiểm tra và lưu bằng chứng thành công.

`comments.status` là `pending`, `approved`, `shadowbanned`, `rejected`. Có `toxicity_score`.

`stories(title, description)` có `FULLTEXT ft_story_search`.

`chapter_recaps` là cache cũ, chatbot không ghi nữa. `plagiarism_checks` không được `schema.sql` tạo cho luồng mới. Bảng nào đã có trên database thì giữ.

### Agent 1 — chat và tóm tắt

`POST /chat` nhận `message`, `book_id`, `chapter_no`, `intent` (`recap` hoặc `recommend`), `history`, `conversation_id`, `conversation_token` (khách).

Cuộc trò chuyện: chưa có `conversation_id` thì tạo một dòng `conversations`. Có rồi thì xác minh chủ sở hữu trước khi đọc tối đa 12 tin trong `messages`. Khách dùng token bí mật ngẫu nhiên 256-bit; database chỉ lưu SHA-256. Hội thoại khách cũ chưa có token phải mở lại. Lịch sử database được dùng cho cả tóm tắt và gợi ý. App gửi lại `conversation_id` ở lượt sau. Mỗi câu của assistant sinh một `trace_id` (UUID) và ghi vào `messages`.

Công cụ mô hình gọi được:

- `get_user_progress`: danh sách `{ story_id, title, chapter_no, genre }` từ `reading_history`, mới đọc trước.
- `search_stories`: `MATCH(title, description) AGAINST (? IN NATURAL LANGUAGE MODE)`, bỏ truyện ẩn, tối đa 20 dòng. `MATCH` lỗi thì mới `LIKE`. `GET /books/search` vẫn `LIKE`.
- `save_to_favorites`: gọi `createLike(user_id, story_id)`. Tab Thư viện hiện truyện vì `liked` đọc cùng bảng `likes`. Chưa đăng nhập thì công cụ trả lỗi cần đăng nhập, không ghi like.

Tóm tắt chỉ dành cho người đã đăng nhập. Không có JWT hợp lệ thì `POST /chat` trả 401 `login_required` trước khi tạo hội thoại, đọc chương hoặc gọi mô hình. Gợi ý truyện vẫn mở cho khách.

Số chương dùng cho tóm tắt không vượt quá chương published đã mở được xác nhận trong `chapter_views`. Client có thể chọn vị trí cũ hơn. Không có vị trí được xác nhận thì yêu cầu mở chương; không lấy chương mới nhất. Chỉ lấy những chương published từng mở bởi user hiện tại.

Cửa sổ tóm tắt, hằng số 10:

- `to = current − 1`. Nếu `to < 1`, trả lời đang ở chương mở đầu, chưa có sự kiện trước, không gọi mô hình và không đọc chương.
- `from = max(1, current − 10)`.
- Đọc chương được phép và tính `source_hash`; cache đúng khoảng và hash thì trả bản đó không gọi mô hình, kể cả bản dài hơn 650 ký tự. Gộp yêu cầu đồng thời và khóa MySQL theo khoảng.
- Chưa có thì chỉ đọc chương `from..to`, prompt có câu `CẤM ĐỀ CẬP tình tiết từ chương {current} trở đi`, rồi ghi một bản cho cả khoảng.

Chip trên chat và trong sheet ghi **Tóm tắt 10 chương trước**. Cửa sổ tính toán vẫn là tối đa 10 chương, kết thúc ở chương hiện tại trừ 1.

Người đọc xin một số chương lớn hơn hoặc bằng chương đang đọc thì từ chối, không đọc chương đó. Xin một chương cũ hơn thì vẫn tóm tắt cả cửa sổ tính từ chương đang đọc, không tóm tắt riêng một chương.

Đã có tin cũ trên server thì câu tóm tắt mở bằng `Tiếp tục cuộc trò chuyện.` Nội dung tình tiết vẫn chỉ lấy từ cache hoặc cửa sổ chương.

`POST /chat` trả `books`. App vẽ thẻ truyện và bấm vào mở trang truyện.

### Agent 1 — nút trên màn đọc

Màn đọc không điều hướng sang trang `/chatbot`. Nút sparkles nổi góc dưới phải. Cuộn xuống quá một ngưỡng nhỏ thì nút ẩn. Cuộn lên quá ngưỡng đó thì nút hiện. Bấm nút mở bottom sheet cao khoảng 50% màn hình. Sheet có hội thoại, ô nhập, và chip **Tóm tắt 10 chương trước**. Chip gọi chat với `bookId` và số chương đang đọc. Trang Khám phá vẫn mở được trang `/chatbot` đầy đủ.

### Agent 2 — bình luận

`POST /books/:id/comments`:

1. Regex chạy trước khi `INSERT`. Khớp thì HTTP 400, `{ error: 'rejected' }`, không ghi dòng. Chỉ chặn URL/quảng cáo cờ bạc có dấu hiệu rõ. Không chặn thảo luận truyện chỉ vì có từ khủng bố, giết chết hay tự sát. Bình luận tối đa 2.000 ký tự.
2. Không khớp thì ghi bình luận `status = pending`, `is_negative = 0`, trả 201 ngay.
3. Worker đọc hàng đợi MySQL có lease, retry và khôi phục sau restart. Request không chờ mô hình. Deadline mặc định 15 giây, AbortSignal truyền tới fetch. Model lỗi/JSON sai thì retry tối đa 3 lượt rồi giữ pending và chuyển admin; không tự duyệt bằng heuristic.

Ngưỡng điểm, mốc 0.5 và 0.8 tính vào vùng vàng:

| Điểm | Vùng | `comments.status` | Ai thấy |
| --- | --- | --- | --- |
| `< 0.5` | xanh | `approved` | mọi người |
| `0.5` đến `0.8` | vàng | `shadowbanned` | chỉ người viết |
| `> 0.8` | đỏ | `pending` | chỉ người viết, cho đến khi admin duyệt |

Vùng đỏ của bình luận ghi `moderation_logs`: `violation_type = toxicity`, `confidence_score` là điểm, `status = pending_review`, có `trace_id`. Vùng vàng và quyết định chưa xác định đều tạo log để admin xem xét.

`GET /books/:id/comments`: khách chỉ nhận `approved`. Người đã đăng nhập còn nhận thêm bình luận của chính họ ở `shadowbanned` và `pending`. App ghi nhãn **Chỉ bạn thấy** hoặc **Đang kiểm duyệt** và hiện nguyên câu. Không còn lớp che rồi bấm để người khác đọc.

### Agent 2 — SimHash khi đăng chương

`POST /books/:id/chapters` tính SimHash 64-bit bằng `BigInt` trên nội dung chương. So với mọi dòng `chapter_fingerprints` trừ chính chương đó.

SimHash dùng để xếp ứng viên gần trùng. Đối chiếu tối đa 8 ứng viên có chương published và truyện không ẩn; không giới hạn kho vân tay ở 5.000 dòng. Điểm hiển thị là Jaccard của cụm 5 từ, không phải phần trăm đạo văn. Vùng đỏ yêu cầu giống nguyên văn hoặc Hamming ≤ 3 đồng thời Jaccard ≥ 0,8 và có bằng chứng; vùng vàng có đoạn cần đối chiếu; không có bằng chứng thì xanh. LLM nhận đoạn bằng chứng, không chỉ 1.000 ký tự đầu.

Chương và bằng chứng được lưu bằng transaction, kiểm tra content hash để tránh duyệt phiên bản cũ. Log cũ được đánh dấu `superseded`. Chương bị lỗi kiểm tra giữ pending và có log để admin xử lý.

### Admin, HITL, Langfuse

Mục **Kiểm duyệt AI** đọc `GET /moderation/logs?status=pending_review`. Mở một dòng thì Diff Viewer hai cột: chương mới đối chiếu chương khớp, hoặc bình luận đối chiếu JSON điểm toxic. Nút duyệt đặt chương `published` hoặc bình luận `approved`, log thành `approved_by_admin`. Nút khóa đặt chương hoặc bình luận `rejected`, log thành `penalized_by_admin`.

Mỗi trace có URL `{LANGFUSE_HOST}/project/{LANGFUSE_PROJECT_ID}/traces/{traceId}`. Host mặc định `https://cloud.langfuse.com`. Không có project ID thì không tạo URL giả. Có generation chứa model, thời gian và token; kiểm tra HTTP ingestion trước khi ghi nhận thành công. Admin nhúng URL đó trong iframe. Gửi batch sang Langfuse chỉ khi có cả `LANGFUSE_PUBLIC_KEY` và `LANGFUSE_SECRET_KEY`. Không có khóa thì vẫn giữ `trace_id` trong MySQL.

## Bảng tổng

- [x] **CP-0.1** — Story card trong chat — **Đã hoàn thành**
- [x] **CP-0.2** — Chặn spoil khi xin chương hiện tại hoặc chương sau — **Đã hoàn thành**
- [x] **CP-1** — Bảng mới và cột trạng thái (PR-16) — **Đã hoàn thành**
- [x] **CP-2** — Tóm tắt cache theo khoảng chương, chống spoil (PR-17) — **Đã hoàn thành**
- [x] **CP-3** — Regex, điểm toxic và shadowban (PR-18) — **Đã hoàn thành**
- [x] **CP-4** — SimHash khi đăng chương, Diff Viewer và Langfuse (PR-18, PR-19) — **Đã hoàn thành**
- [x] **CP-5** — Chat nhiều lượt lưu trên server — **Đã hoàn thành**
- [x] **CP-6** — `get_user_progress` cho mô hình gọi — **Đã hoàn thành**
- [x] **CP-7** — `search_stories` bằng FULLTEXT — **Đã hoàn thành**
- [x] **CP-8** — `save_to_favorites` — **Đã hoàn thành**
- [x] **CP-9** — Nút nổi tự ẩn và bottom sheet — **Đã hoàn thành**

## Đã hoàn thành

- [x] Story card trong chat. `chatbot.tsx` vẽ thẻ truyện từ `books` do `POST /chat` trả về, bấm vào mở trang truyện. — **Đã hoàn thành**
- [x] Chặn spoil khi người đọc xin tóm tắt đúng chương hiện tại hoặc chương sau. `chat_agent.js` từ chối nếu số chương được xin lớn hơn hoặc bằng chương đang đọc. — **Đã hoàn thành**

## Làm một phần

Các mục dưới đây đã khớp đặc tả.

- [x] Chat nhiều lượt. Server ghi `conversations` / `messages`. Lượt assistant có `trace_id`. Lượt sau đọc lịch sử trong database cho cả tóm tắt và gợi ý truyện. App gửi lại `conversation_id`. — **Đã hoàn thành**
- [x] Tóm tắt chương đã đọc. Một bản cho khoảng `max(1, chương hiện tại − 10)` đến `chương hiện tại − 1`, lưu ở `story_summary_cache`. Không ghi từng chương vào `chapter_recaps`. — **Đã hoàn thành**
- [x] Lấy tiến độ đọc. Màn đọc gửi số chương thì số đó được dùng. Nếu không gửi, server lấy `reading_history.chapter_no`. Mô hình gọi được `get_user_progress`. — **Đã hoàn thành**
- [x] Tìm truyện. Agent gọi `search_stories` bằng `MATCH(title, description) AGAINST (... IN NATURAL LANGUAGE MODE)`. `LIKE` chỉ là đường dự phòng khi `MATCH` lỗi. `GET /books/search` giữ nguyên. — **Đã hoàn thành**
- [x] Tủ sách. `save_to_favorites` gọi `createLike`. Tab Thư viện đọc cờ `liked` từ cùng bảng `likes`. — **Đã hoàn thành**
- [x] Nút chat trên màn đọc. Nút sparkles nổi góc dưới, ẩn khi cuộn xuống và hiện khi cuộn lên. Bấm vào mở bottom sheet khoảng nửa màn hình, kèm `bookId` và số chương. Không mở trang `/chatbot`. — **Đã hoàn thành**
- [x] Chip tóm tắt. Chip ghi **Tóm tắt 10 chương trước** và server tóm tắt cửa sổ tối đa 10 chương, kết thúc ở chương hiện tại trừ 1. — **Đã hoàn thành**
- [x] Kiểm duyệt bình luận. Regex chặn quảng cáo cờ bạc rõ ràng trước khi ghi. Bình luận vào hàng `pending`, worker chấm điểm sau request. Dưới 0.5 thì `approved`. 0.5–0.8 thì `shadowbanned`, chỉ người viết thấy. Trên 0.8 thì `pending` và một dòng `moderation_logs`. Màn truyện không còn che rồi bấm để xem. — **Đã hoàn thành**

## Dữ liệu

`chapter_recaps` chỉ còn là cache cũ cho chatbot hiện tại. `plagiarism_checks` không còn được `schema.sql` và `migrate.js` tạo như luồng agent mới. Bảng cũ nếu đã có trên database thì được giữ nguyên.

- [x] Bảng `story_summary_cache` — **Đã hoàn thành**
- [x] Bảng `conversations` và `messages` (kèm `trace_id`) — **Đã hoàn thành**
- [x] Bảng `chapter_fingerprints` — **Đã hoàn thành**
- [x] Bảng `moderation_logs` — **Đã hoàn thành**
- [x] Cột `chapters.status` (`draft` / `pending_review` / `published` / `rejected`) — **Đã hoàn thành**
- [x] Cột `comments.toxicity_score` và trạng thái `shadowbanned` — **Đã hoàn thành**
- [x] Index FULLTEXT trên `stories(title, description)` — **Đã hoàn thành**

## Chưa có — Agent 2 và admin

- [x] Tầng Regex chặn quảng cáo cờ bạc rõ ràng trước khi ghi bình luận — **Đã hoàn thành**
- [x] Worker chấm toxic bất đồng bộ — **Đã hoàn thành**
- [x] Shadowban: điểm 0.5–0.8 chỉ người viết thấy — **Đã hoàn thành**
- [x] SimHash 64-bit khi `POST /books/:id/chapters` — **Đã hoàn thành**
- [x] So Hamming distance, giữ chương nếu khoảng cách bit ≤ 3 — **Đã hoàn thành**
- [x] Ba vùng xanh / vàng / đỏ — **Đã hoàn thành**
- [x] Diff Viewer hai cột trên Admin — **Đã hoàn thành**
- [x] Trace Langfuse và iframe trên Admin — **Đã hoàn thành**

## CP-1 — Bảng mới và cột trạng thái

**Trạng thái:** Đã hoàn thành

Đã áp dụng trên database `app_doc_truyen` bằng `node migrate.js`. Chạy lại không đổi schema lần thứ hai.

- [x] `story_summary_cache` — khóa duy nhất `(story_id, from_chapter, to_chapter)` — **Đã hoàn thành**
- [x] `conversations` và `messages`, cột `messages.trace_id` — **Đã hoàn thành**
- [x] `chapter_fingerprints.simhash_64` — **Đã hoàn thành**
- [x] `moderation_logs` — `target_type`, `violation_type`, `confidence_score`, `trace_id`, `status` — **Đã hoàn thành**
- [x] `FULLTEXT ft_story_search` trên `stories(title, description)` — **Đã hoàn thành**
- [x] `chapters.status`: `draft`, `pending_review`, `published`, `rejected` — **Đã hoàn thành**
- [x] `comments.toxicity_score` và `comments.status` có `shadowbanned` — **Đã hoàn thành**
- [x] `schema.sql` và migration không còn coi `chapter_recaps` / `plagiarism_checks` là luồng agent mới — **Đã hoàn thành**

## CP-2 — Tóm tắt cache theo khoảng chương

**Trạng thái:** Đã hoàn thành

- [x] Từ chối tóm tắt nếu số chương được xin lớn hơn hoặc bằng chương đang đọc — **Đã hoàn thành**
- [x] Cửa sổ tóm tắt là `from = max(1, current − 10)` đến `to = current − 1` — **Đã hoàn thành**
- [x] Chương mở đầu (`to < 1`) trả lời chưa có sự kiện trước, không gọi mô hình — **Đã hoàn thành**
- [x] Đọc cache `story_summary_cache` trước. Có bản ghi thì không gọi mô hình — **Đã hoàn thành**
- [x] Xác minh quyền và content hash từ `chapters` published từng mở trong khoảng `from..to` — **Đã hoàn thành**
- [x] Prompt cấm nhắc tình tiết từ chương hiện tại trở đi — **Đã hoàn thành**
- [x] Ghi ngược một bản tóm tắt cho cả khoảng, không ghi từng chương vào `chapter_recaps` — **Đã hoàn thành**
- [x] Chip trên chat ghi **Tóm tắt 10 chương trước** và gọi đúng cửa sổ trên — **Đã hoàn thành**

## CP-3 — Regex, điểm toxic và shadowban

**Trạng thái:** Đã hoàn thành

- [x] Tầng Regex chặn quảng cáo cờ bạc rõ ràng trước khi ghi, trả `rejected` — **Đã hoàn thành**
- [x] Worker chấm `toxicity_score` sau khi ghi, không chặn request người dùng bằng lần gọi mô hình đồng bộ — **Đã hoàn thành**
- [x] Điểm dưới 0.5: `approved`, hiện công khai — **Đã hoàn thành**
- [x] Điểm 0.5–0.8: `shadowbanned`, chỉ người viết thấy — **Đã hoàn thành**
- [x] Điểm trên 0.8: ghi `moderation_logs` trạng thái `pending_review` (vùng đỏ) — **Đã hoàn thành**
- [x] Màn bình luận bỏ kiểu che rồi bấm để mọi người đọc được comment shadowban — **Đã hoàn thành**

## CP-4 — SimHash, Diff Viewer và Langfuse

**Trạng thái:** Đã hoàn thành

- [x] Khi đăng chương, tính SimHash 64-bit và lưu `chapter_fingerprints` — **Đã hoàn thành**
- [x] So Hamming distance với các vân tay đã có — **Đã hoàn thành**
- [x] Không có bằng chứng đoạn trùng: `chapters.status = published` — **Đã hoàn thành**
- [x] Có đoạn cần đối chiếu: `pending_review` và một dòng `moderation_logs` — **Đã hoàn thành**
- [x] Giống nguyên văn hoặc Hamming ≤ 3 với Jaccard ≥ 0,8 và bằng chứng: giữ pending, vùng đỏ — **Đã hoàn thành**
- [x] Admin có Diff Viewer hai cột cho vùng vàng và vùng đỏ — **Đã hoàn thành**
- [x] Mỗi lượt agent lưu `trace_id`. Admin mở iframe Langfuse theo trace đó — **Đã hoàn thành**

## CP-5 — Chat nhiều lượt lưu trên server

**Trạng thái:** Đã hoàn thành

- [x] Lưu từng lượt vào `conversations` và `messages`, không chỉ gửi tối đa 8 tin từ máy người đọc — **Đã hoàn thành**
- [x] Lịch sử dùng cho cả gợi ý truyện và tóm tắt — **Đã hoàn thành**
- [x] Mỗi lượt assistant có `trace_id` — **Đã hoàn thành**

## CP-6 — `get_user_progress`

**Trạng thái:** Đã hoàn thành

- [x] Mô hình gọi được `get_user_progress` và nhận `reading_history.chapter_no` — **Đã hoàn thành**
- [x] Không phụ thuộc duy nhất vào số chương do client gửi khi người đọc đã có tiến độ — **Đã hoàn thành**

## CP-7 — `search_stories`

**Trạng thái:** Đã hoàn thành

- [x] Index FULLTEXT trên `stories(title, description)` — **Đã hoàn thành**
- [x] Agent gọi `search_stories` bằng full-text, không chỉ `GET /books/search` với `LIKE` — **Đã hoàn thành**

## CP-8 — `save_to_favorites`

**Trạng thái:** Đã hoàn thành

- [x] Agent có công cụ `save_to_favorites` và ghi truyện vào tủ sách — **Đã hoàn thành**
- [x] Tab Thư viện đọc được truyện vừa được agent lưu — **Đã hoàn thành**

## CP-9 — Nút nổi và bottom sheet

**Trạng thái:** Đã hoàn thành

- [x] Icon sparkles trên màn đọc mở chat kèm `bookId` và số chương — **Đã hoàn thành**
- [x] Nút nổi tự ẩn khi cuộn xuống — **Đã hoàn thành**
- [x] Bottom sheet khoảng 50% màn hình, không mở cả trang `/chatbot` — **Đã hoàn thành**
- [x] Chip **Tóm tắt 10 chương trước** nằm trong sheet — **Đã hoàn thành**

## CP-10 — Sửa sau thẩm định AI (2026-10-01)

- [x] Quyền hội thoại user/guest, token guest chỉ lưu hash — **Đã hoàn thành**
- [x] Giới hạn recap bằng chương đã mở và published, 10 chương, đủ nội dung — **Đã hoàn thành**
- [x] Cache theo content/model/prompt hash, gộp request và khóa MySQL — **Đã hoàn thành**
- [x] Fallback tiếng Việt, parser score chặt, không tự duyệt khi AI lỗi — **Đã hoàn thành**
- [x] Hàng đợi MySQL, lease/retry/reconciliation, log vùng vàng — **Đã hoàn thành**
- [x] Deadline có hủy, giới hạn input, quota IP/user/model dùng MySQL — **Đã hoàn thành**
- [x] Gợi ý từ 8 ứng viên và xác thực ID; tool lưu cần ý định rõ — **Đã hoàn thành**
- [x] Đối chiếu top-k, Jaccard cụm 5 từ, transaction kiểm tra phiên bản — **Đã hoàn thành**
- [x] Ghi usage/model thực/cost unit và tab thống kê 30 ngày của admin — **Đã hoàn thành**
- [x] Migration AI riêng chạy thành công trên database local — **Đã hoàn thành**
- [x] 26 kiểm tra hồi quy + 16 kiểm tra MySQL/HTTP, dashboard build và Node syntax — **Đã hoàn thành**
- [ ] Benchmark chất lượng tiếng Việt đủ lớn, p95 và giá/đơn vị gateway thực — **Chưa hoàn thành**
- [ ] Chỉ mục LSH/fingerprint theo đoạn cho kho lớn và sao chép một phần — **Chưa hoàn thành**
- [ ] Cache tóm tắt theo từng chương để tái sử dụng giữa các cửa sổ — **Chưa hoàn thành**
- [ ] Cấu hình tài khoản Langfuse thật và xác minh ingestion/iframe — **Chưa hoàn thành**

Chi tiết triển khai, giới hạn và kiểm tra: [ai-audit/fixes.md](ai-audit/fixes.md). Báo cáo [ai-audit/report.md](ai-audit/report.md) là đánh giá trước khi sửa.

## CP-11 — Kiểm thử chức năng mở rộng (2026-10-02)

- [x] Sửa 3 lỗi TypeScript ở đăng ký và dùng chung social login.
- [x] Xác minh Firebase token ở backend, không đăng nhập giả khi backend từ chối.
- [x] Chặn vượt quyền admin qua header Host/bypass; giới hạn bypass ở development có bật rõ.
- [x] Gộp kết quả công cụ AI, xác nhận thao tác lưu đã thành công khi lượt AI sau lỗi.
- [x] Sửa validation đăng ký/đăng nhập email và tài khoản không có password hash.
- [x] Chặn lấy nội dung qua API danh sách, chặn truyện ẩn và trả 404 cho chương không tồn tại.
- [x] Sửa route/SQL tìm kiếm; giữ quyền xem chương pending cho tác giả.
- [x] 63 kiểm tra tự động; TypeScript, dashboard build, Expo web export và Node syntax đều đạt.
- [ ] Kiểm thử thủ công Android/iOS, OAuth thật và giao dịch/provider thật.

Chi tiết: [ai-audit/function-testing-2026-10-02.md](ai-audit/function-testing-2026-10-02.md).
