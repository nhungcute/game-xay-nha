import { useState } from 'react';
import { catalog, economy } from '@xay-nha/content';
import type { CommandType, PlacedBridge, PlacedBuilding } from '@xay-nha/contracts';
import { access, currentTier, slotCount, tierDef, upgradeCost, upgradeSeconds, upgradeable } from '@xay-nha/sim';
import type { WorldStore } from '../game/WorldStore';
import { duration, money, t } from '../i18n';
import { GameIcon } from './GameIcon';

type State = WorldStore['state'];
type Apply = (type: CommandType, payload: unknown) => void;

/** Batches a producer can still queue for `recipeId`: free queue room limited by the inputs in storage. */
export function maxBatches(state: State, building: PlacedBuilding, recipeId: string): number {
  const def = catalog.buildings[building.defId], producer = def?.production, recipe = catalog.recipes[recipeId];
  if (!def || !producer || !recipe) return 0;
  const queued = (building.slots ?? []).reduce((n, slot) => n + slot.length, 0);
  const room = slotCount(building, def) * producer.queueLimit - queued;
  const inputs = Object.entries(recipe.inputs).map(([id, count]) => Math.floor((state.snapshot.inventory[id] ?? 0) / count));
  return Math.max(0, Math.min(room, ...inputs));
}

/** What the next tier adds, in player terms (D028, docs/16 §6.5). */
function upgradeGain(building: PlacedBuilding, effect: number): string {
  const def = catalog.buildings[building.defId]!, pct = `+${Math.round(effect * 100)}%`, parts: string[] = [];
  if (def.baseRatePerHour) parts.push(`${pct} thu nhập`);
  if (def.population) parts.push(`${pct} dân số`);
  if (def.production) parts.push('+1 hàng sản xuất');
  if (def.storageBonus) parts.push(`${pct} sức chứa kho`);
  return parts.join(' · ');
}

/** Upgrade block: current tier, next tier's price/time/gain, or the running upgrade with speed-up/cancel. */
function UpgradeRow({ state, building, apply }: { state: State; building: PlacedBuilding; apply: Apply }) {
  const def = catalog.buildings[building.defId]!, tier = currentTier(building), max = economy.upgrades.maxTier;
  if (!upgradeable(def)) return null;
  const now = state.snapshot.serverTime, target = { buildingId: building.id };
  if (building.upgrade) {
    const cost = upgradeCost(def, building.upgrade.tier);
    return <div className="upgrade-row is-running">
      <span className="upgrade-head"><GameIcon name="build"/>Đang nâng lên cấp {building.upgrade.tier} · còn {duration(building.upgrade.endsAt - now)}</span>
      <button onClick={() => apply('SPEED_UP', target)}>{t('speed')}</button>
      <button onClick={() => apply('CANCEL_CONSTRUCTION', target)}>{t('cancel')} · hoàn {money(cost.cash)}</button>
    </div>;
  }
  if (tier >= max) return <div className="upgrade-row"><span className="upgrade-head"><GameIcon name="level"/>Cấp {tier}/{max} · tối đa</span></div>;
  const next = (tier + 1) as 2 | 3, row = tierDef(next), cost = upgradeCost(def, next), level = state.snapshot.progress.level;
  const wallet = state.snapshot.wallet, short = wallet.cash < cost.cash || wallet.wood < cost.wood || wallet.stone < cost.stone;
  const price = [money(cost.cash), cost.wood ? `${cost.wood} gỗ` : '', cost.stone ? `${cost.stone} đá` : ''].filter(Boolean).join(' + ');
  return <div className="upgrade-row">
    <span className="upgrade-head"><GameIcon name="level"/>Cấp {tier}/{max}</span>
    <span className="upgrade-gain">Cấp {next}: {upgradeGain(building, row.effect)} · {duration(upgradeSeconds(def, next) * 1000)}</span>
    <button className="primary" disabled={level < row.unlockLevel || short} onClick={() => apply('UPGRADE_BUILDING', target)}>
      {level < row.unlockLevel ? `Cần cấp ${row.unlockLevel}` : `Nâng cấp · ${price}`}</button>
  </div>;
}

