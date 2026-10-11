import { useState } from 'react';
import type { MapKind } from '@xay-nha/contracts';
import { api, ApiError, storage, type CharacterSummary, type MapInfo } from '../net/api';
import { money } from '../i18n';
import { EntryIcon } from './EntryIcon';
import { EntryHeading } from './StartShell';

const ERRORS: Record<string, string> = {
  NAME_LENGTH: 'Tên cần từ 3 đến 20 ký tự.', NAME_CHARACTERS: 'Chỉ dùng chữ cái (có dấu), số và một khoảng trắng giữa các từ.',
  NAME_BLOCKED: 'Tên này không phù hợp, hãy chọn tên khác.', CHARACTER_EXISTS: 'Bạn đã có nhân vật ở bản đồ này.',
  USERNAME_TAKEN: 'Tên này đã có người dùng. Nếu đó là bạn, hãy đăng nhập bằng mã PIN.', INVALID_PIN: 'Mã PIN gồm 4 đến 6 chữ số.',
  INVALID_LOGIN: 'Sai tên hoặc mã PIN.', LOGIN_LOCKED: 'Nhập sai PIN quá nhiều lần. Tên này tạm khóa 15 phút.',
  RATE_LIMITED: 'Bạn thao tác quá nhiều lần, hãy thử lại sau.', MAP_UNAVAILABLE: 'Bản đồ này chưa mở.', NETWORK: 'Không kết nối được máy chủ.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết, hãy đăng nhập lại.',
};
export const errorMessage = (error: unknown): string => {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  const detail = error.detail as { attemptsLeft?: number; retryAfterSeconds?: number } | undefined;
  if (error.code === 'INVALID_LOGIN' && detail?.attemptsLeft !== undefined) return `Sai mã PIN. Còn ${detail.attemptsLeft} lần thử trước khi tạm khóa.`;
  if (error.code === 'LOGIN_LOCKED' && detail?.retryAfterSeconds) return `Nhập sai PIN quá nhiều lần. Thử lại sau ${Math.ceil(detail.retryAfterSeconds / 60)} phút.`;
  return ERRORS[error.code] ?? `Lỗi: ${error.code}`;
};

const MAPS = {
  city: { title: 'Thành phố', label: 'Phố biển', text: 'Từ ngôi nhà đầu tiên đến một khu phố nhộn nhịp. Xây dựng, kinh doanh và ngắm thành phố lớn lên.',
    features: ['Xây nhà', 'Kinh doanh', 'Thu nhập'], icon: 'home' as const, number: '01' },
  farm: { title: 'Quê', label: 'Miền xanh', text: 'Một khu vườn, vài luống rau và những mùa thu hoạch. Tự tay vun trồng cuộc sống bình yên.',
    features: ['Trồng trọt', 'Chăn nuôi', 'Sản xuất'], icon: 'leaf' as const, number: '02' },
};
const MAP_KINDS = ['city', 'farm'] as const;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] ?? '').join('').toLocaleUpperCase('vi');
const PIN = /^\d{4,6}$/;

function MapArtwork({ kind, className = '' }: { kind: MapKind; className?: string }) {
  return <div className={`entry-art ${kind} ${className}`} aria-hidden="true"/>;
}

