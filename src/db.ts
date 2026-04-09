import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { getDataDir } from './config';

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed';
export type MessageType   = 'text' | 'image';
export type MessageDirection = 'outbound' | 'inbound';

export interface Message {
  id: string;
  phone: string;
  type: MessageType;
  body: string | null;
  imageUrl: string | null;
  caption: string | null;
  status: MessageStatus;
  whatsappId: string | null;
  error: string | null;
  direction: MessageDirection;
  queuedAt: number;
  sentAt: number | null;
  createdAt: number;
}

export interface Stats {
  sent: number;
  queued: number;
  failed: number;
  received: number;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  status?: MessageStatus;
  phone?: string;
}

let db: DatabaseSync;

// ── Migrations ────────────────────────────────────────────────────────────────

const MIGRATIONS = [
  {
    version: 1,
    description: 'Create messages table',
    up: `
      CREATE TABLE IF NOT EXISTS messages (
        id          TEXT    PRIMARY KEY,
        phone       TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        body        TEXT,
        image_url   TEXT,
        caption     TEXT,
        status      TEXT    NOT NULL DEFAULT 'queued',
        whatsapp_id TEXT,
        error       TEXT,
        queued_at   INTEGER NOT NULL,
        sent_at     INTEGER,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_status  ON messages(status);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
    `,
  },
  {
    version: 2,
    description: 'Add direction column (outbound/inbound)',
    up: `
      ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound';
      CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
    `,
  },
  {
    version: 3,
    description: 'Create contacts table for inbound tracking',
    up: `
      CREATE TABLE IF NOT EXISTS contacts (
        jid           TEXT    PRIMARY KEY,
        message_count INTEGER NOT NULL DEFAULT 0,
        first_seen    INTEGER NOT NULL,
        last_seen     INTEGER NOT NULL
      );
    `,
  },
  {
    version: 4,
    description: 'Delete status broadcast messages',
    up: `DELETE FROM messages WHERE phone LIKE '%@broadcast';`,
  },
];

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT    NOT NULL,
      applied_at  INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[])
      .map((r) => r.version),
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec(m.up);
    db.prepare('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)')
      .run(m.version, m.description, Date.now());
    console.log(`[DB] Migration ${m.version} applied: ${m.description}`);
  }
}

export function initDb(): void {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'whatsbridge.db');

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateId(): string {
  return 'wb_' + crypto.randomUUID().replace(/-/g, '');
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createMessage(data: {
  phone: string;
  type: MessageType;
  body?: string;
  imageUrl?: string;
  caption?: string;
}): Message {
  const id  = generateId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, phone, type, body, image_url, caption, status, queued_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(id, data.phone, data.type, data.body ?? null, data.imageUrl ?? null, data.caption ?? null, now, now);
  return getMessage(id)!;
}

export function updateMessage(
  id: string,
  status: MessageStatus,
  whatsappId?: string,
  error?: string,
): void {
  const sentAt = status === 'sent' ? Date.now() : null;
  db.prepare(
    `UPDATE messages SET status = ?, whatsapp_id = ?, error = ?, sent_at = ? WHERE id = ?`,
  ).run(status, whatsappId ?? null, error ?? null, sentAt, id);
}

export function getMessage(id: string): Message | null {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toMessage(row) : null;
}

export function listMessages(opts: ListOptions = {}): { messages: Message[]; total: number } {
  const { limit = 50, offset = 0, status, phone } = opts;
  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (phone)  { conditions.push('phone = ?');  params.push(phone);  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = params as any[];
  const total = (db.prepare(`SELECT COUNT(*) as n FROM messages ${where}`).get(...p) as { n: number }).n;
  const messages = (db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...p, limit, offset) as Record<string, unknown>[]).map(toMessage);

  return { messages, total };
}

export function createReceivedMessage(data: { phone: string; body: string }): void {
  const id  = generateId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, phone, type, body, status, direction, queued_at, created_at)
     VALUES (?, ?, 'text', ?, 'sent', 'inbound', ?, ?)`,
  ).run(id, data.phone, data.body || null, now, now);
}

export function getStats(): Stats {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN direction='outbound' AND status='sent'   THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN direction='outbound' AND status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN direction='outbound' AND status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN direction='inbound'                      THEN 1 ELSE 0 END) AS received
    FROM messages
  `).get() as { sent: number; queued: number; failed: number; received: number };
  return {
    sent:     Number(row.sent)     || 0,
    queued:   Number(row.queued)   || 0,
    failed:   Number(row.failed)   || 0,
    received: Number(row.received) || 0,
  };
}

export function getPendingMessages(): Message[] {
  return (db.prepare(
    `SELECT * FROM messages WHERE status IN ('queued','sending') ORDER BY queued_at ASC`,
  ).all() as Record<string, unknown>[]).map(toMessage);
}

function toMessage(row: Record<string, unknown>): Message {
  return {
    id:         row['id'] as string,
    phone:      row['phone'] as string,
    type:       row['type'] as MessageType,
    body:       row['body'] as string | null,
    imageUrl:   row['image_url'] as string | null,
    caption:    row['caption'] as string | null,
    status:     row['status'] as MessageStatus,
    whatsappId: row['whatsapp_id'] as string | null,
    error:      row['error'] as string | null,
    direction:  (row['direction'] as MessageDirection) ?? 'outbound',
    queuedAt:   row['queued_at'] as number,
    sentAt:     row['sent_at'] as number | null,
    createdAt:  row['created_at'] as number,
  };
}
