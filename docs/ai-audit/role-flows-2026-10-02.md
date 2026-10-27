# Kiểm thử toàn luồng AI với nhiều vai trò — 02/10/2026

Phạm vi: đăng ký/đăng nhập, phân quyền, bình luận → hàng đợi → worker AI → admin duyệt → người đọc; tác giả đăng/sửa/nhập chương → đối chiếu trùng lặp → duyệt → xuất bản/đọc. Có **50 kịch bản HTTP/MySQL** và **9 kịch bản trình duyệt** bổ sung cho [50 testcase kiểm thử thuật toán](integrity-testcases-2026-10-02.md).

Suite quyền/trạng thái dùng HTTP, JWT do API đăng nhập cấp, MySQL và worker chạy thật; gateway AI cục bộ giúp tái hiện lỗi dịch vụ và độ trễ. Đã chạy riêng **50 mẫu dữ liệu với provider thật và fallback**, trong ngân sách người dùng cho phép **4.000 VND**. Báo cáo phân biệt rõ kết quả model, intake và đối chiếu cục bộ, không dùng kết quả giả lập để đánh giá chất lượng AI.

## Tài khoản và dữ liệu

Mỗi lượt tạo database `reader_roles_test_<12 ký tự hex>` riêng. Không ghi tài khoản/truyện/bình luận vào database đang dùng của ứng dụng. Khi chạy xong, backend con và trình duyệt được đóng, database tạm được xóa.

| Tài khoản | Role backend | Mục đích |
| --- | --- | --- |
| Khách | Không có JWT | Quyền đọc công khai; chặn ghi và API admin |
| `readerA@roles.test.invalid` | `user` | Người gửi bình luận |
| `readerB@roles.test.invalid` | `user` | Độc giả khác, kiểm tra nội dung riêng tư |
| `vip@roles.test.invalid` | `vip` | VIP còn hạn 30 ngày; vẫn không có quyền tác giả/admin |
| `authorA@roles.test.invalid` | `author` | Tác giả truyện nguồn |
| `authorB@roles.test.invalid` | `author` | Tác giả khác, đăng nội dung cần đối chiếu |
| `admin@roles.test.invalid` | `admin` | Duyệt/khóa, xem diff, thống kê và quản lý tài khoản |
| `revoked@roles.test.invalid` | Ban đầu `author` | Thu hồi quyền khi JWT chưa hết hạn |
| `deleted@roles.test.invalid` | Ban đầu `author` | Xóa tài khoản rồi dùng lại JWT |

Email được chuyển thành chữ thường khi đăng ký. Mật khẩu chung **chỉ trong sandbox**: `RoleFixture-2026!`. RF16 còn tạo một admin phụ rồi xóa trực tiếp trong database tạm để kiểm tra token admin đã mất tài khoản không đọc được chương bị giữ.

Tất cả tài khoản đăng ký và đăng nhập qua API thật. Chỉ admin đầu tiên được cấp role bằng SQL để bootstrap; các role còn lại được admin cấp qua API. VIP được cấp thời hạn qua API admin. Không giả chữ ký JWT. Hai tác giả có user ID và author profile ID riêng.

Truyện nguồn “Lá thư bên bờ sông” và các đoạn truyện đều là dữ liệu tự viết cho test. Gateway cục bộ trả score `0.1`, `0.7`, `0.95` cho ba bình luận fixture; có chế độ trả HTTP 503 và trả chậm 6 giây. Worker không bị tắt và việc thử lại sau lỗi provider sử dụng hàng đợi MySQL thật.

## Chạy lại

Từ thư mục gốc, với MySQL hoạt động và cấu hình kết nối trong `admin-dashboard/server/.env`:

```powershell
npm --prefix admin-dashboard/server run test:ai:roles
```

Lệnh này bật suite tích hợp trên Windows/Linux, tạo dữ liệu mới và tự dọn sau khi chạy. Tài khoản database cần quyền tạo/xóa database tạm. Nếu thiếu MySQL hoặc quyền kết nối, suite sẽ báo lỗi; không tự chuyển sang database chính hay fake DB.

Để tự thao tác bằng tài khoản test và giữ sandbox hoạt động:

```powershell
npm --prefix admin-dashboard/server run test:ai:roles:sandbox
```

Terminal in URL API và bảng tài khoản. Dừng bằng Ctrl+C để dọn database. Để mở app với API đó, đặt `EXPO_PUBLIC_API_BASE` bằng URL được in rồi chạy Expo trên cổng riêng. Với dashboard, đặt `VITE_API_BASE` và dùng `login.html?api=<URL sandbox>`; trang đăng nhập HTML lấy API từ query `api`. Không nhập tài khoản sandbox vào backend chính vì tài khoản chỉ tồn tại trong database tạm.

