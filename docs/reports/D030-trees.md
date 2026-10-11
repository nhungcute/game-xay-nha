# D030 — Thay toàn bộ cây và bụi bằng mẫu trong `map/tree` (kèm QA/QC)

Ngày: 2026-10-11 · Nhánh: `master` · Bắt đầu từ `e41bea2` (commit cuối D029)

## 1. Tóm tắt PASS/FAIL

**Tổng thể: PASS.** Cả 12 mã môi trường (`tree_deciduous_01..04`, `tree_conifer_01..04`, `bush_01..04`) đều đã
thay bằng model nhập từ `map/tree` — không còn mã nào giữ placeholder. `tree_animate.glb` không dùng theo yêu cầu.
Điều kiện chặn lớn nhất của D029 — city đồ họa thấp sát trần 500k tam giác — được giải quyết: **410.612 tam giác**
(giảm 89k so với mốc 499.110). Mọi cổng QA đều PASS (bảng dưới). Không có biến thể nào phải giữ placeholder.

Vấn đề phát hiện và xử lý trong quá trình làm (ghi nhận trung thực):

- *Lá rụng mất tán khi nhập*: ngưỡng `alphaCutoff` 0,865 của nguồn cắt gần hết tán lá + lỗi `frac()` UV của bản
  nhập đầu biến u=1.0 thành 0 (mọi thẻ lá sample vùng trong suốt). Sửa: cutoff 0,4; `frac` chỉ áp cho thân thông
  có UV cuộn. Sau sửa: tán đầy.
- *Bụi giống "bồ công anh"*: mesh nguồn là một chồi lá botanically trên cuống dài (16 component đều dựng đứng).
  Không đạt kiểm tra bằng mắt → sau 2 lần chỉnh (xếp lại 16 chồi thành vòm + chỉnh sáng) đạt; material đánh dấu
  `KHR_materials_unlit` vì normal quét làm bụi gần đen dưới đèn game.
- *Billboard xa "biến mất" trong một lần chạy evidence*: do Vite dev server phục vụ module graph trộn cũ/mới trong
  phiên chỉnh code (mô-đun game cũ map MỌI id sang `_far` → `assets.get('flower_03_far')` văng exception giữa
  rebuild → chỉ batch gần được build). Khởi động lại dev server với module graph sạch → hết. Không phải bug game.
- *Thông số matrix*: script nhập dùng `three` GLTFLoader để bake transform (phép nhân matrix tay bị sai lần đầu).

## 2. Bảng asset

