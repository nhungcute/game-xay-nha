# G3 gate report — Full content for City and Farm

Date: 2026-10-10 (Asia/Bangkok). Mode: auto-continue.
Implementation: the existing Claude/Codex sessions; closeout: Codex.
Source baseline for this closeout: `47fe17d`.
Runtime-only topology optimization and six regression cases: `f5ab34a` (no bot/balance change).
**Economy gate FAIL; functional report and closeout E2E complete.**
G3 is not declared fully passed: balance awaits Q010 and first-time human tutorial timing is NOT RUN.

## 1. What was built

| Area | Result | Commit |
|---|---|---|
| Maps / tooling | Authored `city-coast-01` v2 and `farm-valley-01` v2, layouts, template generation and validation, five browser camera views per map | `ee648ec` |
| Sim / content / web | Repeat quests, tutorial and Bác Tư hints; City income bubbles and collect-all with a bank; Farm crop/production UI; catalog X/Y limits; profile and net-worth breakdown | `98115d5` |
| Authored quests | Road, embankment and tilling progress reads the existing state, so completing work before a quest appears cannot permanently block that quest | `f70cd03` |
| Browser acceptance / placement | 26-check G3 browser flow; atomic auto-flatten placement beside roads | `838c5ce` |
| Repeat-quest audit | Reward/XP/reference-income validation, valid subjects and IDs, three active slots, previous-template exclusion, collected-product progress, exact one-hour collection target | `103f652` |
| Contracts | Strict base64 padding checks without re-encoding the entire byte array | `6aeece0` |
| Rendering | Scenery instancing per asset and map quadrant, fewer shadow casters | `0d1fae0` |
| Art / rendering | Natural green, earth, alluvial, sand and rock tints; display-only ground palette | `66dc010` |
| Sim performance closeout | Cached dry components / authored bank indexes, live bridge status, six parity/lifecycle regressions; no economic numbers changed | `f5ab34a` |

Catalog: 21 building definitions, 8 crops, 4 production recipes, 12 authored quests per map.
See [coordination](G3-coordination-claude.md), [decisions](../DECISIONS.md) D017–D024.

## 2. Commands and real results

| Command | Result / provenance |
|---|---|
| `npx tsx packages/tooling/sim-economy.ts --days 60 --map all --style all --out docs/reports/G3-economy-current.json` | exit 0 at `f5ab34a`; 6/6 scenarios × 60 calendar days, 876.329 s; all invariant sets PASS; pacing gate FAIL |
| `npx tsx scripts/mvp-economy-audit.ts` | exit 0; four transaction-reversal checks PASS; 14 directly earning building/producer definitions analyzed |
| `node docs/tools/economy/model.mjs --tables` | exit 0; reference tables retained in `../evidence/mvp-final/reference-tables.log`; no model parameters changed |
| `node scripts/g3-e2e.mjs` | Closeout exit 0, **26/26**, 0 errors; Chromium desktop + Pixel 7 emulation + WebKit iPhone 13 emulation; 2026-10-10 08:51 (Asia/Bangkok) |
| `pnpm check` | Baseline `47fe17d`: exit 0, 676/676 in 23 files. Topology fix `f5ab34a`: exit 0, 682/682 in 24 files; content/lint/typecheck/build PASS. Final rerun still PENDING |

Pacing uses elapsed days from the player's first session, not the calendar day number in daily summaries.
The ordinary-player target comes from docs/16 §12.1 separately for each map.
Missing milestones are UNREACHED, never a passing result or an extrapolated date.

## 3. Economy comparison (docs/10 §7)

**Pacing gate FAIL.** Source: [current run](G3-economy-current.json), [computed comparison](G3-economy-comparison.json).
Source fingerprint unchanged across all 55 files; contentVersion 1. The prior partial run is preserved in
`G3-economy-pre-topology-cache.json`; City/careful result and pacing fields match exactly before/after the topology fix.

| Map / ordinary player | Level | Target days | Actual elapsed days | Deviation | Status |
|---|---:|---:|---:|---:|---|
| City | 8 | 3.5 | 6.500 | +85.7% | FAIL |
| City | 12 | 11 | 14.688 | +33.5% | FAIL |
| City | 15 | 21 | 24.500 | +16.7% | PASS |
| City | 20 | 49 | 51.500 | +5.1% | PASS |
| Farm | 8 | 4 | 8.042 | +101.0% | FAIL |
| Farm | 12 | 12 | 30.688 | +155.7% | FAIL |
| Farm | 15 | 22 | 53.688 | +144.0% | FAIL |
| Farm | 20 | 52 | UNREACHED | — | UNREACHED |

| 60-calendar-day scenario | Final level | Commands | Wall seconds | Snapshot / wallet / occupancy |
|---|---:|---:|---:|---|
| City / careful | 20 | 7,792 | 327.26 | PASS |
| City / ordinary | 20 | 13,619 | 266.93 | PASS |
| City / relaxed | 14 | 2,694 | 47.47 | PASS |
| Farm / careful | 18 | 36,839 | 145.47 | PASS |
| Farm / ordinary | 15 | 16,441 | 70.70 | PASS |
| Farm / relaxed | 10 | 4,254 | 18.50 | PASS |

