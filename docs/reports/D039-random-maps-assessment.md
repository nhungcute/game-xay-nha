# D039 — Đánh giá: Map ngẫu nhiên toàn bộ có ràng buộc

Ngày: 2026-10-14 · Cập nhật: 2026-10-15 · Trạng thái: **đã triển khai bước 1–4 sau cờ `RANDOM_MAPS` (mặc định tắt); gate cân bằng kinh tế chưa đạt, xem §8.4**

> Các mục §1–§7 là bản đánh giá gốc (giữ nguyên). Kết quả triển khai và số đo nằm ở **§8**.

Yêu cầu của chủ dự án:

- Mỗi world **tạo mới** có map ngẫu nhiên toàn bộ: địa hình gồ ghề, sông, ao hồ, cây, đá.
- Nước (sông + hồ) chốt **20% diện tích map**.
- **Bỏ đường vào làng mặc định**.

## 1. Kết luận

**Làm được, độ khó trung bình–lớn.** Khoảng 60% nền móng đã có sẵn.

- Bộ dựng template, noise địa hình, rải cây/đá theo seed, raster hóa nước và bộ kiểm tra template đều có sẵn.
- Phần phải làm mới:
  - bộ sinh layout ngẫu nhiên có ràng buộc;
  - lưu template riêng cho từng world;
  - bộ kiểm tra khả năng chơi.
- Bỏ đường vào làng: chủ dự án chốt **phương án A**. Mọi ô đường đều tính là có kết nối; người chơi tự làm đoạn đường đất ngắn (rẻ, tiền khởi đầu đủ)
  để nối vào nhà. Mọi luật đường đều đi qua một hàm `roadConnectivity()` nên thay đổi gọn (xem §3).

Nên triển khai sau cờ bật/tắt (`RANDOM_MAPS`). Người chơi cũ giữ nguyên map. Script QA vẫn dùng 2 map cố định để kết quả test ổn định.

## 2. Hiện trạng (đã đo trong code)

| Thành phần | Hiện tại | Tái dùng được |
|---|---|---|
| Lưới | 128 × 128 ô, ô 2 m; cao độ 129 × 129 đỉnh (dm); 64 khu 16 × 16 ô | Giữ nguyên |
| Template | JSON tĩnh `apps/web/public/worlds/<mapId>/template.v<n>.json`, schema `WorldTemplateSchema` (`packages/contracts/src/schema.ts`) | Giữ schema; chỉ nới `entryCells` cho template random (§4.2) |
| Bộ dựng | `packages/tooling/src/authored-template.ts` dựng template từ `AuthoredLayout`: noise địa hình `hash32` số nguyên (deterministic), đồi, hồ đa giác, sông đường tâm + độ rộng, rừng/đá theo vùng chữ nhật, `startZones`, `protectedCells` | **Tái dùng chính**: bộ sinh chỉ cần sinh ra `AuthoredLayout` |
| Layout hiện có | Vẽ tay: `createCityLayout()`, `createFarmLayout()` (`packages/tooling/src/maps.ts`) | Làm mẫu tham chiếu |
| Cây/đá/bụi | Đã rải ngẫu nhiên theo seed + luật mật độ/độ dốc/khoảng cách nước (`generateEnvironment`) | Giữ nguyên, chỉ đổi seed theo world |
| Kiểm tra | `validateTemplate` (`packages/worldgen/src/validator.ts`) | Mở rộng thêm ràng buộc khả năng chơi |
| Nước | city **20,7%**, farm **15,6%**; 2–3 hồ, 1 sông, 1 thác mỗi map | Mốc 20% nằm đúng vùng đã quen |
| Địa hình | chênh cao 18–20 m | Giữ biên độ tương tự |
| Server | `TemplateRegistry` nạp template tĩnh; mỗi world lưu `map_id` + `template_version`; bản lưu (snapshot) là phần thay đổi theo từng khu so với template | Cần thêm kho template theo từng world |
| Client | Online: tải template qua URL tĩnh. Offline: đọc cứng `farm-g1` | Thêm đường tải template theo world |
| Lưu offline | IndexedDB `xay-nha-offline-v1` | Lưu thêm template sinh ra |

