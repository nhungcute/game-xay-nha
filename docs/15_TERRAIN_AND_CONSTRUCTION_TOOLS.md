# 15 — Luật công cụ: dọn đất, san nền, cuốc, kè, đường, cầu, xây dựng

Tài liệu này là **luật chuẩn** cho cả client (xem trước) và server (xác nhận). Các luật được cài một lần trong package `sim` dùng chung (xem `11`). Con số chi phí ở `16`.

## 1. Mô hình lưới

### 1.1 Kích thước

- Ô 2 m × 2 m. Bản đồ 128 × 128 ô. Lưới đỉnh 129 × 129.
- Ô `(cx, cz)` có 4 đỉnh: `(cx,cz)`, `(cx+1,cz)`, `(cx,cz+1)`, `(cx+1,cz+1)`.
- Tọa độ thế giới của tâm ô: `x = cx*2 + 1`, `z = cz*2 + 1`. Origin ở góc tây-bắc, x sang đông, z sang nam, y lên.

### 1.2 Độ cao

- Mỗi đỉnh lưu `h` theo **decimét** (`int16`). Template có thể có giá trị bất kỳ để địa hình tự nhiên.
- Công cụ của người chơi **luôn làm tròn về bội số của 5 dm** (bậc 0,5 m).
- Mỗi map có `waterLevel` (dm) cố định. Ô nước có mặt nước tại `waterLevel`.
- Giới hạn: `minH = waterLevel - 40`, `maxH = waterLevel + 300`.

### 1.3 Lớp dữ liệu của ô

| Lớp | Kiểu | Giá trị |
|---|---|---|
| `surface` | enum | `GRASS`, `DIRT`, `SAND`, `ROCK_GROUND`, `TILLED`, `ROAD`, `FOUNDATION`, `WATER`, `BRIDGE_DECK` |
| `roadTier` | 0–3 | 0 = không, 1 = đất, 2 = sỏi, 3 = nhựa (Thành phố) / lát đá (Quê) |
| `flags` | bitfield | `EMBANKED`, `NO_BUILD` (template cấm), `ENTRY` (điểm vào), `PROTECTED` (landmark không được sửa) |
| `occupant` | id | id công trình / env object / cây trồng chiếm ô (tối đa một) |

`surface = WATER` không đi kèm `occupant` ngoại trừ cầu (cầu lưu trong danh sách cầu, ô nước được đánh dấu `BRIDGE_DECK` ở lớp phủ, không đổi ô nước).

### 1.4 Khái niệm hình học

- **Độ dốc ô** `slope(c) = max(h4 góc) - min(h4 góc)` (dm).
- **Ô ven nước**: ô đất có ít nhất một ô kề 4 hướng là `WATER`.
- **Ô phẳng**: `slope(c) == 0`.
- **Vùng phẳng**: mọi đỉnh của tập ô có cùng `h`.

## 2. Ràng buộc chung cho mọi công cụ

Mọi thao tác thất bại nếu vi phạm bất kỳ điều nào dưới đây và trả về **mã lỗi** (bảng §11):

1. Mọi ô bị ảnh hưởng nằm trong **khu đã mở**.
2. Không chạm ô có cờ `PROTECTED`.
3. Đủ tài nguyên ($/gỗ/đá) và đủ cấp mở khóa.
4. Thao tác theo vùng tối đa **256 ô** một lệnh (chống lệnh khổng lồ).
5. Thao tác hoàn toàn **nguyên tử**: hoặc áp dụng hết, hoặc không gì cả. Không áp dụng một phần vùng.

## 3. Dọn đất (`CLEAR_ENV`)

| Đối tượng | Cách chọn | Kết quả |
|---|---|---|
| Cây | Chạm từng cây hoặc kéo vùng (chỉ chọn cây) | Xóa instance, nhận gỗ, ô trống |
| Đá tảng | Chạm từng đá hoặc kéo vùng | Xóa instance, nhận đá |
| Bụi/cỏ cao | Kéo vùng | Xóa, không nhận gì |

- Env object chiếm 1 ô (đá lớn có thể chiếm 2 × 2 — khai báo trong template).
- Env object đã dọn được ghi vào `removedEnvIds`. Không tái sinh.
- Hoa/cỏ thấp trang trí **không chặn** xây dựng; tự động biến mất khi ô đổi `surface`.

## 4. San nền (`TERRAFORM`)

### 4.1 Chế độ

