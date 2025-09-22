// db.js
import { Database } from "bun:sqlite";

const dbPath = process.env.DATABASE_PATH || "./app.db";
const db = new Database(dbPath, { create: true });

db.exec(`
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
`);

export default db;