## 3. Hệ quả của việc bỏ đường vào làng (quan trọng nhất)

`entryCells` hiện là **gốc của mạng đường**:

- `roadConnectivity()` (`packages/sim/src/roads.ts`) loang từ ô vào làng theo các ô đường liền nhau (kể cả cầu). Ô nào loang tới mới là "có kết nối".
- `access()` quyết định công trình có **thu nhập/hoạt động** hay không, dựa trên việc giáp ô đường "có kết nối".
- Nhiệm vụ city bước 2 *"Làm 6 ô đường có kết nối"* chỉ đếm đường có kết nối.
- `isFarBank()` (`packages/sim/src/banks.ts`) coi **bờ chứa ô vào làng** là "bờ nhà". Hai nhiệm vụ cuối (city: *xây công trình có thu nhập ở bờ bên kia*; farm: *cuốc đất bờ bên kia*) phụ thuộc vào đây.
- Cờ ô `ENTRY`, `validateTemplate` (bắt buộc ≥ 1 ô vào làng, có đường ra mép map) và schema (`entryCells.min(1)`) cũng dựa vào nó.

→ Nếu chỉ xóa đường vào làng mà **không thay luật**, mọi đường đều "không kết nối": **không công trình nào có thu nhập**, và 3 nhiệm vụ bị kẹt.

### Phương án thay thế

| | Phương án | Ưu | Nhược |
|---|---|---|---|
| **A** | Mọi ô đường đều tính là có kết nối | Đơn giản nhất, không thêm nội dung | Mất cơ chế "mạng đường" (cảnh báo đứt đường, cầu nối kinh tế); không có "bờ nhà" để tính nhiệm vụ bờ bên kia |
| **B** | **Nhà làng** (3 × 3, đặt sẵn, không mua, không phá) do bộ sinh đặt trên đất bằng gần tâm khu khởi đầu; mạng đường loang từ các ô đường giáp Nhà làng; "bờ nhà" là bờ chứa Nhà làng | Giữ nguyên cơ chế mạng đường, cầu, cảnh báo đứt đường và toàn bộ nhiệm vụ; người chơi thấy rõ "trung tâm làng"; không có ô đường mặc định | Thêm 1 công trình đặc biệt + model, nâng schema template |
| **C** | Người chơi tự đặt Nhà làng ở bước đầu hướng dẫn | Người chơi tự chọn trung tâm | Phải sửa chuỗi nhiệm vụ city (bước làm đường đứng trước mọi công trình), và trước khi đặt thì không có gì kết nối |

**Chủ dự án chốt: A** (2026-10-14). Lý do: đường đất rất rẻ và tiền khởi đầu đủ, người chơi tự làm đoạn đường ngắn nối vào nhà.
Không cần Nhà làng, model mới hay schema mới cho phần này.

Phạm vi thay đổi của phương án A (rà theo toàn bộ chỗ dùng `connected`/`access`):

| Chỗ | Thay đổi |
|---|---|
| `roadConnectivity()` (`packages/sim/src/roads.ts`) | Không loang từ `entryCells` nữa: **mọi ô `roadTier > 0` và mọi ô cầu đang ACTIVE** là có kết nối |
| `access()`, thu nhập, ngân hàng (`economy.ts`), chợ/xưởng `NO_ROAD_ACCESS` (`farm.ts`), nhiệm vụ BUILD `requiresRoad` (`engine.ts`) | Không sửa: tự dùng luật mới (công trình giáp **bất kỳ** ô đường) |
| Nhiệm vụ city bước 2 `ROAD connected_cells 6` (`generate-content.mjs`) | Đổi thành "Làm 6 ô đường" (kind mới, ví dụ `road_cells`); đếm ô đường người chơi làm (`roadTier && !baseRoadTier`) |
| Cảnh báo "X công trình sẽ mất đường nối" (`ToolController.ts`) | Không sửa: giờ chỉ báo khi công trình mất **mọi** ô đường giáp nó |
| Panel đường D033 (`ObjectPanel.tsx`) | Bỏ "nối với / chưa nối với đường làng" |
| `isFarBank()` (`banks.ts`) | Template có `entryCells` thì giữ nguyên. Template không có (map random) thì "bờ nhà" là **vùng đất khô lớn nhất trong khu khởi đầu** |
| Schema / `validateTemplate` / snapshot | Template random: `entryCells` rỗng, không cờ `ENTRY`, không bắt đường ra mép map; template cũ giữ kiểm tra cũ |

