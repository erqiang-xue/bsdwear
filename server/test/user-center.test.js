import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import * as sqlite from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { openAuthStore } from '../src/authStore.js';
import { CSRF_COOKIE, SESSION_COOKIE, hashPassword, hashToken } from '../src/security.js';
import { OAUTH_COOKIE, allowedRedirectUris, userCenterConfig } from '../src/userCenter.js';

const CENTER = 'http://127.0.0.1:43123';
const VITE_CALLBACK = 'http://127.0.0.1:5173/auth/oauth/callback';
const LOCALHOST_VITE_CALLBACK = 'http://localhost:5173/auth/oauth/callback';
const SERVER_CALLBACK = 'http://127.0.0.1:3001/auth/oauth/callback';
const LOCALHOST_SERVER_CALLBACK = 'http://localhost:3001/auth/oauth/callback';
const PRODUCTION_CALLBACK = 'https://wear.erqiang.cn/auth/oauth/callback';

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
  const headers = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return headers.map(parseSetCookie);
}

function cookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function centerEnv(extra = {}) {
  return {
    USER_CENTER_ENABLED: 'true',
    USER_CENTER_BASE_URL: CENTER,
    USER_CENTER_CLIENT_ID: 'bsdwear',
    USER_CENTER_PUBLIC_URL: 'http://127.0.0.1:5173',
    AUTH_SEED: '1',
    AUTH_SEED_USERNAME: 'staff01',
    AUTH_SEED_PASSWORD: 'staff-pass-8',
    ...extra,
  };
}

function formEntries(body) {
  if (!body) return {};
  return Object.fromEntries(new URLSearchParams(body).entries());
}

function installFetch(profile, { tokenStatus = 200, userinfoStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method,
      form: formEntries(init.body),
      headers: init.headers || {},
    });
    if (String(url).endsWith('/oauth/token')) {
      if (tokenStatus !== 200) {
        return { status: tokenStatus, json: async () => ({ error: 'invalid_grant' }) };
      }
      return {
        status: 200,
        json: async () => ({
          access_token: 'access-test',
          token_type: 'Bearer',
          expires_in: 900,
          refresh_token: 'refresh-test',
          id_token: 'id-test',
        }),
      };
    }
    if (String(url).endsWith('/oauth/userinfo')) {
      if (userinfoStatus !== 200) {
        return { status: userinfoStatus, json: async () => ({ error: 'unauthorized' }) };
      }
      return { status: 200, json: async () => profile };
    }
    throw new Error(`unexpected user center call ${url}`);
  };
  return { fetchImpl, calls };
}

function httpRequest(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'] || [];
          resolve({
            status: res.statusCode,
            headers: {
              get(name) {
                const value = res.headers[name.toLowerCase()];
                return Array.isArray(value) ? value[0] : value ?? null;
              },
              getSetCookie() {
                return setCookie;
              },
            },
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function startAuthorize(base, host) {
  const headers = host ? { host } : {};
  const response = await httpRequest(`${base}/auth/oauth/start`, { headers });
  const location = response.headers.get('location') || '';
  const params = location ? Object.fromEntries(new URL(location).searchParams.entries()) : {};
  return { response, location, params, cookies: cookiesFrom(response) };
}

async function callback(base, params, cookies, code = 'auth-code') {
  const response = await fetch(
    `${base}/auth/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(params.state)}`,
    {
      headers: { Cookie: cookieHeader(cookies) },
      redirect: 'manual',
    },
  );
  return { response, cookies: cookiesFrom(response) };
}

async function withApp(env, fetchImpl, fn) {
  const app = createApp({ env, fetchImpl });
  const started = await listen(app);
  try {
    await fn(app, started.base);
  } finally {
    app.locals.authStore.close();
    await close(started.server);
  }
}

test('default callbacks are the local dev origins and not the production front door', () => {
  const uris = allowedRedirectUris(userCenterConfig(centerEnv()));
  assert.deepEqual(uris, [VITE_CALLBACK, LOCALHOST_VITE_CALLBACK, SERVER_CALLBACK, LOCALHOST_SERVER_CALLBACK]);
  assert.equal(uris.includes(PRODUCTION_CALLBACK), false);
});

test('enabling user center without a base URL fails closed', () => {
  assert.throws(
    () => createApp({ env: { USER_CENTER_ENABLED: 'true', USER_CENTER_PUBLIC_URL: 'http://127.0.0.1:5173' } }),
    /USER_CENTER_BASE_URL/,
  );
});

test('flag off keeps password login and hides the oauth routes', async () => {
  await withApp(
    {
      AUTH_SEED: '1',
      AUTH_SEED_USERNAME: 'staff01',
      AUTH_SEED_PASSWORD: 'staff-pass-8',
    },
    undefined,
    async (app, base) => {
      const config = await fetch(`${base}/api/auth/config`);
      assert.deepEqual(await config.json(), { userCenterEnabled: false });
      const hidden = await fetch(`${base}/auth/oauth/start`, { redirect: 'manual' });
      assert.equal(hidden.status, 404);
      assert.equal((await hidden.json()).code, 'USER_CENTER_DISABLED');
      const callbackHidden = await fetch(`${base}/auth/oauth/callback`, { redirect: 'manual' });
      assert.equal(callbackHidden.status, 404);
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'staff01', password: 'staff-pass-8' }),
      });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).username, 'staff01');
      assert.equal(app.locals.authStore.findUserByUsername('staff01').center_user_id, null);
    },
  );
});

