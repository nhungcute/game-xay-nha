# 01 — Game Design Document (GDD)

## 1. Tóm tắt

**Tên tạm:** *Xây Nhà* (working title)  
**Thể loại:** Xây dựng – quản lý nhàn (casual city/farm builder) 3D, chơi trên trình duyệt.  
**Một câu:** *Nhận một vùng đất hoang sơ có sông, hồ, rừng — tự tay dọn cây, san nền, kè bờ, làm đường, bắc cầu, rồi biến nó thành thành phố sầm uất hoặc làng quê trù phú.*

**Cảm hứng:** TeamFarmy (game xây thành phố 3D trên web), Township, Hay Day, SimCity BuildIt — điểm khác biệt là **cải tạo địa hình có ý nghĩa**: địa hình không chỉ là nền, mà là thứ người chơi phải "chinh phục" (sông chặn đường → bắc cầu; bờ sạt → kè đá; đồi dốc → san nền).

## 2. Đối tượng và nền tảng

- Người chơi casual 16–40 tuổi, chơi 5–15 phút/phiên, vài phiên/ngày.
- Desktop (chuột) và mobile browser (cảm ứng). Không cài đặt, **nhập tên là vào chơi** trong < 15 giây.
- Ngôn ngữ: tiếng Việt trước; mọi chuỗi UI qua khóa i18n để thêm tiếng Anh sau.

## 3. Trụ cột thiết kế (pillars)

1. **Khai hoang có cảm giác** — mỗi nhát cuốc, mỗi ô san nền, mỗi đoạn kè đều thấy địa hình thay đổi thật trong 3D.
2. **Địa hình là câu đố nhẹ** — sông, đồi, bờ hồ tạo ra lựa chọn: đi vòng hay bắc cầu, san đồi hay xây chỗ khác.
3. **Thành quả thấy được** — vùng hoang dần thành phố/làng; người chơi muốn xoay camera ngắm.
4. **Tôn trọng thời gian** — tiền vẫn sinh khi offline (có trần), cây trồng không chết, không phạt người chơi vắng mặt.

## 4. Vòng chơi

### 4.1 Vòng lõi (vài phút)

```text
Thu tiền / thu hoạch
   → Chi tiền: dọn đất, san nền, làm đường, kè, cầu
   → Xây công trình / gieo trồng
   → Chờ sản xuất (vài phút – vài giờ)
   → Thu tiền / thu hoạch ...
```

### 4.2 Vòng trung hạn (một ngày)

- Lên cấp → mở khóa công trình, loại đường, loại cầu mới.
- Mua thêm **khu đất** (16 × 16 ô) để mở rộng; khu mới thường có thử thách địa hình (sông, đồi, bờ hồ).
- Hoàn thành **nhiệm vụ** (quest) để nhận thưởng.

### 4.3 Vòng dài hạn (tuần)

- Phủ kín bản đồ, nối mạng đường qua mọi bờ sông.
- Tối ưu bố cục (thưởng công viên, thưởng view mặt nước đã kè, đường cấp cao).
- (P1) Thăm thế giới của người chơi khác, bảng xếp hạng giá trị thành phố/làng.

## 5. Hai loại map

**Mỗi map là một nhân vật riêng.** Chọn map nào thì tạo một nhân vật mới cho map đó, với tên, cấp độ, XP, tiền ($), tài sản và vùng đất **hoàn toàn độc lập**. Đổi sang map khác = tạo nhân vật mới bắt đầu từ cấp 1; không có gì được chuyển giữa hai nhân vật. Nhân vật cũ vẫn được giữ, có thể quay lại chơi tiếp. Một thiết bị/tài khoản có tối đa **một nhân vật cho mỗi map** (MVP). Chi tiết ở §9.

