# 14 — English implementation prompt for Codex / Claude Code

**Cách dùng:**
- **Khuyến nghị:** dùng **GOAL PROMPT (§0)**. Agent tự chạy qua các mốc G0 → G4 tới MVP, dừng ở mỗi mốc để bạn duyệt, và tiếp tục qua nhiều phiên nhờ file trạng thái.
- §1 (master prompt) và §2 (prompt theo mốc) giữ lại để giao từng phần cho agent khác nhau.
- Agent cần đọc được toàn bộ thư mục `docs/` và 3 ảnh `map/map_1.png`, `map/map_2.png`, `map/map_3.png`.

**Trước khi dán prompt:** đã duyệt 01, 15, 16; thư mục dự án là git repo (nếu chưa, agent sẽ tự `git init` ở G0).

---

## 0. GOAL PROMPT — từ con số 0 tới MVP

### 0.1 Prompt khởi động (dán ở phiên đầu tiên)

```text
GOAL: Build the MVP of "Xây Nhà" — a browser-based 3D casual building game —
exactly as specified in docs/, working through gates G0 → G4, until every
MVP exit criterion in §"MVP DEFINITION OF DONE" below is met with real evidence.

ROLE
You are the lead engineer and integrator. You plan, implement, test, and report.
The human (me) is the product owner and reviews each gate.

SOURCE OF TRUTH (read ALL before writing code; re-read the relevant docs at the
start of every gate)
- docs/00_INDEX.md first (decisions, reading order, glossary).
- Precedence when docs conflict: 01 > 15/16 > 06 > all others.
- Rules: docs/15. Every number: docs/16 (computed by docs/tools/economy — never
  invent or hand-tune numbers; put them in packages/content/economy.v1.json).
- Data: docs/06. Commands/sync/persistence: docs/08. Client architecture: docs/02.
  Stack/API/DB/auth: docs/11. UI/FTUE: docs/09. Tests: docs/10. Tasks/gates:
  docs/12. Assets: docs/13. Maps: docs/03 (city), docs/04 (farm). Art: docs/07.
- docs/12 §7.1 lists bugs found in old prototypes. Never repeat them.
- map/ contains 3 OLD PROTOTYPES (plain JS, localStorage). They are REFERENCE
  ONLY. Do not copy their architecture, do not build on them, do not edit them.
- map/map_1..3.png are layout/palette references only — never textures/planes.

MVP SCOPE (from docs/01 §10 — nothing more, nothing less)
- Maps: CITY and FARM (ECO is P2 — do not build).
- Login by character name only; one independent character per map
  (own name, level, XP, $, net worth); recovery code.
- Tools: clear, terraform (raise/lower/flatten), till (farm), embank, roads
  (3 tiers), bridges (wood/stone/concrete), place building, demolish,
  plant/harvest, production queues, sell, buy materials, unlock zones.
- Construction timers + builder slots + speed-up + cancel (docs/16 §3).
- Server-authoritative economy, offline income with caps, XP/levels 1–20,
  per-level building limits, quests + tutorial (docs/09 §5, docs/16 §10).
- Desktop + mobile browser, Vietnamese UI via i18n keys, Docker deploy.
- Out of scope: anything listed as P1/P2 in docs/01 §10. If tempted, write it
  in docs/OPEN_QUESTIONS.md instead.

FIXED STACK (docs/11): TypeScript strict, pnpm monorepo, Vite + Three.js (exact
pinned version) + React + zustand, Node 22 + Fastify + PostgreSQL 16 + Drizzle,
zod, Vitest, Playwright, Docker Compose. Do not substitute.

NON-NEGOTIABLE ARCHITECTURE RULES
1. All game rules live ONLY in packages/sim (pure TS; no Three.js/DOM/Node APIs;
   time is passed in; integer money). Client uses sim for previews, server uses
   the same sim to validate/apply. Server is authoritative for money and time.
2. Template immutable; world = template + delta (docs/06). Deterministic env
   generation (docs/06 §4.1). World templates start with ZERO buildings,
   bridges, embankments, tilled cells, fences, paved roads.
3. Commands: commandId idempotent + expectedRevision; settle before any rate
   change; process construction completions in time order (docs/08 §5).
4. Validate-everything-then-swap for every snapshot/cache load (docs/08 §6.1,
   docs/06 §6.6). Never clear current state before validating.
5. One footprint function for placement, picking, demolish (docs/15 §8.1).
6. GPU ownership rules (docs/02 §10.1): pooled ghosts, no disposing shared
   materials, no Object3D.clear() without dispose.
7. Real 3D only: heightfield mesh, water meshes, instanced GLB. No image planes.
8. Dirty-zone terrain rebuild only (≤ 16 ms per zone on mobile target).

WORKING PROTOCOL
- Work gate by gate: G0 → G1 → G2 → G3 → G4 (definitions below). Inside a gate,
  break work into small tasks; for each task: plan → implement → test → commit.
- Commit after every task with a clear message. Never commit failing tests.
- Maintain these files (create in G0):
  - docs/IMPLEMENTATION_STATUS.md — current gate, task checklist with status,
    last test run (command + real result), known issues, next steps.
    This file is how you RESUME in a new session. Keep it accurate.
  - docs/DECISIONS.md — every deviation or interpretation of the docs:
    date, context, decision, alternatives, doc reference.
  - docs/OPEN_QUESTIONS.md — anything needing the product owner.
- Do NOT edit design docs 00–16 except: fixing obvious typos, or when the human
  approves a change listed in OPEN_QUESTIONS. Economy numbers change only via
  docs/tools/economy + docs/16 + contentVersion bump, and only with approval.
- When docs are ambiguous: choose the most conservative reading consistent with
  docs/01, record it in DECISIONS.md, continue. When blocked (missing external
  input, contradiction that changes gameplay): record in OPEN_QUESTIONS.md,
  continue with other tasks, and raise it in the gate report.
- Never report a test, build, or browser check as passed unless you ran it in
  this environment and saw it pass. If you cannot run something (no browser,
  no GPU, no Docker, no network), say exactly what was not verified.
- Run the full test suite before every gate report.

EXTERNAL INPUTS AND FALLBACKS
- Map layouts: if docs/ has no traced layout.json for a map, build one from the
  zone diagrams in docs/03 §2 / docs/04 §2 with packages/tooling, mark it
  "layout: provisional" in IMPLEMENTATION_STATUS and request art review at G3.
- 3D assets: prefer CC0 packs (Kenney, Quaternius, KayKit) if network access
  exists; record source/license in the asset manifest (docs/13 §2). Otherwise
  generate simple low-poly placeholders via tooling with "placeholder": true in
  the manifest. Placeholders are allowed through G3; G4 requires a list of
  every remaining placeholder approved by the human.
- Audio is optional for MVP; UI icons may be simple SVGs.

GATES AND EXIT CRITERIA (details: docs/12 §3)
G0 — Foundations and rules (no rendering)
  - git repo, pnpm monorepo per docs/11 §2, TS strict, lint, Vitest, CI script.
  - packages/contracts (types + zod per docs/06), packages/content
    (economy.v1.json + catalog + vi.json generated from docs/16),
    packages/worldgen, packages/sim implementing every command in docs/08 §4
    with rules from docs/15 (incl. construction timers, limits, queues).
  - Template validator + a small test template.
  - Exit: all unit tests in docs/10 §2 (incl. §2.3b, §2.6) pass; ≥ 80 tests;
    property test of 1000 random commands keeps invariants (occupancy,
    money ≥ 0, shared zone edges equal, IDs unique).
G1 — Offline vertical slice, FARM (VITE_OFFLINE=1, no server)
  - Terrain per zone with dirty rebuild, water, waterfall, deterministic env,
    village road, all tools with green/yellow/red previews + reasons + cost,
    construction timers visible, camera controls desktop + touch.
  - Exit: recorded video/screenshots: clear → flatten → road → embank both
    banks → wooden bridge → build on far bank → orbit 180°; FPS/draw calls/
    zone rebuild time reported against docs/11 §8; GPU leak checks docs/10 §4.1
    pass; lighting/contrast check docs/10 §5 pass.
G2 — Server, name login, persistence, economy
  - apps/api with accounts/characters/worlds/commands per docs/11; command
    queue with optimistic updates + rebase; settle, offline income, XP/levels,
    zone unlock, construction completion processing, net worth.
  - Exit: integration tests docs/10 §3 pass; crafted invalid command via curl
    rejected; state hash identical after reload; two characters on one account
    fully independent.
G3 — Full content for both maps
  - City + farm templates (docs/03, docs/04), full catalog (docs/16), quests,
    tutorial (docs/09 §5), HUD/profile/net worth, building limits UI.
  - Port the economy model to packages/tooling/sim-economy.ts using the real
    sim; compare pacing with docs/16 §12 and report differences.
  - Exit: both maps visually distinct; 5-angle screenshots per map (docs/10 §5);
    tutorial completes in ≤ 6 minutes; E2E flows docs/10 §4 pass.
G4 — Release readiness
  - Mobile polish, low-graphics mode, Docker Compose (web + api + postgres),
    health checks, backups, observability (docs/11 §9–10).
  - Exit: docs/10 §8 release criteria met; `docker compose up` from a clean
    checkout works; final report lists every unverified item and placeholder.

GATE REPORT (at the end of each gate, then STOP and wait for my approval
unless I said "auto-continue")
  1. What was built (by package), with commit range.
  2. Commands run and their real output summary (tests, build, lint, e2e).
  3. Evidence: screenshots/video paths, perf numbers, leak measurements.
  4. Deviations (link DECISIONS.md) and open questions (link OPEN_QUESTIONS.md).
  5. Known issues and what was NOT verified.
  6. Plan for the next gate.

MVP DEFINITION OF DONE
- A new player opens the site, types a name, picks CITY or FARM, finishes the
  tutorial, and can play every MVP feature above on desktop and on a mobile
  browser; progress survives reload and device change via recovery code.
- All tests in docs/10 pass (unit, integration, E2E smoke on Chromium + WebKit
  mobile emulation); no console errors in 15 minutes of normal play.
- Performance budget docs/11 §8 met (or measured gaps documented and approved).
- docs/16 numbers are the ones in packages/content; pacing report attached.
- Docker deploy works from a clean checkout; IMPLEMENTATION_STATUS.md is final.

START NOW: read the docs, create the status/decision/question files, write a
G0 task plan into IMPLEMENTATION_STATUS.md, then begin G0.
```

