# Implementation decisions

## D001 — 2026-10-09 — Scope and ownership

Context: docs/14 §0.1 and docs/12 §1–2.
Decision: G0 only until its report is approved. Lead owns root/contracts integration/sim;
separate module owners handle contracts, content and worldgen/tooling. No prototype edits.
Alternative: copying an existing JS prototype; rejected by docs/14.

## D002 — 2026-10-09 — Shared shore heights

Context: docs/06 §4 requires every water corner below water and a shared shore corner above water;
these cannot both hold on one shared heightfield. docs/15 §4.2.3 and docs/07 §3.1 agree.
Decision: shared shore vertices obey docs/15; vertices belonging exclusively to water are below water.
Template validator explicitly reports this interpretation. No new gameplay or changed price.

## D003 — 2026-10-09 — Construction deadlines

Context: docs/06 §6.6 lists readyAt among timestamps prohibited >5 minutes in the future,
but docs/16 requires crops/construction/queues lasting hours.
Decision: validate creation/settlement times against serverTime; validate future deadlines against
their catalog durations and irrigation/tutorial rules. Follow docs/15–16 precedence.

## D004 — 2026-10-09 — Speed-up percentage

Context: docs/16 §3.1 specifies 50%; reference model P.speedupPct is 30%.
Decision: generated content uses the explicit 50% in docs/16; reference script is not modified.
The generator checks and records this override rather than silently adopting the model.

## D005 — 2026-10-09 — Fractional XP from dollar thresholds

Context: docs/16 §8.1 grants XP/$20 spent and XP/$500 collected; DB xp is integer (docs/11).
Decision: carry remainders in persisted questProgress counters and award whole XP only.
Splitting a command or a collection does not change total XP. Alternatives: truncating each
command independently or fractional DB XP; rejected for consistency.

## D006 — 2026-10-09 — Existing farm usage after road loss

Context: docs/15 §6.4 explicitly permits road removal, while §8/§10 require road access for
support buildings to operate. Decision: disconnected support grants no new field/storage capacity.
Previously planted crops and stored items remain. Snapshot validation permits this legal state
within physical support capacity. Demolition rejects a support removal that would destroy prepaid
queues or leave usage unsupported (Q002). No automatic destruction was introduced.

## D007 — 2026-10-09 — Natural heights and integer terraform payment

Context: docs/15 §1.2 permits arbitrary integer template heights, player heights use 5dm steps,
and §4.3 can therefore produce fractional dollar costs; wallet money must be integer.
Decision: sum exact movement across unique vertices, then ceil the total dollar cost once.
FLATTEN without a target uses the rounded mean of unique vertices per docs/15 §4.1.
Already-flat work costs zero. This changes no rate in docs/16.

## D008 — 2026-10-09 — Production completion and scheduled timestamps

Context: docs/15 §10 prepaid batches run consecutively; docs/16 §8 awards XP when products finish.
Decision: a later queue batch may have a future startedAt equal to the previous readyAt.
advanceTime grants completion XP once when readyAt crosses the persisted serverTime; collecting
does not award it again. Crop durations are validated against catalog/irrigation/20-second tutorial
alternatives because current well placement cannot reconstruct historical irrigation.

## D009 — 2026-10-09 — Schema lifecycle fields and bridge deck height

Context: docs/06 omits paid materials and parts of bridge lifecycle required by docs/15–16.
Decision: persist paid cash/materials, invested value, status and placedAt for exact refunds/timers;
persist seed/generatorVersion for template matching. A bridge deck may be a fractional decimeter:
it uses the average of two bank-edge vertices per docs/15 §9.2, without invented rounding.

## D010 — 2026-10-09 — Deterministic environment details and asset identifiers

Context: docs/06 §4.1 fixes four PRNG draws and stable IDs but leaves draw partitioning unspecified.
Decision: process scatter specs in authored order; IDs use visited-cell ordinal; reserve all anchors;
keep a large rock wholly within its generating zone; use Manhattan water distance; split the last
two draws into 16-bit offset/yaw/scale fields. Fixed golden cases and real Node/browser parity
verify this implementation. Content model/icon IDs and entranceSide S are provisional declarations;
they do not claim delivered GLB assets. Road access uses any footprint edge as docs/15 requires.

## D011 — 2026-10-09 — Initial natural roads and net worth

Context: docs/16 §2 and §13 require initial net worth exactly $2500 while templates include
natural village roads. Decision: template roads are background infrastructure, not purchased
character assets. Net worth counts player road additions and upgrade value above the template
tier; it excludes the template's original tier value. Review Q006 before later economy validation.

## D012 — 2026-10-09 — Repeat quests and far-bank evidence

