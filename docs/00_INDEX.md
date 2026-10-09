# 00 — Mục lục bộ tài liệu thiết kế (v2)

**Phiên bản:** v2 — 2026-10-09  
**Thay đổi lớn so với v1:** chuyển từ "bản đồ trưng bày + đặt nhà vào lô" sang **game xây dựng có cải tạo địa hình**: người chơi nhận vùng đất sơ khai, tự dọn cây, cuốc đất, san nền, kè đá, làm đường, **bắc cầu qua sông**, xây nhà/cửa hàng/ngân hàng (map Thành phố) hoặc ruộng/chuồng trại (map Quê), rồi thu tiền/thu hoạch để mở rộng.

## 1. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Nền tảng | Web (desktop + mobile browser), không cần cài đặt |
| Ngôn ngữ / render | **TypeScript + Three.js** (Vite build) |
| UI | React (HUD, panel, popup) đè lên canvas Three.js |
| Backend | Node.js + Fastify + PostgreSQL; server là **nguồn sự thật** cho tiền, thời gian, công trình |
| Đăng nhập | Chỉ nhập **tên nhân vật** → tài khoản khách + mã khôi phục |
| Nhân vật | **Mỗi map một nhân vật riêng**: tên, cấp, XP, tiền ($), tổng tài sản độc lập. Đổi map = tạo nhân vật mới từ cấp 1; nhân vật cũ vẫn giữ |
| Tiền tệ | **Đô la ($)**, số nguyên |
| Bản đồ | Lưới ô **2 m × 2 m**, 128 × 128 ô (256 m × 256 m), chia 8 × 8 **khu** (16 × 16 ô) |
| Map MVP | **Thành phố** và **Quê (Nông trại)**. Map **Sinh thái** để P2 |
| Template | Bản đồ gốc không có công trình, không có cầu. **Người chơi được xây cầu, kè, đường nhựa** |
| Lưu game | Template bất biến + **delta** của người chơi, lệnh có `commandId` + `revision` |
| Xây dựng | Công trình và cầu **có thời gian xây** (30 giây → 4 giờ) với đội thợ 2–4; dọn, san, cuốc, kè, đường **tức thì** |
| Cân bằng | Mọi con số **tính từ nguyên tắc** bằng mô hình `docs/tools/economy`, nhịp lên cấp kiểm tra bằng mô phỏng 60 ngày (`16`) |

## 2. Danh sách tài liệu và thứ tự đọc

| # | File | Nội dung | Trạng thái |
|---|---|---|---|
| 00 | `00_INDEX.md` | Mục lục, quyết định chốt, thuật ngữ | v2 mới |
| 01 | `01_GAME_DESIGN_DOCUMENT.md` | GDD: tầm nhìn, vòng chơi, hệ thống, FTUE, phạm vi | v2 mới |
| 02 | `02_SHARED_ARCHITECTURE.md` | Kiến trúc client, các system, lưới ô, chunk, render | v2 cập nhật |
| 03 | `03_CITY_MAP.md` | Bố cục map Thành phố ban đầu | v2 cập nhật |
| 04 | `04_FARM_MAP.md` | Bố cục map Quê ban đầu | v2 cập nhật |
| 05 | `05_ECO_MAP.md` | Bố cục map Sinh thái (P2) | P2 |
| 06 | `06_WORLD_DATA_SCHEMA.md` | Schema template, instance, delta, catalog (TypeScript) | v2 mới |
| 07 | `07_ART_PIPELINE_IMAGE_TO_3D.md` | Từ ảnh concept → template lưới 3D | v2 cập nhật |
| 08 | `08_GAMEPLAY_BUILD_AND_PERSISTENCE.md` | Máy trạng thái công cụ, danh mục lệnh, lưu/tải | v2 viết lại |
| 09 | `09_UI_UX_AND_ONBOARDING.md` | Màn hình, HUD, điều khiển, hướng dẫn tân thủ | v2 mới |
| 10 | `10_QA_TEST_PLAN.md` | Kế hoạch kiểm thử, ngân sách hiệu năng | v2 mới |
| 11 | `11_TECH_STACK_BACKEND_DEPLOY.md` | Stack, API, DB, xác thực, chống gian lận, deploy | v2 mới |
| 12 | `12_AI_AGENT_TASKS.md` | Gói việc, mốc, nghiệm thu | v2 viết lại |
| 13 | `13_ASSET_LIST.md` | Danh sách asset 3D/âm thanh/UI, quy ước | v2 mới |
| 14 | `14_COPY_PASTE_IMPLEMENTATION_PROMPT.md` | Prompt giao cho AI coding agent | v2 viết lại |
| 15 | `15_TERRAIN_AND_CONSTRUCTION_TOOLS.md` | Luật chi tiết: dọn, cuốc, san, kè, đường, cầu, xây | v2 mới |
| 16 | `16_ECONOMY_AND_BALANCE.md` | Tiền tệ, bảng giá, thu nhập, cấp độ, mở khu | v2 mới |
| — | `tools/economy/` | Mô hình tính giá + mô phỏng 60 ngày + hiệu chỉnh XP (Node, không cần cài thư viện) | v2 mới |