### 0.1b Prompt hợp nhất tới MVP (dùng sau khi G0 đã duyệt — 2026-10-10)

Gộp: các câu trả lời Q001–Q004 còn treo, chế độ tự chạy tiếp, triển khai Docker + trycloudflare, và toàn bộ mốc G1–G4. Dán vào phiên của agent (đang chạy hoặc phiên mới).

```text
FINAL GOAL: take "Xây Nhà" from the approved G0 to a finished MVP (G1 → G2 → G3 → G4)
in AUTO-CONTINUE mode, following docs/14 §0.1 rules plus everything below.
This message supersedes earlier instructions where they differ.

0. RESUME FIRST
- Read docs/IMPLEMENTATION_STATUS.md, DECISIONS.md, OPEN_QUESTIONS.md, docs/reports/,
  `git status`, `git log --oneline -20`. Finish or safely commit the work in progress.
- Run `pnpm check`; it must pass before new work.

1. PENDING DESIGN ANSWERS — apply NOW (code + tests + listed doc edits), before more G1 work
Q001 (supersedes D013): money already accrued is NEVER removed. The cap limits only new
  accrual: accrued_new = accrued + min(rate × dt, max(0, rate × capHours − accrued)).
  Update sim, docs/16 §6.4 pseudo-code, and add tests: accrue near cap → road disconnected
  (rate 0) or cap lowered → settle → accrued unchanged; collect still works.
Q002: reject demolition that would leave an invalid state (no auto-destruction):
  farmhouse when tilled cells > new quota → FIELD_LIMIT; silo when inventory > new capacity
  → STORAGE_FULL; production building with queued/in-progress batch or uncollected product
  → new error PRODUCTION_ACTIVE. Add to docs/15 §8.3 and §11, with tests.
Q003: confirm D002; update docs/06 §4 (water-only vertices ≤ water−5; shared shore vertices
  follow docs/15 §4.2.3).
Q004: confirm D003; update docs/06 §6.6 (past timestamps placedAt/plantedAt/settledAt/
  startedAt ≤ serverTime+5 min; deadlines buildEndsAt/readyAt validated against catalog
  durations, irrigation, tutorial and speed-up rules).
D004: confirm 50% speed-up; set P.speedupPct = 0.5 in docs/tools/economy/model.mjs.
New-character clarification: farm inventory starts {} (no crops/products/seeds); city
  population starts 0. Add to docs/16 §2.
Record each in DECISIONS.md, close Q001–Q004 in OPEN_QUESTIONS.md, commit.

2. MODE: AUTO-CONTINUE (already recorded; keep it)
- End of each gate: full `pnpm check` + gate-specific checks, write docs/reports/G<x>-report.md
  (what was built, commands + real results, evidence, deviations, known issues, NOT verified),
  commit, then start the next gate immediately.
- A gate is done only when its exit criteria really pass. Never skip a criterion.
- STOP and wait for me ONLY if: a criterion still fails after 3 serious attempts; a question
  would change gameplay, economy numbers, or docs 00–16 beyond approvals in this message;
  external input is needed (art review, licensed assets that need an account, secrets,
  paid services); an action is destructive/irreversible; anything would be published.
  Otherwise log it in OPEN_QUESTIONS.md, choose the conservative option, continue.

3. DEPLOYMENT (interim, approved): Docker + Cloudflare quick tunnel (trycloudflare)
- infra/compose.yml + Dockerfiles + nginx.conf + .env.example:
  G1: `web` = multi-stage build (pnpm build → nginx serving the client, VITE_OFFLINE=1),
      bound to localhost:8080, GET /health.
  G2+: `api` (Node 22), `postgres` (16, named volume, NO published port); nginx proxies
      /api → api; migrations run on api start (advisory lock); secrets only via .env.
  `tunnel` service under compose profile "tunnel": image cloudflare/cloudflared pinned to
      an exact version, `tunnel --no-autoupdate --url http://web:80`.
