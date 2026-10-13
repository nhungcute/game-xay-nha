# D037 — Tích hợp các "Công trình biểu tượng" từ `map/nha2`

Ngày: 2026-10-13

## 1. Tóm tắt kết quả (Summary)

> **Cập nhật D038 (2026-10-13):** Thành cổ (`landmark_citadel`) đã **bị gỡ khỏi game**. Review phát hiện mô hình khối vuông bị hỏng hình sau khi simplify: texture 2 × 8192² dồn vào 1024² mất 8 lần độ phân giải, cộng simplify "permissive" làm xoắn UV, nên chỉ còn một khối nâu đen nhàu nát. Gate QA khi đó chỉ đo hiệu năng nên không bắt được. Các mục về Thành cổ bên dưới giữ lại làm lịch sử; ảnh `farm-citadel-*` đã xóa. Game hiện có 3 công trình biểu tượng (city).

**PASS (bản đầu)**. Đã tích hợp 4 "Công trình biểu tượng" (Iconic Landmarks) từ thư mục nguồn `map/nha2` vào game:
- **Cung điện** (`landmark_palace`, 5×5 ô, map `city`, cấp 14, $60.000 + 60 gỗ + 120 đá, xây 3 giờ, decor +15% bán kính 12 ô, giới hạn 1).
- **Lâu đài** (`landmark_castle`, 8×4 ô, map `city`, cấp 16, $90.000 + 80 gỗ + 150 đá, xây 4 giờ, decor +15% bán kính 12 ô, giới hạn 1).
- **Nhà văn hóa** (`landmark_culture`, 7×6 ô, map `city`, cấp 10, $30.000 + 40 gỗ + 80 đá, xây 2 giờ, decor +10% bán kính 10 ô, giới hạn 1).
- **Thành cổ** (`landmark_citadel`, 10×6 ô, map `farm`, cấp 15, $80.000 + 120 gỗ + 200 đá, xây 4 giờ, không hiệu ứng kinh tế, XP theo công thức hiện có, giới hạn 1).

Cả 4 công trình được phân loại chính xác vào danh mục **Công trình** (`buildings`) trên thanh công cụ HUD (không rơi vào Trang trí dù có chỉ số decor). Không có thu nhập/giờ, không dân số, không việc làm; hiệu ứng decor không phụ thuộc đường nối và tuân thủ trần `decorCap` hiện có (30%).

Toàn bộ 4 mô hình xuất xưởng dạng **1 mesh, 1 primitive, 1 material MeshStandard, 1 texture baseColor JPEG ≤ 1024²**, dung lượng mỗi file **< 700 KB** (tổng 4 file 2.217 KB < 2,5 MB ngân sách thế giới).
Tất cả 5 automated gates trong `scripts/landmark-qa.mjs`, toàn bộ test regression trong `g4-night-qa.mjs`, `hud-scale-qa.mjs`, `pnpm test` (769 tests) và `pnpm check` đều PASS 100%.

## 2. Nguồn tài nguyên và quyết định phạm vi

Thư mục `map/nha2` ban đầu có 6 file mô hình. Theo quyết định phạm vi đã chốt:
1. **Loại bỏ 2 file:**
   - `royal_palace_brussel_minecraft.glb`: Giấy phép **CC-BY-NC-4.0** (Non-Commercial), cấm khai thác thương mại, không phù hợp cho bản build game chính thức.
   - `rome_river_side.glb`: Là cả một khu phố bờ sông với mặt nước và nhiều dãy phố liên hoàn, không phải là một công trình đơn lẻ.
2. **Sử dụng 4 file (đều CC-BY-4.0):**

