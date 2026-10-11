# 11 — Tech stack, backend, xác thực, chống gian lận, deploy

## 1. Lựa chọn công nghệ

| Lớp | Chọn | Lý do |
|---|---|---|
| Ngôn ngữ | **TypeScript** (strict) toàn bộ client, server, tooling | Chia sẻ kiểu + luật giữa client/server; bắt lỗi sớm |
| Render 3D | **Three.js** (khóa phiên bản chính xác, ví dụ `0.180.x`) | Nhẹ, linh hoạt, cộng đồng lớn; đủ cho low-poly + instancing |
| Build | **Vite** | Dev nhanh, code-splitting |
| UI | **React 18** + CSS Modules (hoặc Tailwind) | HUD, panel, popup; không render 3D bằng React (không dùng react-three-fiber để giữ vòng lặp render đơn giản, dễ tối ưu) |
| State UI | **zustand** | Nhẹ, đọc được ngoài React (từ game loop) |
| Validate | **zod** | Schema dùng chung client/server |
| Server | **Node 22 + Fastify** | Nhanh, typed, plugin rate-limit/cors sẵn |
| DB | **PostgreSQL 16** + **Drizzle ORM** | Transaction, `FOR UPDATE`, JSONB, bytea |
| Test | **Vitest** (unit), **Playwright** (E2E) | |
| Monorepo | **pnpm workspaces** | |
| Deploy | Docker Compose: `web` (Nginx static) + `api` + `postgres` | Chạy 1 lệnh; có thể đưa qua Cloudflare Tunnel |

**Không chọn:** Unity WebGL (bản build nặng, tải chậm trên mobile), Babylon.js (tốt nhưng phải bỏ phần đã có; giữ làm phương án dự phòng).

## 2. Cấu trúc repo

```text
apps/
  web/                      # client
    src/
      app/                  # bootstrap, routing màn hình, i18n
      ui/                   # React components (HUD, panels, dialogs)
      game/
        GameLoop.ts         # requestAnimationFrame, fixed tick cho anim
        net/                # ApiClient, CommandQueue, clock sync
        state/              # WorldStore (sim state + optimistic layer)
        render/
          TerrainRenderer.ts   # chunk mesh theo khu, rebuild khu bẩn
          WaterRenderer.ts
          RoadRenderer.ts      # auto-tile
          EmbankRenderer.ts
          BridgeRenderer.ts
          EnvRenderer.ts       # InstancedMesh cây/đá
          BuildingRenderer.ts
          CropRenderer.ts
          OverlayRenderer.ts   # lưới, vùng chọn, ghost, khu khóa
        input/              # CameraRig, PointerRouter, ToolController (máy trạng thái 08 §2)
        assets/             # AssetManager (GLTF + ref-count + dispose)
  api/
    src/
      routes/               # auth, worlds, commands, content
      services/             # CommandService (08 §5), SettleService
      db/                   # drizzle schema, migrations
packages/
  contracts/                # types + zod (06)
  sim/                      # LUẬT GAME THUẦN — không phụ thuộc Three.js, DOM, Node
  content/                  # economy.v1.json, catalog, i18n keys
  worldgen/                 # sinh env xác định (06 §4.1), dùng chung client/server
  tooling/                  # convert ảnh trace → template, validate template, sim-economy
public/ (trong apps/web)
  worlds/<mapId>/template.v1.json
  assets/models/*.glb, assets/textures/*.ktx2, assets/audio/*
infra/
  docker/, nginx/, compose.yml, .env.example
```

**Quy tắc phụ thuộc:** `sim` và `worldgen` chỉ phụ thuộc `contracts`, `content`. `render` đọc state, không sửa state. Chỉ `ToolController` + `CommandQueue` tạo lệnh.

## 3. Kiến trúc package `sim`

```ts
export interface SimState { /* WorldSnapshot đã giải nén thành typed arrays + occupancy */ }
export function validate(s: SimState, cmd: Command, now: number): Ok | Err<ErrorCode>;
export function apply(s: SimState, cmd: Command, now: number): StatePatch;   // gọi sau validate
export function settleAll(s: SimState, now: number): void;
export function computeRates(s: SimState): void;
export function roadConnectivity(s: SimState): Uint8Array;                   // BFS (15 §6.4)
export function previewCost(s: SimState, cmd: Command): Cost;
```

- Hàm thuần, không đọc `Date.now()` — thời gian luôn truyền vào (dễ test bằng fake clock).
- Số nguyên cho tiền (tiền); không dùng float cho ví. `accrued` lưu float nhưng chỉ cộng `floor` vào ví.

## 4. Xác thực: chỉ nhập tên

> **Đã thay bằng D027 (2026-10-11):** đăng nhập bằng **tên người chơi + mã PIN** (4–6 số); bỏ mã khôi phục. Xem `DECISIONS.md` D027.

### 4.1 Luồng