Áp luật kết nối mới cho **mọi map** (kể cả 2 map cũ) để chỉ có một luật. Hệ quả ở map cũ: công trình đang giáp một đoạn đường lẻ
(không nối ra làng) sẽ bắt đầu có thu nhập. Có lợi cho người chơi và hiếm gặp.

Đánh đổi: **cầu mất vai trò nối mạng kinh tế**, vì bờ bên kia xây đường và nhà được ngay khi khu đất đã mở. Cầu chỉ còn dùng cho nhiệm vụ
"Bắc cầu" / "bờ bên kia" và trang trí.

## 4. Thiết kế đề xuất

### 4.1 Bộ sinh (`packages/worldgen/src/random-layout.ts`)

`generateRandomLayout(mapKind, seed, attempt) → AuthoredLayout`. Hàm thuần, chỉ dùng `hash32`/`mulberry32`, không dùng `Math.random` hay `Math.sin`, để cùng seed luôn ra cùng map. Các bước:

1. **Khu khởi đầu:** 4 khu (2 × 2) gần giữa map, tâm được dịch ngẫu nhiên ±1 khu.
2. **Địa hình:** noise nhiều tầng + 3–7 đồi ngẫu nhiên; khu khởi đầu được làm thoải (biên độ thấp); vùng đá/đồi cao dồn ra các khu ngoài. Chênh cao toàn map 12–25 m.
3. **Sông:** 1–2 sông, đường tâm uốn khúc chảy theo hướng dốc, rộng 3–7 ô. Bắt buộc có **một đoạn chạy qua hoặc sát khu khởi đầu**, trong đó có chỗ hẹp ≤ 6 ô (vừa cầu gỗ).
4. **Hồ:** 1–4 hồ, đa giác méo đặt ở chỗ trũng.
5. **Thác:** nếu sông đi qua bậc cao độ ≥ 2 m thì đặt thác ở đó (tùy chọn).
6. **Chỉnh tổng nước về 20% ± 1%**: tăng hoặc giảm độ rộng sông và kích thước hồ, lặp tối đa N lần.
7. **Biome:** rừng ở rìa và quanh nước; vùng đá ở dốc cao. Mật độ cây/đá dùng lại luật scatter hiện có.
8. **Không đặt ô đường nào** (`roadTier` toàn 0, `entryCells` rỗng).
9. **Gợi ý lô đất, camera, bankRegions:** tính tự động (camera nhìn vào tâm vùng đất bằng nhất của khu khởi đầu; bankRegions là các vùng đất khô liền nhau).
10. Dựng template bằng `buildAuthoredTemplate`, chạy **bộ kiểm tra khả năng chơi** (§4.3). Không đạt thì thử `attempt + 1` (tối đa ~50 lần; lưu `attempt` để tái tạo được).

### 4.2 Thay đổi luật và schema

Theo bảng phạm vi ở §3 (phương án A). Schema chỉ cần cho phép `entryCells` rỗng với template random; giữ `schemaVersion: 1` nếu Zod cho phép
nới `min(1)` mà không phá template cũ, nếu không thì nâng `schemaVersion: 2` chỉ để đánh dấu "không có đường vào làng".

### 4.3 Bộ kiểm tra khả năng chơi (bắt buộc pass)

