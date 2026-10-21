import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export const PBKDF2_ITERATIONS = 200_000;
export const SESSION_COOKIE = 'bsdwear_session';
export const CSRF_COOKIE = 'bsdwear_csrf';

const DIGEST = 'sha256';
const KEY_LENGTH = 32;

export function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
  return `pbkdf2_sha256$${iterations}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], 'hex');
    expected = Buffer.from(parts[3], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0 || parts[2].length % 2 !== 0 || parts[3].length % 2 !== 0) {
    return false;
  }
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, DIGEST);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function tokensEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  const username = value.trim();
  if (!username || username.length > 64) return '';
  if (/[\s\u0000-\u001f\u007f]/.test(username)) return '';
  return username;
}

export function readCookie(header, name) {
  if (typeof header !== 'string' || !header) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return '';
}

export function cookieSecure(req, env, sameSite) {
  const setting = String(env.AUTH_COOKIE_SECURE ?? 'auto').trim().toLowerCase();
  if (setting === '0' || setting === 'false' || setting === 'no') return sameSite === 'none';
  if (setting === '1' || setting === 'true' || setting === 'yes') return true;
  const forwarded = req.headers?.['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const https = req.secure === true || String(proto || '').split(',')[0].trim().toLowerCase() === 'https';
  return https || sameSite === 'none';
}

export function sameSiteSetting(env) {
  const value = String(env.AUTH_COOKIE_SAMESITE ?? 'lax').trim().toLowerCase();
  if (value === 'strict' || value === 'none') return value;
  return 'lax';
}
