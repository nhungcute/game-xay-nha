# 02 — Kiến trúc client Three.js dùng chung cho mọi map

Stack, cấu trúc repo, server: `11`. Dữ liệu: `06`. Luật: `15`.

## 1. Kiến trúc logic

```text
React UI (HUD, panels, dialogs)  ←→  zustand stores (ui, wallet, selection)
          ↓ intent (chọn công cụ, xác nhận)
ToolController (máy trạng thái 08 §2)
  ├── PointerRouter + CameraRig
  ├── Picking (raycast địa hình → ô/đỉnh; raycast công trình/env theo layer)
  └── Preview: sim.validate + sim.previewCost → OverlayRenderer
          ↓ Command
CommandQueue (optimistic, batching, rebase)  ←→  ApiClient  ←→  Server
          ↓ StatePatch
WorldStore (SimState: typed arrays + occupancy + entities)
          ↓ dirty zones / dirty entities
Renderers (Three.js scene)
  ├── TerrainRenderer     ├── RoadRenderer      ├── BridgeRenderer
  ├── WaterRenderer       ├── EmbankRenderer    ├── BuildingRenderer
  ├── EnvRenderer         ├── CropRenderer      ├── OverlayRenderer
  └── Lighting / Sky / VFX / Debug overlay
```

**Luồng dữ liệu một chiều:** lệnh → WorldStore thay đổi → đánh dấu **khu bẩn** / entity bẩn → renderer dựng lại đúng phần đó ở frame kế tiếp. Renderer **không bao giờ** sửa state và không gọi API.

## 2. Ranh giới module

| Module | Trách nhiệm | Không được làm |
|---|---|---|
| `sim` (package) | Luật, validate, apply, settle, BFS đường | Import Three.js/DOM; đọc `Date.now()` |
| `worldgen` (package) | Sinh env xác định theo khu | Phụ thuộc thứ tự tải khu |
| `WorldStore` | Giữ SimState đã xác nhận + lớp lạc quan; phát sự kiện dirty | Render |
| `CommandQueue` | Gửi lô, retry, rebase khi xung đột | Tự sửa state ngoài `sim.apply` |
| `TerrainRenderer` | Mesh địa hình theo khu, vertex color theo `surface`, normal | Quyết định luật dốc |
| `WaterRenderer` | Mặt nước hồ/sông/thác từ template, shader nhẹ | Đổi ô nước (MVP) |
| `RoadRenderer` | Auto-tile instancing theo tier | Tự tạo cầu |
| `EmbankRenderer` | Tường kè theo cạnh giáp nước | |
| `BridgeRenderer` | Ghép module cầu | Kiểm tra hợp lệ cầu |
| `EnvRenderer` | InstancedMesh theo asset × khu; ẩn instance đã dọn | Random lại sau reload |
| `BuildingRenderer` | Instancing theo `defId`; bong bóng trạng thái | Tính tiền |
| `CropRenderer` | Giai đoạn cây trồng theo `now` | |
| `OverlayRenderer` | Lưới, vùng chọn, ghost, khu khóa, màu hợp lệ | |
| `CameraRig` | Orbit/pan/zoom, giới hạn, không xuyên đất | Sửa world |
| `AssetManager` | Tải GLB/KTX2, ref-count, dispose | Dispose asset còn dùng |

## 3. Quy ước

- Ô 2 m, bản đồ 128 × 128 ô (256 m), origin góc tây-bắc, x đông, z nam, y lên.
- Khu = chunk render = 16 × 16 ô (32 m) → 8 × 8 = 64 chunk.
- Độ cao lưu decimét (`Int16`), người chơi thao tác theo bậc 0,5 m.
- Mọi GLB: pivot tâm đáy, 1 unit = 1 m, cửa hướng −Z (xem `13 §3`). Không chữa bằng offset trong runtime.
- Color: sRGB cho texture màu, ACES hoặc Neutral tone mapping (chọn sau khi so với ảnh tham chiếu, khóa trong M1).

## 4. Địa hình có thể sửa

### 4.1 Dựng mesh một khu

