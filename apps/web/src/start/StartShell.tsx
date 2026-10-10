import type { ReactNode } from 'react';
import { EntryIcon } from './EntryIcon';

export type EntryStage = 'boot' | 'maps' | 'create' | 'recover' | 'code';

export function StartShell({ stage, onHome, onRecover, children }: {
  stage: EntryStage; onHome: () => void; onRecover: () => void; children: ReactNode;
}) {
  return <main className={`start entry-${stage}`}>
    <div className="entry-container">
      <header className="entry-header">
        <div className="entry-brand" aria-label="AI Farm">
          <span className="entry-brand-mark"><EntryIcon name="home"/></span>
          <span><strong>AI FARM<span className="brand-dot">.</span></strong><small>Một nơi để trở về</small></span>
        </div>
        {stage !== 'boot' && stage !== 'code' && <button type="button" className="entry-header-action"
          onClick={stage === 'recover' ? onHome : onRecover}>
          <EntryIcon name={stage === 'recover' ? 'back' : 'key'}/>
          {stage === 'recover' ? 'Chọn vùng đất' : 'Đăng nhập'}
        </button>}
      </header>
      <div className="entry-content">{children}</div>
      <div className="entry-footer" role="contentinfo">
        <span><EntryIcon name="leaf"/> Xây từng chút. Vui mỗi ngày.</span>
        <span>Thế giới nhỏ, câu chuyện của bạn.</span>
      </div>
    </div>
  </main>;
}

export function EntryHeading({ eyebrow, title, description }: { eyebrow: string; title: ReactNode; description: string }) {
  return <div className="entry-heading">
    <p className="entry-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p>
  </div>;
}