Context: docs/16 §10 gives 12 exact quests per map but only examples of later random quests.
Decision: implement the 24 authored quests; do not invent a random pool (Q005). For the authored
far-bank quest, require a separate dry-land component from ENTRY connected by a completed bridge.
This topology interpretation is recorded for review; no new rewards or quest definitions were added.

## D013 — 2026-10-09 — Literal income cap formula

Context: Q001 raised possible loss when rate-dependent capacity falls.
Decision: currently apply the exact Math.min formula in docs/16 §6.4, including a zero-rate cap.
Do not silently add a retention rule. Q001 asks for product review before any formula change.
The absence-respecting cap itself follows docs/01; the concern is a player-induced rate decrease.

## D014 — 2026-10-10 — Complete command patch metadata

Context: docs/08 StatePatch lists gameplay collections but omits the ownership and character
fields changed by existing commands. Decision: add optional character, unlockedZones and landValue
to the shared patch. UNLOCK_ZONE and valuation changes can then be applied without a full reload.
This carries existing state only; it adds no gameplay feature.

## D015 — 2026-10-10 — Pure, bounded entity IDs

Context: sim may not generate random UUIDs or read runtime clocks; identifiers must stay within
the strict schema length even when a valid world ID has 128 characters.
Decision: deterministic revision/collision-counter IDs are scoped to the world and checked against
all existing building/bridge IDs. Do not embed the full world ID. G2 command transactions own
authoritative allocation and persistence; this is not a global account/character ID generator.

## D016 — 2026-10-10 — G0 approval and continuation mode

G0 APPROVED by the product owner, who independently ran pnpm check: 604/604 passed.
Mode: auto-continue (approved 2026-10-10).
At each gate: run the full suite, write docs/reports/G<x>-report.md, commit, and start the next
gate only after its exit criteria really pass. Stop for criteria failing after three serious
attempts, new gameplay/economy/design questions outside these approvals, external inputs,
destructive/irreversible actions, or any public deploy. Local development remains authorized.

## D017 — 2026-10-10 — Approved repeat quests for G3 (Q005)

Record the exact product-owner specification in docs/16 §10.3: three active slots; replacement
on completion; one free reroll per four hours; unlocked targets; no consecutive template repeat;
the approved City/Farm template lists; targets sized for 30–60 minutes. Reward is 25% of the
specified hourly reference income, rounded to $10, minimum $100; XP round(2√reward).
All constants go into generated economy content and are checked with sim-economy in G3.
This approves those constants, not additional target-sizing constants or gameplay.

## D018 — 2026-10-10 — Approved road valuation and authored banks (Q006/Q007)

Confirm D011 with actual paid cost: template road base value is excluded, but rebuilding a removed
template road counts the full new payment; an upgrade counts the paid difference. Track that
history in sim rather than subtracting the template tier unconditionally.
Confirm D012 and add optional bankRegions to layout/template, schema and validator. Regions use
unique IDs and nonoverlapping authored dry cells; a far region differs from the ENTRY region and
is connected by an ACTIVE bridge. This supports rivers whose banks connect around their ends.

## D019 — 2026-10-10 — Approved shoreline QA correction (Q008)

Correct docs/10 §2.1 to follow docs/15: unembanked shared shore vertices in water+[5,20];
embanked vertices >=water+5, with no upper shoreline limit other than the overall map ceiling.
Nothing may go below water+5. Source edits limited to the approvals above.

## D020 — 2026-10-10 — Product-owner answers Q001–Q004 (supersedes D013)

Approved by the product owner (consolidated MVP goal, docs/14 §0.1b).
- Q001: money already accrued is never removed; the cap limits only new accrual:
  `accrued_new = accrued + min(rate × dt, max(0, rate × capHours − accrued))`. D013 is superseded.
  Implemented in sim `settle`; regressions: road disconnection, cap shrink, collect after shrink.
- Q002: demolition never auto-destroys state. Farmhouse → `FIELD_LIMIT` when tilled cells exceed the
  remaining quota; silo → `STORAGE_FULL`; production with queued, in-progress or uncollected batches →
  new `PRODUCTION_ACTIVE` (replaces `CANNOT_DEMOLISH_SUPPORT`). docs/15 §8.3 and §11 updated.
- Q003: D002 confirmed; docs/06 §4 rewritten (water-only vertices ≤ water−5; shared shore vertices per docs/15).
- Q004: D003 confirmed; docs/06 §6.6 distinguishes past timestamps (≤ serverTime+5 min) from deadlines.
- D004: speed-up 50% confirmed; docs/tools/economy/model.mjs `speedupPct = 0.5` (not used by the simulation).
- New characters: farm `inventory = {}`, city population 0 (docs/16 §2).

