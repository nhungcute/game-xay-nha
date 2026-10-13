import { useCallback } from 'react';
import { catalog, economy } from '@xay-nha/content';
import { authoredQuestProgress, capHours, inventoryCount, populationAndJobs, repeatQuestProgress, storageCapacity } from '@xay-nha/sim';
import type { WorldStore } from '../game/WorldStore';
import { money, t } from '../i18n';
import { GameIcon } from './GameIcon';
import type { GamePanel } from './panels';

type State = WorldStore['state'];

/** Titles shown under the player's name, by level (one ladder per map). */
const TITLES: Record<'city' | 'farm', [number, string][]> = {
  city: [[1, 'Người lập làng'], [5, 'Trưởng thôn'], [10, 'Thị trưởng'], [15, 'Kiến trúc sư đô thị'], [20, 'Huyền thoại thành phố']],
  farm: [[1, 'Người khai hoang'], [5, 'Nông dân chăm chỉ'], [10, 'Chủ trang trại'], [15, 'Phú nông'], [20, 'Lão nông huyền thoại']],
};
export function playerTitle(kind: 'city' | 'farm', level: number): string {
  return TITLES[kind].filter(([from]) => level >= from).at(-1)![1];
}

/** Things worth the player's attention right now (the mail button's red dot). */
export function notifications(state: State): string[] {
  const s = state.snapshot, items: string[] = [], quest = catalog.quests[s.mapKind][s.progress.questIndex];
  if (quest && authoredQuestProgress(state) >= quest.target) items.push(`Nhiệm vụ "${t(quest.nameKey)}" đã xong — nhận thưởng.`);
  const repeatDone = s.progress.repeat?.active.filter(q => repeatQuestProgress(state, q) >= q.target).length ?? 0;
  if (repeatDone) items.push(`${repeatDone} nhiệm vụ hằng ngày có thể nhận thưởng.`);
  if (s.mapKind === 'city') {
    const cap = capHours(state);
    const ready = s.buildings.filter(b => (state.rates[b.id] ?? 0) > 0 && (b.accrued ?? 0) >= (state.rates[b.id] ?? 0) * cap * economy.income.bubbleFraction).length;
    if (ready) items.push(`${ready} công trình có tiền chờ thu.`);
  } else {
    const ripe = s.crops.filter(c => c.readyAt <= s.serverTime).length;
    if (ripe) items.push(`${ripe} ô ruộng đã chín, có thể thu hoạch.`);
    if (inventoryCount(state) >= storageCapacity(state)) items.push('Kho đã đầy — bán bớt hàng để thu hoạch tiếp.');
  }
  const done = s.buildings.filter(b => b.status === 'CONSTRUCTING' && b.buildEndsAt <= s.serverTime).length;
  if (done) items.push(`${done} công trình vừa xây xong.`);
  return items;
}

/** HUD clock icon: follows the scene's time-of-day lighting when known (forced day/night modes included),
 *  else the server hour. */
