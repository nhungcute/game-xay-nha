import { catalog } from '@xay-nha/content';
import { authoredQuestProgress } from '@xay-nha/sim';
import type { WorldStore } from '../game/WorldStore';
import type { Tool } from '../game/ToolController';
import { money, t } from '../i18n';
import { GameIcon } from './GameIcon';

interface Props {
  state: WorldStore['state']; hint?: { tool: Tool; text: string };
  onHide: () => void; onSkip: () => void; onClaim: (id: string) => void; onChoose: (action: string) => void;
}
export function QuestGuide({ state, hint, onHide, onSkip, onClaim, onChoose }: Props) {
  const { mapKind, progress } = state.snapshot, quests = catalog.quests[mapKind], quest = quests[progress.questIndex];
  if (!quest) return null;
  const earned = Math.min(quest.target, authoredQuestProgress(state)), complete = earned >= quest.target;
  return <aside className="quest panel reference-guide">
    <div className="guide-heading"><GameIcon name="farm"/><strong>Hướng dẫn</strong>
      <button aria-label="Ẩn hướng dẫn" onClick={onHide}><GameIcon name="down"/></button></div>
    <div className={`guide-current ${complete ? 'is-complete' : ''}`}>
      <span className="guide-check"><GameIcon name={complete ? 'confirm' : 'level'}/></span>
      <div className="guide-copy"><small>{t('quests')} {progress.questIndex + 1}/{quests.length}</small><strong>{t(quest.nameKey)}</strong>
        {hint && <div className="tutor" role="note">{hint.text}<button className="link" onClick={onSkip}>{t('skipTutorial')}</button></div>}
        <span className="guide-progress">{earned}/{quest.target}<button aria-label="Chọn công cụ hướng dẫn" onClick={() => onChoose(quest.action)}><GameIcon name="next"/></button></span>
      </div>
    </div>
    {quests.slice(progress.questIndex + 1, progress.questIndex + 3).map(next => <button key={next.id} className="guide-next" onClick={() => onChoose(next.action)}>
      <span className="guide-empty-check"/><span><strong>{t(next.nameKey)}</strong><small>Tiếp theo · {next.xp} XP</small></span><GameIcon name="next"/>
    </button>)}
    <button className="guide-reward" disabled={!complete} onClick={() => onClaim(quest.id)}>
      <GameIcon name="gift"/><span>{t('claim')}</span><GameIcon name="cash"/><strong>{money(quest.reward.cash)}</strong><small>+{quest.xp} XP</small>
    </button>
  </aside>;
}
