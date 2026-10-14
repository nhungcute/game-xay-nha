import { useEffect, useMemo, useState } from 'react';
import { catalog, economy } from '@xay-nha/content';
import { cellIndex, Surface, type Command, type CommandType } from '@xay-nha/contracts';
import { execute } from '@xay-nha/sim';
import type { Focus, Tool } from '../game/ToolController';
import type { WorldStore } from '../game/WorldStore';
import { duration, errorText, money, t } from '../i18n';
import { GameIcon } from './GameIcon';

type State = WorldStore['state'];
type IconName = Parameters<typeof GameIcon>[0]['name'];

/** One button of the object panel: a command on this object, or a shortcut into the matching map tool. */
export type ObjectAction =
  | { kind: 'command'; key: string; label: string; type: CommandType; payload: unknown; danger?: boolean; needLevel?: number }
  | { kind: 'tool'; key: string; label: string; tool: Tool };
export interface ObjectDescription { title: string; icon: IconName; status: string; actions: ObjectAction[] }

const ENV_NAMES: Record<string, string> = {
  tree_deciduous: 'Cây lá rộng', tree_conifer: 'Cây thông', rock: 'Đá tảng', rock_large: 'Đá lớn',
  bush: 'Bụi cây', reed: 'Lau sậy', flower: 'Hoa dại',
};
const ROAD_TIER_NAMES = ['', 'Đường đất', 'Đường lát đá', 'Đường nhựa'] as const;

/** Scenery family as the sim's CLEAR_ENV sees it (engine.ts): scatter category → tree / rock / rock_large / bush. */
function envCategory(state: State, assetId: string): string {
  return state.template.env.scatter.find(spec => spec.assetIds.includes(assetId))?.category ?? assetId.replace(/_\d+$/, '');
}

/** Title, status line and actions for a picked object; null when it is gone (cleared, harvested, road removed). */
export function describeFocus(state: State, focus: Focus): ObjectDescription | null {
  const s = state, i = cellIndex(...focus.cell), [x, z] = focus.cell;
  if (focus.kind === 'env') {
    const env = s.env.find(e => e.id === focus.id);
    if (!env || s.snapshot.delta.removedEnvIds.includes(env.id)) return null;
    const category = envCategory(s, env.assetId);
    const family = category.startsWith('tree') ? 'tree' : category.startsWith('rock_large') ? 'rock_large' : category.startsWith('rock') ? 'rock' : 'bush';
    const label = family === 'tree' ? 'Chặt cây' : family === 'rock' ? 'Đập đá' : family === 'rock_large' ? 'Đập đá lớn' : 'Phát dọn';
    return {
      title: ENV_NAMES[category] ?? 'Cây cỏ', icon: family === 'tree' ? 'forest' : family.startsWith('rock') ? 'stone' : 'clear',
      status: env.footprint > 1 ? `Chiếm ${env.footprint} × ${env.footprint} ô` : 'Chiếm 1 ô',
      actions: [
        { kind: 'command', key: 'clear', label, type: 'CLEAR_ENV', payload: { envIds: [env.id] } },
        { kind: 'tool', key: 'clear-tool', label: 'Dọn nhiều (công cụ Dọn)', tool: 'clear' },
      ],
    };
  }
  if (focus.kind === 'crop') {
    const crop = s.snapshot.crops.find(c => cellIndex(...c.cell) === i), def = crop && catalog.crops[crop.cropId];
    if (!crop || !def) return null;
    const left = crop.readyAt - s.snapshot.serverTime;
    return {
      title: t(def.nameKey), icon: 'crops', status: left <= 0 ? 'Đã chín, thu hoạch được' : `Còn ${duration(left)} nữa chín`,
      actions: [
        { kind: 'command', key: 'harvest', label: 'Thu hoạch', type: 'HARVEST', payload: { cells: [focus.cell] } },
        { kind: 'tool', key: 'harvest-tool', label: 'Thu hoạch cả ruộng (kéo)', tool: 'harvest' },
      ],
    };
  }
  if (focus.kind === 'road') {
    const tier = s.roadTier[i] as 0 | 1 | 2 | 3;
    if (!tier) return null;
    const upgrades: ObjectAction[] = ([2, 3] as const).filter(next => next > tier && economy.roadTiers[next].mapKinds.includes(s.template.mapKind))
      .map(next => ({ kind: 'command', key: `tier-${next}`, label: `Nâng lên ${ROAD_TIER_NAMES[next]}`, type: 'BUILD_ROAD',
        payload: { cells: [focus.cell], tier: next }, needLevel: economy.roadTiers[next].unlockLevel }));
    return {
      title: ROAD_TIER_NAMES[tier], icon: 'road', status: `Cấp ${tier}/3`,
      actions: [
        ...upgrades,
        { kind: 'command', key: 'remove', label: 'Xóa đường', type: 'REMOVE_ROAD', payload: { cells: [focus.cell] }, danger: true },
        { kind: 'tool', key: 'road-tool', label: 'Sửa nhiều ô (công cụ Đường)', tool: 'road' },
      ],
    };
  }
  if (s.surface[i] !== Surface.TILLED || s.snapshot.crops.some(c => cellIndex(...c.cell) === i)) return null;
  return {
    title: 'Đất đã cuốc', icon: 'till', status: 'Chưa gieo hạt',
    actions: [
      { kind: 'tool', key: 'plant-tool', label: 'Gieo hạt (công cụ Gieo)', tool: 'plant' },
      { kind: 'command', key: 'untill', label: 'Bỏ cuốc', type: 'UNTILL', payload: { rect: [x, z, x, z] } },
    ],
  };
}

