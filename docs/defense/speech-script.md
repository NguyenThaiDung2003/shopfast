# Lời thuyết trình theo từng slide

Tổng khoảng 9 phút 30 giây. Tốc độ đọc khoảng 140 từ mỗi phút. Dòng in nghiêng là thao tác, không đọc. Đổi "em" cho hợp cách xưng hô thực tế.

## Slide 1. Mở đầu (0:20)

Em xin chào thầy cô trong hội đồng. Em là Nguyễn Thái Dũng. Hôm nay em trình bày ShopFast, một backend thương mại điện tử đang chạy thật trên Internet. Địa chỉ ở góc phải màn hình, thầy cô có thể mở ngay trong lúc nghe. Em sẽ dành nhiều thời gian nhất cho phần demo trực tiếp.

## Slide 2. Bài toán (0:40)

Em bắt đầu từ bài toán nghiệp vụ của một sàn khoảng hai trăm nghìn khách, với bốn áp lực chính.

Thứ nhất là tranh mua: hai người cùng mua món cuối thì không được bán quá tồn kho. Thứ hai là giá phải đúng: có cache để đọc nhanh nhưng không được hiện giá cũ. Thứ ba là bộ phận chăm sóc khách hàng quá tải: AI được hỗ trợ tra cứu nhưng không được tự huỷ đơn của khách. Thứ tư là phát hành liên tục mà khách không bị gián đoạn.

Mọi quyết định kỹ thuật phía sau đều nhằm trả lời bốn áp lực này.

## Slide 3. Kiến trúc (0:50)

Đây là kiến trúc tổng thể. Toàn bộ hệ thống chạy trên một máy EC2 bằng Docker Compose.

Khách chỉ đi vào qua Nginx, là thành phần duy nhất mở cổng ra ngoài. Phía sau có hai bản API, xanh dương và xanh lá, để đổi phiên bản mà không gián đoạn. PostgreSQL và Redis nằm trong mạng nội bộ, không có đường ra Internet.

Nhánh màu cam là luồng triển khai. GitHub Actions đẩy image lên GHCR, sau đó chính EC2 tự kéo bản mới về. Nhờ vậy GitHub không giữ khoá nào của máy chủ, và cổng 22 vẫn chỉ mở cho IP quản trị. Dữ liệu được sao lưu ra S3 hằng ngày.

## Slide 4. Tám chủ đề (0:40)

Hệ thống tích hợp tám chủ đề, và mỗi chủ đề giải một bài toán cụ thể, không phải dùng công nghệ để cho đủ.

Các chủ đề này liên kết với nhau. Ví dụ khi một đơn đổi trạng thái, hệ thống chỉ phát sự kiện sau khi cơ sở dữ liệu đã lưu xong. Từ một sự kiện đó, khách nhận cập nhật trực tiếp, và các job nền như hoàn tồn kho được đẩy vào hàng đợi, nên request gốc không bị chậm.

Hai slide tiếp theo em đi sâu vào hai quyết định quan trọng nhất.

## Slide 5. Hai người mua món cuối (0:40)

Quyết định đầu tiên là chống bán quá tồn kho. Em không đọc tồn kho rồi mới kiểm tra trong ứng dụng, vì giữa hai bước đó người khác có thể mua mất.

Thay vào đó là một câu UPDATE duy nhất, kèm điều kiện tồn kho còn đủ. PostgreSQL khoá dòng, nên người đến sau sẽ thấy không có dòng nào được cập nhật, đơn được rollback và trả lỗi 409.

Khi đơn có nhiều sản phẩm, em trừ kho theo mã sản phẩm tăng dần để tránh deadlock. Idempotency-Key đảm bảo bấm hai lần chỉ tạo một đơn.

Em đã thử 50 người cùng mua món cuối: đúng một người mua được, tồn kho không âm.

## Slide 6. AI có người xác nhận (0:40)

Quyết định thứ hai là cho AI tham gia nhưng không trao quyền thao tác.

Trợ lý có công cụ để tra đơn và tồn kho, nhưng không có công cụ ghi nào. Khi cần huỷ đơn, nó chỉ tạo được một đề xuất. Đơn hàng chưa hề thay đổi cho tới khi nhân viên bấm xác nhận, và lúc đó hệ thống kiểm tra lại điều kiện.

Câu trả lời của AI cũng được kiểm tra bằng code: mã đơn hay tồn kho nêu ra phải có trong kết quả tra cứu thật.

Trên production, xác nhận thì đơn được huỷ và tồn kho hoàn từ 91 lên 93. Bấm xác nhận lần hai bị từ chối với mã 409.

## Slide 7. Demo trực tiếp (3:00)

Bây giờ em xin demo trên hệ thống thật.

_Mở tab Actions, lần chạy Deploy vừa xong._

Trước buổi này em đã merge một thay đổi nhỏ. Pipeline chạy kiểm thử, đóng image rồi tự triển khai. Đây là commit trên main, và đây là phiên bản production đang báo, hai mã giống nhau.

_Chuyển sang hai trình duyệt: `customer13` ở trang đơn, `warehouse01` ở trang kho. Đổi trạng thái đơn._

