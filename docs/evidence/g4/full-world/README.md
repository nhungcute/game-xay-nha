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
| Zone rebuild after TERRAFORM | 5.2 ms | 2.8 ms | ≤ 8 ms desktop |
| Console errors | 0 | 0 | 0 |
| FPS high (default / overview) | 47 / 40 | 51 / 44 | 60 desktop — **below target** |
| FPS low (default / overview) | 55 / 55 | 57 / 46 | ≥ 30 mobile |

Not covered: docs/10 §6 asks for 400 buildings, 2 000 road cells, 20 bridges, 1 000 fields and 64 open zones;
these bot worlds are realistic day-60 worlds and are smaller. Real reference devices were not available.
FPS in headless Chrome on this host is indicative only. Desktop FPS at "high" falls to 40–53 in a full City/Farm;
"low" restores ~55. Profiling the high-quality GPU cost (shadow map 2048 PCF soft over ~230 buildings) is a P1 item.