```text
POST /api/characters  { mapKind, displayName }          (không có token = lần đầu)
  → validate tên: 3–20 ký tự, chữ cái Unicode (gồm tiếng Việt), số, khoảng trắng đơn; lọc từ cấm
  → nếu request KHÔNG có token: tạo account
       token = 32 byte ngẫu nhiên (base64url), lưu SHA-256(token)
       recoveryCode = 12 ký tự Crockford base32 (XXXX-XXXX-XXXX), lưu argon2id(recoveryCode)
  → nếu account đã có nhân vật ở mapKind này → 409 CHARACTER_EXISTS (trả characterId để vào lại)
  → tạo character (= world): displayName, tag (4 chữ số ngẫu nhiên, unique theo displayName),
       chỉ số khởi đầu 16 §2, template version mới nhất của mapKind
  ← { accountId, character: {id, mapKind, displayName, tag}, token?, recoveryCode? }   // token/recoveryCode chỉ khi vừa tạo account

Client lưu token trong localStorage; hiển thị recoveryCode MỘT LẦN với nút sao chép.

Mọi request sau: Authorization: Bearer <token>
Đổi sang map chưa có nhân vật: gọi lại POST /api/characters (có token) → chỉ tạo nhân vật mới, không tạo account.

POST /api/auth/recover { recoveryCode }
  → tìm account (so argon2 — đánh chỉ mục bằng 4 ký tự đầu băm riêng để không quét toàn bảng)
  → thu hồi mọi token cũ, cấp token mới
  ← { accountId, token, characters: [{id, mapKind, displayName, tag, level, netWorth}] }
```

### 4.2 Lưu ý

- Token không hết hạn trong MVP nhưng có thể thu hồi; `last_seen_at` cập nhật tối đa 1 lần/phút.
- Rate limit tạo account (`POST /api/characters` không token): 5 lần/giờ/IP; `/auth/recover`: 10 lần/giờ/IP.
- Đổi tên nhân vật: P1 (1 lần miễn phí, mỗi nhân vật).
- Nhắc lưu mã khôi phục khi đạt cấp 3 và mỗi 7 ngày nếu chưa xác nhận đã lưu.
- Không thu thập email/số điện thoại trong MVP → không có dữ liệu cá nhân nhạy cảm ngoài tên hiển thị và IP log (giữ ≤ 30 ngày).

## 5. Schema Postgres

```sql
accounts (
  id uuid PK,
  token_hash bytea NOT NULL, recovery_hash text NOT NULL, recovery_prefix_hash bytea NOT NULL,
  created_at timestamptz, last_seen_at timestamptz
);

-- Nhân vật = world: mỗi nhân vật gắn đúng một map, sở hữu đúng một vùng đất. worlds.id = characterId.
worlds (
  id uuid PK, account_id uuid FK, map_id text, map_kind text,
  display_name text NOT NULL, tag char(4) NOT NULL, net_worth bigint NOT NULL, land_value bigint NOT NULL DEFAULT 0,
  template_version int, content_version int, revision bigint NOT NULL DEFAULT 0,
  cash bigint, wood int, stone int, xp int, level int,
  quest_index int, quest_progress jsonb, tutorial_done bool,
  unlocked_zones smallint[], created_at timestamptz, updated_at timestamptz,
  UNIQUE (account_id, map_kind),          -- tối đa 1 nhân vật mỗi map
  UNIQUE (display_name, tag)
);
CREATE INDEX worlds_leaderboard ON worlds (map_kind, net_worth DESC);   -- bảng xếp hạng P1

world_zones   (world_id FK, zone_id smallint, heights bytea, surface bytea, flags bytea, road_tier bytea,
               PRIMARY KEY (world_id, zone_id));
removed_env   (world_id FK, env_id text, PRIMARY KEY (world_id, env_id));
buildings     (id text PK, world_id FK, def_id text, anchor_x smallint, anchor_z smallint, rotation smallint,
               placed_at timestamptz, status text NOT NULL, build_ends_at timestamptz NOT NULL, cash_paid bigint NOT NULL, invested_value bigint NOT NULL, accrued double precision, settled_at timestamptz, slots jsonb);
bridges       (id text PK, world_id FK, type_id text, ax smallint, az smallint, bx smallint, bz smallint, deck_h smallint, build_ends_at timestamptz NOT NULL);
-- Chỉ mục cho xử lý hoàn thành: buildings (world_id, build_ends_at) WHERE status = 'CONSTRUCTING'
crops         (world_id FK, cx smallint, cz smallint, crop_id text, planted_at timestamptz, ready_at timestamptz,
               PRIMARY KEY (world_id, cx, cz));
inventory     (world_id FK, item_id text, qty int, PRIMARY KEY (world_id, item_id));
world_commands(command_id uuid PK, world_id FK, accepted bool, revision_after bigint, result jsonb, created_at timestamptz);
```