| Chế độ | Tác dụng trên vùng chọn |
|---|---|
| `RAISE` | +5 dm mọi đỉnh trong vùng |
| `LOWER` | −5 dm mọi đỉnh trong vùng |
| `FLATTEN` | Đặt mọi đỉnh trong vùng về `targetH` (mặc định = trung bình làm tròn bậc của các đỉnh, người chơi có thể chọn bằng cách chạm một đỉnh mẫu) |

Vùng chọn là hình chữ nhật ô; tập đỉnh bị ảnh hưởng = mọi đỉnh của các ô trong vùng.

### 4.2 Luật

1. Không có ô nào trong vùng là `WATER`, `ROAD`, `TILLED` có cây đang trồng, hoặc có `occupant` (công trình, env object chưa dọn).
2. Không làm đổi độ cao **đỉnh dùng chung** với ô ngoài vùng đang là: công trình, đường (trừ khi đường vẫn thỏa §6.2 sau thay đổi), ruộng có cây, cầu. → Lỗi `AFFECTS_NEIGHBOR`.
3. **Bờ nước:** với ô ven nước **chưa kè**, mọi đỉnh dùng chung với ô nước phải giữ `h ≥ waterLevel + 5` và `h ≤ waterLevel + 20` (bờ thoải tự nhiên). Ô ven nước **đã kè** được phép bất kỳ `h ≥ waterLevel + 5` (tường kè đứng).
4. **Độ dốc tối đa với ô kề ngoài vùng** (ô không kè): chênh lệch giữa đỉnh trong vùng và đỉnh liền kề ngoài vùng ≤ 20 dm. Vượt → `TOO_STEEP_EDGE`. Gợi ý UI: mở rộng vùng hoặc kè.
5. Giới hạn `minH`/`maxH`.

### 4.3 Chi phí

`cost = rate × Σ |Δh| / 5` trên mọi đỉnh thay đổi (đơn vị: bậc). Xem `16 §5`.

### 4.4 San phẳng tự động khi đặt công trình

Trong Build Mode, nếu footprint chưa phẳng nhưng có thể san hợp lệ theo §4.2, ghost hiện **vàng** kèm chi phí san. Xác nhận → client gửi **một lệnh** `PLACE_BUILDING` với `autoFlattenH`; server thực hiện san + xây nguyên tử.

## 5. Cuốc đất (`TILL`) — chỉ map Quê

1. Ô là `GRASS`, `DIRT` hoặc `SAND`, không có `occupant`.
2. `slope(c) ≤ 5` dm.
3. Không phải ô ven nước chưa kè? → **Được phép** (ruộng ven suối là điều tự nhiên), nhưng không được là ô `WATER`.
4. Tổng số ô `TILLED` không vượt **hạn mức ruộng** (theo số nhà nông — xem `16`).
5. Kết quả: `surface = TILLED`. Ô cuốc vẫn là ô cuốc sau thu hoạch.
6. Bỏ cuốc (`UNTILL`) → về `GRASS`, miễn phí, ô phải không có cây trồng.

## 6. Đường (`BUILD_ROAD`, `REMOVE_ROAD`)

### 6.1 Thao tác

Kéo từ ô A tới ô B → đường gấp khúc hình chữ L (đi theo trục dài trước). Nhấn giữ khi kéo (desktop: Shift) để đổi thứ tự trục. Hoặc kéo tự do theo từng ô (mobile).

### 6.2 Luật

1. Ô không phải `WATER`, không có `occupant` (trừ env object cỏ thấp).
2. **Độ dốc dọc tuyến:** với hai ô đường kề nhau, chênh lệch độ cao trung bình hai ô ≤ 5 dm. `slope(c) ≤ 10` dm cho mỗi ô.
3. Ô đã là đường cấp thấp hơn → **nâng cấp** (trả chênh lệch). Cấp bằng hoặc cao hơn → bỏ qua ô đó (không lỗi).
4. Ô `TILLED` → lỗi `CELL_TILLED` (phải bỏ cuốc trước).
5. Đường nhựa / lát đá yêu cầu cấp độ (xem `16`).

### 6.3 Hiển thị

- Auto-tile theo 4 hàng xóm: `END`, `STRAIGHT`, `CORNER`, `T`, `CROSS`, `ISOLATED`. Kết nối với cầu như một ô đường.
- Lưới đường bám địa hình (mesh decal ôm theo 4 đỉnh, nâng 2 cm chống z-fighting).

