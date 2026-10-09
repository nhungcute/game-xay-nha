import { useCallback, useEffect, useState } from 'react';
import { WorldTemplateSchema, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { Game } from './Game';
import { WorldStore } from './game/WorldStore';
import { api, ApiError, storage, type CharacterSummary, type MapInfo } from './net/api';
import { money, t } from './i18n';

const OFFLINE = import.meta.env.VITE_OFFLINE === '1';
const templateCache = new Map<string, Promise<WorldTemplate>>();
function loadTemplate(url: string): Promise<WorldTemplate> {
  let cached = templateCache.get(url);
  if (!cached) {
    cached = fetch(url).then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return WorldTemplateSchema.parse(await r.json()); });
    templateCache.set(url, cached);
    cached.catch(() => templateCache.delete(url));
  }
  return cached;
}
const templateUrl = (c: { mapId: string; templateVersion: number }) => `/worlds/${c.mapId}/template.v${c.templateVersion}.json`;

const NAME_ERRORS: Record<string, string> = {
  NAME_LENGTH: 'Tên cần từ 3 đến 20 ký tự.', NAME_CHARACTERS: 'Chỉ dùng chữ cái (có dấu), số và một khoảng trắng giữa các từ.',
  NAME_BLOCKED: 'Tên này không phù hợp, hãy chọn tên khác.', CHARACTER_EXISTS: 'Bạn đã có nhân vật ở bản đồ này.',
  RATE_LIMITED: 'Bạn tạo quá nhiều tài khoản, hãy thử lại sau.', MAP_UNAVAILABLE: 'Bản đồ này chưa mở.', NETWORK: 'Không kết nối được máy chủ.',
  INVALID_RECOVERY_CODE: 'Mã khôi phục không đúng.',
};
const errorMessage = (e: unknown): string => e instanceof ApiError ? NAME_ERRORS[e.code] ?? `Lỗi: ${e.code}` : e instanceof Error ? e.message : String(e);
const MAPS: { kind: MapKind; title: string; text: string }[] = [
  { kind: 'city', title: 'Thành phố', text: 'Xây phố, thu tiền thuê và kinh doanh' },
  { kind: 'farm', title: 'Quê', text: 'Cuốc đất, trồng trọt, chăn nuôi' },
];

type Screen =
  | { name: 'boot' } | { name: 'maps' } | { name: 'create'; kind: MapKind } | { name: 'recover' }
  | { name: 'code'; code: string; next: CharacterSummary } | { name: 'game'; character: CharacterSummary };

export function Root() {
  if (OFFLINE) return <Game loader={async () => {
    const template = await loadTemplate('/worlds/farm-g1/template.v1.json');
    return new WorldStore(template);
  }}/>;
  return <OnlineRoot/>;
}

function OnlineRoot() {
  const [screen, setScreen] = useState<Screen>({ name: 'boot' });
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async (): Promise<CharacterSummary[]> => {
    const list = storage.token() ? (await api.me()).characters : [];
    setCharacters(list); return list;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setMaps((await api.maps()).maps);
        const list = await refresh().catch(e => { if (e instanceof ApiError && e.status === 401) { storage.setToken(null); return []; } throw e; });
        const last = list.find(c => c.id === storage.lastWorld()) ?? (list.length === 1 ? list[0] : undefined);
        setScreen(last ? { name: 'game', character: last } : { name: 'maps' });
      } catch (e) { setError(errorMessage(e)); setScreen({ name: 'maps' }); }
    })();
  }, [refresh]);

  const play = (character: CharacterSummary) => { storage.setLastWorld(character.id); setError(''); setScreen({ name: 'game', character }); };

  if (screen.name === 'game') {
    const c = screen.character;
    return <Game key={c.id} loader={async () => {
      const template = await loadTemplate(templateUrl(c));
      return WorldStore.online(template, { send: commands => api.commands(c.id, commands), fetchSnapshot: () => api.snapshot(c.id) });
    }} onSwitchMap={async world => { await world.drain(); await refresh().catch(() => undefined); setScreen({ name: 'maps' }); }}/>;
  }
  return <main className="start">
    <section className="start-card panel">
      <h1>Xây Nhà</h1>
      {screen.name === 'boot' && <p>{t('loading')}</p>}
      {screen.name === 'maps' && <MapSelect maps={maps} characters={characters} onPlay={play} onCreate={kind => setScreen({ name: 'create', kind })} onRecover={() => setScreen({ name: 'recover' })}/>}
      {screen.name === 'create' && <CreateCharacter kind={screen.kind} suggestion={characters[0]?.displayName ?? ''} hasOther={characters.length > 0}
        onBack={() => setScreen({ name: 'maps' })}
        onCreated={(character, code) => { void refresh(); if (code) setScreen({ name: 'code', code, next: character }); else play(character); }}/>}
      {screen.name === 'code' && <RecoveryCode code={screen.code} onContinue={() => play(screen.next)}/>}
      {screen.name === 'recover' && <Recover onBack={() => setScreen({ name: 'maps' })} onRecovered={list => { setCharacters(list); setScreen({ name: 'maps' }); }}/>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  </main>;
}

