# ADR-0007: Cache Redis cho catalog (cache-aside, khoá có version)

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-29

## Bối cảnh

F04: trang sản phẩm và danh sách có lọc là các endpoint được gọi nhiều nhất, mục tiêu từ lần gọi thứ hai trở đi phản hồi **< 20 ms**. Ràng buộc:

- **Khách không được thấy giá cũ.** Giá đổi qua `PATCH /products/:id`; tồn kho đổi qua PATCH, đặt đơn và huỷ đơn. Cả ba nơi đều đã phát `product.updated` sau commit (ADR-0004, ADR-0005, ADR-0006).
- Danh sách có vô số tổ hợp bộ lọc (`categoryId`, `brandId`, `minPrice`, `maxPrice`, `sort`, `page`, `limit`). Khi một sản phẩm đổi giá, không biết trước những trang nào chứa nó: đổi giá có thể làm sản phẩm rơi vào hoặc ra khỏi một khoảng giá.
- **Key nóng hết hạn** không được làm hàng trăm request cùng đập vào DB (cache stampede).
- **Dò id không tồn tại** (`/products/999999`, …) không được lần nào cũng xuống DB.
- **Redis chỉ là lớp tăng tốc.** Redis lỗi hoặc chậm thì API vẫn trả đúng dữ liệu từ DB, không trả lỗi và không treo.

## Lựa chọn

| Phương án                                                          | Kết luận                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Cache HTTP / CDN theo URL                                          | Không chủ động xoá được khi đổi giá → phải chờ TTL → khách thấy giá cũ                          |
| Write-through: PATCH ghi luôn giá mới vào cache                    | Phải biết mọi trang danh sách chứa sản phẩm; tồn kho đổi ở 3 nơi → dễ sót                       |
| Cache-aside, xoá danh sách bằng `SCAN cache:products:*` + `DEL`    | `SCAN` là O(số key), chạy mỗi lần đổi giá/đặt đơn; trong lúc quét vẫn có request ghi key cũ vào |
| **Cache-aside + khoá có version, làm mất hiệu lực bằng `INCR`** ✅ | O(1) cho mọi trang danh sách, không cần biết trang nào chứa sản phẩm                            |

### Khoá

| Dữ liệu                    | Khoá                                                       | Version                                        | TTL (mặc định)                     |
| -------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Chi tiết sản phẩm          | `cache:product:{id}:v{ver}`                                | `cache:product:{id}:ver` – riêng từng sản phẩm | `CACHE_PRODUCT_TTL_SECONDS` = 300s |
| Danh sách có lọc           | `cache:products:v{ver}:{hash(bộ lọc)}`                     | `cache:products:ver` – chung cho catalog       | `CACHE_LIST_TTL_SECONDS` = 60s     |
| Không tồn tại / trang rỗng | như trên, giá trị `__empty__` hoặc trang rỗng              | như trên                                       | `CACHE_NEGATIVE_TTL_SECONDS` = 30s |
| Lock nạp lại               | `lock:{khoá}`                                              | –                                              | 2 s                                |
| Thống kê                   | hash `cache:stats` (`product:hit`, `product_list:miss`, …) | –                                              | không hết hạn                      |

- **Hash bộ lọc** là sha256 (16 ký tự hex) của bộ lọc đã chuẩn hoá: chỉ giữ 7 trường ảnh hưởng kết quả, áp default của DTO, bỏ `undefined`, sắp xếp key. Vì vậy `?brandId=2&categoryId=1` và `?categoryId=1&brandId=2` dùng chung một key; tham số lạ (`?utm_source=…`) không đẻ thêm key.
- **TTL có jitter ±15%:** các key nạp cùng lúc (ví dụ ngay sau deploy) không hết hạn cùng lúc.

### Đọc (`CacheService.getOrLoad`)

