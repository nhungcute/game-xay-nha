# 09 — UI/UX, điều khiển và hướng dẫn tân thủ

## 1. Luồng màn hình

```text
Lần đầu:   [Tải nhẹ ≤ 2 s] → [Chọn map] → [Tạo nhân vật: nhập tên] → [Tải world] → [Game]
Lần sau:   [Tải nhẹ] → (có token) → [Tải world của nhân vật chơi gần nhất] → [Game]
Đổi map:   [Game] → nút 🗺 Đổi map → [Chọn map] → có nhân vật? → [Tải world] : [Tạo nhân vật] → [Tải world]
```

### 1.1 Màn tạo nhân vật (nhập tên)

Hiện khi chọn một map chưa có nhân vật.

- Tiêu đề theo map: "Nhân vật Thành phố mới" / "Nhân vật Quê mới".
- Nền: ảnh render 3D tĩnh của game (không phải ảnh concept), logo.
- Ô nhập "Tên nhân vật", nút **Vào chơi** (to, dễ bấm), link nhỏ "Tôi có mã khôi phục".

> **Đã thay bằng D027 (2026-10-11):** đăng nhập bằng **tên người chơi + mã PIN** (4–6 số); bỏ mã khôi phục. Xem `DECISIONS.md` D027.
- Lỗi tên hiển thị ngay dưới ô (quá ngắn, ký tự không hợp lệ, từ cấm).
- Nếu đã có nhân vật ở map khác: ô tên gợi ý sẵn tên đó (sửa được) và dòng chú thích **"Nhân vật mới bắt đầu từ cấp 1 với $2 000. Tiền, cấp và tài sản của nhân vật {tên map kia} không chuyển sang."**
- Lần đầu tạo (chưa có tài khoản), sau khi tạo: hộp thoại **"Mã khôi phục của bạn"** + nút Sao chép + checkbox "Tôi đã lưu mã" (không bắt buộc tick để tiếp tục, nhưng sẽ nhắc lại — `11 §4.2`).

### 1.2 Màn chọn map

Hai thẻ lớn: **Thành phố** / **Quê**, mỗi thẻ có ảnh render, 1 dòng mô tả lối chơi ("Xây phố, thu tiền thuê và kinh doanh" / "Cuốc đất, trồng trọt, chăn nuôi").

- Map **đã có nhân vật**: thẻ hiện `Tên#1234 · Cấp N · Tài sản $X` và nút **Chơi tiếp**.
- Map **chưa có nhân vật**: thẻ hiện nhãn **Mới** và nút **Tạo nhân vật**.
- Thẻ Sinh thái hiển thị "Sắp ra mắt".
- Link nhỏ "Tôi có mã khôi phục" (khôi phục mọi nhân vật trên thiết bị mới).

### 1.3 Màn tải world

Thanh tiến độ theo bước: Dữ liệu → Địa hình → Cây cối → Công trình. Lỗi → thông báo cụ thể + nút Thử lại.

## 2. HUD trong game

```text
┌──────────────────────────────────────────────────────────────┐
│ [Avatar Tên#1234  Cấp 5 ▓▓▓░░ 312/559 XP]  💵 $12,340  🪵 45  🪨 30 │
│ [🏦 Tài sản $48,900]  [👥 48/40] (city) | [📦 72/150] (farm)  [🗺][⚙] │
│                                                              │
│                        (canvas 3D)                           │
│ [📜 Nhiệm vụ]                                    [＋][－][⟲]  │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 👁 Khám phá │ 🪓 Dọn │ ⛰ San │ ⛏ Cuốc* │ 🛣 Đường │ 🧱 Kè │ │
│ │ 🌉 Cầu │ 🏠 Xây │ 🌱 Gieo* │ 🔨 Phá │ 🗺 Khu đất            │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
* chỉ map Quê
```

