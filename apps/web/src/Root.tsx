import { useCallback, useEffect, useState } from 'react';
import { WorldTemplateSchema, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { Game } from './Game';
import { WorldStore } from './game/WorldStore';
import { api, ApiError, storage, type CharacterSummary, type MapInfo } from './net/api';
import { t } from './i18n';
import { CreateCharacter, errorMessage, MapSelect, Recover, RecoveryCode } from './start/EntryScreens';
import { StartShell } from './start/StartShell';

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
  return <StartShell stage={screen.name} onHome={() => setScreen({ name: 'maps' })} onRecover={() => setScreen({ name: 'recover' })}>
      {screen.name === 'boot' && <div className="entry-boot" role="status"><span className="entry-loader"/><h1>{t('loading')}</h1><p>Vùng đất của bạn đang thức giấc…</p></div>}
      {screen.name === 'maps' && <MapSelect maps={maps} characters={characters} onPlay={play} onCreate={kind => setScreen({ name: 'create', kind })} onRecover={() => setScreen({ name: 'recover' })}/>}
      {screen.name === 'create' && <CreateCharacter kind={screen.kind} suggestion={characters[0]?.displayName ?? ''} hasOther={characters.length > 0}
        onBack={() => setScreen({ name: 'maps' })}
        onCreated={(character, code) => { void refresh().catch(cause => setError(errorMessage(cause))); if (code) setScreen({ name: 'code', code, next: character }); else play(character); }}/>}
      {screen.name === 'code' && <RecoveryCode code={screen.code} onContinue={() => play(screen.next)}/>}
      {screen.name === 'recover' && <Recover onBack={() => setScreen({ name: 'maps' })} onRecovered={list => { setCharacters(list); setScreen({ name: 'maps' }); }}/>}
      {error && <p className="error" role="alert">{error}</p>}
  </StartShell>;
}