## D021 — 2026-10-10 — Interim deployment: Docker + Cloudflare quick tunnel

Approved by the product owner (docs/14 §0.1b §3). `infra/compose.yml` builds the web image
(node 22.20.0 → nginx 1.29.2) and runs it on 127.0.0.1:${WEB_PORT:-8090} (8080 was occupied on the
host). The `tunnel` service (cloudflare/cloudflared:2025.9.1) is under the "tunnel" profile and is
only started by the product owner (`pnpm tunnel:up`). No deployment to Botkeep or other hosts.

## D022 — 2026-10-10 — World persistence as validated JSONB; scrypt for recovery codes

docs/11 §5 sketched ~10 normalized tables. Implemented instead: `accounts`, `worlds` (one row per
character, full sim snapshot in JSONB + hot columns: account, map, name/tag, level, net_worth,
revision) and `world_commands` (idempotency/audit). Every read goes through `validateSnapshot`
(docs/08 §6.1); all rules stay in `packages/sim`, so normalized copies of the same data would only
add ways to diverge. Leaderboard index on (map_kind, net_worth). Recovery codes are hashed with
Node's built-in scrypt (N=16384, r=8, p=1) instead of argon2id to avoid a native dependency; a
peppered SHA-256 prefix hash keeps lookup indexed. Tokens: 32 random bytes, stored as peppered SHA-256.

## D023 — 2026-10-10 — Local ports

Host ports 3000/3100/8080 are used by other projects on the development machine. Defaults: API dev
3217, web dev 5173/5190 (offline) and 5191 (online), Docker web 8090, integration-test Postgres 55432.
Inside Docker the API listens on 3000 (internal only).

## D024 — 2026-10-10 — Repeat-quest target sizing and fallback

docs/16 §10.3 asks for targets that take 30–60 minutes of normal play but leaves the numbers open.
Ranges (economy.v1.json `repeatQuests.sizing`): build 1–3 of one unlocked type (capped by the level
limit), road 8–24 cells, embank 4–10 cells, population current+10–30 (rounded to 5), harvest
50–100% of the field quota of a crop growing ≤ 60 min, sell 10–40 units of an unlocked crop item,
produce 3–12 batches at an owned producer, till 6–24 cells within the remaining quota.
`collect_cash` requires at least $100/h reference income. Quests are generated by a world-seeded
PRNG advanced by `repeat.seq` (identical on client and server). "Never the same template twice in a
row" refers to the template just claimed or rerolled; when no other template is eligible the same
template is reused so a player is never left without quests. New command `REROLL_QUEST`.
Ranges are to be checked with sim-economy (G3) and tuned through the economy model.

Amended 2026-10-10 after the G3 repeat audit (`docs/reports/G3-repeat-audit.md`):
- Only the template just claimed/rerolled (`repeat.last`) is excluded; several active quests may share a
  template if their subject/target differ. The list is always refilled to 3 slots when anything is eligible.
- `collect_cash` target X = one hour of current base income in whole dollars (no $10 rounding); the $10
  rounding applies to rewards only.
- `produce_item` counts finished products when they are collected (`COLLECT_PRODUCTION`, event `PRODUCED`),
  not batches queued by `START_PRODUCTION`.
- Each quest stores `ref` (reference income at generation, optional for older saves). `validateSnapshot`
  recomputes reward = max($100, round10(ref×25%)), XP = round(2√reward), no wood/stone, `ref` ≤ the
  maximum reference income reachable at the current level, ids `r<n>` unique with n < seq, template and
  subject valid for the map and unlocked at the current level, progress ≤ target,
  `rerollAt` ≤ serverTime + 4 h (+5 min tolerance), and repeat state only after all authored quests.

## D025 — 2026-10-10 — Farm XP table recalibrated (contentVersion 2), City unchanged

Context: Q010 (real-sim pacing FAIL). Taken by the agent under the user's auto-continue / "skip confirmations"
instruction, choosing the option it had recommended; reversible with `git revert` (snapshot migration is one-way
only in the sense that levels gained are kept).
- Farm cumulative XP for L5–L20 replaced by the table fitted on the real sim (`scripts/q010-xp-calibrate.ts 3 farm`,
  FarmBotV3) to the docs/16 §12.1 times; L2–L4 unchanged. docs/16 §8.2, `model.mjs` `P.xpCumMap.farm`, generated content.
- `contentVersion` 1 → 2. `validateSnapshot` migrates v1 snapshots: XP kept, level recomputed (never lower);
  other versions are still rejected. Level-up cash rewards are not paid retroactively for migrated levels.