export function clockIcon(hour: number, night?: number): 'sun' | 'moon' {
  return (night === undefined ? hour < 6 || hour >= 22 : night > 0.5) ? 'moon' : 'sun';
}
interface TopBarProps {
  state: State; panel: GamePanel | null; status: string; connected: boolean; unread: boolean; canCollect: boolean;
  /** Scene night factor (0 day … 1 night) from the time-of-day lighting; the icon follows the scene, not the server clock. */
  night?: number;
  onPanel: (panel: GamePanel) => void; onCollect: () => void; onMeasure: (element: HTMLElement | null) => void;
}
export function TopBar({ state, panel, status, connected, unread, canCollect, night, onPanel, onCollect, onMeasure }: TopBarProps) {
  const s = state.snapshot, kind = s.mapKind, table = economy.xp.cumulative[kind];
  const floor = table[s.progress.level] ?? 0, next = table[s.progress.level + 1];
  const need = next === undefined ? 1 : Math.max(1, next - floor), have = next === undefined ? 1 : Math.min(need, Math.max(0, s.progress.xp - floor));
  const initial = ([...s.character.displayName.trim()][0] ?? '?').toLocaleUpperCase('vi');
  const now = new Date(s.serverTime), hour = now.getHours();
  const day = Math.max(1, Math.floor((s.serverTime - s.character.createdAt) / 86_400_000) + 1);
  const third = kind === 'farm'
    ? { icon: 'crops' as const, value: `${inventoryCount(state)}/${storageCapacity(state)}`, label: 'Kho nông sản', panel: 'inventory' as const }
    : { icon: 'people' as const, value: `${populationAndJobs(state).population}`, label: 'Dân số', panel: 'people' as const };
  const measure = useCallback((element: HTMLElement | null) => onMeasure(element), [onMeasure]);
  return <header className="hud3-top" ref={measure}>
    <button type="button" className="hud3-pill hud3-player" aria-pressed={panel === 'profile'} onClick={() => onPanel('profile')}
      aria-label={`Hồ sơ: ${s.character.displayName}, cấp ${s.progress.level}`}>
      <span className="hud3-avatar" aria-hidden="true">{initial}<span className="hud3-level">{s.progress.level}</span></span>
      <span className="hud3-who"><strong>{s.character.displayName}</strong><small>{playerTitle(kind, s.progress.level)}</small></span>
      <span className="hud3-xp"><small>{next === undefined ? 'Cấp tối đa' : `${have.toLocaleString('en-US')} / ${need.toLocaleString('en-US')} XP`}</small>
        <span className="hud3-xpbar" role="progressbar" aria-label="Kinh nghiệm" aria-valuemin={0} aria-valuemax={need} aria-valuenow={have}><span style={{ width: `${have / need * 100}%` }}/></span></span>
    </button>
    <div className="hud3-pill hud3-resources">
      <span className="hud3-cash" title="Tiền mặt"><GameIcon name="cash"/><strong>{money(s.wallet.cash)}</strong></span>
      {canCollect && <button type="button" className="hud3-collect" onClick={onCollect} title="Thu tiền tất cả công trình"><GameIcon name="collect"/></button>}
      <span className="hud3-divider" aria-hidden="true"/>
      <button type="button" className="hud3-chip" data-res="wood" aria-label="Gỗ (mua vật liệu)" aria-pressed={panel === 'materials'} onClick={() => onPanel('materials')}><GameIcon name="wood"/><strong>{s.wallet.wood.toLocaleString('en-US')}</strong></button>
      <button type="button" className="hud3-chip" data-res="stone" aria-label="Đá (mua vật liệu)" aria-pressed={panel === 'materials'} onClick={() => onPanel('materials')}><GameIcon name="stone"/><strong>{s.wallet.stone.toLocaleString('en-US')}</strong></button>
      <button type="button" className="hud3-chip" data-res={third.panel} aria-label={third.label} title={third.label} aria-pressed={panel === third.panel} onClick={() => onPanel(third.panel)}><GameIcon name={third.icon}/><strong>{third.value}</strong></button>
    </div>
    <div className="hud3-pill hud3-status">
      <button type="button" className="hud3-icon" aria-label="Thông báo" aria-pressed={panel === 'notifications'} onClick={() => onPanel('notifications')}><GameIcon name="mail"/>{unread && <span className="hud3-dot" aria-label="Có thông báo mới"/>}</button>
      <button type="button" className="hud3-icon" aria-label="Thành tích" aria-pressed={panel === 'profile'} onClick={() => onPanel('profile')}><GameIcon name="trophy"/></button>
      <button type="button" className="hud3-icon" aria-label="Cài đặt" aria-pressed={panel === 'settings'} onClick={() => onPanel('settings')}><GameIcon name="settings"/></button>
      <span className="hud3-divider" aria-hidden="true"/>
      <span className="hud3-clock"><GameIcon name={clockIcon(hour, night)}/><span><strong>Ngày {day}</strong><small>{now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small></span></span>
      {/* Sync state is shown in Cài đặt (owner request); this live region stays for screen readers and E2E checks. */}
      <span className={`sync-status visually-hidden ${connected ? 'is-on' : 'is-off'}`} role="status">{status}</span>
    </div>
  </header>;
}
