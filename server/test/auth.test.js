import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { CSRF_COOKIE, PBKDF2_ITERATIONS, SESSION_COOKIE, hashPassword, hashToken, verifyPassword } from '../src/security.js';

const INVALID_LOGIN = '账号或密码不正确。';
const SIGN_IN_REQUIRED = '请先登录。';
const SEED_USER = '13800001111';
const SEED_PASSWORD = 'demo-pass-8';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function parseSetCookie(header) {
  const [pair, ...attrs] = header.split(';').map((part) => part.trim());
  const index = pair.indexOf('=');
  const flags = {};
  for (const attr of attrs) {
    const eq = attr.indexOf('=');
    const key = (eq === -1 ? attr : attr.slice(0, eq)).toLowerCase();
    flags[key] = eq === -1 ? true : attr.slice(eq + 1);
  }
  return { name: pair.slice(0, index), value: decodeURIComponent(pair.slice(index + 1)), flags };
}

function cookiesFrom(response) {
  const headers = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return headers.map(parseSetCookie);
}

function cookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function seedEnv(extra = {}) {
  return {
    AUTH_SEED: '1',
    AUTH_SEED_USERNAME: SEED_USER,
    AUTH_SEED_PASSWORD: SEED_PASSWORD,
    ...extra,
  };
}

async function login(base, username = SEED_USER, password = SEED_PASSWORD) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  return { response, body, cookies: cookiesFrom(response) };
}

test('password hash is PBKDF2-HMAC-SHA256 with a salt and 200k iterations', () => {
  const stored = hashPassword('correct-horse');
  const [scheme, iterations, salt, digest] = stored.split('$');
  assert.equal(scheme, 'pbkdf2_sha256');
  assert.equal(Number(iterations), PBKDF2_ITERATIONS);
  assert.equal(PBKDF2_ITERATIONS, 200_000);
  assert.equal(salt.length, 32);
  assert.equal(digest.length, 64);
  assert.equal(verifyPassword('correct-horse', stored), true);
  assert.equal(verifyPassword('other-horse', stored), false);
  assert.equal(verifyPassword('correct-horse', 'not-a-hash'), false);
});

test('POST /api/auth/login accepts a phone-style username and sets session plus CSRF cookies', async () => {
  const app = createApp({ env: seedEnv() });
  const { server, base } = await listen(app);
  try {
    const { response, body, cookies } = await login(base);
    assert.equal(response.status, 200);
    assert.equal(typeof body.id, 'number');
    assert.equal(body.username, SEED_USER);
    assert.equal(body.role, 'admin');
    assert.equal(body.password, undefined);
    assert.equal(body.password_hash, undefined);
    assert.equal(JSON.stringify(body).includes(SEED_PASSWORD), false);

    const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
    const csrf = cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    assert.equal(SESSION_COOKIE, 'bw_session');
    assert.equal(CSRF_COOKIE, 'bw_csrf');
    assert.notEqual(SESSION_COOKIE, 'jx_session');
    assert.ok(session?.value);
    assert.match(session.value, /^[A-Za-z0-9_-]+$/);
    assert.equal(session.value.includes('.'), false);
    assert.equal(Number(session.flags['max-age']), 7 * 24 * 60 * 60);
    assert.equal(session.flags.httponly, true);
    assert.equal(String(session.flags.samesite).toLowerCase(), 'lax');
    assert.equal(session.flags.secure, undefined);
    assert.ok(csrf?.value);
    assert.equal(csrf.flags.httponly, undefined);
    assert.equal(String(csrf.flags.samesite).toLowerCase(), 'lax');

    const stored = app.locals.authStore.listSessions();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].token_hash, hashToken(session.value));
    assert.notEqual(stored[0].token_hash, session.value);
    assert.equal(stored[0].csrf_token, csrf.value);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});

