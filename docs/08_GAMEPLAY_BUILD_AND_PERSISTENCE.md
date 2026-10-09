# 08 — Công cụ, lệnh gameplay, đồng bộ và lưu trữ

Luật hợp lệ của từng công cụ: `15`. Con số: `16`. Kiểu dữ liệu: `06`. API/DB: `11`.

## 1. Từ đất sơ khai đến vùng đất của nhân vật

- Mỗi map một nhân vật; tạo nhân vật = tạo world mới (`worldId` ≡ `characterId`) = template + delta rỗng: `buildings: []`, `bridges: []`, `crops: []`, `removedEnvIds: []`, `zones: {}`, ví, cấp, XP khởi đầu theo `16 §2` — không kế thừa gì từ nhân vật ở map khác.
- **Chỉ lệnh của người chơi** tạo thay đổi. Không có công trình nào tự sinh, kể cả trong hướng dẫn (hướng dẫn chỉ gợi ý vị trí, người chơi bấm xác nhận).

## 2. Máy trạng thái công cụ (client)

```text
EXPLORE (mặc định: xoay/pan/zoom, chạm công trình để xem/thu tiền)
  ├─ chọn công cụ CLEAR    → AREA_SELECT(kind=clear)
  ├─ chọn công cụ TERRAFORM→ AREA_SELECT(kind=terraform, mode)
  ├─ chọn công cụ TILL     → AREA_SELECT(kind=till)          [farm]
  ├─ chọn công cụ PLANT    → AREA_SELECT(kind=plant, cropId) [farm]
  ├─ chọn công cụ EMBANK   → AREA_SELECT(kind=embank)
  ├─ chọn công cụ ROAD     → PATH_DRAW(tier)
  ├─ chọn công cụ BRIDGE   → BRIDGE_PICK_A(type) → BRIDGE_PICK_B
  ├─ chọn công trình       → PLACE_PREVIEW(defId, rotation)
  └─ chọn công cụ DEMOLISH → PICK_TARGET

AREA_SELECT / PATH_DRAW / BRIDGE_PICK_B / PLACE_PREVIEW
  pointer move  → cập nhật preview + validate cục bộ (sim) → màu xanh / vàng / đỏ + lý do + chi phí
  confirm       → SUBMITTING (gửi lệnh, áp dụng lạc quan)
  cancel / Esc  → quay lại công cụ đang chọn (giữ công cụ), Esc lần 2 → EXPLORE

SUBMITTING
  accepted → áp revision mới, ở lại công cụ hiện tại (để thao tác liên tiếp)
  rejected → hoàn tác lạc quan, hiện lỗi, ở lại công cụ
```

Quy tắc chung:
- Trong mọi trạng thái trừ EXPLORE, kéo một ngón/chuột trái dùng cho công cụ; xoay camera bằng chuột phải / hai ngón. (Chi tiết điều khiển: `09`.)
- Camera không có quán tính khi đang kéo vùng.
- Đổi map hoặc mất kết nối → hủy preview, không gửi lệnh dở dang.

## 3. Lạc quan có kiểm soát (optimistic) + server có quyền quyết định

```text
Người chơi xác nhận
  → client chạy sim.apply(cmd) trên bản sao state → hiển thị ngay
  → đưa cmd vào hàng đợi (tối đa 20 lệnh chưa xác nhận)
  → POST /commands (gửi theo lô, tối đa 10 lệnh/lần, giữ thứ tự)
Server: với mỗi lệnh theo thứ tự
  → idempotency theo commandId → kiểm tra expectedRevision → sim.validate → sim.apply → settle → lưu → revision+1
Client nhận kết quả
  → accepted: so khớp revision; nếu server trả patch khác dự đoán → áp patch của server
  → rejected: rollback về snapshot đã xác nhận gần nhất + áp lại các lệnh còn chờ (rebase); lệnh lỗi bị loại
```

- **Cùng một package `sim`** chạy trên client và server → dự đoán gần như luôn đúng.
- Lệnh liên quan thời gian (`COLLECT`, `HARVEST`, `COLLECT_PRODUCTION`) client chỉ dự đoán; số liệu cuối cùng theo server.
- Hoàn thành xây dựng: client tự chuyển giàn giáo → công trình khi đồng hồ (đã hiệu chỉnh `serverOffset`) đạt `buildEndsAt` để mượt, nhưng số liệu (thu nhập, XP) chỉ tính theo server ở phản hồi/snapshot kế tiếp. `GET /api/worlds/:id` luôn xử lý các sự kiện hoàn thành đến `now` trước khi trả snapshot.
- Đồng hồ: client lưu `serverOffset = serverTime - Date.now()` từ mỗi phản hồi; mọi bộ đếm hiển thị dùng `Date.now() + serverOffset`.

## 4. Danh mục lệnh

