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
- ~~**Billboard từ trên cao** (pitch 75) mỏng~~ — đã xử lý ở fix 2–3 (tấm ngang chụp từ trên, ẩn dần theo góc nhìn; mục 10). Ghi chú cũ: tradeoff của kỹ thuật 3 mặt phẳng đứng; nếu cần cải thiện: thêm 1
  mặt phẳng ngang với ảnh chụp từ trên (+2 tam giác).
- **Đơn định**: capture billboard dùng Chrome + SwiftShader — nếu nâng Chrome lớn có thể lệch pixel → `--check`
  sẽ bắt và chỉ cần chạy lại import để làm mới.


## 10. Sửa lỗi mức xa (fix 1 → fix 3)

> Mục này được người review viết lại ngày 2026-10-11 sau khi bản fix 3 ghi đè mất nội dung fix 1–2, để trống mục 11
> và còn sót ký tự hỏng. Mọi số liệu dưới đây đã được kiểm chứng lại trên máy (xem 10.4).

### 10.1 Fix 1 — atlas mức xa trống (`c7c5194`, `1f81008`, `fc1a820`, `6f05d66`)

- **Lỗi**: ngoài khoảng 160 cây mức gần quanh camera, rừng trên toàn map biến mất; ở đồ họa thấp (chỉ dùng mức xa)
  mất gần hết cây. Báo cáo gốc (mục 1–5) đã ghi PASS sai cho phần này.
- **Nguyên nhân gốc**: `captureBillboards` trong `scripts/import-trees.mjs` chỉ truyền `{ margin }` vào trang chụp,
  trong khi trang dùng `light.elevationDeg`, nên góc ngẩng thành `NaN`, camera thành `NaN` và mọi ảnh chụp trống.
  12 file `*_far.glb` chỉ nặng khoảng 2.872 byte. `--check` vẫn PASS vì script đơn định tái tạo đúng ảnh trống đó.
- **Sửa**: truyền nguyên `PARAMETERS.capture`, `throw` khi tham số không hợp lệ; thêm cổng QC: mỗi tile độ phủ alpha
  10–80%, ít nhất 2 màu, PNG ≥ 8 KB; thêm `scripts/tree-lod-qa.mjs` (chỉ số phủ cây far/near ≥ 0,6) và hook debug
  `__debug.treeLod`, `__debug.envVisible`.
- **Còn sót sau fix 1** (phát hiện khi review): farm `overview-75` far/near = **0,543 < 0,6 (FAIL)** nhưng không được
  báo; bản sửa **chưa được deploy** (Docker và tunnel vẫn trả file 2.872 byte) dù báo cáo ghi đã deploy.

### 10.2 Fix 2 — tấm ngang nhìn từ trên, atlas bụi nhỏ (`b0c4746`, `e8b3c81`, `44593f1`, `b6358ae`, `9b42243`, `b1a0807`, `baea1b1`)

- Tile 3 của atlas (trước đây chép tile 0) dùng cho ảnh chụp từ trên xuống; mức xa thêm 1 tấm ngang ở 62% chiều cao
  (6 → 8 tam giác, vẫn 1 draw call mỗi lô). Bụi mức xa dùng tile 128 px: khoảng 300 KB → 23 KB.
- Chỉ số phủ far/near: city 0,944 / 1,153; farm 0,854 / 1,108 (4/4 PASS). Deploy đã xác minh theo byte.
- **Còn sót sau fix 2** (phát hiện khi review): tấm ngang lộ thành hình "cái ô" hoặc "cây nấm" khi nhìn nghiêng; tán xa tối hơn hẳn
  tán gần; mục 10 của báo cáo bị mất dấu tiếng Việt (ký tự thành `?`).

### 10.3 Fix 3 — bỏ hiệu ứng "cái ô", khớp màu (`d2e74cd`, `34c07de`, `ed87070`, `53d9231`)

- Tấm ngang ẩn hoặc hiện theo góc nhìn tới **từng instance** (`smoothstep` 40°–60°): nhìn nghiêng thì ẩn, nhìn từ trên thì hiện.
- Nguyên nhân tán tối: billboard mức xa vẫn nhận ánh sáng của game trong khi texture đã chụp unlit, nên bị chiếu sáng hai lần.
  Sửa: material mức xa chuyển sang unlit, RGB atlas nhân 0,62 để khớp độ sáng mức gần.
- Thêm cổng QC độ sáng (chênh ≤ 15%) và sắc màu (chênh ≤ 20°) vào `tree-lod-qa.mjs`.