test('POST /api/auth/login rejects an unknown user and a wrong password the same way', async () => {
  const app = createApp({ env: seedEnv() });
  const { server, base } = await listen(app);
  try {
    const unknown = await login(base, '13900002222', SEED_PASSWORD);
    const wrong = await login(base, SEED_USER, 'not-the-password');
    assert.equal(unknown.response.status, 401);
    assert.equal(wrong.response.status, 401);
    assert.deepEqual(unknown.body, { error: INVALID_LOGIN });
    assert.deepEqual(wrong.body, { error: INVALID_LOGIN });
    assert.equal(cookiesFrom(unknown.response).some((cookie) => cookie.name === SESSION_COOKIE), false);
    assert.equal(cookiesFrom(wrong.response).some((cookie) => cookie.name === SESSION_COOKIE), false);
    assert.equal(app.locals.authStore.listSessions().length, 0);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});

test('GET /api/auth/me requires the session cookie', async () => {
  const app = createApp({ env: seedEnv() });
  const { server, base } = await listen(app);
  try {
    const missing = await fetch(`${base}/api/auth/me`);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: SIGN_IN_REQUIRED });

    const { cookies, body } = await login(base);
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(cookies) } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { id: body.id, username: SEED_USER, role: 'admin' });

    const forged = await fetch(`${base}/api/auth/me`, { headers: { Cookie: `${SESSION_COOKIE}=not-a-real-session` } });
    assert.equal(forged.status, 401);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});

test('POST /api/auth/logout revokes the session and clears cookies', async () => {
  const app = createApp({ env: seedEnv() });
  const { server, base } = await listen(app);
  try {
    const { cookies } = await login(base);
    const csrf = cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    const missingCsrf = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(cookies) },
    });
    assert.equal(missingCsrf.status, 403);
    const stillIn = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(cookies) } });
    assert.equal(stillIn.status, 200);

    const logout = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader(cookies),
        'X-CSRF-Token': csrf.value,
      },
    });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { ok: true });
    const cleared = cookiesFrom(logout);
    assert.ok(cleared.some((cookie) => cookie.name === SESSION_COOKIE));
    assert.ok(cleared.some((cookie) => cookie.name === CSRF_COOKIE));

    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(cookies) } });
    assert.equal(me.status, 401);
    const sessions = app.locals.authStore.listSessions();
    assert.equal(sessions.length, 1);
    assert.ok(sessions[0].revoked_at);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});

test('POST /api/realtime-token is blocked without a session and allowed with one', async () => {
  const calls = [];
  const createClient = (options) => {
    calls.push(options);
    return { tokens: { create: async () => ({ apiKey: 'ek_short_lived' }) } };
  };
  const app = createApp({
    env: seedEnv({ DECART_API_KEY: 'dct_permanent' }),
    createClient,
  });
  const { server, base } = await listen(app);
  try {
    const blocked = await fetch(`${base}/api/realtime-token`, { method: 'POST' });
    assert.equal(blocked.status, 401);
    assert.deepEqual(await blocked.json(), { error: SIGN_IN_REQUIRED });
    assert.deepEqual(calls, []);

    const { cookies } = await login(base);
    const csrf = cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    const mismatch = await fetch(`${base}/api/realtime-token`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(cookies), 'X-CSRF-Token': 'wrong-token' },
    });
    assert.equal(mismatch.status, 403);
    assert.equal(calls.length, 0);

    const allowed = await fetch(`${base}/api/realtime-token`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(cookies), 'X-CSRF-Token': csrf.value },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { apiKey: 'ek_short_lived' });
    assert.deepEqual(calls, [{ apiKey: 'dct_permanent' }]);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});

