"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatus = getStatus;
exports.getQRCode = getQRCode;
exports.getAccountInfo = getAccountInfo;
exports.connect = connect;
exports.sendText = sendText;
exports.sendImage = sendImage;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const pino_1 = __importDefault(require("pino"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("./logger");
const config_1 = require("./config");
const queue_1 = require("./queue");
const db_1 = require("./db");
let sock = null;
let connectionStatus = 'disconnected';
let qrCode = null;
let accountInfo = null;
let reconnectAttempts = 0;
let isIntentionalClose = false;
function getStatus() {
    return { status: connectionStatus, hasQR: !!qrCode };
}
function getQRCode() {
    return qrCode;
}
function getAccountInfo() {
    return accountInfo;
}
async function connect() {
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    (0, logger_1.log)('INFO', `WA version: ${version.join('.')}`);
    const waLogger = (0, pino_1.default)({ level: 'silent' });
    const authDir = path_1.default.join((0, config_1.getDataDir)(), 'auth_info');
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(authDir);
    if (sock) {
        isIntentionalClose = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sock.ev.removeAllListeners();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sock.end(undefined);
        sock = null;
        isIntentionalClose = false;
    }
    connectionStatus = 'connecting';
    sock = (0, baileys_1.default)({
        version,
        auth: {
            creds: state.creds,
            keys: (0, baileys_1.makeCacheableSignalKeyStore)(state.keys, waLogger),
        },
        logger: waLogger,
        markOnlineOnConnect: false,
    });
    const currentSock = sock;
    currentSock.ev.on('connection.update', (update) => {
        if (currentSock !== sock || isIntentionalClose)
            return;
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCode = qr;
            (0, logger_1.log)('QR', 'QR code generated, waiting for scan');
        }
        if (connection === 'close') {
            connectionStatus = 'disconnected';
            qrCode = null;
            accountInfo = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            (0, logger_1.log)('DISCONNECT', `Status code: ${statusCode}`);
            if (statusCode === baileys_1.DisconnectReason.loggedOut) {
                (0, logger_1.log)('DISCONNECT', 'Logged out. Delete auth_info folder and restart.');
                return;
            }
            if (statusCode === baileys_1.DisconnectReason.connectionReplaced) {
                (0, logger_1.log)('DISCONNECT', 'Connection replaced by another session.');
                return;
            }
            if (reconnectAttempts < 5) {
                reconnectAttempts++;
                const delay = Math.min(reconnectAttempts * 3000, 15000);
                (0, logger_1.log)('RECONNECT', `Attempt ${reconnectAttempts}/5 in ${delay / 1000}s`);
                setTimeout(() => connect(), delay);
            }
            else {
                (0, logger_1.log)('RECONNECT', 'Max attempts reached. Restart manually.');
            }
        }
        else if (connection === 'open') {
            connectionStatus = 'connected';
            qrCode = null;
            reconnectAttempts = 0;
            (0, logger_1.log)('CONNECTED', 'WhatsApp connection established');
            (async () => {
                if (!currentSock.user)
                    return;
                const jid = currentSock.user.id;
                const phone = jid.split(':')[0].split('@')[0];
                const name = currentSock.user.name || phone;
                let profilePicUrl = null;
                try {
                    profilePicUrl = await currentSock.profilePictureUrl(jid, 'image') ?? null;
                }
                catch { /* no profile picture set */ }
                accountInfo = { jid, name, phone, profilePicUrl };
                (0, logger_1.log)('INFO', `Account: ${name} (+${phone})`);
            })();
            (0, queue_1.onConnected)();
        }
    });
    currentSock.ev.on('creds.update', saveCreds);
    currentSock.ev.on('messages.upsert', ({ messages }) => {
        for (const msg of messages) {
            if (!msg.key.fromMe && msg.message) {
                const sender = msg.key.remoteJid ?? '';
                const text = msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    '';
                (0, logger_1.log)('MSG_IN', `${sender}: ${text}`);
                try {
                    (0, db_1.createReceivedMessage)({ phone: sender, body: text });
                }
                catch { /* db may not be ready yet */ }
            }
        }
    });
}
async function sendText(phone, message) {
    if (!sock)
        throw new Error('Not connected');
    const results = await sock.onWhatsApp(phone);
    const exists = results?.[0];
    if (!exists?.exists)
        throw new Error('Number not on WhatsApp');
    const result = await sock.sendMessage(exists.jid, { text: message });
    return result.key.id;
}
async function sendImage(phone, imageUrl, caption) {
    if (!sock)
        throw new Error('Not connected');
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    const result = await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption,
    });
    return result.key.id;
}