- **Khối nhân vật** (góc trên trái) chỉ hiển thị chỉ số của **nhân vật map hiện tại**: tên + tag, cấp, thanh XP (`XP hiện tại / XP lên cấp kế`), tiền mặt $, tổng tài sản $. Chạm vào → **Hồ sơ nhân vật**: cấp, XP, tiền mặt, tổng tài sản và bảng chi tiết (công trình, hạ tầng, đất, kho — theo `16 §13`), ngày tạo, số khu đã mở.
- Số tiền định dạng `$12,340`; số lớn rút gọn trên mobile (`$1.2M`).
- 🗺 Đổi map → màn chọn map (`§1.2`).
- Thanh công cụ dưới cùng, cuộn ngang trên mobile. Công cụ khóa hiển thị ổ khóa + "Cấp N".
- **Dock theo danh mục (tab):** Công trình (nhà, cửa hàng, **Ngân hàng**, landmark), Đường (Đường/Cầu/Kè), Nông trại (Cuốc/Gieo/Thu hoạch, chỉ Quê), **Đất đai** (Dọn, San nền, Khu đất), Trang trí, Tiện ích (Quê: Giếng, Kho/Silo). Tab không còn gì để hiện trên map đó thì ẩn (Thành phố không có Nông trại và Tiện ích).
- **Phá** là nút nhanh riêng nằm cạnh Dock (bên phải thanh tab, cả desktop lẫn điện thoại), không thuộc tab nào. Là nút bật/tắt (`aria-pressed`, nhãn "Phá công trình"): bấm lần nữa về Khám phá; đổi sang tab khác cũng tắt Phá. Vùng chạm tối thiểu 44px trên điện thoại.
- Khi chọn công cụ: thanh phụ phía trên thanh công cụ hiện tùy chọn (chế độ san Nâng/Hạ/Phẳng, cấp đường, loại cầu, loại cây trồng), **chi phí dự kiến**, và phần đuôi tùy kiểu nhập (không còn nút Xác nhận/Hủy chung):
  - **Chuột:** thả chuột là đặt ngay (chọn vị trí = đã xác nhận). Chỉ còn gợi ý "Esc để thoát" và biểu tượng × thoát công cụ.
  - **Phá (chuột và cảm ứng):** bước xác nhận rõ ràng, một nút đỏ "Phá · hoàn $X" (kèm ghi chú "N công trình sẽ mất đường nối") và × hủy.
  - **Cảm ứng:** chạm/kéo chỉ xem trước; một nút chính nêu hành động + giá ("Đặt Nhà nhỏ · $300", "San nền 12 ô · $60", "Mở khu · $X"), mờ kèm lý do khi không hợp lệ; × hủy. Vùng chạm tối thiểu 44px (nút chính 48px).
  - Phát hiện: theo `pointerType` của lần chạm gần nhất (touch = giao diện cảm ứng, còn lại = chuột), khởi tạo từ `(pointer: coarse)`; laptop màn hình cảm ứng tự đổi theo thiết bị đang dùng. Xem `docs/reports/CONFIRM-bar.md`.
- Panel catalog công trình: lưới thẻ (icon, tên, giá, kích thước, thu/giờ hoặc chức năng), lọc theo nhóm (Nhà ở / Kinh doanh / Trang trí / Sản xuất).
- Chạm công trình (Khám phá): panel thông tin — tên, trạng thái đường (✔/⚠), thu/giờ, các thưởng đang nhận, tiền chờ thu, nút Thu / Phá dỡ. Farm: slot sản xuất, nút cho ăn/bắt đầu.
- **Công trình đang xây:** giàn giáo + đồng hồ đếm ngược phía trên. Chạm vào → panel: thời gian còn lại, nút **Xây nhanh ($X)** và **Hủy (hoàn 100%)**. Xây xong: hiệu ứng bụi + âm thanh, bong bóng "✔ Xong".
- **Đội thợ** trên HUD (cạnh tiền): `👷 1/2` (đang bận/tổng). Hết thợ: nút xây trong catalog mờ kèm "Chờ thợ rảnh — còn 4:12" và nút xây nhanh công trình sắp xong nhất.
- Catalog hiển thị cho mỗi công trình: giá, thời gian xây, thu/giờ, **còn được xây X/Y** ở cấp hiện tại (`16 §6.2`).
- Bong bóng trên đầu công trình: 💵 chờ thu, ⚠ không có đường, 💤 thiếu dân (hiệu suất < 100%), ✅ sản phẩm xong.

