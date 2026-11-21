export const CSRF_COOKIE = 'bw_csrf';

const CENTER_ERRORS = {
  ACCOUNT_NOT_LINKED: '用户中心有这个人，但试穿这边还没有对应账号。请让管理员先在用户中心开户，并使用相同的用户名或手机号。这里不能自行注册。',
  SELF_REGISTER_DISABLED: '这个应用不开放自助注册。请让管理员先在用户中心开户。',
  IDENTITY_CONFLICT: '这个用户中心账号不能并入已有试穿账号。',
  UNKNOWN_ACCOUNT: '用户中心没有返回可识别的账号。',
  ACCOUNT_DISABLED: '用户中心账号不可用或登录已失效。',
  OAUTH_STATE: '登录状态已失效，请重新登录。',
  OAUTH_DENIED: '用户中心没有完成登录。',
  USER_CENTER_UNAVAILABLE: '暂时无法连接用户中心。',
  REDIRECT_URI_INVALID: '回调地址不在允许列表中。',
};

export function userCenterErrorMessage(code) {
  if (typeof code !== 'string' || !code) return '';
  return CENTER_ERRORS[code] || '用户中心登录没有完成。';
}

export function centerLoginAction({ enabled, signedIn, errorCode }) {
  if (!enabled || signedIn) return { kind: 'local', message: '' };
  if (errorCode) return { kind: 'error', message: userCenterErrorMessage(errorCode) };
  return { kind: 'redirect', message: '' };
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

function documentCookie() {
  if (typeof document === 'undefined') return '';
  return document.cookie || '';
}

export function authHeaders(cookieHeader = documentCookie()) {
  const headers = { Accept: 'application/json' };
  const csrf = readCookie(cookieHeader, CSRF_COOKIE);
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

async function readBody(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function loginAccount(username, password, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('无法连接服务，请确认已启动后再试。');
  }
  const body = await readBody(response);
  if (!response.ok) throw new Error(body.error || '登录失败，请重试。');
  return body;
}

export async function signIn(username, password, fetchImpl = globalThis.fetch) {
  await loginAccount(username, password, fetchImpl);
  const user = await fetchCurrentUser(fetchImpl);
  if (!user) throw new Error('登录没有完成，请再试一次。');
  return user;
}

export async function fetchAuthConfig(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl('/api/auth/config', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return { userCenterEnabled: false };
    const body = await readBody(response);
    return { userCenterEnabled: body.userCenterEnabled === true };
  } catch {
    return { userCenterEnabled: false };
  }
}

export async function fetchCurrentUser(fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('暂时无法确认登录状态，请稍后再试。');
  }
  if (response.status === 401) return null;
  const body = await readBody(response);
  if (!response.ok) throw new Error(body.error || '暂时无法确认登录状态，请稍后再试。');
  return body;
}

export async function logoutAccount(fetchImpl = globalThis.fetch, options = {}) {
  let response;
  try {
    response = await fetchImpl('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(options.cookie),
    });
  } catch {
    throw new Error('无法连接服务，请确认已启动后再试。');
  }
  if (response.ok || response.status === 401) return;
  const body = await readBody(response);
  throw new Error(body.error || '退出失败，请重试。');
}
