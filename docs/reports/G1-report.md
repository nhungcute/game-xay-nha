# G1 gate report — Offline vertical slice, FARM

Date: 2026-10-10 (Asia/Bangkok). Mode: auto-continue (D016). Built by: Codex (scaffold, renderers, tools) and Claude (pending answers, evidence, fixes, Docker).

## 1. What was built

| Area | Result |
|---|---|
| `apps/web` | Vite + React 18 + Three.js 0.180 + zustand client, `VITE_OFFLINE=1`; Vietnamese HUD, quests panel, materials/inventory panels, building catalog with limits, construction panel (speed-up, cancel), debug panel (`?debug=1`) |
| Rendering | Per-zone terrain with dirty rebuild (max 1.5 ms), water + waterfall, deterministic instanced env, auto-tiled roads (3 tiers), embankment walls, modular bridges, instanced buildings/crops, overlay and pooled ghosts |
| Tools | Explore, Clear, Terraform (raise/lower/flatten), Till, Road, Embank, Bridge, Build (rotate, auto-flatten), Plant, Harvest, Demolish, Zone — all previews/commands through `packages/sim` |
| Persistence | IndexedDB cache with validate-then-swap; `loadSnapshot` test hook uses the same path |
| Map | Provisional farm layout `farm-g1` (straight river, start zones 27/28/35/36, ENTRY 70,79) — **layout: provisional**, full layout in G3 |
| Assets | 74 procedural low-poly GLBs, all `"placeholder": true` in the manifest |
| Docker | `infra/web.Dockerfile` (node 22.20.0 → nginx 1.29.2), `infra/compose.yml` (`web`, `tunnel` profile with cloudflared 2025.9.1), scripts `deploy:*`, `tunnel:*`, `docs/DEPLOY_LOCAL.md` |
| Pending answers | Q001–Q004 applied in code + docs (D020): accrued money never removed; `PRODUCTION_ACTIVE`; doc 06/15/16 corrections |

Commits: `66b83a6` (Codex WIP checkpoint), `a1b4b4e` (Q001–Q004), this gate commit.

## 2. Commands and real results

| Command | Result |
|---|---|
| `pnpm check` (content, lint, typecheck, tests, build) | exit 0 — **641/641** tests |
| `npx tsx scripts/g1-plan.ts` | Plays the farm through the real sim to level 4 (market, farmhouse, tilling, crops, well, silo, corn rounds), dry-runs the 13-step UI scenario: OK |
| `node scripts/g1-evidence.mjs` (Chrome 154 headless, GPU via ANGLE/D3D11, 1440×900) | **27/27 checks passed** |
| `node scripts/g1-mobile.mjs` (Pixel 7 Chromium emulation, touch) | **8/8 checks passed** |
| `pnpm deploy:up` + `node scripts/web-smoke.mjs` (http://127.0.0.1:8090) | health `ok`, HUD rendered, 56 FPS, no errors, test hooks absent in production |

## 3. Evidence (`docs/evidence/g1/`)

Required sequence, driven by **real mouse input on the 3D canvas** (tool buttons + clicks/drags):
buy materials → clear 2 trees → dirt road from ENTRY to the river → embank near bank → flatten bank → road to abutment → embank far bank → flatten → far-bank road → **wooden bridge (span 4)** → wait 4 min → ghost preview → **chicken coop on the far bank** → wait → coop ACTIVE and shown "Đang hoạt động" (connected through the bridge).
Screenshots `01`–`17`; orbit `18-orbit-0`, `19-orbit-180`; `20-low-angle`; `21-contrast`; `mobile-01..03`; `docker-web.jpg`. Raw data: `g1-evidence.json`, `mobile-evidence.json`, `docker-web.json`.

| Exit criterion | Measured | Status |
|---|---|---|
| Tool sequence clear → flatten → road → embank both banks → wooden bridge → build far bank | 12/12 UI steps accepted; bridge + coop ACTIVE; coop connected | PASS |
| Orbit 180° / real 3D | Image changes; scene audit: 0 textured planes, 0 sprites, 396 meshes (320 instanced) | PASS |
| Performance vs docs/11 §8 (desktop) | 56.5 FPS (headless Chrome; budget 60), 243 draw calls (≤ 300), 80.8k triangles (≤ 1.5M), zone rebuild max 1.5 ms (≤ 16) | PASS (FPS 6% under 60 in headless; ≥ 55 threshold) |
| GPU leaks docs/10 §4.1 | Tools + all ghosts ×50: geometries 80→80, textures 1→1, programs 14→14. Place + cancel ×50: 80→80 / 1→1 / 14→14 | PASS |
| Lighting/contrast docs/10 §5 | 0% blown pixels; grass 0.563 vs dirt road 0.370 luminance (34% difference) | PASS (after darkening dirt roads) |
| Camera desktop + touch | Mouse orbit/pan/zoom; touch: tap preview does not auto-confirm, ✓ confirms, pinch zoom, two-finger twist | PASS |
| Docker web container | Builds and serves; `/health` 200; real browser load OK | PASS |

## 4. Fixes made during the gate

- `settle` removed money when caps/rates dropped → fixed (Q001/D020) with 3 regressions.
- Demolition error codes aligned with Q002 (`FIELD_LIMIT`, `PRODUCTION_ACTIVE`) + uncollected-product test.
- Dirt road colour was as bright as grass (1.8% luminance difference) → darkened (docs/04 §7).
- Missing favicon caused a 404 console error → inline SVG favicon.
- Touch targets were 36 px on phones → ≥ 44 px on coarse pointers (docs/09 §8).
- Playwright scripts lint config (browser globals inside `page.evaluate`).

## 5. Deviations and open questions

- D021 (new): interim deployment = Docker + Cloudflare quick tunnel; default local port **8090** (8080 was taken on the host), configurable via `WEB_PORT`.
- Open: Q005–Q008 resolved earlier (D017–D019). No new blocking questions.

## 6. Known issues and NOT verified

- **Not verified:** a real phone (only Chromium emulation; emulation FPS 8.9 is software rendering and not meaningful), WebKit/Safari, iGPU laptop performance, the tunnel itself (by rule, only the product owner starts it), a recorded video (screenshots only).
- Visual polish backlog (G3): tilled fields render as a blurry reddish strip; placeholder buildings look alike (chicken coop ≈ house); embankment walls are subtle from the default camera; zone border lines are always visible in explore mode.
- Map is the provisional G1 layout (straight river), not the docs/04 §2 layout.

## 7. Next gate (G2)

`apps/api` (Fastify, Postgres 16, Drizzle): accounts + one character per map, recovery code, worlds/commands with idempotency + revision + settle + completion events, net worth; client command queue with optimistic updates + rebase; compose adds `api` + `postgres` (no published DB port); integration tests docs/10 §3.