test('start redirects to the hosted authorize page with public PKCE and no client secret', async () => {
  await withApp(centerEnv(), undefined, async (_app, base) => {
    const { response, location, params, cookies } = await startAuthorize(base);
    assert.equal(response.status, 302);
    assert.equal(location.startsWith(`${CENTER}/oauth/authorize?`), true);
    assert.equal(params.response_type, 'code');
    assert.equal(params.client_id, 'bsdwear');
    assert.equal(params.redirect_uri, VITE_CALLBACK);
    assert.equal(params.code_challenge_method, 'S256');
    assert.equal(params.scope, 'openid profile phone');
    assert.equal(params.client_secret, undefined);
    assert.equal(params.password, undefined);
    assert.equal(params.prompt, undefined);
    assert.ok(params.code_challenge.length >= 43);
    const oauth = cookies.find((cookie) => cookie.name === OAUTH_COOKIE);
    assert.equal(OAUTH_COOKIE, 'bw_oauth');
    assert.equal(oauth.flags.httponly, true);
    assert.equal(oauth.flags.path, '/auth/oauth');
    assert.equal(Number(oauth.flags['max-age']), 600);
    assert.equal(cookies.some((cookie) => cookie.name === SESSION_COOKIE), false);

    const localhost = await startAuthorize(base, 'localhost:5173');
    assert.equal(localhost.params.redirect_uri, LOCALHOST_VITE_CALLBACK);
    const direct = await startAuthorize(base, '127.0.0.1:3001');
    assert.equal(direct.params.redirect_uri, SERVER_CALLBACK);
    const loopbackServer = await startAuthorize(base, 'localhost:3001');
    assert.equal(loopbackServer.params.redirect_uri, LOCALHOST_SERVER_CALLBACK);
  });
});

test('callback links a unique username, keeps the password hash, and opens bw_session', async () => {
  const centerId = randomUUID();
  const fake = installFetch({
    sub: centerId,
    name: '店员',
    preferred_username: 'Staff01',
    phone_number_verified: false,
  });
  await withApp(centerEnv(), fake.fetchImpl, async (app, base) => {
    const before = app.locals.authStore.findUserByUsername('staff01');
    const { params, cookies } = await startAuthorize(base);
    const done = await callback(base, params, cookies);
    assert.equal(done.response.status, 302);
    assert.equal(done.response.headers.get('location'), '/');
    const session = done.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
    const csrf = done.cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    assert.equal(session.flags.httponly, true);
    assert.ok(csrf?.value);
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(done.cookies) } });
    assert.deepEqual(await me.json(), { id: before.id, username: 'staff01', role: 'admin' });

    const linked = app.locals.authStore.findUserById(before.id);
    assert.equal(linked.center_user_id, centerId);
    assert.equal(linked.password_hash, before.password_hash);
    assert.equal(linked.phone, null);
    const row = app.locals.authStore.findCenterLinkByUser(before.id);
    assert.equal(row.legacy_app, 'bsdwear');
    assert.equal(row.center_user_id, centerId);
    assert.equal(app.locals.authStore.listUsers().length, 1);

    const tokenCall = fake.calls.find((call) => call.url.endsWith('/oauth/token'));
    assert.equal(tokenCall.form.grant_type, 'authorization_code');
    assert.equal(tokenCall.form.redirect_uri, VITE_CALLBACK);
    assert.equal(tokenCall.form.client_id, 'bsdwear');
    assert.equal(tokenCall.form.client_secret, undefined);
    assert.equal('password' in tokenCall.form, false);
    const digest = createHash('sha256').update(tokenCall.form.code_verifier).digest('base64url');
    assert.equal(digest, params.code_challenge);
    const infoCall = fake.calls.find((call) => call.url.endsWith('/oauth/userinfo'));
    assert.equal(infoCall.headers.Authorization, 'Bearer access-test');
    const dumped = JSON.stringify(fake.calls);
    assert.equal(dumped.includes(before.password_hash), false);
    assert.equal(dumped.includes('password_hash'), false);

    const stored = app.locals.authStore.listSessions().find((entry) => entry.token_hash === hashToken(session.value));
    assert.ok(stored);
    assert.equal(stored.token_hash === session.value, false);
  });
});