### 6.4 Mạng đường và điểm vào

- Template khai báo 1–3 ô `ENTRY` **trong khu ban đầu**, nằm trên đường làng tự nhiên dẫn ra mép bản đồ. Ô `ENTRY` luôn là đường (≥ đất), **không xóa được**, được nâng cấp.
- **Kết nối:** BFS 4 hướng trên tập ô đường + ô cầu, bắt đầu từ mọi ô `ENTRY`.
- Công trình **có đường** nếu ít nhất một ô kề cạnh ngoài footprint (4 hướng) là ô đường **đã kết nối**.
- Kết nối được tính lại sau mọi lệnh đổi đường/cầu (128 × 128 BFS ≈ 16 k ô — rẻ).
- Xóa đường làm công trình mất kết nối → **cho phép** nhưng UI cảnh báo trước và liệt kê công trình bị ảnh hưởng.

## 7. Kè đá (`EMBANK`, `REMOVE_EMBANK`)

1. Ô phải là ô ven nước (đất, kề nước 4 hướng).
2. Ô không có công trình đè lên (đường được phép — kè rồi làm đường trên đó, hoặc làm đường rồi kè).
3. Kết quả: cờ `EMBANKED`. Hiển thị tường đá theo **từng cạnh** giáp nước, chiều cao tường = `h cạnh - (waterLevel - 5)`.
4. Tác dụng:
   - Cho phép san bờ dốc đứng (§4.2.3).
   - Cho phép công trình nằm sát nước (§8.2.5).
   - Là điều kiện mố cầu (§9).
   - Thưởng "view mặt nước" (`16`).
5. Gỡ kè: ô phải thỏa luật bờ tự nhiên (§4.2.3) sau khi gỡ, không phải mố cầu, không có công trình dựa vào luật sát nước. Hoàn 50%.

## 8. Xây công trình (`PLACE_BUILDING`, `DEMOLISH`)

### 8.1 Footprint

- Catalog khai báo `size: [w, d]` theo ô và `entrance` (cạnh có cửa).
- Xoay 0/90/180/270° — footprint hoán đổi `w/d` khi xoay 90/270.
- Neo (anchor) = ô góc tây-bắc của footprint sau khi xoay.

**Một hàm duy nhất cho footprint** (bài học từ prototype: phá dỡ dùng kích thước chưa xoay nên bấm trong không xóa, bấm ngoài lại xóa):

```ts
// packages/sim/footprint.ts — nguồn duy nhất
export function rotatedSize(def: BuildingDef, rot: Rotation): [number, number] {
  return rot % 2 === 0 ? [def.size[0], def.size[1]] : [def.size[1], def.size[0]];
}
export function footprintCells(def: BuildingDef, anchor: [number, number], rot: Rotation): [number, number][];
export function footprintRectWorld(def: BuildingDef, anchor: [number, number], rot: Rotation): { x0: number; z0: number; x1: number; z1: number };
export function buildingAtCell(s: SimState, cx: number, cz: number): string | null;   // đọc occupancy
```

- **Bắt buộc dùng chung** cho: kiểm tra đặt (§8.2), ghost preview, chọn công trình bằng chạm, phá dỡ, dựng occupancy, tính bán kính thưởng, vị trí mesh. Không module nào được tự tính lại `w/d` theo góc xoay.
- Chạm/bấm chọn công trình: raycast địa hình → ô `(cx, cz)` → `buildingAtCell` (tra occupancy). **Không** so khoảng cách tới tâm công trình. Raycast mesh công trình chỉ dùng để ưu tiên khi trúng phần mái nhô ra ngoài footprint; kết quả cuối vẫn phải là id có trong occupancy.

### 8.2 Luật hợp lệ (theo thứ tự kiểm tra, dừng ở lỗi đầu tiên)

1. Mọi ô footprint trong khu đã mở (`ZONE_LOCKED`).
2. Không ô nào là `WATER`, `ROAD`, `TILLED` (`CELL_BLOCKED`).
3. Không ô nào có `occupant` (`OCCUPIED`, kèm id vật cản; env object → gợi ý "Dọn trước").
4. Vùng phẳng (`NOT_FLAT`); nếu có thể san tự động → ghost vàng (§4.4).
5. **Khoảng lùi nước:** nếu footprint có ô ven nước, ô đó phải `EMBANKED` (`NEAR_WATER_NOT_EMBANKED`).
6. Cấp độ, **giới hạn số lượng theo cấp** (`16 §6.2`, `§7.2`), tài nguyên, **còn đội thợ rảnh** (`NO_BUILDER_FREE`).
7. Không có `NO_BUILD`.
8. Map đúng (`WRONG_MAP` — công trình Thành phố không xây được ở Quê và ngược lại).

