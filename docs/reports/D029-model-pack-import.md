# D029 — Đưa bộ 21 model 3D vào game AI Farm

Ngày: 2026-10-11. Cổng kiểm tra: web dev offline 5190, web dev online 5191 (proxy API 3217, Postgres dev 55433),
Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`. Quyết định kèm theo: `docs/DECISIONS.md` D029.

## 1. Tóm tắt

**PASS.** 20/21 công trình đã dùng model thật từ bộ `map/Bo_21_Mo_Hinh_3D_GLTF_Day_Du`; mỗi công trình là
**1 mesh · 1 material · 1 draw call**, màu nằm trong `COLOR_0`, cửa hướng −Z, đáy giữa chạm y=0, sẵn tỉ lệ game
2 m/ô khi nạp (không còn ghép lúc runtime). `silo` **giữ placeholder** theo quyết định đã chốt (nguồn
`rural_warehouse` là nhà kho 4×3, sai hình dạng cho ô 2×2). Hai decor 1×1 (`deco_garden`, `deco_flowerbed`) qua
kiểm tra bằng mắt nên **giữ model nhập** (DECOR_1_CELL = try → PASS). Không đổi gameplay, catalog, contracts, sim
hay `contentVersion` (vẫn là 3).

Hai điểm cần biết:
1. **Nguồn là LOD0, không phải LOD1** (lệch so với đề bài, có lý do QC): LOD1 do pack tự sinh phá hỏng hình —
   `city_bank` mất toàn bộ cổng cột. Đã render cả hai LOD để đối chứng
   (`docs/evidence/g4/model-pack/glb-standalone/src-bank.jpg` vs `src0-bank.jpg`). LOD0 + bộ đơn giản hóa của
   script giữ được hình và vẫn nằm trong mọi cap tam giác.
2. **Mục tiêu tam giác 80 % → 70 %**: lần import đầu (80 % cap) làm full-world city ở đồ họa thấp đạt 520k tam giác,
   vượt ngân sách 500k (QC chặn). Giảm mục tiêu xuống 70 % — mọi ngân sách đạt với dư địa
   (city low tối đa 451k). Không nới ngân sách nào.

## 2. Bảng từng model

Mỗi model: 1 mesh, 1 material chung `MeshStandardMaterial` (vertexColors, roughness 0.85, metalness 0, hai mặt),
1 draw call. "Nhóm nền" = các nhóm luôn bị bỏ (`LANDSCAPE_OPTIONAL`, `PATH_OPTIONAL`, `PARKING_OPTIONAL`);
decor và chợ giữ các nhóm nội dung (`GARDEN/FENCE/TRELLIS/PERGOLA/CANOPY/PRODUCE…`, ghi chú trong
`scripts/model-pack.config.json`). Kiểm tra bằng mắt dựa trên ảnh `front-<id>.jpg` (đứng riêng), ảnh 3 góc
trong game và ảnh toàn cảnh.

| game id | model nguồn | nhóm bị bỏ | tam giác nguồn (LOD0) → đầu ra | KB | hệ số co | kích thước sau co (R×C×S m) | draw call | Kiểm tra bằng mắt |
|---|---|---|---|---:|---:|---|---:|---|
| house_small | city_small_house | 2 | 20,144 → 1,186 (cap 1800) | 95 | 0.506 | 3.68×3.36×3.06 | 1 | ✓ mái ngói, cửa nam, ống khói |
| shop_grocery | city_convenience_store | 3 | 6,504 → 1,260 (cap 1800) | 101 | 0.341 | 3.68×3.26×1.86 | 1 | ✓ sạp đỏ sọc, kính xanh xám |
| house_town | city_townhouse | 2 | 6,604 → 1,034 (cap 1800) | 83 | 0.625 | 3.45×5.52×7.12 | 1 | ✓ nhà ống cao, ban công |
| shop_cafe | city_coffee_shop | 2 | 9,716 → 1,256 (cap 1800) | 100 | 0.343 | 3.68×3.07×2.75 | 1 | ✓ gạch đỏ, mái xanh, dù |
| shop_restaurant | city_restaurant | 2 | 14,576 → 1,406 (cap 2500) | 112 | 0.377 | 5.52×4.60×3.38 | 1 | ✓ nửa mái ngói + nửa mái phẳng (đặc tính nguồn), bàn ghế |
| bank | city_bank | 2 | 7,356 → 1,750 (cap 2500) | 139 | 0.599 | 4.95×5.52×4.89 | 1 | ✓ cổng cột + tam hoa giữ nguyên |
| house_apartment | city_apartment | 2 | 26,992 → 1,814 (cap 3500) | 145 | 0.669 | 7.30×7.36×10.49 | 1 | ✓ chung cư gạch đỏ, cao thứ 2 |
| office_tower | city_office_tower | 2 | 22,764 → 2,986 (cap 4500) | 237 | 0.521 | 7.36×7.26×13.94 | 1 | ✓ tháp kính, cao nhất game |
| hotel | city_hotel | 2 | 13,900 → 1,598 (cap 3500) | 127 | 0.681 | 7.36×8.05×9.81 | 1 | ✓ khách sạn kem, mái man-sát |
| shop_supermarket | city_supermarket | 3 | 7,284 → 2,450 (cap 3500) | 195 | 0.388 | 7.36×5.42×2.41 | 1 | ✓ hộp rộng, băng фасade xanh |
| deco_garden | city_flower_garden | 2 | 27,728 → 558 (cap 800) | 45 | 0.180 | 1.52×1.84×0.98 | 1 | ✓ pergola + đài phun + bụi cây (1×1 nhận ra được) |
| deco_park | city_park | 2 | 27,804 → 1,730 (cap 2500) | 138 | 0.358 | 5.52×5.52×1.04 | 1 | ✓ pergola, ghế, đèn; thưa nhưng đọc là công viên |
| farmhouse | rural_farmer_house | 2 | 29,900 → 1,652 (cap 2500) | 132 | 0.593 | 5.52×5.42×3.58 | 1 | ✓ mái đỏ, cửa chớp xanh |
| market | rural_market | 1 | 4,140 → 1,750 (cap 2500) | 139 | 0.487 | 5.52×3.48×1.57 | 1 | ✓ sạp bạt sọc + thùng hàng (giữ nhóm CANOPY/PRODUCE) |
| well | rural_well | 1 | 16,224 → 556 (cap 800) | 45 | 0.279 | 1.84×1.35×1.35 | 1 | ✓ giếng đá + mái đỏ; ròng rọc đơn giản hóa mất (đã ghi §7) |
| chicken_coop | rural_chicken_coop | 1 | 15,500 → 1,656 (cap 2500) | 132 | 0.483 | 5.52×5.52×1.70 | 1 | ✓ chuồng + hàng rào |
| rice_mill | rural_windmill | 1 | 16,584 → 1,734 (cap 2500) | 138 | 0.483 | 5.52×5.52×5.61 | 1 | ✓ cối xay gió; cánh tĩnh (hoạt ảnh §3.3) |
| cow_barn | rural_cowshed | 1 | 21,424 → 2,424 (cap 3500) | 193 | 0.553 | 7.36×5.35×3.74 | 1 | ✓ chuồng trần mở + máng ăn |
| bakery | rural_bakery_oven | 2 | 21,592 → 1,622 (cap 2500) | 129 | 0.551 | 5.52×5.47×3.33 | 1 | ✓ lò bánh, mái sọc kem/xanh |
| deco_flowerbed | rural_flower_bed | 1 | 21,964 → 560 (cap 800) | 45 | 0.296 | 1.84×1.34×1.04 | 1 | ✓ luống gỗ + dây leo (1×1 nhận ra được) |
| silo | — giữ placeholder | — | — | 2 | — | theo placeholder | 1 | ✓ quyết định mục 0: warehouse 4×3 sai tỉ lệ |

Không model nào phải giữ placeholder sau kiểm tra bằng mắt (0/20 sau 1 vòng chỉnh; vòng chỉnh duy nhất là
đổi nguồn LOD1 → LOD0 áp cho tất cả, xem §1). Tổng dung lượng `models/authored/`: **2.5 MB / 20 file**.

## 3. Ngân sách render trước và sau (`scripts/g4-full-world.mjs`, docs/11 §8)

"Trước" = HEAD trước D029 (3 model POC D028 B5 + 71 placeholder); "sau" = 20 model D029.

| Chỉ số (góc xấu nhất) | Trước | Sau | Ngân sách | Đạt |
|---|---|---|---|---|
| City desktop draw calls | 185 | **183** | ≤ 300 | ✓ |
| City desktop triangles | 390,316 | **471,564** | ≤ 1,500,000 | ✓ |
| City low draw calls | 110 | **108** | ≤ 150 | ✓ |
| City low triangles | 370,106 | **451,354** | ≤ 500,000 | ✓ (lần import đầu ở mục tiêu 80 % đạt 520k → giảm mục tiêu còn 70 %, xem §1) |
| Farm desktop draw calls | 182 | **179** | ≤ 300 | ✓ |
| Farm desktop triangles | 230,688 | **248,618** | ≤ 1,500,000 | ✓ |
| Farm low draw calls | 105 | **104** | ≤ 150 | ✓ |
| Farm low triangles | 208,428 | **226,358** | ≤ 500,000 | ✓ |
| Zone rebuild (city/farm) | 2.9 / 2.7 ms | **4.3 / 6.0 ms** | ≤ 8 ms | ✓ |
| Console/page errors | 0 | **0** | 0 | ✓ |

FPS đo được 26–59 tùy thời điểm (máy đang chạy Docker + dev server song song); FPS không thuộc ngân sách chặn,
p95 frame-time và chi tiết từng góc nằm trong `docs/evidence/g4/full-world/render.json`.

## 4. Kết quả QA (mục 4 của đề bài)

| # | Mục | Kết quả |
|---|---|---|
| 1 | `pnpm check` (content, lint, typecheck, test, build) | **PASS** — 31 file / **723/723 test**, build 5.7 s |
| 2 | `node scripts/import-model-pack.mjs --check` | **PASS** — 20 model + config byte-identical; thiếu `map/` → thoát 0 (CI an toàn) |
| 3 | `pnpm test:api` | **PASS** — 33/33 |
| 4 | `node scripts/g2-e2e.mjs` và `node scripts/g3-e2e.mjs` | **PASS** — 13/13 và 26/26 (Chromium + WebKit mobile) |
| 5 | `node scripts/g4-full-world.mjs` | **PASS** — mọi mục `checks` true (bảng §3), 0 lỗi console |
| 6 | Ảnh model trong game (`scripts/model-pack-shots.mjs`) | **PASS** — **136 ảnh, 0 lỗi**: 20 model × 3 góc (trước/sau/bên) × 2 mức đồ họa, hàng 4 xoay 0/90/180/270, giàn giáo đang xây + vòng nâng cấp (chicken_coop, lệnh UPGRADE thật), toàn cảnh city/farm × cao/thấp; `drawCalls`/`triangles` ghi trong `report.json` |

Kiểm tra bằng mắt (mục 5 của đề bài) — kết luận từng model nằm ở cột cuối bảng §2, tổng hợp:
- **Cửa chính**: mọi GLB nhập về có cửa ở mặt −Z; hàng xoay chứng minh cửa bám theo `rotation` (nhà xoay 180°
  có mặt nam **không** cửa — cửa đã về bắc, đúng công thức `-rotation·π/2 + entranceSide`). Ảnh
  `city-rotations-0-90-180-270-{high,low}.jpg`.
- **Không tràn ô / không đè đường / không lơ lửng – chìm**: ✓ trên toàn bộ ảnh trong game và toàn cảnh.
- **Không lỗ đen / mặt lật / màu sai**: ✓ (kính → xanh xám đậm đặc; mái đúng màu; material hai mặt).
- **Chiều cao**: office_tower cao nhất (13.9 m), apartment thứ hai (10.5 m) — ✓ ở ảnh toàn cảnh.
- **Nhận diện hình ở góc mặc định**: ✓ cả 20; DECOR_1_CELL cả hai đều đạt → giữ model nhập.

## 5. Ảnh bằng chứng (`docs/evidence/g4/model-pack/`)

- `city-<id>-{front,side,back}-{high,low}.jpg`, `farm-<id>-…` — 20 model × 3 góc × 2 mức đồ họa.
- `glb-standalone/front-<id>.jpg` — 20 model chụp riêng nền trắng (nhận diện hình/màu, mặt trước −Z);
  kèm `src-bank.jpg` (LOD1 hỏng cổng cột) vs `src0-bank.jpg` (LOD0 nguyên vẹn) — lý do chọn LOD0.
- `city-rotations-0-90-180-270-{high,low}.jpg` — cửa bám theo xoay; `city/farm-construction-scaffold-*.jpg`
  — giàn giáo khi xây; `farm-upgrade-ring-*.jpg` — vòng giàn giáo khi nâng cấp.
- `city-overview-{high,low}.jpg`, `farm-overview-{high,low}.jpg` — toàn cảnh; `report.json` — metadata + số liệu.

## 6. Thay đổi file

**Thêm**: `scripts/import-model-pack.mjs` (script nhập đơn định + `--check`), `scripts/model-pack.config.json`
(quyết định + số liệu từng model, do script sinh ra), `scripts/model-pack-shots.mjs` (QA ảnh),
`apps/web/public/assets/models/authored/<20 gameId>.glb` (2.5 MB), `docs/reports/D029-model-pack-import.md`,
`docs/evidence/g4/model-pack/**` (136 ảnh + 24 render standalone + report.json), D029 trong `docs/DECISIONS.md`,
devDependency `meshoptimizer@1.3.0` (phát hành 2026-09-25, đã ghim chính xác).
**Sửa**: `apps/web/src/game/assets/AssetManager.ts` (bỏ nhánh fit), `apps/web/src/game/assets/assets.test.ts`
(quy tắc mới + test `--check`), `scripts/generate-placeholder-assets.mjs` (map `AUTHORED` 20 entry, không `fit`),
`apps/web/public/assets/manifest.json`, `package.json` + `pnpm-lock.yaml`, ảnh bằng chứng g2/g3 (chạy lại E2E
với model mới), `docs/evidence/g4/full-world/render.json`.
**Xóa**: `apps/web/src/game/assets/fit.ts` (không còn ai gọi — giữ hỗ trợ `fit` đã cân nhắc nhưng bỏ hẳn theo
điều kiện của đề bài, xem D029), 3 file POC cũ `models/authored/{city_small_house,city_coffee_shop,rural_farmer_house}_lod1.glb`.
**Dung lượng asset**: authored dir 0.93 MB (3 file POC) → 2.5 MB (20 file), +1.6 MB; tổng `dist` web tăng tương ứng
(GLB nạp lười theo manifest, không vào bundle JS).

## 7. Vấn đề còn lại và rủi ro

1. **Màu kính**: 15 material BLEND thay bằng một màu xanh xám đậm đặc — đọc đúng là kính ở mọi model đã duyệt,
   nhưng mất biến sắc giữa các tầng kính (chấp nhận, theo đề bài).
2. **Chi tiết mất khi giảm tam giác**: ròng rọc giếng và cột giếng đơn giản hóa mạnh (well 16,224 → 556), awning
   bàn ghế restaurant còn lại dạng mảnh. Đọc hình vẫn ✓ nhưng không phóng to cận cảnh.
3. **Hoạt ảnh chưa làm** (đề bài §3.3): cánh cối xay giột (`SAILS_ANIMATED`) và ròng rọc giếng đứng yên — ghi nhận
   là việc có thể làm sau; metadata `anchors` giữ sẵn pivot.
4. **Mô hình nguồn có lỗi sẵn**: restaurant nửa mái phẳng (cả LOD0 lẫn LOD1), siêu thị thấp 2.4 m so với nhà ống
   7.1 m — đúng tỉ lệ pack (co đều, không co không đều); có thể cần owner chỉnh nguồn sau.
5. **Ngân sách city low 451k/500k** — dư địa ~10 %; nếu thêm nội dung P1 cần theo dõi lại `g4-full-world`.
6. **`meshoptimizer` WASM assert** với mesh non-manifold (geometrai trùng lớp của pack) — script xử lý bằng cách
   leo thang error + cờ `Permissive`; đã ghi trong code.

## 8. Đề xuất bước tiếp theo

1. Model 3D cho cây/env hiện tại vẫn placeholder — có thể tái dùng pipeline D029 cho bộ env nếu owner có nguồn.
2. Hoạt ảnh cánh cối xay + ròng rọc giếng (metadata đã có pivot).
3. Nhờ owner xem lại restaurant (nửa mái) và supermarket (chiều cao) nếu muốn đúng ảnh tham khảo 2D.
4. Sau khi gắn texture/PBR thật (nếu có), cân nhắc bỏ `doubleSided` để tiết kiệm fill-rate.

## 9. Danh sách commit

1. `<hash>` — feat(d029): deterministic model-pack import script, config and meshoptimizer devDep
2. `<hash>` — feat(d029): 20 imported building GLBs + manifest provenance (silo keeps placeholder)
3. `<hash>` — feat(d029): pre-fitted asset loading, updated asset rules, visual QA shots script
4. `<hash>` — docs(d029): model-pack evidence, D029 decision and import report

(Cập nhật hash thật sau khi commit — xem phần cuối báo cáo nếu cần.)
