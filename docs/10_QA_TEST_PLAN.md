# 10 — Kế hoạch kiểm thử

## 1. Tầng kiểm thử

| Tầng | Công cụ | Phạm vi | Chạy khi |
|---|---|---|---|
| Unit `sim` | Vitest | Mọi luật ở `15`, công thức ở `16` | Mỗi commit |
| Unit `worldgen` | Vitest | Tính xác định của env | Mỗi commit |
| Validator template | Vitest + CLI `tooling` | Ràng buộc `06 §4` cho mọi template | Mỗi commit, trước khi phát hành template |
| Integration API | Vitest + Postgres thật (container) | Auth, lệnh, idempotency, revision, settle | Mỗi PR |
| E2E | Playwright (Chromium + WebKit mobile emulation) | Luồng người chơi | Mỗi PR (smoke), hằng đêm (đầy đủ) |
| Visual | Playwright screenshot + review thủ công | 5 góc chụp mỗi map | Khi đổi template/asset |
| Hiệu năng | Playwright + `renderer.info` + máy thật | Ngân sách `11 §8` | Hằng tuần, trước release |
| Mô phỏng kinh tế | `tooling/sim-economy.ts` | Đường cong tiến trình | Khi đổi `economy.json` |

## 2. Unit test bắt buộc cho `sim`

### 2.1 Địa hình

- [ ] RAISE/LOWER/FLATTEN thay đổi đúng tập đỉnh, đúng bậc, chi phí đúng `Σ|Δh|/5 × rate`.
- [ ] San vùng có ô nước / đường / công trình / env chưa dọn → đúng mã lỗi.
- [ ] Hạ đỉnh ven nước chưa kè dưới `waterLevel+5` → `SHORE_RULE`; đã kè → hợp lệ.
- [ ] Chênh lệch biên > 20 dm → `TOO_STEEP_EDGE`.
- [ ] Đỉnh chung với đường bên ngoài vùng làm đường vượt dốc → `AFFECTS_NEIGHBOR`.
- [ ] Vùng > 256 ô → `AREA_TOO_LARGE`.
- [ ] Đỉnh trên biên hai khu được cập nhật ở cả hai `ZoneDelta`.

### 2.2 Đường, kè, cầu

- [ ] Đường qua ô nước / ô ruộng → lỗi; nâng cấp tier trả chênh lệch; cùng tier → bỏ qua.
- [ ] Auto-tile đúng 6 dạng cho mọi tổ hợp 4 hàng xóm (16 trường hợp).
- [ ] BFS kết nối: đường tách rời không kết nối; nối qua cầu thì kết nối; gỡ cầu thì mất.
- [ ] Kè ô không ven nước → `NOT_SHORE`.
- [ ] Cầu: không thẳng hàng, đầu chưa kè, đầu không phải đường, nhịp có ô đất, vượt nhịp, chênh cao > 10 dm, cắt cầu khác → đúng từng mã lỗi; ca hợp lệ ở đúng `maxSpan`.

### 2.3 Xây dựng

- [ ] Footprint xoay 0/90/180/270 chiếm đúng ô (bao gồm 2×3, 4×5).
- [ ] Không phẳng → `NOT_FLAT`; có `autoFlattenHDm` hợp lệ → san + xây nguyên tử; san không hợp lệ → không gì thay đổi.
- [ ] Ô ven nước chưa kè → `NEAR_WATER_NOT_EMBANKED`.
- [ ] Phá dỡ hoàn 50%, ô về `FOUNDATION`, settle tiền chờ trước khi phá.
- [ ] Công trình sai map → `WRONG_MAP`.
- [ ] `footprintCells` / `rotatedSize` đúng cho mọi kích thước không vuông (2×3, 3×4, 4×5) ở cả 4 góc xoay; anchor là ô tây-bắc sau xoay.
- [ ] `buildingAtCell`: với công trình 4×5 xoay 90°, mọi ô trong footprint trả đúng id; mọi ô kề sát bên ngoài (cả 4 cạnh) trả `null`. (Hồi quy lỗi prototype: phá dỡ dùng kích thước chưa xoay.)
- [ ] `DEMOLISH` bằng ô ngoài footprint → không xóa gì; bằng ô bất kỳ trong footprint → xóa đúng công trình đó, occupancy sạch.

