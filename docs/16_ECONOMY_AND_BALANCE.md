# 16 — Kinh tế và cân bằng

**Nguồn duy nhất cho mọi con số.** Khi triển khai, toàn bộ bảng dưới đây được chuyển thành `packages/content/economy.v1.json` (có `contentVersion`). Code không được hard-code số; chỉnh cân bằng = sửa JSON + tăng version.

**Các con số không đặt tay mà được tính** từ nguyên tắc ở §1 bằng mô hình `docs/tools/economy/model.mjs`, rồi kiểm tra nhịp lên cấp bằng mô phỏng 3 kiểu người chơi trong 60 ngày (§12). Muốn đổi số: sửa tham số trong mô hình → chạy lại → cập nhật bảng ở đây.

```bash
node docs/tools/economy/model.mjs              # in bảng giá + mô phỏng 60 ngày
node docs/tools/economy/calibrate-xp.mjs city  # hiệu chỉnh lại bảng XP sau khi đổi giá (city | farm)
```

## 1. Nguyên tắc cân bằng

| # | Nguyên tắc | Công thức / quy tắc |
|---|---|---|
| N1 | **Hoàn vốn mục tiêu tăng dần theo cấp mở khóa** | `T(L) = 1,5 × 1,15^(L−1)` giờ: 1,5 h (cấp 1) → 2,6 h (cấp 5) → 5,3 h (cấp 10) → 10,6 h (cấp 15) |
| N2 | **Thu nhập công trình được tính từ giá**, không đặt tay | `thu/giờ = giá trị quy đổi ÷ (T(L) × hệ số)`. Hệ số: kinh doanh 1,0; nhà ở 1,5 (bù bằng dân); ngân hàng 1,3 (bù bằng trần kho tiền); xưởng/chuồng 2,0 (cần nguyên liệu và thao tác) |
| N3 | **Giá trị quy đổi** | `V = $ + gỗ × 15 + đá × 20` (theo giá cửa hàng vật liệu) |
| N4 | **Cây ngắn lãi/giờ cao, cây dài cho người ít online; cấp cao lãi hơn** | Lãi/ô/giờ = `36,5 × 1,06^(L−1) × (giờ)^−0,2`. Giá bán = `(hạt + lãi/ô/giờ × giờ) ÷ sản lượng` |
| N5 | **Chuỗi chế biến tăng giá trị 2–4 lần** | Giá sản phẩm = giá trị nguyên liệu (theo giá bán) + biên lợi nhuận để xưởng hoàn vốn trong `2 × T(L)` khi chạy đủ công suất |
| N6 | **Mua luôn đắt hơn bán ≥ 2 lần** — không có vòng mua–bán sinh lời | Vật liệu: mua $15/$20, không bán lại. Nông sản: không mua được ở chợ (nếu P1 mở: giá mua = 2 × giá bán). Phá dỡ: hoàn 50% |
| N7 | **Tăng trưởng bị chặn** để không bùng nổ | Giới hạn số lượng mỗi loại công trình theo cấp (§6.2), đất theo khu (§9), XP hiệu chỉnh theo mô phỏng (§8) |
| N8 | **Nhịp lên cấp mục tiêu** (người chơi 3 phiên/ngày) | Cấp 5 ≈ ngày 1, cấp 8 ≈ ngày 4, cấp 10 ≈ ngày 7, cấp 12 ≈ ngày 12, cấp 15 ≈ ngày 22, cấp 20 ≈ ngày 50 |

## 2. Tiền tệ, tài nguyên, trạng thái đầu

| Tài nguyên | Nguồn | Dùng cho |
|---|---|---|
| **Đô la ($)** | Thu tiền công trình (Thành phố), bán nông sản (Quê), nhiệm vụ, thưởng lên cấp | Mọi thứ |
| **Gỗ** | Chặt cây, mua ở cửa hàng vật liệu | Công trình, cầu gỗ |
| **Đá** | Đập đá, mua ở cửa hàng vật liệu | Kè, đường cấp cao, cầu đá/bê tông, công trình lớn |
| **XP** | Xây dựng, thu tiền, thu hoạch, sản xuất (§8) | Lên cấp |
| **Nông sản / sản phẩm** (Quê) | Thu hoạch, chế biến | Bán, làm nguyên liệu |

- **Cửa hàng vật liệu** (luôn có trong menu, không cần xây): mua gỗ **$15**, đá **$20** mỗi đơn vị. Không bán ngược.
- **Trạng thái bắt đầu của mỗi nhân vật mới** (mỗi map một nhân vật; không chia sẻ giữa các map): $2 000, 20 gỗ, 10 đá, cấp 1, 0 XP, 4 khu trung tâm đã mở, 2 đội thợ. Kho nông sản (Quê) **trống** (`inventory = {}` — không có nông sản, sản phẩm hay hạt giống); Thành phố **0 dân**; 0 công trình.

## 3. Thời gian xây dựng

**Quyết định:** công trình và cầu **có thời gian xây**; thao tác địa hình và hạ tầng (dọn, san, cuốc, kè, đường) **hoàn thành ngay**.

**Lý do:**
- Thao tác địa hình là "cảm giác tay" cốt lõi (`01 §3`), phải thấy kết quả ngay. Chúng rẻ, thao tác nhiều, nên bắt chờ sẽ gây khó chịu.
- Công trình có thời gian chờ thì tạo lý do quay lại game và cảm giác mong đợi. Công trình càng lớn chờ càng lâu.
- Cấp thấp xây gần như tức thì (≤ 1 phút), để hướng dẫn tân thủ trôi chảy.

