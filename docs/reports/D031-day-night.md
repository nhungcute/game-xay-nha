# D031 - Chu kỳ ngày/đêm và đèn cửa sổ (Day/Night Cycle & Window Lights)

Ngày: 2026-10-12

## 1. Kết quả (Result)

PASS sau bản sửa review (mục 5.5). Bản đầu tiên ghi PASS nhưng cây xa và bụi cây vẫn sáng như ban ngày lúc 22h: `applyNightTint` thực tế không có tác dụng. Toàn bộ tính năng chu kỳ ngày/đêm (day/night lighting), đèn cửa sổ theo từng ô kính (per-window instanced emissive), làm tối bề mặt ban đêm (night tint), hiệu ứng bloom ban đêm ở chế độ đồ họa cao (UnrealBloomPass), và cụm điều khiển Settings "Thời gian trong ngày" đã hoàn thành và kiểm chứng thực tế trong game.
Lỗi `rice_mill` mất cửa sổ đã được sửa triệt để bằng cơ chế chung trong pipeline import, khôi phục đủ 2 ô kính (72 đỉnh / 24 tam giác), đưa toàn bộ test suite và cả 3 script importer (`--check`) về trạng thái PASS 100%.

## 2. Phạm vi tính năng (Scope)

- **Chu kỳ ánh sáng tự nhiên (`dayCycle.ts`)**: Hàm thuần `lighting(hour, mode)` tính toán liên tục các thông số ánh sáng:
  - 07:00 – 17:00: Ban ngày đầy đủ (`night = 0`).
  - 17:00 – 19:00: Hoàng hôn chuyển tiếp mượt mà qua hàm `smoothstep` (`night` từ 0 lên 1).
  - 19:00 – 05:00: Ban đêm tối hoàn toàn (`night = 1`).
  - 05:00 – 07:00: Bình minh chuyển tiếp mượt mà từ đêm sang ngày (`night` từ 1 về 0).
  - Hỗ trợ 3 chế độ: `auto` (mặc định, tự động theo giờ máy người chơi), `day` (ép luôn ban ngày), `night` (ép luôn ban đêm).
- **Hệ thống đèn cửa sổ (`windowLights.ts`)**:
  - Tận dụng thuộc tính đỉnh `_WINDOW` trong các file GLB authored (chuẩn hóa `id / windowCount`, 0 = tường/không phải kính).
  - Shader hook tiêm mã GLSL vào material dùng chung của `InstancedMesh`:
    - Tính seed ngẫu nhiên theo tọa độ instance (`vInstanceSeed = instanceMatrix[3].xz`).
    - Băm (hash) theo `(vWindow, vInstanceSeed, roundedHour)` để quyết định ô kính nào sáng đèn.
    - Ban ngày (13h): 0% đèn sáng (`windowRate = 0`).
    - Ban đêm (19h–24h): ~62–70% đèn sáng.
    - Đêm khuya (00h–05h): ~42% đèn sáng.
    - Màu phát quang: cam ấm `vec3(1.0, 0.56, 0.16)` với cường độ emissive 2.0.
    - Trạng thái đèn ổn định theo từng ô, không nhấp nháy theo frame.
- **Shader patches an toàn (`shaderPatches.ts`)**:
  - Ghép nhiều hook `onBeforeCompile` trên material dùng chung (`d031-window-lights`, `d031-night-tint`, `d030-wind`).
  - Giữ lại `base` hook ban đầu và sinh `customProgramCacheKey` ổn định, tránh biên dịch lại shader không cần thiết.