## 3. Phản hồi trực quan khi dùng công cụ

| Trạng thái preview | Màu | Kèm theo |
|---|---|---|
| Hợp lệ | Xanh lá | Chi phí |
| Hợp lệ nhưng cần san tự động | Vàng | Chi phí xây + chi phí san |
| Không hợp lệ | Đỏ | Lý do (chuỗi từ mã lỗi `15 §11`), ô gây lỗi tô đậm |

- Lưới ô hiển thị mờ khi đang dùng công cụ, ẩn ở chế độ Khám phá.
- Lý do không hợp lệ hiển thị tại chỗ (thanh preview); chỉ khi bấm xác nhận bị từ chối mới có toast (xem §6).
- San nền: hiện lưới đỉnh + số bậc thay đổi; địa hình biến đổi mượt 200 ms sau khi xác nhận.
- Đường: các ô đường xem trước hiển thị đúng auto-tile.
- Cầu: chạm đầu A → các ô hợp lệ cho đầu B được đánh dấu; dải nhịp hiển thị độ dài/nhịp tối đa.
- Khu khóa: phủ mờ + viền nét đứt; chạm → popup giá + cấp yêu cầu + nút Mở.
- Hiệu ứng: bụi khi san/cuốc, gỗ bay khi chặt, tiền bay vào HUD khi thu, "+XP" nổi lên.

## 4. Điều khiển camera và nhập liệu

| Hành động | Desktop | Cảm ứng |
|---|---|---|
| Xoay | Chuột phải kéo (Khám phá: cả chuột trái) | Hai ngón xoay |
| Di chuyển (pan) | Chuột giữa kéo / WASD / mép màn hình (tắt mặc định) | Một ngón kéo (Khám phá) / hai ngón kéo |
| Zoom | Cuộn chuột | Chụm hai ngón |
| Dùng công cụ | Chuột trái kéo/chạm | Một ngón kéo/chạm |
| Xoay công trình | R / Q-E | Nút ⟳ |
| Hủy | Esc / chuột phải nhấp | Nút ✖ |
| Thu tất cả (có ngay từ đầu, D028) | Phím C | Nút trong HUD |

- Camera: perspective FOV 40°, pitch 35°–75°, mặc định 55°; yaw tự do 360°; zoom 30–220 m; target giới hạn trong khu đã mở + 1 khu viền.
- Nút ⟲ đưa camera về góc mặc định của template.
- Không cho camera xuyên địa hình (kẹp độ cao tối thiểu theo heightfield).

## 5. Hướng dẫn tân thủ (FTUE)

Mỗi bước: mũi tên/viền sáng chỉ vào nút hoặc ô, bong bóng thoại ngắn (nhân vật hướng dẫn "Bác Tư" — trưởng làng). Có nút **Bỏ qua hướng dẫn** (vẫn giữ nhiệm vụ trong danh sách). Bước gắn với nhiệm vụ `16 §10`.

**Bảng nhiệm vụ (D041).** Hiện tối đa 5 nhiệm vụ đang mở cùng lúc (biểu tượng chạm để chọn công cụ, tên, thanh tiến độ); nhiệm vụ đã xong có nút "Nhận thưởng · $x · +y XP" và xếp lên đầu; tiêu đề hiện `đã nhận/tổng` (vd. "Nhiệm vụ 4/12"). Có thể làm và nhận theo thứ tự bất kỳ. Lời nhắc của Bác Tư theo nhiệm vụ mở đầu tiên chưa xong. Trên điện thoại bảng gọn hơn và cuộn bên trên bản đồ nhỏ, không đè thanh công cụ.

