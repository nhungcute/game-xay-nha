# G0 gate report

Review date: 2026-10-10, Asia/Bangkok.
Scope: foundations and rules only, as docs/14 §0.1. G1–G4 have not started.

## Delivered

| Package | Result |
| --- | --- |
| Root | Pinned pnpm workspace, strict TypeScript, ESLint purity restrictions, Vitest, declaration build, CI configuration |
| contracts | Types and strict Zod schemas for template/snapshot and all 23 commands, shared portable base64 codecs |
| content | Generated economy/catalog, 24 authored quests and Vietnamese catalog strings; deterministic source check |
| worldgen | Seeded environment generation, stable IDs, independent zone generation, semantic template validator |
| tooling | Build/validate CLI, provisional 128×128 rule fixture, Node/browser determinism verifier |
| sim | Atomic commands and previews; terrain, roads, embankments, bridges, construction lifecycle, builders, farming, prepaid queues, income, XP/levels, land unlocks, quests, snapshot validation |

Source design documents 00–16 and old prototypes were not modified. Existing prototypes were
captured only as reference inputs. No ECO map, gameplay beyond MVP, server or renderer was added.

Implementation commit range: `0359f37..005cd38` (reference baseline through verified sim).

- `0359f37`: original design and prototype/reference inputs.
- `90bf119`: strict workspace, contracts and generated content.
- `8e9c7c4`: deterministic worldgen, tooling and CI checks.
- `005cd38`: shared gameplay simulation and rule/property tests.

This gate report, decisions, questions and raw evidence are committed separately afterward.

## Verification and reproducible evidence

Final verification: Node 22.20.0, `pnpm check`, exit code 0. Generated-content verification,
lint, typecheck, all 604 Vitest cases in 13 files, and the declaration build passed. Vitest took
45.84 seconds. Exact terminal evidence: [node22-check.log](../evidence/g0/node22-check.log).

| Suite | Cases |
| --- | ---: |
| Contracts | 79 |
| Content | 33 |
| Worldgen | 31 |
| Tooling CLI + portable golden fixtures | 5 |
| Sim construction | 48 |
| Sim economy | 46 |
| Sim engine | 38 |
| Sim farm | 73 |
| Sim terrain/roads/embankment | 53 |
| Sim snapshot | 51 |
| Sim footprint/picking/demolition | 146 |
| Sim 1000-command property scenario | 1 |
| Total passed in final run | 604 |

The seeded property scenario executes exactly 1000 random commands across City/Farm and all
23 command types, after valid construction/bridge/farm setup. It checks every result, not just
the final state: integer nonnegative wallet, unique entity IDs, rebuilt occupancy equality,
semantic snapshot reload, shared zone edges, and unchanged state on rejection. The final run
accepted 217 and rejected 783; the property scenario took 44.167 seconds.

Real browser verification: `pnpm test:worldgen-browser`. Node 22.20.0 and system Chrome
154.0.8037.98 produced identical JSON for 16 fixtures (two maps, four seeds, two generator
versions), plus two reverse-zone-order cases. Combined SHA256:
`1d03406d2f3df059625642bf36911ddec65a0fc7d520ec599eae19102edcac3c`.
Exact browser evidence: [browser-worldgen.json](../evidence/g0/browser-worldgen.json).
This is a pure worldgen browser check, not a rendered-game acceptance test.

`pnpm install --frozen-lockfile` succeeded. The persisted provisional fixture passed:
`pnpm tooling validate-template packages/tooling/fixtures/farm-test.template.v1.json`.

## docs/10 coverage