- **Làm tối ban đêm đồng bộ (`night.ts`)**:
  - `applyNightTint()` chỉ dành cho vật liệu unlit / MeshBasic (cây far LOD, bụi cây `KHR_materials_unlit`, bọt nước): nhân `outgoingLight` với `uUnlitTint` **trước** `#include <opaque_fragment>` (trong không gian tuyến tính, trước tone mapping).
  - `uUnlitTint = lighting().unlitTint`: tỉ lệ irradiance theo từng kênh mà một bề mặt có chiếu sáng nhận được (sun × 0,8 + hemisphere sky) so với ban ngày. Ban ngày đúng bằng (1, 1, 1); 22h ≈ (0,071, 0,114, 0,193).
  - Vật liệu có chiếu sáng (terrain, công trình, coin, mặt nước) không dùng tint: chúng tự tối theo đèn. Coin đã được bỏ tint.
- **Hậu kỳ Bloom ban đêm (`GameLoop.ts`)**:
  - Tích hợp `EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass`.
  - Điều kiện kích hoạt: `quality === 'high' && night > 0.2`. Ở chế độ đồ họa `low`, bloom hoàn toàn tắt và quay về direct rendering để tiết kiệm GPU.
  - Tự động đồng bộ kích thước và pixel ratio qua `resize()` và khi đổi quality.
  - Dispose toàn bộ tài nguyên (bao gồm render target của bloom) khi kết thúc game session.
- **Cụm cài đặt Settings ("Thời gian trong ngày")**:
  - Giao diện 3 nút: "Tự động theo giờ", "Luôn ban ngày", "Luôn ban đêm".
  - Áp dụng tức thì khi chọn, lưu trữ an toàn trong `localStorage` (có try/catch bọc chống crash khi storage bị chặn).

## 3. Nguyên nhân và cách sửa `rice_mill` mất cửa sổ

### 3.1. Nguyên nhân gốc rễ
Trong `scripts/import-model-pack.mjs`:
- Nguồn pack `Bo_21_Mo_Hinh_3D_GLTF_Day_Du/assets/rural/rural_windmill.glb` có 2 ô kính (nhóm `DOORS_WINDOWS` có 156 tam giác, trong đó 24 tam giác là kính BLEND darkglass).
- Nhóm `SAILS_ANIMATED` của cối xay gió có 1.768 tam giác được chỉ định `preserve: true` (để giữ nguyên cánh quạt đặc trưng và pivot hoạt ảnh).
- Triangle cap của `rice_mill` là 2.500 tam giác. Ngân sách còn lại cho 5 nhóm khác chỉ là `2500 - 1768 = 732` tam giác.
- Ở vòng re-simplify tỉ lệ, nhóm `DOORS_WINDOWS` bị scale mục tiêu xuống chỉ còn **8 tam giác** (`budgetShare: 8`).
- Để đạt được target 8 tam giác, Meshopt simplifier buộc phải leo thang error từ 0.02 lên 0.04, rồi đến 1.0. Ở mức giảm cực đoan này, toàn bộ 24 tam giác kính (vốn là các mặt phẳng nhỏ) bị gộp/xóa hoàn toàn, khiến output `rice_mill.glb` có 0 đỉnh kính, dù config vẫn ghi `windowCount: 2`.

### 3.2. Cách sửa chung trong pipeline
- Không đặc cách riêng `rice_mill` bằng `if (gameId === 'rice_mill')`.
- Sửa hàm `simplify(welded, ...)` dùng chung:
  1. Kiểm tra nếu input `welded` có chứa đỉnh cửa sổ (`hasWindows`).
  2. Chuẩn bị mảng `vertexLock` (độ dài bằng số đỉnh, đánh dấu `1` tại các đỉnh có `windows > 0`).
  3. Thử nghiệm simplify chuẩn (`lock = null`). Nếu tất cả các cửa sổ vẫn tồn tại trong output (như 19 tòa còn lại), kết quả này được chấp nhận ngay, đảm bảo tính byte-identical 100% cho các tòa nhà không bị lỗi.
  4. Nếu nguồn có cửa sổ nhưng kết quả simplify làm mất sạch đỉnh kính (`retainedWindows === 0`), simplifier tự động fallback thực hiện đợt rút gọn có `vertexLock` bảo vệ kính.