Farm ordinary/careful elapsed-time ratios: L8 **2.266×**, L12 **1.689×**, L15 **1.562×**: all ≥ 1.3 (PASS).
L20 ratio is not measurable because neither Farm style reaches it. Ordinary sessions cover 59.048611 elapsed days
from the first visit within 60 calendar days; no L20 date or deviation is extrapolated.

[Q010](../OPEN_QUESTIONS.md) distinguishes the simplified Farm model's always-available inputs and abstract land cost
from the real bot's legal growing/storage/placement policy. Those are confirmed input differences, not proof of a
sim-rule bug. It proposes reconciling model/bot first or approved model/XP recalibration via docs/16 §11.
The far-bank runtime issue and fix are documented in [observations](G3-economy-bot-observations.md).

Supplemental audit: [G3-economy-audit.json](G3-economy-audit.json).

- Ten build–cancel cycles: net-worth change $0, XP change 0.
- Ten completed build–demolish cycles: net-worth change −$3,850, XP +550; no cash/material profit.
- Buy wood/stone with a connected active market, then attempt to sell them: `NOT_FOUND`, no purchase net-worth or XP gain.
- Clear an environmental object twice: second attempt `NOT_FOUND`, no gain on retry. Clearing is a finite template resource; there is no tree-regeneration command.
- All earning buildings unlocked above L5 have a calculated best-case payback ≥ 1 hour; minimum is bank 2.686 h.
- If “after L5” includes every earlier building still available at later levels, Tạp hóa has a best-case bound of **0.901 h** (base 1.513 h), with full workforce, tier-3 roads, maximum decor and water bonus. This bound excludes the shared supporting infrastructure cost and is not a measured layout.
- The four finite reversal checks do not prove absence of all exploits, especially adversarial combinations with repeat-quest rewards. Those combinations are NOT RUN.

No economic parameter, design document 00–16, or `contentVersion` was changed.

## 4. Evidence and performance

| Measurement | Evidence / result |
|---|---|
| Five views per map | `../evidence/g3/map-shots.json`, City/Farm screenshots; updated ground images in `../evidence/g3/ground/after/` |
| Natural road/grass luminance | City 33.62%, Farm 27.26%; target ≥ 15%; blown pixels 0% |
| Draw calls after batching | City 182, Farm 200 including shadow passes; measured main views ≤ 169 calls, ≤ 190k triangles; `../evidence/g3/draw-calls/profile.json` |
| Browser flow | `../evidence/g3/e2e/g3-e2e.json` and seven JPEGs |
| Tutorial time | Original retained run 15 s; current closeout rerun **16 s**. Automated City flow only; first-time human timing NOT RUN |
| Resource stability | Retained G3 flow: 10 map switches, heap 15.6 → 16.4 MB. This is not the exact 20-switch GPU test in docs/10 §4 |

## 5. Exit criteria

| Criterion | Status | Scope / evidence |
|---|---|---|
| Full content for both maps, visually distinct | PASS | Authored v2 maps, map-specific catalogs and UI, five-view evidence |
| Tutorial completes in ≤ 6 minutes | PASS (automated); NOT RUN (human) | Historical 15 s, closeout 16 s City tutorial; no first-time human session |
| E2E flows | PASS (smoke); NOT RUN (all exact QA combinations) | Closeout G3 26/26; prior G1 bridge/far-bank sequence and G2 online/offline/recovery flows documented separately |
| Ordinary-player pacing ≤ 25% at L8/12/15/20, both maps | FAIL | Five failing, two passing, one UNREACHED milestone in the completed run |
| Farm careful player ≥ 1.3× faster | PASS (L8/12/15); NOT RUN comparison (L20) | 2.266× / 1.689× / 1.562×; L20 not reached by either style |
| No earning building payback < 1 h after L5 | PASS for newly unlocked buildings; possible FAIL for earlier Tạp hóa | Calculated maximum-rate bound above; scope needs to be explicit |
| No infinite profit in stated transaction reversals | PASS (four checked classes); NOT RUN (all quest combinations) | Real sim fixture commands and existing regression tests |
| Full check | PASS | 682/682, exit 0 after `f5ab34a`; final closeout repeat PENDING |

## 6. Deviations, open questions and NOT verified

- D017/D024 repeat quest sizing, D018 paid road valuation and authored bank regions, D019 shoreline QA correction, D020 retained accrued money. No new balance decision was made.
- Q009 remains open: reuse the only eligible repeat template, or leave the slot empty.
- Real-device performance on Iris Xe / Snapdragon 7 / iPhone 12 and the full-world stress scenario: NOT RUN.
- No first-time human tutorial test; browser emulation FPS is not a phone measurement.
- Some docs/10 long-loop GPU and exact gesture combinations are covered only by earlier evidence or have not been run exactly as specified. A green smoke suite does not certify every QA checklist item.
- The economy bot and its six unit cases are still another agent's untracked files. They were used without editing or staging them, per product-owner instruction. This report is reproducible in this shared workspace; a clean clone cannot run that bot until its owner commits it. Clean-clone Docker deployment does not require the bot.
- All 74 assets remain procedural placeholders; [complete inventory](MVP-placeholder-assets.md).

## 7. Next gate / closeout

Q010 is recorded; do not change balance without its decision. Complete [G4 report](G4-report.md)
and the MVP summary, run final checks and local production smoke. The product owner starts any tunnel.
