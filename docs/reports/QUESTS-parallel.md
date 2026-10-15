# Nhiệm vụ song song (parallel quests)

Yêu cầu của chủ game: danh sách nhiệm vụ hiện 5 nhiệm vụ cùng lúc, hoàn thành bất kỳ nhiệm vụ nào, không cần lần lượt.

## Thiết kế

- **Trạng thái**: `progress.claimedQuests: string[]` (id các nhiệm vụ đã nhận, hợp lệ + duy nhất). `questIndex` giữ lại trong schema và bằng `claimedQuests.length`.
- **Danh sách mở** = 5 nhiệm vụ chưa nhận đầu tiên theo thứ tự chuỗi (`openQuests`, `OPEN_QUESTS = 5` trong `packages/sim/src/common.ts`). Nhận một nhiệm vụ thì nhiệm vụ chưa nhận kế tiếp vào danh sách.
- **Tiến độ**: mọi nhiệm vụ mở nhận sự kiện (`event()` lặp qua danh sách mở); nhiệm vụ đo từ trạng thái (đường, kè, cuốc, xây, dân số) tự tính. `authoredQuestProgressFor(s, id)`; `authoredQuestProgress(s)` còn dùng được (nhiệm vụ mở đầu tiên).
- **CLAIM_QUEST**: nhận nhiệm vụ mở bất kỳ đã đủ tiến độ; chưa đủ -> `QUEST_NOT_READY`; không mở hoặc đã nhận -> `NOT_FOUND`. Thưởng, XP không đổi. Nhiệm vụ lặp giữ nguyên (`slots = 3`, không đổi luật/thưởng); bắt đầu khi cả 12 nhiệm vụ đã nhận.
- **Hướng dẫn tân thủ** (`tutorialActive` / `tutorialQuests`): còn hoạt động đến khi mọi nhiệm vụ `tutorial: true` được nhận (hoặc cờ `tutorialDone`, cờ này được đặt khi hết hướng dẫn và với thế giới cũ có `questIndex >= tutorialInstantThroughQuest`). Từng trợ giúp áp dụng khi nhiệm vụ nhắm tới nó đang mở và chưa nhận: xây ngay (BUILD đúng `buildingId`), cây hướng dẫn mọc nhanh (PLANT đúng `cropId`), thu tiền thành phố x60 (COLLECT). Thời gian giữ nguyên.
- **UI**: `MissionPanel` liệt kê tối đa 5 nhiệm vụ mở (biểu tượng chọn công cụ, tên, thanh tiến độ, nút nhận thưởng), nhiệm vụ xong xếp trước, tiêu đề `đã nhận/tổng`. Gợi ý của Bác Tư và `hintCategory` theo nhiệm vụ mở đầu tiên chưa xong. Chấm đỏ thư báo mọi nhiệm vụ xong. Trên điện thoại thẻ gọn hơn, bảng cuộn phía trên bản đồ nhỏ.

## Tương thích

- Không có SQL migration. ~147 thế giới production chỉ có `questIndex`: `validateSnapshot` chạy `normalizeQuests` -> `claimedQuests = chain.slice(0, questIndex)`, bản đã chuyển được ghi lại ở lần lưu sau.
- `validateSnapshot` chấp nhận cả hai dạng; từ chối id lạ (`QUEST_CLAIMED:UNKNOWN`), trùng (`:DUPLICATE`), lệch `questIndex` (`:COUNT`).
- `stateHash` băm dạng đã chuẩn hóa nên bản cũ và bản đã chuyển có hash giống nhau (client/server không lệch khi chuyển đổi).
- Trạng thái trong bộ nhớ không có `claimedQuests` (vd. `createState`) được đọc theo `questIndex` cho đến khi có lần nhận đầu tiên.

## Kiểm thử

- `packages/sim/src/quests-parallel.test.ts`: danh sách 5, nhận #2 trước #1, tiến độ song song (farm), tutorial, nhiệm vụ lặp, snapshot cũ (city, `questIndex` 10, `questProgress` dở), danh sách không hợp lệ.
- `apps/api/src/api.int.test.ts`: nhận city-3 trước city-1/2; city-6 chưa mở bị từ chối; thế giới cũ tải được, chạy tiếp và được ghi lại dạng mới; property test dùng nhiệm vụ mở.
- QA trong game: `scripts/quests-qa.mjs` (desktop 1440x900, 1366x768, Pixel 7, không chồng thanh công cụ/bản đồ nhỏ), `scripts/hud-scale-qa.mjs` vẫn đạt.

## Số liệu economy bot (bản đồ tự tạo, 7 ngày, `scripts/quests-bot-bench.ts`)

Bot nay tác động lên mọi nhiệm vụ mở chưa xong và nhận nhiệm vụ nào đã sẵn sàng.

| Bản đồ / kiểu chơi | Net worth ngày 7 trước | sau | Hoàn thành chuỗi (ngày) trước | sau | Nhiệm vụ đã nhận trước | sau |
|---|---|---|---|---|---|---|
| city thuong | 3 142 592 | 3 105 635 | chưa | chưa | 10 | 11 |
| city cham | 6 667 713 | 5 961 377 | chưa | chưa | 10 | 10 |
| city nhan | 260 482 | 259 158 | chưa | chưa | 10 | 10 |
| farm thuong | 108 744 | 110 020 | 4.69 | 4.04 | 12 | 12 |
| farm cham | 208 778 | 243 447 | 1.96 | 1.17 | 12 | 12 |
| farm nhan | 25 886 | 21 323 | 3.00 | chưa | 12 | 10 |

Nhận xét: Farm thuong/cham nhanh hơn; City gần như không đổi (city cham -11%); Farm nhan chậm hơn vì bot tiêu tiền cho nhiều nhiệm vụ cùng lúc trước khi đủ tiền xây cầu (nhiệm vụ 11/12). Đây là chính sách của bot (không có gate), không phải luật game. Thử phương án bot chỉ làm nhiệm vụ đầu tiên nhưng nhận được bất kỳ: Farm cham xong chuỗi sau 0.17 ngày nhưng net worth Farm thuong giảm 23%, nên giữ phương án làm song song.

## Ảnh chụp (`docs/evidence/g4/quests/`)

- `city-start-1440x900.jpg`, `city-start-1366x768.jpg`, `city-start-pixel7.jpg`: 5 nhiệm vụ lúc bắt đầu.
- `city-road-done-1440x900.jpg`, `city-claimed-out-of-order-1440x900.jpg`: làm xong "Làm 6 ô đường", nhận trước "Chặt 3 cây" (`claimedQuests = ["city-2"]`), nhiệm vụ "Thu tiền lần đầu" vào danh sách.
- `farm-start-*.jpg`, `report.json`.