**Không** bắt buộc có đường để xây — nhưng công trình không có đường thì không sinh tiền/không hoạt động, có biểu tượng cảnh báo trên đầu.

### 8.2b Thời gian xây (`16 §3`)

- Đặt hợp lệ → trừ tiền ngay → công trình ở trạng thái `CONSTRUCTING` với `buildEndsAt = now + buildTime` (giờ server). Chiếm ô (occupancy) ngay lập tức.
- Khi đang xây: không sinh tiền, không cấp dân/việc làm, không có hiệu lực thưởng/ngân hàng/xưởng; vẫn được tính là vật cản; không phá dỡ được (chỉ **hủy**).
- Hoàn thành **tự động** tại `buildEndsAt`; server xử lý như một sự kiện theo thứ tự thời gian (settle rồi mới bật thu nhập), cộng XP xây dựng lúc này.
- `CANCEL_CONSTRUCTION`: hoàn 100% tiền và vật liệu, ô về `FOUNDATION`.
- `SPEED_UP`: trả `ceil(50% × giá $ × còn lại ÷ tổng)`, hoàn thành ngay.
- Đội thợ: số công trình + cầu đang `CONSTRUCTING` ≤ `builders(cấp)` = 2 / 3 (cấp 5) / 4 (cấp 10).

### 8.3 Phá dỡ

- Chỉ áp dụng cho công trình đã xong (`ACTIVE`). Hoàn **50%** tiền và vật liệu thực trả (làm tròn xuống). Settle thu nhập trước khi phá, tiền đang chờ được cộng vào ví.
- Công trình đang xây → lỗi `UNDER_CONSTRUCTION` (dùng hủy).
- Ô footprint về `FOUNDATION` (giữ nền phẳng), có thể xây lại ngay.

## 9. Cầu (`BUILD_BRIDGE`, `REMOVE_BRIDGE`)

### 9.1 Thao tác

Chọn loại cầu → chạm ô đầu A → chạm ô đầu B. Preview hiển thị mặt cầu và trạng thái hợp lệ.

### 9.2 Luật

1. A và B thẳng hàng theo trục x hoặc z (MVP không có cầu chéo/cong).
2. A và B là ô đất **đã kè** và là **ô đường** (bất kỳ cấp).
3. Mọi ô giữa A và B (không tính A, B) là `WATER` → số ô này = **nhịp** `span`.
4. `1 ≤ span ≤ maxSpan(loại cầu)`.
5. `|h(A) - h(B)| ≤ 10` dm, dùng `h` = độ cao trung bình cạnh giáp nước. Mặt cầu ở `max(h(A), h(B))`, đầu thấp hơn có dốc dẫn.
6. Không cắt qua cầu khác. Cầu song song cách nhau ≥ 1 ô nước.
7. Không đè lên ô nước có cờ `PROTECTED` (thác, landmark).
8. Đủ cấp độ, tài nguyên: `cost = span × costPerCell(loại)`; còn đội thợ rảnh.
9. Thời gian xây `= span × phút/ô` (gỗ 1, đá 3, bê tông 6). Trong lúc xây, cầu **chưa** là nút của mạng đường (§9.3); hủy/xây nhanh như công trình (§8.2b).

### 9.3 Mạng đường

Mỗi ô nhịp cầu là một nút của mạng đường (§6.4). Hai đầu cầu nối với ô đường A, B.

### 9.4 Gỡ cầu

Hoàn 50% (cầu đang xây: hủy, hoàn 100%). Cảnh báo công trình mất kết nối (§6.4).

### 9.5 Hiển thị

Cầu ghép module: `abutment` (mố) ×2, `span_segment` ×span, `railing`. Trụ cầu mỗi 2 ô nhịp (cầu đá/bê tông), cắm xuống đáy nước.

## 10. Trồng trọt và sản xuất (Quê)