### 3.1 Luật

| Mục | Luật |
|---|---|
| Đội thợ | Số công trình/cầu xây **đồng thời**: 2 (cấp 1), 3 (cấp 5), 4 (cấp 10). Hết đội thợ thì không bắt đầu công trình mới |
| Trong lúc xây | Chiếm ô (occupancy) ngay khi đặt. Hiển thị giàn giáo + đồng hồ. **Chưa** sinh tiền, chưa cấp dân, chưa tính việc làm, chưa có hiệu lực thưởng/ngân hàng |
| Trả tiền | Trả toàn bộ lúc đặt |
| Hủy khi đang xây | Hoàn **100%** |
| Phá dỡ sau khi xong | Hoàn **50%** |
| Xây nhanh | Trả `ceil(50% × giá $ × thời gian còn lại ÷ tổng thời gian)`, tối thiểu $1. Không dùng vật liệu |
| XP xây dựng | Cộng khi **hoàn thành** (tránh xây–hủy lấy XP) |
| Hướng dẫn tân thủ | Công trình trong nhiệm vụ hướng dẫn (`§10`, nhiệm vụ 1–6) hoàn thành ngay |
| Thời điểm | `buildEndsAt` tính trên server; client chỉ hiển thị đếm ngược |

### 3.2 Thời gian từng loại

| Hạng mục | Thời gian |
|---|---|
| Dọn đất, san nền, cuốc, kè, đường (mọi cấp) | Tức thì |
| Cầu gỗ / cầu đá / cầu bê tông | 1 / 3 / 6 phút **mỗi ô nhịp** |
| Công trình | Theo bảng §6.1 và §7.3 (30 giây → 4 giờ) |

## 4. Dọn đất

| Hành động | Chi phí | Nhận | Giá trị nhận (quy đổi) |
|---|---|---|---|
| Chặt cây | $10 | 3 gỗ | $45 |
| Đập đá tảng (1 ô) | $20 | 4 đá | $80 |
| Đập đá lớn (2 × 2) | $60 | 15 đá | $300 |
| Phát bụi | $2 | — | — |

Dọn đất lãi về quy đổi (thưởng cho việc khai hoang) nhưng **hữu hạn**: env không mọc lại, và gỗ/đá không bán được, chỉ dùng để xây.

## 5. Địa hình và hạ tầng

| Hạng mục | Chi phí | Cấp mở | Map | Thời gian |
|---|---|---|---|---|
| San nền | $3 / bậc (0,5 m) / đỉnh thay đổi | 1 | Cả hai | Tức thì |
| Cuốc đất | $5 / ô | 1 | Quê | Tức thì |
| Bỏ cuốc | $0 | 1 | Quê | Tức thì |
| Kè đá | $30 + 3 đá / ô | 3 | Cả hai | Tức thì |
| Đường đất (tier 1) | $5 / ô | 1 | Cả hai | Tức thì |
| Đường sỏi (tier 2) | $15 + 1 đá / ô | 4 | Cả hai | Tức thì |
| Đường nhựa (tier 3) | $40 + 2 đá / ô | 8 | Thành phố | Tức thì |
| Đường lát đá (tier 3) | $40 + 2 đá / ô | 8 | Quê | Tức thì |
| Cầu gỗ | $80 + 5 gỗ / ô nhịp, nhịp tối đa **6** | 4 | Cả hai | 1 phút / ô |
| Cầu đá | $200 + 8 đá / ô nhịp, nhịp tối đa **12** | 8 | Cả hai | 3 phút / ô |
| Cầu bê tông | $400 + 10 đá / ô nhịp, nhịp tối đa **24** | 12 | Thành phố | 6 phút / ô |

Nâng cấp đường = trả chênh lệch giữa hai tier. Gỡ bất kỳ hạng mục = hoàn 50%. Ví dụ: san phẳng nền 2 × 2 ô (9 đỉnh), trung bình mỗi đỉnh lệch 1 bậc → $27.

## 6. Thành phố

### 6.1 Công trình

`V` = giá trị quy đổi. **Thu/giờ được tính** theo N2. `$/ô/giờ` tăng theo cấp để có động lực thay công trình nhỏ bằng công trình lớn khi hết đất.