`world_commands` giữ 30 ngày (đủ cho idempotency + điều tra gian lận).

## 6. API

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/auth/recover` | Khôi phục bằng mã |
| GET | `/api/me` | Danh sách nhân vật của account (mỗi map: tên, cấp, XP, $, tổng tài sản) |
| GET | `/api/content/:version` | Catalog + economy (cache bất biến theo version) |
| GET | `/api/maps` | Danh sách map có thể tạo (mapId, kind, templateVersion, ảnh preview) |
| POST | `/api/characters` | `{ mapKind, displayName }` → tạo nhân vật (và account nếu chưa có token) |
| GET | `/api/worlds/:id` | Snapshot (`06 §6`), sau khi settle |
| POST | `/api/worlds/:id/commands` | Lô lệnh (≤ 10) → mảng `CommandResult` |
| DELETE | `/api/worlds/:id` | Xóa nhân vật + vùng đất của map này (cần `confirmName`); sau đó tạo lại bằng `POST /api/characters` |
| GET | `/health` | Liveness + kiểm tra DB |

Template tĩnh do Nginx phục vụ (`/worlds/...`, cache dài, tên file có version).

## 7. Chống gian lận (tóm tắt)

| Mối đe dọa | Biện pháp |
|---|---|
| Sửa tiền ở client | Ví chỉ tồn tại trên server |
| Tua đồng hồ máy | Mọi thời gian dùng clock server |
| Gửi lệnh bỏ qua luật | `sim.validate` trên server, cùng mã nguồn |
| Gửi lặp lệnh | Idempotency `commandId` + revision |
| Xây–hủy/phá để lấy XP | XP xây dựng chỉ cộng khi công trình **hoàn thành** (`16 §3.1`); hủy khi đang xây không có XP; phá dỡ chỉ hoàn 50% nên xây–phá luôn lỗ |
| Spam tạo tài khoản | Rate limit IP; nhân vật bỏ hoang < cấp 2 sau 30 ngày bị xóa; account không còn nhân vật bị xóa |
| Payload khổng lồ | Giới hạn 256 ô/lệnh, 10 lệnh/lô, body ≤ 64 KB |

## 8. Ngân sách hiệu năng (client)

| Chỉ số | Desktop | Mobile tầm trung |
|---|---|---|
| Tải lần đầu (gzip, trước khi vào world) | ≤ 3 MB | ≤ 3 MB |
| Tải world (template + asset map) | ≤ 8 MB | ≤ 8 MB |
| Thời gian từ mở trang → màn nhập tên | ≤ 2 s | ≤ 4 s |
| FPS | 60 | ≥ 30 |
| Draw calls | ≤ 300 | ≤ 150 |
| Tam giác hiển thị | ≤ 1,5 M | ≤ 500 k |
| Bộ nhớ GPU | ≤ 600 MB | ≤ 300 MB |
| Rebuild 1 khu địa hình sau lệnh | ≤ 8 ms | ≤ 16 ms |

Kỹ thuật bắt buộc: InstancedMesh cho env + công trình lặp lại; geometry địa hình theo khu, chỉ rebuild khu bị sửa (và khu kề nếu đỉnh chung đổi); GLB nén meshopt, texture KTX2; 1 directional light đổ bóng, shadow map 2048 (desktop) / 1024 (mobile) chỉ bao vùng camera; `devicePixelRatio` tối đa 2 (desktop) / 1,5 (mobile); chế độ "đồ họa thấp" tắt bóng và giảm mật độ cỏ.

## 9. Deploy

- `docker compose up -d --build` chạy `web` (Nginx: static + reverse proxy `/api` → `api:3000`), `api`, `postgres` (volume).
- `.env.example`: `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `TOKEN_PEPPER`, `LOG_LEVEL`.
- Migration Drizzle chạy khi `api` khởi động (khóa advisory để không chạy đồng thời).
- Healthcheck: `web` → `/health` proxy; `api` → kiểm tra DB.
- Sao lưu Postgres hằng ngày (`pg_dump`), giữ 7 bản.
- HTTPS qua Cloudflare Tunnel hoặc reverse proxy phía trước; Nginx đặt `Cache-Control: immutable` cho asset có hash.

## 10. Quan sát (observability)

- Log JSON (pino) có `requestId`, `accountId`, `worldId`, `commandType`, `accepted`, `code`, `durationMs`.
- Metric: lệnh/giây, tỉ lệ từ chối theo mã, p95 thời gian xử lý lệnh, số world hoạt động.
- Client gửi lỗi JS + lỗi tải asset (có tên asset, mapId) về `/api/telemetry` (P1) — hiển thị nút "Thử lại" khi lỗi tải.
- Panel debug (`?debug=1`): FPS, draw calls, tam giác, bộ nhớ, khu đã dựng, revision, hàng đợi lệnh, độ lệch đồng hồ.