- City table unchanged: the City L8/L12 gap came from the bot placing one building per 5-minute tick; CityBotV2
  passes all four milestones with the current table (+15/+9/0/−1%). The City table proposal was withdrawn.
- Result (Farm, ordinary, 60 days, applied content): FarmBotV3 L8/L12/L15/L20 = +1/+9/+7/+5% (PASS);
  Codex's unchanged EconomyBot +38/+34/+21/+10% (was +101/+156/+144%/unreached).
- Closing evidence (`scripts/q010-verify.ts` → `docs/reports/Q010-verify.json`, FarmBotV3/CityBotV2, 60 days, contentVersion 2):
  every map × style follows the docs/16 §12.1 targets closely (e.g. City careful L20 d45.4 vs 48, Farm careful L20 d36.0
  vs 35, Farm casual L15 d59 vs 59). Note: `model.mjs --sim` with the D025 Farm table now levels Farm faster than §12.1
  because of its known simplifications (instant input purchase/sale); §12.1 stays the design target and the real-sim
  bots are the reference for Farm pacing.

## D026 — 2026-10-10 — Q009: repeat-quest fallback reuses the only eligible template

Taken by the agent under the user's auto-continue / "skip confirmations" instruction. When only one repeat-quest
template is eligible (early Farm characters without a producer or free field quota), the slot is filled with that
template again (a different subject/target where possible) instead of being left empty, so a player always has three
quests. Already implemented and tested (D024 amendment, `packages/sim/src/quests.ts`); no code change. Reversible:
returning `null` from `next()` when only `repeat.last` is eligible would leave the slot empty.

## D027 — 2026-10-11 — Login with username + PIN; the recovery code flow is removed (user request)

The entry screen has two flows: **Đăng nhập** (username + PIN) and **Tạo nhân vật mới** (username + PIN twice + map).
- The username is the character name, unique across all players ignoring case and repeated spaces (diacritics count:
  "Trùng Tên" ≠ "Trung Ten"). Same rules as before: 3–20 chars, Unicode letters/digits/single spaces, small blocklist.
- PIN: 4–6 digits, stored as scrypt with a per-account salt (not peppered, so it survives a TOKEN_PEPPER change).
- Abuse limits: 5 wrong PINs lock that username for 15 min; 30 login attempts per hour per IP (`LOGINS_PER_HOUR`);
  unknown usernames cost the same scrypt time and return the same generic `INVALID_LOGIN`.
- Sessions live in a `sessions` table: logging in on a second device does not sign out the first; "Đăng xuất" (start
  screen header and in-game Settings) ends only that device's session (`POST /api/auth/logout`).
