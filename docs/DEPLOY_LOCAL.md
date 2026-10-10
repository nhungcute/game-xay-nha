# Chạy game bằng Docker và chia sẻ qua Cloudflare quick tunnel

Triển khai tạm thời (D021). Stack gồm **web** (nginx: client + proxy `/api`), **api** (Node 22, Fastify), **postgres** (16, volume `pgdata`, **không mở cổng ra ngoài**) và **backup** (`pg_dump` hằng ngày vào thư mục `backups/`). Người chơi nhập tên → tài khoản + nhân vật lưu trên server; mã khôi phục dùng để vào lại trên máy khác.

Lần chạy đầu, `pnpm deploy:up` tự tạo `infra/.env` với mật khẩu Postgres và `TOKEN_PEPPER` ngẫu nhiên. **Giữ file này**: mất `TOKEN_PEPPER` thì mọi người chơi phải dùng mã khôi phục để vào lại; mất mật khẩu thì không mở được dữ liệu cũ. File đã nằm trong `.gitignore`.

## Yêu cầu

- Docker Desktop (Engine ≥ 24) đang chạy, kèm Docker Compose v2.
- Node 22 và pnpm 10.18.3, chỉ cần cho các lệnh `pnpm …` bên dưới. Có thể gọi thẳng `docker compose …` nếu không có Node.

## Lệnh

| Lệnh | Tác dụng |
|---|---|
| `pnpm deploy:up` | Tạo `infra/.env` nếu chưa có, build image, chạy postgres + api + web tại **http://127.0.0.1:8090** (đổi cổng bằng `WEB_PORT` trong `infra/.env`) |
| `pnpm deploy:logs` | Xem log |
| `pnpm tunnel:up` | Mở tunnel công khai (container `cloudflare/cloudflared:2025.9.1`) |
| `pnpm tunnel:url` | In link `https://xxxx.trycloudflare.com` để gửi người chơi thử |
| `pnpm tunnel:down` | Tắt tunnel, web vẫn chạy |
| `pnpm deploy:down` | Tắt toàn bộ (dữ liệu vẫn còn trong volume `pgdata`) |
| `pnpm db:backup` | Sao lưu ngay một bản vào `backups/xaynha-YYYYMMDD-HHMMSS.dump` |
| `pnpm db:restore backups/<file>.dump --yes` | Khôi phục một bản sao lưu (**ghi đè toàn bộ dữ liệu hiện tại**) |

Ví dụ: `WEB_PORT=8085 pnpm deploy:up` (bash) hoặc `$env:WEB_PORT=8085; pnpm deploy:up` (PowerShell).

## Quy trình chia sẻ link chơi thử

```bash
pnpm deploy:up          # 1–3 phút cho lần build đầu
curl http://127.0.0.1:8090/health   # → ok
pnpm tunnel:up
pnpm tunnel:url         # đợi ~10 giây nếu chưa có link
```

## Sao lưu và khôi phục

- Service `backup` tạo một bản ngay khi stack khởi động, sau đó mỗi 24 giờ; chỉ giữ **7 bản mới nhất** (đổi bằng `BACKUP_KEEP`, `BACKUP_INTERVAL_SECONDS` trong `infra/.env`).
- File nằm trong `backups/` ở thư mục dự án (đã gitignore, không vào image). Muốn an toàn hơn, chép thư mục này sang ổ/máy khác.
- Khôi phục: `pnpm db:restore backups/xaynha-20261010-001222.dump --yes`. Script dừng `api`, chạy `pg_restore --clean`, bật lại `api` và chờ healthcheck. Người chơi tạo sau thời điểm sao lưu sẽ mất tài khoản.
- Bản sao lưu chỉ dùng được với **cùng `infra/.env`**: thiếu `TOKEN_PEPPER` cũ thì token đăng nhập cũ không còn hợp lệ (người chơi vẫn vào lại được bằng mã khôi phục).
- Đã kiểm 2026-10-10: tạo A → sao lưu → tạo B → khôi phục ⇒ A còn (200), B mất (401); chạy 9 lần sao lưu ⇒ còn đúng 7 file.

## Quan sát (docs/11 §10)

- `pnpm deploy:logs` là log JSON của API. Mỗi lệnh có một dòng `"msg":"command"` gồm `reqId`, `accountId`, `worldId`, `commandType`, `accepted`, `code`, `durationMs`.
- Mỗi 60 giây (nếu có lệnh) có thêm một dòng `"msg":"metrics"`: số lệnh/giây, tỉ lệ bị từ chối theo mã lỗi, p95 thời gian xử lý, số world đang hoạt động (cửa sổ 5 phút).
- Trong trình duyệt, thêm `?debug=1` vào URL để mở bảng debug: FPS, draw call, tam giác, bộ nhớ GPU, số lần dựng lại khu, revision, hàng đợi lệnh, độ lệch đồng hồ, mức đồ họa.
- Đồ họa: mặc định **Thấp** trên điện thoại/máy cảm ứng, **Cao** trên máy tính. Đổi trong bảng Hồ sơ (bấm vào tên nhân vật).

## Lưu ý

- **Link đổi mỗi lần khởi động lại tunnel.** Quick tunnel chỉ dành cho thử nghiệm, Cloudflare không cam kết thời gian hoạt động. Cần link cố định thì dùng named tunnel với tài khoản Cloudflare và tên miền riêng.
- **Máy phải luôn bật.** Mọi người chơi đều dùng tài nguyên của máy này.
- Ai có link đều tạo được tài khoản (giới hạn 5 tài khoản/giờ/IP) và dữ liệu nằm trên máy này. Chỉ gửi link cho người tin cậy và tắt tunnel khi không dùng.
- Xóa sạch dữ liệu: `docker compose -f infra/compose.yml down -v` (**không hoàn tác được**).
- Cổng web chỉ mở trên `127.0.0.1`. Bên ngoài chỉ vào được qua tunnel.
- Hook kiểm thử (`__debug.command`, `advance`, `loadSnapshot`) **không có** trong bản production; đã kiểm bằng `scripts/web-smoke.mjs`.
