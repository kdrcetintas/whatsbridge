/**
 * Message queue with rate limiting.
 *
 * Two send modes:
 *   sendNow()    – adds to front of queue, returns Promise<result> (inline wait)
 *   sendQueued() – adds to back of queue, returns Message immediately
 *
 * Both paths share the same processor and rate limiter so they never
 * conflict with each other.
 */
import { Message, MessageType, createMessage, updateMessage, getPendingMessages } from './db';
import { sendText, sendImage, getStatus } from './whatsapp';
import { log } from './logger';

const RATE_LIMIT_MS = 5000; // minimum gap between sends

let lastSendTime   = 0;
let processing     = false;
const queue: Message[] = [];

interface Callback {
  resolve: (result: { id: string; whatsappId: string }) => void;
  reject:  (err: Error) => void;
}
const callbacks = new Map<string, Callback>();

// ── Public API ────────────────────────────────────────────────────────────────

/** Queue and wait – used when allowQueuing is false (inline request). */
export function sendNow(data: SendData): Promise<{ id: string; whatsappId: string }> {
  const msg = createMessage(data);
  return new Promise((resolve, reject) => {
    callbacks.set(msg.id, { resolve, reject });
    queue.unshift(msg); // priority: front of queue
    kick();
  });
}

/** Queue and forget – returns internal message immediately. */
export function sendQueued(data: SendData): Message {
  const msg = createMessage(data);
  queue.push(msg);
  kick();
  return msg;
}

/** Re-queue messages that were pending when the process last stopped. */
export function recoverPending(): void {
  const pending = getPendingMessages();
  if (pending.length === 0) return;
  log('QUEUE', `Recovering ${pending.length} pending message(s)`);
  // Reset 'sending' back to queued (they never finished)
  pending.forEach(msg => {
    if (msg.status === 'sending') updateMessage(msg.id, 'queued');
    queue.push(msg);
  });
  kick();
}

/** Called when WhatsApp reconnects – resume processing if queue is non-empty. */
export function onConnected(): void {
  kick();
}

export function getQueueLength(): number {
  return queue.length;
}

export function getNextSendDelay(): number {
  const elapsed = Date.now() - lastSendTime;
  return Math.max(0, RATE_LIMIT_MS - elapsed);
}

// ── Processor ─────────────────────────────────────────────────────────────────

function kick(): void {
  if (!processing) void process();
}

async function process(): Promise<void> {
  processing = true;

  while (queue.length > 0) {
    if (getStatus().status !== 'connected') {
      log('QUEUE', 'Not connected — pausing queue');
      break;
    }

    // Rate limit
    const delay = getNextSendDelay();
    if (delay > 0) await sleep(delay);

    // Re-check connection after the wait
    if (getStatus().status !== 'connected') {
      log('QUEUE', 'Lost connection during rate-limit wait — pausing queue');
      break;
    }

    const msg = queue.shift()!;
    updateMessage(msg.id, 'sending');

    try {
      let waId: string;
      if (msg.type === 'text') {
        waId = await sendText(msg.phone, msg.body!);
      } else {
        waId = await sendImage(msg.phone, msg.imageUrl!, msg.caption ?? '');
      }

      lastSendTime = Date.now();
      updateMessage(msg.id, 'sent', waId);
      log('MSG_OUT', `OK ${msg.phone} | internal:${msg.id} | wa:${waId}`);

      // Resolve inline waiter if any
      callbacks.get(msg.id)?.resolve({ id: msg.id, whatsappId: waId });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      updateMessage(msg.id, 'failed', undefined, error);
      log('MSG_OUT', `FAIL ${msg.phone} | internal:${msg.id} | ${error}`);

      // Reject inline waiter if any
      callbacks.get(msg.id)?.reject(err instanceof Error ? err : new Error(error));
    } finally {
      callbacks.delete(msg.id);
    }
  }

  processing = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SendData {
  phone: string;
  type: MessageType;
  body?: string;
  imageUrl?: string;
  caption?: string;
}
