# 03 — Map THÀNH PHỐ: đồng bằng ven sông/biển chờ quy hoạch

**Ảnh tham chiếu:** `map/map_1.png` (bỏ qua hàng rào gỗ trong ảnh).  
**Bản sắc:** Đồng bằng rộng, ít dốc, có **sông lớn phía bắc** và **vịnh biển phía tây nam**. Thành phố chưa tồn tại — người chơi biến vùng đất này thành đô thị.  
**Lối chơi:** xem `01 §5`. Luật: `15`. Số liệu: `16`.

## 1. Thông số template

| Biến | Giá trị | Ghi chú |
|---|---|---|
| Lưới | 128 × 128 ô (2 m) | Chung engine |
| `waterLevelDm` | 20 | |
| Tỉ lệ nước | 18–25% | Sông bắc + vịnh tây nam + 1–2 ao nhỏ |
| Đất xây được (dốc ≤ 1 bậc/ô) trên đất khô | 60–70% | Đồng bằng |
| Chênh độ cao | 0–12 m | Đồi thấp ở rìa đông |
| Đường làng tự nhiên | 1 trục chính + vài nhánh, `roadTier = 1` | Không chạm nước |
| Env | Thưa ở trung tâm, dày ở rìa và ven nước | |
| Công trình / cầu / kè ban đầu | **0** | Bắt buộc |

## 2. Bố cục theo khu (8 × 8)

```text
   x→  0   1   2   3   4   5   6   7
z 0   [F] [F] [R] [R] [R] [R] [W] [F]     F = rừng/đá viền
  1   [F] [P] [R] [R] [R] [R] [P] [F]     R = sông lớn (băng ngang phía bắc)
  2   [F] [P] [P] [P] [P] [P] [P] [H]     P = đồng bằng
  3   [P] [P] [P] [S] [S] [P] [P] [H]     S = khu bắt đầu (27, 28, 35, 36)
  4   [B] [P] [P] [S] [S] [P] [P] [H]     H = đồi thấp phía đông
  5   [B] [B] [P] [P] [P] [o] [P] [P]     B = vịnh biển tây nam
  6   [B] [B] [B] [P] [P] [P] [P] [F]     W = thác nhỏ đổ vào sông
  7   [B] [B] [B] [B] [P] [P] [F] [F]     o = ao nhỏ
```

Ý đồ thiết kế:
- **Khu bắt đầu** (S) hoàn toàn đất khô, phẳng, có 2–3 vùng `suggestedLots` (bãi cỏ trống) và 10–15 cây để hướng dẫn chặt. Ô `ENTRY` ở mép tây khu 35 (đường làng đi ra mép tây bản đồ qua khu 32–34).
- **Sông bắc** cách khu bắt đầu 1 khu (hàng z = 1 có một dải đồng bằng hẹp phía nam sông). Khi người chơi mở khu hàng 1–2, sông hiện rõ → động lực kè + cầu ở cấp 4. Sông rộng 4–6 ô ở đoạn hẹp nhất (vừa cầu gỗ), 8–12 ô ở đoạn rộng (cần cầu đá).
- **Bờ bắc sông** (hàng z = 0, khu 1 và 6): đất đẹp, thưởng view nước — phần thưởng cho việc bắc cầu.
- **Vịnh tây nam:** bãi cát, đá ven bờ; đất ven vịnh là nơi đặt khách sạn (thưởng view nước +20% sau khi kè).
- **Đồi đông:** dốc 1–3 bậc/ô, cần san nhiều → đất rẻ hơn về cảm giác nhưng tốn tiền san.

## 3. Địa hình và nước

- Đồng bằng nhấp nhô nhẹ ±0,5–1 m (nhiễu tần số thấp) để san nền có ý nghĩa nhưng không mệt.
- Bờ sông/vịnh tự nhiên thỏa luật bờ (`15 §4.2.3`): đỉnh ven nước trong `[waterLevel+5, waterLevel+20]`.
- Đáy sông sâu 1,5–3 m dưới mặt nước; vịnh sâu dần ra xa bờ.
- Thác nhỏ ở khu 6 (vách đá đông bắc) có cờ `PROTECTED`.

## 4. Thực vật, đá

- Cây lá rộng + thông xen kẽ; mật độ trung tâm 0,03–0,05 env/ô, rìa 0,25–0,4 env/ô.
- Đá tảng tập trung ven sông/vịnh và đồi đông; 4–6 đá lớn (2×2) làm landmark (anchor).
- Không cây trên ô nước, đường, `ENTRY`; `suggestedLots` không có env blocking.

## 5. Khung cảnh camera mặc định

Nhìn từ đông nam về tây bắc, pitch 55°, thấy: khu bắt đầu ở giữa, dải sông phía trên, một phần vịnh bên trái dưới. 5 ảnh QA: `default`, `topdown`, `rotate180`, `shore-closeup`, `road-closeup`.

## 6. QA đặc thù

- [ ] Template: 0 công trình, 0 cầu, 0 kè, 0 đường nhựa, không hàng rào/đèn/vỉa hè/bến.
- [ ] Đoạn sông hẹp nhất ≤ 6 ô (cầu gỗ bắc được) và nằm trong ≤ 2 khu từ khu bắt đầu.
- [ ] Khu bắt đầu có ≥ 200 ô xây được và đường làng nối `ENTRY`.
- [ ] Không cây trong nước; đường làng không chạm nước.
- [ ] Bot mô phỏng (`10 §7`) bắc được cầu đầu tiên trong ngày 1.
