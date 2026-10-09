import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SCRYPT = { N: 16384, r: 8, p: 1 };

export const newToken = (): string => randomBytes(32).toString('base64url');
export const tokenHash = (token: string, pepper: string): Buffer => createHash('sha256').update(`${pepper}:${token}`).digest();

/** 12 Crockford base32 characters formatted XXXX-XXXX-XXXX (docs/11 §4.1). */
export function newRecoveryCode(): string {
  const chars = Array.from({ length: 12 }, () => CROCKFORD[randomInt(32)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}
/** Accepts lower case, missing dashes and the usual Crockford confusions (O→0, I/L→1). */
export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
export const recoveryPrefixHash = (code: string, pepper: string): Buffer => createHash('sha256').update(`${pepper}:prefix:${code.slice(0, 4)}`).digest();
export async function hashRecovery(code: string): Promise<string> {
  const salt = randomBytes(16), key = await scrypt(code, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyRecovery(code: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(code, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

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