| ID | Tên | Ô | $ | Gỗ | Đá | V | Cấp | Dân | Việc | **Thu/giờ** | Hoàn vốn | $/ô/giờ | Xây |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `house_small` | Nhà nhỏ | 2×2 | 300 | 5 | 0 | 375 | 1 | +4 | — | **170** | 2,2 h | 43 | 30 giây |
| `shop_grocery` | Tạp hóa | 2×2 | 500 | 5 | 0 | 575 | 1 | — | 3 | **380** | 1,5 h | 95 | 1 phút |
| `deco_garden` | Vườn hoa | 1×1 | 100 | 0 | 0 | 100 | 2 | — | — | +5% bán kính 5 ô | — | — | 15 giây |
| `deco_streetlight` | Cột đèn | 1×1 | 150 | 0 | 2 | 190 | 2 | — | — | — | — | — | 15 giây |
| `house_town` | Nhà phố | 2×3 | 1 200 | 10 | 5 | 1 450 | 3 | +10 | — | **490** | 3,0 h | 82 | 3 phút |
| `shop_cafe` | Cà phê | 2×2 | 1 500 | 10 | 5 | 1 750 | 3 | — | 5 | **880** | 2,0 h | 220 | 5 phút |
| `shop_restaurant` | Nhà hàng | 3×3 | 4 000 | 20 | 15 | 4 600 | 5 | — | 10 | **1 750** | 2,6 h | 194 | 15 phút |
| `deco_park` | Công viên | 3×3 | 2 000 | 10 | 10 | 2 350 | 5 | — | — | +10% bán kính 8 ô | — | — | 10 phút |
| `bank` | Ngân hàng | 3×3 | 12 000 | 10 | 40 | 12 950 | 7 | — | 15 | **2 870** | 4,5 h | 319 | 30 phút |
| `house_apartment` | Chung cư | 4×4 | 15 000 | 20 | 60 | 16 500 | 8 | +60 | — | **2 760** | 6,0 h | 173 | 45 phút |
| `shop_supermarket` | Siêu thị | 4×4 | 22 000 | 30 | 40 | 23 250 | 9 | — | 30 | **5 070** | 4,6 h | 317 | 1 giờ |
| `hotel` | Khách sạn | 4×5 | 50 000 | 40 | 80 | 52 200 | 12 | — | 40 | **7 480** | 7,0 h | 374 | 2 giờ |
| `office_tower` | Tòa văn phòng | 4×4 | 100 000 | 20 | 120 | 102 700 | 15 | — | 60 | **9 680** | 10,6 h | 605 | 4 giờ |
| `landmark_culture` | Nhà văn hóa | 7×6 | 30 000 | 40 | 80 | 32 200 | 10 | — | — | +10% bán kính 10 ô | — | — | 2 giờ |
| `landmark_palace` | Cung điện | 5×5 | 60 000 | 60 | 120 | 63 300 | 14 | — | — | +15% bán kính 12 ô | — | — | 3 giờ |
| `landmark_castle` | Lâu đài | 8×4 | 90 000 | 80 | 150 | 94 200 | 16 | — | — | +15% bán kính 12 ô | — | — | 4 giờ |

Ngân hàng: ngoài thu nhập, mỗi ngân hàng (tối đa 4 có hiệu lực) **+2 giờ trần kho tiền** cho toàn bộ công trình. Nút "Thu tất cả" có ngay từ đầu, không cần ngân hàng (D028). Khách sạn nhận thưởng view nước +20% thay vì +10%.

### 6.2 Giới hạn số lượng theo cấp

`số tối đa = min(trần, sàn + bước × (cấp hiện tại − cấp mở))`, làm tròn xuống. Đây là phanh chính chống xây hàng loạt, và là lý do để lên cấp.

| Công trình | Sàn | Bước/cấp | Trần | Cấp 3 | Cấp 5 | Cấp 8 | Cấp 10 | Cấp 12 | Cấp 15 | Cấp 20 |
|---|---|---|---|---|---|---|---|---|---|---|
| Nhà nhỏ | 4 | 2 | 40 | 8 | 12 | 18 | 22 | 26 | 32 | 40 |
| Tạp hóa | 3 | 1 | 25 | 5 | 7 | 10 | 12 | 14 | 17 | 22 |
| Vườn hoa | 4 | 2 | 60 | 6 | 10 | 16 | 20 | 24 | 30 | 40 |
| Cột đèn | 6 | 3 | 80 | 9 | 15 | 24 | 30 | 36 | 45 | 60 |
| Nhà phố | 3 | 2 | 50 | 3 | 7 | 13 | 17 | 21 | 27 | 37 |
| Cà phê | 2 | 1 | 25 | 2 | 4 | 7 | 9 | 11 | 14 | 19 |
| Nhà hàng | 2 | 1 | 20 | — | 2 | 5 | 7 | 9 | 12 | 17 |
| Công viên | 1 | 1 | 25 | — | 1 | 4 | 6 | 8 | 11 | 16 |
| Ngân hàng | 1 | 1/3 | 4 | — | — | 1 | 2 | 2 | 3 | 4 |
| Chung cư | 2 | 1 | 30 | — | — | 2 | 4 | 6 | 9 | 14 |
| Siêu thị | 1 | 1 | 18 | — | — | — | 2 | 4 | 7 | 12 |
| Khách sạn | 1 | 1/2 | 10 | — | — | — | — | 1 | 2 | 5 |
| Tòa văn phòng | 1 | 1/2 | 10 | — | — | — | — | — | 1 | 3 |
| Nhà văn hóa | 1 | 0 | 1 | — | — | — | 1 | 1 | 1 | 1 |
| Cung điện | 1 | 0 | 1 | — | — | — | — | — | 1 | 1 |
| Lâu đài | 1 | 0 | 1 | — | — | — | — | — | — | 1 |
| Thành cổ | 1 | 0 | 1 | — | — | — | — | — | 1 | 1 |

### 6.3 Công thức thu nhập

```text
E_work   = min(1, tổngDân / tổngViệc)            // chỉ áp dụng cho công trình có Việc > 0
decor    = min(0.30, Σ thưởng trang trí trong bán kính)
water    = 0.10 nếu trong bán kính 4 ô có ô EMBANKED (khách sạn: 0.20), ngược lại 0
roadMult = 1.0 / 1.1 / 1.2 theo tier cao nhất của ô đường đã kết nối kề công trình
rate     = baseRate × E_work × (1 + decor + water) × roadMult     // 0 nếu không có đường kết nối hoặc đang xây
capHours = 6 + 2 × min(4, số ngân hàng đã xong và có đường kết nối)   // 6 → 14 giờ
```

