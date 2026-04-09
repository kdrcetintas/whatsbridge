import express, { Request, Response } from 'express';
import session from 'express-session';
import path from 'path';
import { exec } from 'child_process';
import QRCode from 'qrcode';
import { Config, saveConfig } from './config';
import { log, logBus, getRecentLogs, LogEntry } from './logger';
import { verifyPassword, requireSession, requireApiKey, requireSessionOrApiKey } from './auth';
import { connect, getStatus, getQRCode, getAccountInfo } from './whatsapp';
import { initDb, getMessage, listMessages, getStats } from './db';
import { sendNow, sendQueued, getQueueLength, getNextSendDelay, recoverPending } from './queue';
import { currentVersion, checkUpdate, performUpdate } from './updater';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createApp(config: Config): express.Application {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: config.apiKey,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
    })
  );

  // ── Public ────────────────────────────────────────────────────────────────

  app.get('/login', (req, res) => {
    if (req.session?.authenticated) return res.redirect('/');
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });

  app.post('/auth/login', async (req: Request, res: Response) => {
    const { username, password } = req.body as { username: string; password: string };
    if (username !== config.username) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const valid = await verifyPassword(password, config.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true });
  });

  app.post('/auth/logout', (req: Request, res: Response) => {
    req.session.destroy(() => {});
    res.json({ success: true });
  });

  // ── Web UI (session protected) ────────────────────────────────────────────

  app.get('/',         requireSession, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'status.html')));
  app.get('/send',     requireSession, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'send.html')));
  app.get('/messages', requireSession, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'messages.html')));
  app.get('/logs',     requireSession, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'logs.html')));
  app.get('/docs',     requireSession, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'docs.html')));

  app.get('/settings', requireSession, (req: Request, res: Response) => {
    res.json({
      instanceName: config.instanceName,
      apiKey: config.apiKey,
      port: config.port,
      username: req.session.username,
    });
  });

  app.get('/status', requireSession, (_req, res) => {
    res.json(getStatus());
  });

  app.get('/account', requireSession, (_req, res) => {
    res.json(getAccountInfo());
  });

  app.get('/qr', requireSession, async (_req, res) => {
    const qr = getQRCode();
    if (!qr) { res.status(404).json({ error: 'No QR code available' }); return; }
    const dataUrl = await QRCode.toDataURL(qr);
    res.json({ qr: dataUrl });
  });

  app.get('/stats', requireSession, (_req, res) => {
    try {
      res.json(getStats());
    } catch (err: unknown) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Database unavailable' });
    }
  });

  app.get('/version', requireSession, (_req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.json({ version: currentVersion(), isPkg: !!(process as any).pkg, hasGithubToken: !!config.githubToken });
  });

  app.get('/update/check', requireSession, async (req, res) => {
    const token = (req.headers['x-github-token'] as string | undefined) || config.githubToken;
    if (token && token !== config.githubToken) {
      config.githubToken = token;
      saveConfig(config);
    }
    try {
      const info = await checkUpdate(token);
      res.json(info);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/update/apply', requireSession, async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(process as any).pkg) {
      res.status(400).json({ error: 'Self-update is only supported when running as a compiled binary.' });
      return;
    }
    const token = (req.headers['x-github-token'] as string | undefined) || config.githubToken;
    if (token && token !== config.githubToken) {
      config.githubToken = token;
      saveConfig(config);
    }
    try {
      const newVersion = await performUpdate(undefined, token);
      res.json({ success: true, version: newVersion });
      // Give the response time to flush, then restart so the service manager picks up the new binary
      setTimeout(() => process.exit(0), 800);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/logs/stream', requireSession, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Replay recent logs immediately
    for (const entry of getRecentLogs()) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const onLog = (entry: LogEntry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
    logBus.on('log', onLog);
    req.on('close', () => logBus.off('log', onLog));
  });

  // ── REST API (API key protected) ──────────────────────────────────────────

  const apiAuth = requireApiKey(config.apiKey);
  const sessionOrApi = requireSessionOrApiKey(config.apiKey);

  app.get('/api/status', apiAuth, (_req, res) => {
    res.json({
      ...getStatus(),
      queue: { length: getQueueLength(), nextSendDelay: getNextSendDelay() },
    });
  });

  app.post('/api/send', apiAuth, async (req: Request, res: Response) => {
    const { phone, message, allowQueuing = false } = req.body as {
      phone: string;
      message: string;
      allowQueuing?: boolean;
    };
    if (!phone || !message) {
      res.status(400).json({ error: 'phone and message are required' });
      return;
    }
    if (getStatus().status !== 'connected') {
      res.status(503).json({ error: 'WhatsApp is not connected' });
      return;
    }

    if (allowQueuing) {
      const msg = sendQueued({ phone, type: 'text', body: message });
      res.json({ success: true, id: msg.id, status: 'queued' });
      return;
    }

    try {
      const { id, whatsappId } = await sendNow({ phone, type: 'text', body: message });
      res.json({ success: true, id, whatsappId, status: 'sent' });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(errMsg === 'Number not on WhatsApp' ? 404 : 500).json({ error: errMsg });
    }
  });

  app.post('/api/send-image', apiAuth, async (req: Request, res: Response) => {
    const { phone, imageUrl, caption, allowQueuing = false } = req.body as {
      phone: string;
      imageUrl: string;
      caption?: string;
      allowQueuing?: boolean;
    };
    if (!phone || !imageUrl) {
      res.status(400).json({ error: 'phone and imageUrl are required' });
      return;
    }
    if (getStatus().status !== 'connected') {
      res.status(503).json({ error: 'WhatsApp is not connected' });
      return;
    }

    if (allowQueuing) {
      const msg = sendQueued({ phone, type: 'image', imageUrl, caption });
      res.json({ success: true, id: msg.id, status: 'queued' });
      return;
    }

    try {
      const { id, whatsappId } = await sendNow({ phone, type: 'image', imageUrl, caption });
      res.json({ success: true, id, whatsappId, status: 'sent' });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: errMsg });
    }
  });

  // ── Message history ────────────────────────────────────────────────────────

  app.get('/api/messages', sessionOrApi, (req: Request, res: Response) => {
    try {
      const limit  = Math.min(Number(req.query['limit'])  || 50, 200);
      const offset = Number(req.query['offset']) || 0;
      const status = req.query['status'] as string | undefined;
      const phone  = req.query['phone']  as string | undefined;
      res.json(listMessages({ limit, offset, status: status as any, phone }));
    } catch (err: unknown) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Database unavailable' });
    }
  });

  app.get('/api/stats', apiAuth, (_req, res) => {
    try {
      res.json(getStats());
    } catch (err: unknown) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Database unavailable' });
    }
  });

  app.get('/api/messages/:id', sessionOrApi, (req: Request, res: Response) => {
    try {
      const msg = getMessage(String(req.params['id']));
      if (!msg) { res.status(404).json({ error: 'Message not found' }); return; }
      res.json(msg);
    } catch (err: unknown) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Database unavailable' });
    }
  });

  // Static files last
  app.use(express.static(PUBLIC_DIR));

  return app;
}

export function startServer(config: Config): void {
  const app = createApp(config);

  const server = app.listen(config.port, () => {
    const url = `http://localhost:${config.port}`;
    log('SERVER', `Running on ${url}`);
    try {
      initDb();
      recoverPending();
      connect();
    } catch (err: unknown) {
      log('ERROR', `Database init failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const platform = process.platform;
    const cmd =
      platform === 'darwin' ? `open "${url}"` :
      platform === 'win32'  ? `start "" "${url}"` :
                               `xdg-open "${url}"`;
    exec(cmd, (err) => {
      if (err) log('BROWSER', `Could not open browser: ${err.message}`);
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log('ERROR', `Port ${config.port} is already in use.`);
      process.exit(1);
    }
    throw err;
  });
}