**Thứ tự đọc khuyến nghị:** 00 → 01 → 15 → 16 → 06 → 02 → 08 → 11 → 09 → 03/04 → 07 → 13 → 10 → 12 → 14.

**Khi có mâu thuẫn:** 01 > 15/16 > 06 > các tài liệu còn lại. Mọi con số cân bằng game chỉ nằm ở 16 (và file content JSON sinh ra từ đó); tài liệu khác không lặp lại số.

## 3. Ảnh tham chiếu

| Ảnh | Dùng cho | Ghi chú |
|---|---|---|
| `map/map_1.png` | Map Thành phố | Hàng rào gỗ trong ảnh **không** được đưa vào template |
| `map/map_2.png` | Map Quê | Ruộng đã cày luống trong ảnh chỉ minh họa **trạng thái sau khi người chơi cuốc**; template là đất trống |
| `map/map_3.png` | Map Sinh thái (P2) | — |

Ảnh chỉ là tham chiếu bố cục/màu sắc; **không** được dùng làm texture, nền hay billboard (xem 07).

## 4. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| **Ô (cell)** | Đơn vị lưới 2 m × 2 m, chỉ số `(cx, cz)` với `0 ≤ cx, cz < 128` |
| **Đỉnh (vertex)** | Góc của ô; lưới đỉnh 129 × 129, mỗi đỉnh có một độ cao |
| **Bậc cao (step)** | 0,5 m — đơn vị độ cao người chơi dùng khi san nền |
| **Khu (zone)** | 16 × 16 ô = 32 m × 32 m; đơn vị mở khóa đất **và** đơn vị chunk render |
| **Template** | Bản đồ gốc bất biến của một map (`city`, `farm`) |
| **Tài khoản** | Cơ chế kỹ thuật (token + mã khôi phục) giữ các nhân vật của một người chơi; người chơi không thấy |
| **Nhân vật** | Gắn với **đúng một map**: tên, cấp, XP, tiền, tài sản, vùng đất riêng. `characterId` ≡ `worldId` |
| **World instance** | Vùng đất của một nhân vật = template + delta |
| **Tổng tài sản** | Tiền mặt + giá trị công trình, hạ tầng, đất đã mở, kho hàng (`16 §13`) |
| **Delta** | Những gì người chơi đã thay đổi so với template |
| **Lệnh (command)** | Một thao tác gửi lên server, có `commandId` duy nhất |
| **Settle** | Chốt số tiền/sản phẩm tích lũy đến thời điểm hiện tại trước khi thay đổi trạng thái |
| **Đô la ($)** | Tiền mềm của game |
| **Điểm vào (entry)** | Ô đường trong khu ban đầu, nơi đường làng từ ngoài bản đồ đi vào; mạng đường phải nối về đây thì công trình mới hoạt động |
| **Footprint** | Tập ô công trình chiếm, sau khi xoay |
| **Env object** | Cây, đá, bụi có sẵn trong template (sinh theo seed, ID ổn định) |
