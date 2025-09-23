// db.js
import { Database } from "bun:sqlite";

const dbPath = process.env.DATABASE_PATH || "./app.db";
const db = new Database(dbPath, { create: true });

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  level TEXT NOT NULL,         -- beginner | intermediate | advanced
  focus TEXT NOT NULL,         -- intro | keigo | travel | ...
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- A generated 15-minute lesson (3 units)
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  level TEXT NOT NULL,
  focus TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'preparing',   -- preparing | ready | error
  created_at TEXT NOT NULL,
  ready_at TEXT,
  error TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Each lesson has three units: vocab | speaking | conversation
CREATE TABLE IF NOT EXISTS lesson_units (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  type TEXT NOT NULL,                          -- vocab | speaking | conversation
  intro_text TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(lesson_id) REFERENCES lessons(id)
);

-- Vocab items (10 recommended)
CREATE TABLE IF NOT EXISTS vocab_items (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  jp TEXT NOT NULL,
  en TEXT NOT NULL,
  description TEXT,
  example_jp TEXT,
  example_en TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  audio_url TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(unit_id) REFERENCES lesson_units(id)
);

-- Speaking items (sentences to say)
CREATE TABLE IF NOT EXISTS speaking_items (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  jp TEXT NOT NULL,
  en TEXT NOT NULL,
  description TEXT,
  example_jp TEXT,
  example_en TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  audio_url TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(unit_id) REFERENCES lesson_units(id)
);

-- Conversation script (ordered turns)
CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  speaker TEXT NOT NULL,                       -- "bot" | "user" (or "A"/"B")
  jp TEXT NOT NULL,
  en TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  audio_url TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(unit_id) REFERENCES lesson_units(id)
);

-- Generic attempts log for any item (optional but handy)
CREATE TABLE IF NOT EXISTS practice_attempts (
  id TEXT PRIMARY KEY,
  item_table TEXT NOT NULL,                    -- 'vocab_items' | 'speaking_items' | 'conversation_turns'
  item_id TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  attempted_at TEXT NOT NULL
);

-- Simple job queue for generation
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,                  -- original request (level/focus/notes/email)
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | running | done | error
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(lesson_id) REFERENCES lessons(id)
);
`);

export default db;