Kiểm thử trình duyệt cần Expo web ở cổng 8081, dashboard Vite ở 5173 và Playwright/Chromium đã cài:

```powershell
# Nếu Chromium không nằm ở vị trí mặc định của Playwright:
$env:ROLE_CHROMIUM_PATH = 'C:/Users/Admin/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
npm --prefix admin-dashboard/server run test:ai:roles:web
```

Có thể đổi `ROLE_APP_URL`, `ROLE_ADMIN_URL`, `PLAYWRIGHT_MODULE`, `ROLE_CHROMIUM_PATH`. Runner dùng Playwright trong project, hoặc bản đã có tại `.test-artifacts/visual-tools/node_modules/playwright`. API của giao diện được chuyển đến backend sandbox; phản hồi là kết quả thật của backend, không dựng JSON giả cho UI. Đăng nhập, nhập bình luận, đăng chương và duyệt đều thao tác qua form/nút trên trang. Quảng cáo được đóng bằng nút X bình thường.

Ảnh và kết quả UI lưu ở `.test-artifacts/ai-roles-ui/`. Cần chạy lại sau khi đổi mã nguồn; kết quả cũ không thay thế lượt kiểm thử mới.

## 50 kịch bản HTTP/MySQL

Mỗi RF là một scenario tự động, có thể chứa nhiều assertion/endpoints. Ví dụ RF06–RF11 kiểm tra danh sách, chi tiết, quyết định, trace, thống kê, bình luận admin và quản lý user cho từng vai trò.

| ID | Vai trò / thao tác | Kết quả cần đạt |
| --- | --- | --- |
| RF01 | 8 tài khoản đăng nhập; khách và mỗi user gọi `/me` | ID/role đúng, khác nhau; khách 401 |
| RF02 | Đăng ký lại email, gửi role admin khi đăng ký | Không tạo email trùng; registration luôn là user |
| RF03 | Mật khẩu sai; JWT sai định dạng | Không cấp phiên/quyền admin |
| RF04 | Khách tạo/sửa truyện với header dev và Host giả qua HTTP thô | 401, không bypass auth |
| RF05 | Khách upload multipart; reader upload cover JSON | 401/403 trước khi nhận hoặc ghi file |
| RF06 | Khách đọc/ghi các API admin | 401 |
| RF07 | Reader A đọc/ghi các API admin | 403 |
| RF08 | Reader B đọc/ghi các API admin | 403 |
| RF09 | VIP đọc/ghi các API admin | 403 |
| RF10 | Author A đọc/ghi các API admin | 403 |
| RF11 | Author B đọc/ghi các API admin | 403 |
| RF12 | Reader/VIP tạo, import, sửa chương, quét duplicate | 403 |
| RF13 | Author B thêm/sửa/xóa chương truyện A | 403, không đổi nguồn |
| RF14 | Author profile ID của A trùng user ID của B | Không suy ra quyền sở hữu từ hai ID cùng số |
| RF15 | Hạ role author thành user, giữ JWT cũ | Quyền mới có hiệu lực ngay |
| RF16 | Xóa author/admin rồi dùng JWT cũ | API bảo vệ 401; chương giữ vẫn bị chặn |
| RF17 | Khách bình luận/xóa bình luận | 401 |
| RF18 | Bình luận văn minh → worker → feed | Pending rồi approved; mọi độc giả thấy |
| RF19 | Bình luận vùng vàng → riêng tư → admin duyệt | Chỉ chủ thấy trước duyệt; công khai sau duyệt; ghi reviewer và đóng log |
| RF20 | Bình luận vùng đỏ → admin khóa | Pending chờ admin; không công khai; rejected sau quyết định |
| RF21 | VIP/author A/author B/admin cùng bình luận | Đều qua worker, không tự miễn kiểm duyệt |
| RF22 | Bình luận trắng/object/>2.000 ký tự | 400/413, không chèn dữ liệu lỗi |
| RF23 | Quảng cáo cờ bạc rõ ràng | 400 `rejected` ngay intake |
| RF24 | Bình luận/đọc bình luận truyện không tồn tại | 404 thay vì 500/danh sách rỗng |
| RF25 | Truyện đã ẩn: mở metadata/đọc/ghi bình luận | 404 |
| RF26 | Trả lời bình luận approved cùng truyện | Parent đúng, reply qua worker và công khai |
| RF27 | Reply parent ở truyện khác hoặc không tồn tại | 400 `invalid_parent` |
| RF28 | Reader B trả lời parent riêng tư của A | 400, không gắn reply vào nội dung bị ẩn |
| RF29 | Reader xóa của người khác/của mình | 403/200; hàng đợi không phục hồi comment đã xóa |
| RF30 | Admin tắt comment approved | Không hiện ở feed khách hoặc chủ |
| RF31 | Admin lọc `status=shadowbanned` | Chỉ trả đúng status dù `includeAll` |
| RF32 | Admin approve qua endpoint bình luận trực tiếp | Log AI đóng; quyết định log cũ trả 409 |
| RF33 | Admin reject trực tiếp; reject ID thiếu kèm reason | Log đóng; ID thiếu trả 404 |
| RF34 | Admin gửi status/content/enabled sai kiểu | 400; dữ liệu cũ giữ nguyên |
| RF35 | Admin sửa bình luận vùng vàng thành văn minh | Về pending, enqueue phiên bản mới, supersede log cũ rồi approved |
| RF36 | Provider 503 rồi hồi phục | Pending riêng tư, retry bền vững rồi approved |
| RF37 | Author B đăng nội dung khác nguồn | Published; danh sách công khai không lộ full text |
| RF38 | Author B preview bản sao nguyên văn | Vùng đỏ, đúng nguồn, 100% Jaccard và snippet |
| RF39 | Author B gửi chapterId nguồn A để loại trừ | 403; không né đối chiếu bằng ID người khác |
| RF40 | Đăng chương sao chép | Pending; khách/reader/VIP/tác giả khác bị 403; owner/admin đọc được |
| RF41 | Admin mở diff, duyệt chương | Reader mở được; duyệt lại log cũ 409 |
| RF42 | Admin khóa chương | Reader bị chặn; owner thấy trạng thái rejected |
| RF43 | Viết lại chương bằng nội dung mới | Published; bằng chứng cũ superseded, không còn pending log |
| RF44 | Sửa chương published thành bản sao | Trở lại pending; reader mất quyền đọc nội dung |
| RF45 | Chỉ đổi tiêu đề chương bị giữ | Nội dung/trạng thái moderation giữ nguyên |
| RF46 | Gửi lại nội dung chương gốc với ID chính nó | Không tự so với chính mình; fixture cô lập các bản sao đã được duyệt |
| RF47 | Import text có marker Chương 1, chứa bản sao | Qua cùng pipeline; pending và log; reader không đọc được |
| RF48 | Duplicate object; chương >80.000 ký tự | 400/413 |
| RF49 | Hai quyết định approve/reject đồng thời | Một 200, một 409; trạng thái và queue nhất quán |
| RF50 | Admin xem usage, reader thử xem | Có call/usage thật từ gateway test; reader 403 |