test('a later login with the same center user id does not rebind or copy a password', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsdwear-center-'));
  const dbPath = path.join(dir, 'auth.sqlite');
  const centerId = randomUUID();
  const env = centerEnv({ AUTH_DB_PATH: dbPath });
  const firstFetch = installFetch({ sub: centerId, preferred_username: 'staff01' });
  await withApp(env, firstFetch.fetchImpl, async (_app, base) => {
    const started = await startAuthorize(base);
    assert.equal((await callback(base, started.params, started.cookies)).response.status, 302);
  });
  const original = openAuthStore(dbPath);
  const before = original.findUserByUsername('staff01');
  original.close();

  const secondFetch = installFetch({
    sub: centerId.toUpperCase(),
    preferred_username: 'not-staff',
    phone_number: '13900002222',
  });
  await withApp(env, secondFetch.fetchImpl, async (app, base) => {
    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    assert.equal(done.response.status, 302);
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(done.cookies) } });
    assert.equal((await me.json()).username, 'staff01');
    const linked = app.locals.authStore.findUserByUsername('staff01');
    assert.equal(linked.center_user_id, centerId);
    assert.equal(linked.password_hash, before.password_hash);
    assert.equal(linked.phone, null);
    assert.equal(app.locals.authStore.listUsers().length, 1);
    assert.equal(JSON.stringify(secondFetch.calls).includes(before.password_hash), false);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('username match wins and does not merge a different phone account', async () => {
  const centerId = randomUUID();
  const fake = installFetch({
    sub: centerId,
    preferred_username: 'staff01',
    phone_number: '13900002222',
    phone_number_verified: true,
  });
  await withApp(centerEnv(), fake.fetchImpl, async (app, base) => {
    const phoneHash = hashPassword('phone-pass-8');
    const phoneUser = app.locals.authStore.createUser({
      username: '13900002222',
      passwordHash: phoneHash,
      role: 'user',
    });
    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    assert.equal(done.response.status, 302);
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(done.cookies) } });
    assert.equal((await me.json()).username, 'staff01');
    const staff = app.locals.authStore.findUserByUsername('staff01');
    const other = app.locals.authStore.findUserById(phoneUser.id);
    assert.equal(staff.center_user_id, centerId);
    assert.equal(staff.phone, null);
    assert.equal(other.center_user_id, null);
    assert.equal(other.password_hash, phoneHash);
    assert.equal(app.locals.authStore.findCenterLinkByUser(other.id), null);
  });
});

test('normalized phone links the unique phone-style username when the center has no username', async () => {
  const centerId = randomUUID();
  const fake = installFetch({
    sub: centerId,
    phone_number: '+86 138-0013-8000',
    phone_number_verified: true,
  });
  await withApp(
    centerEnv({ AUTH_SEED_USERNAME: '13800138000' }),
    fake.fetchImpl,
    async (app, base) => {
      const before = app.locals.authStore.findUserByUsername('13800138000');
      const started = await startAuthorize(base);
      const done = await callback(base, started.params, started.cookies);
      assert.equal(done.response.status, 302);
      const linked = app.locals.authStore.findUserById(before.id);
      assert.equal(linked.center_user_id, centerId);
      assert.equal(linked.username, '13800138000');
      assert.equal(linked.phone, '13800138000');
      assert.equal(linked.password_hash, before.password_hash);
      const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(done.cookies) } });
      assert.equal((await me.json()).username, '13800138000');
    },
  );
});