test('a revoked session cannot mint a realtime token', async () => {
  let called = false;
  const app = createApp({
    env: seedEnv({ DECART_API_KEY: 'dct_permanent' }),
    createClient: () => {
      called = true;
      return { tokens: { create: async () => ({ apiKey: 'ek_nope' }) } };
    },
  });
  const { server, base } = await listen(app);
  try {
    const { cookies } = await login(base);
    const csrf = cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(cookies), 'X-CSRF-Token': csrf.value },
    });
    const response = await fetch(`${base}/api/realtime-token`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(cookies), 'X-CSRF-Token': csrf.value },
    });
    assert.equal(response.status, 401);
    assert.equal(called, false);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});

test('seed stays off unless AUTH_SEED is enabled, and a short seed password is refused', async () => {
  const off = createApp({
    env: {
      AUTH_SEED_USERNAME: SEED_USER,
      AUTH_SEED_PASSWORD: SEED_PASSWORD,
    },
  });
  const { server, base } = await listen(off);
  try {
    const { response, body } = await login(base);
    assert.equal(response.status, 401);
    assert.deepEqual(body, { error: INVALID_LOGIN });
    assert.equal(off.locals.authStore.listUsers().length, 0);
  } finally {
    off.locals.authStore.close();
    await close(server);
  }

  assert.throws(
    () => createApp({
      env: { AUTH_SEED: '1', AUTH_SEED_USERNAME: 'demo', AUTH_SEED_PASSWORD: 'short' },
    }),
    /8/,
  );
});

test('seed does not reset an existing password, and an admin can create another user', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsdwear-auth-'));
  const dbPath = path.join(dir, 'auth.sqlite');
  const env = seedEnv({ AUTH_DB_PATH: dbPath });
  const first = createApp({ env });
  const { server, base } = await listen(first);
  try {
    const { cookies, body } = await login(base);
    const csrf = cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    const created = await fetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(cookies),
        'X-CSRF-Token': csrf.value,
      },
      body: JSON.stringify({ username: 'staff01', password: 'staff-pass-8' }),
    });
    assert.equal(created.status, 201);
    const staff = await created.json();
    assert.equal(staff.username, 'staff01');
    assert.equal(staff.role, 'user');

    const changed = await fetch(`${base}/api/auth/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(cookies),
        'X-CSRF-Token': csrf.value,
      },
      body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: 'updated-pass-8' }),
    });
    assert.equal(changed.status, 200);
    const afterChange = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(cookies) } });
    assert.equal(afterChange.status, 401);
  } finally {
    first.locals.authStore.close();
    await close(server);
  }

  const second = createApp({ env });
  const restarted = await listen(second);
  try {
    const oldPassword = await login(restarted.base, SEED_USER, SEED_PASSWORD);
    assert.equal(oldPassword.response.status, 401);
    const updated = await login(restarted.base, SEED_USER, 'updated-pass-8');
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.username, SEED_USER);
    const staff = await login(restarted.base, 'staff01', 'staff-pass-8');
    assert.equal(staff.response.status, 200);
    assert.equal(staff.body.role, 'user');
    const denied = await fetch(`${restarted.base}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(staff.cookies),
        'X-CSRF-Token': staff.cookies.find((cookie) => cookie.name === CSRF_COOKIE).value,
      },
      body: JSON.stringify({ username: 'other', password: 'other-pass-8' }),
    });
    assert.equal(denied.status, 403);
  } finally {
    second.locals.authStore.close();
    await close(restarted.server);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SESSION_DAYS sets the cookie lifetime in days', async () => {
  const app = createApp({ env: seedEnv({ SESSION_DAYS: '1' }) });
  const { server, base } = await listen(app);
  try {
    const { cookies } = await login(base);
    const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
    assert.equal(Number(session.flags['max-age']), 24 * 60 * 60);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});

test('session cookies are Secure when the request arrives over HTTPS', async () => {
  const app = createApp({ env: seedEnv() });
  const { server, base } = await listen(app);
  try {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ username: SEED_USER, password: SEED_PASSWORD }),
    });
    assert.equal(response.status, 200);
    const session = cookiesFrom(response).find((cookie) => cookie.name === SESSION_COOKIE);
    assert.equal(session.flags.secure, true);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});