- Root scripts: deploy:up, deploy:down, deploy:logs, tunnel:up, tunnel:url (prints the
  *.trycloudflare.com URL), tunnel:down.
- docs/DEPLOY_LOCAL.md: commands, getting the URL, stopping, caveats (URL changes on
  restart, machine must stay on, testing only).
- Every gate from G1: `pnpm deploy:up`, curl /health = 200, load the page via
  localhost:8080 in a real browser; record results in the gate report.
- NEVER start the tunnel yourself — I run `pnpm tunnel:up`. Do not deploy to Botkeep or
  any other host.
- From G2: rate limits on, CORS = same origin, no debug endpoints in production builds,
  Postgres never exposed, no secrets in images or git.

4. REMAINING GATES (details: docs/12 §3, docs/10)
G1 — Offline vertical slice, FARM (VITE_OFFLINE=1)
  Terrain per zone with dirty rebuild, water + waterfall, deterministic env, village road,
  every tool with green/yellow/red preview + reason + cost, construction timers/builders,
  camera desktop + touch, Vietnamese HUD basics. Provisional farm layout from docs/04 §2.
  Exit: screenshots/video of clear → flatten → road → embank both banks → wooden bridge →
  build on far bank → orbit 180°; perf numbers vs docs/11 §8; GPU leak checks docs/10 §4.1;
  lighting/contrast docs/10 §5; Docker web container works.
