import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export const newToken = (): string => randomBytes(32).toString('base64url');
export const tokenHash = (token: string, pepper: string): Buffer => createHash('sha256').update(`${pepper}:${token}`).digest();

/** D027: the login name is the character name; uniqueness ignores case and repeated spaces (diacritics count). */
export const usernameKey = (name: string): string => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
/** PIN: 4–6 digits. */
export const validPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4,6}$/.test(pin);

/** scrypt with a per-secret random salt, encoded `scrypt$N$r$p$salt$key`. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16), key = await scrypt(secret, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(secret, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}
/** Same cost as a real check, for unknown usernames (no timing oracle for which names exist). */
const DUMMY = hashSecret('000000');
export async function verifyNothing(pin: string): Promise<false> { await verifySecret(pin, await DUMMY); return false; }

// Small blocklist; production moderation can extend it via content updates.
const BLOCKED = ['admin', 'moderator', 'dit', 'dm', 'dcm', 'lon', 'cac', 'buoi', 'fuck', 'shit'];
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
export type NameCheck = { ok: true; name: string } | { ok: false; reason: 'LENGTH' | 'CHARACTERS' | 'BLOCKED' };
/** docs/11 §4.1: 3–20 chars, Unicode letters (Vietnamese included), digits, single spaces. */
export function validateDisplayName(input: unknown): NameCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'CHARACTERS' };
  const name = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < 3 || length > 20) return { ok: false, reason: 'LENGTH' };
  if (!/^[\p{L}\p{N}]+( [\p{L}\p{N}]+)*$/u.test(name)) return { ok: false, reason: 'CHARACTERS' };
  const words = fold(name).split(' ');
  if (words.some(w => BLOCKED.includes(w))) return { ok: false, reason: 'BLOCKED' };
  return { ok: true, name };
}
export const randomTag = (): string => String(randomInt(10000)).padStart(4, '0');