| `type` | Payload | Map |
|---|---|---|
| `CLEAR_ENV` | `{ envIds: string[] }` (≤ 256) | cả hai |
| `TERRAFORM` | `{ rect: [cx0,cz0,cx1,cz1], mode: 'RAISE'\|'LOWER'\|'FLATTEN', targetHDm?: number }` | cả hai |
| `TILL` / `UNTILL` | `{ rect }` | farm |
| `EMBANK` / `REMOVE_EMBANK` | `{ cells: [cx,cz][] }` (≤ 256) | cả hai |
| `BUILD_ROAD` | `{ tier: 1\|2\|3, cells: [cx,cz][] }` (≤ 256, liên tiếp 4 hướng) | cả hai |
| `REMOVE_ROAD` | `{ cells }` | cả hai |
| `BUILD_BRIDGE` | `{ typeId, a: [cx,cz], b: [cx,cz] }` | cả hai |
| `REMOVE_BRIDGE` | `{ bridgeId }` | cả hai |
| `PLACE_BUILDING` | `{ defId, anchor: [cx,cz], rotation: 0..3, autoFlattenHDm?: number }` | theo def |
| `DEMOLISH` | `{ buildingId }` | cả hai |
| `CANCEL_CONSTRUCTION` | `{ buildingId }` hoặc `{ bridgeId }` — chỉ khi đang xây, hoàn 100% | cả hai |
| `SPEED_UP` | `{ buildingId }` hoặc `{ bridgeId }` — trả $ theo `16 §3.1`, hoàn thành ngay | cả hai |
| `COLLECT` | `{ buildingIds: string[] }` (rỗng + có ngân hàng = thu tất cả) | city |
| `PLANT` | `{ rect, cropId }` | farm |
| `HARVEST` | `{ cells: [cx,cz][] }` | farm |
| `START_PRODUCTION` | `{ buildingId, recipeId, count }` | farm |
| `COLLECT_PRODUCTION` | `{ buildingId }` | farm |
| `SELL` | `{ items: Record<ItemId, number> }` | farm |
| `BUY_MATERIAL` | `{ wood?: number, stone?: number }` | cả hai |
| `UNLOCK_ZONE` | `{ zoneId }` | cả hai |
| `CLAIM_QUEST` | `{ questId }` | cả hai |

Phản hồi mỗi lệnh:

```ts
type CommandResult =
  | { commandId: string; accepted: true; revision: number; patch: StatePatch; serverTime: number; events?: GameEvent[] }
  | { commandId: string; accepted: false; code: ErrorCode; detail?: unknown; revision: number; serverTime: number };
```

`StatePatch` gồm: `wallet`, `progress`, `zones` (chỉ khu thay đổi), `buildings` upsert/remove, `bridges`, `crops`, `inventory`, `removedEnvIds` thêm. `GameEvent`: `LEVEL_UP`, `QUEST_COMPLETED`, `UNLOCK`.

## 5. Thứ tự xử lý một lệnh trên server (một transaction)

1. Xác thực token → `accountId`; world (nhân vật) thuộc account (`404` nếu không).
2. `commandId` đã tồn tại → trả **kết quả đã lưu** (idempotent), không xử lý lại.
3. Khóa hàng world (`SELECT … FOR UPDATE`).
4. `expectedRevision ≠ revision` → `REVISION_CONFLICT` kèm revision hiện tại (client tải snapshot rồi rebase).
5. Validate payload bằng zod (kiểu, giới hạn độ dài).
6. `now = server clock`. **Xử lý các công trình/cầu có `buildEndsAt ≤ now` theo thứ tự thời gian**: với mỗi cái, settle toàn world tại `buildEndsAt` bằng rate cũ → chuyển `ACTIVE` → tính lại rate, kết nối đường, trần kho tiền → cộng XP xây dựng. Sau đó, nếu lệnh ảnh hưởng thu nhập → settle toàn world tại `now` (`16 §6.4`).
7. `sim.validate(state, cmd, now)` → lỗi → lưu kết quả bị từ chối vào `world_commands`, **không** tăng revision.
8. `sim.apply` → ghi các bảng bị ảnh hưởng → `revision += 1` → lưu `world_commands`.
9. Cập nhật XP, cấp, nhiệm vụ → sinh `events`.
10. Commit.

Rate limit: 20 lệnh/giây/world, 300 lệnh/phút/player.

## 6. Lưu trữ

- **Server là nguồn sự thật duy nhất** (Postgres, schema ở `11 §5`). Không có chế độ chỉ lưu localStorage trong sản phẩm (chỉ dùng cho bản dev offline với cờ `VITE_OFFLINE=1`, chạy `sim` cục bộ).
- Client cache snapshot cuối cùng vào IndexedDB để mở game nhanh; luôn tải lại từ server khi vào world (so `revision`).
- Delta địa hình lưu theo khu (`06 §6.1`).
- Không có chức năng nhập/xuất file save trong MVP (prototype có và là nguồn lỗi chính). Nếu sau này thêm (ví dụ công cụ admin), phải đi qua đúng quy trình §6.1 và server phải validate lại.