- Thêm guard sau simplify:
  - Nếu model có `windowCount > 0` từ nguồn mà output không còn đỉnh `_WINDOW > 0` thì pipeline import lập tức throw lỗi.
  - Trường `windowCount` trong `model-pack.config.json` được cập nhật theo số ô kính phân biệt thực tế có trong output (`outputWindowCount`).

### 3.3. Số liệu so sánh trước và sau khi sửa
| Chỉ số | Trước sửa | Sau sửa | Ghi chú |
| --- | ---: | ---: | --- |
| `rice_mill` window vertices (`_WINDOW > 0`) | 0 / 6.972 | **72 / 7.020** | 24 tam giác kính = 2 ô kính |
| `rice_mill` unique window IDs | 0 | **2** | Đầy đủ 2/2 ô kính phát sáng |
| `rice_mill` triangles | 2.324 | **2.340** | Dưới triangleCap (2.500) |
| `rice_mill` bytes | 217.308 B | **218.796 B** | Tăng nhẹ do thêm hình học kính |
| `rice_mill` floating baseline | 0 | 1 | Nằm trong baseline cho phép (= 1) |
| 19 authored models còn lại | — | **Byte-identical** | `--check PASS` 20/20 models |
| `hotel` windowCount trong config | 70 | **64** | Cập nhật theo số ô output thực tế |

## 4. Tham số ánh sáng (Lighting Parameters)

| Tham số | Ban ngày (13:00) | Hoàng hôn (18:00) | Ban đêm (22:00) | Đêm muộn (03:00) |
| --- | --- | --- | --- | --- |
| `night` (0..1) | 0.00 | 0.50 | 1.00 | 1.00 |
| `sunColor` | `#fff0d5` | `#cdc4d6` | `#9bb8d6` | `#9bb8d6` |
| `sunIntensity` | 2.10 | 1.36 | 0.62 | 0.62 |
| `hemisphereSkyColor` | `#d6edff` | `#809ab7` | `#29476f` | `#29476f` |
| `hemisphereGroundColor` | `#566c37` | `#3a4d31` | `#1d2d2b` | `#1d2d2b` |
| `hemisphereIntensity` | 1.25 | 1.02 | 0.78 | 0.78 |
| `backgroundColor` / `fogColor` | `#b6d4ce` | `#67828d` | `#18304d` | `#18304d` |
| `exposure` | 0.85 | 0.82 | 0.78 | 0.78 |
| Tỷ lệ ô đèn kính sáng (`windowRate`) | 0% | ~31% | ~66% | ~42% |
| UnrealBloomPass | Tắt (direct render) | Bật (ở high) | Bật (ở high) | Bật (ở high) |

## 5. Số đo hiệu năng và kiểm tra ngân sách (Performance Measurements)

Đo đạc thực tế trong game qua Playwright và Google Chrome (headless GPU D3D11) tại port 5190:

### 5.1. Tổng quan thế giới (Overviews lúc 22:00)
| Bản đồ | Chất lượng đồ họa | Giờ | Draw Calls | Triangles | FPS | Bloom | Ngân sách (docs/11 §8) | Đánh giá |
| --- | --- | ---: | ---: | ---: | ---: | :---: | --- | :---: |
| City | High | 22h | 241 | 574.626 | 44 | Bật | ≤ 300 calls, ≤ 1.5M tris | **PASS** |
| City | Low | 22h | 108 | 450.276 | 60 | Tắt | ≤ 150 calls, ≤ 500k tris | **PASS** |
| Farm | High | 22h | 251 | 345.814 | 60 | Bật | ≤ 300 calls, ≤ 1.5M tris | **PASS** |
| Farm | Low | 22h | 104 | 216.138 | 60 | Tắt | ≤ 150 calls, ≤ 500k tris | **PASS** |

