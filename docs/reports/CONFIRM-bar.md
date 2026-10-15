# Confirm bar (Xác nhận / Hủy removed)

Owner request: the Xác nhận and Hủy buttons did little (choosing a position already confirms), so remove them.

## Behaviour
| Input | Tool | Bar tail |
|---|---|---|
| Mouse | all except Phá | `Esc để thoát` hint + small x exit icon. Commit on pointer release (unchanged). |
| Mouse or touch | Phá (building or bridge) | Red button `Phá · hoàn $X` + x cancel. Consequence note ("N công trình sẽ mất đường nối") stays. Refund = wallet cash delta from simulating the command (`ToolPreview.refund`). |
| Touch | all others | Primary button naming the action and price: `Đặt Nhà nhỏ · $300`, `San nền 4 ô · $60`, `Mở khu · $X`. Disabled and showing the reason when invalid (e.g. "Khu đất chưa được mở hoặc không liền kề."). x cancels the preview (exits the tool when nothing is previewed). Button 48px, x 44px. |

## Touch detection
`useTools.touch` follows the `pointerType` of the last pointer event (`PointerRouter.mode`): `touch` means finger UI, anything else mouse UI. Initial value is `matchMedia('(pointer: coarse)')`. Chosen over a pure media query so a touchscreen laptop switches with the device actually in use. `up(cell, touch)` is unchanged, so commit-on-release logic is the same.

## Files
`ToolController.ts` (touch flag, refund), `WorldStore.ts` (`ToolPreview.refund`), `PointerRouter.ts` (mode), `Game.tsx` (`commitUi`), `hud3.css` (appended block). No sim, contract, content or economy change.

## QA
`scripts/confirm-qa.mjs` (BASE_URL, default :5198) writes `docs/evidence/g4/confirm/`: desktop build valid/invalid, road drag, demolish; Pixel 7 build preview, invalid reason, rectangle, demolish. Asserts: no Xác nhận/Hủy on mouse; building placed on release; Phá not executed before confirm; on touch a tap buys nothing until the button is pressed; buttons >= 44px. `dock-qa`, `hud-scale-qa`, `quests-qa` pass. `g4-soak.mjs` now presses Esc instead of clicking Hủy; `g1-mobile.mjs` still works (`button.primary`).

## Not done
- The Pixel 7 rectangle shot shows the obstacle reason ("Có vật cản trên ô.") rather than a priced `San nền N ô` label, because trees blocked the sampled rectangle. The label code path is simple string formatting but was not captured. Till is not in the city map's tabs, so it was not exercised.