- Bán kính đo theo **khoảng cách Chebyshev** giữa ô bất kỳ của footprint nguồn và ô bất kỳ của footprint đích.
- Bố cục tối ưu (trang trí 30% + view nước 10% + đường nhựa 20%) cho tối đa ×1,68, tức thời gian hoàn vốn ngắn hơn ~40%. Đây là phần thưởng cho người chơi chịu quy hoạch.

**Trần kho tiền và lịch chơi:** tỉ lệ thu nhập giữ được trong một ngày (tính bằng mô hình):

| Người chơi | 0 ngân hàng (6 h) | 1 (8 h) | 2 (10 h) | 3 (12 h) | 4 (14 h) |
|---|---|---|---|---|---|
| Chăm (4 phiên/ngày) | 84% | 93% | 100% | 100% | 100% |
| Thường (3 phiên/ngày) | 70% | 87% | 97% | 100% | 100% |
| Nhàn (1 phiên/ngày) | 26% | 34% | 42% | 51% | 59% |

→ Ngân hàng có giá trị thật cho người chơi thưa; trần 6 h vẫn "nhắc" người chơi quay lại.

### 6.4 Settle (chốt tích lũy)

Mỗi công trình kinh doanh lưu `accrued` (tiền đang chờ) và `settledAt`.

```text
settle(b, now):
  elapsedH  = (now - max(b.settledAt, b.buildEndsAt)) / 3600
  earned    = b.rate * max(0, elapsedH)
  // trần chỉ giới hạn phần TÍCH LŨY MỚI; tiền đã tích lũy không bao giờ bị trừ (Q001)
  b.accrued = b.accrued + min(earned, max(0, b.rate * capHours - b.accrued))
  b.settledAt = now
```

- Trước **mọi lệnh làm thay đổi `rate` hoặc `capHours`** của bất kỳ công trình nào (xây xong, phá, đường, cầu, kè), server settle **toàn bộ** công trình bằng `rate` cũ rồi mới áp lệnh. Công trình xây xong được xử lý như một sự kiện tại `buildEndsAt` (settle tại thời điểm đó, theo thứ tự thời gian).
- `COLLECT(b)`: settle → cộng `floor(accrued)` vào ví → `accrued -= floor(accrued)`.
- Bong bóng tiền hiện khi `accrued ≥ 10% trần`.

### 6.5 Nâng cấp công trình (D028)

Bể tiêu tiền cuối game. Công trình kinh doanh, nhà ở, xưởng/chuồng và kho nâng được tới **cấp 3**. Trong lúc nâng cấp, công trình vẫn hoạt động và thu tiền như cũ nhưng **chiếm 1 đội thợ**; xong thì hiệu quả mới áp dụng.

| Cấp công trình | Cấp người chơi | Chi phí (× giá xây) | Thời gian (× thời gian xây) | Hiệu quả |
|---|---|---|---|---|
| 2 | 10 | 2,5 | 2 | +50% |
| 3 | 15 | 5 | 3 | +100% |

- Hiệu quả: thu nhập/giờ và dân số × (1 + hiệu quả); xưởng/chuồng **+1 hàng sản xuất** mỗi cấp; kho: sức chứa cộng thêm × (1 + hiệu quả).
- Phần thu nhập tăng thêm hoàn vốn chậm 5–10 lần so với công trình gốc, nên nâng cấp là chỗ tiêu tiền cuối game, không rút ngắn nhịp §12.
- Phá dỡ hoàn 50% cả phần đã nâng cấp; hủy khi đang nâng cấp hoàn 100% chi phí nâng cấp; xây nhanh tính theo chi phí nâng cấp.

## 7. Quê

### 7.1 Cây trồng

Hạt mua bằng $ khi gieo. Sản lượng tính trên mỗi ô. **Giá bán được tính** theo N4.

| ID | Tên | Cấp | Hạt/ô | Thời gian | Sản lượng | **Giá bán** | Lãi/ô | Lãi/ô/giờ | XP/ô |
|---|---|---|---|---|---|---|---|---|---|
| `veg_greens` | Rau cải | 1 | 3 | 5 phút | 2 | **4** | 5 | 60 | 1 |
| `rice` | Lúa | 1 | 5 | 10 phút | 2 | **7** | 9 | 54 | 1 |
| `corn` | Ngô | 2 | 10 | 30 phút | 3 | **11** | 23 | 46 | 2 |
| `tomato` | Cà chua | 4 | 20 | 1 giờ | 4 | **16** | 44 | 44 | 2 |
| `sugarcane` | Mía | 6 | 30 | 2 giờ | 4 | **29** | 86 | 43 | 3 |
| `watermelon` | Dưa hấu | 8 | 50 | 4 giờ | 2 | **108** | 166 | 41,5 | 4 |
| `pumpkin` | Bí ngô | 10 | 80 | 8 giờ | 3 | **135** | 325 | 40,6 | 5 |
| `coffee` | Cà phê | 12 | 120 | 12 giờ | 4 | **156** | 504 | 42 | 6 |

- Người chơi online liên tục: rau cải lãi nhất mỗi giờ (60). Người chơi 3 phiên/ngày: cây 4–12 giờ lãi nhất mỗi **lần thu**. Không có cây "tốt nhất cho mọi người".
- **Tưới nước:** ô ruộng có giếng trong bán kính 6 ô **hoặc** có ô nước trong bán kính 3 ô → thời gian × 0,8. Không cộng dồn, chốt lúc gieo.
- Cây chín không héo.

### 7.2 Xưởng chế biến và chuồng trại

