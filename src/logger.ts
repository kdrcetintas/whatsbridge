import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getDataDir } from './config';

export interface LogEntry {
  time: string;
  type: string;
  msg: string;
}

export const logBus = new EventEmitter();
logBus.setMaxListeners(100);

const recentLogs: LogEntry[] = [];
const MAX_RECENT = 500;

export function log(type: string, msg: string): void {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19);
  const entry: LogEntry = { time, type, msg };

  console.log(`[${time}] [${type}] ${msg}`);

  try {
    const logDir = path.join(getDataDir(), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, `${date}.log`), `[${time}] [${type}] ${msg}\n`);
  } catch { /* ignore */ }

  recentLogs.push(entry);
  if (recentLogs.length > MAX_RECENT) recentLogs.shift();
  logBus.emit('log', entry);
}

export function getRecentLogs(): LogEntry[] {
  return [...recentLogs];
}
