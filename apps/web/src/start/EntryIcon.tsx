type IconName = 'home' | 'leaf' | 'arrow' | 'back' | 'key' | 'check' | 'lock' | 'sun' | 'coin' | 'town';

const paths: Record<IconName, string> = {
  home: 'M3 11 12 3l9 8M5 9v12h14V9M9 21v-8h6v8',
  leaf: 'M20 4C9 2 3 7 5 14c2 7 15 8 15-10ZM4 21 15 10M9 16v-5M9 16h5',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  back: 'M20 12H4m6-6-6 6 6 6',
  key: 'M14 4a6 6 0 1 0 6 6 6 6 0 0 0-6-6ZM9 14l-6 6v2h4v-3h3l2-2M16 8h.01',
  check: 'm5 12 4 4L19 6',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3',
  sun: 'M12 3V1M12 23v-2M3 12H1M23 12h-2M4 4l2 2m12 12 2 2M20 4l-2 2M6 18l-2 2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  town: 'M3 21V10l5-3 5 3v11M13 21V14l4-2.5 4 2.5v7M2 21h20M6 14h2m-2 3h2m7 1h2',
  coin: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM14 8h-3a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-3M12 6v12',
};

export function EntryIcon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`entry-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={paths[name]}/>
  </svg>;
}