| Lệnh | Luật |
|---|---|
| `PLANT` | Ô `TILLED`, trống. Đủ cấp mở khóa giống, đủ tiền. Áp dụng theo vùng chọn (tối đa 256 ô); ô không hợp lệ trong vùng **bị bỏ qua** (ngoại lệ duy nhất của luật nguyên tử — trả về danh sách ô đã gieo). |
| `HARVEST` | Ô có cây đã chín (`now ≥ readyAt` theo giờ server). Kho phải còn chỗ cho toàn bộ sản lượng; nếu không đủ chỗ thì thu đến khi đầy, phần còn lại giữ nguyên trên ruộng. |
| `START_PRODUCTION` | Xưởng/chuồng đã xong (`ACTIVE`), có đường kết nối, hàng chờ của slot còn chỗ (tối đa 3 mẻ/slot, chạy nối tiếp), kho đủ nguyên liệu. Trừ nguyên liệu ngay khi đưa vào hàng chờ. |
| `COLLECT_PRODUCTION` | Sản phẩm xong, kho còn chỗ. |
| `SELL` | Chợ tồn tại và có đường. Bán ngay theo giá gốc. |

Thời gian lớn có thể giảm bởi **giếng** / nước gần (xem `16`). Hệ số giảm được **chốt tại lúc gieo** (`readyAt` cố định), không tính lại khi xây giếng sau.

## 11. Bảng mã lỗi

| Mã | Ý nghĩa (chuỗi UI tiếng Việt qua i18n) |
|---|---|
| `ZONE_LOCKED` | Khu đất chưa mở |
| `PROTECTED` | Cảnh quan được bảo vệ |
| `INSUFFICIENT_FUNDS` | Không đủ tiền / gỗ / đá (kèm loại) |
| `LEVEL_REQUIRED` | Cần cấp N |
| `AREA_TOO_LARGE` | Vùng chọn quá 256 ô |
| `CELL_BLOCKED` | Ô không phù hợp (nước/đường/ruộng) |
| `CELL_TILLED` | Ô đang là ruộng |
| `OCCUPIED` | Có vật cản (kèm id) |
| `NOT_FLAT` | Nền chưa phẳng |
| `TOO_STEEP` | Dốc quá mức cho phép |
| `TOO_STEEP_EDGE` | Chênh lệch với đất xung quanh quá lớn |
| `AFFECTS_NEIGHBOR` | Thay đổi làm hỏng đường/công trình bên cạnh |
| `SHORE_RULE` | Vi phạm luật bờ nước chưa kè |
| `NEAR_WATER_NOT_EMBANKED` | Sát nước nhưng chưa kè |
| `NOT_SHORE` | Ô không ven nước (khi kè) |
| `BRIDGE_NOT_STRAIGHT` | Hai đầu cầu không thẳng hàng |
| `BRIDGE_END_INVALID` | Đầu cầu phải là đường đã kè |
| `BRIDGE_SPAN_NOT_WATER` | Giữa hai đầu có ô không phải nước |
| `BRIDGE_TOO_LONG` | Vượt nhịp tối đa |
| `BRIDGE_HEIGHT_MISMATCH` | Hai đầu chênh cao quá 1 m |
| `BRIDGE_CROSSING` | Cắt cầu khác |
| `FIELD_LIMIT` | Vượt hạn mức ruộng |
| `STORAGE_FULL` | Kho đầy |
| `NO_ROAD_ACCESS` | Công trình chưa nối đường (khi cần) |
| `WRONG_MAP` | Công trình không thuộc map này |
| `NO_BUILDER_FREE` | Tất cả đội thợ đang bận |
| `UNDER_CONSTRUCTION` | Công trình đang xây (chỉ hủy hoặc xây nhanh) |
| `NOT_UNDER_CONSTRUCTION` | Công trình đã xong, không hủy/xây nhanh được |
| `LIMIT_REACHED` | Đã đạt số lượng tối đa ở cấp hiện tại |
| `REVISION_CONFLICT` | Dữ liệu đã thay đổi, đồng bộ lại |

## 12. Ví dụ minh họa

**Bắc cầu gỗ qua suối rộng 4 ô:**

```text
z →   0     1     2     3     4     5
     [đất][đất ][nước][nước][nước][nước][đất ][đất]
            A(kè,đường)                   B(kè,đường)
span = 4  ≤ maxSpan(cầu gỗ)=6  → hợp lệ nếu |h(A)-h(B)| ≤ 1 m
```

Trình tự người chơi: làm đường tới bờ → kè ô bờ A → (sang bờ bên kia chưa có đường: chỉ cần ô B nằm trong khu đã mở) làm đường ô B → kè ô B → bắc cầu A–B.
