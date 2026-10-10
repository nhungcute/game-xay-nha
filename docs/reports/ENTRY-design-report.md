# Thiết kế lại giao diện vào game

2026-10-10 (Asia/Bangkok). Baseline `ff47a51`; thay đổi giao diện được kiểm trong working tree trước khi commit.

## Thiết kế

- Nền kem, xanh rừng và cam đất; tiêu đề lớn với nét serif, icon SVG thống nhất, chuyển động nhẹ.
- Trang chọn map có cảnh làng ven sông, hai thẻ Thành phố/Quê với ảnh và màu riêng, mô tả lối chơi,
  thông tin nhân vật đang có và nút chơi tiếp. Sinh thái giữ trạng thái sắp ra mắt.
- Tạo nhân vật có bản xem trước tên theo thời gian thực, bản đồ đã chọn, cấp và vốn khởi đầu.
- Đăng nhập bằng mã khôi phục, màn lưu mã một lần, thông báo lỗi và cách sao chép thủ công khi clipboard bị chặn.
- Responsive từ 320 px; form đăng nhập đứng trước tranh trên điện thoại, nút cao ít nhất 44 px,
  focus bàn phím rõ và tôn trọng `prefers-reduced-motion`.

Component tại `apps/web/src/start/`. CSS giới hạn trong `.start`, tách khỏi HUD trong game.
API, đăng nhập tự động khi đã có phiên, độc lập nhân vật giữa hai map và luật kinh tế được giữ nguyên.
Đã thêm bắt lỗi cho lần tải lại danh sách nhân vật sau khi tạo, tránh promise rejection không được xử lý.

Tranh dùng built-in `imagegen`; [asset và prompt cuối](../../apps/web/public/assets/entry/README.md).
File `apps/web/public/assets/entry/welcome-v1.webp`: 1536 × 1024, 506,466 bytes, dùng chung giữa các màn.
Đây là tranh minh họa menu; danh sách 74 GLB placeholder của game không thay đổi.

## Kiểm chứng đã chạy

| Lệnh | Kết quả thật |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm build:web` | exit 0; build frontend thành công |
| `node scripts/entry-design-check.mjs` | exit 0; **131 kiểm tra PASS**, 5 kích thước/browser, 0 lỗi ngoài các phản hồi lỗi API giả lập có chủ đích |
| `node scripts/entry-recovery-smoke.mjs` | exit 0; **8 kiểm tra PASS**, API dev/Postgres thật tại 5191; khôi phục 2 nhân vật trên browser mới, giữ đúng world và phiên sau reload; 0 lỗi |
| `pnpm deploy:up` | exit 0; web Docker cập nhật tại `127.0.0.1:8090`, API/DB được giữ |
| `BASE_URL=http://127.0.0.1:8090 OUT=docs/evidence/entry-design/production-smoke node scripts/g4-smoke.mjs` | exit 0; **4 trường hợp / 24 kiểm tra PASS**, 0 lỗi console/page/HTTP; Chromium và WebKit, City và Farm |

Review giao diện dùng API fixture để kiểm tra trạng thái tên/mã không hợp lệ, retry, clipboard bị chặn,
map chưa mở, focus/Tab, tên tiếng Việt và tràn ngang. Viewport: desktop 1440×900 (27 checks), tablet
820×1180, iPhone SE 375×667, màn hẹp 320×740, WebKit iPhone 13 390×844 (mỗi trường hợp 26 checks).
Kiểm chứng khôi phục thật chạy trên DB dev; smoke production tạo nhân vật, vào game, đổi map và kiểm tra persistence sau reload.
Không lưu recovery code hoặc token thật trong báo cáo/ảnh/log; ảnh màn mã fixture được che.

Log/JSON/ảnh: `docs/evidence/entry-design/`. Kết quả 682 unit + 22 API của MVP là kết quả tại
`ff47a51`; không chạy lại hai suite đó trong thay đổi giao diện này. Không chạy lại economy/soak,
không kiểm thiết bị vật lý hay bàn phím ảo trên điện thoại thật. Q009/Q010 còn mở.

Build Docker mới: main JS 960.65 kB / gzip 268.38 kB; CSS 25.93 kB / gzip 6.51 kB.
Cảnh báo chunk lớn đã có từ MVP và vẫn còn. Tranh nền được cache/dùng lại qua một URL, không thêm thư viện runtime.
Không khởi động tunnel hoặc deploy công khai; Postgres không có cổng publish ra host.

## Ảnh giao diện

| Màn hình | Desktop | Mobile |
|---|---|---|
| Chọn vùng đất | [Ảnh](../evidence/entry-design/maps-desktop.jpg) | [Ảnh](../evidence/entry-design/maps-mobile.jpg) |
| Tạo nhân vật | [Ảnh](../evidence/entry-design/create-desktop.jpg) | [Ảnh](../evidence/entry-design/create-mobile.jpg) |
| Đăng nhập | [Ảnh](../evidence/entry-design/login-desktop.jpg) | [Ảnh](../evidence/entry-design/login-mobile.jpg) |
| Lưu mã | [Ảnh đã che mã](../evidence/entry-design/code-desktop.jpg) | [Ảnh đã che mã](../evidence/entry-design/code-mobile.jpg) |
| Nhân vật đã có | [Ảnh](../evidence/entry-design/returning-desktop.jpg) | [Ảnh](../evidence/entry-design/returning-mobile.jpg) |

Mở `http://127.0.0.1:8090` và tải lại trang. Nếu đang trong game, dùng nút **Đổi bản đồ** để xem trang chọn vùng đất.