### 5.1 Thành phố

| Bước | Lời thoại (tóm tắt) | Hành động yêu cầu | Chặn thao tác khác? |
|---|---|---|---|
| 0 | Camera bay từ toàn cảnh xuống điểm vào. "Chào {tên}! Vùng đất này đang chờ cháu." | — | Có |
| 1 | "Dọn mấy cây này đã." (3 cây được đánh dấu) | Dùng Dọn, chọn 3 cây | Có (chỉ công cụ Dọn) |
| 2 | "Làm đường từ cổng làng vào bãi đất." (ô đích được đánh dấu) | Vẽ đường ≥ 6 ô nối ENTRY | Có |
| 3 | "Nền phải phẳng mới xây được." (vùng 2×2 hơi dốc) | San phẳng vùng | Có |
| 4 | "Xây nhà cho dân ở." | Xây Nhà nhỏ trên nền đã san, kề đường | Có |
| 5 | "Có dân rồi, mở tiệm tạp hóa." | Xây Tạp hóa kề đường | Có |
| 6 | "Tiền về rồi kìa!" (tích lũy lần đầu tăng tốc) | Chạm bong bóng tiền | Có |
| 7 | Lên cấp 2. "Giờ cháu tự quyết nhé. Xem nhiệm vụ ở góc trái." | — | Không |

Ở cấp 3–4: hướng dẫn ngắn (không chặn) cho Kè đá và Cầu khi người chơi chạm khu bên kia sông lần đầu.

### 5.2 Quê

Chợ (nối đường) → Nhà nông → Cuốc 6 ô → Gieo rau cải (chín sau 20 giây trong hướng dẫn) → Thu hoạch → Mở chợ, bán → Lên cấp 2.

## 6. Thông báo và popup

- "Trong lúc bạn vắng mặt": tổng tiền chờ thu (city) / số ô đã chín, sản phẩm xong (farm). Nút "Thu tất cả" (city, không cần ngân hàng từ D028).
- Lên cấp: popup danh sách mở khóa mới.
- Mất kết nối: banner vàng cố định trên cùng.
- Không dùng popup chặn cho lỗi validate. Lệnh bị từ chối (cục bộ, server, rebase, hàng đợi đầy, lỗi lưu) hiện dạng toast nổi sát mép trên, dưới thanh trên cùng (D043): tối đa 3, tự tắt sau 2,5 s (lỗi) / 1,8 s (thông tin), trùng thì gộp ×N, chạm để đóng. Lý do khi rê chuột/chạm xem trước vẫn nằm ở thanh preview + ô đỏ, không toast. Dòng `.feedback` chỉ còn hướng dẫn trung tính.

## 7. Cài đặt

Âm lượng nhạc/hiệu ứng, chất lượng đồ họa (Tự động / Cao / Thấp), hiện lưới, ngôn ngữ (vi/en — P1), xem mã khôi phục (nhập lại không cần, hiển thị qua xác nhận), Bắt đầu lại nhân vật map này (xóa nhân vật + vùng đất, nhân vật map kia giữ nguyên), Đăng xuất (cảnh báo: cần mã khôi phục để vào lại mọi nhân vật).

## 8. Khả năng tiếp cận và nội địa hóa

- Mọi chuỗi qua khóa i18n (`packages/content/i18n/vi.json`), không viết cứng trong component.
- Kích thước chạm tối thiểu 44 × 44 px; chữ HUD ≥ 14 px trên mobile.
- Không truyền đạt trạng thái chỉ bằng màu: lỗi preview luôn có văn bản lý do; icon bong bóng có hình dạng khác nhau.
- Hỗ trợ màn dọc và ngang trên mobile; màn dọc thu nhỏ thanh công cụ thành 2 hàng.
- Định dạng tiền `$12,340`; số lượng khác dùng dấu cách hàng nghìn (`12 340`).