1. `GET` version, rồi `GET` khoá của version đó. Trúng → trả, đếm `hit`.
2. Trượt → đếm `miss`, `SET lock:{khoá} <token> NX PX 2000`.
   - **Lấy được lock:** đọc DB, `SET … PX <ttl có jitter>`, nhả lock bằng Lua (chỉ xoá nếu token vẫn là của mình).
   - **Không lấy được:** chờ 25 ms rồi đọc lại, tối đa 300 ms. Vẫn chưa có thì tự đọc DB và không ghi cache.
3. Mọi lỗi Redis → `logger.warn` (tối đa một dòng mỗi 10 giây), đọc DB.

### Làm mất hiệu lực (`CatalogCacheListener` ← `product.updated`)

Một lệnh `EVAL` nguyên tử thực hiện ba việc: xoá khoá chi tiết của version hiện tại, `INCR` version của sản phẩm, `INCR` version catalog. Mọi trang danh sách cũ trở thành mồ côi ngay lập tức và tự biến mất khi hết TTL.

## Lý do

- **Không cần biết trang nào chứa sản phẩm.** `INCR` version chung là O(1) và đúng cho cả trường hợp đổi giá làm sản phẩm đổi trang hoặc đổi khoảng giá.
- **Đọc version _trước_ khi đọc DB** chặn lỗi kinh điển của cache-aside. Ví dụ: request A đọc DB (giá cũ); admin đổi giá và xoá cache; A ghi giá cũ vào cache, và giá cũ sống tới hết TTL. Với version, A ghi vào khoá `v{cũ}`, không ai đọc tới nữa. Có unit test cho đúng kịch bản này.
- **Version riêng cho chi tiết:** mỗi đơn hàng phát `product.updated` cho từng sản phẩm trong đơn. Nếu chi tiết dùng version chung, mỗi đơn sẽ xoá cache chi tiết của toàn bộ 200 sản phẩm.
- **Listener chạy đồng bộ, khác với mặc định `async: true` của ADR-0004.** Handler chạy ngay trong `emit()`, và `EVAL` được ghi xuống socket trước khi response PATCH hoặc POST /orders được gửi. Mọi request GET đến sau đi trên **cùng một kết nối** Redis (ioredis dùng một kết nối và giữ thứ tự lệnh), nên Redis chắc chắn xử lý `INCR` trước. Đây là cơ sở cho câu "khách không thấy giá cũ". Với `async: true`, listener chạy sau `setImmediate`, và trong khoảng hở đó một GET vẫn có thể trúng giá cũ.
- **Lock `SET NX PX` có thời hạn:** tiến trình giữ lock bị chết thì lock tự gỡ sau 2 giây. Người chờ có giới hạn 300 ms nên request không bao giờ treo vì lock.
- **Cache giá trị rỗng với TTL ngắn:** dò id ngẫu nhiên chỉ tốn một truy vấn DB mỗi id mỗi 30 giây. Bộ lọc không ra sản phẩm nào cũng được cache ngắn như vậy.
- **Fail-open, timeout thấp:**
  - Client Redis dùng chung có `commandTimeout = REDIS_COMMAND_TIMEOUT_MS` (100 ms), `enableOfflineQueue: false`, `maxRetriesPerRequest: 1`. Redis sập thì lệnh lỗi ngay; Redis treo thì lỗi sau 100 ms.
  - `CacheService` bắt mọi lỗi và đọc DB.
  - E2E kiểm ba kịch bản: mất kết nối giữa chừng, cổng đóng, server nhận kết nối nhưng không trả lời. Cả ba đều trả 200 với dữ liệu đúng.
- **Thống kê trong Redis** (`HINCRBY`, fire-and-forget): cộng dồn mọi instance API, không làm chậm request. Xem tại `GET /api/admin/cache/stats` (ADMIN).

## Đánh đổi