### 2.3b Thời gian xây và đội thợ

- [ ] Đặt công trình → `CONSTRUCTING`, trừ tiền ngay, chiếm ô; trước `buildEndsAt` không thu nhập, không dân/việc, không thưởng.
- [ ] Fake clock tới `buildEndsAt`: server chuyển `ACTIVE` đúng thời điểm, settle tại `buildEndsAt` (không phải lúc lệnh kế tiếp đến), cộng XP xây dựng đúng `round(2√V)`.
- [ ] Nhiều công trình hoàn thành giữa hai lệnh được xử lý **theo thứ tự thời gian** (ví dụ: ngân hàng xong trước tăng trần kho tiền cho các khoảng sau).
- [ ] Hết đội thợ → `NO_BUILDER_FREE`; lên cấp 5/10 có thêm thợ ngay.
- [ ] `CANCEL_CONSTRUCTION` hoàn 100% tiền + vật liệu, không XP; với công trình đã xong → `NOT_UNDER_CONSTRUCTION`.
- [ ] `SPEED_UP` trừ đúng `ceil(50% × giá $ × còn lại/tổng)`, hoàn thành ngay; `DEMOLISH` công trình đang xây → `UNDER_CONSTRUCTION`.
- [ ] Cầu đang xây không là nút mạng đường; xong mới kết nối.
- [ ] Giới hạn số lượng theo cấp (`16 §6.2`, `§7.2`) → `LIMIT_REACHED`; công trình đang xây cũng tính vào giới hạn.
- [ ] Dọn, san, cuốc, kè, đường hoàn thành tức thì.

### 2.4 Kinh tế

- [ ] Thu nhập với fake clock: 0 → 1 giờ → đổi rate (xây công viên) → 3 giờ → thu: khớp công thức từng đoạn.
- [ ] Đầy trần kho tiền dừng tích lũy; thêm ngân hàng nâng trần ngay sau settle.
- [ ] Hiệu suất lao động `min(1, dân/việc)`.
- [ ] Không có đường kết nối → rate = 0.
- [ ] XP xây dựng chỉ cộng khi công trình hoàn thành; hủy khi đang xây không cộng XP; xây–phá luôn lỗ tiền.
- [ ] Cấp độ: XP tích lũy đúng bảng `16 §8.2` (riêng từng map); thưởng lên cấp `$150 × cấp` đúng.
- [ ] Giá mở khu đúng công thức; khu không kề → lỗi.
- [ ] Farm: gieo chốt `readyAt` với hệ số tưới; thu hoạch khi kho gần đầy thu một phần; bán khi chợ không có đường → `NO_ROAD_ACCESS`; công thức chế biến trừ nguyên liệu đúng.

### 2.5 Worldgen

- [ ] Cùng template + seed + generatorVersion → cùng danh sách env (so hash) trên Node và trong trình duyệt.
- [ ] Sinh khu theo thứ tự khác nhau → kết quả giống nhau.
- [ ] Không env `blocking` nào trên ô nước, ô đường tự nhiên, ô `ENTRY`; không quá 1 env blocking/ô.

### 2.6 Nạp snapshot và dữ liệu hỏng

Mỗi ca: chuẩn bị state đang chơi có ≥ 3 công trình, nạp snapshot lỗi, kiểm tra (a) bị từ chối với đúng nhóm lỗi `06 §6.6`, (b) **state, scene và cache IndexedDB giữ nguyên** (so hash trước/sau), (c) không có node/mesh mồ côi trong scene.

