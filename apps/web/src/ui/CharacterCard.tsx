import { economy } from '@xay-nha/content';
import type { WorldSnapshot } from '@xay-nha/contracts';
import { GameIcon } from './GameIcon';
import { t } from '../i18n';

export function CharacterCard({ snapshot, active, onClick }: { snapshot: WorldSnapshot; active: boolean; onClick: () => void }) {
  const { character, progress, mapKind } = snapshot;
  const thresholds = economy.xp.cumulative[mapKind];
  const floor = thresholds[progress.level] ?? 0, next = thresholds[progress.level + 1];
  const total = next === undefined ? 1 : Math.max(1, next - floor);
  const earned = next === undefined ? 1 : Math.min(total, Math.max(0, progress.xp - floor));
  const percent = earned / total * 100;
  const xpText = next === undefined ? 'Cấp tối đa' : `${earned.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} XP`;
  const initials = character.displayName.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] ?? '').join('').toLocaleUpperCase('vi');
  return <button type="button" className={`brand player-card ${mapKind}`} onClick={onClick} aria-pressed={active}
    aria-label={`${t('profile')}: ${character.displayName}, cấp ${progress.level}, ${xpText}`} title={`${character.displayName} · ${t('profile')}`}>
    <span className="player-avatar" aria-hidden="true"><span>{initials || <GameIcon name={mapKind}/>}</span>
      <span className="player-level"><GameIcon name="level"/>{progress.level}</span></span>
    <span className="player-identity">
      <span className="player-map">XÂY NHÀ <span>· {mapKind === 'city' ? 'THÀNH PHỐ' : 'QUÊ'}</span></span>
      <span className="player-name-line"><strong className="player-name">{character.displayName}</strong><small>#{character.tag}</small></span>
      <span className="player-xp-label"><span>Cấp {progress.level}</span><span>{xpText}</span></span>
      <span className="player-xp" role="progressbar" aria-label="Kinh nghiệm lên cấp" aria-valuemin={0}
        aria-valuemax={total} aria-valuenow={earned} aria-valuetext={xpText}><span style={{ width: `${percent}%` }}/></span>
    </span>
  </button>;
}
