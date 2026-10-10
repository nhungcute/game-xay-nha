import { useState } from 'react';
import type { MapKind } from '@xay-nha/contracts';
import { api, ApiError, storage, type CharacterSummary, type MapInfo } from '../net/api';
import { money } from '../i18n';
import { EntryIcon } from './EntryIcon';
import { EntryHeading } from './StartShell';

const NAME_ERRORS: Record<string, string> = {
  NAME_LENGTH: 'Tên cần từ 3 đến 20 ký tự.', NAME_CHARACTERS: 'Chỉ dùng chữ cái (có dấu), số và một khoảng trắng giữa các từ.',
  NAME_BLOCKED: 'Tên này không phù hợp, hãy chọn tên khác.', CHARACTER_EXISTS: 'Bạn đã có nhân vật ở bản đồ này.',
  RATE_LIMITED: 'Bạn thao tác quá nhiều lần, hãy thử lại sau.', MAP_UNAVAILABLE: 'Bản đồ này chưa mở.', NETWORK: 'Không kết nối được máy chủ.',
  INVALID_RECOVERY_CODE: 'Mã khôi phục không đúng.',
};
export const errorMessage = (error: unknown): string => error instanceof ApiError
  ? NAME_ERRORS[error.code] ?? `Lỗi: ${error.code}` : error instanceof Error ? error.message : String(error);

const MAPS = {
  city: { title: 'Thành phố', label: 'Phố biển', text: 'Từ ngôi nhà đầu tiên đến một khu phố nhộn nhịp. Xây dựng, kinh doanh và ngắm thành phố lớn lên.',
    features: ['Xây nhà', 'Kinh doanh', 'Thu nhập'], icon: 'home' as const, number: '01' },
  farm: { title: 'Quê', label: 'Miền xanh', text: 'Một khu vườn, vài luống rau và những mùa thu hoạch. Tự tay vun trồng cuộc sống bình yên.',
    features: ['Trồng trọt', 'Chăn nuôi', 'Sản xuất'], icon: 'leaf' as const, number: '02' },
};
const MAP_KINDS = ['city', 'farm'] as const;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] ?? '').join('').toLocaleUpperCase('vi');

function MapArtwork({ kind, className = '' }: { kind: MapKind; className?: string }) {
  return <div className={`entry-art ${kind} ${className}`} aria-hidden="true"/>;
}

export function MapSelect({ maps, characters, onPlay, onCreate, onRecover }: {
  maps: MapInfo[]; characters: CharacterSummary[]; onPlay: (character: CharacterSummary) => void;
  onCreate: (kind: MapKind) => void; onRecover: () => void;
}) {
  return <>
    <section className="entry-hero" aria-labelledby="welcome-title">
      <div className="entry-hero-copy">
        <span className="entry-kicker"><EntryIcon name="sun"/> CHẬM MỘT CHÚT, VUI NHIỀU HƠN</span>
        <h1 id="welcome-title">Một nơi nhỏ.<br/><em>Ước mơ lớn.</em></h1>
        <p>Xây một ngôi nhà, vun một khu vườn.<br/>Bắt đầu câu chuyện của bạn, từ hôm nay.</p>
        <div className="entry-hero-detail"><span className="entry-leaf-stamp"><EntryIcon name="leaf"/></span>
          <span>Không cần vội vàng.<br/><strong>Vùng đất của bạn luôn chờ bạn trở về.</strong></span>
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
                <div><p className="who">{character.displayName}<small>#{character.tag}</small></p>
                  <p>Cấp {character.level} <span>·</span> Tài sản {money(character.netWorth)}</p></div>
              </div>}
              {character ? <button type="button" className="primary map-play" onClick={() => onPlay(character)}>Chơi tiếp<EntryIcon name="arrow"/></button>
                : <button type="button" className="primary map-play" disabled={!available} onClick={() => onCreate(kind)}>
                  {available ? 'Tạo nhân vật' : 'Sắp mở'}<EntryIcon name={available ? 'arrow' : 'lock'}/>
                </button>}
            </div>
          </article>;
        })}
      </div>
      <article className="map-card eco"><span className="eco-symbol"><EntryIcon name="leaf"/></span>
        <div><h3>Sinh thái <span>Hẹn một ngày không xa</span></h3><p>Hồ, đầm và rừng. Một vùng đất mới đang được ươm mầm.</p></div>
        <span className="eco-lock"><EntryIcon name="lock"/> Sắp ra mắt</span>
      </article>
      <div className="entry-recover-invitation"><EntryIcon name="key"/><span>Đã có một vùng đất của riêng mình?</span>
        <button type="button" className="link" onClick={onRecover}>Tôi có mã khôi phục<EntryIcon name="arrow"/></button>
      </div>
    </section>
  </>;
}

