# 07 — Quy trình tái dựng từ ảnh concept → thế giới 3D thật

## 1. Sự thật kỹ thuật

Một ảnh AI **không chứa** geometry, depth map chính xác, tọa độ camera 3D, hình dạng phía sau cây/núi, bề sâu lòng hồ và tương quan thước đo. Không thể đảm bảo khớp 1:1 toàn bộ bản đồ bằng một thao tác “convert image to 3D”. Quy trình đạt độ trung thực cao phải gồm **tracing + procedural generation + GLB assets + visual iteration**.

Tuyệt đối cấm những cách giả 3D:
- Render ảnh đính kèm làm `PlaneGeometry`, `Sprite`, `background`, `skybox` hoặc ảnh billboard bao trùm.
- Dùng ảnh concept làm diffuse texture cho toàn terrain rồi gọi là có mô hình 3D.
- Chụp 1 góc nhìn rồi che việc map bị biến dạng khi quay camera.

## 2. Bước 0 — Chốt visual contract

- 3 ảnh tham chiếu: `map/map_1.png` (Thành phố), `map/map_2.png` (Quê), `map/map_3.png` (Sinh thái, P2). Hàng rào và ruộng đã cày luống trong ảnh **không** đưa vào template (xem `00 §3`).
- TeamFarmy chỉ là nguồn cảm hứng về camera và phong cách; tuyệt đối không sao chép UI/labels/assets.
- Lock palette tương đối: grass tươi, đất ấm, nước xanh trong, rocks xám ấm, foliage nhiều shade tự nhiên; không cần pixel-perfect HDR screenshot.
- Lock default camera angle và framing mốc địa hình chính để đối chiếu ảnh.

## 3. Bước 1 — Tách layer từ ảnh

AI/họa sĩ kỹ thuật phác theo ảnh một file tài liệu layout 2D (SVG/GeoJSON-like) cho:
1. Outline bờ nước (`water polygon` / river centerline + width).
2. Mảng đất khô/landmass và cliff bands.
3. Trục đường làng tự nhiên (không asphalt, không bridge) và vị trí `ENTRY`.
4. Các vùng đất trống gợi ý (`suggestedLots`).
5. Natural landmarks: thác, đồi, đá lớn, các cụm rừng.
6. Camera framing target (góc nhìn, landmark coordinates tương đối).

Sau đó đặt chúng lên mặt phẳng world X/Z (256 m × 256 m). **Lựa chọn quan trọng:** giữ tỉ lệ và đường bờ làm anchor chính; cây con/bụi cỏ được tạo procedural theo seed sau. Bố cục khu (8 × 8) phải khớp sơ đồ trong `03 §2` / `04 §2`.

### 3.1 Raster hóa sang lưới ô (v2)

Tool `pnpm tooling build-template <layout.json>` chuyển layout vector thành template lưới (`06 §4`):

1. Ô có tâm nằm trong polygon hồ / dải sông → `WATER`. Làm sạch: bỏ ô nước đơn lẻ, lấp lỗ 1 ô.
2. Heightfield 129 × 129 đỉnh (decimét): FBM tần số thấp + mask vùng phẳng + carve đáy nước.
3. Ép luật bờ: đỉnh chung với ô nước kẹp vào `[waterLevel+5, waterLevel+20]`; đỉnh chỉ thuộc ô nước ≤ `waterLevel-5`.
4. Đường làng: ô dọc centerline → `roadTier = 1`; làm mượt dốc dọc tuyến ≤ 5 dm/ô.
5. Gán `biome`, `flags` (`ENTRY`, `PROTECTED` cho thác/vách/landmark).
6. Chạy validator (`06 §4`). Không qua → không xuất file.

Polygon nước vẫn được giữ trong template (`water.lakes/rivers`) để render đường bờ mềm, không răng cưa theo ô.

## 4. Bước 2 — Tạo địa hình

- Heightfield cố định 129 × 129 đỉnh cho lưới 128 × 128 ô (`06 §2`).
- Low-frequency FBM noise tạo địa hình tự nhiên, art-directed masks tạo vùng bằng cho `suggestedLots` và khu bắt đầu.
- Water carve trước rồi làm mượt transition bờ, chú ý lòng suối phải thấp hơn water surface.
- Biome blending triplanar/vertex splat 3–5 lớp: grass, dirt, sand, rock, wet mud.
- Không tạo bề mặt đất quá phẳng đồng nhất hoặc mesh spikes cạnh bờ.
- Khi world chia chunks, phải chia sẻ border heights để không xuất hiện khe nứt.

