import {
  CSRF_COOKIE,
  PBKDF2_ITERATIONS,
  SESSION_COOKIE,
  cookieSecure,
  hashPassword,
  hashToken,
  newSecret,
  normalizeUsername,
  readCookie,
  sameSiteSetting,
  tokensEqual,
  verifyPassword,
} from './security.js';

export const INVALID_LOGIN = '账号或密码不正确。';
export const SIGN_IN_REQUIRED = '请先登录。';
export const CREDENTIALS_REQUIRED = '请输入账号和密码。';
export const CSRF_REJECTED = '页面已失效，请刷新后重试。';
export const PASSWORD_SHORT = '密码至少需要 8 位。';
export const PASSWORD_LONG = '密码太长。';
export const PASSWORD_FIELDS = '请输入当前密码和新密码。';
export const CURRENT_PASSWORD = '当前密码不正确。';
export const USERNAME_TAKEN = '这个账号已经有人使用。';
export const FORBIDDEN = '没有权限做这件事。';

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const SESSION_HOURS_DEFAULT = 24 * 7;

function sessionHours(env) {
  const value = Number(env.AUTH_SESSION_HOURS);
  if (!Number.isFinite(value) || value <= 0) return SESSION_HOURS_DEFAULT;
  return Math.min(value, 24 * 24);
}

function publicUser(user) {
  return { id: Number(user.id), username: user.username, role: user.role };
}

function acceptablePassword(password) {
  return typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
}

export function seedAuth(store, env) {
  const enabled = /^(1|true|yes|on)$/i.test(String(env.AUTH_SEED ?? '').trim());
  if (!enabled) return '';
  const username = normalizeUsername(env.AUTH_SEED_USERNAME);
  const password = typeof env.AUTH_SEED_PASSWORD === 'string' ? env.AUTH_SEED_PASSWORD : '';
  if (!username) {
    throw new Error('AUTH_SEED_USERNAME 无效。初始账号需要 1 到 64 位且不能包含空格。');
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error('AUTH_SEED_PASSWORD 至少需要 8 位。初始账号未创建。');
  }
  if (store.findUserByUsername(username)) return '';
  store.createUser({
    username,
    passwordHash: hashPassword(password, PBKDF2_ITERATIONS),
    role: 'admin',
  });
  return username;
}

export function mountAuth(app, { store, env, now }) {
  const sessionCookie = String(env.AUTH_SESSION_COOKIE || SESSION_COOKIE);
  const csrfCookie = String(env.AUTH_CSRF_COOKIE || CSRF_COOKIE);
  const hours = sessionHours(env);
  const sameSite = sameSiteSetting(env);
  const maxAge = Math.round(hours * 60 * 60 * 1000);
  const dummyHash = hashPassword(`dummy-${newSecret(8)}`, PBKDF2_ITERATIONS);
  const seededUsername = seedAuth(store, env);

  function clock() {
    return now();
  }

  function cookieOptions(req, httpOnly) {
    return {
      httpOnly,
      sameSite,
      secure: cookieSecure(req, env, sameSite),
      path: '/',
      maxAge,
    };
  }

  function setSessionCookies(req, res, token, csrf) {
    res.cookie(sessionCookie, token, cookieOptions(req, true));
    res.cookie(csrfCookie, csrf, cookieOptions(req, false));
  }

  function clearSessionCookies(req, res) {
    const secure = cookieSecure(req, env, sameSite);
    res.clearCookie(sessionCookie, { httpOnly: true, sameSite, secure, path: '/' });
    res.clearCookie(csrfCookie, { httpOnly: false, sameSite, secure, path: '/' });
  }

  function currentSession(req) {
    const token = readCookie(req.headers.cookie, sessionCookie);
    if (!token) return null;
    const row = store.findActiveSession(hashToken(token), clock());
    if (!row) return null;
    return { token, ...row };
  }

  function requireSession(req, res, next) {
    const session = currentSession(req);
    if (!session) {
      res.status(401).json({ error: SIGN_IN_REQUIRED });
      return;
    }
    req.auth = session;
    next();
  }

  function requireCsrf(req, res, next) {
    const cookie = readCookie(req.headers.cookie, csrfCookie);
    const header = req.get('x-csrf-token') || '';
    if (!tokensEqual(cookie, header) || !tokensEqual(cookie, req.auth?.csrf_token || '')) {
      res.status(403).json({ error: CSRF_REJECTED });
      return;
    }
    next();
  }

  app.post('/api/auth/login', (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) {
      res.status(400).json({ error: CREDENTIALS_REQUIRED });
      return;
    }
    if (password.length > PASSWORD_MAX) {
      res.status(401).json({ error: INVALID_LOGIN });
      return;
    }

    const user = store.findUserByUsername(username);
    const matches = verifyPassword(password, user?.password_hash || dummyHash);
    if (!user || !matches) {
      res.status(401).json({ error: INVALID_LOGIN });
      return;
    }

    const token = newSecret();
    const csrf = newSecret();
    store.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      csrfToken: csrf,
      expiresAt: clock() + maxAge,
    });
    setSessionCookies(req, res, token, csrf);
    res.json(publicUser(user));
  });

  app.get('/api/auth/me', (req, res) => {
    const session = currentSession(req);
    if (!session) {
      res.status(401).json({ error: SIGN_IN_REQUIRED });
      return;
    }
    res.json(publicUser(session));
  });

  app.post('/api/auth/logout', requireSession, requireCsrf, (req, res) => {
    store.revokeSession(hashToken(req.auth.token), clock());
    clearSessionCookies(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/password', requireSession, requireCsrf, (req, res) => {
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      res.status(400).json({ error: PASSWORD_FIELDS });
      return;
    }
    if (newPassword.length < PASSWORD_MIN) {
      res.status(400).json({ error: PASSWORD_SHORT });
      return;
    }
    if (newPassword.length > PASSWORD_MAX) {
      res.status(400).json({ error: PASSWORD_LONG });
      return;
    }
    const user = store.findUserById(req.auth.id);
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      res.status(400).json({ error: CURRENT_PASSWORD });
      return;
    }
    store.updatePassword(user.id, hashPassword(newPassword, PBKDF2_ITERATIONS));
    store.revokeUserSessions(user.id, clock());
    clearSessionCookies(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/users', requireSession, requireCsrf, (req, res) => {
    if (req.auth.role !== 'admin') {
      res.status(403).json({ error: FORBIDDEN });
      return;
    }
    const username = normalizeUsername(req.body?.username);
    const password = req.body?.password;
    if (!username || typeof password !== 'string') {
      res.status(400).json({ error: CREDENTIALS_REQUIRED });
      return;
    }
    if (!acceptablePassword(password)) {
      res.status(400).json({ error: password.length > PASSWORD_MAX ? PASSWORD_LONG : PASSWORD_SHORT });
      return;
    }
    const role = req.body?.role === 'admin' ? 'admin' : 'user';
    const created = store.createUser({
      username,
      passwordHash: hashPassword(password, PBKDF2_ITERATIONS),
      role,
    });
    if (!created) {
      res.status(409).json({ error: USERNAME_TAKEN });
      return;
    }
    res.status(201).json(created);
  });

  return { requireSession, requireCsrf, seededUsername };
}
