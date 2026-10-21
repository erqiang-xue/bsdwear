import assert from 'node:assert/strict';
import test from 'node:test';
import { CSRF_COOKIE, authHeaders, fetchCurrentUser, loginAccount, logoutAccount, readCookie, signIn } from '../src/auth.js';

test('readCookie finds the readable login check value', () => {
  assert.equal(readCookie('', CSRF_COOKIE), '');
  assert.equal(readCookie(`other=1; ${CSRF_COOKIE}=abc%2B123`, CSRF_COOKIE), 'abc+123');
  assert.equal(readCookie(`bw_session=secret; ${CSRF_COOKIE}=csrf-value`, CSRF_COOKIE), 'csrf-value');
});

test('authHeaders attach the login check when the browser can read it', () => {
  assert.deepEqual(authHeaders(''), { Accept: 'application/json' });
  assert.equal(authHeaders(`${CSRF_COOKIE}=csrf-value`)['X-CSRF-Token'], 'csrf-value');
});

test('loginAccount posts the account and returns the signed-in user', async () => {
  const calls = [];
  const user = await loginAccount('13800001111', 'demo-pass-8', async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ id: 3, username: '13800001111', role: 'admin' }) };
  });
  assert.deepEqual(user, { id: 3, username: '13800001111', role: 'admin' });
  assert.equal(calls[0].url, '/api/auth/login');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0].init.body), { username: '13800001111', password: 'demo-pass-8' });
});

test('loginAccount shows the server message when the password is wrong', async () => {
  await assert.rejects(
    () => loginAccount('13800001111', 'nope', async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: '账号或密码不正确。' }),
    })),
    /账号或密码不正确/,
  );
});

test('fetchCurrentUser treats 401 as signed out', async () => {
  const user = await fetchCurrentUser(async () => ({ status: 401, ok: false, json: async () => ({ error: '请先登录。' }) }));
  assert.equal(user, null);
});

test('signIn loads the account only after the session check succeeds', async () => {
  const calls = [];
  const user = await signIn('demo', 'password12', async (url) => {
    calls.push(url);
    if (url === '/api/auth/login') {
      return { ok: true, json: async () => ({ id: 1, username: 'demo', role: 'admin' }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 1, username: 'demo', role: 'admin' }) };
  });
  assert.deepEqual(calls, ['/api/auth/login', '/api/auth/me']);
  assert.equal(user.username, 'demo');
});

test('signIn stays signed out when the session check does not confirm login', async () => {
  await assert.rejects(
    () => signIn('demo', 'password12', async (url) => {
      if (url === '/api/auth/login') {
        return { ok: true, json: async () => ({ id: 1, username: 'demo', role: 'admin' }) };
      }
      return { ok: false, status: 401, json: async () => ({ error: '请先登录。' }) };
    }),
    /登录没有完成/,
  );
});

test('logoutAccount sends the login check header', async () => {
  const calls = [];
  await logoutAccount(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ ok: true }) };
  }, { cookie: `${CSRF_COOKIE}=csrf-value` });
  assert.equal(calls[0].url, '/api/auth/logout');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['X-CSRF-Token'], 'csrf-value');
});
