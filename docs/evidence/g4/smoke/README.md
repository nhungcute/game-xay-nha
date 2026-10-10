# Final local production smoke

Run: 2026-10-10 02:00:17–02:00:48 UTC (09:00 Asia/Bangkok), tested HEAD `2303cb5`.
Game implementation: `f5ab34a`, contentVersion 1. Local Docker was rebuilt by `pnpm deploy:up` (exit 0).

```powershell
$env:BASE_URL='http://127.0.0.1:8090'
node scripts/g4-smoke.mjs
```

Exit 0: health ok, four browser/map cases, 24 boolean checks PASS, zero console/page/HTTP errors.
`smoke.json` contains actual metrics; four JPEGs capture City/Farm on Chromium desktop and WebKit iPhone 13 emulation.
This is initial-world functional smoke, not full-world stress or real-device performance testing.
No tunnel or public deployment was started. Log: `../../mvp-final/smoke.log`.
