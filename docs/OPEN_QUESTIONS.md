# Open questions for product owner

Questions do not authorize new gameplay or changes to docs/00–16.

## Q001 — Accrued money after capacity/rate decreases — RESOLVED (D020)

docs/16 §6.4 clamps previously earned money to the new rate-dependent cap, which can delete
money after road disconnection. Current code follows that exact formula (D013). Confirm whether
this behavior is intended; retention would require an approved design change, not silent tuning.

## Q002 — Farm support demolition — RESOLVED (D020)

docs/15 does not say what happens if farmhouse/silo demolition lowers quota/storage below current
usage or a production building contains prepaid queues. A conservative reject policy will be
documented rather than inventing automatic crop/product destruction. Product review at gate.

## Q003 — Template shore constraint — RESOLVED (D020)

docs/06 §4 is contradictory for shared shore vertices. D002 follows higher-priority docs/15 and
the existing rasterization procedure docs/07; please confirm this reading at gate review.

## Q004 — Future deadlines and speed-up discrepancy — RESOLVED (D020)

Review D003/D004. Catalog deadlines may exceed five minutes; speed-up uses docs/16's 50%.
No source design document or model parameter was changed.

## Q005 — Random repeat quests after quest 12

RESOLVED 2026-10-10: approved specification in docs/16 §10.3 and D017; implementation/validation G3.

docs/16 §10 supplies examples and approximate rewards, but not the random pool, level eligibility,
selection rules or the Farm equivalent of current income. The 24 authored quests are implemented.
Please supply/approve the repeat-quest specification before full-content G3; no pool was invented.

## Q006 — Net worth of village roads

RESOLVED 2026-10-10: D018 confirms actual payments, including rebuilding removed template roads.

docs/16 §13 lists all road cells while also specifying initial net worth $2500. A template already
has natural village roads. D011 excludes their original value and counts player upgrades/additions.
Confirm this valuation, including rebuilding a removed template road, before G3 economy comparisons.

## Q007 — Far-bank quest interpretation

RESOLVED 2026-10-10: D012 confirmed; optional authored bankRegions approved (docs/06, D018).

D012 uses separate dry-land components relative to ENTRY plus an ACTIVE bridge between them.
Confirm this is suitable for the authored City/Farm layouts; a winding river whose banks connect
around its end may need a declared far-bank region in layout data. No regions were invented.

## Q008 — QA wording for an embanked bank below water+5

RESOLVED 2026-10-10: corrected docs/10 §2.1 as approved; D019.

docs/10 §2.1 says lowering below water+5 becomes valid after embanking, while the higher-priority
docs/15 §4.2.3 still requires h >= water+5 for embanked banks. Code and tests follow docs/15.
Please approve correcting that QA line before the design document is edited.

## Q009 — Repeat quests when only one template is eligible

Open (non-blocking), 2026-10-10. docs/16 §10.3 says a template must not repeat back-to-back. Early Farm
characters without a producer or free field quota can have only `sell_item`/`harvest_crop` eligible; in
the degenerate case of a single eligible template, D024 reuses it (with a different subject/target where
possible) rather than leave an empty slot. Please confirm, or choose "leave the slot empty until another
template becomes eligible".

## Q010 — Real-sim economy pacing versus docs/16 §12 — OPEN

2026-10-10. Balance decision required; **no economic values were changed**.
The current 60-day, six-scenario run uses `f5ab34a` (topology optimization over baseline `47fe17d`), contentVersion 1 and the real sim.
All six scenarios finished, CLI exit 0, 876.329 s total. The 55-file source fingerprint stayed unchanged;
all six snapshots, wallets and occupancy checks are valid. **Pacing gate FAIL** (five failing milestones,
two passing milestones, one UNREACHED). CLI success does not imply pacing approval.

| Map / ordinary player | Level | Target elapsed days | Actual elapsed days | Deviation | Status |
|---|---|---:|---:|---:|---|
| City | 8 | 3.5 | 6.5 | +85.7% | FAIL |
| City | 12 | 11 | 14.6875 | +33.5% | FAIL |
| City | 15 | 21 | 24.5 | +16.7% | PASS |
| City | 20 | 49 | 51.5 | +5.1% | PASS |
| Farm | 8 | 4 | 8.041667 | +101.0% | FAIL |
| Farm | 12 | 12 | 30.6875 | +155.7% | FAIL |
| Farm | 15 | 22 | 53.6875 | +144.0% | FAIL |
| Farm | 20 | 52 | UNREACHED | — | UNREACHED |

Evidence: `docs/reports/G3-economy-current.json`, `G3-economy-comparison.json` and `G3-report.md`.
The earlier City L8 reading at 08:28 agrees exactly; all City/careful results are exactly equal before/after the optimization.
The ordinary-player 60-calendar-day schedule observes 59.048611 elapsed days from the first session;
Farm ends at L15. Its L20 date/deviation is unknown and is not extrapolated beyond that horizon.
Farm/careful ends at L18. Relative speed is **PASS** at L8 = 2.266×, L12 = 1.689×, L15 = 1.562×;
L20 comparison is unobservable because neither Farm style reaches it.

### Cause: bot/model inputs versus implemented rules