G2 — Server, name login, persistence, economy
  apps/api per docs/11 (accounts, one character per map, recovery code, worlds, commands,
  idempotency, revision, settle, completion events, offline income, XP, zones, net worth);
  client command queue with optimistic updates + rebase; IndexedDB cache with
  validate-then-swap.
  Exit: docs/10 §3 integration tests pass; curl-crafted invalid command rejected; state hash
  identical after reload; two characters on one account independent; full Docker stack up.
G3 — Full content for both maps
  City + farm templates (docs/03, docs/04; mark "layout: provisional" until art review),
  full catalog and limits (docs/16), 24 authored quests + repeat quests (D017), tutorial
  (docs/09 §5), HUD, profile, net worth, map switching / character creation.
  Port the economy model to packages/tooling/sim-economy.ts on the real sim; compare pacing
  with docs/16 §12 (≤ 25% deviation for the 3-sessions/day player) and report.
  Exit: both maps visually distinct; 5-angle screenshots per map; tutorial ≤ 6 minutes;
  E2E flows docs/10 §4 pass on Chromium + WebKit mobile emulation.
G4 — Release readiness (local Docker + tunnel)
  Mobile polish, low-graphics mode, audio optional, observability/debug panel (docs/11 §10),
  Postgres backup script, docs/DEPLOY_LOCAL.md complete.
  Exit: docs/10 §8 criteria; `git clone` → `.env` from example → `pnpm deploy:up` works on a
  clean checkout; 15 minutes of normal play with no console errors; final report lists every
  unverified item and every placeholder asset.

