# Map thứ 3: Thị trấn (`town`)

Owner: "Thêm map thứ 3 lẫn city và đồng quê (all toàn bộ công trình)". Bản đồ trộn thành phố và đồng quê; mọi công trình, công cụ, hành động của `city` và `farm` đều dùng được.

## Thiết kế

- `MapKind = 'city' | 'farm' | 'town'`, hiển thị **Thị trấn**. Helper trong `packages/contracts/src/grid.ts`:
  - `hasCityFeatures(kind)` = kind khác `farm`; `hasFarmFeatures(kind)` = kind khác `city`;
  - `kindAllows(mapKinds, kind)`: town nhận **mọi** mục có `mapKinds` (không có danh sách theo id), nên `landmark_rome` (hoặc bất kỳ công trình city/farm nào thêm sau) tự có trên town. Nhánh khác vẫn cần dùng `kindAllows` thay cho `mapKinds.includes(kind)` khi viết code mới.
- Luật rộng hơn khi hai map khác nhau: cầu bê tông (chỉ city) và đường tier 2–3 dùng được; không cổng cấp riêng cho town.
- Sim: COLLECT / thu nhập / tích lũy `accrued` / tutorial x60 theo city; TILL, PLANT, HARVEST, SELL, sản xuất, kho, hạn mức ruộng theo farm; snapshot validate cho phép cả TILLED, crops, inventory; trợ cấp khẩn cấp chỉ khi cả hai phía đều không kiếm tiền.
- XP: bảng `xp.cumulative.town` = max từng cấp của city và farm (= bảng city), để bù thu nhập cộng dồn.
- Nhiệm vụ lặp: hợp của mẫu city và farm; thu nhập tham chiếu = tổng rate thành phố + thu nhập ruộng (`collect_cash` chỉ dùng phần thành phố vì COLLECT chỉ trả thu nhập thành phố).
- Chuỗi tân thủ `town` 14 nhiệm vụ (`docs/16 §10.4`), 6 đầu là tutorial. Nhà nông, rau cải 20 s và nhà nhỏ xây ngay chỉ hoạt động khi nhiệm vụ tương ứng đang mở (D041), nên các nhiệm vụ đó nằm trong 5 nhiệm vụ đầu hoặc mở sau 1–2 lần nhận.
- Bản đồ: luôn ngẫu nhiên (D039 `generateWorldTemplate('town', seed)`, nước ≈20%, dòng seed riêng 303, nền ngưỡng nước/độ cao như city). Online lưu ở `world_templates`; offline `?map=town`.
- API: migration `0004_town_map_kind.sql` mở CHECK `worlds.map_kind` cho `town`. `createCharacter('town')` luôn sinh template ngẫu nhiên kể cả khi `RANDOM_MAPS` tắt. Tài khoản có sẵn city + farm mở town từ màn chọn map (nút "Tạo nhân vật" ở thẻ Thị trấn) như đổi giữa city và farm; tài khoản mới có thể bắt đầu ngay ở town. Thẻ town không chờ `/api/maps` (không có template tĩnh).
- Web: thẻ Thị trấn (3 cột, tablet town chiếm hàng 2), Dock đủ 6 tab (Nông trại hiện nhờ `hasFarmFeatures`), thanh trên có cả Dân số và Kho nông sản, danh hiệu riêng, nhạc riêng (220 Hz, 77 bpm), nút Thu tiền, thông báo cả hai phía, bảng Cư dân hiện cả hai.
- Bot: `TownBot` (FarmBotV3 + vòng lặp xây của CityBotV2) chạy cả vòng city và farm mỗi phút; `sim-economy --map town --seed N`.

## Kiểm chứng