| | **Thành phố** | **Quê (Nông trại)** |
|---|---|---|
| Địa hình ban đầu | Đồng bằng ven biển/cửa sông, ít dốc, có sông phía bắc, vịnh phía tây nam | Thung lũng có suối, thác, ao, đồi đá |
| Nguồn tiền chính | **Thụ động**: nhà ở thu tiền thuê, cửa hàng/ngân hàng/khách sạn sinh tiền theo giờ | **Chủ động**: cuốc → gieo → thu hoạch → bán ở chợ; chế biến (cối xay, lò bánh); chăn nuôi |
| Ràng buộc chính | **Dân số ↔ việc làm**: cửa hàng cần dân để chạy | **Sức chứa kho**, số ô ruộng tối đa theo nhà nông |
| Hạ tầng đặc trưng | Đường đất → sỏi → **nhựa**; cầu gỗ → đá → **bê tông** | Đường đất → sỏi → **lát đá**; cầu gỗ → đá; giếng nước |
| Cảm giác | Nhàn, quy hoạch, ngắm thành phố lớn dần | Bận tay, nhịp nhanh, thu hoạch đã tay |

Map **Sinh thái** (`05_ECO_MAP.md`) là P2, tái sử dụng engine; sẽ có lối chơi riêng (điểm xanh, du lịch sinh thái) được thiết kế sau.

## 6. Hệ thống gameplay

Chi tiết luật nằm ở `15`, con số nằm ở `16`. Ở đây mô tả ý đồ.

### 6.1 Đất và mở khu

- Bản đồ 8 × 8 khu. Bắt đầu mở **2 × 2 khu trung tâm** (32 × 32 ô) chứa điểm vào.
- Khu chưa mở hiển thị mờ/có viền; mua bằng tiền, yêu cầu cấp độ. Chỉ mua được khu **kề cạnh** khu đã mở.

### 6.2 Dọn đất

- Cây → **chặt** (tốn tiền, nhận gỗ). Đá tảng → **đập** (tốn tiền, nhận đá). Bụi/cỏ cao → **phát** (rẻ).
- Mỗi env object có ID ổn định; khi đã dọn thì lưu vào delta, không bao giờ mọc lại ở chỗ cũ.
- (P1) Trồng cây trang trí — tạo object mới của người chơi.

### 6.3 Cải tạo địa hình

- **San nền:** nâng / hạ / làm phẳng theo bậc 0,5 m trên vùng ô được chọn. Công trình chỉ đặt được trên nền **phẳng tuyệt đối**.
- **Cuốc đất (Quê):** biến ô cỏ thành ô đất canh tác; cần ô đã dọn và gần phẳng.
- **Kè đá:** gia cố ô ven nước. Cho phép xây sát nước, cho phép san bờ dốc đứng, là điều kiện làm **mố cầu**, và cho thưởng "view mặt nước".
- (P1) **Đào ao (Quê):** biến ô đất thành ô nước.

### 6.4 Đường và cầu

- Kéo-thả để vẽ đường theo ô; đường tự nối (thẳng, góc, ngã ba, ngã tư).
- Công trình chỉ hoạt động khi **kề một ô đường nối về điểm vào** của bản đồ.
- **Cầu** bắc thẳng qua nước, hai đầu là ô đường đã kè. Loại cầu quyết định nhịp tối đa. Không có cầu → bờ bên kia không có đường → không xây công trình sinh tiền ở đó được.

### 6.5 Xây dựng

- Chọn công trình trong catalog → bóng ma 3D theo con trỏ → xoay 90° → xanh (hợp lệ) / đỏ (kèm lý do) → xác nhận.
- **Công trình và cầu có thời gian xây** (30 giây với công trình cấp thấp, tới 4 giờ với tòa văn phòng). Trong lúc xây hiện giàn giáo và đồng hồ đếm ngược. Số công trình xây cùng lúc giới hạn bởi **đội thợ** (2 → 4 theo cấp). Có thể trả $ để xây nhanh, hủy khi đang xây được hoàn 100%. **Dọn đất, san nền, cuốc, kè, đường hoàn thành ngay** vì đây là cảm giác tay cốt lõi. Chi tiết `16 §3`.
- Phá dỡ hoàn lại một phần chi phí. (P1) Di chuyển công trình miễn phí.

