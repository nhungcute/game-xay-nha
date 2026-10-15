import { catalog, economy } from '@xay-nha/content';
import type { RepeatQuest } from '@xay-nha/contracts';
import { authoredQuestProgressFor, claimedQuestIds, openQuests, reliefAvailable, repeatQuestProgress } from '@xay-nha/sim';
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
  onRelief: () => void;
}
export function MissionPanel({ state, open: isOpen, hint, onToggle, onSkipHints, onClaim, onReroll, onChoose, onRelief }: Props) {
  const s = state.snapshot, quests = catalog.quests[s.mapKind], index = claimedQuestIds(state).length;
  // Parallel quests (D041): up to five open at once, claimable in any order; finished ones float to the top.
  const open = openQuests(state).map(q => ({ q, earned: authoredQuestProgressFor(state, q.id) }))
    .map((row, order) => ({ ...row, order, done: row.earned >= row.q.target }))
    .sort((a, b) => Number(b.done) - Number(a.done) || a.order - b.order);
  const quest = open[0]?.q;
  const hintId = open.find(row => !row.done)?.q.id;
  const repeat = !quest ? s.progress.repeat?.active ?? [] : [];
  const heading = quest ? `${index}/${quests.length}` : `${repeat.filter(q => repeatQuestProgress(state, q) >= q.target).length}/${repeat.length}`;
  return <aside className={`hud3-pill hud3-missions ${isOpen ? '' : 'is-closed'}`} aria-label="Nhiệm vụ">
    <button type="button" className="hud3-missions-head" aria-expanded={isOpen} onClick={onToggle}>
      <strong>{quest ? 'Nhiệm vụ' : 'Nhiệm vụ hằng ngày'}</strong><small>{heading}</small><GameIcon name={isOpen ? 'up' : 'down'}/>
    </button>
    {/* D028 §9.1: a stuck player always sees the relief offer, even with the panel folded. */}
    {reliefAvailable(state, s.serverTime) && <div className="hud3-mission is-active is-done hud3-relief">
      <span className="hud3-mission-icon"><GameIcon name="gift"/></span>
      <div className="hud3-mission-copy"><strong>Trợ cấp khẩn cấp</strong>
        <small className="hud3-reward">Hết tiền và chưa có nguồn thu? Nhận {money(economy.relief.amount)} để làm lại từ đầu (mỗi {economy.relief.cooldownHours} giờ một lần).</small>
        <button type="button" className="hud3-claim" onClick={onRelief}><GameIcon name="cash"/>Nhận {money(economy.relief.amount)}</button>
      </div>
    </div>}
    {isOpen && open.map(({ q, earned, done }) => <div key={q.id} className={`hud3-mission is-active ${done ? 'is-done' : ''}`}>
      <button type="button" className="hud3-mission-icon" aria-label="Chọn công cụ cho nhiệm vụ" title="Chọn công cụ" onClick={() => onChoose(q.action)}><GameIcon name={ACTION_ICON[q.action] ?? 'quests'}/></button>
      <div className="hud3-mission-copy">
        <strong>{t(q.nameKey)}</strong>
        {hint && q.id === hintId && <p className="hud3-mission-desc">{hint} <button type="button" className="link" onClick={onSkipHints}>{t('skipTutorial')}</button></p>}
        {done
          ? <button type="button" className="hud3-claim" onClick={() => onClaim(q.id)}><GameIcon name="gift"/>Nhận thưởng · {money(q.reward.cash)}{q.xp ? ` · +${q.xp} XP` : ''}</button>
          : <Progress value={earned} target={q.target}/>}
      </div>
    </div>)}
    {isOpen && !quest && repeat.map(q => {
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