| ID game | Tên hiển thị | File nguồn | Tác giả | Tam giác nguồn | Bbox nguồn (m) | Ghi chú xử lý |
|---|---|---|---|---:|---|---|
| `landmark_palace` | Cung điện | `st_jamess_palace.glb` | QuintusHortensiusHortalus | 4.200 | 0,063 × 0,057 × 0,063 | Đơn vị rất nhỏ; texture PNG 2048²; tháp cổng nhìn về +Z. |
| `landmark_castle` | Lâu đài | `monserrate_palace_-_scale_model_scaniverse.glb` | JFN | 307.404 | 0,76 × 0,28 × 0,36 | Scan 3D; KHR_materials_unlit; texture JPEG 8192²; có tấm đế gỗ màu cam ở y < 0,044. |
| `landmark_culture` | Nhà văn hóa | `pripyat_palace_of_culture_energetik.glb` | AndrewDW | 88.943 | 73,4 × 21,0 × 58,2 | 2 meshes; texture JPEG 1024²; tường bẩn, kính vỡ; bệ thềm rộng. |
| `landmark_citadel` | Thành cổ | `citadel_of_kings.glb` | Cade | 651.678 | 181 × 77 × 105 | Khối Minecraft; 54 meshes; 2 textures PNG 8192²; nền cỏ ngoài tường thành. |

## 3. Pipeline Import (`scripts/import-landmarks.mjs`)

Pipeline được xây dựng độc lập, xử lý deterministic (byte-identical) và hỗ trợ cờ `--check`. Khi thiếu `map/nha2`, script bỏ qua sạch với exit code 0.

Các bước xử lý kỹ thuật:
1. **Nắn chỉnh cây node & Gộp Mesh:**
   - Áp ma trận thế giới (node matrix multiplication) cho toàn bộ các node con;
   - Xoay mặt chính của từng mô hình về hướng −Z chuẩn theo quy ước game (`rotationY = Math.PI`);
   - Gộp tất cả primitives thành đúng 1 mesh, 1 primitive duy nhất với các attribute: `POSITION`, `NORMAL`, `TEXCOORD_0`, và `indices`.
2. **Cắt bỏ phần thừa & Căn chỉnh chân đế:**
   - **Lâu đài (Monserrate):** Loại bỏ toàn bộ tam giác thuộc tấm đế gỗ màu cam (`y < 0.044 m`), kẹp đáy các điểm còn lại tại 0,044 m để bảo toàn bậc thềm sát chân lâu đài, sau đó dịch đáy về `y = 0`.
   - **Thành cổ (Citadel):** Ép phẳng cốt nền cỏ ngoài tường thành tại `y = 0`.
   - **Nhà văn hóa (Pripyat):** Giữ nguyên bệ thềm, dịch chân thềm về `y = 0`.
3. **Ghép Atlas & Tinh chỉnh tông màu Texture:**
   - **Thành cổ:** Ghép 2 texture nguồn 8192² thành 1 texture atlas JPEG duy nhất 1024×1024 (nửa trái là Image 0, nửa phải là Image 1); remap tọa độ UV của các primitive tương ứng (`u * 0.5` hoặc `u * 0.5 + 0.5`).
   - **Lâu đài:** Downscale texture 8192² xuống 1024², chạy giải thuật bù sáng vùng tối (shadow lift với gamma ~0,82) và nắn dải highlight qua đường cong mũ mềm (`shoulder` ceiling 245) để khử vết bóng đổ gắt bị in chết trong texture photogrammetry scan.
   - **Nhà văn hóa:** Nâng sáng tường (luma lift các vùng tối < 100), làm sạch vết ố loang lổ trên tường bê tông, phục hồi kính vỡ thành kính xanh nhạt sạch sẽ.
   - **Cung điện:** Downscale texture 2048² xuống 1024² JPEG chất lượng cao.
   - Mã hóa JPEG bằng encoder JS thuần `jpeg-js` (quality 85) hoàn toàn deterministic.
4. **Vật liệu PBR & Bỏ Unlit/Blend:**
   - Toàn bộ material chuyển sang `MeshStandardMaterial` opaque đặc: metallicFactor = 0, roughnessFactor = 0,85.
   - Loại bỏ `KHR_materials_unlit` (Monserrate) và alphaMode BLEND (Citadel) để các mô hình đón nhận hệ thống chiếu sáng mặt trời, bóng đổ và chu kỳ ngày/đêm 23:00–05:00.
