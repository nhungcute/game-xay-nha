# Codex G3 evidence — what is and is not in git

Committed on Codex's behalf at the user's request (2026-10-10). Two outputs stay local only because of size:

- `render-performance/profile.json` (≈ 45 MB): regenerate with `node scripts/g3-render-profile.mjs`
  (offline dev server on :5190). Its summary is in `docs/reports/G3-visual-analysis.md`; the post-fix
  profile is committed in `docs/evidence/g3/draw-calls/profile.json`.
- `parallel-visual/*-canvas.png` (≈ 13 MB): lossless canvas captures; the JPEG screenshots and
  `visual-check.json` (histograms, luminance samples) are committed.