| Ràng buộc | Ngưỡng đề xuất | Lý do |
|---|---|---|
| Tổng nước | 20% ± 1% (3.113–3.441 ô) | Chủ dự án chốt |
| Nước trong khu khởi đầu | ≤ 10% | Đủ đất xây giai đoạn đầu |
| Nước mỗi khu khác | ≤ 60% | Tránh khu gần như toàn nước (giá mở khu giảm ½ khi > 50% nước) |
| Đất bằng xây được trong khu khởi đầu (độ dốc ≤ 10 dm, khô) | ≥ 55% số ô | Nhà 2 × 2 tới 4 × 5 đặt được mà không phải san quá nhiều |
| Ô bờ nước trong khu khởi đầu | ≥ 12 | Nhiệm vụ "Kè 4 ô bờ sông" |
| Chỗ bắc cầu | Có đoạn nước ≤ 6 ô nối bờ nhà với bờ bên kia, **cả hai đầu nằm trong khu khởi đầu** | Nhiệm vụ "Bắc cầu gỗ" (cầu gỗ tối đa 6 ô, mở ở cấp 4); farm không có nhiệm vụ mở khu trước bước này |
| Bờ bên kia | ≥ 24 ô khô, bằng, trong khu khởi đầu | Nhiệm vụ xây/cuốc ở bờ bên kia |
| Đất khô liền mạch | Mỗi khu ≥ 40% ô khô | Không có khu "chết" |
| Chênh cao | 12–25 m; độ dốc lớn chỉ ở khu ngoài | Đồi gồ ghề nhưng không vô dụng |
| Cây/đá trong khu khởi đầu | Không chặn quá 25% số ô xây được | Tránh bước "dọn dẹp" quá dài |
| Thời gian sinh | ≤ 300 ms mỗi lần thử trên server | Tạo nhân vật không bị chậm |

### 4.4 Lưu trữ và luồng dữ liệu

- **Server sinh và lưu nguyên template** cho từng world: bảng mới `world_templates (world_id, map_id, generator_version, seed, attempt, template jsonb)`, khoảng 150–250 KB mỗi world.
  - Không dựa vào việc client tự sinh lại: sửa bộ sinh sau này sẽ làm đổi map của người cũ.
  - `map_id` dạng `rnd-<kind>-<seed>`.
- API `GET /api/worlds/:id/template` (cần đăng nhập, có ETag; bản đã sinh không bao giờ đổi). Client dùng API này khi `map_id` bắt đầu bằng `rnd-`, còn lại dùng URL tĩnh như cũ.
- `TemplateRegistry` tra cứu theo `map_id`: tĩnh thì đọc từ file, `rnd-` thì đọc từ DB (có cache bộ nhớ).
- Tạo world (`POST` tạo nhân vật) khi `RANDOM_MAPS=1`: chọn seed ngẫu nhiên, sinh và kiểm tra, lưu template, rồi tạo state như hiện nay. **Xóa world rồi tạo lại** sẽ ra map mới.
- Offline: sinh template ở client với seed ngẫu nhiên và lưu cùng bản lưu trong IndexedDB.
- Người chơi cũ (147 world) **không đổi gì**.

### 4.5 Kinh tế và cân bằng

- Đất xây được và lượng nước dao động theo seed, nên độ khó dao động theo. Dùng economy bot sẵn có (`packages/tooling/src/economy-bot*`) chạy trên ≥ 30 seed mỗi loại map.
  - Gate: thời gian hoàn thành chuỗi nhiệm vụ hướng dẫn và mốc tài sản sau 7 ngày mô phỏng nằm trong ±20% so với map vẽ tay hiện tại.
  - Không đạt thì siết ràng buộc §4.3, không chỉnh kinh tế.
- Bảng xếp hạng tài sản (nếu có) sẽ kém công bằng hơn; chấp nhận được với khoảng dao động ±20%.

### 4.6 Hiển thị

Terrain, nước, bờ, cầu, cây, đá đều dựng từ dữ liệu template nên tự chạy với map mới. Cần kiểm tra bằng mắt:

- sông uốn khúc và thác không méo;
- bờ hồ không răng cưa quá mức;
- minimap đúng;
- ngân sách tam giác và lệnh vẽ vẫn đạt (lưới không đổi; mật độ cây theo luật hiện có).

## 5. Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Map sinh ra không chơi được | Cao | Bộ kiểm tra §4.3 + thử lại; test trên 500 seed mỗi loại map, tỉ lệ đạt trong ≤ 50 lần thử phải là 100% |
| Bỏ đường vào làng làm vỡ thu nhập/nhiệm vụ | Thấp (đã chọn A) | Test sim: công trình giáp bất kỳ đường nào có thu nhập; nhiệm vụ "Làm 6 ô đường"; bờ bên kia trên map không có ô vào làng |
| Map cũ bị ảnh hưởng | Trung bình | Template v1 giữ nguyên hành vi; test hồi quy toàn bộ trên 2 map cũ |
| Độ khó dao động | Trung bình | Gate economy bot ±20% |
| Đổi bộ sinh làm đổi map người cũ | Trung bình | Lưu template vào DB, ghi kèm `generator_version` |
| Dung lượng DB | Thấp | ~250 KB × số world (1.000 world ≈ 250 MB) |
| Template tải chậm | Thấp | ~150–250 KB gzip còn ~60–100 KB, có ETag cache |

## 6. Lộ trình và công sức

| Bước | Nội dung | Công sức |
|---|---|---|
| 1 | Luật kết nối A (`roadConnectivity`, nhiệm vụ đường, panel, `isFarBank`, schema/validator cho template không có ô vào làng) + test | 1 ngày |
| 2 | Bộ sinh `random-layout` + bộ kiểm tra + sweep 500 seed + ảnh minimap | 3–4 ngày |
| 3 | Server: bảng `world_templates`, API template, tạo world theo cờ; client tải template theo world; offline | 2 ngày |
| 4 | Gate economy bot ≥ 30 seed + QA hình ảnh 6 seed mỗi loại map + hồi quy 2 map cũ | 1–2 ngày |
| 5 | Tài liệu, deploy sau cờ `RANDOM_MAPS`, bật cho world mới | 0,5 ngày |

Tổng ước tính: **7–9 ngày công agent**.

## 7. Quyết định cần chủ dự án xác nhận

1. Nước **20% ± 1%**: đã chốt.
2. Bỏ đường vào làng: đã chốt **phương án A** (mọi đường đều tính kết nối; người chơi tự làm đường đất nối vào nhà). Áp cho mọi map.
3. Map cũ giữ nguyên; chỉ world tạo mới (hoặc xóa đi tạo lại) mới random: khuyến nghị.
4. Áp dụng cho **cả city và farm**: khuyến nghị.
5. Các ngưỡng ở §4.3 có thể chỉnh sau khi xem ảnh sweep.

## 8. Kết quả triển khai (bước 1–4)

### 8.1 Bộ sinh (vòng 4) — `packages/worldgen/src/random-layout.ts`

Sweep 500 seed mỗi loại map (`node scripts/random-map-sweep.mjs`, số liệu trong `docs/evidence/g4/random-maps/sweep.json`):

| Chỉ số | City | Farm |
|---|---|---|
| Đạt trong ≤ 50 lần thử | 500/500 (TB 1,03 lần; tối đa 3) | 500/500 (TB 1,03; tối đa 2) |
| Nước (min / TB / max) | 19,90 / 20,01 / 20,21% | 19,92 / 20,01 / 20,21% |
| Tỉ lệ seed có nước ≥ 20,0% | 61,4% | 61,2% |
| Hệ số biến thiên kích thước hồ CV (min / TB) | 0,43 / 0,65 | 0,40 / 0,65 |
| Tỉ lệ ô bờ dốc > 2 m | 0% | 0% |
| Nhịp cầu | 3–6 ô, hai đầu trong khu khởi đầu | 3–6 ô, hai đầu trong khu khởi đầu |
| Góc rẽ lớn nhất của sông trên 12 m (TB / max) | 29° / 46° | 29° / 47° |
| Đoạn sông thẳng dài nhất (độ lệch ≤ 1,5 m; TB / max) | 55 m / 83 m | 54 m / 83 m |
| Thời gian sinh p95 / max (máy đang chạy nhiều tiến trình khác) | 943 ms / 2,2 s | 826 ms / 1,7 s |

