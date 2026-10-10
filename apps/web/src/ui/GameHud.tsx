import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { builderCapacity, fieldQuota, inventoryCount, populationAndJobs, storageCapacity } from '@xay-nha/sim';
import type { WorldStore } from '../game/WorldStore';
import { money, t } from '../i18n';
import { CharacterCard } from './CharacterCard';
import { GameIcon } from './GameIcon';

export type GamePanel = 'profile' | 'materials' | 'inventory' | 'settings';
const cashFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const compactCash = (cash: number) => cash >= 1_000_000 ? `$${cashFormatter.format(cash)}` : money(cash);

interface GameHudProps {
  state: WorldStore['state']; busy: number; status: string; connected: boolean; panel: GamePanel | null;
  hasBank: boolean; questsOpen: boolean; switchingMap: boolean;
  onMeasure: (element: HTMLElement | null) => void; onPanel: (panel: GamePanel) => void;
  onQuests: () => void; onCollect: () => void; onSwitchMap?: () => void;
}

export function GameHud({ state, busy, status, connected, panel, hasBank, questsOpen, switchingMap,
  onMeasure, onPanel, onQuests, onCollect, onSwitchMap }: GameHudProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const header = useRef<HTMLElement | null>(null), menuButton = useRef<HTMLButtonElement | null>(null), menuId = useId();
  const setHeader = useCallback((element: HTMLElement | null) => { header.current = element; onMeasure(element); }, [onMeasure]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!header.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const act = (action: () => void) => { setMenuOpen(false); action(); };
  const snapshot = state.snapshot, farm = snapshot.mapKind === 'farm';
  const people = farm ? null : populationAndJobs(state);
  return <header className="hud" ref={setHeader}>
    <CharacterCard snapshot={snapshot} active={panel === 'profile'} onClick={() => act(() => onPanel('profile'))}/>
    <div className="hud-wallet" title={`${t('money')}: ${money(snapshot.wallet.cash)}`}>
      <span className="wallet-icon"><GameIcon name="cash"/></span><div><small>Tiền mặt</small>
        <strong className="cash" aria-label={`${t('money')}: ${money(snapshot.wallet.cash)}`}>{compactCash(snapshot.wallet.cash)}</strong></div>
    </div>
    <div className="resources">
      <button type="button" className="resource-pill material-pill" aria-label={t('materials')} title={t('materials')}
        aria-pressed={panel === 'materials'} onClick={() => act(() => onPanel('materials'))}>
        <span><GameIcon name="wood"/><strong>{snapshot.wallet.wood.toLocaleString('vi-VN')}</strong></span>
        <span><GameIcon name="stone"/><strong>{snapshot.wallet.stone.toLocaleString('vi-VN')}</strong></span>
      </button>
      <span className="resource-pill resource-stat" title={t('builders')}><GameIcon name="builders"/>
        <span><small>{t('builders')}</small><strong>{busy}/{builderCapacity(state)}</strong></span></span>
      {farm ? <button type="button" className="resource-pill resource-stat" aria-label={t('inventory')} title={t('inventory')}
        aria-pressed={panel === 'inventory'} onClick={() => act(() => onPanel('inventory'))}><GameIcon name="inventory"/>
        <span><small>{t('storage')}</small><strong>{inventoryCount(state)}/{storageCapacity(state)}</strong></span></button>
        : <span className="resource-pill resource-stat" title="Dân số / Việc làm"><GameIcon name="people"/>
          <span><small>{t('people')}</small><strong>{people?.population ?? 0}/{people?.jobs ?? 0}</strong></span></span>}
      {hasBank && <button type="button" className="resource-pill collect-all" onClick={() => act(onCollect)}>
        <GameIcon name="collect"/><span>{t('collectAll')}</span></button>}
    </div>
    <button type="button" className="hud-menu-toggle" ref={menuButton} aria-label="Menu chức năng" aria-controls={menuId}
      aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><GameIcon name={menuOpen ? 'close' : 'menu'}/></button>
    <nav className={`game-menu ${menuOpen ? 'is-open' : ''}`} id={menuId} aria-label="Chức năng">
      <button type="button" aria-label={t('quests')} aria-expanded={questsOpen} className={questsOpen ? 'menu-active' : ''}
        onClick={() => act(onQuests)}><GameIcon name="quests"/><span>Nhiệm vụ</span></button>
      <button type="button" aria-label="Cài đặt" aria-pressed={panel === 'settings'} onClick={() => act(() => onPanel('settings'))}>
        <GameIcon name="settings"/><span>Cài đặt</span></button>
      {onSwitchMap && <button type="button" aria-label={t('switchMap')} title={t('switchMap')} disabled={switchingMap}
        onClick={() => act(onSwitchMap)}><GameIcon name="maps"/><span>{switchingMap ? 'Đang đổi…' : 'Đổi map'}</span></button>}
    </nav>
    <div className="sub-hud"><span className="hud-worth"><GameIcon name="profile"/>{t('worth')} <strong>{money(snapshot.character.netWorth)}</strong></span>
      {farm && <span className="hud-fields"><GameIcon name="farm"/>{t('fields')} {snapshot.crops.length}/{fieldQuota(state)}</span>}
      <span className={`connection-status ${connected ? 'is-connected' : 'is-disconnected'}`} role="status">
        <GameIcon name={connected ? 'online' : 'offline'}/>{status}</span>
    </div>
  </header>;
}
