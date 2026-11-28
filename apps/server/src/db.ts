import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '{}',
  seed TEXT NOT NULL DEFAULT '',
  aborted INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status, visibility, created_at DESC);

CREATE TABLE IF NOT EXISTS match_seats (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX IF NOT EXISTS idx_seats_user ON match_seats(user_id);

CREATE TABLE IF NOT EXISTS match_events (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  actor INTEGER,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, seq)
);

CREATE TABLE IF NOT EXISTS match_actions (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, action_id)
);

CREATE TABLE IF NOT EXISTS match_rankings (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  score INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_match ON chat_messages(match_id, id);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  contact TEXT,
  user_id TEXT,
  match_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_game ON feedback(game_id, id);
`);

// —— 迁移：为旧库补上账号字段（全部可重复执行） ——
const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
const hasColumn = (name: string) => userColumns.some((column) => column.name === name);
if (!hasColumn('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
if (!hasColumn('password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE) WHERE username IS NOT NULL',
);

// —— 迁移：为旧库补上开局选项（可重复执行） ——
const matchColumns = db.prepare('PRAGMA table_info(matches)').all() as Array<{ name: string }>;
if (!matchColumns.some((column) => column.name === 'options')) {
  db.exec("ALTER TABLE matches ADD COLUMN options TEXT NOT NULL DEFAULT '{}'");
}
if (!matchColumns.some((column) => column.name === 'seed')) {
  db.exec("ALTER TABLE matches ADD COLUMN seed TEXT NOT NULL DEFAULT ''");
}
if (!matchColumns.some((column) => column.name === 'aborted')) {
  db.exec('ALTER TABLE matches ADD COLUMN aborted INTEGER NOT NULL DEFAULT 0');
}
const actionColumns = db.prepare('PRAGMA table_info(match_actions)').all() as Array<{ name: string }>;
if (!actionColumns.some((column) => column.name === 'payload')) {
  db.exec("ALTER TABLE match_actions ADD COLUMN payload TEXT NOT NULL DEFAULT '{}'");
}

export interface UserRow {
  id: string;
  name: string;
  /** 注册用户名；游客为 null */
  username: string | null;
}

export interface AccountRow extends UserRow {
  password_hash: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ------------------------------ users ------------------------------ */

const ADJECTIVES = ['机智的', '沉着的', '幸运的', '勇敢的', '安静的', '敏捷的', '严谨的', '随性的'];
const NOUNS = ['棋手', '旅人', '猫', '狐狸', '海豚', '熊猫', '麻雀', '水獭'];

function randomName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = 100 + Math.floor(Math.random() * 900);
  return `${a}${n}${num}`;
}

export function createUser(name?: string): UserRow {
  const user: UserRow = {
    id: randomBytes(9).toString('base64url'),
    name: sanitizeName(name) ?? randomName(),
    username: null,
  };
  db.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)').run(
    user.id,
    user.name,
    Date.now(),
  );
  return user;
}

export function getUser(id: string): UserRow | null {
  const row = db.prepare('SELECT id, name, username FROM users WHERE id = ?').get(id) as
    | (UserRow & Record<string, unknown>)
    | undefined;
  return row ? toUserRow(row) : null;
}

export function renameUser(id: string, name: string): UserRow {
  const clean = sanitizeName(name);
  if (!clean) throw new Error('invalid name');
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(clean, id);
  return getUser(id)!;
}

function toUserRow(row: UserRow & Record<string, unknown>): UserRow {
  return {
    id: String(row.id),
    name: String(row.name),
    username: row.username == null ? null : String(row.username),
  };
}

/** 用户名规则：字母开头，3-24 位字母/数字/下划线 */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const username = raw.trim();
  return /^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(username) ? username : null;
}

export function usernameTaken(username: string): boolean {
  const row = db
    .prepare('SELECT 1 AS hit FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
  return Boolean(row);
}

export function findAccountByUsername(username: string): AccountRow | null {
  const row = db
    .prepare(
      'SELECT id, name, username, password_hash FROM users WHERE username = ? COLLATE NOCASE',
    )
    .get(username) as (AccountRow & Record<string, unknown>) | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    username: row.username == null ? null : String(row.username),
    password_hash: String(row.password_hash),
  };
}

export function createAccount(username: string, passwordHash: string, name?: string): UserRow {
  const id = randomBytes(9).toString('base64url');
  const displayName = sanitizeName(name) ?? username.slice(0, 16);
  db.prepare(
    'INSERT INTO users (id, name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, displayName, username, passwordHash, Date.now());
  return getUser(id)!;
}

/** 把当前游客升级为注册账号，保留其用户 id（历史对局与座位不变） */
export function upgradeToAccount(
  userId: string,
  username: string,
  passwordHash: string,
  name?: string,
): UserRow {
  const current = getUser(userId);
  if (!current) throw new Error('user not found');
  const displayName = sanitizeName(name) ?? current.name;
  db.prepare('UPDATE users SET username = ?, password_hash = ?, name = ? WHERE id = ?').run(
    username,
    passwordHash,
    displayName,
    userId,
  );
  return getUser(userId)!;
}

export function deleteSession(sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return name.length > 0 ? name : null;
}

/* ----------------------------- sessions ---------------------------- */

export function createSession(userId: string, ttlMs: number): string {
  const id = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    now,
    now + ttlMs,
  );
  return id;
}

export function sessionUser(sessionId: string): UserRow | null {
  const row = db
    .prepare(
      `SELECT u.id AS id, u.name AS name, u.username AS username
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, Date.now()) as (UserRow & Record<string, unknown>) | undefined;
  return row ? toUserRow(row) : null;
}

export function deleteExpiredSessions(): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export interface FeedbackRow {
  id: number;
  game_id: string;
  category: string;
  message: string;
  contact: string | null;
  user_id: string | null;
  match_id: string | null;
  created_at: number;
}

export function addFeedback(input: {
  gameId: string;
  category: string;
  message: string;
  contact?: string | null;
  userId?: string | null;
  matchId?: string | null;
}): number {
  const result = db
    .prepare(
      `INSERT INTO feedback (game_id, category, message, contact, user_id, match_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.gameId,
      input.category,
      input.message,
      input.contact ?? null,
      input.userId ?? null,
      input.matchId ?? null,
      Date.now(),
    );
  return Number(result.lastInsertRowid);
}

export function countFeedback(gameId?: string): number {
  const row = gameId
    ? (db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE game_id = ?').get(gameId) as { n: number })
    : (db.prepare('SELECT COUNT(*) AS n FROM feedback').get() as { n: number });
  return Number(row?.n ?? 0);
}

export function listFeedback(limit = 500, gameId?: string): FeedbackRow[] {
  const rows = gameId
    ? db.prepare('SELECT * FROM feedback WHERE game_id = ? ORDER BY id DESC LIMIT ?').all(gameId, limit)
    : db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?').all(limit);
  return rows as unknown as FeedbackRow[];
}