- [ ] Một công trình hợp lệ + một công trình có `defId` không tồn tại (lỗi nằm **cuối** mảng — hồi quy lỗi prototype xóa trước, kiểm sau).
- [ ] ID công trình trùng nhau.
- [ ] Công trình ngoài bản đồ / ngoài khu đã mở.
- [ ] Hai công trình chồng ô; công trình đè ô nước/đường/ruộng; cây trồng trên ô không phải `TILLED`.
- [ ] `mapId`, `templateVersion`, `seed` hoặc `mapKind` không khớp.
- [ ] `removedEnvIds` chứa ID không tồn tại.
- [ ] Đỉnh cạnh chung giữa hai khu lệch nhau; mảng `ZoneDelta` sai độ dài.
- [ ] Tiền âm / không nguyên; `level` không khớp `xp`; thời điểm ở tương lai.
- [ ] Cache IndexedDB hỏng → bị xóa, tải lại từ server, người chơi không thấy bản đồ trống.
- [ ] Snapshot hợp lệ → nạp thành công, hash state khớp server.

## 3. Integration API

- [ ] `POST /api/characters` không token: tạo account + nhân vật, trả token + mã khôi phục; tên hợp lệ / không hợp lệ / trùng tên → tag khác nhau.
- [ ] Có token, map chưa có nhân vật → chỉ tạo nhân vật mới (cấp 1, $2 000, tài sản $2 500), không tạo account mới, không đụng nhân vật map kia.
- [ ] Có token, map đã có nhân vật → 409 `CHARACTER_EXISTS`.
- [ ] Hai nhân vật cùng account: lệnh trên nhân vật Thành phố không thay đổi tiền/XP/cấp/tài sản của nhân vật Quê.
- [ ] `netWorth` sau chuỗi lệnh (xây, phá, đường, cầu, mở khu, bán) khớp công thức `16 §13` tính lại từ đầu.
- [ ] `/auth/recover` đúng mã → token mới, token cũ bị thu hồi.
- [ ] Gửi lệnh vào nhân vật của account khác → 404.
- [ ] World trong DB bị sửa tay thành dữ liệu sai → `GET /api/worlds/:id` trả lỗi có mã, log lỗi, không trả snapshot hỏng.
- [ ] Gửi cùng `commandId` 2 lần (kể cả song song) → 1 lần áp dụng, 2 phản hồi giống nhau.
- [ ] 2 lệnh song song cùng `expectedRevision` → 1 thành công, 1 `REVISION_CONFLICT`.
- [ ] Lệnh hợp lệ về cú pháp nhưng vi phạm luật (gửi thẳng bằng HTTP) → bị từ chối, ví không đổi.
- [ ] Rate limit trả 429.
- [ ] Snapshot sau 100 lệnh ngẫu nhiên hợp lệ khớp với state `sim` chạy cục bộ cùng chuỗi lệnh (property test).

## 4. E2E (Playwright)

1. Mở trang → nhập tên → lưu mã → chọn Thành phố → hoàn thành hướng dẫn 7 bước → cấp 2.
2. Tải lại trang → vào thẳng world, mọi thứ giống trước (so screenshot vùng + hash state qua `window.__debug`).
3. Kè 2 bờ + bắc cầu gỗ → xây công trình bờ bên kia → có kết nối (không có ⚠).
4. Quê: chợ → nhà nông → cuốc → gieo → (fake clock server ở môi trường test) → thu hoạch → bán.
5. Đổi map Thành phố ↔ Quê 20 lần → `renderer.info.memory.geometries/textures` không tăng quá 5%.
6. Mất mạng giả lập khi đang có lệnh chờ → banner → có mạng lại → đồng bộ đúng.
7. Mobile emulation (iPhone 13, Pixel 7): chạm, chụm zoom, hai ngón xoay, kéo vùng, nút xác nhận.
8. Khôi phục bằng mã trên context trình duyệt mới.

### 4.1 Rò rỉ tài nguyên GPU

