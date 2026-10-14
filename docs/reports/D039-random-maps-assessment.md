# D039 — Đánh giá: Map ngẫu nhiên toàn bộ có ràng buộc

Ngày: 2026-10-14 · Trạng thái: **đề xuất, chưa triển khai**

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