## 9 kịch bản trình duyệt

| ID | Luồng thao tác |
| --- | --- |
| UI01 | Reader đăng nhập, gửi bình luận; worker duyệt; reader khác thấy |
| UI02 | Owner gửi bình luận vùng vàng; owner thấy, reader khác không thấy |
| UI03 | Admin mở chi tiết và khóa bình luận; HTTP phải 200 và DB phải rejected |
| UI04 | Author đăng nhập, mở truyện của mình, nhập/đăng chương trùng; UI hiện Chờ duyệt AI |
| UI05 | Admin duyệt chương; reader mở đúng chương và thấy văn bản đã xuất bản |
| UI06 | VIP và khách mở truyện nguồn đã published |
| UI07 | Log bị admin khác xử lý trước; nút duyệt trả 409 và UI báo thất bại |
| UI08 | Thu hồi role author lúc editor mở; lưu trả 403, báo lỗi và giữ bản nháp |
| UI09 | Provider mất 6 giây; owner tự chuyển badge sang Chờ quản trị viên duyệt, không reload |

## Lỗi được sửa

- Phân quyền tạo truyện/upload được đưa về middleware chung, trước khi ghi cover. Bỏ fallback so user ID với author profile ID; tài khoản đã xóa không dùng tiếp role trong JWT. API đọc tùy chọn cũng lấy role hiện tại trong database.
- Kiểm tra truyện tồn tại/còn hiển thị và parent cùng truyện, được phép trả lời trước khi tạo comment. Chặn feed của truyện ẩn và comment `enabled=false`.
- Sửa bộ lọc status trong danh sách admin và validation dữ liệu update/reject. Reject ID không tồn tại với reason trả 404.
- Đổi bình luận và đóng/supersede log/enqueue phiên bản mới trong cùng transaction. Quyết định trực tiếp và queue AI nhất quán; log cũ không đảo được quyết định. Quyết định qua queue ghi người/thời điểm duyệt bình luận.
- Duplicate preview kiểm tra quyền sở hữu chapter được yêu cầu loại trừ; dữ liệu sai không tiêu quota quét hợp lệ.
- Dashboard gửi `reject` khi khóa thay vì `penalize`, kiểm tra HTTP lỗi trước khi báo thành công; nhãn bình luận thể hiện độc hại, chương thể hiện Jaccard.
- Form quản lý tác giả kiểm tra lỗi trả về, hiện CustomAlert và giữ editor khi lưu thất bại.
- UI bình luận làm mới mỗi 5 giây khi có bình luận riêng tư đang xử lý/duyệt và người dùng đang xem tab Bình luận. Dừng khi rời màn hình, khi không còn trạng thái đó hoặc sau 2 phút; không gọi model AI khi polling. Phân biệt chờ worker và chờ admin bằng trạng thái log.
- Reader yêu cầu chương bằng số chương rõ ràng (`?by=number`), tránh đọc nhầm chapter ID có cùng số. Danh sách và nút trước/sau giữ số chương thật, bỏ qua chương chưa được xuất bản. Download offline cũng giữ số chương thật và không lấy nhầm chương theo vị trí mảng.
- Prompt toxicity tách phê bình cốt truyện khỏi công kích người; ca LC14 từng lọt vùng xanh, sau chỉnh trả vùng vàng. Prompt duplicate chỉ mô tả bằng chứng, yêu cầu admin xác minh quyền sử dụng, bỏ lời kết luận vi phạm/hình phạt. Thời hạn hai tác vụ được tăng từ 15 lên 25 giây; lượt LD01 trả lời sau 17,126 giây đã hoàn tất, giảm việc hủy sớm rồi retry.

