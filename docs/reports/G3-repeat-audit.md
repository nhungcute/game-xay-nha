# G3 independent repeat-quest audit — 2026-10-10

**Result: FAIL — 44 checks passed, 20 checks failed (64 total).** These are 5 underlying finding
groups, not 20 distinct defects. This audit does not approve G3. No gameplay code, economy numbers,
existing tests or owner-controlled files were edited.

Reproduce from the repository root:

```powershell
pnpm exec tsx scripts/g3-repeat-audit.ts
```

The script intentionally exits 1 when an assertion fails. The recorded run completed normally;
this was not a timeout or script exception. Source SHA-256 hashes matched before and after execution.
The complete assertions and hashes are in [results.json](../evidence/g3/repeat-audit/results.json).
Executed commands, revisions and state hashes are in [commands.json](../evidence/g3/repeat-audit/commands.json).

## Scope and limitations

Rules checked: approved Q005 / D017 / docs/16 §10.3, snapshot validation and atomic/idempotent command
handling. Synthetic fixtures supply level, wallet, prior quest history and, for production, feed.
All tested transitions use real `execute` / `SimSession` commands. The City quest-12 prerequisite
counter is synthetic; claiming quest 12 and creating repeats is an actual command. Map data comes
from `createTestTemplate`, not the authored production maps. These results demonstrate engine behavior,
not normal player progression, browser behavior, remote API exploitability or 30–60 minute pacing.

Valid baseline snapshots round-trip through `validateSnapshot` with identical hashes:
[City](../evidence/g3/repeat-audit/valid-city-snapshot.json),
[Farm](../evidence/g3/repeat-audit/valid-farm-snapshot.json).
The production fixture also validates before its command sequence.

## Findings requiring owner action

### 1. Repeat snapshot semantics are not validated (high)

`packages/contracts/src/schema.ts:138` checks shapes and nonnegative finite integers, while
`packages/sim/src/snapshot.ts:15` currently has no repeat-specific semantic validation. The valid
Farm baseline has three quests, quota 24, reference income $720/h, reward $180 and XP 27.
Changing only repeat data accepts:

- Reward cash +$1,000,000, XP +1,000,000 or a wood reward of 99.
- Duplicate quest IDs, the same template at consecutive generated IDs, or an ID beyond `repeat.seq`.
- Unknown crop, locked `coffee`, or a City `house_small` build quest in Farm.
- Progress above the target, a reroll deadline 400 hours ahead, repeats before authored quests end,
  or only two active quests.

For a quest completed through **16 actual TILL commands**, a mutated reward/XP snapshot also
validates and an actual `CLAIM_QUEST` pays the forged reward. Cash rises $1,026,280, including level-up
rewards caused by the forged XP. The input is retained as
[forged-completed-snapshot.json](../evidence/g3/repeat-audit/forged-completed-snapshot.json).
This demonstrates the snapshot acceptance boundary; it does **not** demonstrate a remote client
can submit a snapshot to the authoritative API.

Validation must preserve legitimate historical rewards when income/quota later changes. Comparing
every saved reward against today's income alone would incorrectly reject legitimate snapshots.
The XP/cash relationship, zero material rewards, subject/map/level references, IDs, clocks and
progress can be checked independently of that historical-income problem. Coordinate any extra
persisted generation metadata with the schema owner.

### 2. Replacement repeats the just-completed template (high)

`packages/sim/src/quests.ts:87` first excludes templates already active, then falls back to the
just-completed template. In the supported Farm fixture:

```text
active: harvest_crop r0, till_cells r1 (target16), sell_item r2
16 × TILL → r1.progress16
CLAIM_QUEST r1 → accepted
replacement: till_cells r3 (target8)
```

Q005 says never repeat the same template twice consecutively. It does not require all three active
templates to be distinct. The additional uniqueness constraint forces the fallback in this example.
D024 documents an exception, but the user's approval and docs/16 §10.3 do not grant that exception.
Resolve against the approved rule without adding gameplay or changing numbers.

### 3. Loss of road support reduces active slots from 3 to 2 to 1 (high)

After the real completion/claim above, these are all actual commands; repeat state is not reset:

```text
REMOVE_ROAD [70,78] → connected field quota becomes0
REROLL_QUEST harvest_crop → accepted; only2 active quests remain
wait4h; REROLL_QUEST till_cells → accepted; only1 active quest remains
wait4h; REROLL_QUEST sell_item → accepted; replacement is sell_item again
```

`ensureRepeatQuests` (`quests.ts:109`) stops when `next` returns null. This violates the approved
three-active-slots rule and also reproduces the same-template fallback. Existing supported buildings
remain in the world; the state arises through an allowed road removal, not deleted support objects.

### 4. Production repeat can be claimed before any unit is produced (high)

`packages/sim/src/farm.ts:145` emits `PRODUCE` when submitting production jobs. The repeat listener
in `common.ts:58` treats those submissions as produced units. Repro:

```text
valid connected ACTIVE chicken_coop; repeat produce_item target4
START_PRODUCTION count4 → repeat progress4
all four jobs readyAt = now +20 minutes
CLAIM_QUEST immediately → accepted
```

Q005 requires producing N units of product Y. Queue submission alone is not production completion.
Keep the authored quest's existing meaning separate if that authored quest intentionally measures
feeding/queueing; this audit requests no change to its gameplay.

### 5. City collect target rounds to $10 without approval (medium)

Four connected small houses on tier-2 roads yield approximately $748/h (floating-point representation
748.0000000000001). `quests.ts:44` generates `collect_cash.target750`. Q005 specifies X as one hour
of current base income. It applies $10 rounding to **rewards**, not to this target. Integer-dollar
representation may require ordinary numeric rounding, but the extra nearest-$10 quantization is an
unapproved target change. Reward $190 and XP28 are correct for this reference income.

## Checks that passed

- Repeats are absent before quest12; an actual quest12 claim creates three City repeats.
- Supported Farm generation initially creates three quests; actual TILL advances only its matching
  quest; claiming pays the exact unmodified reward and immediately restores three slots in that case.
- Independent City/Farm reward math matches generation: Farm $720/h → $180/XP27;
  City $748/h → $190/XP28; zero-income minimum → $100/XP20.
- First reroll is free, cooldown is exactly four hours, one millisecond early rejects atomically,
  and the exact boundary succeeds.
- Valid snapshot roundtrips pass; zero target, nonfinite target/reward/reroll clock reject.
  Every tested rejected or accepted snapshot leaves the current state unchanged.
- Malformed reroll payloads reject atomically and cache identical results; repeat claim replay
  returns the cached result without paying twice.
- A generator-only sweep of 320 synthetic states (City/Farm, levels1–20, eight world IDs each)
  found no locked references among generated targets. This sweep has no Farm support buildings,
  so it does not establish production eligibility across every level.

## Verification and remaining work

Only this targeted script and its ESLint check were run; no full suite or expensive 1,000-command
property test was started. A targeted TypeScript diagnostic check passed before the final production
scenario was added; ESLint passed afterward. Source hashes in `results.json` identify the precise
audited implementation. Re-run after the Claude owner fixes these cases. Normal-play quest pacing,
production lifecycle after completion, mobile/browser interaction and authored-map progression remain
separate G3 checks. This audit makes no economy calibration changes and does not authorize D024's
fallback or target-sizing ranges.
