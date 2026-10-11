import type { ReactNode } from 'react';
import { EntryIcon } from './EntryIcon';

export type EntryStage = 'boot' | 'maps' | 'register' | 'login';

export function StartShell({ stage, signedIn, onHome, onLogin, onLogout, children }: {
  stage: EntryStage; signedIn: string | null; onHome: () => void; onLogin: () => void; onLogout: () => void; children: ReactNode;
}) {
  const action = stage === 'boot' ? null
    : stage !== 'maps' ? { icon: 'back' as const, label: 'Chọn vùng đất', run: onHome }
      : signedIn ? { icon: 'back' as const, label: `Đăng xuất · ${signedIn}`, run: onLogout }
        : { icon: 'key' as const, label: 'Đăng nhập', run: onLogin };
  return <main className={`start entry-${stage}`}>
    <div className="entry-container">
      <header className="entry-header">
        <div className="entry-brand" aria-label="AI Farm">
          <span className="entry-brand-mark"><EntryIcon name="home"/></span>
          <span><strong>AI FARM<span className="brand-dot">.</span></strong><small>Một nơi để trở về</small></span>
        </div>
        {action && <button type="button" className="entry-header-action" onClick={action.run}><EntryIcon name={action.icon}/>{action.label}</button>}
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