export interface ActionOutcome { valid: boolean; code?: string; text: string }

/** Runs the command on a copy of the state (the sim is pure) and reports what it would cost and give back. */
export function actionOutcome(state: State, command: Command, now: number): ActionOutcome {
  const run = execute(state, command, now);
  if (!run.result.accepted) return { valid: false, code: run.result.code, text: errorText(run.result.code) };
  const before = state.snapshot, after = run.state.snapshot, parts: string[] = [];
  const cash = after.wallet.cash - before.wallet.cash, wood = after.wallet.wood - before.wallet.wood, stone = after.wallet.stone - before.wallet.stone;
  if (cash) parts.push(`${cash > 0 ? '+' : '−'}${money(Math.abs(cash))}`);
  if (wood) parts.push(`${wood > 0 ? '+' : '−'}${Math.abs(wood)} gỗ`);
  if (stone) parts.push(`${stone > 0 ? '+' : '−'}${Math.abs(stone)} đá`);
  for (const [id, count] of Object.entries(after.inventory)) {
    const gained = count - (before.inventory[id] ?? 0);
    if (gained > 0) parts.push(`+${gained} ${t(catalog.items[id]?.nameKey ?? id)}`);
  }
  return { valid: true, text: parts.join(' · ') || 'Miễn phí' };
}

/** D033: side panel for a picked tree, rock, bush, crop, road or tilled cell — the tools that act on it, priced. */
export function ObjectPanel({ state, focus, makeCommand, now, apply, onTool, onClose }: {
  state: State; focus: Focus; makeCommand: (type: CommandType, payload: unknown) => Command; now: number;
  apply: (type: CommandType, payload: unknown) => void; onTool: (tool: Tool) => void; onClose: () => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const info = useMemo(() => describeFocus(state, focus), [state, focus]);
  const outcomes = useMemo(() => new Map((info?.actions ?? []).flatMap(action => action.kind === 'command'
    ? [[action.key, actionOutcome(state, makeCommand(action.type, action.payload), now)] as const] : [])),
  // Re-priced when the world changes (`now` only moves with it), not on every render.
  [state, info]);
  useEffect(() => { if (!info) onClose(); }, [info, onClose]);
  if (!info) return null;
  const level = state.snapshot.progress.level;
  return <aside className="side panel building-detail object-detail">
    <button className="close" aria-label="Đóng bảng" onClick={onClose}><GameIcon name="close"/></button>
    <span className="building-detail-eyebrow">Đang chọn</span>
    <h2><GameIcon name={info.icon}/>{info.title}</h2>
    <p className="building-status">{info.status}</p>
    {info.actions.map(action => {
      if (action.kind === 'tool') return <button key={action.key} className="object-tool" onClick={() => onTool(action.tool)}><GameIcon name={action.tool}/>{action.label}</button>;
      const outcome = outcomes.get(action.key), locked = action.needLevel !== undefined && level < action.needLevel;
      const detail = locked ? `Cần cấp ${action.needLevel}` : outcome?.text ?? '';
      if (confirm === action.key) return <div key={action.key} className="confirm-row" role="alertdialog" aria-label={`Xác nhận ${action.label}`}>
        <p>{action.label}? {detail}</p>
        <button className="danger" onClick={() => { setConfirm(null); apply(action.type, action.payload); }}>{action.label}</button>
        <button onClick={() => setConfirm(null)}>Giữ lại</button>
      </div>;
      return <button key={action.key} className={action.danger ? 'demolish' : 'primary'} disabled={locked || !outcome?.valid}
        onClick={() => action.danger ? setConfirm(action.key) : apply(action.type, action.payload)}>
        <span>{action.label}</span><small className="object-outcome">{detail}</small>
      </button>;
    })}
  </aside>;
}
