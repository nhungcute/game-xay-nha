# G4 full-world render check (docs/10 §6, partial)

Worlds are built by the real sim: Codex's `EconomyBot` (imported unchanged) plays the careful style for 60 days
(`npx tsx scripts/g4-full-world.ts`), then `node scripts/g4-full-world.mjs` loads each final snapshot into the
offline dev client through validate-then-swap and measures docs/11 §8 on this desktop GPU (Chrome, D3D11).

| World | Buildings | Road cells | Fields | Zones | Bridges |
|---|---:|---:|---:|---:|---:|
| City day 60, L20 | 229 | 484 | 0 | 10 | 1 |
| Farm day 60, L18 | 28 | 161 | 216 | 8 | 1 |

| Check | City | Farm | Budget |
|---|---|---|---|
| Draw calls, high (max of 4 views) | 183 | 181 | ≤ 300 |
| Triangles, high | 197k | 203k | ≤ 1.5 M |
| Draw calls, low | 108 | 104 | ≤ 150 (mobile) |
| Triangles, low | 177k | 181k | ≤ 500k (mobile) |
| Zone rebuild after TERRAFORM | 4.4 ms | 4.7 ms | ≤ 8 ms desktop |
| Console errors | 0 | 0 | 0 |
| FPS high, steady state (min over 4 views; p95 frame) | 51 (overview 75°, p95 26 ms); other views 57–59 | 58–59 (p95 ≤ 19.5 ms) | 60 desktop |
| FPS low, steady state | 58–59 | 59 | ≥ 30 mobile |

Not covered: docs/10 §6 asks for 400 buildings, 2 000 road cells, 20 bridges, 1 000 fields and 64 open zones;
these bot worlds are realistic day-60 worlds and are smaller. Real reference devices were not available.
FPS is the median of 90 requestAnimationFrame intervals after a 3 s settle (headless Chrome, this host; indicative).
A first run read the 1-second HUD counter right after loading and showed 40–53 FPS; profiling showed that was
load/settle work: one full-City render (main + shadow pass) costs ~3.0 ms of GPU time (1.5 ms without shadows).
Only the City 75° overview at high quality stays slightly below 60 (51 FPS).