- Lưới đỉnh 17 × 17 của khu (gồm cạnh chung) → `BufferGeometry` 16 × 16 × 2 tam giác. Hướng đường chéo mỗi ô chọn theo cặp đỉnh có chênh lệch nhỏ hơn (tránh gợn).
- Vertex color trộn theo `surface` của các ô quanh đỉnh (cỏ, đất, cát, đá, đất cuốc, nền). Biên cỏ có nhiễu nhẹ theo seed để không thấy lưới vuông khi zoom xa.
- Normal tính từ heightfield toàn cục (lấy mẫu cả đỉnh khu bên cạnh) để **không có đường nối sáng/tối** giữa khu.
- Ô `TILLED`: dùng texture chi tiết luống đất (UV world-space, xoay theo hướng dài nhất của vùng ruộng liền kề — P1; MVP theo trục x).
- Váy (skirt) quanh mép bản đồ xuống `minH` để nhìn ngang không thấy hở.

### 4.2 Cập nhật sau lệnh

- `sim.apply` trả danh sách khu bị đổi. Đỉnh trên biên → cả khu kề cũng bẩn (để cập nhật normal).
- Rebuild ≤ 16 ms/khu trên mobile: tái dùng buffer, chỉ ghi lại `position`, `normal`, `color` (không tạo geometry mới).
- Hiệu ứng: nội suy độ cao cũ → mới trong 200 ms (chỉ hiển thị, state đã đổi ngay).

### 4.3 Picking

- Raycast mesh địa hình của các khu đang hiển thị → điểm giao → `(cx, cz)` = `floor(x/2), floor(z/2)`; đỉnh gần nhất cho công cụ san.
- Công trình/env pick qua layer riêng; khi đang dùng công cụ địa hình, bỏ qua layer env/công trình (trừ công cụ Dọn, Phá).
- Xác định công trình bị chạm (xem, thu tiền, phá dỡ) bằng **ô + occupancy** qua `sim.buildingAtCell` (`15 §8.1`), không tự tính hình chữ nhật theo `width/depth` chưa xoay.

## 5. Nước

- Mặt hồ: polygon từ template, triangulate tại `waterLevel`. Sông: dải mesh theo centerline + width. Thác: dải dọc theo vách.
- Ô `WATER` trong lưới phải nằm dưới mặt nước (đáy hồ hạ theo template); validator bảo đảm.
- Shader: màu theo độ sâu (đọc `depthTexture` hoặc nội suy vertex), normal động nhẹ, viền bọt ở mép (theo khoảng cách tới bờ tính sẵn). Mobile: tắt depth texture, dùng màu theo vertex.
- Tường kè (EmbankRenderer) che mép giữa đất và nước ở ô đã kè.

## 6. Thực vật (env) xác định

- `worldgen.generateZone(template, zoneId)` → danh sách `EnvInstance` (thuật toán `06 §4.1`).
- `EnvRenderer`: mỗi `(assetId, zone)` một `InstancedMesh`; map `envId → (mesh, index)` để ẩn instance khi dọn (đặt scale 0 rồi compact khi khu rebuild).
- Thứ tự tải khu không ảnh hưởng kết quả. Env đã dọn (`removedEnvIds`) không bao giờ hiện lại.
- LOD: khu xa camera dùng LOD1; ngoài khu đã mở + 2 khu viền: chỉ cây LOD1 thưa (giữ khung cảnh), không cỏ.

## 7. Đường, kè, cầu, công trình

- **Đường:** mỗi ô đường chọn module auto-tile theo 4 hàng xóm (đường hoặc cầu); InstancedMesh theo `(tier, module)`; đỉnh module bị uốn theo 4 góc ô (vertex shader đọc 4 độ cao qua attribute instance) để bám dốc.
- **Kè:** với mỗi cạnh ô `EMBANKED` giáp nước, đặt module `EDGE` kéo dãn theo chiều cao; góc trong/ngoài dùng module góc.
- **Cầu:** ghép `abutment` tại A, B; `span` cho mỗi ô nhịp; `pier` mỗi 2 ô (đá/bê tông) cắm xuống đáy.
- **Công trình:** InstancedMesh theo `defId` khi số lượng ≥ 4, mesh thường nếu ít; y = độ cao nền (phẳng).
- **Cây trồng:** InstancedMesh theo `(cropId, stage)`; stage cập nhật mỗi giây theo `now`.