- **Sweep** (`scripts/town-sweep.ts`, 50 seed 20260000..49): đạt `checkPlayability` + `validateTemplate` **50/50**, nước 19,97–20,10% (TB 20,00%), thời gian sinh TB 539 ms, trung vị 508 ms, tối đa 1342 ms, 49/50 đạt ở lần thử đầu. `docs/evidence/g4/town/sweep.json`.
- **Bot 7 ngày** (`scripts/town-bot-bench.ts`, 3 seed ngẫu nhiên mỗi loại, trung vị; `docs/evidence/g4/town/bot-bench.json`). Net worth ngày 7 / cấp / nhiệm vụ đã nhận / ngày hoàn thành chuỗi:

| Map / kiểu chơi | thường | chăm (`cham`) | nhàn (`nhan`) |
|---|---|---|---|
| city authored | 3.106K / L9 / 11 / chưa | 5.961K / L10 / 10 / chưa | 259K / L5 / 10 / chưa |
| farm authored | 110K / L9 / 12 / 4,0 ngày | 243K / L11 / 12 / 1,2 ngày | 21K / L6 / 10 / chưa |
| city ngẫu nhiên | 4.733K / L10 / 12 / 0,02 | 9.381K / L11 / 12 / 0,02 | 382K / L7 / 12 / 1,0 |
| farm ngẫu nhiên | 162K / L10 / 12 / 0,5–0,7 | 265K / L11 / 12 / 0,03 | 34K / L7 / 12 / 2,0 |
| **town ngẫu nhiên** | **4.767K / L11 / 14 / 0,5–1,7** | **11.628K / L13 / 14 / 0,2–0,55** | **221K / L7 / 14 / 1,0–2,0** |

  (`cham` = chăm, lịch chơi dày; `nhan` = nhàn, lịch thưa.) Mọi lần chạy: snapshot hợp lệ, ví an toàn, tutorial xong trong 0 ngày; town hoàn thành cả 14 nhiệm vụ trong mọi lần chạy.
  - Kết luận: town xấp xỉ **city ngẫu nhiên** (thường +1%, chăm +24%, nhàn −42% do 12 vòng xây city chia sẻ tiền với ruộng); giàu hơn farm hàng chục lần (như city). Không giàu bất thường so với city, nên **không áp bộ điều chỉnh nào**. Nếu muốn kéo kiểu chăm về ngang city, đề xuất: nhân thưởng nhiệm vụ lặp town ×0,8 hoặc bảng XP town chậm thêm 10%; chưa áp.
- Test: `pnpm check` (lint, typecheck, 814 vitest, build) xanh; `pnpm test:api` 43/43 (thêm 3 test town); test sim `town.test.ts` (12) và worldgen thêm 1 test town. Test hiện có không đổi. `npx tsx scripts/build-maps.ts`: template city/farm không đổi byte; JSON nội dung city/farm không đổi (chỉ thêm khóa town).
- Evidence Playwright (`scripts/town-qa.mjs`, `docs/evidence/g4/town/`): `map-choice-{1440x900,pixel7}.jpg` (mock API), `overview-*`, `dock-*`, `dock-farms-tab-*`, `dock-buildings-tab-*`, `house-and-field-*`, `missions-*`, `missions-after-claim-*`, `night-*`, `report-{offline,online}.json`.

## Câu hỏi mở / rủi ro

- Offline: đổi giữa `?map=town` và bản mặc định dùng chung khóa IndexedDB; "Map mới" xóa save cũ.
- Quest `town-6` (nhà nhỏ xây ngay) chỉ mở sau khi nhận một trong 5 nhiệm vụ đầu; người chơi đặt nhà trước đó sẽ chờ 30 s.
- Bảng XP town dùng bảng city; nếu muốn nhịp chậm hơn nữa, sửa ở `scripts/generate-content.mjs`.
- Bảng xếp hạng (nếu có) chưa tách theo `town`.
- Mã nhánh mới của landmark khác (Rome) nếu dùng `mapKinds.includes(...)` trực tiếp sẽ bỏ sót town; dùng `kindAllows`.
