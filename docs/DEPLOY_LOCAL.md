# Chạy game bằng Docker và chia sẻ qua Cloudflare quick tunnel

Triển khai tạm thời (D021). Từ G2 stack gồm **web** (nginx: client + proxy `/api`), **api** (Node 22, Fastify) và **postgres** (16, volume `pgdata`, **không mở cổng ra ngoài**). Người chơi nhập tên → tài khoản + nhân vật lưu trên server; mã khôi phục dùng để vào lại trên máy khác.

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

Ví dụ: `WEB_PORT=8085 pnpm deploy:up` (bash) hoặc `$env:WEB_PORT=8085; pnpm deploy:up` (PowerShell).

## Quy trình chia sẻ link chơi thử

```bash
pnpm deploy:up          # 1–3 phút cho lần build đầu
curl http://127.0.0.1:8090/health   # → ok
pnpm tunnel:up
pnpm tunnel:url         # đợi ~10 giây nếu chưa có link
```

## Lưu ý

- **Link đổi mỗi lần khởi động lại tunnel.** Quick tunnel chỉ dành cho thử nghiệm, Cloudflare không cam kết thời gian hoạt động. Cần link cố định thì dùng named tunnel với tài khoản Cloudflare và tên miền riêng.
- **Máy phải luôn bật.** Mọi người chơi đều dùng tài nguyên của máy này.
- Ai có link đều tạo được tài khoản (giới hạn 5 tài khoản/giờ/IP) và dữ liệu nằm trên máy này. Chỉ gửi link cho người tin cậy và tắt tunnel khi không dùng.
- Xóa sạch dữ liệu: `docker compose -f infra/compose.yml down -v` (**không hoàn tác được**).
- Cổng web chỉ mở trên `127.0.0.1`. Bên ngoài chỉ vào được qua tunnel.
- Hook kiểm thử (`__debug.command`, `advance`, `loadSnapshot`) **không có** trong bản production; đã kiểm bằng `scripts/web-smoke.mjs`.
