import { useEffect, useRef } from 'react';
import type { MapKind } from '@xay-nha/contracts';
import type { Tool } from '../game/ToolController';
import { t } from '../i18n';
import { GameIcon } from './GameIcon';

const GROUPS: { id: string; label: string; tools: Tool[]; farmOnly?: boolean }[] = [
  { id: 'explore', label: 'Khám phá', tools: ['explore', 'zone'] },
  { id: 'build', label: 'Xây dựng', tools: ['build', 'demolish'] },
  { id: 'terrain', label: 'Hạ tầng', tools: ['clear', 'terraform', 'road', 'embank', 'bridge'] },
  { id: 'farm', label: 'Nông trại', tools: ['till', 'plant', 'harvest'], farmOnly: true },
];

export function ToolDock({ kind, selected, hint, onChoose }: { kind: MapKind; selected: Tool; hint?: Tool; onChoose: (tool: Tool) => void }) {
  const groups = GROUPS.filter(group => !group.farmOnly || kind === 'farm');
  const activeGroup = groups.find(group => group.tools.includes(selected)) ?? groups[0]!;
  const buttons = useRef(new Map<Tool, HTMLButtonElement>());
  const strip = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const button = buttons.current.get(selected), nav = strip.current;
    if (!button || !nav) return;
    // Scroll only the tool strip; selection stays immediately visible without moving the page.
    const target = button.getBoundingClientRect(), viewport = nav.getBoundingClientRect();
    nav.scrollLeft += target.left - viewport.left - (nav.clientWidth - target.width) / 2;
  }, [selected]);
  return <div className="tool-dock">
    <nav className="tool-categories" aria-label="Nhóm công cụ">{groups.map(group => <button type="button" key={group.id}
      aria-label={group.label} aria-pressed={activeGroup.id === group.id} onClick={() => onChoose(group.tools.includes(selected) ? selected : group.tools[0]!)}>
      {group.label}{hint && group.tools.includes(hint) && activeGroup.id !== group.id && <span className="category-hint" aria-label="Có công cụ hướng dẫn"/>}
    </button>)}</nav>
    <nav className="tools panel" aria-label="Công cụ" ref={strip}>{groups.map(group => <div className={`tool-group group-${group.id}`} key={group.id}
      role="group" aria-label={group.label}><span className="tool-group-title">{group.label}</span><div className="tool-group-buttons">
      {group.tools.map(tool => <button type="button" ref={element => { if (element) buttons.current.set(tool, element); else buttons.current.delete(tool); }}
        aria-pressed={selected === tool} className={`${selected === tool ? 'selected' : ''} ${hint === tool && selected !== tool ? 'hint' : ''}`}
        key={tool} title={t(tool)} onClick={() => onChoose(tool)}><GameIcon name={tool}/><span>{t(tool)}</span></button>)}
    </div></div>)}</nav>
  </div>;
}