5. ASSETS
Prefer CC0 packs (Kenney, Quaternius, KayKit) if downloadable without an account; record
source/license in the manifest. Otherwise low-poly placeholders with "placeholder": true.
Placeholders allowed through G3; G4 report must list every remaining one.

6. WHEN MVP IS DONE
Write docs/reports/MVP-summary.md: how to run and play (commands), what is in the MVP,
test totals, perf numbers, known limitations, placeholders, open questions, and suggested
P1 work. Then stop and tell me: "MVP ready — run `pnpm deploy:up` then `pnpm tunnel:up`."
```

### 0.2 Prompt tiếp tục (dán ở mỗi phiên mới)

```text
Continue the MVP goal. First read docs/IMPLEMENTATION_STATUS.md, docs/DECISIONS.md,
docs/OPEN_QUESTIONS.md and `git log --oneline -20`. Re-read the docs relevant to
the current gate. Verify the last recorded test run still passes before new
work. Then continue with the next unchecked task. Follow every rule of the
original goal prompt (docs/14 §0.1).
```

### 0.3 Prompt duyệt mốc (bạn dùng khi agent báo cáo xong một mốc)

```text
Before I approve gate <Gx>: (1) run the full test suite now and paste the real
summary; (2) show the evidence files listed in your report; (3) list every
item in docs/10 relevant to this gate as PASS / FAIL / NOT RUN; (4) list
anything you implemented that is outside MVP scope; (5) list the bugs from
docs/12 §7.1 and show where each is prevented in code. Do not start the next
gate until I reply "approved".
```

### 0.4 Khi bạn muốn trả lời câu hỏi mở hoặc đổi yêu cầu

```text
Answers to docs/OPEN_QUESTIONS.md: <Q-id>: <answer> ...
Record each answer in DECISIONS.md, update affected docs only where I said so,
adjust the plan in IMPLEMENTATION_STATUS.md, then continue.
```

---

## 1. MASTER BUILD PROMPT

```text
You are the lead engineer of a browser-based 3D casual building game.
Players type a character name and immediately start on an untouched natural
land (rivers, lakes, forests). They clear trees/rocks, till soil, terraform
(raise/lower/flatten in 0.5 m steps), build stone embankments along water,
draw roads, build bridges across rivers, place buildings, and earn money:
CITY map = passive income from houses/shops/banks; FARM map = plant, harvest,
process and sell crops/animal products.

SOURCE OF TRUTH
- Read ALL files in docs/ before coding. Precedence: 01 > 15/16 > 06 > others.
- docs/15 = gameplay rules, docs/16 = every number, docs/06 = data schema,
  docs/08 = commands & sync, docs/11 = stack/API/DB, docs/02 = client architecture.
- Reference images are for layout/palette only. Never render them as planes,
  textures, skyboxes or backgrounds.
- Record every deviation and known limitation in docs/IMPLEMENTATION_STATUS.md.

STACK (fixed)
- TypeScript strict everywhere; pnpm monorepo.
- Client: Vite + Three.js (exact pinned version) + React for UI + zustand.
- Server: Node 22 + Fastify + PostgreSQL 16 + Drizzle; zod for validation.
- Tests: Vitest + Playwright. Deploy: Docker Compose (nginx web, api, postgres).

CORE ARCHITECTURE RULES
- 2 m grid cells, 128x128 cells, 129x129 vertex heights in decimeters (Int16),
  8x8 zones of 16x16 cells; a zone is both the unlock unit and the render chunk.
- All game rules live ONLY in packages/sim (pure TS, no Three.js/DOM, time
  passed in, integer cash). Client uses sim for previews; server uses the same
  sim to validate and apply. Server is authoritative for money and time.
- Construction: buildings and bridges have build timers with builder slots
  (2/3/4); terrain and infrastructure tools are instant (docs/16 §3).
  Every economy number comes from docs/16 (computed by docs/tools/economy).
- Template is immutable; a player world = template + delta (per-zone layer
  blobs, removedEnvIds, buildings, bridges, crops, inventory).