Bên phải là nhân viên kho, bên trái là khách đang xem đơn. Em đổi trạng thái, và trang của khách cập nhật ngay, không cần tải lại.

_Chạy lệnh spam login trong terminal._

Tiếp theo là dò mật khẩu. Sau năm lần sai, tài khoản bị khoá theo email. Từ lần thứ mười một, IP bị chặn và nhận lỗi 429 kèm thời gian chờ.

_Sang `customer13` tạo ticket xin huỷ đơn, sang `support01` gọi trợ lý._

Khách gửi yêu cầu huỷ đơn. Nhân viên gọi trợ lý. Bước này mất khoảng 30 giây vì trợ lý đang gọi mô hình và tra dữ liệu thật. Trong lúc chờ, em xin nhắc lại rằng nó không có quyền ghi.

_Khi có đề xuất, chỉ vào trạng thái đơn, rồi bấm xác nhận._

Trợ lý đã đề xuất huỷ, đơn vẫn chưa đổi. Nhân viên xác nhận thì đơn mới được huỷ.

_Mở Bull Board._

Đây là bảng theo dõi job nền. Lệnh huỷ vừa rồi sinh ra job đồng bộ tồn kho, ticket sinh ra job phân loại. Job lỗi hết lượt thử sẽ vào hàng đợi dead-letter.

_Tắt Redis trong terminal SSH, gọi `/health` và danh sách sản phẩm. Bật lại ngay._

Cuối cùng em tắt Redis. Health báo degraded nhưng vẫn trả 200, và khách vẫn xem được sản phẩm vì hệ thống đọc thẳng từ cơ sở dữ liệu. Redis chỉ là lớp tăng tốc. Em bật lại ngay.

## Slide 8. Pipeline và rollback (0:50)

Về tự động hoá, một lần merge đi hết năm bước trên màn hình, mất 5 phút 47 giây, dưới mục tiêu 10 phút.

Điểm quan trọng là bước cuối. Sau khi đổi traffic, script kiểm tra qua đúng đường đi của khách và so mã commit. Nếu sai thì tự quay về bản cũ, mất từ 12 đến 24 giây.

Em đã cố tình ép lỗi trên server thật. Trong suốt quá trình deploy và rollback, 843 lượt gọi kiểm tra sức khoẻ đều trả về 200.

Cơ chế này còn bắt được một lỗi thật của chính em: lần deploy đầu, Nginx chưa cấu hình đúng, và hệ thống tự quay lại sau 13 giây.

## Slide 9. Bảo mật và vận hành (0:50)

Về bảo mật, em thu hẹp bề mặt tấn công: chỉ mở cổng web, cổng quản trị giới hạn theo IP, secret không nằm trong git hay image, và mọi endpoint mặc định yêu cầu đăng nhập.

Em cần nói rõ một điểm lệch so với yêu cầu ban đầu là OIDC. Tính năng đó bị khoá theo gói tài khoản AWS. Em đổi cách làm để EC2 tự kéo bản mới, nên GitHub không cần quyền AWS nào, vẫn đạt mục tiêu không lưu khoá dài hạn.

Về vận hành, backup lên S3 hằng ngày. Em đã diễn tập khôi phục với dữ liệu demo: 11 giây, 7 bảng khớp số dòng. Em cũng đã reboot máy thật, hệ thống tự lên lại sau 46 giây.

## Slide 10. Chất lượng mã (0:40)

Chất lượng được máy kiểm tra ở mỗi pull request: 407 unit test API, 303 test web, 186 test end-to-end với Postgres và Redis thật, coverage tầng service 94 phần trăm.

Bốn kiểm tra này là bắt buộc, kể cả quản trị viên cũng không bỏ qua được.

Khi kiểm thử phá hoại, em cố ý giết tiến trình và phát hiện email xác nhận có thể bị mất. Em đã thêm test tái hiện rồi sửa lỗi đó.

Mười sáu ADR ghi lại lý do, đánh đổi và cách xử lý sự cố của từng quyết định.

## Slide 11. Giới hạn (0:30)

Cuối cùng, em xin nói rõ các giới hạn. Một EC2 vẫn là điểm lỗi đơn: blue-green chống lỗi deploy, không chống hỏng máy. Mất máy thì có thể mất tối đa 24 giờ dữ liệu. Các bước tiếp theo đã được ghi lại trong bảng.

Đây là những đánh đổi có chủ đích ở quy mô đồ án.

Em xin hết. Em cảm ơn thầy cô đã lắng nghe và mong nhận được câu hỏi từ hội đồng.

## Khi có sự cố trong demo

- **Trợ lý AI báo lỗi:** "Nhà cung cấp mô hình đang giới hạn. Hệ thống trả 503 tiếng Việt và không lộ chi tiết, đó chính là cách suy giảm có kiểm soát." Sau đó chiếu video.
- **Mạng hội trường lỗi:** "Em xin chuyển sang video đã quay từ hệ thống thật."
- **Quá giờ:** bỏ Bull Board trước, sau đó bỏ tắt Redis và nói kết quả ở slide 9.
