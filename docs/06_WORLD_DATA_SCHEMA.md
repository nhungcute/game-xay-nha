# 06 — Schema dữ liệu thế giới (template, instance, delta, catalog)

Mọi kiểu dữ liệu nằm ở `packages/contracts` (TypeScript + **zod** để validate runtime ở cả client và server). Tài liệu này là đặc tả; code là nguồn sự thật sau khi M0 khóa.

## 1. Nguyên tắc

1. **Template bất biến**, có `templateVersion`. Không bao giờ sửa template của một version đã phát hành.
2. **World instance = template + delta.** Delta chỉ lưu những gì khác template.
3. Mọi ID ổn định và có thể tái sinh xác định (deterministic) từ template + seed.
4. Mảng lớn theo ô lưu **nhị phân base64** (little-endian) để file nhỏ và parse nhanh.
5. Mọi file có `schemaVersion`; loader từ chối version không biết.

## 2. Hằng số lưới

```ts
export const CELL_SIZE_M = 2;
export const GRID = 128;              // ô mỗi chiều
export const VERTS = GRID + 1;        // 129
export const ZONE_CELLS = 16;         // ô mỗi chiều của một khu
export const ZONES = GRID / ZONE_CELLS; // 8
export const HEIGHT_UNIT_DM = 1;      // h lưu theo decimét
export const PLAYER_STEP_DM = 5;      // bậc san nền 0,5 m

export const cellIndex = (cx: number, cz: number) => cz * GRID + cx;
export const vertIndex = (vx: number, vz: number) => vz * VERTS + vx;
export const zoneOf = (cx: number, cz: number) =>
  (Math.floor(cz / ZONE_CELLS) * ZONES) + Math.floor(cx / ZONE_CELLS);
```

## 3. Enum

```ts
export enum Surface { GRASS = 0, DIRT = 1, SAND = 2, ROCK_GROUND = 3, TILLED = 4,
  ROAD = 5, FOUNDATION = 6, WATER = 7 }

export enum CellFlag { EMBANKED = 1 << 0, NO_BUILD = 1 << 1, ENTRY = 1 << 2,
  PROTECTED = 1 << 3 }

export type MapKind = 'city' | 'farm';
export type RoadTier = 0 | 1 | 2 | 3;
export type Rotation = 0 | 1 | 2 | 3;   // × 90°
```

`BRIDGE_DECK` không phải `Surface`; cầu là đối tượng riêng (§6.4).

## 4. World template

File: `public/worlds/<mapId>/template.v<N>.json` (+ checksum trong manifest).

```ts
export interface WorldTemplate {
  schemaVersion: 1;
  mapId: string;                 // 'city-coast-01'
  mapKind: MapKind;
  templateVersion: number;       // tăng khi sửa layout
  generatorVersion: string;      // version của tool sinh vegetation
  seed: number;                  // uint32
  waterLevelDm: number;
  grid: { size: 128; cellSizeM: 2 };

  layers: {
    heightsDm: string;           // base64 Int16Array, length 129*129
    surface: string;             // base64 Uint8Array, length 128*128 (Surface)
    flags: string;               // base64 Uint8Array, length 128*128 (CellFlag)
    roadTier: string;            // base64 Uint8Array, length 128*128 (đường đất tự nhiên = 1)
    biome: string;               // base64 Uint8Array, length 128*128 (id biome để scatter)
  };

  water: {
    lakes: { id: string; polygonXZ: [number, number][] }[];    // để render shoreline mượt
    rivers: { id: string; centerlineXZ: [number, number][]; widthM: number[] }[];
    waterfalls: { id: string; topXZ: [number, number]; bottomXZ: [number, number]; widthM: number }[];
  };

  startZones: number[];          // ví dụ [27, 28, 35, 36]
  entryCells: [number, number][];// phải có cờ ENTRY và roadTier ≥ 1

  env: EnvSpec;                  // xem §4.1
  suggestedLots?: { id: string; cells: [number, number, number, number] }[]; // [cx0,cz0,cx1,cz1] — chỉ gợi ý/hướng dẫn
  camera: { target: [number, number, number]; yawDeg: number; pitchDeg: number; distance: number };
  palette: Record<string, string>;
}
```

**Ràng buộc validator (template):**