Thay đổi so với vòng 3:

- **Nước lệch thấp (19,0–19,96%) → 19,9–20,2%.** Nguyên nhân: các hệ số co giãn bị chặn trên nên vòng hội tụ dừng ở ~19,5%, và CV hồ được đo *trước* khi co giãn
  (nhiều hồ cùng chạm trần bán kính 22 m nên CV thực tế thấp hơn số báo cáo). Nay: một hệ số chung cho mọi hồ (giữ tỉ lệ kích thước, CV đo lại sau co giãn),
  sông co giãn trong ngưỡng rộng hơn, và 0–3 ao nhỏ (8–16 m) ở góc khu bù phần nước còn thiếu mà không làm một khu vượt 60% nước.
  Sông thứ 2 (`r2`) chọn dải ngang/dọc (48 hoặc 208 m) tránh sông chính và nhánh, vì sông chính cắt `r2` làm một khu quá 60% nước.
- **Sông hết "kênh thẳng, góc nhọn".** Bo góc các điểm điều khiển (16 m), thêm uốn lượn hai sóng (bước sóng 55–115 m, biên độ 9–13 m, tắt dần ở mép map và quanh chỗ sông cắt khu khởi đầu),
  rồi nội suy Catmull-Rom, không làm tròn về số nguyên. Sweep đo góc rẽ và đoạn thẳng của từng sông và dùng làm gate (góc ≤ 48°, đoạn thẳng ≤ 100 m).
  Vài khúc cua cắt qua khu khởi đầu vẫn gấp (≈ 45°/6 m, bán kính ≈ 8 m): đây là giá trị chấp nhận được, đã kiểm bằng ảnh.
- Ảnh in-game 8 seed nay không còn bị thẻ "Lên cấp 4!" che (`dismissLevelUp` + chờ; script báo lỗi nếu thẻ vẫn hiện). `sweep.json` ghi kết quả thật của lệnh EMBANK/BUILD_BRIDGE
  trên từng seed in-game (`ingameLive`: cờ accepted, số ô kè = 4, chiều dài cầu, hai đầu cầu).
- Template random có `templateVersion: 1` và `generatorVersion` lưu trong DB là `rnd-v13-meander`.
- Bản `city-coast-01` / `farm-valley-01` / `farm-g1` không đổi (`npx tsx scripts/build-maps.ts` cho cùng hash blob với `HEAD`).

### 8.2 Server và client (bước 3)

- **Migration** `apps/api/migrations/0003_world_templates.sql`: bảng `world_templates (world_id uuid PK → worlds ON DELETE CASCADE, map_id, generator_version, seed bigint, attempt, template jsonb, created_at)`.
- **Tạo world** (`WorldService.createCharacter`): khi `RANDOM_MAPS=1` chọn seed 32 bit ngẫu nhiên, `generateWorldTemplate` + `validateTemplate`, ghi world và template **trong cùng một transaction**
  (`map_id = rnd-<kind>-<seed>`, `template_version = 1`), rồi tạo state như cũ. Cờ tắt thì hành vi y hệt trước (không có dòng nào trong `world_templates`). Cờ nằm ở `config.randomMaps`
  (biến môi trường `RANDOM_MAPS`, truyền qua `infra/compose.yml` với mặc định `0`).
- **`TemplateRegistry`**: id tĩnh đọc từ file như cũ; id `rnd-*` đọc từ DB theo `world_id` qua LRU (32 mục), env sinh từ template. `WorldService.restore` và `commands` dùng template của chính world đó.
- **API** `GET /api/worlds/:id/template`: cần đăng nhập, cùng luật sở hữu với snapshot (tài khoản khác nhận 404, không đăng nhập 401), trả JSON khóa đã sắp xếp (ETag ổn định kể cả sau khi khởi động lại,
  vì `jsonb` không giữ thứ tự khóa), `ETag`, `Cache-Control: private, max-age=31536000, immutable`, `304` khi `If-None-Match` khớp. Với world tĩnh endpoint trả file tĩnh; client vẫn dùng URL tĩnh cho các map đó.