export function MapSelect({ maps, characters, signedIn, busyKind, onPlay, onCreate, onLogin }: {
  maps: MapInfo[]; characters: CharacterSummary[]; signedIn: string | null; busyKind: MapKind | null;
  onPlay: (character: CharacterSummary) => void; onCreate: (kind: MapKind) => void; onLogin: () => void;
}) {
  return <>
    <section className="entry-hero" aria-labelledby="welcome-title">
      <div className="entry-hero-copy">
        <span className="entry-kicker"><EntryIcon name="sun"/> CHẬM MỘT CHÚT, VUI NHIỀU HƠN</span>
        <h1 id="welcome-title">Một nơi nhỏ.<br/><em>Ước mơ lớn.</em></h1>
        <p>Xây một ngôi nhà, vun một khu vườn.<br/>Bắt đầu câu chuyện của bạn, từ hôm nay.</p>
        <div className="entry-hero-detail"><span className="entry-leaf-stamp"><EntryIcon name="leaf"/></span>
          <span>{signedIn ? <>Chào mừng trở lại,<br/><strong>{signedIn}.</strong></> : <>Chỉ cần một cái tên và mã PIN.<br/><strong>Vào lại từ bất kỳ máy nào.</strong></>}</span>
        </div>
      </div>
      <div className="entry-hero-scene" role="img" aria-label="Minh họa phố biển và nông trại bên dòng sông">
        <span className="scene-note"><EntryIcon name="home"/> Nhà là nơi mình bắt đầu.</span>
        <span className="scene-caption"><span/> Một ngày thật bình yên</span>
      </div>
    </section>
    <section className="entry-map-section" aria-labelledby="map-title">
      <div className="entry-section-heading"><div><p className="entry-eyebrow">01 / CHỌN NƠI BẮT ĐẦU</p>
        <h2 id="map-title">Chọn vùng đất</h2><p>Mỗi bản đồ là một nhân vật riêng. Bạn muốn bắt đầu ở đâu?</p></div>
        <span className="entry-section-mark">Hai vùng đất, hai cách sống.</span>
      </div>
      <div className="map-cards">
        {MAP_KINDS.map(kind => {
          const map = MAPS[kind], character = characters.find(item => item.mapKind === kind);
          const available = maps.some(item => item.mapKind === kind);
          return <article key={kind} className={`map-card ${kind}`} aria-labelledby={`map-${kind}`}>
            <div className="map-card-visual"><MapArtwork kind={kind}/>
              <span className="map-place-label">{map.number} <span>/</span> {map.label}</span>
              <span className={`map-status ${character ? 'returning' : ''}`}><span/>{character ? 'Vùng đất của bạn' : available ? 'Sẵn sàng khám phá' : 'Sắp mở'}</span>
            </div>
            <div className="map-card-content"><div className="map-card-title"><span className="map-symbol"><EntryIcon name={map.icon}/></span>
              <h3 id={`map-${kind}`}>{map.title}</h3></div>
              <p className="map-description">{map.text}</p>
              <div className="map-features">{map.features.map(feature => <span key={feature}>{feature}</span>)}</div>
              {character && <div className="map-character"><span className="character-avatar">{initials(character.displayName)}</span>
                <div><p className="who">{character.displayName}</p>
                  <p>Cấp {character.level} <span>·</span> Tài sản {money(character.netWorth)}</p></div>
              </div>}
              {character ? <button type="button" className="primary map-play" onClick={() => onPlay(character)}>Chơi tiếp<EntryIcon name="arrow"/></button>
                : <button type="button" className="primary map-play" disabled={!available || busyKind !== null} onClick={() => onCreate(kind)}>
                  {!available ? 'Sắp mở' : busyKind === kind ? 'Đang tạo…' : 'Tạo nhân vật'}<EntryIcon name={available ? 'arrow' : 'lock'}/>
                </button>}
            </div>
          </article>;
        })}
      </div>
      <article className="map-card eco"><span className="eco-symbol"><EntryIcon name="leaf"/></span>
        <div><h3>Sinh thái <span>Hẹn một ngày không xa</span></h3><p>Hồ, đầm và rừng. Một vùng đất mới đang được ươm mầm.</p></div>
        <span className="eco-lock"><EntryIcon name="lock"/> Sắp ra mắt</span>
      </article>
      {!signedIn && <div className="entry-recover-invitation"><EntryIcon name="key"/><span>Đã có nhân vật?</span>
        <button type="button" className="link" onClick={onLogin}>Đăng nhập bằng tên và mã PIN<EntryIcon name="arrow"/></button>
      </div>}
    </section>
  </>;
}

function PinField({ id, label, value, onChange, disabled, autoComplete, describedBy }: {
  id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; autoComplete: string; describedBy?: string;
}) {
  return <div className="field"><label htmlFor={id}>{label}</label><span className="field-input-wrap"><input id={id} type="password"
    inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete={autoComplete} required value={value} disabled={disabled}
    placeholder="4–6 chữ số" aria-describedby={describedBy} onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}/></span></div>;
}