- Ô `WATER` ⇔ nằm trong polygon hồ / dải sông (raster hóa) — lệch tối đa 0 ô.
- Ô `WATER`: 4 đỉnh `h ≤ waterLevelDm - 5`.
- Ô đất ven nước: đỉnh chung với nước `waterLevel+5 ≤ h ≤ waterLevel+20`.
- Mọi `entryCells` nằm trong `startZones`, trên đường tự nhiên của template. Đường tự nhiên từ `entryCells` chạy ra mép bản đồ ("đường làng từ bên ngoài vào"); các ô đường đó ngoài khu ban đầu mang cờ `PROTECTED` cho tới khi khu được mở.
- `startZones` liền kề nhau, chứa ≥ 200 ô đất xây được (phẳng hoặc san được với ≤ 2 bậc).
- **Không có công trình, không có cầu, không có ô `TILLED`, không có `FOUNDATION`.**
- Đường tự nhiên (`roadTier = 1`) không chạm ô nước.

### 4.1 Env objects

Env được **sinh xác định** từ template, không lưu từng cây trong file (trừ anchor thủ công).

```ts
export interface EnvSpec {
  catalogVersion: number;
  anchors: EnvInstance[];        // cây/đá landmark đặt tay, ID 'A-<n>'
  scatter: {
    biome: number;
    category: 'tree_deciduous' | 'tree_conifer' | 'rock' | 'rock_large' | 'bush' | 'reed' | 'flower';
    densityPerCell: number;      // 0..1
    assetIds: string[];          // chọn theo RNG
    rules: { minWaterDistCells?: number; maxSlopeDm?: number; avoidSuggestedLots?: boolean; onlyShore?: boolean };
  }[];
}

export interface EnvInstance {
  id: string;                    // 'Z<zone>-<category>-<n>' hoặc 'A-<n>'
  assetId: string;
  cell: [number, number];
  footprint: 1 | 2;              // 2 = chiếm 2×2
  offsetXZ: [number, number];    // lệch trong ô (m), để không thẳng hàng
  yawDeg: number;
  scale: number;
  blocking: boolean;             // false với hoa/cỏ thấp
}
```

**Thuật toán sinh (bắt buộc giống hệt trên client và server):**

- PRNG `mulberry32`, seed = `hash32(seed, zoneId, categoryIndex, generatorVersion)` (`hash32` = FNV-1a trên chuỗi `${seed}:${zone}:${cat}:${gen}`).
- Duyệt ô trong khu theo thứ tự `cz` rồi `cx`; với mỗi ô gọi RNG đúng **4 lần** (xác suất, asset, offset, yaw+scale gộp) **kể cả khi ô bị loại**, để loại một ô không làm lệch các ô sau.
- ID = `Z${zone}-${category}-${counter}` với `counter` tăng theo thứ tự duyệt.
- Mỗi ô tối đa 1 env `blocking`.

Đổi thuật toán ⇒ tăng `generatorVersion` ⇒ cần migration (§8).

## 5. Catalog nội dung

`packages/content/` sinh từ bảng ở `16`:

```ts
export interface BuildingDef {
  id: string; mapKinds: MapKind[]; nameKey: string;   // i18n key
  size: [number, number]; entranceSide: 'N' | 'E' | 'S' | 'W';
  cost: { cash: number; wood: number; stone: number }; unlockLevel: number;
  maxCount?: number; costScaling?: number[];           // vd. nhà nông
  population?: number; jobs?: number; baseRatePerHour?: number;
  decor?: { bonus: number; radius: number };
  waterBonusOverride?: number; bankCapHours?: number;
  production?: { slots: number; recipes: RecipeId[] };
  storageBonus?: number; fieldQuota?: number; irrigationRadius?: number;
  modelId: string;                                     // tham chiếu asset manifest (13)
}

export interface CropDef { id: string; nameKey: string; unlockLevel: number;
  seedCost: number; growSeconds: number; yield: number; itemId: string; xp: number; stageModels: [string, string, string]; }

export interface RecipeDef { id: string; inputs: Record<ItemId, number>; output: ItemId; seconds: number; xp: number; }
export interface ItemDef { id: string; nameKey: string; sellPrice: number; iconId: string; }

export interface InfraDef { roadTiers: {...}; bridges: { id: string; maxSpan: number; costPerCell: Cost; unlockLevel: number; mapKinds: MapKind[] }[]; embankCost: Cost; terraformCostPerStep: number; tillCost: number; clearCosts: {...} }
```

Catalog có `contentVersion`. Client tải catalog cùng version với server (server trả `contentVersion` trong snapshot; lệch → tải lại).

## 6. World instance (snapshot server trả về)

