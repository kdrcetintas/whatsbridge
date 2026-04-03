"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const qrcode_1 = __importDefault(require("qrcode"));
const logger_1 = require("./logger");
const auth_1 = require("./auth");
const whatsapp_1 = require("./whatsapp");
const db_1 = require("./db");
const queue_1 = require("./queue");
const updater_1 = require("./updater");
const PUBLIC_DIR = path_1.default.join(__dirname, '..', 'public');
function createApp(config) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use((0, express_session_1.default)({
        secret: config.apiKey,
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
    }));
    // ── Public ────────────────────────────────────────────────────────────────
    app.get('/login', (req, res) => {
        if (req.session?.authenticated)
            return res.redirect('/');
        res.sendFile(path_1.default.join(PUBLIC_DIR, 'login.html'));
    });
    app.post('/auth/login', async (req, res) => {
        const { username, password } = req.body;
        if (username !== config.username) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const valid = await (0, auth_1.verifyPassword)(password, config.passwordHash);
        if (!valid) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        req.session.authenticated = true;
        req.session.username = username;
        res.json({ success: true });
    });
    app.post('/auth/logout', (req, res) => {
        req.session.destroy(() => { });
        res.json({ success: true });
    });
    // ── Web UI (session protected) ────────────────────────────────────────────
    app.get('/', auth_1.requireSession, (_req, res) => res.sendFile(path_1.default.join(PUBLIC_DIR, 'status.html')));
    app.get('/send', auth_1.requireSession, (_req, res) => res.sendFile(path_1.default.join(PUBLIC_DIR, 'send.html')));
    app.get('/logs', auth_1.requireSession, (_req, res) => res.sendFile(path_1.default.join(PUBLIC_DIR, 'logs.html')));
    app.get('/docs', auth_1.requireSession, (_req, res) => res.sendFile(path_1.default.join(PUBLIC_DIR, 'docs.html')));
    app.get('/settings', auth_1.requireSession, (req, res) => {
        res.json({
            instanceName: config.instanceName,
            apiKey: config.apiKey,
            port: config.port,
            username: req.session.username,
        });
    });
    app.get('/status', auth_1.requireSession, (_req, res) => {
        res.json((0, whatsapp_1.getStatus)());
    });
    app.get('/account', auth_1.requireSession, (_req, res) => {
        res.json((0, whatsapp_1.getAccountInfo)());
    });
    app.get('/qr', auth_1.requireSession, async (_req, res) => {
        const qr = (0, whatsapp_1.getQRCode)();
        if (!qr) {
            res.status(404).json({ error: 'No QR code available' });
            return;
        }
        const dataUrl = await qrcode_1.default.toDataURL(qr);
        res.json({ qr: dataUrl });
    });
    app.get('/stats', auth_1.requireSession, (_req, res) => {
        res.json((0, db_1.getStats)());
    });
    app.get('/version', auth_1.requireSession, (_req, res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res.json({ version: (0, updater_1.currentVersion)(), isPkg: !!process.pkg });
    });
    app.get('/update/check', auth_1.requireSession, async (_req, res) => {
        try {
            const info = await (0, updater_1.checkUpdate)();
            res.json(info);
        }
        catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post('/update/apply', auth_1.requireSession, async (_req, res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!process.pkg) {
            res.status(400).json({ error: 'Self-update is only supported when running as a compiled binary.' });
            return;
        }
        try {
            const newVersion = await (0, updater_1.performUpdate)();
            res.json({ success: true, version: newVersion });
            // Give the response time to flush, then restart so the service manager picks up the new binary
            setTimeout(() => process.exit(0), 800);
        }
        catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/logs/stream', auth_1.requireSession, (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        // Replay recent logs immediately
        for (const entry of (0, logger_1.getRecentLogs)()) {
            res.write(`data: ${JSON.stringify(entry)}\n\n`);
        }
        const onLog = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
        logger_1.logBus.on('log', onLog);
        req.on('close', () => logger_1.logBus.off('log', onLog));
    });
    // ── REST API (API key protected) ──────────────────────────────────────────
    const apiAuth = (0, auth_1.requireApiKey)(config.apiKey);
    app.get('/api/status', apiAuth, (_req, res) => {
        res.json({
            ...(0, whatsapp_1.getStatus)(),
            queue: { length: (0, queue_1.getQueueLength)(), nextSendDelay: (0, queue_1.getNextSendDelay)() },
        });
    });
    app.post('/api/send', apiAuth, async (req, res) => {
        const { phone, message, allowQueuing = false } = req.body;
        if (!phone || !message) {
            res.status(400).json({ error: 'phone and message are required' });
            return;
        }
        if ((0, whatsapp_1.getStatus)().status !== 'connected') {
            res.status(503).json({ error: 'WhatsApp is not connected' });
            return;
        }
        if (allowQueuing) {
            const msg = (0, queue_1.sendQueued)({ phone, type: 'text', body: message });
            res.json({ success: true, id: msg.id, status: 'queued' });
            return;
        }
        try {
            const { id, whatsappId } = await (0, queue_1.sendNow)({ phone, type: 'text', body: message });
            res.json({ success: true, id, whatsappId, status: 'sent' });
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            res.status(errMsg === 'Number not on WhatsApp' ? 404 : 500).json({ error: errMsg });
        }
    });
    app.post('/api/send-image', apiAuth, async (req, res) => {
        const { phone, imageUrl, caption, allowQueuing = false } = req.body;
        if (!phone || !imageUrl) {
            res.status(400).json({ error: 'phone and imageUrl are required' });
            return;
        }
        if ((0, whatsapp_1.getStatus)().status !== 'connected') {
            res.status(503).json({ error: 'WhatsApp is not connected' });
            return;
        }
        if (allowQueuing) {
            const msg = (0, queue_1.sendQueued)({ phone, type: 'image', imageUrl, caption });
            res.json({ success: true, id: msg.id, status: 'queued' });
            return;
        }
        try {
            const { id, whatsappId } = await (0, queue_1.sendNow)({ phone, type: 'image', imageUrl, caption });
            res.json({ success: true, id, whatsappId, status: 'sent' });
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            res.status(500).json({ error: errMsg });
        }
    });
    // ── Message history ────────────────────────────────────────────────────────
    app.get('/api/messages', apiAuth, (req, res) => {
        const limit = Math.min(Number(req.query['limit']) || 50, 200);
        const offset = Number(req.query['offset']) || 0;
        const status = req.query['status'];
        const phone = req.query['phone'];
        res.json((0, db_1.listMessages)({ limit, offset, status: status, phone }));
    });
    app.get('/api/stats', apiAuth, (_req, res) => {
        res.json((0, db_1.getStats)());
    });
    app.get('/api/messages/:id', apiAuth, (req, res) => {
        const msg = (0, db_1.getMessage)(String(req.params['id']));
        if (!msg) {
            res.status(404).json({ error: 'Message not found' });
            return;
        }
        res.json(msg);
    });
    // Static files last
    app.use(express_1.default.static(PUBLIC_DIR));
    return app;
}
function startServer(config) {
    const app = createApp(config);
    const server = app.listen(config.port, () => {
        const url = `http://localhost:${config.port}`;
        (0, logger_1.log)('SERVER', `Running on ${url}`);
        (0, db_1.initDb)().then(() => {
            (0, queue_1.recoverPending)();
            (0, whatsapp_1.connect)();
        }).catch((err) => {
            (0, logger_1.log)('ERROR', `Database init failed: ${err.message}`);
            process.exit(1);
        });
        const platform = process.platform;
        const cmd = platform === 'darwin' ? `open "${url}"` :
            platform === 'win32' ? `start "" "${url}"` :
                `xdg-open "${url}"`;
        (0, child_process_1.exec)(cmd, (err) => {
            if (err)
                (0, logger_1.log)('BROWSER', `Could not open browser: ${err.message}`);
        });
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            (0, logger_1.log)('ERROR', `Port ${config.port} is already in use.`);
            process.exit(1);
        }
        throw err;
    });
}
