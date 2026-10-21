export const CSRF_COOKIE = 'bw_csrf';

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