test('an ambiguous phone does not merge accounts or open a session', async () => {
  const fake = installFetch({
    sub: randomUUID(),
    phone_number: '13800138000',
    phone_number_verified: true,
  });
  await withApp(centerEnv(), fake.fetchImpl, async (app, base) => {
    app.locals.authStore.createUser({
      username: 'alice',
      passwordHash: hashPassword('alice-pass-8'),
      role: 'user',
      phone: '13800138000',
    });
    app.locals.authStore.createUser({
      username: '13800138000',
      passwordHash: hashPassword('phone-pass-8'),
      role: 'user',
    });
    const before = app.locals.authStore.listUsers().map((user) => user.center_user_id);
    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    assert.equal(done.response.status, 302);
    assert.equal(done.response.headers.get('location'), '/?user_center_error=IDENTITY_CONFLICT');
    assert.equal(done.cookies.some((cookie) => cookie.name === SESSION_COOKIE && cookie.value), false);
    const me = await fetch(`${base}/api/auth/me`);
    assert.equal(me.status, 401);
    assert.deepEqual(
      app.locals.authStore.listUsers().map((user) => user.center_user_id),
      before,
    );
  });
});

test('a username already linked to someone else is not taken over', async () => {
  const fake = installFetch({ sub: randomUUID(), preferred_username: 'staff01' });
  await withApp(centerEnv(), fake.fetchImpl, async (app, base) => {
    const existing = randomUUID();
    const user = app.locals.authStore.findUserByUsername('staff01');
    assert.equal(app.locals.authStore.bindCenterUser(user.id, existing), true);
    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    assert.equal(done.response.headers.get('location'), '/?user_center_error=IDENTITY_CONFLICT');
    assert.equal(app.locals.authStore.findUserById(user.id).center_user_id, existing);
    assert.equal(app.locals.authStore.listSessions().length, 0);
  });
});

test('a center account with no local match does not create a try-on user', async () => {
  const fake = installFetch({
    sub: randomUUID(),
    preferred_username: 'new-person',
    phone_number: '13700003333',
    phone_number_verified: true,
  });
  await withApp(centerEnv(), fake.fetchImpl, async (app, base) => {
    const before = app.locals.authStore.listUsers().length;
    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    assert.equal(done.response.headers.get('location'), '/?user_center_error=ACCOUNT_NOT_LINKED');
    assert.equal(app.locals.authStore.listUsers().length, before);
    assert.equal(app.locals.authStore.listSessions().length, 0);
    const me = await fetch(`${base}/api/auth/me`);
    assert.equal(me.status, 401);
  });
});

test('userinfo 401 and a profile without sub do not open a session', async () => {
  const disabled = installFetch({}, { userinfoStatus: 401 });
  await withApp(centerEnv(), disabled.fetchImpl, async (app, base) => {
    const before = app.locals.authStore.listUsers().length;
    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    assert.equal(done.response.headers.get('location'), '/?user_center_error=ACCOUNT_DISABLED');
    assert.equal(app.locals.authStore.listUsers().length, before);
    assert.equal(app.locals.authStore.listSessions().length, 0);
  });

  const unknown = installFetch({ name: '没有主体' });
  await withApp(centerEnv(), unknown.fetchImpl, async (app, base) => {
    const before = app.locals.authStore.listUsers().length;
    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    assert.equal(done.response.headers.get('location'), '/?user_center_error=UNKNOWN_ACCOUNT');
    assert.equal(app.locals.authStore.listUsers().length, before);
  });
});

test('a bad state or a denied authorize response does not open a session', async () => {
  const fake = installFetch({ sub: randomUUID(), preferred_username: 'staff01' });
  await withApp(centerEnv(), fake.fetchImpl, async (app, base) => {
    const started = await startAuthorize(base);
    const mismatch = await callback(base, { ...started.params, state: 'different-state' }, started.cookies);
    assert.equal(mismatch.response.headers.get('location'), '/?user_center_error=OAUTH_STATE');
    const denied = await fetch(`${base}/auth/oauth/callback?error=access_denied&state=${started.params.state}`, {
      headers: { Cookie: cookieHeader(started.cookies) },
      redirect: 'manual',
    });
    assert.equal(denied.headers.get('location'), '/?user_center_error=OAUTH_DENIED');
    assert.equal(app.locals.authStore.listSessions().length, 0);
    assert.equal(fake.calls.length, 0);
  });
});