5. **Đơn giản hóa lưới (Meshoptimizer):**
   - Welded các đỉnh trùng lặp thuộc tính.
   - Đơn giản hóa qua `MeshoptSimplifier.simplifyWithAttributes` khóa biên và bảo vệ UV:
     - Cung điện: giữ nguyên 4.200 tam giác (≤ 6.000 cap).
     - Lâu đài: giảm 307.404 → **7.999 tam giác** (≤ 8.000 cap).
     - Nhà văn hóa: giảm 88.943 → **5.999 tam giác** (≤ 6.000 cap).
     - Thành cổ: giảm 651.678 → **9.569 tam giác** (≤ 10.000 cap) bằng cờ Permissive trên lưới khối lập phương voxel.
6. **Căn chỉnh kích thước (Compact & Fit Footprint):**
   - Đặt pivot tại tâm đáy ở `y = 0`.
   - Scale đều theo 3 chiều để chiều rộng và chiều sâu nằm gọn trong `ô × 2 m × 0.92`, chiều cao giữ đúng tỷ lệ thật của công trình.

### Số đo thành phẩm (`scripts/landmarks.config.json`):
- `landmark_palace`: 4.200 / 6.000 tris · 670 KB · Footprint 5×5 (9,2 × 9,2 m, cao 8,43 m)
- `landmark_castle`: 7.999 / 8.000 tris · 474 KB · Footprint 8×4 (14,72 × 7,18 m, cao 5,55 m)
- `landmark_culture`: 5.999 / 6.000 tris · 631 KB · Footprint 7×6 (12,88 × 10,22 m, cao 3,69 m)
- `landmark_citadel`: 9.569 / 10.000 tris · 442 KB · Footprint 10×6 (18,4 × 10,67 m, cao 7,01 m)
- **Tổng 4 GLB:** 2.217 KB (~2,16 MB) < 2,5 MB ngân sách.

## 4. Kinh tế & Cấu hình Content

1. **Tài liệu cân bằng (`docs/16_ECONOMY_AND_BALANCE.md`):**
   - Thêm 3 công trình City vào bảng §6.1 (`landmark_culture`, `landmark_palace`, `landmark_castle`).
   - Thêm Thành cổ vào bảng Farm §7.3 (`landmark_citadel`).
   - Thêm giới hạn số lượng vào bảng §6.2: Sàn 1, Bước/cấp 0, Trần 1 (mỗi thành phố/trang trại chỉ được sở hữu duy nhất 1 công trình mỗi loại).
2. **Sinh Content:**
   - Cập nhật `scripts/generate-content.mjs` đọc trực tiếp từ bảng docs/16 và sinh ra `packages/content/catalog.v1.json`, `economy.v1.json`.
   - Thêm chuỗi bản địa hóa vào `packages/content/i18n/vi.json`: "Cung điện", "Lâu đài", "Nhà văn hóa", "Thành cổ".
   - `pnpm content:check` xác minh byte-identical.
3. **Thanh công cụ HUD (`CategoryBar.tsx`):**
   - Sửa hàm `buildingCategory(def)`: ưu tiên kiểm tra `if (def.id.startsWith('landmark_')) return 'buildings';` trước khi kiểm tra `def.decor`, đảm bảo cả 4 công trình biểu tượng luôn nằm trong mục **Công trình**, không bị đẩy sang Trang trí.
4. **Manifest & Ghi công:**
   - Thêm khối D037 vào `scripts/generate-placeholder-assets.mjs` ghi đè manifest với credits CC-BY-4.0, tác giả gốc, link nguồn Sketchfab và cờ `modified: true`.
   - Bổ sung mã băm content 12 ký tự hex SHA-256 (`hash`) trong `manifest.json` phục vụ cơ chế cache busting URL D034 (`?v=<hash>`).
   - Ghi nhận chi tiết cải biên trong `docs/ASSET_CREDITS.md` để hiển thị trong mục "Ghi công" của panel Cài đặt.

## 5. Kiểm thử QA tự động & Ảnh bằng chứng (`scripts/landmark-qa.mjs`)

