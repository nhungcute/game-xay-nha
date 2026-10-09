# 12 — Gói việc, mốc và nghiệm thu (giao cho AI coding agent / đội dev)

## 1. Cách tổ chức

- Một **Tech Lead/Integrator** giữ kiến trúc (`02`, `11`), duyệt và merge.
- Chia theo **module có ranh giới file rõ**; mỗi module một owner; không hai agent sửa cùng file.
- `packages/contracts` và `packages/sim` là lõi: thay đổi phải qua Tech Lead, kèm test.
- Map owner chỉ sửa layout/template/tuning của map mình; thiếu tính năng engine → mở issue cho owner engine.
- Content owner duy nhất cho `packages/content` (giá, catalog, i18n).
- Task chưa có bằng chứng (test chạy thật, ảnh/video từ trình duyệt) **không** được ghi "xong".

## 2. Gói việc

| ID | Owner | Đọc | Sở hữu file | Bàn giao | Phụ thuộc |
|---|---|---|---|---|---|
| A01 | Lead | 00, 02, 11 | root, `packages/contracts`, CI | Monorepo pnpm, TS strict, lint, Vitest, Playwright, CI | — |
| A02 | Sim | 06, 15, 16 | `packages/sim` | Lưới, occupancy, mọi lệnh `08 §4` (validate/apply), BFS đường, settle, XP/cấp, test `10 §2` | A01 |
| A03 | Worldgen & tooling | 06, 07 | `packages/worldgen`, `packages/tooling` | Sinh env xác định, `build-template`, validator template, `sim-economy` | A01 |
| A04 | Terrain & water | 02 §4–5 | `render/Terrain*`, `render/Water*` | Mesh theo khu, rebuild khu bẩn ≤ 16 ms, vertex color theo surface, nước + thác | A02 |
| A05 | Infra renderers | 02 §6–7, 13 | `render/Env*`, `Road*`, `Embank*`, `Bridge*` | Instancing env + ẩn khi dọn, auto-tile đường, tường kè, cầu module | A02, A03, A04 |
| A06 | Buildings & crops | 02 §7, 13 | `render/Building*`, `Crop*`, `assets/` | Instancing công trình/cây trồng, bong bóng trạng thái, AssetManager ref-count | A02 |
| A07 | Input & tools | 08 §2, 09 §3–4 | `game/input/*`, `render/Overlay*` | CameraRig, picking, ToolController, preview xanh/vàng/đỏ + lý do + chi phí | A02, A04 |
| A08 | UI | 09 | `apps/web/src/ui`, `app/` | Màn nhập tên, chọn map, HUD, panel, catalog, nhiệm vụ, FTUE, i18n | A07, A10 |
| A09 | Backend | 08 §5–8, 11 | `apps/api` | Account khách + nhân vật theo map (tên, cấp, XP, $, tổng tài sản) + mã khôi phục, worlds, commands (idempotent, revision, settle), DB migrations, rate limit | A02 |
| A10 | Net client | 08 §3 | `game/net`, `game/state` | ApiClient, CommandQueue lạc quan + rebase, clock sync, IndexedDB cache, chế độ `VITE_OFFLINE` | A02 |
| C01 | Content | 16 | `packages/content` | `economy.v1.json` (gồm công thức tổng tài sản), catalog, nhiệm vụ, `vi.json`; báo cáo `sim-economy` | A02 |
| M01 | City map | 03, 07 | `worlds/city-*`, layout | Layout vector + template qua validator + tuning camera/palette | A03, A04, A05 |
| M02 | Farm map | 04, 07 | `worlds/farm-*`, layout | Như M01 | A03, A04, A05 |
| Q01 | QA | 10 | `tests/e2e`, báo cáo | E2E, visual review, đo hiệu năng trên thiết bị thật | Tất cả |
| D01 | DevOps | 11 §9 | `infra/` | Docker Compose, Nginx, healthcheck, backup | A09 |

## 3. Mốc

### M0 — Hợp đồng và lõi luật (tuần 1–2)

- `contracts` (types + zod) khóa theo `06`.
- `sim` cài đủ luật `15` + công thức `16` + test `10 §2` (≥ 80 test).
- Template thử nhỏ (khởi tạo bằng tool) qua validator.
- **Gate:** `pnpm test` xanh; một world mới có 0 công trình/cầu/ruộng; property test 1 000 lệnh ngẫu nhiên không làm hỏng bất biến (occupancy, tiền ≥ 0, đỉnh chung khớp).

### M1 — Vertical slice offline, map Quê (tuần 3–5)

- Chạy `VITE_OFFLINE=1` (sim cục bộ, chưa server).
- Địa hình 3D thật theo khu, nước, thác, env, đường làng.
- Đủ công cụ: Dọn, San, Cuốc, Đường, Kè, Cầu, Xây (3 công trình), Gieo/Thu hoạch (2 cây trồng), Phá.
- **Gate:** video thao tác: chặt cây → san nền → làm đường → kè 2 bờ → bắc cầu → xây bờ bên kia; xoay 180°; đạt ngân sách hiệu năng desktop; rebuild khu ≤ 16 ms.