test('local password login and password change are closed while the flag is on', async () => {
  const centerId = randomUUID();
  const fake = installFetch({ sub: centerId, preferred_username: 'staff01' });
  await withApp(centerEnv(), fake.fetchImpl, async (app, base) => {
    const blocked = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staff01', password: 'staff-pass-8' }),
    });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'USER_CENTER_REQUIRED');
    assert.equal(cookiesFrom(blocked).some((cookie) => cookie.name === SESSION_COOKIE), false);

    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    const csrf = done.cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    const callsAfterLogin = fake.calls.length;
    const changed = await fetch(`${base}/api/auth/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(done.cookies),
        'X-CSRF-Token': csrf.value,
      },
      body: JSON.stringify({ currentPassword: 'staff-pass-8', newPassword: 'updated-pass-8' }),
    });
    assert.equal(changed.status, 403);
    assert.equal((await changed.json()).code, 'USER_CENTER_REQUIRED');
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(done.cookies) } });
    assert.equal(me.status, 200);

    const logout = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(done.cookies), 'X-CSRF-Token': csrf.value },
    });
    assert.equal(logout.status, 200);
    assert.equal(fake.calls.length, callsAfterLogin);
    const after = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(done.cookies) } });
    assert.equal(after.status, 401);

    const created = await fetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(done.cookies),
        'X-CSRF-Token': csrf.value,
      },
      body: JSON.stringify({ username: 'staff02', password: 'staff-pass-8' }),
    });
    assert.equal(created.status, 401);
    const fresh = await startAuthorize(base);
    const signed = await callback(base, fresh.params, fresh.cookies);
    const freshCsrf = signed.cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    const added = await fetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(signed.cookies),
        'X-CSRF-Token': freshCsrf.value,
      },
      body: JSON.stringify({ username: 'staff02', password: 'staff-pass-8' }),
    });
    assert.equal(added.status, 201);
    assert.equal(app.locals.authStore.findUserByUsername('staff02').center_user_id, null);
  });
});

test('an extra redirect uri is used when the browser host matches it', async () => {
  const extra = 'http://127.0.0.1:4173/auth/oauth/callback';
  await withApp(centerEnv({ USER_CENTER_EXTRA_REDIRECT_URIS: extra }), undefined, async (_app, base) => {
    const started = await startAuthorize(base, '127.0.0.1:4173');
    assert.equal(started.params.redirect_uri, extra);
    const unknown = await startAuthorize(base, '127.0.0.1:9');
    assert.equal(unknown.params.redirect_uri, VITE_CALLBACK);
  });
});

test('oauth callback session authorizes a try-on token', async () => {
  const fake = installFetch({ sub: randomUUID(), preferred_username: 'staff01' });
  const calls = [];
  const app = createApp({
    env: centerEnv({ DECART_API_KEY: 'dct_permanent' }),
    fetchImpl: fake.fetchImpl,
    createClient: (options) => {
      calls.push(options);
      return { tokens: { create: async () => ({ apiKey: 'ek_short_lived' }) } };
    },
  });
  const { server, base } = await listen(app);
  try {
    const started = await startAuthorize(base);
    const done = await callback(base, started.params, started.cookies);
    const csrf = done.cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    const token = await fetch(`${base}/api/realtime-token`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(done.cookies), 'X-CSRF-Token': csrf.value },
    });
    assert.equal(token.status, 200);
    assert.deepEqual(await token.json(), { apiKey: 'ek_short_lived' });
    assert.deepEqual(calls, [{ apiKey: 'dct_permanent' }]);
  } finally {
    app.locals.authStore.close();
    await close(server);
  }
});

test('opening an older account file adds center id and phone without rewriting the password', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsdwear-old-'));
  const dbPath = path.join(dir, 'auth.sqlite');
  const Database = sqlite.DatabaseSync ?? sqlite.Database;
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  const hash = hashPassword('staff-pass-8');
  db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run('staff01', hash, 'admin', Date.now());
  db.close();

  const store = openAuthStore(dbPath);
  try {
    const user = store.findUserByUsername('staff01');
    assert.equal(user.password_hash, hash);
    assert.equal(user.center_user_id, null);
    assert.equal(user.phone, null);
    assert.equal(store.bindCenterUser(user.id, randomUUID()), true);
    assert.equal(store.setPhoneIfEmpty(user.id, '13800138000'), true);
    assert.equal(store.findUserById(user.id).password_hash, hash);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
