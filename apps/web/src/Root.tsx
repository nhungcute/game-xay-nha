import { useCallback, useEffect, useState } from 'react';
import { WorldTemplateSchema, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { Game } from './Game';
import { WorldStore } from './game/WorldStore';
import { api, ApiError, storage, type CharacterSummary, type MapInfo } from './net/api';
import { t } from './i18n';
import { errorMessage, LoginForm, MapSelect, RegisterForm } from './start/EntryScreens';
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

type Screen = { name: 'boot' } | { name: 'maps' } | { name: 'register'; kind: MapKind } | { name: 'login' } | { name: 'game'; character: CharacterSummary };

export function Root() {
  if (OFFLINE) return <Game loader={async () => {
    const template = await loadTemplate('/worlds/farm-g1/template.v1.json');
    return new WorldStore(template);
  }}/>;
  return <OnlineRoot/>;
}

/** D027 entry: two flows — log in (username + PIN) or create a new character (username + PIN + map). */
function OnlineRoot() {
  const [screen, setScreen] = useState<Screen>({ name: 'boot' });
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [creating, setCreating] = useState<MapKind | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async (): Promise<CharacterSummary[]> => {
    if (!storage.token()) { setCharacters([]); setUsername(null); return []; }
    const me = await api.me();
    setCharacters(me.characters); setUsername(me.username ?? me.characters[0]?.displayName ?? 'Người chơi');
    return me.characters;
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
  const logout = async () => {
    await api.logout().catch(() => undefined);
    storage.setToken(null); storage.setLastWorld(null);
    setCharacters([]); setUsername(null); setError(''); setScreen({ name: 'maps' });
  };
  // Signed in: the other map's character is created straight away with the account's name.
  const create = async (kind: MapKind) => {
    if (!username) { setError(''); setScreen({ name: 'register', kind }); return; }
    setCreating(kind); setError('');
    try { const result = await api.createCharacter(kind); await refresh().catch(() => undefined); play(result.character); }
    catch (cause) { setError(errorMessage(cause)); } finally { setCreating(null); }
  };

  if (screen.name === 'game') {
    const c = screen.character;
    return <Game key={c.id} loader={async () => {
      const template = await loadTemplate(templateUrl(c));
      return WorldStore.online(template, { send: commands => api.commands(c.id, commands), fetchSnapshot: () => api.snapshot(c.id) });
    }} onSwitchMap={async world => { await world.drain(); await refresh().catch(() => undefined); setScreen({ name: 'maps' }); }}
      onLogout={async world => { await world.drain().catch(() => undefined); await logout(); }}/>;
  }
  return <StartShell stage={screen.name} signedIn={username} onHome={() => { setError(''); setScreen({ name: 'maps' }); }}
    onLogin={() => { setError(''); setScreen({ name: 'login' }); }} onLogout={() => { void logout(); }}>
      {screen.name === 'boot' && <div className="entry-boot" role="status"><span className="entry-loader"/><h1>{t('loading')}</h1><p>Vùng đất của bạn đang thức giấc…</p></div>}
      {screen.name === 'maps' && <MapSelect maps={maps} characters={characters} signedIn={username} busyKind={creating}
        onPlay={play} onCreate={kind => { void create(kind); }} onLogin={() => setScreen({ name: 'login' })}/>}
      {screen.name === 'register' && <RegisterForm kind={screen.kind} onBack={() => setScreen({ name: 'maps' })} onLogin={() => setScreen({ name: 'login' })}
        onRegistered={(name, character) => { setUsername(name); setCharacters([character]); play(character); }}/>}
      {screen.name === 'login' && <LoginForm onBack={() => setScreen({ name: 'maps' })}
        onLoggedIn={(name, list) => { setUsername(name); setCharacters(list); if (list.length === 1) play(list[0]!); else setScreen({ name: 'maps' }); }}/>}
      {error && <p className="error" role="alert">{error}</p>}
  </StartShell>;
}
