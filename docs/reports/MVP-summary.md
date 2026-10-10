# Xây Nhà — MVP summary

2026-10-10 (Asia/Bangkok). **Runnable local MVP ready; final validation PASS; economy pacing PASS after D025 (Q010 resolved).**

> **Update 2026-10-10 (Claude, `a10c37d`):** Farm pacing fixed by **D025** — Farm XP table recalibrated on the real sim,
> `contentVersion` 2, v1 snapshots migrate on load (29/29 stored Docker worlds load; unit + API migration tests).
> Farm ordinary player with FarmBotV3: L8/L12/L15/L20 +1/+9/+7/+5% PASS (unchanged EconomyBot +38/+34/+21/+10%).
> City table unchanged: its L8/L12 gap was a bot throttle; CityBotV2 passes +15/+9/0/−1% (`24185e5`).
> All 2 maps × 3 styles track docs/16 §12.1 (`docs/reports/Q010-verify.json`). Re-validated after D025:
> `pnpm check` 685/685, `pnpm test:api` 23/23, production smoke PASS on the redeployed stack.
> Full-world render check (`docs/evidence/g4/full-world/`): draw calls ≤ 183, 57–59 FPS steady (City overview 51).
Source: `f5ab34a`; G3/G4 evidence and Q010 committed in `2303cb5`.

Post-MVP update: [entrance redesign](ENTRY-design-report.md) adds illustrated map selection, live character-name
preview and recovery login. New validation: 131 layout checks, eight real dev recovery checks and local production
smoke PASS; economy unchanged. Original closeout counts below retain their original provenance.

Further UI update: [in-game HUD redesign](HUD-design-report.md) groups avatar/name/level/EXP, resources,
functional menus and tool categories using Lucide icons. New review 141/141, real G3 flow 26/26,
check 682/682, API 22/22 and local production smoke 24/24 PASS; localhost:8090 is updated.

## Run

Requirements: Docker Desktop/Compose, Node 22.20.0 and pnpm 10.18.3.
From the project directory:

```powershell
pnpm install --frozen-lockfile
pnpm deploy:up
Start-Process 'http://127.0.0.1:8090'
```

`deploy:up` generates `infra/.env` only when absent, builds the online client/API and starts
Postgres plus daily backups. Keep the existing `.env` and database volume for persistence.
The web service binds localhost; Postgres publishes no host port.
See [local deployment guide](../DEPLOY_LOCAL.md).

The product owner can share a temporary playtest link after local validation:

```powershell
pnpm tunnel:up
pnpm tunnel:url
```

The agent has not started a tunnel or deployed to a public host. Those commands are instructions for the owner.

Development uses offline web 5190, online web 5191 and API 3217; dev Postgres is
`xay-nha-dev-pg` on localhost:55433. Production Docker web is 8090; the integration test DB is temporary on 55432.

## Play

1. Open the local URL, choose Thành phố or Quê, enter a character name and save the recovery code.
2. Follow Bác Tư. City: clear trees → road → flatten → small house → grocery → collect income.
   Farm: market + road → farmhouse → till → plant vegetables → harvest → sell.
3. City buildings need a road connection to ENTRY and enough population for business jobs. Build banks for collect-all and larger income caps.
4. Farmhouse capacity limits fields; grow production inputs, start queues, collect finished products and sell at a connected market.
5. Complete quests, gain XP, unlock buildings and land. Embank both banks and connect a bridge to develop the far side.
6. Use the profile panel for assets and graphics quality. Touch devices default to low graphics; preview and confirm actions on mobile.
7. Reload to resume. Use the recovery code on another browser/device to restore both independent map characters.

Mouse controls: orbit/pan/zoom; touch controls: preview/confirm, pinch zoom and two-finger rotation.
Construction has timers, builder capacity, paid speed-up and full cancellation refunds; active demolition refunds 50%.

## MVP content

- Two authored 3D maps: City coast and Farm valley, v2 templates; terrain heightfields, water/waterfall, deterministic vegetation, roads and modular bridges.
- Vietnamese UI; name login and recovery; one independent character per map; Postgres persistence; server-authoritative commands with revision/idempotency, optimistic queue and reconnection.
- Clear, raise/lower/flatten, till/untill, three road tiers, embank/remove, three bridge types, building placement/rotation/auto-flatten/demolition, crops, harvest, production, sales, materials and adjacent zone unlocks.
- 21 building definitions, 8 crops, 4 recipes, levels 1–20, per-level limits, offline income caps, net worth, 24 authored quests and three repeat-quest slots.
- Mobile layout, low graphics, debug panel, per-command logs/metrics, Docker health checks, daily backups with seven-file retention and local backup/restore commands.

## Validation