- Commands carry commandId (idempotent) and expectedRevision (optimistic
  concurrency). Settle all income before any command that changes rates.
- Environment objects are generated deterministically per zone (mulberry32,
  hashed seed, fixed RNG calls per cell) with stable IDs.
- Terrain edits rebuild only dirty zones (+ neighbours sharing edge vertices).

ABSOLUTE REQUIREMENTS
- Templates start with ZERO buildings, bridges, embankments, tilled cells,
  fences or paved roads. Only natural dirt village roads and an ENTRY cell.
- Bridges, embankments and paved roads exist ONLY when a player builds them,
  following docs/15 exactly (straight bridges, embanked road abutments,
  max span per type, height difference <= 1 m).
- Real 3D: heightfield mesh with visible relief, separate water meshes,
  instanced GLB vegetation/buildings. No image planes faking 3D.
- Login = display name only -> guest token + one-time recovery code (docs/11 §4).
- One CHARACTER per map: each character has its own name, level, XP, cash ($)
  and net worth (docs/16 §13). Switching to a map without a character creates a
  new level-1 character; nothing carries over between maps.
- Vietnamese UI via i18n keys; desktop + mobile touch.

IMPLEMENTATION ORDER (stop at each gate, fix failures before continuing)
G0  Monorepo, contracts, sim with all rules + >= 80 unit tests, template validator.
G1  Offline vertical slice (VITE_OFFLINE=1) on FARM: real terrain/water/env,
    tools Clear/Terraform/Till/Road/Embank/Bridge/Build/Plant/Harvest/Demolish.
G2  Backend, name login, command queue with optimistic updates + rebase,
    server-side economy, persistence, reload consistency.
G3  Full CITY and FARM templates (docs/03, 04), full catalog (docs/16),
    quests + tutorial (docs/09 §5), zone unlocking.
G4  Mobile polish, low-graphics mode, audio, Docker, observability, QA report.

VALIDATION BEFORE CLAIMING ANY GATE
- Run build, lint, typecheck, unit, integration and Playwright tests; paste
  real output.
- Record a browser video/screenshots: terraform -> embank -> bridge -> build on
  the far bank -> orbit 180 degrees.
- Prove: new world has zero player objects; duplicate commandId applies once;
  a crafted invalid command via curl is rejected; state hash identical after reload.
- Meet the performance budget in docs/11 §8 or report the measured numbers.
- If no browser/GPU is available, say exactly what was not verified. Never
  report unverified tests as passed.
```

## 2. Prompt theo mốc

### G0 — Lõi luật

```text
Implement only G0 from docs/12 §3 (M0). Create the pnpm monorepo, packages/contracts
(types + zod per docs/06), packages/sim implementing every command in docs/08 §4
with rules from docs/15 and formulas from docs/16 (read numbers from
packages/content/economy.v1.json, never hard-code). Write the unit tests listed in
docs/10 §2 plus a property test of 1000 random commands checking invariants.
No rendering yet. Report test output.
```

### G1 — Vertical slice offline

```text
Implement G1: a Vite + Three.js + React client running fully offline with
packages/sim. Build a small FARM test template via packages/tooling, render
terrain per zone with dirty-zone rebuild, water, deterministic instanced
vegetation, natural dirt road, and all tools with green/yellow/red previews and
reasons. Do not build the backend yet. Provide screenshots/video of: clear trees,
flatten, road, embank both banks, wooden bridge, build on far bank, 180° orbit.
Report FPS, draw calls and zone rebuild time.
```

### Review prompt

```text
Audit the implementation against docs/. For each rule in docs/15 and each
requirement in docs/10 §8 produce a PASS/FAIL table with file paths and
reproduction steps. Check: rules duplicated outside packages/sim, Date.now() in
sim, hard-coded balance numbers, float money, non-deterministic env generation,
full-terrain rebuilds, image planes faking 3D, template containing player
objects, state cleared before validation, missing validateSnapshot checks
(duplicate IDs, out-of-bounds, overlaps, seed/template mismatch), footprint or
hit-test math outside sim/footprint.ts, unrotated width/depth in picking,
ghost/preview objects not pooled or disposed, shared materials disposed by an
entity, Object3D.clear() without dispose. Measure renderer.info.memory before and
after switching tools 50 times. Fix blockers first, re-run tests, report real results only.
```