### M2 — Server, đăng nhập bằng tên, lưu trữ (tuần 6–8)

- API + DB + auth; CommandQueue lạc quan; tải lại trang giữ nguyên world.
- Kinh tế server-side: thu tiền Thành phố, cây trồng/sản xuất Quê, XP/cấp, mở khu.
- **Gate:** test integration `10 §3` xanh; curl lệnh gian lận bị từ chối; tải lại giữ hash state.

### M3 — Nội dung đầy đủ 2 map (tuần 9–11)

- Template Thành phố + Quê theo `03`, `04`; toàn bộ catalog `16`; nhiệm vụ + FTUE `09 §5`.
- **Gate:** hai map khác biệt rõ (địa hình, nước, lối chơi); visual review 5 góc mỗi map; bot `sim-economy` đạt tiêu chí `10 §7`; hoàn thành FTUE ≤ 6 phút.

### M4 — Sẵn sàng phát hành (tuần 12–13)

- Mobile hoàn chỉnh, chế độ đồ họa thấp, âm thanh, Docker, backup, observability.
- **Gate:** tiêu chí `10 §8`; `docker compose up` chạy từ source bằng 1 lệnh.

## 4. Mẫu giao việc cho agent

```text
Role: [module owner, ví dụ A02 Sim]
Read: [danh sách tài liệu cụ thể]
Own these files only: [đường dẫn]
Do not edit: [đường dẫn của owner khác]
Acceptance: [lệnh test chạy được + tiêu chí đo được]
Deliver: source, unit tests, ảnh/video cho task hình ảnh, báo cáo ngắn
Report: lệnh đã chạy và kết quả thật; những gì CHƯA kiểm tra
Stop and report blockers instead of inventing new requirements
```

## 5. Definition of Done

- Compile, lint, typecheck sạch; test của task xanh và chứng minh đúng yêu cầu.
- Không số cân bằng hard-code ngoài `packages/content`.
- Không placeholder giả hình 3D; asset có license trong manifest.
- Dispose tài nguyên đúng; không lỗi console khi dùng bình thường.
- PR: file thay đổi, lệnh test đã chạy, kết quả thật, phần còn thiếu, ảnh/video nếu có hình ảnh.

## 6. Lệnh review bắt buộc của Tech Lead

- "Chạy `pnpm test` và dán kết quả."
- "Quay video: san nền → kè → cầu → xây ở bờ bên kia, xoay camera 180°."
- "Gửi lệnh `PLACE_BUILDING` hợp lệ cú pháp nhưng đặt trên nước bằng curl — kết quả?"
- "In `getStateHash()` trước và sau khi tải lại trang."
- "Liệt kê kiểu object trong scene; chứng minh không có PlaneGeometry dán ảnh."
- "Đổi map 20 lần, in `renderer.info.memory` trước/sau."

## 7. Lỗi thường gặp

- Luật viết hai lần (client và server khác nhau) → **mọi luật chỉ ở `sim`**.
- Dùng `Date.now()` trong `sim` → test thời gian không ổn định, gian lận được.
- Rebuild toàn bộ địa hình mỗi lệnh → giật trên mobile.
- Đỉnh biên giữa hai khu lệch nhau → khe nứt địa hình.
- Random env không xác định → cây mọc lại/đổi chỗ sau tải lại.
- Tiền dùng float → sai lệch tích lũy.
- Hai map chỉ khác màu → không đạt bản sắc.

### 7.1 Bài học từ 3 prototype (đã xác nhận trong code)

| Lỗi đã gặp | Prototype | Quy tắc v2 |
|---|---|---|
| Xóa trạng thái rồi mới kiểm tra file nhập → file sai làm trống bản đồ | farm-3d-starter | Kiểm tra toàn bộ rồi mới hoán đổi (`08 §6.1`) |
| Nhận save sai seed, ngoài bản đồ, ID trùng, parcel không tồn tại; ghi luôn vào localStorage | verdant-worlds-3d | `validateSnapshot` đầy đủ (`06 §6.6`); không ghi cache khi chưa kiểm tra |
| ID trùng → mesh mồ côi không xóa được | verdant-worlds-3d | ID duy nhất do server cấp; validator chặn trùng |
| Phá dỡ dùng kích thước chưa xoay | verdant-worlds-3d | Một hàm footprint duy nhất + chọn bằng occupancy (`15 §8.1`) |
| Ghost preview không dispose; `group.clear()` không giải phóng | empty-farm-3d, farm-3d-starter | Pool ghost, quy tắc sở hữu GPU (`02 §10.1`) |
| Phá công trình dispose material dùng chung | empty-farm-3d | Entity không dispose tài nguyên dùng chung |
| Exposure quá cao, màu nhạt | verdant-worlds-3d | Khóa exposure/palette ở M1 (`02 §9`, `10 §5`) |