```ts
// Mỗi nhân vật gắn với đúng một map và sở hữu đúng một world: worldId ≡ characterId.
export interface WorldSnapshot {
  schemaVersion: 1;
  worldId: string;                        // = characterId
  accountId: string; mapId: string; mapKind: MapKind;
  templateVersion: number; contentVersion: number;
  revision: number;                       // tăng 1 mỗi lệnh thành công
  serverTime: number;                     // ms epoch, để client đồng bộ đồng hồ

  character: {
    displayName: string; tag: string;     // "Minh" + "4821" → hiển thị "Minh#4821"
    createdAt: number;
    netWorth: number;                     // tổng tài sản ($), công thức 16 §13
  };
  wallet: { cash: number; wood: number; stone: number };   // cash = đô la, số nguyên
  progress: { xp: number; level: number; questIndex: number; questProgress: Record<string, number>; tutorialDone: boolean };
  unlockedZones: number[];
  landValue: number;                      // tổng $ đã trả để mở khu (cho netWorth)

  delta: WorldDelta;
  buildings: PlacedBuilding[];
  bridges: PlacedBridge[];
  crops: PlantedCrop[];                   // chỉ map farm
  inventory: Record<ItemId, number>;      // chỉ map farm
}
```

### 6.1 Delta địa hình

Lưu **theo khu (chunk)**: chỉ khu nào có thay đổi mới có bản ghi.

```ts
export interface WorldDelta {
  zones: Record<number, ZoneDelta>;       // key = zoneId
  removedEnvIds: string[];
}

export interface ZoneDelta {
  // Toàn bộ dữ liệu của khu (không phải diff từng ô) — đơn giản, nhỏ (~1,6 KB/khu).
  heightsDm: string;    // base64 Int16Array 17*17 (đỉnh của khu, gồm cạnh chung)
  surface: string;      // base64 Uint8Array 16*16
  flags: string;        // base64 Uint8Array 16*16
  roadTier: string;     // base64 Uint8Array 16*16
}
```

**Đỉnh trên cạnh chung giữa hai khu** được lưu ở cả hai khu; khi ghi, server cập nhật cả hai bản ghi trong cùng transaction. Khi đọc, ưu tiên khu có `zoneId` nhỏ hơn (phải luôn bằng nhau — validator kiểm tra).

### 6.2 Công trình

```ts
export interface PlacedBuilding {
  id: string;                 // 'b_' + ulid, server cấp
  defId: string;
  anchor: [number, number];   // ô tây-bắc sau xoay
  rotation: Rotation;
  placedAt: number;
  investedValue: number;      // $ quy đổi thực trả lúc xây (16 §13); phá dỡ hoàn 50% chi phí thực trả
  status: 'CONSTRUCTING' | 'ACTIVE';
  buildEndsAt: number;        // ms epoch (giờ server); ACTIVE khi now ≥ buildEndsAt
  cashPaid: number;           // $ thực trả (dùng cho hủy 100%, phá 50%, xây nhanh)
  // Thành phố
  accrued?: number; settledAt?: number;
  // Quê
  slots?: { recipeId: RecipeId; startedAt: number; readyAt: number }[];
}
```

### 6.3 Cây trồng

```ts
export interface PlantedCrop { cell: [number, number]; cropId: string; plantedAt: number; readyAt: number; }
```

### 6.4 Cầu

```ts
export interface PlacedBridge {
  id: string; typeId: 'bridge_wood' | 'bridge_stone' | 'bridge_concrete';
  a: [number, number]; b: [number, number];   // ô đầu cầu (đất)
  deckHeightDm: number;
  buildEndsAt: number;        // cầu chưa là nút mạng đường trước thời điểm này
}
```

### 6.5 Occupancy (dẫn xuất, không lưu)

Client và server dựng `occupant: Int32Array(128*128)` từ env (trừ `removedEnvIds`), buildings, crops khi load. Không lưu để tránh lệch dữ liệu.

### 6.6 Kiểm tra snapshot (`sim.validateSnapshot`)

Chạy ở client (trước khi nạp, `08 §6.1`) và server (khi đọc từ DB). Trả về **toàn bộ** danh sách lỗi, không dừng ở lỗi đầu. Snapshot có bất kỳ lỗi nào bị từ chối nguyên khối.

