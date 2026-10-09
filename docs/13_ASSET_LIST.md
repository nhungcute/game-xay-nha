# 13 — Danh sách asset và quy ước

## 1. Phong cách

- **Stylized low-poly**, màu tươi, ánh sáng nắng ấm — khớp ảnh tham chiếu `map/map_1..3.png`.
- Ưu tiên màu theo vertex color / atlas palette nhỏ (1 texture 256×256 dùng chung) thay cho texture riêng từng model → ít draw call, ít bộ nhớ.
- Công trình có hình khối rõ đọc được từ xa (mái màu nổi bật), chi tiết nhỏ vừa đủ ở tầm zoom gần.

## 2. Nguồn asset được phép

| Nguồn | Giấy phép | Dùng cho |
|---|---|---|
| Kenney (City Kit, Nature Kit, Farm Kit…) | CC0 | Nhà, cây, đường, hàng rào trang trí |
| Quaternius (Ultimate Nature, Farm, City packs) | CC0 | Cây, đá, động vật, cây trồng |
| KayKit (City Builder Bits, Resource Bits) | CC0 | Công trình, tài nguyên |
| Tự làm (Blender) / thuê họa sĩ | Sở hữu | Cầu, kè, công trình đặc trưng |

Mọi asset ghi vào `assets/manifest.json`: `id`, `file`, `source`, `author`, `license`, `url`, `modified` (có/không). **Không** dùng asset không rõ giấy phép, không lấy asset từ game khác (kể cả TeamFarmy).

## 3. Quy ước kỹ thuật

- glTF 2.0 `.glb`, Y-up, **1 unit = 1 m**, transform đã apply.
- **Pivot = tâm đáy footprint**, công trình kích thước `w×d` ô phải nằm gọn trong `(w*2) × (d*2)` m, mặt đất tại y = 0.
- Cửa chính hướng **−Z (bắc)** ở rotation 0; `entranceSide` trong catalog = `N`.
- Nén meshopt; texture KTX2 (UASTC cho atlas, ETC1S cho texture lớn).
- Ngân sách tam giác: env nhỏ ≤ 300, cây ≤ 800, công trình 2×2 ≤ 2 000, công trình 4×4 ≤ 5 000, cầu module ≤ 600.
- Tên file: `<nhóm>_<tên>[_vN].glb`, ví dụ `bld_shop_cafe.glb`, `env_tree_oak_v2.glb`.
- LOD: cây có 2 mức (LOD0 đầy đủ, LOD1 ≤ 150 tam giác) cho zoom xa.

## 4. Danh sách asset MVP

### 4.1 Thiên nhiên (env)

| Nhóm | Số biến thể | Ghi chú |
|---|---|---|
| `tree_deciduous` | 4 | Cây lá rộng |
| `tree_conifer` | 4 | Thông |
| `bush` | 4 | |
| `rock` (1 ô) | 4 | |
| `rock_large` (2×2) | 2 | |
| `reed` | 3 | Ven nước |
| `flower` | 4 | Không chặn |
| `grass_tuft` | 3 | Không chặn, instancing dày, tắt ở đồ họa thấp |
| `waterfall` | 1 | Mesh dải nước + hiệu ứng bọt cục bộ |

### 4.2 Địa hình (vật liệu, không phải model)

Cỏ, đất, cát, đá nền, **đất cuốc** (có luống — đây là trạng thái sau khi người chơi cuốc), nền công trình (đất nện/sỏi). Trộn bằng vertex color + texture chi tiết nhỏ dùng chung.

### 4.3 Hạ tầng (module auto-tile)

| Nhóm | Module | Biến thể theo tier |
|---|---|---|
| Đường | `END`, `STRAIGHT`, `CORNER`, `T`, `CROSS`, `ISOLATED` | Đất, sỏi, nhựa (city), lát đá (farm) = 4 bộ × 6 |
| Kè đá | `EDGE` (1 cạnh), `CORNER_OUT`, `CORNER_IN` | 1 bộ; chiều cao kéo dãn theo trục Y (UV world-space để không méo) |
| Cầu gỗ | `abutment`, `span`, `railing`, `ramp` | |
| Cầu đá | `abutment`, `span`, `pier`, `railing`, `ramp` | |
| Cầu bê tông | `abutment`, `span`, `pier`, `railing`, `ramp` | City |

### 4.4 Công trình Thành phố

`house_small`, `shop_grocery`, `deco_garden`, `house_town`, `shop_cafe`, `shop_restaurant`, `deco_park`, `bank`, `house_apartment`, `shop_supermarket`, `hotel`, `office_tower` (12 model, theo `16 §6.1`).

### 4.5 Công trình và vật thể Quê

`market`, `farmhouse`, `well`, `silo`, `chicken_coop`, `rice_mill`, `cow_barn`, `bakery`, `deco_flowerbed` (9 model).
Động vật (idle animation đơn giản): gà, bò.
Cây trồng: 8 loại (thêm cà phê) × 3 giai đoạn (mầm, lớn, chín) = 24 model nhỏ (≤ 150 tam giác, instancing).

### 4.6 UI

- Icon: tiền, gỗ, đá, XP, dân, việc, kho, 11 công cụ, mọi công trình, cây trồng, sản phẩm (SVG, 1 bộ thống nhất).
- Avatar mặc định (6 lựa chọn — P1 chọn avatar).
- Hình nền màn nhập tên và thẻ chọn map: **render từ chính game**.

### 4.6b Công trình đang xây

Giàn giáo module theo kích thước footprint (1×1 → 4×5, ghép từ cột + sàn + lưới che), đồng hồ đếm ngược dạng billboard UI (DOM overlay, không phải texture 3D), hiệu ứng bụi khi hoàn thành.

### 4.7 Hiệu ứng (VFX)

Bụi (san/cuốc/xây), mảnh gỗ (chặt), mảnh đá (đập), bắn nước (kè/cầu), tiền bay, "+XP", lấp lánh khi lên cấp. Dùng sprite particle nhỏ — **chỉ** cho hiệu ứng cục bộ.

### 4.8 Âm thanh

| Nhóm | Nội dung |
|---|---|
| Nhạc | 1 bản Thành phố, 1 bản Quê (loop, ≤ 1 MB mỗi bản, ogg/mp3) |
| Môi trường | Chim, gió, nước chảy (theo khoảng cách tới nước) |
| Hiệu ứng | Chặt, đập, cuốc, san, xây xong, thu tiền, thu hoạch, lên cấp, lỗi, bấm UI |

Nguồn CC0: Kenney Audio, freesound (chỉ CC0), hoặc tự làm.

## 5. Quy trình nhập asset

1. Tải/tạo → mở Blender → chuẩn hóa tỉ lệ, pivot, hướng, gộp material vào atlas.
2. Export `.glb` → `gltf-transform optimize --compress meshopt --texture-compress ktx2`.
3. Thêm dòng vào `manifest.json` (có license).
4. Chạy `pnpm tooling asset-check` — kiểm tra: kích thước bounding box khớp footprint, pivot ở đáy, số tam giác trong ngân sách, có license.
5. Xem trong trang `?asset-viewer=1` (xoay 360°, lưới ô 2 m) trước khi merge.
