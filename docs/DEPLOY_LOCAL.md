# Chạy game bằng Docker và chia sẻ qua Cloudflare quick tunnel

Triển khai tạm thời (D021). Hiện tại (G1) chỉ có **web client chạy offline**: dữ liệu lưu trong trình duyệt của từng người chơi, chưa có server hay đăng nhập. Từ G2, compose sẽ thêm `api` và `postgres`.

## Yêu cầu

- Docker Desktop (Engine ≥ 24) đang chạy, kèm Docker Compose v2.
- Node 22 và pnpm 10.18.3, chỉ cần cho các lệnh `pnpm …` bên dưới. Có thể gọi thẳng `docker compose …` nếu không có Node.

## Lệnh

| Lệnh | Tác dụng |
|---|---|
| `pnpm deploy:up` | Build image và chạy web tại **http://127.0.0.1:8090** (đổi cổng bằng biến `WEB_PORT`) |
| `pnpm deploy:logs` | Xem log |
| `pnpm tunnel:up` | Mở tunnel công khai (container `cloudflare/cloudflared:2025.9.1`) |
| `pnpm tunnel:url` | In link `https://xxxx.trycloudflare.com` để gửi người chơi thử |
| `pnpm tunnel:down` | Tắt tunnel, web vẫn chạy |
| `pnpm deploy:down` | Tắt toàn bộ |

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
- Ai có link đều vào được. Giai đoạn G1 không có dữ liệu server nên không có rủi ro. Từ G2: chỉ gửi link cho người tin cậy và tắt tunnel khi không dùng.
- Cổng web chỉ mở trên `127.0.0.1`. Bên ngoài chỉ vào được qua tunnel.
- Hook kiểm thử (`__debug.command`, `advance`, `loadSnapshot`) **không có** trong bản production; đã kiểm bằng `scripts/web-smoke.mjs`.
