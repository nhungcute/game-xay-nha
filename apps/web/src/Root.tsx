import { useCallback, useEffect, useState } from 'react';
import { WorldTemplateSchema, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { generateWorldTemplate, validateTemplate } from '@xay-nha/worldgen';
import { Game } from './Game';
import { OFFLINE_TEMPLATE_KEY, OFFLINE_WORLD_KEY, SnapshotCache, WorldStore } from './game/WorldStore';
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
/** D039: a random map's template lives on the server (per world); static maps keep their static URLs. */
const isRandom = (mapId: string) => mapId.startsWith('rnd-');
const loadCharacterTemplate = async (c: CharacterSummary): Promise<WorldTemplate> => isRandom(c.mapId)
  ? WorldTemplateSchema.parse(await api.template(c.id)) : loadTemplate(templateUrl(c));

/** Offline random maps are opt-in (VITE_RANDOM_MAPS=1 or ?random=1) so the hand-authored offline slice stays the default. */
const OFFLINE_RANDOM = import.meta.env.VITE_RANDOM_MAPS === '1' || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('random'));
/** Offline `?map=town` (or VITE_OFFLINE_MAP=town): the mixed city + countryside map, always randomly generated. */
const OFFLINE_TOWN = import.meta.env.VITE_OFFLINE_MAP === 'town' || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('map') === 'town');
const OFFLINE_KIND: MapKind = OFFLINE_TOWN ? 'town' : 'farm';
/** Generated once, stored with the offline save in IndexedDB; a reload keeps the same map. */
async function loadOfflineTemplate(): Promise<WorldTemplate> {
  if (!OFFLINE_RANDOM && !OFFLINE_TOWN) return loadTemplate('/worlds/farm-g1/template.v1.json');
  const cache = new SnapshotCache();
  try {
    await cache.open();
    const stored = WorldTemplateSchema.safeParse(await cache.readKey(OFFLINE_TEMPLATE_KEY));
    if (stored.success && stored.data.mapKind === OFFLINE_KIND && validateTemplate(stored.data).length === 0) return stored.data;
    const { template } = generateWorldTemplate(OFFLINE_KIND, crypto.getRandomValues(new Uint32Array(1))[0]!);
    await cache.deleteKeys([OFFLINE_WORLD_KEY]); // an old save belongs to the previous map
    await cache.writeKey(OFFLINE_TEMPLATE_KEY, template);
    return template;
  } catch { return generateWorldTemplate(OFFLINE_KIND, crypto.getRandomValues(new Uint32Array(1))[0]!).template; }
  finally { cache.close(); }
}
async function newOfflineMap(): Promise<void> {
  const cache = new SnapshotCache();
  try { await cache.open(); await cache.deleteKeys([OFFLINE_WORLD_KEY, OFFLINE_TEMPLATE_KEY]); } finally { cache.close(); }
  location.reload();
}

type Screen = { name: 'boot' } | { name: 'maps' } | { name: 'register'; kind: MapKind } | { name: 'login' } | { name: 'game'; character: CharacterSummary };

export function Root() {
  if (OFFLINE) return <Game onNewMap={OFFLINE_RANDOM || OFFLINE_TOWN ? newOfflineMap : undefined} loader={async () => {
    const template = await loadOfflineTemplate();
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
      const template = await loadCharacterTemplate(c);
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
