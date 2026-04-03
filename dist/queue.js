"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNow = sendNow;
exports.sendQueued = sendQueued;
exports.recoverPending = recoverPending;
exports.onConnected = onConnected;
exports.getQueueLength = getQueueLength;
exports.getNextSendDelay = getNextSendDelay;
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
const db_1 = require("./db");
const whatsapp_1 = require("./whatsapp");
const logger_1 = require("./logger");
const RATE_LIMIT_MS = 5000; // minimum gap between sends
let lastSendTime = 0;
let processing = false;
const queue = [];
const callbacks = new Map();
// ── Public API ────────────────────────────────────────────────────────────────
/** Queue and wait – used when allowQueuing is false (inline request). */
function sendNow(data) {
    const msg = (0, db_1.createMessage)(data);
    return new Promise((resolve, reject) => {
        callbacks.set(msg.id, { resolve, reject });
        queue.unshift(msg); // priority: front of queue
        kick();
    });
}
/** Queue and forget – returns internal message immediately. */
function sendQueued(data) {
    const msg = (0, db_1.createMessage)(data);
    queue.push(msg);
    kick();
    return msg;
}
/** Re-queue messages that were pending when the process last stopped. */
function recoverPending() {
    const pending = (0, db_1.getPendingMessages)();
    if (pending.length === 0)
        return;
    (0, logger_1.log)('QUEUE', `Recovering ${pending.length} pending message(s)`);
    // Reset 'sending' back to queued (they never finished)
    pending.forEach(msg => {
        if (msg.status === 'sending')
            (0, db_1.updateMessage)(msg.id, 'queued');
        queue.push(msg);
    });
    kick();
}
/** Called when WhatsApp reconnects – resume processing if queue is non-empty. */
function onConnected() {
    kick();
}
function getQueueLength() {
    return queue.length;
}
function getNextSendDelay() {
    const elapsed = Date.now() - lastSendTime;
    return Math.max(0, RATE_LIMIT_MS - elapsed);
}
// ── Processor ─────────────────────────────────────────────────────────────────
function kick() {
    if (!processing)
        void process();
}
async function process() {
    processing = true;
    while (queue.length > 0) {
        if ((0, whatsapp_1.getStatus)().status !== 'connected') {
            (0, logger_1.log)('QUEUE', 'Not connected — pausing queue');
            break;
        }
        // Rate limit
        const delay = getNextSendDelay();
        if (delay > 0)
            await sleep(delay);
        // Re-check connection after the wait
        if ((0, whatsapp_1.getStatus)().status !== 'connected') {
            (0, logger_1.log)('QUEUE', 'Lost connection during rate-limit wait — pausing queue');
            break;
        }
        const msg = queue.shift();
        (0, db_1.updateMessage)(msg.id, 'sending');
        try {
            let waId;
            if (msg.type === 'text') {
                waId = await (0, whatsapp_1.sendText)(msg.phone, msg.body);
            }
            else {
                waId = await (0, whatsapp_1.sendImage)(msg.phone, msg.imageUrl, msg.caption ?? '');
            }
            lastSendTime = Date.now();
            (0, db_1.updateMessage)(msg.id, 'sent', waId);
            (0, logger_1.log)('MSG_OUT', `OK ${msg.phone} | internal:${msg.id} | wa:${waId}`);
            // Resolve inline waiter if any
            callbacks.get(msg.id)?.resolve({ id: msg.id, whatsappId: waId });
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            (0, db_1.updateMessage)(msg.id, 'failed', undefined, error);
            (0, logger_1.log)('MSG_OUT', `FAIL ${msg.phone} | internal:${msg.id} | ${error}`);
            // Reject inline waiter if any
            callbacks.get(msg.id)?.reject(err instanceof Error ? err : new Error(error));
        }
        finally {
            callbacks.delete(msg.id);
        }
    }
    processing = false;
}
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