export function CreateCharacter({ kind, suggestion, hasOther, onBack, onCreated }: {
  kind: MapKind; suggestion: string; hasOther: boolean; onBack: () => void;
  onCreated: (character: CharacterSummary, code?: string) => void;
}) {
  const [name, setName] = useState(suggestion), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const map = MAPS[kind];
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.createCharacter(kind, name);
      if (result.token) storage.setToken(result.token);
      onCreated(result.character, result.recoveryCode);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  return <>
    <EntryHeading eyebrow="02 / LÀM QUEN MỘT CHÚT" title={<>Vùng đất mới,<br/><em>mang tên bạn.</em></>}
      description="Một cái tên thân quen. Một khởi đầu thật đẹp."/>
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
        <h2>Tạo nhân vật</h2><p className="form-description">Bạn muốn mọi người gọi mình là gì?</p>
        <div className="field"><label htmlFor="character-name">Tên nhân vật</label><span className="field-input-wrap"><input id="character-name"
          name="displayName" autoComplete="nickname" autoFocus required maxLength={20} value={name} disabled={busy}
          placeholder="Ví dụ: An Nhiên" onChange={event => setName(event.target.value)}
          aria-invalid={!!error} aria-describedby={`character-hint${error ? ' character-error' : ''}`}/>
          <span className="name-counter" aria-hidden="true">{[...name].length}/20</span></span></div>
        <p className="field-hint" id="character-hint">3–20 ký tự. Dùng chữ có dấu, số và khoảng trắng.</p>
        {error && <p className="error entry-error" id="character-error" role="alert">{error}</p>}
        <div className="entry-note"><EntryIcon name="leaf"/><p>{hasOther
          ? 'Đây là một khởi đầu riêng: cấp, tiền và tài sản từ bản đồ khác không chuyển sang.'
          : 'Bắt đầu từ cấp 1. Bác Tư sẽ hướng dẫn bạn xây nhà và làm quen với vùng đất.'}</p></div>
        <button className="primary wide entry-submit" disabled={busy || [...name.trim()].length < 3}>
          {busy ? 'Đang tạo…' : 'Vào chơi'}<EntryIcon name="arrow"/></button>
        <button type="button" className="entry-back" onClick={onBack} disabled={busy}><EntryIcon name="back"/>Chọn vùng đất khác</button>
      </form>
    </div>
  </>;
}

function RecoveryStory() {
  return <aside className="recovery-story">
    <div className="recovery-story-art" aria-hidden="true"/>
    <div className="recovery-story-copy"><span className="story-icon"><EntryIcon name="home"/></span>
      <h2>Nhà vẫn ở đây.<br/><em>Chỉ chờ bạn trở về.</em></h2><p>Một mã khôi phục để trở lại với tất cả nhân vật và vùng đất của bạn.</p>
      <span className="story-signature">Hẹn gặp lại, người hàng xóm.</span>
    </div>
  </aside>;
}

export function RecoveryCode({ code, onContinue }: { code: string; onContinue: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'unavailable'>('idle'), [saved, setSaved] = useState(false);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code); setCopyState('copied');
    } catch { setCopyState('unavailable'); }
  };
  return <>
    <EntryHeading eyebrow="03 / GIỮ CHÌA KHÓA NGÔI NHÀ" title={<>Một mã nhỏ.<br/><em>Giữ cả vùng đất.</em></>}
      description="Lưu lại trước khi bắt đầu hành trình nhé."/>
    <div className="entry-form-layout"><RecoveryStory/><section className="entry-form recovery-code-panel">
      <span className="form-top-icon"><EntryIcon name="key"/></span><h2>Mã khôi phục của bạn</h2>
      <p className="form-description">Mã chỉ hiện <strong>một lần</strong>. Dùng khi đổi máy hoặc xóa dữ liệu trình duyệt.</p>
      <p className="code" aria-label="Mã khôi phục" tabIndex={0}>{code}</p>
      <button type="button" className="entry-copy" onClick={() => { void copy(); }}><EntryIcon name={copyState === 'copied' ? 'check' : 'key'}/>
        {copyState === 'copied' ? 'Đã sao chép' : 'Sao chép'}</button>
      <p className="copy-feedback" role="status">{copyState === 'unavailable' ? 'Không sao chép tự động được. Hãy chọn mã và lưu thủ công.' : copyState === 'copied' ? 'Đã sao chép mã. Hãy cất ở nơi riêng tư.' : 'Lưu mã ở nơi riêng tư, không chia sẻ với người khác.'}</p>
      <label className="check entry-saved"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/>Tôi đã lưu mã</label>
      <button type="button" className="primary wide entry-submit" onClick={onContinue}>Tiếp tục<EntryIcon name="arrow"/></button>
    </section></div>
  </>;
}

export function Recover({ onBack, onRecovered }: { onBack: () => void; onRecovered: (characters: CharacterSummary[]) => void }) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { const result = await api.recover(code); storage.setToken(result.token); onRecovered(result.characters); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  return <>
    <EntryHeading eyebrow="CHÀO MỪNG NGƯỜI QUEN" title={<>Về nhà thôi,<br/><em>người hàng xóm.</em></>}
      description="Nhập mã đã lưu để tiếp tục câu chuyện của bạn."/>
    <div className="entry-form-layout"><RecoveryStory/>
      <form className="entry-form" onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}>
        <span className="form-top-icon"><EntryIcon name="key"/></span><h2>Đăng nhập</h2>
        <p className="form-description">Khôi phục nhân vật bằng mã của bạn.</p>
        <label className="field" htmlFor="recovery-code">Mã khôi phục<input id="recovery-code" name="recoveryCode" autoFocus
          autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" value={code} disabled={busy}
          onChange={event => setCode(event.target.value)} aria-invalid={!!error} aria-describedby={`recovery-hint${error ? ' recovery-error' : ''}`}/></label>
        <p className="field-hint" id="recovery-hint">Mã gồm 12 chữ cái và số, được cấp khi tạo nhân vật đầu tiên.</p>
        {error && <p className="error entry-error" id="recovery-error" role="alert">{error}</p>}
        <div className="entry-note"><EntryIcon name="lock"/><p>Chỉ cần mã khôi phục. Không cần mật khẩu hay email.</p></div>
        <button className="primary wide entry-submit" disabled={busy || code.replace(/[\s-]/g, '').length < 12}>
          {busy ? 'Đang khôi phục…' : 'Khôi phục'}<EntryIcon name="arrow"/></button>
        <button type="button" className="entry-back" onClick={onBack} disabled={busy}><EntryIcon name="back"/>Bắt đầu một vùng đất mới</button>
      </form>
    </div>
  </>;
}
