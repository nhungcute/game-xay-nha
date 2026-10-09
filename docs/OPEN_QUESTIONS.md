# Open questions for product owner

Questions do not authorize new gameplay or changes to docs/00–16.

## Q001 — Accrued money after capacity/rate decreases

docs/16 §6.4 clamps previously earned money to the new rate-dependent cap, which can delete
money after road disconnection. Current code follows that exact formula (D013). Confirm whether
this behavior is intended; retention would require an approved design change, not silent tuning.

## Q002 — Farm support demolition

docs/15 does not say what happens if farmhouse/silo demolition lowers quota/storage below current
usage or a production building contains prepaid queues. A conservative reject policy will be
documented rather than inventing automatic crop/product destruction. Product review at gate.

## Q003 — Template shore constraint

docs/06 §4 is contradictory for shared shore vertices. D002 follows higher-priority docs/15 and
the existing rasterization procedure docs/07; please confirm this reading at gate review.

## Q004 — Future deadlines and speed-up discrepancy

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