/** Side panel for the selected building or bridge. Demolition asks once more (G4 review), production picks a batch count. */
export function BuildingPanel({ state, building, bridge, apply, onClose }: {
  state: State; building?: PlacedBuilding; bridge?: PlacedBridge; apply: Apply; onClose: () => void;
}) {
  const [confirmDemolish, setConfirmDemolish] = useState(false);
  const object = building ?? bridge!, def = building ? catalog.buildings[building.defId] : undefined;
  const now = state.snapshot.serverTime, refund = Math.floor(object.investedValue * economy.construction.refund);
  const target = building ? { buildingId: object.id } : { bridgeId: object.id };
  return <aside className="side panel building-detail" key={object.id}>
    <button className="close" aria-label="Đóng bảng" onClick={onClose}><GameIcon name="close"/></button>
    <span className="building-detail-eyebrow">Công trình đang chọn</span>
    <h2><GameIcon name={building ? 'build' : 'bridge'}/>{def ? t(def.nameKey) : 'Cầu'}</h2>
    <p className="building-status">{object.status === 'CONSTRUCTING' ? `${t('progress')} ${duration(object.buildEndsAt - now)}` : t('active')}</p>
    {object.status === 'CONSTRUCTING' ? <>
      <button onClick={() => apply('SPEED_UP', target)}>{t('speed')}</button>
      <button onClick={() => apply('CANCEL_CONSTRUCTION', target)}>{t('cancel')} · 100%</button>
    </> : <>
      {building && <p>{access(state, building) ? t('active') : t('noRoad')}</p>}
      {building && def?.baseRatePerHour ? <>
        <p>{t('income')} {money(state.rates[building.id] ?? 0)}/h · {t('waiting')} {money(building.accrued ?? 0)}</p>
        <button disabled={(building.accrued ?? 0) < 1} onClick={() => apply('COLLECT', { buildingIds: [building.id] })}><GameIcon name="cash"/>{t('collectMoney')}</button>
      </> : null}
      {building && def?.production?.recipes.map(id => {
        const max = maxBatches(state, building, id), item = t(catalog.items[catalog.recipes[id]!.output]!.nameKey);
        return <div className="produce-row" key={id}><span>{t('produce')} · {item}</span>
          {[1, 5].filter(n => n < max).map(n => <button key={n} onClick={() => apply('START_PRODUCTION', { buildingId: building.id, recipeId: id, count: n })}>×{n}</button>)}
          <button disabled={!max} onClick={() => apply('START_PRODUCTION', { buildingId: building.id, recipeId: id, count: max })}>{max ? `Tối đa ×${max}` : 'Thiếu nguyên liệu'}</button>
        </div>;
      })}
      {building && <UpgradeRow state={state} building={building} apply={apply}/>}
      {building?.slots && <>
        <button onClick={() => apply('COLLECT_PRODUCTION', { buildingId: building.id })}>{t('collect')}</button>
        {building.slots.flat().map((job, index) => <p key={index}>{t(catalog.items[catalog.recipes[job.recipeId]!.output]!.nameKey)} · {duration(job.readyAt - now)}</p>)}
      </>}
      {building?.upgrade ? null : confirmDemolish
        ? <div className="confirm-row" role="alertdialog" aria-label="Xác nhận phá">
          <p>Phá {def ? t(def.nameKey) : 'cầu'}? Hoàn lại {money(refund)} (50%).</p>
          <button className="danger" onClick={() => apply(building ? 'DEMOLISH' : 'REMOVE_BRIDGE', target)}>Phá</button>
          <button onClick={() => setConfirmDemolish(false)}>Giữ lại</button>
        </div>
        : <button className="demolish" onClick={() => setConfirmDemolish(true)}>{building ? t('demolish') : t('remove')}</button>}
    </>}
  </aside>;
}