## 5. Bước 3 — Xây các water bodies

- Hồ: 2D polygon → triangulated water mesh at level; shoreline ring dùng materials transition cát/đá/đầm.
- Suối/sông: curve + width profile; terrain carve dọc spline; mặt nước có normals/waves nhẹ.
- Thác: mesh dải nước chạy theo hướng dốc đá, tạo foam particle/billboard **chỉ như hiệu ứng nước cục bộ** (không dùng billboard làm cả bản đồ). Có thể defer animation trong MVP.
- Template không có bất kỳ bridge/cầu gỗ/bến/sàn quan sát dù ảnh có chi tiết đó. Cầu và kè chỉ xuất hiện khi **người chơi xây** (`15 §7, §9`).

## 6. Bước 4 — Asset pipeline GLB

Các nhóm tối thiểu:
- `tree_deciduous`: 4–8 biến thể.
- `tree_conifer`: 3–6 biến thể.
- `shrub`: 5–10 biến thể.
- `rock`: 6–12 biến thể.
- `grass_cluster`, `reed_cluster`, `wildflower_cluster`: 3–6 biến thể mỗi nhóm.

Ưu tiên CC0 và lưu license. Mô hình đồng nhất style trong Blender:
- transforms applied; pivot dưới chân, meter scale hợp lý; normals consistent; mesh gọn.
- glTF 2.0 `.glb`, PBR đơn giản, texture atlas/material sharing.
- 3 mức LOD cho cây lớn nếu cần.
- Compression: chọn Meshopt/KTX2 sau khi đã chắc chắn loader hỗ trợ, tránh tự động giảm chất lượng quá mức.

## 7. Bước 5 — Scatter chi tiết có kiểm soát

- Phân bố theo `biomeMask`, `waterDistance`, `slope`, `suggestedLots` (tránh), `pathBuffer`, `forestClusters`.
- Dùng Poisson disk hoặc jittered grid; giữ randomness vừa phải, tránh pattern hình vuông.
- Manual anchors cho đá và cây tiêu biểu đối chiếu ảnh; phần còn lại seeded distribution.
- Density theo camera: lô chính thoáng, rìa có cụm rừng, bờ nước có reeds/rocks, sườn dốc nhiều đá.
- **Không dùng cây để che lỗi terrain**.

## 8. Bước 6 — Lighting/material/composition

- Sun/directional light cao trái, ambient/hemisphere light, shadows với cascade hoặc shadow map có giới hạn.
- Nước màu biến thiên theo depth; nên đặt water và terrain cùng tone mapping.
- Camera target căn mốc hình; set orbit bounds tránh chui xuyên terrain hoặc nhìn ra ngoài void.
- Screen-space AO/outline là tùy chọn, ưu tiên chi phí render và rõ hình hơn hiệu ứng nặng.

## 9. Visual match review loop

Mỗi map cần chụp ít nhất 5 screenshot:
1. Default 3/4 isometric nhìn được landmass & water chính.
2. Orthographic top-down kiểm tra bố cục khu và vùng đất trống.
3. Opposite angle 180° kiểm tra geometry thật.
4. Close-up shoreline kiểm tra mép nước.
5. Medium view vegetation và đường đất.

Review theo checklist: 
- [ ] Đường bờ, hồ chính, tỷ lệ khung hình có phù hợp concept?
- [ ] Vùng đất buildable có tương ứng các khoảng trống chủ đạo?
- [ ] Density cây, đá, màu cỏ/đất/nước gần phong cách ảnh?
- [ ] Quay 180° mọi thứ có chiều sâu thật, không thấy tấm ảnh phẳng?
- [ ] Không có cầu/công trình/hạ tầng hiện đại?
- [ ] Không có seams/nhấp nháy mặt nước/clipping terrain?

Sửa lần lượt từ silhouette/topology → terrain → nước → lô đất → vegetation → detail → lighting, **không** chỉnh ngẫu nhiên tất cả một lúc.

## 10. Output QA bắt buộc cho mỗi map

- `layout.json` (vector) + `template.v<N>.json` (lưới) đã qua validator + asset manifest + bản preview render.
- Terrain và water geometry chunks thực.
- Danh sách `suggestedLots`, `entryCells`, ô `PROTECTED`.
- Log seed và generator version.
- 5 screenshot góc nhìn khác nhau.
- Scene chạy browser, dùng mouse/touch xoay được.
- Một báo cáo `visual-review.md` đối chiếu đúng/sai với ảnh gốc và giới hạn.