| Nhóm | Điều kiện |
|---|---|
| Định danh | `schemaVersion` hỗ trợ; `mapId`, `mapKind`, `templateVersion` khớp template được nạp; `contentVersion` có catalog tương ứng; `seed`/`generatorVersion` của template khớp |
| ID | Mọi `building.id`, `bridge.id` **duy nhất** trong world; đúng định dạng (`b_…`, `br_…`); `removedEnvIds` không trùng và đều là ID env có thật trong template |
| Tham chiếu | `defId` có trong catalog và thuộc `mapKind`; `cropId`, `recipeId`, `itemId` tồn tại |
| Biên | Mọi ô (anchor, footprint, cell cây trồng, đầu cầu) nằm trong `[0,128)`; mọi khu trong `unlockedZones` hợp lệ và liền kề; footprint nằm trong khu đã mở |
| Delta | Mỗi `ZoneDelta` giải mã đúng độ dài; đỉnh trên cạnh chung giữa hai khu bằng nhau; `h` trong `[minH, maxH]` |
| Va chạm | Dựng occupancy từ đầu: không hai entity chiếm cùng ô; công trình không đè ô `WATER`/`ROAD`/`TILLED`; cây trồng chỉ trên ô `TILLED`; footprint công trình phẳng |
| Cầu | Thỏa lại toàn bộ `15 §9.2` trên dữ liệu đã nạp |
| Xây dựng | Số công trình + cầu đang xây ≤ đội thợ của cấp; `buildEndsAt − placedAt` khớp thời gian xây trong catalog (± 1 giây; trừ trường hợp đã xây nhanh: `buildEndsAt` sớm hơn); `status` khớp `buildEndsAt` so với `serverTime`; số lượng mỗi loại ≤ giới hạn theo cấp |
| Số | `cash, wood, stone ≥ 0`, số nguyên; `level` khớp `xp` theo bảng `16 §8.2`; `revision ≥ 0`; thời điểm (`placedAt`, `readyAt`, `settledAt`) không ở tương lai quá 5 phút so với `serverTime` |
| Tài sản | `netWorth` khớp công thức `16 §13` (lệch → lỗi trên server; client chỉ cảnh báo debug) |

## 7. Lệnh

Danh sách lệnh và payload ở `08 §4`. Mọi lệnh có:

```ts
export interface CommandEnvelope<T extends CommandType = CommandType> {
  commandId: string;          // uuid v4 do client sinh
  worldId: string;
  expectedRevision: number;
  type: T;
  payload: CommandPayload[T];
  clientTime: number;         // chỉ để log, server không tin
}
```

## 8. Version và migration

| Thay đổi | Cách xử lý |
|---|---|
| `contentVersion` tăng (đổi giá, thêm công trình) | Không migration dữ liệu; giá mới áp dụng cho hành động mới. Xóa công trình khỏi catalog ⇒ **cấm**; chỉ được đánh dấu `deprecated` (không xây mới, vẫn hoạt động) |
| `templateVersion` tăng | Chỉ áp dụng cho world **mới**. World cũ giữ version cũ (server phục vụ nhiều version template) |
| `generatorVersion` tăng | World cũ giữ generator cũ, hoặc chạy migration ánh xạ `removedEnvIds` theo vị trí ô; **không** được âm thầm làm cây mọc lại / mất công trình |
| `schemaVersion` tăng | Viết migration server-side, có test với snapshot mẫu |

## 9. Kích thước ước tính

- Template: heights 33 KB + 4 lớp × 16 KB ≈ 100 KB thô, ~40 KB gzip.
- Delta tối đa (64 khu): ~100 KB. Công trình vài trăm × ~100 B.
- Snapshot đầy đủ < 250 KB gzip — tải một lần khi vào world.

## 10. Ví dụ (rút gọn)

```json
{
  "schemaVersion": 1,
  "mapId": "farm-valley-01",
  "mapKind": "farm",
  "templateVersion": 1,
  "generatorVersion": "veg-1.0.0",
  "seed": 20261009,
  "waterLevelDm": 20,
  "grid": { "size": 128, "cellSizeM": 2 },
  "layers": { "heightsDm": "AAAB…", "surface": "AAEC…", "flags": "…", "roadTier": "…", "biome": "…" },
  "water": { "lakes": [{ "id": "pond-1", "polygonXZ": [[120,80],[140,78],[146,96],[124,100]] }],
             "rivers": [{ "id": "creek", "centerlineXZ": [[240,10],[200,60],[150,130],[60,250]], "widthM": [6,8,10,12] }],
             "waterfalls": [{ "id": "falls-ne", "topXZ": [236,14], "bottomXZ": [232,24], "widthM": 5 }] },
  "startZones": [27, 28, 35, 36],
  "entryCells": [[0, 70]],
  "env": { "catalogVersion": 1, "anchors": [], "scatter": [] },
  "camera": { "target": [128, 0, 128], "yawDeg": 45, "pitchDeg": 55, "distance": 140 },
  "palette": { "grass": "#7fbf4d", "dirt": "#c9a26b", "water": "#2f8fd8" }
}
```