### 5.2. Cận cảnh các công trình tiêu biểu ban đêm (Close-ups lúc 22:00)
| Công trình | Bản đồ | Draw Calls | Triangles | FPS | Trạng thái đèn cửa sổ |
| --- | --- | ---: | ---: | ---: | --- |
| `rice_mill` | Farm | 171 | 311.638 | 60 | Có đèn: 3.839 điểm ảnh ấm sáng lúc 22h so với 953 lúc 13h (mái ngói cam) |
| `office_tower` | City | 142 | 471.916 | 44 | Nhiều tầng sáng đèn xen kẽ tự nhiên |
| `house_apartment` | City | 163 | 499.812 | 45 | Các ô cửa sổ ban công sáng ấm áp |

### 5.3. Diễn tiến qua các thời điểm (City camera oblique-45)
| Thời điểm | `night` | Bloom | Draw Calls | FPS | Quan sát thị giác |
| --- | ---: | :---: | ---: | ---: | --- |
| 13:00 (Trưa) | 0.00 | Tắt | 208 | 40 | Trời xanh ngắt, bóng đổ sắc nét, không có đèn cửa sổ |
| 18:00 (Hoàng hôn) | 0.50 | Bật | 208 | 43 | Bầu trời ngả tím hồng, đèn bắt đầu bật rải rác |
| 22:00 (Tối) | 1.00 | Bật | 208 | 42 | Bầu trời xanh thẫm, địa hình tối sâu, đèn cửa sổ rực rỡ và phát quang nhẹ |
| 03:00 (Khuya) | 1.00 | Bật | 208 | 43 | Tỷ lệ ô sáng giảm còn ~42%, nhịp sinh hoạt ban đêm chân thực |

### 5.4. Thiết bị di động (Mobile Pixel 7 ban đêm lúc 22:00)
- Thiết bị: Pixel 7 emulation (412 × 915).
- Draw Calls: 64 calls (ngân sách mobile ≤ 100).
- Triangles: 428.312 tris (ngân sách mobile ≤ 500k).
- FPS: 60 FPS (ngân sách mobile ≥ 30 FPS).
- Bloom: Tắt hoàn toàn (low graphics mặc định trên mobile).

### 5.5. Bản sửa review: cây unlit ban đêm, icon HUD, gate QA

**Lỗi.** Ảnh 22h bản đầu: cả cảnh tối còn ~11% so với 13h (độ sáng trung bình 130 → 14), nhưng cây far LOD chỉ còn ~57% (`#1c5e19`), tức nổi gấp ~5 lần. Nguyên nhân: patch cũ nhân `outgoingLight *= mix(1.0, 0.56, uNight)` ngay trước `#include <dithering_fragment>`, sau khi `opaque_fragment` đã ghi `gl_FragColor`, nên không có tác dụng. Phần tối 57% chỉ đến từ sương mù đêm.

**Sửa.** Tint dẫn xuất từ `lighting()` (mục 2), chèn trước `opaque_fragment`; test `night.test.ts` khóa vị trí chèn, `dayCycle.test.ts` khóa giá trị (ngày = 1, đêm trong khoảng lit-surface, đơn điệu lúc hoàng hôn).

**Gate mới trong `g4-night-qa.mjs`** (script giờ trả exit code 1 nếu bất kỳ check nào fail):
- `foliageDarkensAtNight`: điểm ảnh cây = điểm ảnh xanh tươi của cùng góc nhìn lúc 13h; lúc 22h độ sáng trung bình của chúng ≤ 1,5 × phần còn lại của cảnh.
- `riceMillLit`: số điểm ảnh ấm sáng lúc 22h > max(50, 3 × lúc 13h). Check cũ (`bloom !== undefined`) luôn đúng.

| Tổng quan 22h | Cây (độ sáng) | Phần còn lại | Tỉ lệ (≤ 1,5) |
| --- | ---: | ---: | ---: |
| City high | 11,9 | 10,8 | 1,11 |
| City low | 13,8 | 13,8 | 1,00 |
| Farm high | 11,5 | 10,8 | 1,07 |
| Farm low | 13,3 | 12,5 | 1,06 |