**Giá sản phẩm được tính** theo N5. Mỗi slot có **hàng chờ 3 mẻ** chạy nối tiếp, để người chơi thưa vẫn có sản lượng khi offline.

| ID | Tên | Cấp | Ô | $ | Gỗ | Đá | V | Slot | Mẻ | Nguyên liệu (giá trị) | Sản phẩm | **Giá bán** | Lãi/slot/giờ | Hoàn vốn (đủ công suất) | Xây | XP/mẻ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `chicken_coop` | Chuồng gà | 3 | 3×3 | 1 500 | 20 | 5 | 1 900 | 6 | 20 phút | 1 ngô ($11) | Trứng | **40** | 87 | 3,6 h | 5 phút | 2 |
| `rice_mill` | Cối xay | 5 | 3×3 | 3 000 | 20 | 20 | 3 700 | 3 | 15 phút | 3 lúa ($21) | Bột gạo | **80** | 236 | 5,2 h | 15 phút | 2 |
| `cow_barn` | Chuồng bò | 7 | 4×4 | 6 000 | 40 | 20 | 7 000 | 6 | 1 giờ | 3 ngô + 3 lúa ($54) | Sữa | **220** | 166 | 7,0 h | 30 phút | 4 |
| `bakery` | Lò bánh | 9 | 3×3 | 12 000 | 20 | 40 | 13 100 | 3 | 30 phút | 2 bột + 1 trứng ($200) | Bánh mì | **440** | 480 | 9,1 h | 1 giờ | 6 |

- Tỉ lệ giá trị đầu ra/đầu vào: trứng 3,6×, bột 3,8×, sữa 4,1×, bánh mì 2,2×.
- **Số lượng mỗi loại xưởng/chuồng:** `min(4, 1 + floor((cấp − cấp mở) / 3))`.
- Xưởng/chuồng cần **đường kết nối** mới bắt đầu mẻ được. Ruộng không cần đường.
- Nguyên liệu bị trừ khi đưa mẻ vào hàng chờ.

### 7.3 Công trình khác

| ID | Tên | Ô | $ | Gỗ | Đá | Cấp | Xây | Chức năng |
|---|---|---|---|---|---|---|---|---|
| `market` | Chợ | 3×3 | 200 | 5 | 0 | 1 | 30 giây | Điểm bán. Tối đa 1. Cần đường kết nối |
| `farmhouse` | Nhà nông | 3×3 | theo bảng dưới | 10 | 5 | theo bảng | 1 phút | +24 hạn mức ô ruộng mỗi cái. Tối đa 10 |
| `well` | Giếng | 1×1 | 300 | 0 | 5 | 2 | 2 phút | Tưới bán kính 6 ô |
| `silo` | Kho | 2×2 | 800 | 10 | 10 | 2 | 5 phút | +100 sức chứa |
| `deco_flowerbed` | Luống hoa | 1×1 | 80 | 0 | 0 | 2 | 15 giây | Trang trí |
| `deco_streetlight` | Cột đèn | 1×1 | 150 | 0 | 2 | 2 | 15 giây | Trang trí |
| `landmark_citadel` | Thành cổ | 10×6 | 80 000 | 120 | 200 | 15 | 4 giờ | Công trình biểu tượng. Tối đa 1 |

**Nhà nông** (giá tăng dần, cấp yêu cầu):

| Thứ tự | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Giá $ | 500 | 1 500 | 4 000 | 8 000 | 15 000 | 25 000 | 40 000 | 60 000 | 90 000 | 130 000 |
| Cấp | 1 | 3 | 5 | 7 | 9 | 11 | 13 | 15 | 17 | 19 |
| Tổng ô ruộng | 24 | 48 | 72 | 96 | 120 | 144 | 168 | 192 | 216 | 240 |

- **Sức chứa kho cơ bản:** 100 đơn vị nông sản/sản phẩm (gỗ, đá không tính). Bán ở chợ ngay lập tức, nên kho chỉ giới hạn lượng giữ lại làm nguyên liệu.

### 7.4 Giá mua và giá bán (tổng hợp)

| Giao dịch | Giá | Ghi chú |
|---|---|---|
| Mua gỗ / đá | $15 / $20 | Cửa hàng vật liệu, không giới hạn |
| Bán gỗ / đá | Không | Tránh khai thác dọn đất |
| Mua hạt giống | Bảng §7.1 (cột Hạt/ô) | Chiếm 7–30% doanh thu của ô |
| Bán nông sản / sản phẩm | Bảng §7.1, §7.2 | Tại chợ, nhận tiền ngay |
| Mua nông sản ở chợ | Không (MVP) | Nếu mở (P1): giá = 2 × giá bán |
| Phá dỡ / gỡ hạ tầng | Hoàn 50% | Hủy khi đang xây: 100% |

## 8. XP và cấp độ

### 8.1 Nguồn XP

| Nguồn | Thành phố | Quê |
|---|---|---|
| Hoàn thành công trình / cầu | `round(2 × √V)` (ví dụ Nhà nhỏ 39, Ngân hàng 228, Tòa văn phòng 641) | Như Thành phố |
| Hạ tầng, địa hình (dọn, san, cuốc, kè, đường) | 1 XP / $20 chi | 1 XP / $20 chi |
| Thu tiền | 1 XP / $500 thu được | — |
| Thu hoạch | — | Cột "XP/ô" §7.1, mỗi ô |
| Sản phẩm xong | — | Cột "XP/mẻ" §7.2 |
| Nhiệm vụ | Theo §10 | Theo §10 |