| Requirement | Status and evidence |
| --- | --- |
| §2.1 RAISE/LOWER/FLATTEN vertices, quantization and payment | PASS — terrain tests |
| §2.1 Water/road/building/env obstruction, protected/locked affected cells | PASS — terrain/construction tests |
| §2.1 Shoreline and embankment | PASS against docs/15; conflicting QA below-minimum wording is Q008 |
| §2.1 Boundary slope, neighboring roads, 256-cell limit, shared edges | PASS — terrain tests and property scenario |
| §2.2 Road errors, tier differences and 16 autotile masks | PASS — terrain tests |
| §2.2 BFS, unfinished/finished/removed bridges | PASS — terrain/construction tests |
| §2.2 Bridge errors, exact maximum span and separation | PASS — construction tests |
| §2.3 Placement, auto-flatten, refunds, shoreline and wrong-map errors | PASS — construction/economy tests |
| §2.3 All non-square rotations, picking inside/outside, demolition via picked ID | PASS — footprint tests |
| §2.3b Timers, occupancy, completion XP, ordered events and banks | PASS — construction/economy tests |
| §2.3b Builder counts, cancel, speed-up, limits, instant infrastructure | PASS — construction/terrain tests |
| §2.4 Rate segments, caps, labor, disconnected income and bonuses | PASS — economy tests; literal rate-cap behavior remains Q001 |
| §2.4 XP tables/rewards, unlock formula and farming economy | PASS — economy/engine/farm tests |
| §2.5 Seed/version parity on Node/browser, zone ordering and collisions | PASS — worldgen/golden tests plus actual Chrome report |
| §2.6 Unknown last definition, duplicate IDs, bounds, overlaps and bad surfaces | PASS — snapshot tests preserve current decoded state and hash |
| §2.6 Template mismatches, removed-env IDs, corrupt/shared deltas and invalid numbers/time | PASS — snapshot tests |
| §2.6 Valid snapshot reload and hash equivalence | PASS — snapshot tests and every property-scenario command |
| §2.6 Scene/mesh/cache preservation, corrupt IndexedDB recovery from server | NOT RUN — scene/cache/API do not exist in G0; required in G1/G2 |
| §3 API/Postgres/auth/concurrency | NOT RUN — G2 |
| §4 E2E, §4.1 GPU leak, §5 visual, §6 device performance | NOT RUN — G1 onward |
| §7 Long-run economy pacing with real sim | NOT RUN — G3 |
| §8 Release/Docker/mobile acceptance | NOT RUN — G4 |

The simulated tutorials use real commands and fake authoritative time, reach level >=2 and finish
within six simulated minutes. This does not measure human playtime, UI onboarding or browser E2E.

## Prototype regressions from docs/12 §7.1

| Prior bug | Prevention/evidence |
| --- | --- |
| Clear state before checking imported data | snapshot.ts validates into a replacement; snapshot tests preserve >=3-building state |
| Wrong seed/bounds/IDs and invalid cached state | Template identity, schema, references, delta and semantic validation; cache writes deferred to G1/G2 |
| Duplicate IDs leave orphan meshes | Sim IDs are unique within world and snapshot rejects duplicates; server-generated IDs/GPU lifecycle deferred to G2/G1 |
| Demolition uses unrotated size | Shared footprint and occupancy picking; all rotations and every inside cell tested |
| Ghost removal leaks GPU resources | NOT RUN; no GPU objects in G0; G1 ownership/pool work remains |
| Demolition disposes shared materials | NOT RUN; no renderer in G0; G1 ownership/refcount work remains |
| Excess exposure and faint colors | NOT RUN; lighting/palette and visual criteria remain G1 |

## Decisions, limitations and next gate

Read `DECISIONS.md` D001–D015 and `OPEN_QUESTIONS.md` Q001–Q008. The important unresolved product
choices are rate-cap decreases, support demolition, initial road valuation, far-bank topology,
and random repeat quests after the 12 authored quests. No random quest pool or balancing values
were invented. Rejected commands preserve the input state; G2's transaction service must process
authoritative time events before command validation as docs/08 §5 requires.

Layout remains provisional; asset IDs are declarations rather than delivered 3D assets. The CLI
builds a rule fixture, not traced production layouts. The client/API must supply generated env
instances to createState; sim does not depend on worldgen. SimSession's in-memory idempotency ledger
is an offline adapter; durable transactional command storage is G2. The patch carries existing land
ownership and character valuation fields needed by UNLOCK_ZONE (D014).

CI workflow was configured but has not run on a remote CI service. No performance budget,
GPU leak result, mobile/WebKit E2E, Docker deployment or finished MVP is claimed.

Next after approval: G1 offline Farm with Vite/React/Three.js, per-zone terrain and dirty rebuild,
water/environment/roads/embankments/bridges/building previews, desktop/touch camera, and the exact
G1 recorded tool sequence, timing and GPU checks required by docs/14.

Approval protocol: docs/14 §0.1 says “then STOP and wait for my approval unless I said
\"auto-continue\"”. G1 must not start before that approval.