| Check | Result |
|---|---|
| `pnpm check` (lint, typecheck, content parity, unit tests, build) | Final exit 0, 682/682 in 24 files; unit-suite duration 56.34 s |
| `pnpm test:api` | Final exit 0, 22/22 against real Postgres; suite duration 15.41 s |
| G3 browser checks | Closeout exit 0, 26/26, 0 errors; Chromium + WebKit emulation |
| Final Docker deployment + Chromium/WebKit production smoke | Both exit 0; healthy localhost:8090 stack, four browser/map cases and 24 checks PASS, zero errors |
| Clean-clone Docker deployment | Retained PASS at `c5f0245`, port 8091; not rerun at final revision |
| 15-minute automated UI soak | Retained 904 recorded steps (12 skipped, 892 action entries), zero console/page/HTTP errors, GPU resource growth +0 |
| Six 60-day economy scenarios | CLI exit 0, 876.329 s; all invariants PASS, pacing FAIL; source fingerprint unchanged (55 files) |
| Supplemental reversal audit | Four classes PASS; no economy/content edits |
| Grocery payback fixture | exit 0; valid L8 layout with nine accepted commands; actual rate $638.4/h, payback 0.900689 h |

Unit + API total: **704 passing cases**. Browser checks are separate assertions, not unit-test cases.
The latest full check has 682 shared-workspace unit cases (six new topology regressions over the 676 baseline),
including six cases in another agent's untracked economy bot.
That bot must be committed by its owner to reproduce those cases and the pacing command from a clean clone.

## Measured performance

Retained desktop browser evidence: roughly 57–59 FPS, measured main-pass draw calls ≤ 169,
triangles ≤ 190k. City/Farm total calls including shadows after batching: 182/200.
The 15-minute soak measured terrain rebuild maximum 1.1 ms during its initial warm-up and GPU growth +0.
Road/grass luminance differs by 33.62% / 27.26%, with 0% blown pixels in the measured views.
Final production smoke: Chromium City/Farm **58.88/58.74 FPS**, **150/168 calls**, 173,370/186,062 triangles.
WebKit iPhone 13 emulation (low): **22.59/22.79 FPS**, **57/62 calls**, 139,052/150,284 triangles.
Maximum terrain rebuild: Chromium City/Farm 1.20/3.80 ms; WebKit 2.00/1.00 ms.
Logs and the validation manifest are in `docs/evidence/mvp-final/`; four screenshots and metrics are in `docs/evidence/g4/smoke/`.

These are measurements on this Windows host and browser emulation, not certification of
Intel Iris Xe, Snapdragon 7-series or iPhone 12 performance.

## Limitations and questions

- Economy gate FAIL: City L8/L12 +85.7%/+33.5%; Farm L8/L12/L15 +101.0%/+155.7%/+144.0%, L20 UNREACHED. City L15/L20 pass. Farm careful speed ≥ 1.3× at L8/12/15; L20 not measurable. Q010 contains all eight comparisons and two model-based approval options; numbers/contentVersion remain unchanged.
- Q009 is open: when only one repeat template is eligible, D024 currently reuses it. The alternative is to leave a slot empty.
- Payback: newly unlocked earning buildings after L5 all meet ≥ 1 h, but earlier Tạp hóa available at L8 has confirmed 0.901 h single-building payback. Shared support costs are excluded. Q010 requires a scope/balance decision; four finite reversal classes pass, all adversarial quest combinations are NOT RUN.
- First-time human tutorial timing and human normal-play soak: NOT RUN. Original automated City tutorial was 15 s; closeout rerun was 16 s.
- Three reference devices and the full-world stress workload: NOT RUN. Some exact long-loop GPU/gesture combinations in docs/10 remain unverified.
- All **74 GLBs are procedural placeholders**; every ID/file is in [the inventory](MVP-placeholder-assets.md). No final-art approval is implied.
- Audio and client telemetry are not implemented; metrics are log-only and in-process. Backups stay on this machine unless copied elsewhere.
- Production build emits a large-chunk warning: closeout main JS 949.89 kB (265.22 kB gzip), entrance redesign 960.65 kB (268.38 kB gzip); both builds succeed. Code splitting remains follow-up work.
- IP rate limiting and the online cache limitations from [G2](G2-report.md) remain. Public tunnel/network behavior and concurrency/load are not validated here.
- ECO is P2. No public hosting or Botkeep deployment was performed.

See [G3 report](G3-report.md), [G4 report](G4-report.md), [open questions](../OPEN_QUESTIONS.md)
and [implementation status](../IMPLEMENTATION_STATUS.md) for exact gate dispositions and retained evidence.

## Suggested P1 work

Resolve Q010/Q009 and the unverified release checks before formal gate approval. For later P1 work:

1. Replace the placeholder art in manifest order; preserve asset scale, footprint and license records.
2. Add approved progression sinks/upgrades, decorations, leaderboard and events after balance validation.
3. Improve public-launch rate limiting, concurrency/load coverage and client cache restoration.
4. Add code splitting, client telemetry, a metrics dashboard, off-machine backups and optional sound.
