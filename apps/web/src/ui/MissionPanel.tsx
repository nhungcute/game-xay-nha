import { catalog } from '@xay-nha/content';
import type { RepeatQuest } from '@xay-nha/contracts';
import { authoredQuestProgress, repeatQuestProgress } from '@xay-nha/sim';
import type { WorldStore } from '../game/WorldStore';
import { duration, money, t } from '../i18n';
import { GameIcon, type GameIconName } from './GameIcon';

type State = WorldStore['state'];
const ACTION_ICON: Record<string, GameIconName> = {
  CLEAR: 'forest', ROAD: 'road', TERRAFORM: 'terraform', BUILD: 'buildings', COLLECT: 'cash', POPULATION: 'people', UNLOCK_ZONE: 'zone',
  EMBANK: 'embank', BRIDGE: 'bridge', TILL: 'till', PLANT: 'farm', HARVEST: 'wheat', SELL: 'cash', PRODUCE: 'inventory',
};
const REPEAT_ICON: Record<RepeatQuest['template'], GameIconName> = {
  collect_cash: 'cash', build_type: 'buildings', road_cells: 'road', embank_cells: 'embank', population: 'people',
  harvest_crop: 'wheat', sell_item: 'cash', produce_item: 'inventory', till_cells: 'till',
};
export function repeatTitle(q: RepeatQuest): string {
  const name = (key: string | undefined) => (key ? t(key) : '');
  switch (q.template) {
    case 'collect_cash': return `Thu ${money(q.target)} tiền thuê và kinh doanh`;
    case 'build_type': return `Xây ${q.target} ${name(catalog.buildings[q.subject!]?.nameKey)}`;
    case 'road_cells': return `Làm hoặc nâng cấp ${q.target} ô đường`;
    case 'embank_cells': return `Kè ${q.target} ô bờ`;
    case 'population': return `Đạt ${q.target} dân`;
    case 'harvest_crop': return `Thu hoạch ${q.target} ô ${name(catalog.crops[q.subject!]?.nameKey)}`;
    case 'sell_item': return `Bán ${q.target} ${name(catalog.items[q.subject!]?.nameKey)}`;
    case 'produce_item': return `Thu ${q.target} sản phẩm từ ${name(catalog.buildings[q.subject!]?.nameKey)}`;
    case 'till_cells': return `Cuốc ${q.target} ô đất`;
  }
}

function Progress({ value, target }: { value: number; target: number }) {
  const shown = Math.min(value, target);
  return <span className="hud3-progress"><span className="hud3-bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={shown}>
    <span style={{ width: `${shown / Math.max(1, target) * 100}%` }}/></span><small>{shown}/{target}</small></span>;
}

interface Props {
  state: State; open: boolean; hint?: string;
  onToggle: () => void; onSkipHints: () => void; onClaim: (id: string) => void; onReroll: (id: string) => void; onChoose: (action: string) => void;
}
export function MissionPanel({ state, open, hint, onToggle, onSkipHints, onClaim, onReroll, onChoose }: Props) {
  const s = state.snapshot, quests = catalog.quests[s.mapKind], index = s.progress.questIndex, quest = quests[index];
  const repeat = !quest ? s.progress.repeat?.active ?? [] : [];
  const heading = quest ? `${index}/${quests.length}` : `${repeat.filter(q => repeatQuestProgress(state, q) >= q.target).length}/${repeat.length}`;
  return <aside className={`hud3-pill hud3-missions ${open ? '' : 'is-closed'}`} aria-label="Nhiệm vụ">
    <button type="button" className="hud3-missions-head" aria-expanded={open} onClick={onToggle}>
      <strong>{quest ? 'Nhiệm vụ' : 'Nhiệm vụ hằng ngày'}</strong><small>{heading}</small><GameIcon name={open ? 'up' : 'down'}/>
    </button>
    {open && quest && (() => {
      const earned = authoredQuestProgress(state), done = earned >= quest.target;
      return <>
        <div className={`hud3-mission is-active ${done ? 'is-done' : ''}`}>
          <button type="button" className="hud3-mission-icon" aria-label="Chọn công cụ cho nhiệm vụ" title="Chọn công cụ" onClick={() => onChoose(quest.action)}><GameIcon name={ACTION_ICON[quest.action] ?? 'quests'}/></button>
          <div className="hud3-mission-copy">
            <strong>{t(quest.nameKey)}</strong>
            {hint && <p className="hud3-mission-desc">{hint} <button type="button" className="link" onClick={onSkipHints}>{t('skipTutorial')}</button></p>}
            {done
              ? <button type="button" className="hud3-claim" onClick={() => onClaim(quest.id)}><GameIcon name="gift"/>Nhận thưởng · {money(quest.reward.cash)}{quest.xp ? ` · +${quest.xp} XP` : ''}</button>
              : <Progress value={earned} target={quest.target}/>}
          </div>
        </div>
        {quests.slice(Math.max(0, index - 2), index).reverse().map(previous => <div key={previous.id} className="hud3-mission is-complete">
          <span className="hud3-check"><GameIcon name="confirm"/></span><s>{t(previous.nameKey)}</s></div>)}
      </>;
    })()}
    {open && !quest && repeat.map(q => {
      const value = repeatQuestProgress(state, q), done = value >= q.target, rerollReady = s.serverTime >= (s.progress.repeat?.rerollAt ?? 0);
      return <div key={q.id} className={`hud3-mission is-active ${done ? 'is-done' : ''}`}>
        <span className="hud3-mission-icon"><GameIcon name={REPEAT_ICON[q.template]}/></span>
        <div className="hud3-mission-copy"><strong>{repeatTitle(q)}</strong><small className="hud3-reward">{money(q.reward.cash)} · +{q.xp} XP</small>
          {done ? <button type="button" className="hud3-claim" onClick={() => onClaim(q.id)}><GameIcon name="gift"/>Nhận thưởng</button> : <Progress value={value} target={q.target}/>}
          {!done && <button type="button" className="link hud3-reroll" disabled={!rerollReady} onClick={() => onReroll(q.id)}
            title={rerollReady ? '' : `${t('rerollIn')} ${duration((s.progress.repeat?.rerollAt ?? 0) - s.serverTime)}`}>{t('reroll')}</button>}
        </div>
      </div>;
    })}
  </aside>;
}