/** D027 flow 2 — new player: username + PIN (twice) + the chosen map. */
export function RegisterForm({ kind, onBack, onLogin, onRegistered }: {
  kind: MapKind; onBack: () => void; onLogin: () => void; onRegistered: (username: string, character: CharacterSummary) => void;
}) {
  const [name, setName] = useState(''), [pin, setPin] = useState(''), [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [taken, setTaken] = useState(false);
  const map = MAPS[kind];
  const mismatch = pin2.length > 0 && pin !== pin2;
  const ready = [...name.trim()].length >= 3 && PIN.test(pin) && pin === pin2;
  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true); setError(''); setTaken(false);
    try {
      const result = await api.register(name, pin, kind);
      storage.setToken(result.token);
      onRegistered(result.username, result.character);
    } catch (cause) { setError(errorMessage(cause)); setTaken(cause instanceof ApiError && cause.code === 'USERNAME_TAKEN'); } finally { setBusy(false); }
  };
  return <>
    <EntryHeading eyebrow="02 / LÀM QUEN MỘT CHÚT" title={<>Vùng đất mới,<br/><em>mang tên bạn.</em></>}
      description="Chọn một cái tên và mã PIN để lần sau vào lại từ bất kỳ máy nào."/>
    <div className={`entry-form-layout create-layout ${kind}`}>
      <aside className="character-preview" aria-label="Xem trước nhân vật">
        <div className="character-preview-art"><MapArtwork kind={kind}/><span className="preview-map"><EntryIcon name={map.icon}/>{map.title}</span></div>
        <div className="character-preview-body"><span className="preview-avatar">{name.trim() ? initials(name) : <EntryIcon name={map.icon}/>}</span>
          <p className="entry-eyebrow">NGƯỜI HÀNG XÓM MỚI</p><h2>{name.trim() || 'Tên của bạn'}</h2>
          <p>{kind === 'city' ? 'Một thị trưởng tương lai, bắt đầu từ ngôi nhà nhỏ.' : 'Một người làm vườn, với cả mùa xanh phía trước.'}</p>
          <div className="preview-starting"><span>Cấp khởi đầu<strong>01</strong></span><span>Vốn khởi đầu<strong>{money(2000)}</strong></span></div>
        </div>
      </aside>
      <form className="entry-form" onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}>
        <span className="form-top-icon"><EntryIcon name={map.icon}/></span>
        <h2>Tạo nhân vật mới</h2><p className="form-description">Tên này là tên đăng nhập của bạn.</p>
        <div className="field"><label htmlFor="reg-username">Tên người chơi</label><span className="field-input-wrap"><input id="reg-username"
          name="username" autoComplete="username" autoFocus required maxLength={20} value={name} disabled={busy}
          placeholder="Ví dụ: An Nhiên" onChange={event => setName(event.target.value)} aria-invalid={taken} aria-describedby="reg-hint"/>
          <span className="name-counter" aria-hidden="true">{[...name].length}/20</span></span></div>
        <p className="field-hint" id="reg-hint">3–20 ký tự, chữ có dấu, số và khoảng trắng. Không trùng với người khác.</p>
        <PinField id="reg-pin" label="Mã PIN" value={pin} onChange={setPin} disabled={busy} autoComplete="new-password" describedBy="pin-hint"/>
        <PinField id="reg-pin2" label="Nhập lại mã PIN" value={pin2} onChange={setPin2} disabled={busy} autoComplete="new-password"/>
        <p className={`field-hint ${mismatch ? 'error' : ''}`} id="pin-hint">{mismatch ? 'Hai mã PIN chưa khớp.' : '4–6 chữ số. Ghi nhớ mã này để đăng nhập trên máy khác.'}</p>
        {error && <p className="error entry-error" role="alert">{error}{taken && <> <button type="button" className="link" onClick={onLogin}>Đăng nhập</button></>}</p>}
        <button className="primary wide entry-submit" disabled={busy || !ready}>{busy ? 'Đang tạo…' : 'Tạo nhân vật & vào chơi'}<EntryIcon name="arrow"/></button>
        <button type="button" className="entry-back" onClick={onBack} disabled={busy}><EntryIcon name="back"/>Chọn vùng đất khác</button>
      </form>
    </div>
  </>;
}

function ReturnStory() {
  return <aside className="recovery-story">
    <div className="recovery-story-art" aria-hidden="true"/>
    <div className="recovery-story-copy"><span className="story-icon"><EntryIcon name="home"/></span>
      <h2>Nhà vẫn ở đây.<br/><em>Chỉ chờ bạn trở về.</em></h2><p>Tên người chơi và mã PIN đưa bạn về với tất cả nhân vật và vùng đất của mình, trên bất kỳ máy nào.</p>
      <span className="story-signature">Hẹn gặp lại, người hàng xóm.</span>
    </div>
  </aside>;
}

/** D027 flow 1 — returning player: username + PIN. */
export function LoginForm({ onBack, onLoggedIn }: { onBack: () => void; onLoggedIn: (username: string, characters: CharacterSummary[]) => void }) {
  const [name, setName] = useState(''), [pin, setPin] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { const result = await api.login(name, pin); storage.setToken(result.token); onLoggedIn(result.username, result.characters); }
    catch (cause) { setError(errorMessage(cause)); setPin(''); } finally { setBusy(false); }
  };
  return <>
    <EntryHeading eyebrow="CHÀO MỪNG NGƯỜI QUEN" title={<>Về nhà thôi,<br/><em>người hàng xóm.</em></>}
      description="Nhập tên người chơi và mã PIN để tiếp tục câu chuyện của bạn."/>
    <div className="entry-form-layout"><ReturnStory/>
      <form className="entry-form" onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}>
        <span className="form-top-icon"><EntryIcon name="key"/></span><h2>Đăng nhập</h2>
        <p className="form-description">Dùng tên và mã PIN bạn đã đặt khi tạo nhân vật.</p>
        <div className="field"><label htmlFor="login-username">Tên người chơi</label><span className="field-input-wrap"><input id="login-username"
          name="username" autoComplete="username" autoFocus required maxLength={20} value={name} disabled={busy}
          onChange={event => setName(event.target.value)} aria-invalid={!!error}/></span></div>
        <PinField id="login-pin" label="Mã PIN" value={pin} onChange={setPin} disabled={busy} autoComplete="current-password"/>
        {error && <p className="error entry-error" role="alert">{error}</p>}
        <div className="entry-note"><EntryIcon name="lock"/><p>Nhập sai PIN 5 lần, tên sẽ bị tạm khóa 15 phút để bảo vệ nhân vật của bạn.</p></div>
        <button className="primary wide entry-submit" disabled={busy || [...name.trim()].length < 3 || !PIN.test(pin)}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}<EntryIcon name="arrow"/></button>
        <button type="button" className="entry-back" onClick={onBack} disabled={busy}><EntryIcon name="back"/>Tạo nhân vật mới</button>
      </form>
    </div>
  </>;
}
