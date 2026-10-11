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

