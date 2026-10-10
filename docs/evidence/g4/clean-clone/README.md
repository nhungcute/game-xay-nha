# G4 clean-checkout deploy (2026-10-10, Claude)

1. `git clone` of commit `c5f0245` into an empty temp folder (no untracked files, no `infra/.env`, no `node_modules`).
2. `node scripts/ensure-env.mjs` → new random secrets; `WEB_PORT=8091` so the running stack on 8090 is untouched.
3. `docker compose -p xay-nha-clean -f infra/compose.yml up -d --build` → postgres, api (healthy), backup (first dump written), web.
4. `curl 127.0.0.1:8091/health` → 200.
5. `BASE_URL=http://127.0.0.1:8091 node scripts/g4-smoke.mjs` → **PASS** (`smoke.json`, screenshots):
   Chromium 1440×900 and WebKit iPhone 13 emulation; per browser one account: City character (recovery code shown),
   buy wood, reload → same world; switch map → Farm character on the same account, buy, reload → same world;
   no test hooks in production; graphics default high/low; draw calls 150/168 desktop, 57/62 mobile; 0 console/page/HTTP errors.
6. `docker compose -p xay-nha-clean … down -v`, clone deleted.

WebKit FPS (~26) is headless software rendering on this Windows host, not a device measurement.
