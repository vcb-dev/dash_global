# Agent

File này đặt ở thư mục gốc repo. Áp dụng khi viết, sửa, debug code. Trả lời tiếng Việt khi người dùng viết tiếng Việt. Viết ngắn phần giải thích, dài phần code đúng chỗ.

## Đọc lại MD mỗi lần làm việc

**Không dựa vào trí nhớ phiên trước.** Mỗi lần bắt đầu việc (sửa/thêm/debug/script):

1. Đọc lại **`AGENTS.md`** (file này) bằng Read tool.
2. Đọc **`Global.md`** (hoặc skill `global-vcb-pancake`) khi đụng dash, sync POS, BE, layout, Sapo/CSV.
3. Đọc **`scripts/README.md`** khi tạo/chạy/sửa script, sync, check, seed, map CSV — **cấm** rải file ra root.
4. Xong việc liên quan kiến thức mới → ghi thêm vào đúng file MD (không chỉ nhớ trong chat).

## Cách làm một việc

1. Đọc yêu cầu và làm đúng việc đó. Không mở rộng sang refactor, đổi tên, hay dọn code xung quanh.
2. Tìm code hiện có trước khi viết mới. Bám style, tên, cấu trúc thư mục đang có trong repo.
3. Đọc file sẽ sửa và chỗ gọi nó. Không đọc cả repo. File lớn thì đọc đúng đoạn liên quan.
4. Sửa xong thì chạy kiểm tra vừa đủ: test của phần vừa đụng, hoặc lệnh build/lint mà repo đang dùng. Thất bại thì sửa tiếp.
5. Nói rõ đã sửa file nào, vì sao, và lệnh đã chạy. Không kể lại quá trình tìm file.

Được đọc `.env`, credential, token, connection string khi cần chạy app, gọi API, nối database, hoặc sửa cấu hình. Dùng giá trị đó để làm việc. Không dán secret vào câu trả lời, không commit các file đó.

## Viết code

- Sửa ít dòng nhất mà hết lỗi. Không tạo abstraction, helper, hay file mới nếu chỗ hiện tại chứa được.
- Không thêm comment giải thích đoạn code vừa viết. Chỉ comment khi lý do không thể hiện bằng chính code.
- Tên biến, hàm, type theo kiểu file xung quanh. Không đổi style format của cả file.
- Giữ nguyên hành vi không nằm trong yêu cầu. Không “tiện thể” đổi message, threshold, schema, hay API.
- Lỗi phải thấy được: ném hoặc trả lỗi có nghĩa, không nuốt exception bằng `catch` rỗng.
- Không hard-code secret mới vào source. Secret lấy từ env hoặc chỗ repo đang để cấu hình.
- Không thêm dependency nếu thư viện sẵn có làm được.
- Input từ ngoài vào thì kiểm tra ở biên (request, form, file). Trong nội bộ không lặp lại cùng một kiểm tra.
- Hàm làm một việc. Nếu một hàm đã dài và đang đúng, đừng tách chỉ để cho ngắn.

## Sửa theo loại việc

**Sửa lỗi.** Tìm chỗ ra sai, sửa đúng nhánh đó, rồi kiểm tra lại case lỗi. Không đổi luồng khác cho “an toàn hơn”.

**Thêm tính năng.** Đi theo luồng đã có: route hoặc page hiện tại, service, rồi chỗ lưu dữ liệu. Nhìn một feature gần giống và làm cùng kiểu.

**Đổi API.** Sửa cả phía gọi và phía nhận trong repo. Giữ field cũ nếu client đang dùng, trừ khi được yêu cầu xóa.

**Database.** Đổi schema bằng cách repo đang làm (migration, SQL). Không sửa dữ liệu production nếu chưa được yêu cầu. Câu lệnh có điều kiện `WHERE`. Không `DROP`, không xóa hàng loạt khi chưa được nói rõ.

**Thư mục `scripts/`.** Mọi file one-off / sync / check / seed / probe / ops / map CSV-JSON đặt trong `scripts/` (catalog: `scripts/README.md`). **Cấm** tạo `.js` / `.ps1` / `.csv` / `.json` map lẻ ở root. Root chỉ giữ `run_draft.js`, `pancake_export.ps1`, config (`package.json`, compose), và docs. Sync: `node scripts/sync_dt_ton.js`, `node scripts/sync_orders_funnel.js`.

**Giao diện.** Sửa component đang render màn đó. Giữ layout và chữ hiện có, chỉ đổi phần được nhờ. Xong thì kiểm tra đúng thao tác người dùng vừa nói.

## Kiểm tra

- Chạy test hoặc lệnh hẹp nhất bao được chỗ vừa sửa.
- Không chạy lại cả bộ test nếu đã có lệnh cho một file.
- Lỗi do sửa của mình thì sửa. Lỗi có sẵn, không liên quan, thì nói một dòng và không ôm vào.
- Không bảo là xong khi lệnh kiểm tra còn đỏ.

## Git

- Không commit, push, tạo PR, deploy nếu người dùng chưa yêu cầu.
- Khi được yêu cầu commit: chỉ đưa file của việc đó, không đưa `.env` hay file secret. Message một hoặc hai câu, nói vì sao đổi.
- Không `push --force`, không `reset --hard`, không bỏ qua hook.

## Câu trả lời

- Mở đầu bằng kết quả: đã xong gì, hoặc chưa xong vì sao.
- Nêu file và hàm đã đổi. Không dán cả file.
- Lệnh để người dùng chạy lại thì ghi đủ, một lần.
- Không đề xuất việc tiếp theo. Hết yêu cầu thì dừng.
