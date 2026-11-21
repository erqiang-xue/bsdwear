import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { normalizeUsername } from './security.js';

export const OAUTH_COOKIE = 'bw_oauth';
export const LEGACY_APP = 'bsdwear';
export const CALLBACK_PATH = '/auth/oauth/callback';
export const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;
const SCOPES = 'openid profile phone';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_RE = /^1[3-9]\d{9}$/;

const LOCAL_DEV_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:3001',
  'http://localhost:3001',
];

export class UserCenterError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'UserCenterError';
    this.code = code;
    this.status = status;
  }
}

export function userCenterEnabled(env) {
  return /^(1|true|yes|on)$/i.test(String(env.USER_CENTER_ENABLED ?? '').trim());
}

function trimOrigin(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function assertOrigin(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} 必须是 http 或 https 的站点根地址`);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new Error(`${name} 必须是 http 或 https 的站点根地址`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${name} 必须是 http 或 https 的站点根地址`);
  }
}

function assertRedirect(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('USER_CENTER_EXTRA_REDIRECT_URIS 中的地址必须是完整的回调 URL');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.pathname.startsWith('/')) {
    throw new Error('USER_CENTER_EXTRA_REDIRECT_URIS 中的地址必须是完整的回调 URL');
  }
}

export function userCenterConfig(env) {
  const enabled = userCenterEnabled(env);
  const baseUrl = trimOrigin(env.USER_CENTER_BASE_URL);
  const publicUrl = trimOrigin(env.USER_CENTER_PUBLIC_URL || 'http://127.0.0.1:5173');
  const clientId = String(env.USER_CENTER_CLIENT_ID ?? 'bsdwear').trim() || 'bsdwear';
  const redirectPath = String(env.USER_CENTER_REDIRECT_PATH ?? CALLBACK_PATH).trim() || CALLBACK_PATH;
  const extra = String(env.USER_CENTER_EXTRA_REDIRECT_URIS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const timeout = Number(env.USER_CENTER_HTTP_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 10_000;
  if (!redirectPath.startsWith('/') || redirectPath.includes('?') || redirectPath.includes('#')) {
    throw new Error('USER_CENTER_REDIRECT_PATH 必须是以 / 开头的路径');
  }
  if (enabled) {
    assertOrigin(baseUrl, 'USER_CENTER_BASE_URL');
    assertOrigin(publicUrl, 'USER_CENTER_PUBLIC_URL');
    if (!clientId) throw new Error('启用用户中心时必须配置 USER_CENTER_CLIENT_ID');
    for (const item of extra) assertRedirect(item);
  }
  return { enabled, baseUrl, publicUrl, clientId, redirectPath, extra, timeoutMs };
}

function isLoopback(value) {
  try {
    const host = new URL(value).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

export function allowedRedirectUris(config) {
  const uris = [`${config.publicUrl}${config.redirectPath}`];
  if (isLoopback(config.publicUrl)) {
    for (const origin of LOCAL_DEV_ORIGINS) {
      const item = `${origin}${config.redirectPath}`;
      if (!uris.includes(item)) uris.push(item);
    }
  }
  for (const item of config.extra) {
    if (item && !uris.includes(item)) uris.push(item);
  }
  return uris;
}

function firstHeader(req, name) {
  const value = req.headers?.[name];
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || '').split(',')[0].trim();
}

export function externalOrigin(req) {
  const forwardedHost = firstHeader(req, 'x-forwarded-host');
  const host = forwardedHost || firstHeader(req, 'host');
  let proto = firstHeader(req, 'x-forwarded-proto').toLowerCase();
  if (proto !== 'http' && proto !== 'https') proto = req.secure ? 'https' : 'http';
  return `${proto}://${host}`;
}

export function redirectUriFor(config, req) {
  const allowed = allowedRedirectUris(config);
  const candidate = `${externalOrigin(req).replace(/\/+$/, '')}${config.redirectPath}`;
  if (allowed.includes(candidate)) return candidate;
  return allowed[0];
}

export function pkcePair() {
  const verifier = randomBytes(64).toString('base64url');
  const digest = createHash('sha256').update(verifier).digest();
  const challenge = digest.toString('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(config, redirectUri, state, challenge) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${config.baseUrl}/oauth/authorize?${query.toString()}`;
}

export function packOauth(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function unpackOauth(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

export function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function normalizePhone(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.trim().replace(/[\s\u3000-]/g, '');
  if (text.startsWith('+86')) text = text.slice(3);
  else if (text.startsWith('0086')) text = text.slice(4);
  else if (text.startsWith('86') && text.length === 13) text = text.slice(2);
  return PHONE_RE.test(text) ? text : '';
}

async function centerRequest(config, fetchImpl, method, url, { form, headers } = {}) {
  const init = {
    method,
    headers: { Accept: 'application/json', ...headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(config.timeoutMs),
  };
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form);
  }
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new UserCenterError('USER_CENTER_UNAVAILABLE', '暂时无法连接用户中心。', 502);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function exchangeProfile(config, fetchImpl, code, redirectUri, verifier) {
  const token = await centerRequest(config, fetchImpl, 'POST', `${config.baseUrl}/oauth/token`, {
    form: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    },
  });
  if (token.status !== 200) {
    throw new UserCenterError('OAUTH_DENIED', '用户中心没有完成登录。', 401);
  }
  const body = await readJson(token);
  const access = body && typeof body.access_token === 'string' ? body.access_token : '';
  if (!access) throw new UserCenterError('USER_CENTER_UNAVAILABLE', '用户中心没有返回访问令牌。', 502);
  const info = await centerRequest(config, fetchImpl, 'GET', `${config.baseUrl}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (info.status === 401) {
    throw new UserCenterError('ACCOUNT_DISABLED', '用户中心账号不可用或登录已失效。', 403);
  }
  if (info.status !== 200) {
    throw new UserCenterError('USER_CENTER_UNAVAILABLE', '暂时无法读取用户中心资料。', 502);
  }
  const profile = await readJson(info);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new UserCenterError('UNKNOWN_ACCOUNT', '用户中心没有可识别的账号。', 401);
  }
  return profile;
}

function centerIdOf(profile) {
  const raw = typeof profile?.sub === 'string' ? profile.sub.trim().toLowerCase() : '';
  if (!UUID_RE.test(raw)) {
    throw new UserCenterError('UNKNOWN_ACCOUNT', '用户中心没有可识别的账号。', 401);
  }
  return raw;
}

function conflict(message) {
  return new UserCenterError('IDENTITY_CONFLICT', message, 409);
}

function assertLink(store, user, centerId) {
  const byCenter = store.findCenterLinkByCenter(centerId);
  const byUser = store.findCenterLinkByUser(user.id);
  if (byCenter && Number(byCenter.legacy_user_id) !== Number(user.id)) {
    throw conflict('这个用户中心账号已经对应另一个试穿账号。');
  }
  if (byUser && byUser.center_user_id !== centerId) {
    throw conflict('这个试穿账号已经对应另一个用户中心账号。');
  }
  if (!byCenter && !byUser) {
    try {
      store.insertCenterLink({ centerId, userId: user.id });
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        throw conflict('这个用户中心账号已经对应另一个试穿账号。');
      }
      throw error;
    }
  }
}

export function adoptUser(store, profile) {
  const centerId = centerIdOf(profile);
  const phone = normalizePhone(profile.phone_number);
  const username = normalizeUsername(profile.preferred_username);
  return store.transaction(() => {
    const existing = store.findUserByCenterId(centerId);
    if (existing) {
      assertLink(store, existing, centerId);
      return existing;
    }

    let match = null;
    if (username) {
      match = store.findUserByUsername(username);
      if (match?.center_user_id && match.center_user_id !== centerId) {
        throw conflict('该用户名已绑定其他用户中心账号。');
      }
    }
    if (!match && phone) {
      const found = store.findUsersMatchingPhone(phone);
      if (found.length > 1) throw conflict('这个手机号对应了多个试穿账号，不能合并。');
      if (found.length === 1) {
        match = found[0];
        if (match.center_user_id && match.center_user_id !== centerId) {
          throw conflict('该手机号已绑定其他用户中心账号。');
        }
      }
    }
    if (!match) {
      throw new UserCenterError('ACCOUNT_NOT_LINKED', '用户中心账号还没有对应的试穿账号。', 403);
    }

    const bound = store.bindCenterUser(match.id, centerId);
    if (!bound) throw conflict('这个试穿账号已经对应另一个用户中心账号。');
    if (phone) store.setPhoneIfEmpty(match.id, phone);
    const linked = store.findUserById(match.id);
    assertLink(store, linked, centerId);
    return linked;
  });
}