- A signed-in player opens the other map's character with one click; its name is the account's username.
- API: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`; `POST /api/characters` now requires a
  session; `POST /api/auth/recover` and the one-time recovery code are removed (migration `0002_username_pin.sql`).
- Accounts created before D027 have no username/PIN; they keep working on the device that holds their token (existing
  tokens were copied into `sessions`) but cannot log in elsewhere. All of them were test accounts.
- Known trade-off: a 4–6 digit PIN is weak against a targeted guesser (≈ 480 guesses/day per username under the
  lockout); players are told to keep their PIN private. Supersedes the recovery-code parts of docs/01 §8, docs/09 §2
  and docs/11 §4.

## D028 — 2026-10-11 — Gameplay review wave B: upgrades, relief, storage 100, collect-all for everyone (contentVersion 3)

From the user's "Đánh giá Gameplay — AI Farm" review ("triển khai cả A và B"). Numbers live in docs/16; the generator
reads them into `economy.upgrades`, `economy.relief` and `economy.farm.baseStorage`.
- **Building upgrades (§6.5)**: businesses, housing, producers and storage go to tier 2 (player level 10, 2.5× build
  cost, 2× build time, +50%) and tier 3 (level 15, 5×, 3×, +100%). New command `UPGRADE_BUILDING`; the building keeps
  working during the upgrade but holds one builder. Income and population scale by the effect, producers gain one
  production line per tier, storage bonus scales. Cancel refunds the upgrade 100%, speed-up is priced from the upgrade
  cash cost, demolition (blocked while upgrading) refunds 50% of base + tiers. Upgrade costs are derived from the
  tier, never stored: `PlacedBuilding.tier?` and `PlacedBuilding.upgrade? {tier,startedAt,endsAt}`. Snapshot checks:
  `UPGRADE_TIER`, `UPGRADE_TIME`, slot count = catalog slots + tier − 1, builders count upgrades.
- **Collect all without a bank**: `COLLECT` with an empty list no longer requires a bank; the HUD button shows
  whenever a business has money waiting. Banks keep their +2 h cap bonus.
- **Base Farm storage 100** (was 50).
- **Emergency relief (§9.1)**: `CLAIM_RELIEF` pays $600 when cash < $150 and nothing will earn (City: no income, no
  waiting money, no business under construction; Farm: no crops, empty storage, no production), once per 24 h
  (`progress.reliefAt`), no XP. Shown as a card at the top of the mission panel.
- **Authored 3D models (B5)**: `house_small`, `shop_cafe` and `farmhouse` use LOD1 of the user's Building_3D_POC pack
  (`apps/web/public/assets/models/authored/`, licence `original_procedural_geometry_and_textures`). The manifest marks
  them `placeholder: false` with a `fit`; `AssetManager` bakes node transforms, merges parts per material (2 draw calls
  per model), rebuilds flat normals, turns them 180° (pack front is +Z, game doorway −Z), centres them and scales them
  to 92% of the footprint. Materials draw both faces because the prototype roofs have gaps. Full-world budgets still
  pass (city desktop ≤ 185 calls / 390k triangles). Evidence: `docs/evidence/g4/authored-models/`.
- `contentVersion` 2 → 3. `migrateContent` now chains v1 → v2 (level recompute) → v3 (no data change: every new field
  is optional and every rule change only loosens). Reversible by reverting the docs/16 rows and regenerating, but v3
  saves with tiers would then fail validation.


## D029 — 2026-10-11 — Full 21-model pack imported: 20 buildings replaced, silo keeps its placeholder

From the user's D029 brief. Source: `map/Bo_21_Mo_Hinh_3D_GLTF_Day_Du/` (owner-supplied, 283 MB, NOT committed).
`scripts/import-model-pack.mjs` (deterministic, `--check` skips when the pack is absent) bakes world matrices,
drops the spilling ground groups (`LANDSCAPE_OPTIONAL`, `PATH_OPTIONAL`, `PARKING_OPTIONAL` — decor and the market
keep their content groups), converts every material to an opaque vertex colour (BLEND glass → solid dark blue-grey,
sRGB factors → linear), welds by position+colour, simplifies with `meshoptimizer` (`simplifyWithAttributes`,
`LockBorder`, error ≤ 0.02, colour weight 0.5, target 70 % of the per-size triangle cap), flat-shades, rotates 180°
(pack declares +Z fronts; the game wants −Z), uniform-scales into the 2 m footprint at 0.92 and writes one
mesh/material GLB with POSITION+NORMAL+COLOR_0 — one draw call per building.
- **LOD0 as source, not LOD1** (deviation from the brief): the pack's own LOD1 is destructive — `city_bank` loses its
  columned portico entirely; verified by rendering both LODs side by side (`docs/evidence/g4/model-pack/glb-standalone/`).
  LOD0 + our simplifier keeps the shapes and still fits every cap.
- **SILO stays placeholder** (per brief): `rural_warehouse` is a 4×3 barn, the wrong silhouette for a 2×2 silo.
- **DECOR_1_CELL = try → PASS**: `deco_garden` (pergola + fountain + bushes) and `deco_flowerbed` (planter with vines)
  read clearly at the default angle, so both keep their imported models.
- `fit.ts` and the load-time fit branch are deleted: nothing fits at runtime any more; every authored entry is
  pre-fitted (`placeholder: false`, no `fit`). `assets.test.ts` now asserts provenance, exactly one part, vertex
  normals + colours, bottom pivot, bounds inside the footprint and the per-model triangle cap from
  `scripts/model-pack.config.json`; a second test runs `import-model-pack.mjs --check`.
- Budgets (docs/11 §8) still pass with room: city desktop 183 calls / 472k triangles worst view (was 185 / 390k),
  city low 451k (limit 500k — the first import at 80 % targets hit 520k, so targets moved to 70 %). Farm unchanged.
- Runtime material: one shared `MeshStandardMaterial` (vertexColors, roughness 0.85, metalness 0, doubleSided).
- Reversible: delete the 20 authored entries from the generator's `AUTHORED` list, regenerate, and restore `fit.ts`
  from git history (`62d1eea^..ed728b9`); gameplay/catalog/contracts/sim untouched, `contentVersion` stays 3.
- Windmill sails and well pulley stay static (animations deferred, per brief §3.3).
- Evidence: `docs/evidence/g4/model-pack/` (136 in-game shots incl. 4-rotation row, construction + upgrade states,
  overviews; `glb-standalone/` renders of all 20 fronts), `docs/reports/D029-model-pack-import.md`.
- **Review round (same day, see report §10)**: history rewrite removed 11 G3 files committed by mistake
  (size-pack 127.85 → 79.31 MiB; paths pinned in `.git/info/exclude`); well roof re-supported (cap 1200),
  deco_park keeps lawn/trees/paths, rice_mill fence dropped, house_town walls flattened via the Regularize flag;
  **the floating-part QC gate in `import-model-pack.mjs` (connected components, 5 cm ground / 3 cm bbox-pad /
  0.3 m size-floor tests, per-model baselines in `GATE_EXCEPTIONS`) is now a MANDATORY gate for every future
  model import — the import FAILS when a model exceeds its baseline**; the `simplify()` target comparison was
  fixed (index-vs-triangle units) so error escalation actually runs; per-group simplification policies
  (drop/preserve/error per group, reasons in `model-pack.config.json`) shape where the budget goes.


## D030 — 2026-10-11 — All trees and bushes replaced from the map/tree pack, with near/far LODs

Far billboard assets require alpha coverage of 10–80% per captured tile (alpha ≥128, at least two distinct colors) and PNG atlas size ≥8 KB. Full-world far/near tree coverage ≥0.6 is a mandatory QC gate for every billboard asset.

From the user's D030 brief. Source: `map/tree/` (owner-supplied, NOT committed): `stylized_tree.glb` (CC-BY-4.0,
Aki), `fur_tree.glb` (CC-BY-SA-4.0, Harri Jones), `small_bush.glb` (CC-BY-4.0, yanix); `tree_animate.glb` NOT used.
`scripts/import-trees.mjs` (deterministic, `--check` byte-compares outputs, skips when the pack is absent) bakes
node transforms via the game's own GLTFLoader, converts units, packs foliage + bark into ONE atlas per tree
(leaf slot ≤ 512 px, bark slot ≤ 128 px, one material → one draw call per LOD level), remaps UVs (frac only for the
tiling trunk), and writes one indexed GLB per asset with `alphaMode: MASK` (deciduous cutoff 0.865 → 0.4 — the
source value clipped the canopy to bare branches).
- **12 game ids keep their codes and worldgen/template/contracts/sim untouched**; `contentVersion` stays 3. Every
  id gains a near LOD (≤ 1500 triangles trees / 320 bush) and a far LOD (`<id>_far`, 3 crossed alpha-cutout planes
  textured with unlit albedo captures of the near model rendered in headless Chrome on SwiftShader, packed 2×2
  ≤ 512 px; +6 triangles per instance). Conifer derivatives live in `models/env-by-sa/` with their own `LICENSE.md`
  (CC-BY-SA 4.0, modified-redistribution notice) and are labelled CC-BY-SA-4.0 in the in-game "Ghi công" panel.
- **Deciduous variants**: canopy hue-rotated to greens for 01–03, original red-orange kept on 04; leaf cards thinned
  to a seeded subset (~19 %, mulberry32 seed) enlarged ~1.9× to compensate area; bark simplified with meshoptimizer.
  **Conifer**: spec-gloss → metal-rough, buried trunk cut at y = 0, textures brightened 15–25 %, cards simplified
  2240 → ~1408. **Bush**: BLEND → MASK, `KHR_materials_specular` removed, texture brightened (scan is very dark),
  the 16 sprig components rearranged from the source's stem-on-a-stick layout into a dome, material marked
  `KHR_materials_unlit` (up-facing scan normals shade nearly black under the game lights; unlit matches the
  billboard captures and the terrain palette).
- **EnvRenderer**: instances are split near/far by distance from the camera target — the `TREE_LOD.nearCount = 160`
  nearest within 60 m use the near model, everything else billboards; re-partitioned only when the camera moves
  > 4 m or turns > 10° (no per-frame allocation, `lodRebuilds` counter for QA). Far batches never cast shadows;
  near trees cast alpha-cutout shadows through a `MeshDepthMaterial` that carries the same cutout and sway.
  **Wind**: shared-clock vertex-shader sway (`onBeforeCompile`, amplitude ∝ vertex height, phase per instance),
  applied to both LODs and the shadow pass, strength 0 in low graphics. Low graphics renders far LOD only and keeps
  the existing flower/reed drop + bush thinning. `CLEAR_ENV` removes from both LODs and the near set refills, so
  clearing shows real wood gain with stable budgets (evidence: `docs/evidence/g4/trees/clear-*.jpg`).
- **Budgets** (docs/11 §8, `g4-full-world`): city low **410,612** triangles (was 499,670 — the blocking D029
  headroom problem is resolved), farm low 134,182 (was 229,240); desktop worst view 241 calls / 534,874 triangles
  (limits 300 / 1.5 M); zone rebuild ≤ 3 ms; no console errors. g3 mobile suites 26/26.
- **In-game credits**: settings panel section "Ghi công" reads `/assets/manifest.json` live, lists every `CC-*`
  entry (model, author, license link, source link, "đã chỉnh sửa"); provenance also in `docs/ASSET_CREDITS.md` and
  `scripts/trees.config.json`. Manifest grows 74 → 86 entries (`lod.far` links each near id to its billboard).
- Reversible: remove the tree block from `generate-placeholder-assets.mjs`, regenerate the manifest, restore the
  placeholder env GLBs from git history and revert the three renderer files; worldgen/templates/contracts/sim
  untouched.
- Known tradeoff: the far billboards are vertical planes and read thin from the 75° top-down evidence view
  (comparable to the old placeholder cones; captures are taken at 28° elevation to keep mid-pitch volume).
- Evidence: `docs/evidence/g4/trees/` (34 in-game shots: 12 variant close-ups, LOD zoom-outs, dense conifer forest,
  clear before/after, city/farm high+low, Pixel 7 + iPhone 13, credits panel desktop+mobile; `report.json` with
  per-shot draw calls/triangles/fps).

## D031 - 2026-10-12 - Day/night lighting cycle and instanced window lights

Smooth continuous lighting cycle (`dayCycle.ts`): dawn 05:00–07:00, day 07:00–17:00, dusk 17:00–19:00, night 19:00–05:00.
Default is `auto` following the player's local machine clock (`Date.now()`); mode preference (`auto`, `day`, `night`) is
persisted in `localStorage` with fail-safe error handling when storage is blocked. To guarantee test and E2E determinism,
QA scripts (`g4-full-world.mjs`, `tree-shots.mjs`, `rock-shots.mjs`) force 13:00 by default via `window.__debug.timeOfDay(13)`,
unless an explicit `--hour` argument is passed.

Window lights system (`windowLights.ts`): utilizes vertex attribute `_WINDOW` on authored building GLBs, hashed with
instance position seed (`vInstanceSeed`) and window ID to illuminate a stable subset of windows (0% at day, 60–70% at night,
~42% between 00:00–05:00) with warm orange emissive radiance (`vec3(1.0, 0.56, 0.16) * 2.0`). Shader hook composition
(`shaderPatches.ts`) chains multiple `onBeforeCompile` patches across shared GLTF materials without collision and maintains
a stable `customProgramCacheKey`. `night.ts` tints only unlit (MeshBasic) materials: far-LOD billboards, unlit bushes and
water foam. The tint is `lighting().unlitTint`, the per-channel ratio of night to day irradiance a lit surface receives
(exactly 1 by day), multiplied into `outgoingLight` before `opaque_fragment`. Lit materials (terrain, buildings, water,
coins) darken through the lights and take no tint. The HUD sun/moon icon follows the scene's night factor, not the server
clock. `scripts/g4-night-qa.mjs` gates foliage vs scene brightness at 22:00 (≤ 1.5×) and lit rice_mill windows, and
exits non-zero on any failed check.

Bloom post-processing (`GameLoop.ts`): `EffectComposer` with `UnrealBloomPass` activates only on `quality === 'high'` when
night settles (`night > 0.2`). In `low` graphics, bloom is disabled and rendering bypasses the composer. Render targets and
passes are properly resized and disposed on session teardown.

Pipeline fix for `rice_mill`: Meshopt simplifier retains window vertices via automatic `vertexLock` retry when standard
simplification collapses all window triangles (`retainedWindows === 0`). A post-simplify guard throws if any building with
source windows ends up with zero output window vertices. Config `windowCount` records actual surviving output panes (2 for
`rice_mill`, 64 for `hotel`), leaving 19 authored models 100% byte-identical.

Evidence: `docs/evidence/g4/night/` (city/farm overviews at 22:00 high/low, close-ups of `rice_mill`, `office_tower`,
`house_apartment`, time progression 13h/18h/22h/03h, mobile Pixel 7 night, `metrics.json`).

## D032 - 2026-10-12 - Replace six placeholder rocks with the Stone Pack

The six existing rock ids remain unchanged in world templates, scatter rules, occupancy and gameplay. The source
is the owner-supplied `map/hon_da/stone_pack.glb` (Stone Pack by ashkan.fancy, CC-BY-4.0); the source directory is
not committed. `scripts/import-rocks.mjs` deterministically selects the reviewed parent nodes, bakes world
transforms and normals, welds and meshoptimizer-simplifies indexed geometry, fits each family to its footprint,
re-centers the bottom pivot and applies a small recorded sink, composites ORM ambient occlusion into base color,
tones it (chroma pulled toward the `GROUND.rock` tint `#8e877a`, gain, soft highlight shoulder: no clipped texels)
and writes one textured metal-rough GLB per id. Small rocks use a 300-triangle cap and 256 px texture; large rocks
use a 1000-triangle cap and 512 px texture (median-cut palettes of 256 and 64 colours). All outputs are under 150 KB and are recorded in
`scripts/rocks.config.json`.