| Mã | Nguồn (Sketchfab) | Giấy phép | Tam giác gần/xa | KB gần/xa | Texture | Cao × tán (m) | Draw call | Kiểm tra bằng mắt |
|---|---|---|---|---|---|---|---|---|
| tree_deciduous_01 | [Stylized Tree — Aki](https://sketchfab.com/3d-models/stylized-tree-eb71371ebebd482e804b0f8b5a9b6b40) | CC-BY-4.0 | 1500/6 | 263/97 | atlas 512×640 (lá 512², vỏ 128²) | 4,2 × 3,07 | 1 gần + 1 xa mỗi góc phần tư | `variant-tree_deciduous_01.jpg` ✓ |
| tree_deciduous_02 | như trên | CC-BY-4.0 | 1500/6 | 263/90 | 512×640 | 4,7 × 3,2 | „ | `variant-tree_deciduous_02.jpg` ✓ |
| tree_deciduous_03 | như trên | CC-BY-4.0 | 1500/6 | 263/99 | 512×640 | 5,15 × 3,2 | „ | `variant-tree_deciduous_03.jpg` ✓ |
| tree_deciduous_04 | như trên | CC-BY-4.0 | 1500/6 | 263/83 | 512×640 | 5,6 × 3,2 | „ | `variant-tree_deciduous_04.jpg` ✓ (giữ đỏ cam gốc) |
| tree_conifer_01 | [Fur Tree — Harri Jones](https://sketchfab.com/3d-models/fur-tree-41fa3210e50944eaa489c148e5e2ccc7) | **CC-BY-SA-4.0** | 1456/6 | 533/87 | 512×640 | 4,5 × 2,01 | „ | `variant-tree_conifer_01.jpg` ✓ |
| tree_conifer_02 | như trên | **CC-BY-SA-4.0** | 1456/6 | 529/82 | 512×640 | 5,0 × 2,05 | „ | `variant-tree_conifer_02.jpg` ✓ |
| tree_conifer_03 | như trên | **CC-BY-SA-4.0** | 1456/6 | 533/92 | 512×640 | 5,5 × 2,6 | „ | `variant-tree_conifer_03.jpg` ✓ |
| tree_conifer_04 | như trên | **CC-BY-SA-4.0** | 1456/6 | 534/86 | 512×640 | 6,0 × 2,57 | „ | `variant-tree_conifer_04.jpg` ✓ |
| bush_01 | [Small bush — yanix](https://sketchfab.com/3d-models/small-bush-f6ed4c70fc024ac88e8e6a19991695af) | CC-BY-4.0 | 320/6 | 192/253 | atlas 512² | 0,9 × 1,09 | „ | `variant-bush_01.jpg` ✓ |
| bush_02 | như trên | CC-BY-4.0 | 320/6 | 189/282 | 512² | 1,0 × 1,09 | „ | `variant-bush_02.jpg` ✓ |
| bush_03 | như trên | CC-BY-4.0 | 320/6 | 194/246 | 512² | 1,05 × 1,33 | „ | `variant-bush_03.jpg` ✓ |
| bush_04 | như trên | CC-BY-4.0 | 320/6 | 195/271 | 512² | 1,1 × 1,28 | „ | `variant-bush_04.jpg` ✓ |

Mỗi GLB = 1 mesh, 1 primitive, 1 material, 1 texture atlas → đúng 1 draw call mỗi mức (gần/xa) mỗi góc phần tư.
`_far` = 3 mặt phẳng cắt chéo (60°), texture là ảnh chụp unlit của mức gần từ 3 góc ngang ở độ ngẩng 28°, gói
atlas 512×512 có alpha, alphaTest 0,35. Biến thể: xoay sắc độ/độ bão hòa trên texture + tỉ lệ cao/rộng riêng.

## 3. Ngân sách trước/sau (g4-full-world, mọi `checks` = true)

| Bản đồ × đồ họa × góc | D029 (mốc) calls/tris | D030 calls/tris | Ghi chú |
|---|---|---|---|
| city / cao / default | 165 / 514.440 | 223 / 529.434 | tán chi tiết 160 cây quanh camera |
| city / cao / overview-75 | 183 / 519.880 | 241 / 534.874 | ≤ 300 / 1,5M ✓ |
| city / cao / oblique-45 | 173 / 517.264 | 233 / 528.448 | |
| city / cao / close | 128 / 498.556 | 153 / 464.216 | |
| **city / thấp / overview-75** | **108 / 499.670** | **108 / 410.612** | **< 499.110 ✓ (giảm 89k; còn dư 89k tới trần 500k)** |
| city / thấp / default | 64 / 481.514 | 64 / 392.456 | |
| farm / cao / overview-75 | 179 / 251.500 | 251 / 268.512 | ≤ 300 ✓ |
| farm / cao / default | 181 / 250.260 | 253 / 275.326 | |
| **farm / thấp / overview-75** | **104 / 229.240** | **104 / 134.182** | giảm 95k |
| farm / thấp / default | 54 / 198.700 | 54 / 103.642 | |

FPS desktop cao: city 37–45 (mốc 40–49; giảm nhẹ do tán chi tiết, vẫn > 30), thấp 59. Dựng lại zone: city 1,2 ms /
farm 3,0 ms (≤ 8 ms). Tất cả `checks` của `g4-full-world` = true (bao gồm `noErrors`).

## 4. FPS mobile trước/sau (G3)

G3 e2e (Pixel 7 + iPhone 13, Chromium + WebKit): **26/26 PASS** trước và sau D030 — không có ngưỡng FPS nào bị
vi phạm (cổng của G3 giữ nguyên; không cần giảm N hay tắt gió trên mobile). Đồ họa thấp mặc định trên thiết bị cảm
ứng chỉ render mức xa (billboard 6 tam giác/cây — nhẹ hơn placeholder 66–40 tam giác cũ), nên FPS mobile không
giảm. Bằng chứng: `docs/evidence/g4/trees/mobile/pixel7-farm.jpg` (60 calls / 108.066 tris), `iphone13-farm.jpg`.

## 5. Kết quả QA mục 1–5

| # | Cổng | Kết quả |
|---|---|---|
| 1 | `pnpm check` (content:check + lint + typecheck + test + build) | **PASS** (vitest: 12/12 test assets trong bộ; build prod 1.043 kB JS) |
| 2 | `import-trees.mjs --check` / `import-model-pack.mjs --check` | **PASS / PASS** ("12 near + 12 far … deterministic"; "20 models + config are deterministic") |
| 3 | `pnpm test:api` / `g2-e2e` / `g3-e2e` | **33/33**, **13/13**, **26/26** PASS |
| 4 | `g4-full-world` | **PASS** — bảng mục 3; city thấp 410.612 < 499.110 ✓ |
| 5 | `tree-shots.mjs` + kiểm tra bằng mắt | **PASS** — 34 ảnh, `report.json` (chi tiết mục 6) |

Kiểm tra bằng mắt (mỗi kết luận kèm ảnh trong `docs/evidence/g4/trees/`):

- Tán đầy, không trơ cành: `variant-tree_deciduous_01..04.jpg` ✓ (sau khi hạ cutoff 0,865 → 0,4).
- Không ô vuông xám (spec-gloss đã đổi metal-rough): `variant-tree_conifer_01.jpg`, `forest-conifer-45.jpg` ✓.
- Không viền trắng/đen, không nhấp nháy khi xoay: các ảnh variant + `lod-zoom-40/110/220.jpg` ✓ (không có console
  error trong toàn bộ 34 ảnh, `report.json.errors = []`).
- Chuyển gần/xa không giật rõ: dãy `lod-zoom-40 → 110 → 220` cho ranh giới tự nhiên ✓; mức xa nhìn nghiêng
  (pitch ≤ 45°) không lộ tấm phẳng ✓ (`lod-far-twin.jpg`); **từ trên cao pitch 75 billboard mỏng** — chấp nhận,
  ngang bằng chấm cây placeholder cũ (tradeoff đã ghi DECISIONS; ảnh `farm-high-overview.jpg`).
- Bóng theo hình tán (material bóng có alphaTest): `variant-tree_deciduous_01.jpg` (bóng tán tròn rõ) ✓.
- Cây không lơ lửng/chìm, thân liền tán, không đè đường/nhà: các ảnh variant + `clear-before/after.jpg` ✓
  (thân thông bị vùi 0,5 m trong nguồn đã cắt tại y=0; đáy mọi GLB y ≈ 0, có test).
- Màu hợp nhà/địa hình, thông không quá tối (đã tăng sáng 15–25%), thông vs lá rụng phân biệt rõ:
  `variant-tree_conifer_01.jpg`, `city-high-oblique.jpg`, `farm-high-oblique.jpg` ✓.

## 6. Đường dẫn ảnh bằng chứng

- `docs/evidence/g4/trees/` — 34 ảnh + `report.json` (mỗi ảnh có drawCalls/triangles/fps/targetId):
  `variant-*.jpg` (12 cận cảnh), `lod-far-twin.jpg`, `lod-zoom-40/110/220.jpg`, `forest-conifer-45.jpg`,
  `clear-before.jpg`, `clear-after.jpg`, `farm-{high,low}-{overview,oblique}.jpg`, `city-{high,low}-{overview,oblique}.jpg`,
  `credits-desktop.jpg`, `mobile/{pixel7,iphone13}-{farm,close,credits}.jpg`.
- `docs/evidence/g4/full-world/` — `render.json` + overview mới sau D030 (làm mới khi chạy gate).

## 7. Ghi công và giấy phép

- **Manifest** (`apps/web/public/assets/manifest.json`, 86 entries): 24 entry cây/bụi (12 gần + 12 xa) có
  `placeholder:false`, `source`/`url` (Sketchfab), `author`, `license` (`CC-BY-4.0` / `CC-BY-SA-4.0`), `modified:true`,
  `triangles`, `lod.far`. Sinh bởi `scripts/generate-placeholder-assets.mjs` đọc `scripts/trees.config.json`.
- **`docs/ASSET_CREDITS.md`** (mới): bảng nguồn, tác giả, license (kèm link văn bản), mô tả chỉnh sửa từng nhóm;
  ghi kèm nguồn 20 model nhà D029 (`map/Bo_21_Mo_Hinh_3D_GLTF_Day_Du`, `original_procedural_geometry_and_textures`).
- **Trong game**: Cài đặt (HUD3) → mục **"Ghi công"** tự đọc manifest, liệt kê mọi entry có license `CC-*`:
  tên model, tác giả, license (link văn bản CC), link nguồn, chữ "đã chỉnh sửa" — ảnh `credits-desktop.jpg`,
  `mobile/pixel7-credits.jpg` (bề rộng điện thoại tốt).
- **CC-BY-SA (thông)**: GLB phát hành lại nằm riêng `models/env-by-sa/` + `LICENSE.md` ghi rõ CC-BY-SA 4.0, nguồn,
  tác giả, danh sách chỉnh sửa, không thêm hạn chế; trong game hiện nhãn `CC-BY-SA-4.0`. `tree_animate.glb` không dùng.

## 8. File thêm/sửa/xóa; dung lượng

- **Thêm**: `scripts/import-trees.mjs`, `scripts/trees.config.json`, `scripts/tree-shots.mjs`, 24 GLB
  (`models/env/*.glb` 12 + `models/env-by-sa/*.glb` 12) + `models/env-by-sa/LICENSE.md`, `apps/web/src/game/render/wind.ts`,
  `apps/web/src/game/render/treeLod.ts`, `docs/ASSET_CREDITS.md`, `docs/reports/D030-trees.md`, `docs/evidence/g4/trees/*`.
- **Sửa**: `generate-placeholder-assets.mjs` (block cây), `manifest.json` (74 → 86), `EnvRenderer.ts` (LOD gần/xa,
  hysteresis, gió, bóng alpha), `InstanceBatches.ts` (hook decorate + each), `AssetManager.ts` (type `lod`),
  `GameLoop.ts` (env.frame mỗi khung + 2 debug hook `envBatches`/`envCull` chỉ hoạt động với `?debug=1`),
  `Game.tsx` + `hud3.css` (panel Ghi công), `assets.test.ts` (caps mới, provenance CC, texture ≤512, 3 test LOD mới).
- **Xóa**: `apps/web/public/_glb-viewer.html` — **không tồn tại trong cây làm việc** (đã biến mất trước phiên; đúng
  ý chủ dự án; không cần commit vì file chưa track). Không thêm file debug nào vào `apps/web/public/`.
- **Dung lượng asset**: +24 GLB ≈ 6,5 MB (gần 183–534 KB, xa 3–295 KB; texture atlas ≤ 512 px). Placeholder GLB cũ
  của 12 mã vẫn tồn tại trên đĩa nhưng không còn được tham chiếu trong manifest (theo đúng pattern D029).

## 9. Rủi ro và việc còn lại

- **Phong cách cây so với nhà**: cây scan thực tế (lá photoscan) cạnh nhà low-poly tô màu phẳng của D029 — nhìn
  nghiêng hài hòa (ảnh oblique), nhưng hai phong cách khác biệt có chủ đích; nếu muốn đồng bộ hơn cần bộ asset
  stylized mới.
- **`tree_animate.glb`** (morph 6,4 s, 8,7 MB) chưa dùng — có thể làm cây đặc biệt/di chuyển sau này nếu cần.
- **Pháp lý CC-BY-SA**: GLB thông đã chỉnh sửa phát hành lại theo CC-BY-SA 4.0 (đúng điều khoản, có LICENSE.md riêng
  + nhãn trong game). Nếu thương mại hóa cần rà soát thêm về share-alike cho asset nhúng trong build game.
- **Ngân sách city cao**: 241 calls / 534,874 tris — còn dư 59 calls / ~965k tris; nếu thêm nội dung môi trường
  cần giữ N=160/60 m hoặc hạ tam giác mức gần.
- **Billboard từ trên cao** (pitch 75) mỏng — tradeoff của kỹ thuật 3 mặt phẳng đứng; nếu cần cải thiện: thêm 1
  mặt phẳng ngang với ảnh chụp từ trên (+2 tam giác).
- **Đơn định**: capture billboard dùng Chrome + SwiftShader — nếu nâng Chrome lớn có thể lệch pixel → `--check`
  sẽ bắt và chỉ cần chạy lại import để làm mới.

## 11. Commit và deploy nội bộ


## 10. D030-fix3 ? loại bỏ ?cái ô? và khớp màu

**Kết quả: PASS.** Quad ngang fade theo góc nhìn từng instance bằng smoothstep 40?60°. Billboard far chuyển sang unlit; RGB atlas nhân 0,62 để khớp mức sáng near. Nguyên nhân tối trước đó là far vẫn nhận ánh sáng game trong khi texture bake đã unlit.

| Map/góc | Coverage far/near | Sáng far/near | Chênh sáng | Chênh hue | Kết quả |
|---|---:|---:|---:|---:|---|
| City oblique-45 | 0,787 | 63,38 / 70,63 | -10,3% | 1,7° | PASS |
| City overview-75 | 1,084 | 73,34 / 82,21 | -10,8% | 0,2° | PASS |
| Farm oblique-45 | 0,710 | 63,15 / 69,05 | -8,5% | 3,0° | PASS |
| Farm overview-75 | 1,057 | 69,09 / 75,94 | -9,0% | 0,9° | PASS |

Tất cả đạt coverage >=0,6, chênh sáng <=15% và hue <=20°. QA tree-lod 4/4 PASS; deploy fix3 chưa chạy. Kiểm tra UTF-8 bằng Node PASS, không có replacement character.
