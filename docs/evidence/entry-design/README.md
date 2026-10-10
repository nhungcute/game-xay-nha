# Entrance redesign evidence

2026-10-10. See [design report](../../reports/ENTRY-design-report.md).

- `review.json` / `review.log`: 131 browser checks across five layouts, API fixtures, zero unexpected errors.
- Fifteen JPEGs: maps/create/login/code/returning × desktop/mobile/WebKit. Recovery-code fixtures are masked.
- `recovery-smoke.json` / `.log`: eight checks against the real dev API/Postgres, fresh-browser recovery and reload. No real codes or tokens saved.
- `production-smoke/smoke.json`, four JPEGs and `production-smoke.log`: existing G4 script run against rebuilt local Docker, four browser/map cases and 24 checks PASS, zero errors.
- `lint.log`, `typecheck.log`, `deploy.log`: executed commands, all exit 0; deploy log includes the production frontend build.

Screenshots show the real implemented DOM/CSS. They are browser emulation, not physical-device measurements.
Existing MVP and G3/G4 evidence directories were retained; no tunnel or public deployment was started.