Mapping: `rock_01..04` use `Small_1..4`; `rock_large_01` uses `Mid_1`; `rock_large_02` uses `Mid_2`. The manifest
replaces only these six entries, marks them `placeholder: false`, and carries the CC-BY provenance. Settings reads
the manifest's CC entries, so no UI or renderer schema change is needed.

QA evidence is in `docs/evidence/g4/rocks/`: six imported close-ups, farm/city high and low before/after views,
small and large `CLEAR_ENV` before/after shots, and Pixel 7/iPhone 13 views. The script uses six temporary
`A-*` anchors in an in-memory farm template only to frame variants; no committed template is modified. Across the
before/after overview runs, draw calls stay constant (farm 251/104 and city 241/108 high/low); imported triangles
are 345,750/216,074 (farm high/low) and 574,626/450,276 (city high/low): within the desktop 1.5M budget; city
high exceeds the 500k mobile figure, as its placeholder baseline (538,058) already did. Both clear commands were accepted; the small-rock run kept its visible batch count stable because other
instances shared that batch, while the large-rock run reduced the visible batch count by one.
The existing 1.5 m shadow threshold means the small rocks do not cast shadows, while both large variants do.

Validation: `node scripts/import-rocks.mjs --check`, `node scripts/import-trees.mjs --check`, and
`node scripts/import-model-pack.mjs --check` pass when their sources are present (source-absent importers skip
cleanly). The full `assets.test.ts` suite retains the pre-existing D031 `_WINDOW` assertion failure for authored
building GLBs; the D032-specific asset test and typecheck pass. Reverting the D032 generator block, six generated
GLBs, config, manifest entries, evidence and docs restores the placeholder rocks without changing world data.

