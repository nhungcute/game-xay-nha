# Khu đất: overlay 3D các khu mở được

## Quy tắc hiển thị (tool = zone)
| Khu | Hiển thị |
|---|---|
| Mua được ngay (`validate` ok) | tô vàng + viền sáng, nhấp nháy nhẹ, nhãn "Mở khu · $giá" |
| Liền kề, đủ cấp, thiếu tiền | tô cam nhạt, nhãn giá đỏ + "Chưa đủ tiền" |
| Liền kề/không, bị chặn bởi cấp | không tô, thẻ "Khóa · Cấp N" (N do sim cho biết) |
| Không liền kề, hết lượt mua | không gì thêm (viền mờ cũ của OverlayRenderer) |
| Khu đang trỏ / chọn | tô đậm hơn, viền dày hơn, nhãn lớn hơn |

Phân loại: `apps/web/src/game/render/zoneHighlight.ts` gọi `validate(UNLOCK_ZONE)` cho từng khu khoá. Thiếu tiền -> hỏi lại với ví giàu để lấy giá; chặn cấp -> hỏi lại ở cấp tối đa để phân biệt "không liền kề" (ZONE_LOCKED) với "liền kề nhưng thiếu cấp"; cấp cần thiết tìm bằng bisect. Cấp tối đa lấy `economy.xp.maxLevel` (schema từ chối cấp cao hơn).

## Render
`ZoneHighlightRenderer`: một mesh gộp (tô 8x8 lưới thô theo `heightsDm` + viền 16 đoạn, vertex RGBA, `polygonOffset`, `depthWrite=false`, `MeshBasicMaterial` không night tint, `toneMapped=false`, `fog=false`, màu < ngưỡng bloom) và pool sprite nhãn (CanvasTexture, chỉ vẽ lại khi đổi nội dung). Nhãn billboard, cao theo khoảng cách camera (kẹp 1.6-6.5 m). Phân loại chỉ chạy lại khi revision/cấp/danh sách khu đổi; tiền chỉ đổi ok/poor từ giá đã cache; hover chỉ tô lại. Tắt tool: ẩn mesh + sprite, không cấp phát lại.

## Perf (city full-world rút gọn, 1440x900, high, headless Chrome d3d11)
- Draw calls: tool tắt 247, bật 263 (+1 mesh +14 nhãn +1). Triangles 584,978 -> 592,174. Geometries 125 -> 127, textures 32 -> 46 (14 nhãn 512x144).
- FPS xen kẽ 4 vòng bật/tắt: trung vị ~20-21 ở lần chạy cuối, ~29-31 ở các lần trước, chênh lệch bật/tắt trong nhiễu (spread 10+ fps của headless); không thấy hồi quy rõ.
- Phân loại 60 khu: ~150 ms một lần trên main thread (validate clone state), chỉ khi bật tool hoặc revision/cấp đổi.
- Chưa làm: gộp nhãn thành atlas/InstancedMesh để bỏ +14 draw calls.

## QA
`scripts/zone-qa.mjs` (BASE_URL :5200), ảnh trong `docs/evidence/g4/zones/`. Fresh city/farm ở cấp 1 chỉ có thẻ "Khóa · Cấp 2" (sim chặn cấp). Click-test desktop và Pixel 7: khu sáng mở được, mất highlight, trừ tiền; khu không sáng không mở.
