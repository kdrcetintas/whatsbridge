import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import { log } from './logger';
import { getDataDir } from './config';
import { onConnected as queueOnConnected, recoverPending } from './queue';
import { createReceivedMessage } from './db';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface AccountInfo {
  jid: string;
  name: string;
  phone: string;
  profilePicUrl: string | null;
}

let sock: WASocket | null = null;
let connectionStatus: ConnectionStatus = 'disconnected';
let qrCode: string | null = null;
let accountInfo: AccountInfo | null = null;
let reconnectAttempts = 0;
let isIntentionalClose = false;

export function getStatus(): { status: ConnectionStatus; hasQR: boolean } {
  return { status: connectionStatus, hasQR: !!qrCode };
}

export function getQRCode(): string | null {
  return qrCode;
}

export function getAccountInfo(): AccountInfo | null {
  return accountInfo;
}

export async function connect(): Promise<void> {
  const { version } = await fetchLatestBaileysVersion();
  log('INFO', `WA version: ${version.join('.')}`);

  const waLogger = pino({ level: 'silent' });
  const authDir = path.join(getDataDir(), 'auth_info');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  if (sock) {
    isIntentionalClose = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock.ev as any).removeAllListeners();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sock as any).end(undefined);
    sock = null;
    isIntentionalClose = false;
  }

  connectionStatus = 'connecting';

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, waLogger),
    },
    logger: waLogger,
    markOnlineOnConnect: false,
  });

  const currentSock = sock;

  currentSock.ev.on('connection.update', (update) => {
    if (currentSock !== sock || isIntentionalClose) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = qr;
      log('QR', 'QR code generated, waiting for scan');
    }

    if (connection === 'close') {
      connectionStatus = 'disconnected';
      qrCode = null;
      accountInfo = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      log('DISCONNECT', `Status code: ${statusCode}`);

      if (statusCode === DisconnectReason.loggedOut) {
        log('DISCONNECT', 'Logged out. Delete auth_info folder and restart.');
        return;
      }
      if (statusCode === DisconnectReason.connectionReplaced) {
        log('DISCONNECT', 'Connection replaced by another session.');
        return;
      }

      if (reconnectAttempts < 5) {
        reconnectAttempts++;
        const delay = Math.min(reconnectAttempts * 3000, 15000);
        log('RECONNECT', `Attempt ${reconnectAttempts}/5 in ${delay / 1000}s`);
        setTimeout(() => connect(), delay);
      } else {
        log('RECONNECT', 'Max attempts reached. Restart manually.');
      }
    } else if (connection === 'open') {
      connectionStatus = 'connected';
      qrCode = null;
      reconnectAttempts = 0;
      log('CONNECTED', 'WhatsApp connection established');

      (async () => {
        if (!currentSock.user) return;
        const jid = currentSock.user.id;
        const phone = jid.split(':')[0].split('@')[0];
        const name = currentSock.user.name || phone;
        let profilePicUrl: string | null = null;
        try {
          profilePicUrl = await currentSock.profilePictureUrl(jid, 'image') ?? null;
        } catch { /* no profile picture set */ }
        accountInfo = { jid, name, phone, profilePicUrl };
        log('INFO', `Account: ${name} (+${phone})`);
      })();

      queueOnConnected();
    }
  });

  currentSock.ev.on('creds.update', saveCreds);

  currentSock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (!msg.key.fromMe && msg.message) {
        const sender = msg.key.remoteJid ?? '';
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';
        log('MSG_IN', `${sender}: ${text}`);
        try {
          createReceivedMessage({ phone: sender, body: text });
        } catch { /* db may not be ready yet */ }
      }
    }
  });
}

export async function sendText(phone: string, message: string): Promise<string> {
  if (!sock) throw new Error('Not connected');
  const results = await sock.onWhatsApp(phone);
  const exists = results?.[0];
  if (!exists?.exists) throw new Error('Number not on WhatsApp');
  const result = await sock.sendMessage(exists.jid, { text: message });
  return result!.key.id!;
}

export async function sendImage(phone: string, imageUrl: string, caption: string): Promise<string> {
  if (!sock) throw new Error('Not connected');
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  const result = await sock.sendMessage(jid, {
    image: { url: imageUrl },
    caption,
  });
  return result!.key.id!;
}