### 6.6 Sản xuất và thu hoạch

- **Thành phố:** mỗi công trình kinh doanh có tốc độ thu ($/giờ) và **kho tiền** (trần = N giờ sản xuất). Đầy kho thì ngừng tích lũy. Chạm vào bong bóng tiền để thu. Ngân hàng tăng trần kho tiền và mở nút "Thu tất cả".
- **Quê:** cây trồng có thời gian lớn; chín thì thu vào kho; bán ở **chợ** (chợ phải nối đường). Chuồng trại/xưởng chế biến nhận nguyên liệu, trả sản phẩm giá trị cao hơn sau thời gian chờ.

### 6.7 Tiến trình

- **XP** từ chi tiêu xây dựng và từ thu hoạch/sản xuất → **cấp độ** → mở khóa.
- **Nhiệm vụ** tuyến tính (hướng dẫn tân thủ) rồi nhiệm vụ lặp ngẫu nhiên.
- Mỗi nhân vật có bộ chỉ số riêng hiển thị trên HUD và hồ sơ:
  - **Cấp độ** (1–20) và **XP**.
  - **Tiền mặt ($)**.
  - **Tổng tài sản ($)** = tiền mặt + giá trị công trình, hạ tầng, đất đã mở, kho hàng (công thức `16 §13`). Dùng cho bảng xếp hạng theo từng map (P1).

## 7. Trải nghiệm lần đầu (FTUE) — ~5 phút

Kịch bản chi tiết trong `09`. Tóm tắt map Thành phố:

1. Chọn "Thành phố" → nhập tên nhân vật → camera bay từ toàn cảnh xuống khu trung tâm.
2. "Chặt 3 cây để dọn đất" (thưởng tiền).
3. "Nối đường từ điểm vào tới khu đất trống" (kéo 6–10 ô đường đất).
4. "San nền 2 × 2" — thấy đất nâng/hạ thật.
5. "Xây Nhà nhỏ" → thấy dân số tăng.
6. "Xây Tạp hóa" → thấy bong bóng tiền xuất hiện sau vài giây (tutorial tăng tốc lần thu đầu).
7. "Thu tiền" → lên cấp 2 → mở khóa vườn hoa; gợi ý mua khu bên kia sông (giới thiệu kè + cầu ở cấp 4).

Map Quê: chợ → nhà nông → cuốc 6 ô → gieo rau cải (5 phút, tutorial rút còn 20 giây) → thu hoạch → bán.

## 8. Phiên chơi và offline

- Tiền/sản phẩm tính theo **thời gian thực trên server**, vẫn chạy khi offline đến trần kho.
- Cây chín không héo. Không có thảm họa phá công trình trong MVP.
- Khi quay lại: popup "Trong lúc bạn vắng mặt" tóm tắt tiền đang chờ thu.

## 9. Nhân vật và đăng nhập chỉ bằng tên

### 9.1 Mô hình

```text
Tài khoản khách (vô hình với người chơi: token trong trình duyệt + mã khôi phục)
  ├── Nhân vật Thành phố: tên, cấp, XP, $, tài sản, vùng đất Thành phố
  └── Nhân vật Quê:       tên, cấp, XP, $, tài sản, vùng đất Quê
```

- Người chơi chỉ thấy **nhân vật**; "tài khoản" chỉ là cơ chế kỹ thuật để giữ các nhân vật trên cùng thiết bị và khôi phục khi đổi máy.
- Hai nhân vật **không chia sẻ** gì: tên có thể khác nhau, cấp, XP, tiền, tài sản, nhiệm vụ, mở khóa đều riêng.

### 9.2 Luồng vào game

