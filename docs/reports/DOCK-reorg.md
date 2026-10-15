# Dock reorg: Đất đai tab and quick Phá button

Presentation only; no sim, contract, content or economy changes.

## Changes
- Bank (`bankCapHours`) moved from Tiện ích to Công trình (`buildingCategory`). Price and behaviour unchanged.
- Category id `nature` ("Thiên nhiên") replaced by `land` ("Đất đai", icon `zone`) holding Dọn, San nền, Khu đất.
- Phá (`demolish`) is in no tab: `DemolishButton` (`.hud3-quick`, `aria-label="Phá công trình"`, `aria-pressed`) sits beside the tab bar in `.hud3-barrow`.
- `visibleCategories(kind)` hides tabs with no tool and no building for the map kind.
- Hints: "Chọn Đất đai → Dọn…", "Chọn Đất đai → San nền → Phẳng…", "Chọn Đất đai → Khu đất…". A `demolish` hint would pulse the quick button (`is-hint`); no authored quest uses it.
- ObjectPanel shortcuts (Dọn nhiều, Đường, Gieo, Thu hoạch) go through `choose` and the existing `categoryOf` effect, so they open the right tab (Dọn now opens Đất đai).

## Tabs per map kind
- City: Công trình, Đường, Đất đai, Trang trí (Tiện ích and Nông trại hidden).
- Farm: Công trình, Đường, Nông trại, Đất đai, Trang trí, Tiện ích (well, silo).

## Phá behaviour (decisions)
- Press: demolish active, tray closes, tool-options shows "Phá"; press again returns to explore.
- Picking another tab while Phá is on turns Phá off (existing `pickCategory` returns to explore).
- Click-test on a built city: click a house with Phá, Xác nhận is enabled, confirming removes it (same flow as before).

## Layout
Desktop: right of the tab bar, same height, inside the centred dock (74/64/58px wide by breakpoint). Phone: right end of the bottom row, 52px wide, full bar height (66px, above the 44px minimum); tabs shrink to 52px each. No overlap with minimap, controls, tray, mission panel or top bar at 1440x900, 1366x768, Pixel 7 (checked by `scripts/dock-qa.mjs`).

## QA
`pnpm check` passes (790 tests, new cases in `hud3.test.ts`). `scripts/dock-qa.mjs`, `hud-scale-qa.mjs`, `quests-qa.mjs` pass on :5197. Evidence: `docs/evidence/g4/dock/` (bar, tray-buildings, tray-land, demolish-active, hint-land, demolish-click-city, report.json).
