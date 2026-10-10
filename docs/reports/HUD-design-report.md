# Thiết kế HUD và thanh công cụ trong game

2026-10-10, Asia/Bangkok. Phạm vi: giao diện chơi Thành phố và Quê.

## Giao diện

- Thẻ nhân vật gom avatar chữ cái đầu, tên, mã nhân vật, cấp và thanh EXP. Thanh EXP tính tiến độ trong cấp hiện tại; cấp 20 hiển thị “Cấp tối đa”. Bấm thẻ để mở hồ sơ.
- Tiền mặt nằm cạnh thẻ nhân vật. Vật liệu, đội thợ và dân/việc làm hoặc kho hàng nằm trong cụm tài nguyên. Tiền lớn dùng dạng rút gọn; tên truy cập và tooltip vẫn chứa giá trị đầy đủ.
- Menu chức năng gom Nhiệm vụ, Cài đặt và Đổi map. Trên điện thoại, menu thu gọn; đóng khi chọn chức năng, chạm bên ngoài hoặc nhấn Escape. Nhiệm vụ có thể ẩn để dành chỗ cho bản đồ.
- Công cụ chia thành Khám phá, Xây dựng, Hạ tầng và Nông trại (riêng Quê). Điện thoại có các nút chọn nhóm và thanh công cụ cuộn ngang; chọn nhóm đưa công cụ tương ứng vào vùng nhìn thấy.
- Bảng vật liệu, hồ sơ, kho và danh mục xây dựng nằm giữa HUD và thanh công cụ theo kích thước đo thực tế. Trên điện thoại, bảng nhiệm vụ tạm ẩn khi một bảng khác mở.
- Icon SVG thay các ký tự và emoji rời rạc; nút vẫn có nhãn tiếng Việt. Có trạng thái chọn, focus bàn phím, vùng bấm 44 px trên cảm ứng và hỗ trợ giảm chuyển động.

Avatar hiện là chữ cái đầu theo tên; chưa có tải ảnh đại diện. Không thêm trường dữ liệu nhân vật, đổi luật chơi hay số kinh tế.

## Icon và mã nguồn

Dùng `lucide-react` **1.54.0**, khóa phiên bản trong manifest/lockfile. Các icon được import tĩnh qua `GameIcon`;
không gọi CDN khi chơi. [Hướng dẫn React](https://lucide.dev/guide/react),
[mã nguồn](https://github.com/lucide-icons/lucide), [giấy phép](https://lucide.dev/license).
Thông báo bản quyền đầy đủ được phân phối tại `apps/web/public/assets/ui/LUCIDE-LICENSE.txt`,
gồm thông báo Lucide và Feather; bảng ánh xạ icon ở `apps/web/public/assets/ui/README.md`.

Thành phần mới: `CharacterCard`, `GameHud`, `ToolDock`, `GameIcon` và `useOverlayEdge` trong `apps/web/src/ui/`.
CSS có phạm vi `.game-shell`; màn hình đăng nhập/tạo nhân vật/chọn map giữ hệ thống kiểu riêng.
Smoke G4 được cập nhật để mở menu chức năng trước khi đổi map trên điện thoại.

## Kiểm tra thực tế

Kết quả cuối được ghi sau khi các lệnh hoàn tất; nguồn tại `docs/evidence/hud-design/`.

| Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- |
| `pnpm check` | PASS, exit 0, 682/682; content/lint/typecheck/build PASS | `check.log` |
| `pnpm test:api` | PASS, exit 0, 22/22 | `api.log` |
| `OUT=docs/evidence/hud-design/g3-flow node scripts/g3-e2e.mjs` | PASS, exit 0, 26/26; không lỗi page/console | `g3-flow.log`, `g3-flow/g3-e2e.json` |
| `node scripts/hud-review.mjs` | PASS, exit 0, 141/141; không lỗi page/console | `review.log`, `review/review.json` |
| `pnpm deploy:up` | PASS, exit 0; Docker localhost:8090 | `deploy.log` |
| `BASE_URL=http://127.0.0.1:8090 OUT=docs/evidence/hud-design/production-smoke node scripts/g4-smoke.mjs` | PASS, exit 0, 4 trường hợp / 24 kiểm tra; 0 lỗi page/console/HTTP | `production-smoke.log`, `production-smoke/smoke.json` |

Review sử dụng một tài khoản dev với hai nhân vật, tái sử dụng trên desktop 1440×900, tablet 820×1180,
Chromium cảm ứng 375×667 và 320×740, WebKit iPhone 13 390×664, ngang 812×375.
Các kiểm tra gồm tên/avatar/cấp/EXP, số công cụ theo map, không tràn ngang trang, bảng không đè thanh công cụ,
hồ sơ/vật liệu/kho/danh mục, menu Escape và focus, đổi chất lượng đồ họa, chọn nhóm và ẩn nhiệm vụ.
Fixture XP/cash chỉ dùng snapshot offline được validator chấp nhận trong context dev tạm thời;
không sửa tài khoản online hay dữ liệu kinh tế. Mã khôi phục trong bằng chứng G3 đã che.

Một lượt `pnpm check` bị chặn bởi ba lỗi `no-undef` trong `scripts/g4-full-world.mjs`
đang do agent khác sửa (`performance`/`requestAnimationFrame`). Không sửa hay stage file đó.
Log thất bại được giữ tại `check-concurrent-lint-failure.log`; agent kia sửa thành `window.*` trong `9a1a97c`,
sau đó chạy lại toàn bộ kiểm tra. Lint bỏ riêng file đó, typecheck và test riêng cũng đã exit 0.

Smoke Docker: draw calls City/Farm 150/168 trên Chromium và 57/62 trên WebKit; FPS lấy mẫu tương ứng
55/59 và 11/15. Đây là mẫu tự động trên máy phát triển trong khi các bộ kiểm tra khác đang chạy.
Build cuối: JS 990.10 kB (gzip 276.17 kB), CSS 41.78 kB (gzip 9.48 kB).
Docker web healthy ở `127.0.0.1:8090`; Postgres không publish cổng host. Không chạy tunnel.

Ảnh: [desktop Thành phố](../evidence/hud-design/review/desktop-city.jpg),
[điện thoại Thành phố](../evidence/hud-design/review/phone-small-city.jpg),
[điện thoại Quê, danh mục xây dựng](../evidence/hud-design/review/phone-narrow-farm-catalog.jpg).

Thiết bị thật và playtest với người mới: NOT RUN. Số FPS từ trình duyệt tự động trên máy phát triển không chứng nhận
hiệu năng điện thoại thật. Q009/Q010 vẫn theo báo cáo MVP hiện hành.