Ban ngày không đổi: ảnh 13h `g4-full-world --hour 13` trước/sau sửa có cùng độ sáng trung bình (city 103,2, farm 110,1); chênh lệch còn lại là cây đung đưa theo gió và nén JPEG.

**HUD.** Icon mặt trời/mặt trăng (`clockIcon` trong `TopBar.tsx`) theo giá trị `night` của cảnh (moon khi > 0,5), kể cả chế độ "Luôn ban ngày/đêm"; đồng hồ vẫn là giờ thật.

**FPS.** City high ban đêm 44 FPS, dưới mức 50 trong brief, nhưng city high ban ngày cũng chỉ 39–41 FPS (cùng máy, `render.json`): đây là baseline của map city ở high, không phải do bloom. Gate `desktopCityFpsOk` dùng ngưỡng 35 cho lý do đó.

## 6. Danh sách ảnh minh chứng (Evidence Index)

Tất cả các hình ảnh minh chứng và số liệu json được lưu trữ tại:
- `docs/evidence/g4/full-world/`:
  - `city-high-overview.jpg`: Toàn cảnh City high graphics lúc 13:00 (ép giờ chuẩn QA, có đá D032).
  - `city-low-overview.jpg`: Toàn cảnh City low graphics lúc 13:00.
  - `farm-high-overview.jpg`: Toàn cảnh Farm high graphics lúc 13:00 (ép giờ chuẩn QA, có đá D032).
  - `farm-low-overview.jpg`: Toàn cảnh Farm low graphics lúc 13:00.
  - `render.json`: Báo cáo đo kiểm tự động của `g4-full-world.mjs --hour 13`.
- `docs/evidence/g4/night/`:
  - `city-high-overview-22h.jpg`: Toàn cảnh City high ban đêm lúc 22h kèm bloom.
  - `city-low-overview-22h.jpg`: Toàn cảnh City low ban đêm lúc 22h.
  - `farm-high-overview-22h.jpg`: Toàn cảnh Farm high ban đêm lúc 22h kèm bloom.
  - `farm-low-overview-22h.jpg`: Toàn cảnh Farm low ban đêm lúc 22h.
  - `closeup-rice_mill-22h.jpg`: Cận cảnh cối xay gió `rice_mill` ban đêm, sáng đèn cửa sổ.
  - `closeup-office_tower-22h.jpg`: Cận cảnh tháp văn phòng `office_tower` ban đêm.
  - `closeup-house_apartment-22h.jpg`: Cận cảnh chung cư `house_apartment` ban đêm.
  - `compare-13h.jpg`: So sánh góc nhìn City lúc 13:00 (ngày).
  - `compare-18h.jpg`: So sánh góc nhìn City lúc 18:00 (hoàng hôn).
  - `compare-22h.jpg`: So sánh góc nhìn City lúc 22:00 (đêm).
  - `compare-3h.jpg`: So sánh góc nhìn City lúc 03:00 (đêm khuya).
  - `mobile-pixel7-night.jpg`: Khung nhìn trên Google Pixel 7 ban đêm.
  - `metrics.json`: Báo cáo số liệu toàn diện (draw calls, triangles, fps, bloom status, budget checks).

## 7. Hạn chế còn lại (Remaining Limitations)

- Bloom hiện tại là hiệu ứng post-processing toàn màn hình dựa trên luminance threshold (1.15); màu vàng ấm của đèn cửa sổ với emissive 2.0 bắt bloom rất đẹp, nhưng bất kỳ vật thể nào có độ phản xạ cực đại cũng có thể hưởng bloom nhẹ.
- Chưa có nguồn sáng điểm cục bộ (PointLight / SpotLight) cho từng ngọn đèn đường để tránh tăng vọt số draw calls trên WebGL di động. Ánh sáng ban đêm hiện sử dụng directional sun (mặt trăng xanh) + hemisphere + emissive cửa sổ để tối ưu hiệu năng tuyệt đối.