Đã thiết lập kịch bản QA `scripts/landmark-qa.mjs`, nạp snapshot full-world của City và Farm, mở các zone kề cận, dọn dẹp vật cản môi trường và đặt cả 4 công trình bằng lệnh `PLACE_BUILDING` kèm `autoFlattenHDm`.

### Kết quả các Automated Gates:
- **Gate 1 (Draw calls tăng ≤ 1 mỗi công trình): PASS**.
  - City đặt 3 công trình: Draw calls tăng +3 (từ 195 lên 198, đúng 1 batch mỗi công trình).
  - Farm đặt Thành cổ: Draw calls giữ nguyên / giảm 1 (từ 253 sang 252).
- **Gate 2 (FPS City High không giảm quá 3 so với baseline): PASS**.
  - FPS baseline: 37,3 FPS → Sau khi đặt 3 công trình: 36,0 FPS (chỉ giảm 1,3 FPS, đạt chuẩn ≤ 3 FPS).
- **Gate 3 (Tổng tam giác trong ngân sách ≤ 1,5M): PASS**.
  - City: 550.952 tam giác (ngân sách 1.500.000).
  - Farm: 369.279 tam giác (ngân sách 1.500.000).
- **Gate 4 (Không lỗi console): PASS** (0 lỗi).
- **Gate 5 (Hiệu ứng Decor): PASS**.
  - Cả 3 công trình City ở trạng thái ACTIVE; nhà dân trong bán kính nhận đúng tỷ lệ decor dưới trần `decorCap`, nhà dân ở xa (> 12 ô) hoàn toàn không bị ảnh hưởng.

### Bằng chứng hình ảnh (`docs/evidence/g4/landmarks/`):
- `city-palace-close-13h.jpg`, `city-palace-close-23h.jpg`: Cung điện cận cảnh ngày và đêm.
- `city-palace-mid-scale.jpg`, `city-palace-low-quality.jpg`: Cung điện so tỉ lệ cạnh nhà thường và chất lượng thấp.
- `city-culture-close-13h.jpg`, `city-culture-close-23h.jpg`: Nhà văn hóa cận cảnh ngày và đêm.
- `city-culture-mid-scale.jpg`, `city-culture-low-quality.jpg`: Nhà văn hóa so tỉ lệ và chất lượng thấp.
- `city-castle-close-13h.jpg`, `city-castle-close-23h.jpg`: Lâu đài cận cảnh ngày và đêm.
- `city-castle-mid-scale.jpg`, `city-castle-low-quality.jpg`: Lâu đài so tỉ lệ và chất lượng thấp.
- `city-landmarks-overview.jpg`: Toàn cảnh quần thể công trình biểu tượng bên bờ vịnh thành phố.
- `farm-citadel-close-13h.jpg`, `farm-citadel-close-23h.jpg`: Thành cổ cận cảnh ngày và đêm.
- `farm-citadel-mid-scale.jpg`, `farm-citadel-low-quality.jpg`: Thành cổ so tỉ lệ cạnh trang trại và chất lượng thấp.
- `farm-citadel-overview.jpg`: Toàn cảnh Thành cổ uy nghi trên thung lũng nông trại.
- `mobile-pixel7-city-landmarks.jpg`: Giao diện di động Pixel 7 nhìn cụm công trình biểu tượng thành phố.
- `mobile-pixel7-farm-citadel.jpg`: Giao diện di động Pixel 7 nhìn Thành cổ nông trại.
- `report.json`: Dữ liệu số đo đo lường tự động của đợt QA.

## 6. Giới hạn đã biết (Known Limitations)

- Do là thế hệ công trình đầu tiên sử dụng texture ảnh (`TEXCOORD_0` + `map`) thay cho mã màu đỉnh (`COLOR_0`), các công trình biểu tượng không có đèn cửa sổ đêm phát sáng instanced như 20 tòa D029/D031. Ban đêm các công trình đón nhận ánh sáng môi trường đêm và đèn đường tự nhiên.