- Không tính XP từ mua hạt, mua vật liệu, mở khu.
- Nguồn XP của mỗi map khác nhau nên **mỗi map có bảng XP riêng** (mỗi map là một nhân vật riêng). Bảng được **hiệu chỉnh bằng mô phỏng** để hai map có nhịp lên cấp gần nhau với người chơi 3 phiên/ngày.
- **Thưởng lên cấp:** `$150 × cấp mới`.

### 8.2 Bảng XP tích lũy để đạt cấp

| Cấp | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|
| Thành phố | 40 | 150 | 340 | 1 600 | 2 900 | 4 200 | 6 100 | 9 500 | 14 000 | 22 000 |
| Quê | 40 | 120 | 220 | 780 | 1 360 | 2 560 | 3 450 | 5 320 | 8 270 | 11 910 |

| Cấp | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|
| Thành phố | 36 000 | 54 000 | 73 000 | 100 000 | 140 000 | 180 000 | 240 000 | 330 000 | 430 000 |
| Quê | 17 530 | 23 080 | 29 270 | 37 370 | 46 380 | 57 430 | 70 150 | 86 820 | 107 100 |

Cấp 2–4 được đặt tay theo hướng dẫn tân thủ (đạt trong ~5–20 phút đầu).

Quê cấp 5–20 đổi ở contentVersion 2 (D025, Q010): hiệu chỉnh trên sim thật bằng `scripts/q010-xp-calibrate.ts` để người chơi thường đạt các mốc §12.1 (lệch +1…+9%). Bảng cũ (v1): 960 / 2 200 / 3 500 / 5 700 / 8 800 / 14 000 / 21 000 / 33 000 / 45 000 / 58 000 / 75 000 / 95 000 / 120 000 / 150 000 / 190 000 / 240 000. World v1 được chuyển lên v2 khi tải (giữ nguyên XP, tính lại cấp).

### 8.3 Bảng mở khóa

| Cấp | Thành phố | Quê |
|---|---|---|
| 1 | Dọn đất, san nền, đường đất, Nhà nhỏ, Tạp hóa | Dọn đất, san nền, cuốc, đường đất, Chợ, Nhà nông #1, Rau cải, Lúa |
| 2 | Vườn hoa | Ngô, Giếng, Kho, Luống hoa |
| 3 | Nhà phố, Cà phê, **Kè đá** | Chuồng gà, **Kè đá**, Nhà nông #2 |
| 4 | **Cầu gỗ**, đường sỏi | Cà chua, **Cầu gỗ**, đường sỏi |
| 5 | Nhà hàng, Công viên, đội thợ thứ 3 | Cối xay, Nhà nông #3, đội thợ thứ 3 |
| 6 | — | Mía |
| 7 | Ngân hàng | Chuồng bò, Nhà nông #4 |
| 8 | Chung cư, đường nhựa, **Cầu đá** | Dưa hấu, đường lát đá, **Cầu đá** |
| 9 | Siêu thị | Lò bánh, Nhà nông #5 |
| 10 | Đội thợ thứ 4 | Bí ngô, đội thợ thứ 4 |
| 11 | — | Nhà nông #6 |
| 12 | Khách sạn, **Cầu bê tông** | Cà phê |
| 13 / 15 / 17 / 19 | Tòa văn phòng (15) | Nhà nông #7 / #8 / #9 / #10 |

Mỗi lần lên cấp còn nâng giới hạn số lượng công trình (§6.2) và số xưởng/chuồng (§7.2).

## 9. Mở khu đất

- `k` = số khu đã mua thêm (không tính 4 khu ban đầu), bắt đầu từ 0; tối đa 60.
- **Giá:** `$(1 000 + 800·k + 150·k²)`.
- **Cấp yêu cầu:** `min(20, 2 + floor(k / 3))`.
- Khu có > 50% diện tích là nước: giá × 0,5.
- Chỉ mua khu kề cạnh (4 hướng) một khu đã mở.

### 9.1 Trợ cấp khẩn cấp (D028)

Lưới an toàn chống kẹt: khi tiền mặt **dưới $150** và không còn nguồn thu nào (Thành phố: không công trình nào đang có thu nhập, có tiền chờ thu hay là công trình kinh doanh đang xây; Quê: không có cây đang trồng, kho trống và không có mẻ sản xuất), người chơi nhận **$600** trợ cấp, tối đa 1 lần mỗi **24 giờ**. Không cộng XP.

| k | Giá | Cấp |
|---|---|---|
| 0 | 1 000 | 2 |
| 3 | 4 750 | 3 |
| 6 | 11 200 | 4 |
| 10 | 24 000 | 5 |
| 20 | 77 000 | 8 |
| 30 | 160 000 | 12 |
| 59 | 570 350 | 20 |

## 10. Nhiệm vụ tân thủ

### 10.1 Thành phố

| # | Nhiệm vụ | Thưởng |
|---|---|---|
| 1 | Chặt 3 cây | $100, 20 XP |
| 2 | Làm đường nối điểm vào tới khu đất trống (≥ 6 ô) | $100, 10 XP |
| 3 | San phẳng một nền 2 × 2 | $50, 10 XP |
| 4 | Xây Nhà nhỏ (hoàn thành ngay) | $150 |
| 5 | Xây Tạp hóa (hoàn thành ngay) | $200 |
| 6 | Thu tiền lần đầu (tutorial: tích lũy tăng tốc 60×) | $100 |
| 7 | Có 12 dân | $300 |
| 8 | Xây Vườn hoa | $200 |
| 9 | Mở thêm 1 khu đất | $500 |
| 10 | Kè 4 ô bờ sông | $300, 10 đá |
| 11 | Bắc một cây cầu gỗ | $800 |
| 12 | Có một công trình sinh tiền ở bờ bên kia cầu | $1 000 |

