"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentVersion = currentVersion;
exports.checkUpdate = checkUpdate;
exports.performUpdate = performUpdate;
exports.checkUpdateBackground = checkUpdateBackground;
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const REPO = 'kdrcetintas/whatsbridge';
// ── Version helpers ───────────────────────────────────────────────────────────
function currentVersion() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../package.json').version;
}
function parseVersion(v) {
    return v.replace(/^v/, '').split('.').map(Number);
}
function isNewer(remote, local) {
    const r = parseVersion(remote);
    const l = parseVersion(local);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
        const a = r[i] ?? 0;
        const b = l[i] ?? 0;
        if (a > b)
            return true;
        if (a < b)
            return false;
    }
    return false;
}
// ── Asset name ────────────────────────────────────────────────────────────────
function assetName(version) {
    const platform = process.platform === 'darwin' ? 'macos' :
        process.platform === 'win32' ? 'win' : process.platform;
    const arch = process.arch;
    const ext = process.platform === 'win32' ? '.exe' : '';
    return `whatsbridge-${version}-${platform}-${arch}${ext}`;
}
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https_1.default.get(url, {
            headers: { 'User-Agent': `whatsbridge/${currentVersion()}` },
        }, (res) => {
            // Follow redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(fetchJson(res.headers.location));
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`GitHub API returned ${res.statusCode}`));
                return;
            }
            let body = '';
            res.on('data', (chunk) => { body += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch {
                    reject(new Error('Invalid JSON from GitHub'));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
    });
}
// ── Download ──────────────────────────────────────────────────────────────────
function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        const doGet = (u) => {
            https_1.default.get(u, { headers: { 'User-Agent': `whatsbridge/${currentVersion()}` } }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    doGet(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                    return;
                }
                const total = parseInt(res.headers['content-length'] ?? '0', 10);
                let received = 0;
                const out = fs_1.default.createWriteStream(dest);
                res.on('data', (chunk) => {
                    received += chunk.length;
                    if (total && onProgress)
                        onProgress(Math.round(received / total * 100));
                });
                res.pipe(out);
                out.on('finish', resolve);
                out.on('error', reject);
                res.on('error', reject);
            }).on('error', reject);
        };
        doGet(url);
    });
}
// ── Replace binary ────────────────────────────────────────────────────────────
function replaceBinary(newFile) {
    const current = process.execPath;
    if (process.platform === 'win32') {
        // Can't delete a running exe, but can rename it.
        // Move current → .old, then move new → current.
        const oldFile = current + '.old';
        try {
            fs_1.default.unlinkSync(oldFile);
        }
        catch { /* ignore */ }
        fs_1.default.renameSync(current, oldFile);
        fs_1.default.renameSync(newFile, current);
        // Schedule deletion of .old on next Windows start via a temp bat
        const bat = path_1.default.join(os_1.default.tmpdir(), 'whatsbridge-cleanup.bat');
        fs_1.default.writeFileSync(bat, `@echo off\n:loop\ndel "${oldFile}" 2>nul\nif exist "${oldFile}" (timeout /t 2 >nul & goto loop)\ndel "%~f0"\n`);
        try {
            (0, child_process_1.spawn)('cmd.exe', ['/c', 'start', '', '/min', bat], { detached: true, stdio: 'ignore' }).unref();
        }
        catch { /* ignore */ }
    }
    else {
        fs_1.default.renameSync(newFile, current);
        fs_1.default.chmodSync(current, 0o755);
    }
}
async function checkUpdate() {
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const latest = release.tag_name;
    const current = currentVersion();
    const has = isNewer(latest, current);
    let downloadUrl;
    if (has) {
        const name = assetName(latest);
        const asset = release.assets.find((a) => a.name === name);
        downloadUrl = asset?.browser_download_url;
    }
    return { hasUpdate: has, latestVersion: latest, currentVersion: current, downloadUrl };
}
async function performUpdate(onProgress) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!process.pkg) {
        throw new Error('Self-update is only supported when running as a compiled binary.');
    }
    const info = await checkUpdate();
    if (!info.hasUpdate)
        return info.latestVersion;
    if (!info.downloadUrl) {
        throw new Error(`No binary found for ${process.platform}/${process.arch} in release ${info.latestVersion}.\n` +
            `Download manually from https://github.com/${REPO}/releases`);
    }
    const tmpFile = path_1.default.join(os_1.default.tmpdir(), path_1.default.basename(info.downloadUrl));
    try {
        await downloadFile(info.downloadUrl, tmpFile, onProgress);
        replaceBinary(tmpFile);
    }
    finally {
        try {
            fs_1.default.unlinkSync(tmpFile);
        }
        catch { /* already moved */ }
    }
    return info.latestVersion;
}
/** Silent background check — logs a notice if a new version is available. */
function checkUpdateBackground(log) {
    checkUpdate()
        .then((info) => {
        if (info.hasUpdate) {
            log('UPDATE', `New version available: ${info.latestVersion} (current: v${info.currentVersion}). Run "whatsbridge update" to upgrade.`);
        }
    })
        .catch(() => { });
}