## 8. Camera và khung cảnh

- Perspective FOV 40°, góc mặc định theo template (`camera`), xoay 360°, pitch 35–75°, zoom 30–220 m.
- Target bị kẹp trong khu đã mở + 1 khu viền; camera không xuống dưới địa hình + 3 m.
- Ngoài biên bản đồ: địa hình kéo dài thấp (rừng/biển LOD rất thấp) để không nhìn thấy "mép thế giới" ở góc mặc định.

## 9. Ánh sáng

- 1 `DirectionalLight` (nắng, cao trái) đổ bóng, shadow camera bám theo target camera, bao ~120 m.
- `HemisphereLight` trời/đất. Không dùng nhiều đèn động.
- Sương mù nhẹ theo khoảng cách để che LOD xa.
- Khóa `toneMappingExposure`, cường độ đèn và palette ở M1 bằng cách so ảnh chụp với ảnh tham chiếu; tiêu chí đọc được chi tiết ở `10 §5`. Prototype dùng exposure cao (≈ 1,5) làm cỏ, cây, đất nhạt và khó phân biệt — tránh lặp lại.

## 10. Quản lý tài nguyên

- `AssetManager` ref-count theo `assetId`; đổi map chỉ dispose asset không còn map nào dùng.
- Geometry khu, InstancedMesh, material riêng của world dispose khi rời world.
- Kiểm tra `renderer.info.memory` sau khi đổi map (test `10 §4`).

### 10.1 Quy tắc sở hữu tài nguyên GPU

Bài học từ prototype: ghost preview bị gỡ khỏi scene nhưng không dispose (geometry tăng mỗi lần đổi công cụ); `group.clear()` không giải phóng gì; phá một công trình lại dispose material dùng chung.

| Loại tài nguyên | Chủ sở hữu | Ai được dispose | Khi nào |
|---|---|---|---|
| Geometry/material/texture từ GLB | `AssetManager` | Chỉ `AssetManager` | Ref-count về 0 |
| Material dùng chung (palette, ghost xanh/vàng/đỏ) | `MaterialLibrary` (singleton theo world) | Chỉ `MaterialLibrary` | Rời world |
| Geometry khu địa hình | `TerrainRenderer` | `TerrainRenderer` | Rời world (rebuild tái dùng buffer, không tạo mới) |
| InstancedMesh | Renderer tạo ra nó | Renderer đó | Khu bị unload / rời world |
| Ghost preview | `OverlayRenderer` | `OverlayRenderer` | **Không tạo lại theo công cụ** — xem dưới |

Quy tắc bắt buộc:
1. **Entity không bao giờ dispose tài nguyên dùng chung.** Phá dỡ công trình = bỏ instance khỏi InstancedMesh hoặc gỡ node; không gọi `material.dispose()` trên material của `MaterialLibrary`/`AssetManager`.
2. **Ghost dùng pool:** mỗi `defId` một ghost được tạo lần đầu cần, dùng geometry của `AssetManager` + 3 material ghost dùng chung (xanh, vàng, đỏ); đổi màu = đổi tham chiếu material, **không clone material**. Đổi công cụ chỉ `visible = false`. Pool giải phóng khi rời world.
3. Tạo geometry/material mới lúc chạy (ngoài lúc tải world) chỉ được phép trong hàm có cặp `create…/dispose…` rõ ràng và có test rò rỉ.
4. Cấm dùng `Object3D.clear()` / `remove()` để "dọn" nội dung do mình sở hữu mà không gọi hàm dispose tương ứng trước.
5. Ở `?debug=1`, panel hiển thị `renderer.info.memory.geometries/textures` và số program; test rò rỉ ở `10 §4.1`.

## 11. Lỗi và debug

- Lỗi tải asset: hiển thị tên asset, mapId, nút Thử lại; game vẫn chạy với mesh placeholder **có đánh dấu** (hộp màu hồng) — chỉ trong dev, production thì chặn vào world.
- `?debug=1`: panel hiệu năng (`11 §10`), hiện lưới khu, độ cao đỉnh dưới con trỏ, mã ô, occupancy.
- `window.__debug`: `getStateHash()`, `listSceneObjectTypes()`, `orbit(deg)`, `screenshot()` cho E2E.