1. Lần đầu mở game: **chọn map** → **nhập tên nhân vật** (3–20 ký tự, cho phép tiếng Việt có dấu) → "Vào chơi". Server tạo tài khoản khách + nhân vật, trả token (lưu trình duyệt) và **mã khôi phục 12 ký tự** hiển thị một lần, có nút sao chép.
2. Các lần sau: vào thẳng nhân vật chơi gần nhất.
3. **Đổi map** (nút trên HUD → màn chọn map):
   - Map đã có nhân vật → vào nhân vật đó (hiện thẻ tên, cấp, tài sản).
   - Map chưa có nhân vật → thông báo "Bạn sẽ tạo nhân vật mới, bắt đầu từ cấp 1 với $2 000" → nhập tên (gợi ý sẵn tên nhân vật hiện tại, sửa được) → tạo.
4. Tên hiển thị kèm hậu tố `#1234` để không cần tên duy nhất.
5. Một mã khôi phục dùng cho mọi nhân vật của tài khoản. Chi tiết bảo mật ở `11 §4`.

## 10. Phạm vi

### MVP (P0)

- 2 map (Thành phố, Quê), mỗi map một nhân vật riêng (tối đa 1 nhân vật/map/tài khoản).
- Dọn đất, san nền, cuốc, kè, 3 cấp đường, 2–3 loại cầu, ~10–12 công trình mỗi map, 8 loại cây trồng, 2 chuồng, 2 xưởng chế biến, thời gian xây + đội thợ + xây nhanh.
- Kinh tế server-side, offline income, cấp độ 1–20, mở khu, ~15 nhiệm vụ tân thủ mỗi map.
- Đăng nhập bằng tên + mã khôi phục.
- Desktop + mobile, tiếng Việt.

### P1

- Nâng cấp công trình, di chuyển công trình, đào ao, trồng cây trang trí.
- Bảng đơn hàng (Quê), sự kiện theo mùa.
- Thăm thế giới bạn bè, bảng xếp hạng, liên kết email.
- Âm thanh môi trường đầy đủ, chu kỳ ngày/đêm.

### P2

- Map Sinh thái, tiền cứng/thanh toán, chơi chung một bản đồ (co-op), giao dịch giữa người chơi.

### Không làm

- Mô phỏng giao thông xe cộ, mô phỏng nước vật lý, chiến đấu, blockchain/token.

## 11. Rủi ro thiết kế và câu hỏi mở

| Rủi ro / câu hỏi | Hướng xử lý hiện tại |
|---|---|
| Cải tạo địa hình quá tốn thao tác trên mobile | Công cụ kéo vùng chữ nhật, nút "San phẳng tự động theo footprint" khi đặt công trình (P0) |
| Thành phố quá nhàn → chán | Nhiệm vụ lặp + thưởng bố cục (công viên, view nước, đường cấp cao) |
| Quê quá bận → mệt | Cây trồng dài giờ cho người ít online; không héo |
| Gian lận tiền | Server tính tiền; client chỉ dự đoán (xem `11`) |
| Mất tài khoản khách | Mã khôi phục + nhắc lưu mã ở cấp 3; liên kết email P1 |
| Có cho phép nhiều nhân vật cùng một map? | MVP: không. Nút "Bắt đầu lại" xóa nhân vật (và vùng đất) của map đó sau khi xác nhận 2 lần, rồi tạo nhân vật mới. P1 có thể cho nhiều ô nhân vật |
| Có cho phép lấp sông/hồ? | MVP: không (giữ thử thách cầu). Đào ao P1 chỉ ở Quê |

## 12. Chỉ số thành công (sau soft launch)

- Tỉ lệ hoàn thành hướng dẫn ≥ 70%.
- Thời gian từ mở trang đến thao tác đầu tiên ≤ 20 giây (p75).
- D1 retention ≥ 30%, D7 ≥ 10%.
- Phiên trung bình 6–12 phút, ≥ 2 phiên/ngày với người chơi D1.
- Tỉ lệ lỗi tải map < 1%, FPS mobile tầm trung p50 ≥ 30.
