# 05 — Thiết kế MAP ECO: vùng định cư sinh thái nguyên sơ

> **Trạng thái v2: P2 — chưa làm trong MVP.** Giữ tài liệu này làm định hướng bố cục. Khi triển khai, áp dụng lưới ô và luật của `06`, `15` (cầu, kè, ván đi bộ là **công trình người chơi xây**, không có trong template), và thiết kế lối chơi riêng (điểm xanh, du lịch sinh thái) bổ sung vào `01`, `16`. Các mục "lô/parcel" bên dưới hiểu là `suggestedLots` (`06 §4`).

**Ảnh tham chiếu:** `map/map_3.png`  
**Identity:** Cảnh quan hồ, đầm lầy và các bán đảo rừng thưa; chờ người chơi phát triển định cư xanh về sau.

## 1. Khác biệt so với 2 map khác

- City: lô tổ chức tương đối thẳng và nhiều đất mở.
- Farm: đất nâu/cỏ trống theo thung lũng, suối và thác.
- **Eco:** lô organic mềm dọc hồ/đầm, nhiều nước, thảm thực vật rậm ven bờ, đất trung tâm không bị đô thị hóa.
- Không được biến Eco thành một khu dân cư có nhà/villa xanh mái; tất cả được đặt **sau gameplay**.

## 2. Quy hoạch gợi ý

| Biến | Bắt đầu |
|---|---|
| World | 512 × 512 |
| Water / wetland | 22–35% |
| Buildable share | 35–50% phần đất khô |
| Height delta | 0–24 m, cliff riêng |
| Dirt path width | 1.5–4.5 m |
| Vegetation density | trung bình/cao ở buffer, thấp trong pad |
| Empty buildings | 0 |

## 3. Cấu trúc môi trường

- **Central lake/lagoon:** lòng hồ chính với hình dạng hữu cơ.
- **Secondary wetlands:** vũng nước cạn, reed masks, cây mọc ở đất bùn (loài phù hợp).
- **Small peninsulas/islets:** một vài đảo tự nhiên nhìn thấy được; nếu không tiếp cận từ đất liền thì vẫn nằm ngoài gameplay build tại MVP.
- **Meadow build pads:** các trảng cỏ mở quanh hồ, không xẻ thành grid sắc cạnh.
- **Forest/cliff backdrop:** rừng dày ở biên, đá/sườn núi làm điểm nhìn chính.
- **Natural waterfall** nếu hợp bố cục.

## 4. Parcel placement

- Polygon hình tự nhiên nhưng **viền đủ rõ khi overlay**, không tạo lô quá mỏng, nhiều răng cưa dẫn tới footprint công trình khó đặt.
- Mỗi lô có `waterSetback`, `maxSlope`, `buildMask`, `regionId`.
- Vùng marsh mềm, reeds, bờ hồ ngập nước = `non_buildable`.
- Cho phép cả lô lớn và vừa ở bên ngoài vùng wetland; đặt `eco_future_residential`, `eco_future_community` chỉ là metadata.

## 5. Cây xanh / bụi / lau sậy

- Tree mix: rừng lá xanh, conifer, cây thấp ven hồ, đôi chỗ hoa dại.
- Reeds/marsh grass theo height-to-watermask và slope/shore buffer; **không dùng cây cao mọc dưới đáy hồ**.
- Ràng buộc vision readability: cây có thể dày tại bìa nhưng lô trống phải thấy được từ camera chính.
- Có ngẫu nhiên deterministic nhưng các landmark lớn từ ảnh nên có vị trí tường minh (manual anchors).

## 6. Đường và nước

- Đường đất uốn theo bờ nước và vùng đất khô; không có vòng xuyến hoặc đường nhựa.
- **Không có cầu, ván đi bộ, cầu qua đầm, sàn quan sát, bến tàu** trong map mặc định.
- Đường đất kết thúc ở đất gần bờ và tránh mặt nước bằng buffer.
- Các đảo thiên nhiên không nhất thiết tiếp cận ngay; đừng sáng tạo cầu để “sửa logic”.

## 7. Visual style

- Nước xanh lam/turquoise, biến thiên sâu cạn; reeds xanh dịu, cỏ tươi vừa; ít màu đường đất hơn City.
- Highlights tập trung vào mặt hồ, đường bờ, cây đổ bóng nhẹ.
- Phải nhìn thấy phần mặt đứng của bờ cao, đá và sự thay đổi độ cao khi xoay camera.

## 8. QA

- [ ] Eco có tính nhận diện qua hồ trung tâm, đầm và parcels organic.
- [ ] Không có urban furniture (đèn, ghế, vỉa hè, đường nhựa, cây cảnh bố trí đều kiểu đô thị).
- [ ] Không cầu, không công trình, không sàn/bến.
- [ ] Nhìn camera mặc định vẫn có lô đất rõ ràng dành cho xây về sau.
- [ ] Parcel hợp lệ không đụng polygon water hoặc wetland no-build.
