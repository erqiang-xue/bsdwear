import assert from 'node:assert/strict';
import test from 'node:test';
import { CSRF_COOKIE, authHeaders, fetchCurrentUser, loginAccount, logoutAccount, readCookie } from '../src/auth.js';

test('readCookie finds the readable login check value', () => {
  assert.equal(readCookie('', CSRF_COOKIE), '');
  assert.equal(readCookie('other=1; bsdwear_csrf=abc%2B123', CSRF_COOKIE), 'abc+123');
  assert.equal(readCookie('bsdwear_session=secret; bsdwear_csrf=csrf-value', CSRF_COOKIE), 'csrf-value');
});

test('authHeaders attach the login check when the browser can read it', () => {
  assert.deepEqual(authHeaders(''), { Accept: 'application/json' });
  assert.equal(authHeaders('bsdwear_csrf=csrf-value')['X-CSRF-Token'], 'csrf-value');
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

test('logoutAccount sends the login check header', async () => {
  const calls = [];
  await logoutAccount(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ ok: true }) };
  }, { cookie: 'bsdwear_csrf=csrf-value' });
  assert.equal(calls[0].url, '/api/auth/logout');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['X-CSRF-Token'], 'csrf-value');
});