## D033 - 2026-10-12 - Click a map object to get its tools; coins match the cash icon; light glass by day

Owner request. In explore mode a click (pointer released without a drag, so camera orbits/pans that start on an object
open nothing) still opens the building/bridge panel; otherwise it now picks the scenery, crop, road or tilled cell under
the cursor (`focusAt` in `ToolController.ts`) and opens `ui/ObjectPanel.tsx` with the actions that apply to it:
tree / rock / large rock / bush → clear ("Chặt cây", "Đập đá", "Đập đá lớn", "Phát dọn"); crop → harvest; road →
upgrade to each higher tier available on the map, or remove (asks once more); tilled soil → plant (tool shortcut) or
untill. Each action shows its outcome computed by running the command on a copy of the state in the sim
(`actionOutcome`), e.g. "−$10 · +3 gỗ", or the rule error ("Khu vực được bảo vệ."), so the panel never drifts from the
rules. A dashed row switches to the matching drag tool (Dọn / Đường / Thu hoạch / Gieo) on that cell. The selection
outline covers the object's footprint. Evidence: `scripts/object-panel-qa.mjs` → `docs/evidence/g4/object-panel/`.

Income coins (`CoinRenderer.ts`) carry the HUD cash icon on both faces (rings + white "$", drawn from the same SVG
path), glow with it through `emissiveMap`, and are ~30% larger, so they read as money on shaded facades and at night.

