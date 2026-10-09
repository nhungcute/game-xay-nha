# 04 — Map QUÊ: thung lũng nông trại nguyên sơ

**Ảnh tham chiếu:** `map/map_2.png`. Hàng rào và ruộng đã cày luống trong ảnh **không** có trong template — ruộng luống là trạng thái *sau khi người chơi cuốc và gieo*.  
**Bản sắc:** Thung lũng có **suối chảy từ thác đông bắc** xuống **hồ lớn tây nam**, ao nhỏ, đồi đá. Đất hoang chưa ai canh tác.  
**Lối chơi:** xem `01 §5`. Luật: `15`. Số liệu: `16`.

## 1. Thông số template

| Biến | Giá trị | Ghi chú |
|---|---|---|
| Lưới | 128 × 128 ô (2 m) | Chung engine |
| `waterLevelDm` | 30 | Mặt hồ; suối dùng cùng mức (MVP không có dòng nước bậc thang trong lưới) |
| Tỉ lệ nước | 12–20% | Suối + hồ + 2–3 ao |
| Đất xây/canh tác được trên đất khô | 50–60% | |
| Chênh độ cao | 0–25 m | Đồi đá phía bắc/đông bắc |
| Đường làng tự nhiên | Đường mòn uốn lượn, `roadTier = 1` | |
| Công trình / cầu / ruộng / hàng rào ban đầu | **0** | Bắt buộc |

**Thác:** địa hình vách đá ở đông bắc cao hơn `waterLevel`; thác là mesh trang trí (`water.waterfalls`) đổ xuống đầu suối. Ô vách và chân thác có cờ `PROTECTED`.

## 2. Bố cục theo khu (8 × 8)

```text
   x→  0   1   2   3   4   5   6   7
z 0   [F] [F] [M] [M] [M] [F] [K] [K]     K = vách đá + thác (đông bắc)
  1   [F] [M] [M] [M] [C] [C] [K] [K]     C = suối (chảy từ thác về tây nam)
  2   [M] [M] [M] [C] [M] [M] [M] [F]     M = đồng cỏ, đất phù sa
  3   [M] [M] [C] [S] [S] [M] [o] [F]     S = khu bắt đầu (27, 28, 35, 36)
  4   [M] [C] [M] [S] [S] [M] [M] [F]     o = ao
  5   [L] [L] [M] [M] [M] [o] [M] [H]     L = hồ lớn tây nam
  6   [L] [L] [L] [M] [M] [M] [H] [H]     H = đồi đá
  7   [L] [L] [L] [F] [M] [M] [H] [F]     F = rừng
```

Ý đồ thiết kế:
- **Khu bắt đầu** sát suối ở phía tây bắc (khu 26/34 bên kia suối): ruộng gần suối được thưởng tưới (`16 §7.1`) ngay từ đầu → dạy người chơi giá trị của nước.
- Suối rộng 3–5 ô quanh khu bắt đầu → **cầu gỗ** đủ. Bờ bên kia có đất phù sa rộng, phẳng → phần thưởng cho việc bắc cầu.
- **Hồ tây nam**: bờ thoải, lau sậy; đất quanh hồ hợp chuồng trại.
- **Đồi đá đông nam**: nhiều đá tảng (nguồn đá), dốc — tốn công san.
- Ô `ENTRY` ở mép nam khu 36, đường làng chạy xuống mép nam bản đồ.

## 3. Địa hình và nước

- Thung lũng thấp dần từ đông bắc về tây nam; đồng cỏ nhấp nhô ±0,5 m.
- Đất phù sa ven suối (biome `fertile`) màu nâu nhạt, ít cây — gợi ý vị trí ruộng.
- Bờ suối/hồ tự nhiên thỏa luật bờ (`15 §4.2.3`), có đá và lau sậy.

## 4. Biome (điều khiển scatter)

| Biome | Env | Gợi ý gameplay |
|---|---|---|
| `meadow` | Cây thưa, hoa, cỏ | Nhà nông, chợ |
| `fertile` | Rất ít cây, cỏ thấp | Ruộng |
| `riverside` | Bụi, lau sậy, đá nhỏ | Ruộng ven suối, kè, cầu |
| `pond_edge` | Lau sậy, cây ở mép ngoài | Giếng không cần thiết |
| `rocky_hill` | Đá tảng dày, thông | Nguồn đá, tốn san |
| `forest` | Cây dày | Nguồn gỗ |

## 5. Khung cảnh camera mặc định

Nhìn từ nam lên bắc, pitch 55°: khu bắt đầu ở giữa, suối uốn bên trái, thác thấp thoáng góc trên phải. 5 ảnh QA như `03 §5`.

## 6. QA đặc thù

- [ ] Template: 0 ruộng (`TILLED`), 0 công trình, 0 cầu, 0 hàng rào, không máy nông nghiệp.
- [ ] Thác, suối, hồ có cao độ và đường viền thật khi xoay ngang.
- [ ] Khu bắt đầu có ≥ 200 ô xây/canh tác được, ≥ 30 ô trong bán kính 3 ô của nước.
- [ ] Đoạn suối gần khu bắt đầu ≤ 6 ô nhịp.
- [ ] Không cây trong nước; đường làng không chạm nước.