- **Client**: `Root.tsx` dùng `api.template(worldId)` khi `mapId` bắt đầu bằng `rnd-`, ngược lại `/worlds/<mapId>/template.v<n>.json`.
- **Offline** (`VITE_OFFLINE=1`): chế độ random là **tùy chọn** (`?random=1` hoặc `VITE_RANDOM_MAPS=1`) để bản offline mặc định, các script QA cũ và route `farm-g1` không đổi. Khi bật: sinh một map farm ngẫu nhiên ở client,
  lưu cùng bản lưu trong IndexedDB `xay-nha-offline-v1` (khóa `offline-template`), tải lại giữ nguyên map; nút **"Map mới"** trong Cài đặt (chỉ offline random) hỏi xác nhận, xóa bản lưu + template rồi sinh map mới.
  Kiểm bằng `scripts/random-map-offline-qa.mjs` (đạt).
- **Test tích hợp** (`pnpm test:api`, 38/38 đạt, container Postgres tạm): cờ tắt không đổi gì; cờ bật cho `rnd-` map, dòng `world_templates`, ETag/304, lệnh được nhận, tải lại với registry rỗng cho cùng byte và cùng ETag;
  hai world có template khác nhau; tài khoản khác bị chặn; xóa world xóa template; world tạo khi cờ tắt vẫn chạy trên server bật cờ. `scripts/test-api.mjs` nhận thêm `TEST_PG_NAME` để nhiều agent không giẫm lên container của nhau.

### 8.3 QA in-game (bước 4.2) — `scripts/random-map-qa.mjs`

6 seed mỗi loại map (20260100–105), route template vào `**/worlds/farm-g1/template.v1.json`, ảnh nằm ở `docs/evidence/g4/random-maps/qa/` (2 seed mỗi loại; số liệu cả 12 seed trong `qa.json`):

| Gate | Ngưỡng | Kết quả |
|---|---|---|
| Draw call (cảnh tổng quan 13:00 và 23:00) | ≤ 300 | tối đa 257 |
| Tam giác | ≤ 1,5 triệu | tối đa 246.546 |
| Lỗi console | 0 | 0 trên 12 seed |
| Luồng thật: làm đường đất 6 ô → đặt nhà cạnh đường → thời gian trôi → thu nhập | có thu nhập | 12/12 (city: `house_small` + COLLECT +395; farm: `farmhouse`, chợ, cuốc/gieo/thu/bán +48), trang nhận mọi lệnh đã lập kế hoạch bằng sim cục bộ |

Ảnh gồm tổng quan ngày/đêm, cận cảnh sông, cận cảnh hồ và khung luồng thật. Random map không có thác nước (`waterfalls: []`).

### 8.4 Cân bằng kinh tế (bước 4.1) — `scripts/random-map-economy.ts` — **chưa đạt gate**

Economy bot (chính sách `tuned`, phong cách `thuong`, 7 ngày mô phỏng) trên 30 seed mỗi loại map và trên map vẽ tay; bot tự làm đường đất ngắn cạnh công trình (luật A). Số liệu: `docs/evidence/g4/random-maps/economy.json`.
Không có snapshot sai (0/60), mọi lần chạy hợp lệ.

| | Map vẽ tay | Random: trung vị (p10–p90) | Lệch trung vị |
|---|---|---|---|
| City — tài sản sau 7 ngày | 3,14 triệu | 4,48 triệu (4,21–4,85) | **+42,7%** |
| City — hoàn thành chuỗi nhiệm vụ | không xong trong 7 ngày (kẹt ở nhiệm vụ 11 "Bắc cầu") | ngày thứ 0,69 (phiên thứ 2) | không so được |
| Farm — tài sản sau 7 ngày | 108.744 | 133.427 (111.151–158.176) | **+22,7%** |
| Farm — hoàn thành chuỗi nhiệm vụ | 4,69 ngày | 0,69 ngày (0,69–1,04) | −85% |

