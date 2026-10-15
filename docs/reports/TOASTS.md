# Toasts (D043 candidate)

Error messages now float as toasts at the top centre, below the top bar, and disappear by themselves.

## Design
- `apps/web/src/game/toasts.ts`: zustand store plus pure helpers `pushToast` and `expireToasts` (unit-tested in `toasts.test.ts`).
- `apps/web/src/ui/Toasts.tsx`: rendered once in `Game.tsx`, before the mission panel.
- `WorldStore.message(text, true)` now calls `toast()`; non-error messages still go to the inline `.feedback` line. Every existing error call site (local reject in `dispatch`, queue full, server rejection and rebase, cache error, map switch failure) toasts without further changes.
- CSS is one block at the end of `hud3.css`. The container uses `zoom: var(--hud-zoom)` and `top: var(--hud-bottom) + 10px`, so it sits below the top HUD at every zoom. On phones toasts are full width with 16 px gutters.

## Behaviour
- Timings: error 2.5 s, info 1.8 s, 0.18 s slide-fade in (off under `prefers-reduced-motion`).
- At most 3 visible; the oldest is dropped.
- A text that is already visible (same text and kind) is merged: counter `xN` and timer refresh, no stacking. This is slightly broader than "consecutive only".
- Click or tap dismisses a toast.
- `role="status"`; `aria-live="assertive"` for errors, `polite` for info.

## What toasts and what stays inline
- Toast: rejected `dispatch` (a confirm on an invalid preview, desktop release, or any command), queue full, server rejection and rebase, cache and sync errors, map switch failure.
- Inline: hover and touch preview errors. They show in the preview bar (`preview-cost`) and the red cells. `ToolController.preview()` no longer calls `world.message`.
- `.feedback`: kept for neutral guidance ("Chọn ô trên bản đồ", "Chọn bờ đối diện", the accepted-action note) and the cache status. It lost the red error style and its `role="status"`, which now belongs to toasts. `scripts/g1-evidence.mjs` still reads `.feedback span`.

## Verification
- `pnpm check` passes (lint, tests, build).
- `scripts/toasts-qa.mjs` (BASE_URL=http://127.0.0.1:5199) passes at 1440x900 and Pixel 7:
  - 2 s of hovering over invalid cells produced 0 toasts (the inline error was shown);
  - an invalid placement click showed one toast "Có vật cản trên ô." and 0 toasts after 2.8 s;
  - three different errors stacked as 3 toasts, and a 4th is capped at 3;
  - three identical errors merged into one toast with "×3"; a click dismissed it;
  - toasts do not overlap the top bar; the Pixel 7 gutters are 16 px.
- Pixel 7: a touch tap on an invalid cell shows the inline error and a disabled confirm button, so no toast. This is expected.
- `dock-qa`, `hud-scale-qa` and `quests-qa` pass. Their regenerated evidence was reverted.
- Evidence: `docs/evidence/g4/toasts/` (`placement-toast-1440x900`, `placement-gone-1440x900`, `three-stacked-{1440x900,pixel7}`, `merged-x3-{1440x900,pixel7}`, `hover-no-toast-1440x900`, `report.json`).

## Notes
- On a phone a toast can cover the top of the mission panel while it is visible. It never covers the top bar.
- `docs/DECISIONS.md` was not edited; the caller records the decision.
