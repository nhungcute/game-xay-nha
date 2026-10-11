import { useState } from 'react';
import { catalog, economy } from '@xay-nha/content';
import type { CommandType, PlacedBridge, PlacedBuilding } from '@xay-nha/contracts';
import { access } from '@xay-nha/sim';
import type { WorldStore } from '../game/WorldStore';
import { duration, money, t } from '../i18n';
import { GameIcon } from './GameIcon';

type State = WorldStore['state'];
type Apply = (type: CommandType, payload: unknown) => void;

/** Batches a producer can still queue for `recipeId`: free queue room limited by the inputs in storage. */
export function maxBatches(state: State, building: PlacedBuilding, recipeId: string): number {
  const producer = catalog.buildings[building.defId]?.production, recipe = catalog.recipes[recipeId];
  if (!producer || !recipe) return 0;
  const queued = (building.slots ?? []).reduce((n, slot) => n + slot.length, 0);
  const room = producer.slots * producer.queueLimit - queued;
  const inputs = Object.entries(recipe.inputs).map(([id, count]) => Math.floor((state.snapshot.inventory[id] ?? 0) / count));
  return Math.max(0, Math.min(room, ...inputs));
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
      {building?.slots && <>
        <button onClick={() => apply('COLLECT_PRODUCTION', { buildingId: building.id })}>{t('collect')}</button>
        {building.slots.flat().map((job, index) => <p key={index}>{t(catalog.items[catalog.recipes[job.recipeId]!.output]!.nameKey)} · {duration(job.readyAt - now)}</p>)}
      </>}
      {confirmDemolish
        ? <div className="confirm-row" role="alertdialog" aria-label="Xác nhận phá">
          <p>Phá {def ? t(def.nameKey) : 'cầu'}? Hoàn lại {money(refund)} (50%).</p>
          <button className="danger" onClick={() => apply(building ? 'DEMOLISH' : 'REMOVE_BRIDGE', target)}>Phá</button>
          <button onClick={() => setConfirmDemolish(false)}>Giữ lại</button>
        </div>
        : <button className="demolish" onClick={() => setConfirmDemolish(true)}>{building ? t('demolish') : t('remove')}</button>}
    </>}
  </aside>;
}