### 10.2 Quê

| # | Nhiệm vụ | Thưởng |
|---|---|---|
| 1 | Xây Chợ và nối đường (hoàn thành ngay) | $100 |
| 2 | Xây Nhà nông (hoàn thành ngay) | $100 |
| 3 | Cuốc 6 ô đất | $50, 10 XP |
| 4 | Gieo Rau cải (tutorial: chín sau 20 giây) | $30 |
| 5 | Thu hoạch | $50 |
| 6 | Bán 10 nông sản ở chợ | $100 |
| 7 | Gieo 10 ô Lúa | $100 |
| 8 | Xây Giếng | $200 |
| 9 | Xây Chuồng gà và cho gà ăn | $300 |
| 10 | Kè 4 ô bờ suối | $300, 10 đá |
| 11 | Bắc cầu gỗ qua suối | $800 |
| 12 | Cuốc ruộng ở bờ bên kia | $500 |

### 10.3 Nhiệm vụ lặp — đặc tả được duyệt 2026-10-10, triển khai G3

- Sau nhiệm vụ 12, mỗi nhân vật có **3 nhiệm vụ lặp đang hoạt động**. Hoàn thành → thay ngay bằng nhiệm vụ mới.
- **1 lần đổi nhiệm vụ miễn phí mỗi 4 giờ**. Chỉ chọn mục tiêu đã mở ở cấp hiện tại; không chọn cùng một mẫu hai lần liên tiếp.
- Thành phố: thu `$X` với `X = 1 giờ thu nhập cơ sở hiện tại`; xây `N = 1–3` công trình thuộc loại đã mở;
  làm/nâng cấp `N` ô đường; kè `N` ô; đạt dân số `P`.
- Quê: thu hoạch `N` ô cây `Y`; bán `N` đơn vị vật phẩm `Y`; sản xuất `N` đơn vị sản phẩm `Y`; cuốc `N` ô.
- Chọn kích thước mục tiêu để hoàn thành trong **30–60 phút chơi bình thường**. Hiệu chỉnh và kiểm chứng bằng `sim-economy` ở G3; không tự đặt thêm hằng số.
- Thu nhập tham chiếu một giờ: Thành phố = tổng rate cơ sở hiện tại trước trần kho tiền;
  Quê = hạn mức ruộng × lãi/ô/giờ của cây đã mở có lãi cao nhất × **0,5**.
- Tiền thưởng = **25%** thu nhập tham chiếu một giờ, làm tròn tới **$10**, tối thiểu **$100**.
  Tương đương thưởng ≈ 15 phút thu nhập tham chiếu, trước làm tròn và mức tối thiểu.
- XP thưởng = `round(2 × √tiền_thưởng)`.
- Tất cả hằng số trên phải nằm trong `economy.v1.json` và được kiểm bằng `sim-economy` tại G3.

## 11. Núm tinh chỉnh

Trong `model.mjs` (object `P`) và `economy.v1.json`: `paybackBaseH`, `paybackGrowth`, hệ số nhà ở/ngân hàng/xưởng, `cropP0`, `cropCycleExp`, `cropLevelGrowth`, giá vật liệu, `capBaseH`, `bankCapH`, `bankCapMax`, `limit[]` từng công trình, `builders(L)`, `speedupPct`, `refund`, `xpBuild`, `xpCollect`, XP/ô, `xpCumMap`, `levelReward`, `zoneCost`, `zoneLevel`, mọi dòng trong bảng công trình/cây trồng/xưởng.

**Quy trình đổi số:** sửa tham số → `node model.mjs --tables` (xem bảng mới) → `node calibrate-xp.mjs city|farm` (bảng XP mới) → `node model.mjs --sim` (kiểm tra nhịp §12) → cập nhật tài liệu này + JSON + tăng `contentVersion`.

## 12. Kết quả mô phỏng (60 ngày, mô hình `docs/tools/economy`)

**Giả định:** người chơi ra quyết định tham lam theo tỉ lệ lợi nhuận/giá, thu tiền mỗi 5 phút khi đang chơi, có tính trần kho tiền, thời gian xây, đội thợ và giới hạn số lượng.

| Kiểu người chơi | Lịch chơi |
|---|---|
| Chăm | Ngày 1 chơi 60 phút; sau đó 4 phiên × 15 phút (7h, 12h, 17h, 21h) |
| Thường | Ngày 1 chơi 25 phút; sau đó 3 phiên × 8–10 phút (8h, 12h30, 21h) |
| Nhàn | 1 phiên/ngày × 10–15 phút (21h) |

### 12.1 Thời gian (đã trôi qua) để đạt cấp

| Cấp | TP – Chăm | TP – Thường | TP – Nhàn | Quê – Chăm | Quê – Thường | Quê – Nhàn |
|---|---|---|---|---|---|---|
| 5 | 4 giờ | 17 giờ | 2 ngày | 4 giờ | 1 ngày | 3 ngày |
| 8 | 2,5 ngày | 3,5 ngày | 9 ngày | 2 ngày | 4 ngày | 12 ngày |
| 10 | 5 ngày | 6 ngày | 16 ngày | 4 ngày | 7 ngày | 21 ngày |
| 12 | 10 ngày | 11 ngày | 28 ngày | 8 ngày | 12 ngày | 35 ngày |
| 15 | 19 ngày | 21 ngày | 48 ngày | 15 ngày | 22 ngày | 59 ngày |
| 18 | 33 ngày | 35 ngày | — | 24 ngày | 37 ngày | — |
| 20 | 48 ngày | 49 ngày | — (cấp 16) | 35 ngày | 52 ngày | — |