| Đánh đổi                                                                                                                 | Giảm thiểu                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mỗi lần đọc tốn 2 round-trip Redis (version + giá trị)                                                                   | Redis cùng mạng nội bộ, mỗi round-trip < 1 ms; vẫn dưới mục tiêu 20 ms rất xa (xem `docs/perf/cache-benchmark.md`). Nếu cần, gộp thành một `EVAL`  |
| Một sản phẩm đổi tồn kho (mỗi đơn hàng) làm mất cache **mọi** trang danh sách                                            | Danh sách có TTL ngắn và nạp lại có lock; giờ cao điểm có thể tách tồn kho khỏi danh sách (chỉ hiển thị "còn hàng/hết hàng") hoặc gom invalidation |
| Khoá mồ côi nằm lại tới hết TTL, tốn bộ nhớ                                                                              | TTL ≤ 5 phút; Redis nên đặt `maxmemory` + `maxmemory-policy allkeys-lru` ở production                                                              |
| Invalidation lỗi (Redis chập chờn đúng lúc đó) → cache có thể còn giá cũ                                                 | `CacheService` bật cờ **bỏ qua cache** trong process suốt TTL dài nhất (300s + 15%), log `error`                                                   |
| Cờ bỏ qua cache chỉ có hiệu lực trong instance đã gặp lỗi; instance khác vẫn có thể đọc giá cũ (khi chạy nhiều instance) | Hiện chạy một instance. Khi scale ngang: phát lại invalidation qua queue có retry (F05), hoặc hạ TTL                                               |
| Ghi thẳng DB không qua `product.updated` (SQL tay, seed, import) → cache không biết                                      | Quy ước trong CLAUDE.md; seed tự xoá `cache:*`; sửa tay xong phải xoá cache (xem dưới)                                                             |
| Dữ liệu cache qua JSON nên `Date` thành chuỗi ISO                                                                        | Response HTTP vốn đã serialize như vậy; service không dùng giá trị cache cho logic nghiệp vụ                                                       |
| Thêm lock và chờ làm request trượt cache chậm hơn một chút khi tranh chấp                                                | Chờ tối đa 300 ms, chỉ xảy ra với key nguội đang được nạp                                                                                          |

## Xử lý khi sự cố

- **Redis sập hoặc chậm:**
  - API tự chuyển sang đọc DB; log có `Cache read failed, falling back to database` (tối đa một dòng mỗi 10 giây).
  - Tải DB tăng lên nên theo dõi p95 của `/products`.
  - Khi Redis trở lại, cache tự hoạt động lại mà không cần khởi động lại API.
  - `GET /api/admin/cache/stats` trả 503 trong lúc Redis sập.
- **Khách báo thấy giá cũ:**
  1. Tìm `Cache invalidation failed` trong log.
  2. Xoá cache của một sản phẩm: `redis-cli INCR cache:product:<id>:ver` rồi `INCR cache:products:ver`.
  3. Xoá toàn bộ cache catalog: `INCR cache:products:ver` cho danh sách; với chi tiết, chạy cùng đoạn quét như seed (`prisma/clear-cache.ts`).
- **Tắt hẳn cache:** đặt `CACHE_ENABLED=false` rồi khởi động lại API. Endpoint đọc thẳng DB, không cần đổi code.
- **Tỉ lệ trúng thấp bất thường:**
  - Xem `hitRate` theo nhóm. `product_list` thấp thường là do quá nhiều tổ hợp bộ lọc hoặc invalidation quá dày (đặt đơn liên tục).
  - Cân nhắc tăng `CACHE_LIST_TTL_SECONDS` hoặc tách tồn kho khỏi danh sách.
- **DB quá tải vì stampede:**
  - Kiểm `lock:*` trong Redis. Lock tồn tại lâu nghĩa là truy vấn nạp chậm hơn 2 giây.
  - Xem lại index hoặc truy vấn danh sách (ADR-0002, `catalog_indexes`).
- **Sửa dữ liệu bằng SQL tay:** sau khi sửa phải `INCR` các version tương ứng, như trong bước "Khách báo thấy giá cũ".
