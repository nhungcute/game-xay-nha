import { catalog, economy } from '@xay-nha/content';
import type { MapKind } from '@xay-nha/contracts';
import { t } from '../i18n';
import { GameIcon } from './GameIcon';

const BRIDGE_NAME: Record<string, string> = { bridge_wood: 'Cầu gỗ', bridge_stone: 'Cầu đá', bridge_concrete: 'Cầu bê tông' };
const ROAD_NAME: Record<string, string> = { 2: 'Đường lát đá', 3: 'Đường nhựa' };

/** Everything that becomes available exactly at `level` on this map (pure; unit-tested). */
export function unlocksAt(kind: MapKind, level: number): string[] {
  const items: string[] = [];
  for (const def of Object.values(catalog.buildings)) {
    if (!def.mapKinds.includes(kind)) continue;
    if (def.unlockLevel === level) items.push(t(def.nameKey));
    const extra = def.unlockLevels?.indexOf(level) ?? -1;
    if (extra > 0) items.push(`${t(def.nameKey)} thứ ${extra + 1}`);
  }
  if (kind === 'farm') for (const crop of Object.values(catalog.crops)) if (crop.unlockLevel === level) items.push(`Giống ${t(crop.nameKey)}`);
  for (const bridge of Object.values(catalog.bridges)) if (bridge.unlockLevel === level) items.push(BRIDGE_NAME[bridge.id] ?? bridge.id);
  for (const [tier, def] of Object.entries(economy.roadTiers)) if (def.unlockLevel === level && ROAD_NAME[tier]) items.push(ROAD_NAME[tier]!);
  if (economy.embank.unlockLevel === level) items.push('Kè bờ');
  const builders = economy.construction.builders.find(row => row.unlockLevel === level);
  if (builders && level > 1) items.push(`Đội thợ thứ ${builders.count}`);
  return items;
}

export function LevelUpCard({ kind, level, onClose }: { kind: MapKind; level: number; onClose: () => void }) {
  const items = unlocksAt(kind, level);
  return <div className="levelup-backdrop" role="dialog" aria-modal="true" aria-labelledby="levelup-title" onClick={onClose}>
    <div className="levelup-card" onClick={event => event.stopPropagation()}>
      <span className="levelup-badge"><GameIcon name="level"/>{level}</span>
      <h2 id="levelup-title">Lên cấp {level}!</h2>
      {items.length ? <><p>Vừa mở khóa:</p><ul>{items.map(item => <li key={item}><GameIcon name="lock"/>{item}</li>)}</ul></>
        : <p>Giới hạn số công trình đã tăng. Tiếp tục mở rộng vùng đất nhé!</p>}
      <button type="button" className="primary" autoFocus onClick={onClose}>Tuyệt!</button>
    </div>
  </div>;
}