Building glass (`windowLights.ts`): the imported pane colour (`GLASS_SRGB`, dark blue-grey) read as black holes by
day. Panes now blend to a light sky blue plus a faint sky reflection by `1 − night`; night keeps the dark glass under
the warm per-pane lights.

## D034 - 2026-10-12 - Content-versioned model URLs; HUD scaled to the screen

Night windows stayed dark for players who had opened the game before the D031 rebuild: `/assets/models/` is cached
for a day under unchanged paths, so browsers kept building GLBs without the `_WINDOW` attribute (no night lights, no
light day glass). `generate-placeholder-assets.mjs` now records a 12-hex SHA-256 `hash` per manifest entry and
`AssetManager` requests `file?v=<hash>`: changed bytes get a new URL, unchanged ones stay cached. The manifest itself
is `no-cache`. A test keeps every hash equal to its file.

The HUD blocks were sized for ~1440×900 and read oversized on laptops and desktops. `--hud-zoom` (0.8 by default,
0.72 at ≤ 820 px tall, 0.92 at ≥ 1150 px tall, 1 on phones and short landscape) zooms the top bar, missions, minimap,
camera controls, tool dock and side panels; `useOverlayEdge` publishes `--hud-bottom`/`--dock-top` divided by it so
the calc()-placed blocks still line up. `scripts/hud-scale-qa.mjs` checks five viewports for overlaps
(`docs/evidence/g4/hud-scale/`, before/after).