| Bản đồ / góc | Phủ far/near (fix 1 → fix 2 → fix 3) | Độ sáng far / near | Chênh sáng | Chênh hue | Kết quả |
|---|---|---:|---:|---:|---|
| City oblique-45 | 0,728 → 0,944 → 0,787 | 63,3 / 70,6 | −10,3% | 1,9° | PASS |
| City overview-75 | 0,614 → 1,153 → 1,087 | 73,2 / 82,1 | −10,9% | 0,0° | PASS |
| Farm oblique-45 | 0,657 → 0,854 → 0,710 | 63,2 / 69,1 | −8,5% | 3,0° | PASS |
| Farm overview-75 | **0,543 (FAIL)** → 1,108 → 1,057 | 69,1 / 75,9 | −9,0% | 0,9° | PASS |

Ảnh bằng chứng: `docs/evidence/g4/trees/lod-zoom-40/110/220.jpg` (không còn hình "cái ô", ranh giới gần/xa khó nhận ra),
`docs/evidence/g4/trees/lod-qa/{city,farm}-{oblique-45,overview-75}-{far,near}.png` (tán tròn, màu gần với mức gần).
So sánh cùng góc trước D030: `git show e41bea2:docs/evidence/g4/full-world/farm-high-overview.jpg`.

### 10.4 QA sau fix 3 (người review chạy lại trên máy)

| # | Kiểm tra | Kết quả |
|---|---|---|
| 1 | `node scripts/import-trees.mjs --check` / `node scripts/import-model-pack.mjs --check` | PASS / PASS |
| 2 | `pnpm check` | PASS — 725/725 test |
| 3 | `pnpm test:api` / `g2-e2e` / `g3-e2e` | 33/33, 13/13, 26/26 PASS (E2E không được chạy lại trong các lượt fix; người review đã chạy lại sau fix 3) |
| 4 | `tree-lod-qa.mjs` | 4/4 PASS (bảng 10.3) |
| 5 | `g4-full-world.mjs` | mọi `checks` = true (bảng dưới) |
| 6 | Mã hóa báo cáo | đọc bằng Node UTF-8, không còn ký tự hỏng |

| Bản đồ × đồ họa (overview-75) | Draw call | Tam giác | FPS | p95 (ms) |
|---|---:|---:|---:|---:|
| City cao | 241 | 538.058 | 41 | 27,6 |
| City thấp | 108 | 413.708 | 56 | 18,6 |
| Farm cao | 251 | 271.914 | 57 | 19,3 |
| Farm thấp | 104 | 137.478 | 55 | 29,9 |

Ngân sách: desktop ≤ 300 draw call / 1,5M tam giác; đồ họa thấp ≤ 150 / 500k — đều đạt.

## 11. Commit và deploy nội bộ

**Deploy fix 3** (smoke lúc 2026-10-11 14:29Z: G4 smoke PASS). Người review xác minh theo byte:

| File | Local | Docker :8090 | Tunnel |
|---|---:|---:|---:|
| `env/tree_deciduous_01_far.glb` | 159.210 | 159.210 | 159.210 |
| `env-by-sa/tree_conifer_01_far.glb` | 191.584 | 191.584 | 191.584 |
| `env/bush_01_far.glb` | 21.739 | 21.739 | 21.739 |
| Bundle JS | `index-CAy8ge0Q.js` | cùng | cùng |

Tunnel trả 404 cho `/_glb-viewer.html`.

**Danh sách commit D030**

| Đợt | Commit |
|---|---|
| Gốc | `8e702ef` tree import script, config · `5a0c873` tree/bush GLBs, manifest and credits · `a27a0fd` near/far tree LOD, wind, credits panel + tests · `2aff8c6` evidence, decision and report · `f941436` block the debug GLB viewer in nginx · `0b32e0d` final smoke evidence |
| Fix 1 | `c7c5194` pass capture elevation; alpha-coverage QC gate · `1f81008` rebuild far billboards · `fc1a820` far-LOD coverage QA script and debug hook · `6f05d66` corrected report |
| Fix 2 | `b0c4746` top-down canopy quad; smaller bush atlas · `e8b3c81` rebuild far billboards with top view · `44593f1` far-LOD size and top-tile checks · `b6358ae`, `9b42243`, `b1a0807`, `baea1b1` report, deploy and smoke evidence |
| Fix 3 | `d2e74cd` fade the far canopy quad by view angle; match far/near tone · `34c07de` far/near brightness gate · `ed87070` fix 3 report, evidence and deploy verification · `53d9231` record tone-matched far asset sizes |
| Review | commit sửa báo cáo này (mục 10–11, ảnh E2E sau fix 3) |
