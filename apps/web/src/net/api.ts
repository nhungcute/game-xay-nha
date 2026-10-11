import type { Command, CommandResult, MapKind, WorldSnapshot } from '@xay-nha/contracts';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail?: unknown) { super(code); }
}

const TOKEN_KEY = 'xay-nha.token', LAST_WORLD_KEY = 'xay-nha.lastWorld';
const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null): void => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage blocked */ } };
export const storage = {
  token: () => read(TOKEN_KEY), setToken: (t: string | null) => write(TOKEN_KEY, t),
  lastWorld: () => read(LAST_WORLD_KEY), setLastWorld: (id: string | null) => write(LAST_WORLD_KEY, id),
};

export interface CharacterSummary {
  id: string; mapKind: MapKind; mapId: string; templateVersion: number; displayName: string; tag: string;
  level: number; xp: number; cash: number; netWorth: number; updatedAt: string;
}
export interface MapInfo { mapKind: MapKind; mapId: string; templateVersion: number; url: string }
export interface CommandBatchResponse { results: CommandResult[]; revision: number; serverTime: number; stateHash: string }
export interface SnapshotResponse { snapshot: WorldSnapshot; stateHash: string; serverTime: number }

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const token = storage.token();
  let response: Response;
  try {
    response = await fetch(path, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, 'NETWORK'); }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? `HTTP_${response.status}`, (data as { detail?: unknown }).detail);
  return data as T;
}

export const api = {
  maps: () => request<{ maps: MapInfo[]; serverTime: number }>('GET', '/api/maps'),
  me: () => request<{ accountId: string; username: string | null; characters: CharacterSummary[]; serverTime: number }>('GET', '/api/me'),
  /** D027: new player — unique username + PIN + first map. */
  register: (username: string, pin: string, mapKind: MapKind) =>
    request<{ accountId: string; username: string; character: CharacterSummary; token: string; serverTime: number }>('POST', '/api/auth/register', { username, pin, mapKind }),
  /** D027: returning player on any device. */
  login: (username: string, pin: string) =>
    request<{ accountId: string; username: string; token: string; characters: CharacterSummary[]; serverTime: number }>('POST', '/api/auth/login', { username, pin }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  /** Signed-in player opens the other map; the name is the account's username. */
  createCharacter: (mapKind: MapKind) => request<{ accountId: string; character: CharacterSummary; serverTime: number }>('POST', '/api/characters', { mapKind }),
  snapshot: (worldId: string) => request<SnapshotResponse>('GET', `/api/worlds/${worldId}`),
  commands: (worldId: string, commands: Command[]) => request<CommandBatchResponse>('POST', `/api/worlds/${worldId}/commands`, { commands }),
  deleteWorld: (worldId: string, confirmName: string) => request<void>('DELETE', `/api/worlds/${worldId}`, { confirmName }),
};