Phân tích:

- Hai map **giống hệt nhau đến hết nhiệm vụ "Kè 4 ô bờ"** (các nhiệm vụ 1–10 đạt cùng thời điểm, thu nhập/giờ ngày 1–2 lệch dưới 2%: city 1.422→1.430 và 7.946→8.072). Chỉ khác ở **nhiệm vụ "Bắc cầu"** và phần thưởng sau đó.
- Trên random, chỗ bắc cầu (≤ 6 ô) và bờ bên kia nằm **trong khu khởi đầu** (ràng buộc §4.3), nên bot không phải mở thêm khu hay làm đường dài: chuỗi xong trong ngày thứ 2.
  Trên map vẽ tay, chỗ qua sông cách xa (city: nhịp sông 5–11 ô, cầu gỗ tối đa 6 ô; farm: nhiều khả năng cần mở thêm khu và làm đường dài, chưa kiểm riêng) nên bot xong ở ngày 4,69 (farm) hoặc không xong (city). Phần thưởng chuỗi (XP, cấp 10, 102 công trình thay vì 88) tạo chênh lệch tài sản.
- Độ dài nhịp cầu không ảnh hưởng (chi phí cầu gỗ chỉ 80 tiền + 5 gỗ mỗi ô; so sánh theo seed cho thấy chuỗi xong ở ngày 0,5–1,5 bất kể nhịp 3 hay 6).
- Vì vậy không thể đưa gate về ±20% chỉ bằng cách siết ràng buộc trong khuôn khổ §4.3 hiện tại: cách duy nhất là **dời chỗ bắc cầu ra ngoài khu khởi đầu** (buộc phải mở khu trước khi bắc cầu), tức là sửa ràng buộc "cả hai đầu nằm trong khu khởi đầu"
  và nhiệm vụ không mở khu trước bước cầu của farm. Không đụng vào `economy.v1.json` hay chuỗi nhiệm vụ như yêu cầu; **cần chủ dự án quyết định** (a) chấp nhận random map nhanh hơn ở đoạn cầu (tài sản +23%/+43% sau 7 ngày, trùng khít trước đoạn cầu), hoặc (b) cho phép chỗ cầu ngoài khu khởi đầu và sinh lại.
- Phần "chuỗi hướng dẫn" tức thời (`tutorialDone`, qua nhiệm vụ 6) xong trong vài phút ở cả hai loại map, không phân biệt được.

### 8.5 Test và kiểm tra

- `pnpm check`: đạt (content check, lint, typecheck, 781 test, build). Ghi chú: trên Windows với `core.autocrlf=true`, file nội dung sinh ra bị checkout CRLF nên `content:check` báo "stale"; chạy
  `node scripts/generate-content.mjs` một lần (không đổi nội dung trong git) rồi `pnpm check` đạt. Không liên quan thay đổi này.
- `packages/sim/src/invariants.test.ts`: 48–51 s khi máy đang chạy nhiều tiến trình song song (giới hạn 60 s). Thay đổi này không đụng `packages/sim`, nên thời gian phụ thuộc tải máy, không phải do D039.
- Bundle web: chunk chính 1.084 kB (gzip 304 kB) sau khi đưa bộ sinh vào để dùng offline.

### 8.6 Việc còn lại

1. Chủ dự án quyết định về gate kinh tế (§8.4).
2. Bật `RANDOM_MAPS=1` khi deploy (không làm trong nhánh này); đo lại thời gian sinh trên máy chủ thật (≤ 300 ms mỗi lần thử là mục tiêu §4.3; trên máy dev đang tải, một lần sinh mất 0,5–1 s, chủ yếu ở `buildAuthoredTemplate`, không phải bộ sinh layout ~30 ms).