Nhận xét:
- Người chơi thường đạt nhịp mục tiêu N8 ở cả hai map (sai lệch ~15%).
- Thành phố là map **nhàn**: chơi chăm chỉ chỉ nhanh hơn ~5–10%. Quê là map **chủ động**: chơi chăm nhanh hơn ~1,5 lần. Đúng bản sắc `01 §5`.
- Người chơi 1 phiên/ngày chậm hơn ~2,5 lần. Ở Thành phố họ mất 40–75% thu nhập vì trần kho tiền (§6.3).

### 12.2 Thành phố — người chơi thường theo ngày

| Hết ngày | Cấp | Thu nhập/giờ | Số công trình | Số khu |
|---|---|---|---|---|
| 1 | 4 | $3 700 | 17 | 4 |
| 2 | 5 | $13 300 | 43 | 4 |
| 3 | 6 | $22 500 | 53 | 4 |
| 7 | 10 | $60 000 | 100 | 4 |
| 14 | 12 | $113 000 | 126 | 6 |
| 21 | 14 | $153 000 | 152 | 7 |
| 30 | 17 | $208 000 | 191 | 10 |
| 45 | 19 | $280 000 | 218 | 11 |
| 60 | 20 | $304 000 | 229 | 12 |

### 12.3 Quê — người chơi thường theo ngày

| Hết ngày | Cấp | Ô ruộng | Xưởng/chuồng |
|---|---|---|---|
| 1 | 4 | 48 | 0 |
| 3 | 6 | 72 | 3 |
| 7 | 9 | 120 | 7 |
| 14 | 12 | 144 | 11 |
| 30 | 16 | 192 | 15 |
| 45 | 19 | 240 | 16 |

### 12.4 Rủi ro cần playtest

| Rủi ro | Biểu hiện trong mô phỏng | Hướng xử lý |
|---|---|---|
| **Dư tiền cuối game** | Thành phố tích ~$280 triệu tiền mặt không dùng ở ngày 60 (Quê ~$17 triệu) | P1: nâng cấp công trình, trang trí cao cấp, sự kiện; hoặc giảm thu nhập công trình cấp 12+ |
| **Nhu cầu đất thấp** | Chỉ dùng ~12/64 khu ở ngày 60; mở rộng chủ yếu do nhiệm vụ | Thử giảm diện tích dùng được mỗi khu, thưởng mặt nước lớn hơn, hoặc nhiệm vụ lặp gắn với mở khu/cầu |
| **Cấp 2–4 quá nhanh** | Mô phỏng tiêu tiền ngay nên lên cấp 4 sau 5 phút | Nhịp thực tế do hướng dẫn quyết định; đo lại trong playtest |
| **Người chơi thưa ở Thành phố** | Mất 40–75% thu nhập do trần 6 giờ | Nếu D7 thấp: tăng `capBaseH` lên 8 |
| **Mô hình Quê đơn giản hóa** | Giả định luôn đủ nguyên liệu (mua theo giá bán), bán ngay | Kiểm tra lại khi có bản chơi thử G2 |

## 13. Tổng tài sản (net worth) của nhân vật

Chỉ số hiển thị trên HUD/hồ sơ và dùng cho bảng xếp hạng từng map (P1). Mỗi nhân vật một giá trị riêng.

```text
quyĐổi(cost)  = cost.cash + cost.wood × 15 + cost.stone × 20      // theo giá cửa hàng vật liệu

tổngTàiSản =
    tiềnMặt
  + Σ floor(accrued)                         // tiền đang chờ thu ở công trình (sau settle)
  + Σ công trình:  investedValue              // = quyĐổi(chi phí thực trả lúc xây), kể cả công trình đang xây
  + Σ ô đường:     quyĐổi(chi phí người chơi thực trả cho ô còn tồn tại)
  + Σ ô kè:        quyĐổi(chi phí kè)
  + Σ cầu:         quyĐổi(chi phí cầu)
  + landValue                                 // tổng tiền đã trả để mở khu
  + gỗ × 15 + đá × 20
  + Σ kho nông sản/sản phẩm × giá bán          // chỉ map Quê
```

- **Không tính:** chi phí san nền, cuốc, dọn đất (công thi công, không phải tài sản), tiền hạt đã gieo, nguyên liệu đang trong hàng chờ, tiền xây nhanh.
- Đường làng có sẵn trong template không tính tài sản. Chỉ tính chi phí người chơi thực trả:
  ô mới, chênh lệch nâng cấp và xây lại ô đường template đã xóa (Q006, duyệt 2026-10-10).
- Phá dỡ: tài sản giảm `investedValue`, tiền mặt tăng 50% → tổng tài sản giảm 50% giá trị công trình. Hủy khi đang xây: không đổi (hoàn 100%).
- Server lưu `net_worth` trên bản ghi nhân vật, cập nhật sau mỗi lệnh thành công; job đêm tính lại toàn bộ để đối soát.
- Khởi đầu: $2 000 + 20 × 15 + 10 × 20 = **$2 500**.
