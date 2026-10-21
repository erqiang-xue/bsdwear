import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');
export const defaultAuthDbPath = path.join(repoRoot, 'data', 'auth.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
`;

export function resolveAuthDbPath(env = process.env) {
  const configured = typeof env.AUTH_DB_PATH === 'string' ? env.AUTH_DB_PATH.trim() : '';
  if (configured === ':memory:') return ':memory:';
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
  if (env === process.env) return defaultAuthDbPath;
  return ':memory:';
}

export function openAuthStore(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
  );
  const selectUserByUsername = db.prepare(
    'SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?',
  );
  const selectUserById = db.prepare(
    'SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?',
  );
  const updatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  const insertSession = db.prepare(
    'INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const selectActiveSession = db.prepare(`
    SELECT u.id AS id, u.username AS username, u.role AS role, s.csrf_token AS csrf_token, s.expires_at AS expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
  `);
  const revokeSession = db.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
  );
  const revokeUserSessions = db.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
  );
  const listSessions = db.prepare(
    'SELECT id, user_id, token_hash, csrf_token, expires_at, revoked_at, created_at FROM sessions ORDER BY id',
  );
  const listUsers = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id');

  return {
    createUser({ username, passwordHash, role, createdAt = Date.now() }) {
      try {
        const info = insertUser.run(username, passwordHash, role, createdAt);
        return { id: Number(info.lastInsertRowid), username, role };
      } catch (error) {
        if (String(error?.message || '').includes('UNIQUE')) return null;
        throw error;
      }
    },
    findUserByUsername(username) {
      return selectUserByUsername.get(username) || null;
    },
    findUserById(id) {
      return selectUserById.get(id) || null;
    },
    updatePassword(id, passwordHash) {
      updatePassword.run(passwordHash, id);
    },
    createSession({ userId, tokenHash, csrfToken, expiresAt, createdAt = Date.now() }) {
      insertSession.run(userId, tokenHash, csrfToken, expiresAt, createdAt);
    },
    findActiveSession(tokenHash, nowMs) {
      return selectActiveSession.get(tokenHash, nowMs) || null;
    },
    revokeSession(tokenHash, nowMs) {
      revokeSession.run(nowMs, tokenHash);
    },
    revokeUserSessions(userId, nowMs) {
      revokeUserSessions.run(nowMs, userId);
    },
    listSessions() {
      return listSessions.all();
    },
    listUsers() {
      return listUsers.all();
    },
    close() {
      db.close();
    },
  };
}