Đo `renderer.info.memory.geometries`, `.textures` và `renderer.info.programs.length` sau 1 vòng khởi động (warm-up), rồi sau khi lặp. Tiêu chí: **không tăng** (cho phép sai lệch ≤ 2 do pool tạo lần đầu).

- [ ] Đổi qua toàn bộ công cụ và mọi loại công trình trong catalog 50 lần (hồi quy lỗi prototype: ghost bị gỡ khỏi scene nhưng không dispose).
- [ ] Đặt rồi phá cùng một loại công trình 50 lần.
- [ ] San nền cùng một khu 50 lần (rebuild tái dùng buffer).
- [ ] Nạp snapshot lỗi 20 lần liên tiếp (không để lại mesh mồ côi).
- [ ] Phá một công trình không làm tăng số program shader / không gây biên dịch lại (material dùng chung không bị dispose — `02 §10.1`).
- [ ] Đổi map 20 lần (mục 5 ở trên).

## 5. Kiểm tra hình ảnh (mỗi map)

Chụp 5 góc: mặc định, top-down, xoay 180°, cận bờ nước, cận đường + cây. Checklist:

- [ ] Địa hình có độ cao thật, quay 180° vẫn đúng hình khối; không có ảnh phẳng giả 3D (kiểm scene graph: không có `PlaneGeometry` lớn có texture ảnh).
- [ ] Template: 0 công trình, 0 cầu, 0 ruộng, không hàng rào, không đường nhựa.
- [ ] Không cây trong nước, không đường lơ lửng, không khe nứt giữa các khu địa hình.
- [ ] Sau san nền/kè/cầu: không z-fighting, tường kè khít mép nước, mố cầu chạm đất.
- [ ] Bố cục bờ nước, cụm lô trống tương đồng ảnh tham chiếu (`00 §3`).
- [ ] Đọc được chi tiết: cây, cỏ, đất, đường phân biệt rõ ở camera mặc định (prototype bị ánh sáng quá sáng, màu nhạt). So histogram ảnh chụp: không quá 5% điểm ảnh cháy sáng; độ chênh độ sáng trung bình giữa cỏ và đường đất ≥ 15%.

## 6. Hiệu năng

- Kịch bản "world đầy": script tạo world 64 khu mở, 400 công trình, 2 000 ô đường, 20 cầu, 1 000 ô ruộng.
- Đo trên: laptop iGPU (Intel Iris Xe), Android tầm trung (Snapdragon 7-series), iPhone 12.
- Đạt ngân sách `11 §8`. Thời gian rebuild một khu sau lệnh san nền ≤ 16 ms trên mobile.

## 7. Mô phỏng kinh tế

Mô hình tham chiếu: `docs/tools/economy/model.mjs` (bot tham lam, 3 kiểu người chơi, 60 ngày); khi code xong, port sang `packages/tooling/sim-economy.ts` dùng **chính package `sim`** để mô phỏng khớp luật thật. Tiêu chí (người chơi 3 phiên/ngày, sai lệch ≤ 25%): cấp 8 ≈ ngày 4, cấp 12 ≈ ngày 12, cấp 15 ≈ ngày 22, cấp 20 ≈ ngày 50 ở **cả hai map**; người chơi chăm ở Quê nhanh hơn ≥ 1,3×; không có công trình nào hoàn vốn < 1 giờ sau cấp 5; không có vòng khai thác lợi nhuận vô hạn (xây–phá, xây–hủy, mua–bán, dọn đất). So sánh kết quả với bảng `16 §12` và ghi chênh lệch.

## 8. Tiêu chí phát hành MVP

- Toàn bộ unit + integration xanh; E2E smoke xanh trên Chromium và WebKit.
- 0 lỗi console khi chơi bình thường 15 phút.
- Ngân sách hiệu năng đạt trên 3 thiết bị tham chiếu.
- Báo cáo visual review cho 2 map có ảnh chụp thật từ trình duyệt.
- Báo cáo kiểm thử ghi rõ **những gì chưa kiểm** (không ghi "đã kiểm" khi chưa chạy).