- Confirmed model mismatch: docs/16 §12.4 explicitly simplifies Farm inputs as always available, bought at sale price and sold immediately. Real sim has no crop/product purchase command; it requires growing inputs, storage, connected markets and production queues. Bot strategy can therefore change throughput without any incorrect catalog number.
- Confirmed City bot observation: at simulated day 11.875, L10, 97 buildings, 16 zones, authored quest index 11 (far-bank income building) was still pending. Two passive debugger samples were inside `isFarBank` → `build` → `infrastructure`; the candidate loop repeatedly flood-fills the dry land. This explains wall-clock cost. It does not by itself prove the cause of slow simulated progression; the placement/expansion policy needs review.
- The current bot places rotation 0, uses bounded site-planning attempts and clears/grades/pays real infrastructure. The reference model uses abstract per-cell overhead and usable-cell capacity. Thus a failed bot comparison alone does not establish a sim-rule bug or optimal human pacing.
- All six final invariant sets pass; no source fingerprint mismatch was found. This establishes valid sim states, not optimal strategy or approved pacing.

### Payback scope requiring a decision

The supplemental audit finds all earning buildings **unlocked above L5** have maximum-rate payback
≥ 1 h (minimum bank 2.686 h). If the criterion includes all earlier buildings still available after L5,
Tạp hóa has confirmed single-building payback **0.901 h** at L8: value $575 / actual rate $638.4/h.
A funded City rule fixture accepted all nine layout commands and passed snapshot validation;
see `docs/reports/G3-payback-fixture.json` and `docs/evidence/mvp-final/payback-fixture.ts`.
This excludes shared road/decor/embankment costs and does not measure human or authored-map progression.
Base payback is 1.513 h. The broad interpretation therefore FAILS; the newly-unlocked interpretation passes.
Four stated transaction reversals pass finite real-sim checks; all adversarial repeat-quest combinations are NOT RUN.

### Options for the product owner

1. **Reconcile the model and bot first (recommended).** Make `docs/tools/economy/model.mjs` model real input acquisition, legal land/roads and realistic placement/session choices; have the bot owner review the strategy without changing sim rules. Rerun all six cases. If tuning is still needed, recalibrate `P.xpCumMap` using that verified strategy. This separates bot/model error from a balance change.
2. **Approve recalibration against the current conservative bot.** Adjust `P.xpCumMap` and, only if the broad payback interpretation is required, rate/payback parameters in `model.mjs` to keep even bonus-enhanced early buildings above 1 h. Recalibrate both maps jointly; faster XP must not come from adding illegal input purchases or virtual rewards. No replacement numbers are proposed as already validated.

Both options follow docs/16 §11 after approval: edit model parameters → `node model.mjs --tables`
→ `node calibrate-xp.mjs city` / `farm` → `node model.mjs --sim` → update docs/16 and generated content,
bump `contentVersion`, run real-sim six scenarios plus regression tests. Q010 remains open until that decision.

### Additional reading of the same run (Claude, 2026-10-10; data only, nothing changed)

From `G3-economy-current.json` daily rows and rejection counts:

| Scenario | Level d59 | Cash d12 | Cash d59 | Buildings d59 | `STORAGE_FULL` rejections |
|---|---|---:|---:|---:|---:|
| City / thuong | 20 | $6.2 M | $251 M | 229 | 0 |
| Farm / cham | 18 | $207 k | $3.1 M | 28 | 2 030 |
| Farm / thuong | 15 | $69 k | $1.96 M | 25 | 1 255 |
| Farm / nhan | 10 | $8.5 k | $298 k | 16 | 234 |

- **Farm is throughput-bound, not cash-bound.** The ordinary Farm bot sits on unspent cash all game, yet
  its fields lag docs/16 §12.3 (24 vs 48 on day 1, 96 vs 120 on day 7, 144 vs 192 on day 30) and 1 255 harvest/
  collect commands bounce on full storage. Levels therefore come only from slow activity XP. This points at the bot's
  storage/selling/producer policy (and the model's "sell instantly" simplification) more than at catalog numbers,
  i.e. supports Option 1 before any XP retuning.
- **City late pacing passes but money piles up.** City/thuong reaches 229 buildings on day 59 exactly as §12.2
  predicts, but ends with $251 M unspent (income keeps flowing after building limits are reached). Not a pacing
  failure, but a possible lack of late-game money sinks to review for P1 (docs/16 does not define a cash target).

### Option 1 experiment: does a better Farm bot close the gap? (Claude, 2026-10-10)

`scripts/q010-farm-bot.ts` subclasses Codex's `EconomyBot` (file unchanged) and changes only choices, all through
legal commands; no rule or number changed. Farm, ordinary player, 60 days (`docs/reports/Q010-farm-bot-thuong.json`):

| Bot | L8 (target d4) | L12 (target d12) | L15 (target d22) | L20 | Final | Storage rejections |
|---|---|---|---|---|---|---:|
| baseline (current bot) | d8.0 (+101%) | d30.7 (+156%) | d53.7 (+144%) | unreached | L15 | 1 255 |
| V2: sell before harvest, all producers, silos on demand | d7.5 (+88%) | d24.7 (+106%) | d47.0 (+114%) | unreached | L16 | 22 |
| V3: V2 + next farmhouse first, zones only with a cash cushion | d6.0 (+51%) | d23.5 (+96%) | d46.0 (+109%) | unreached | L16 | 20 |

All snapshots valid. Reading: the early gap is largely bot strategy (the baseline spends $6 150 on zones, a silo and a
coop before the 2nd farmhouse, so day-1 fields are 24 vs the model's 48). From L8 on, even the improved bot needs about
twice the model's time although it reaches the same 192 fields, so the remaining gap is a model-vs-rules difference
(e.g. instant input purchase/sale, harvest timing between sessions), not storage or build order. Conclusion: Option 1
alone will not close Farm pacing; after reconciling the model, a Farm XP recalibration (Option 2 scope) is still
likely needed. City was not re-run (its L15/L20 already pass).