### 6.1 Nạp snapshot nguyên tử (kiểm tra hết rồi mới thay)

Áp dụng cho mọi nguồn trạng thái: snapshot từ server, cache IndexedDB, rebase sau `REVISION_CONFLICT`, chế độ `VITE_OFFLINE`.

```text
loadSnapshot(raw):
  1. parse JSON (lỗi → giữ nguyên state cũ)
  2. zod parse theo schema 06 (lỗi → giữ nguyên)
  3. sim.validateSnapshot(snapshot, template, catalog)  → danh sách lỗi đầy đủ (06 §6.6)
  4. có lỗi → KHÔNG đụng state/scene hiện tại; báo lỗi; nếu nguồn là cache → xóa cache, tải từ server
  5. dựng SimState MỚI hoàn chỉnh (occupancy, kết nối đường) ngoài scene
  6. chỉ khi bước 5 thành công: hoán đổi state (một phép gán) → renderer dựng lại theo dirty
  7. dispose tài nguyên của state cũ theo 02 §10.1
```

- **Cấm** xóa state hiện tại rồi mới kiểm tra từng phần tử (lỗi của prototype: file có một phần tử sai bị từ chối nhưng bản đồ đã trống).
- **Không bao giờ ghi** vào IndexedDB một snapshot chưa qua bước 3.
- Server áp dụng cùng `validateSnapshot` khi đọc world từ DB (phát hiện dữ liệu hỏng → log lỗi, trả 500 có mã, không âm thầm sửa).

## 7. Reset, tải lại, đổi map

| Tình huống | Hành vi |
|---|---|
| Tải lại trang | Tải snapshot → dựng địa hình (template + delta) → sinh env xác định → trừ `removedEnvIds` → dựng công trình, cầu, cây trồng. Mọi thứ phải giống hệt trước khi tải lại |
| Đổi map (Thành phố ↔ Quê) | Map đích chưa có nhân vật → màn tạo nhân vật (`09 §1.1`). Có rồi → đợi hàng đợi lệnh trống (tối đa 3 giây, quá thì hỏi người chơi) → dispose GPU resource (geometry, material, texture riêng của world; giữ asset dùng chung theo ref-count) → tải world của nhân vật kia. HUD đổi toàn bộ sang chỉ số nhân vật đó |
| Bắt đầu lại (nhân vật hiện tại) | Xác nhận 2 lần (gõ tên nhân vật). Server xóa nhân vật + world của map này; người chơi tạo nhân vật mới cho map đó (template version mới nhất). Nhân vật map kia không bị ảnh hưởng |
| Template có version mới | World cũ giữ version cũ (`06 §8`) |
| Mất mạng | Hàng đợi giữ tối đa 20 lệnh; đầy → khóa thao tác + banner "Mất kết nối". Có lại mạng → gửi tiếp; nếu `REVISION_CONFLICT` → tải snapshot, rebase |

## 8. Bảo mật

- Server **không tin** bất kỳ giá trị nào client gửi ngoài ý định (vị trí, loại, hướng). Chi phí, thời gian, sản lượng, tiền thu đều tính trên server.
- `worldId` (= nhân vật) trong lệnh phải thuộc `accountId` của token.
- Không lưu token trong template hoặc save export.
- Log lệnh bị từ chối bất thường (ví dụ `INSUFFICIENT_FUNDS` lặp lại liên tục) để phát hiện client bị sửa.

## 9. Test bắt buộc (chi tiết ở `10`)

- [ ] Nhân vật mới: 0 công trình, 0 cầu, 0 ruộng, cấp 1, $2 000 ở mọi map; độc lập với nhân vật map khác.
- [ ] Lệnh trùng `commandId` không sinh hai công trình, không trừ tiền hai lần.
- [ ] `expectedRevision` sai → `REVISION_CONFLICT`, state không đổi.
- [ ] Mọi luật ở `15` có test hợp lệ và không hợp lệ chạy trên `sim`.
- [ ] Client gửi lệnh bỏ qua validator (curl trực tiếp) → server từ chối đúng mã lỗi.
- [ ] Tải lại trang: địa hình, cây, công trình giống hệt (so hash state).
- [ ] Thu tiền: số tiền khớp công thức với `now` giả lập (fake clock) qua nhiều lần đổi `rate`.
- [ ] Đổi map 20 lần liên tiếp không rò rỉ bộ nhớ GPU (`renderer.info.memory` ổn định).
- [ ] Snapshot/cache hỏng (một phần tử sai) bị từ chối và **state đang chơi giữ nguyên** (`10 §2.6`).
- [ ] Đổi công cụ, đặt/phá công trình nhiều lần không làm tăng geometry/material (`10 §4.1`).