## Kết quả và giới hạn

Lượt baseline API: 31/50 đạt, 19/50 chưa đạt. Trong 19 ca, 5 kỳ vọng mã HTTP được chỉnh theo hợp đồng API hiện có (403 cho chương bị giữ, 400 cho spam); 1 ca bị ảnh hưởng bởi dữ liệu được chèn trái quyền ở ca trước. Các lỗi quyền/trạng thái/queue còn lại đã tái hiện và sửa. Lượt cuối sau sửa **50/50 API và 9/9 luồng Chromium đạt**.

Baseline browser tái hiện nút khóa gửi HTTP 400 nhưng UI báo thành công, và reader mở sai chương do nhầm ID/số chương. Các lỗi harness gặp ban đầu (chưa đóng quảng cáo, chưa bấm tải lại queue, query reader dùng sai `chapter` thay vì `ch`) đã chỉnh trong runner, không tính là lỗi sản phẩm.

Regression cuối đạt **132/132 backend, 26/26 database và 2/2 offline**. TypeScript typecheck và build dashboard đạt. Test database cũ được đặt `AI_PROVIDER_COST_UNIT=unknown` rõ ràng cho gateway giả lập, tránh phụ thuộc đơn vị VND của cấu hình provider thật. Log: `.test-artifacts/ai-role-final.log`, `ai-role-unit-final.log`, `ai-db-role-final.log`, `ai-role-offline.log`, `ai-role-browser-final.log` và `ai-roles-ui/results.json`.

**AI thật:** xem [báo cáo chất lượng và chi phí](live-integrity-2026-10-02.md) và [50 kết quả tổng hợp](live-integrity-results-2026-10-02.json). 24 bình luận nhận verdict từ model thật, 1 quảng cáo bị chặn tại intake; 25 mẫu trùng lặp đều có kết quả đối chiếu cục bộ, trong đó 4 mẫu có thêm phân tích từ model thật. Kết quả cuối theo từng ID đạt 50/50 kỳ vọng, được tổng hợp từ nhiều lượt và ca kiểm tra lại; không phải 50 lượt AI trên cùng phiên bản prompt cuối. Chưa đánh giá được phân tích AI cho mọi mẫu duplicate vì timeout và giới hạn chi phí.

Provider xác nhận **2.134,08 VND** cho 57 request; **8 request timeout** chưa trả số tiền, giữ dự phòng **1.825 VND**. Tổng tiền đã ghi nhận cộng dự phòng **3.959,08 VND**, còn **40,92 VND** trong trần cho phép. Đây là số liệu theo response và dự phòng, chưa phải hóa đơn cuối của các timeout. Đã dừng gọi trả phí. Key và token không được ghi vào artifact.

Chạy lại offline: `node --test test/offlineChapters.test.cjs`. Kiểm thử AI thật chỉ chạy khi đặt `AI_TEST_BUDGET_VND` bằng ngân sách mới được cho phép rồi gọi `npm --prefix admin-dashboard/server run test:ai:live`; lệnh test thông thường không gọi provider trả phí. Backend đang mở cần khởi động lại để nhận mã nguồn và cấu hình mới.

Các lượt này chạy trên web Chromium và MySQL local, không chứng minh native Android/iOS, thanh toán ngân hàng, toàn bộ chức năng khác hoặc tải đồng thời ở quy mô production. Điểm Jaccard là độ tương đồng cụm từ, không phải tỷ lệ đạo văn hay kết luận quyền tác giả.