function MapSelect({ maps, characters, onPlay, onCreate, onRecover }: { maps: MapInfo[]; characters: CharacterSummary[]; onPlay: (c: CharacterSummary) => void; onCreate: (k: MapKind) => void; onRecover: () => void }) {
  return <>
    <p className="lead">Chọn vùng đất. Mỗi bản đồ là một nhân vật riêng.</p>
    <div className="map-cards">
      {MAPS.map(m => {
        const c = characters.find(x => x.mapKind === m.kind), available = maps.some(x => x.mapKind === m.kind);
        return <article key={m.kind} className={`map-card ${m.kind}`}>
          <h2>{m.title}</h2><p>{m.text}</p>
          {c ? <><p className="who">{c.displayName}#{c.tag} · Cấp {c.level} · Tài sản {money(c.netWorth)}</p><button className="primary" onClick={() => onPlay(c)}>Chơi tiếp</button></>
            : available ? <><span className="badge">Mới</span><button className="primary" onClick={() => onCreate(m.kind)}>Tạo nhân vật</button></>
              : <span className="badge muted">Sắp mở</span>}
        </article>;
      })}
      <article className="map-card eco"><h2>Sinh thái</h2><p>Hồ, đầm và rừng</p><span className="badge muted">Sắp ra mắt</span></article>
    </div>
    <button className="link" onClick={onRecover}>Tôi có mã khôi phục</button>
  </>;
}

function CreateCharacter({ kind, suggestion, hasOther, onBack, onCreated }: { kind: MapKind; suggestion: string; hasOther: boolean; onBack: () => void; onCreated: (c: CharacterSummary, code?: string) => void }) {
  const [name, setName] = useState(suggestion), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const title = kind === 'city' ? 'Nhân vật Thành phố mới' : 'Nhân vật Quê mới';
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.createCharacter(kind, name);
      if (r.token) storage.setToken(r.token);
      onCreated(r.character, r.recoveryCode);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <form onSubmit={e => { e.preventDefault(); void submit(); }}>
    <h2>{title}</h2>
    {hasOther && <p className="note">Nhân vật mới bắt đầu từ cấp 1 với $2,000. Tiền, cấp và tài sản của nhân vật ở bản đồ khác không chuyển sang.</p>}
    <label className="field">Tên nhân vật<input autoFocus maxLength={20} value={name} onChange={e => setName(e.target.value)} aria-invalid={!!error}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="row"><button type="button" onClick={onBack}>Quay lại</button><button className="primary" disabled={busy || [...name.trim()].length < 3}>{busy ? 'Đang tạo…' : 'Vào chơi'}</button></div>
  </form>;
}

function RecoveryCode({ code, onContinue }: { code: string; onContinue: () => void }) {
  const [copied, setCopied] = useState(false), [saved, setSaved] = useState(false);
  return <div>
    <h2>Mã khôi phục của bạn</h2>
    <p className="note">Mã này chỉ hiện <strong>một lần</strong>. Dùng nó để vào lại mọi nhân vật khi đổi máy hoặc xóa dữ liệu trình duyệt.</p>
    <p className="code" aria-label="Mã khôi phục">{code}</p>
    <div className="row">
      <button onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? 'Đã sao chép' : 'Sao chép'}</button>
      <label className="check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}/>Tôi đã lưu mã</label>
    </div>
    <button className="primary wide" onClick={onContinue}>Tiếp tục</button>
  </div>;
}

function Recover({ onBack, onRecovered }: { onBack: () => void; onRecovered: (c: CharacterSummary[]) => void }) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <form onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api.recover(code); storage.setToken(r.token); onRecovered(r.characters); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }}>
    <h2>Khôi phục nhân vật</h2>
    <label className="field">Mã khôi phục<input autoFocus placeholder="XXXX-XXXX-XXXX" value={code} onChange={e => setCode(e.target.value)}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="row"><button type="button" onClick={onBack}>Quay lại</button><button className="primary" disabled={busy || code.replace(/[\s-]/g, '').length < 12}>Khôi phục</button></div>
  </form>;
}
