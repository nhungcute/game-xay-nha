import { useState } from 'react';
import { economy } from '@xay-nha/content';
import type { CommandType } from '@xay-nha/contracts';
import type { WorldStore } from '../game/WorldStore';
import { money, t } from '../i18n';
import { GameIcon } from './GameIcon';

type Material = 'wood' | 'stone';
export const MAX_BUY = 9999;

/** Parsed quantity of the input (whole units, 0 when empty/invalid, capped at MAX_BUY) and what it costs. */
export function buyQuote(raw: string, material: Material, cash: number): { count: number; total: number; affordable: boolean; max: number } {
  const price = economy.materialPrices[material], parsed = Math.floor(Number(raw));
  const count = Number.isFinite(parsed) ? Math.max(0, Math.min(MAX_BUY, parsed)) : 0;
  const total = count * price;
  return { count, total, affordable: count > 0 && total <= cash, max: Math.min(MAX_BUY, Math.floor(cash / price)) };
}

function MaterialRow({ material, owned, cash, apply }: { material: Material; owned: number; cash: number; apply: (type: CommandType, payload: unknown) => void }) {
  const [raw, setRaw] = useState('10');
  const quote = buyQuote(raw, material, cash), label = t(material);
  return <div className="item material-row">
    <span className="material-name"><GameIcon name={material}/><strong>{label}</strong><small>Đang có {owned.toLocaleString('vi-VN')}</small></span>
    <span className="material-price">{money(economy.materialPrices[material])} / đơn vị</span>
    <span className="material-buy">
      <input type="number" inputMode="numeric" min={1} max={MAX_BUY} step={1} value={raw} aria-label={`Số lượng ${label} cần mua`}
        onChange={event => setRaw(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && quote.affordable) apply('BUY_MATERIAL', { [material]: quote.count }); }}/>
      <button className="primary" disabled={!quote.affordable} onClick={() => apply('BUY_MATERIAL', { [material]: quote.count })}>
        {t('buy')}{quote.count > 0 ? ` · ${money(quote.total)}` : ''}</button>
    </span>
    {quote.count > 0 && !quote.affordable && <small className="material-note" role="status">Không đủ tiền · mua được tối đa {quote.max.toLocaleString('vi-VN')}</small>}
  </div>;
}

/** Vật liệu panel: per material a quantity box + Mua, with unit price, stock and the order total. */
export function MaterialShop({ state, apply }: { state: WorldStore['state']; apply: (type: CommandType, payload: unknown) => void }) {
  const wallet = state.snapshot.wallet;
  return <>{(['wood', 'stone'] as const).map(material =>
    <MaterialRow key={material} material={material} owned={wallet[material]} cash={wallet.cash} apply={apply}/>)}</>;
}
