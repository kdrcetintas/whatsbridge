import https from 'https';
import fs    from 'fs';
import path  from 'path';
import os    from 'os';
import { spawn } from 'child_process';

const REPO = 'kdrcetintas/whatsbridge';

// ── Version helpers ───────────────────────────────────────────────────────────

export function currentVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../package.json').version as string;
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] ?? 0;
    const b = l[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

// ── Asset name ────────────────────────────────────────────────────────────────

function assetName(version: string): string {
  const platform =
    process.platform === 'darwin' ? 'macos' :
    process.platform === 'win32'  ? 'win'   : process.platform;
  const arch = process.arch;
  const ext  = process.platform === 'win32' ? '.exe' : '';
  return `whatsbridge-${version}-${platform}-${arch}${ext}`;
}

// ── GitHub API ────────────────────────────────────────────────────────────────

interface GithubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function fetchJson(url: string): Promise<GithubRelease> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
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
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON from GitHub')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// ── Download ──────────────────────────────────────────────────────────────────

function downloadFile(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string) => {
      https.get(u, { headers: { 'User-Agent': `whatsbridge/${currentVersion()}` } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        const total   = parseInt(res.headers['content-length'] ?? '0', 10);
        let received  = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total && onProgress) onProgress(Math.round(received / total * 100));
        });
        res.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
        res.on('error',  reject);
      }).on('error', reject);
    };
    doGet(url);
  });
}

// ── Replace binary ────────────────────────────────────────────────────────────

function replaceBinary(newFile: string): void {
  const current = process.execPath;

  if (process.platform === 'win32') {
    // Can't delete a running exe, but can rename it.
    // Move current → .old, then move new → current.
    const oldFile = current + '.old';
    try { fs.unlinkSync(oldFile); } catch { /* ignore */ }
    fs.renameSync(current, oldFile);
    fs.renameSync(newFile, current);
    // Schedule deletion of .old on next Windows start via a temp bat
    const bat = path.join(os.tmpdir(), 'whatsbridge-cleanup.bat');
    fs.writeFileSync(bat,
      `@echo off\n:loop\ndel "${oldFile}" 2>nul\nif exist "${oldFile}" (timeout /t 2 >nul & goto loop)\ndel "%~f0"\n`
    );
    try { spawn('cmd.exe', ['/c', 'start', '', '/min', bat], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
  } else {
    fs.renameSync(newFile, current);
    fs.chmodSync(current, 0o755);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  downloadUrl?: string;
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const latest  = release.tag_name;
  const current = currentVersion();
  const has     = isNewer(latest, current);

  let downloadUrl: string | undefined;
  if (has) {
    const name  = assetName(latest);
    const asset = release.assets.find((a) => a.name === name);
    downloadUrl = asset?.browser_download_url;
  }

  return { hasUpdate: has, latestVersion: latest, currentVersion: current, downloadUrl };
}

export async function performUpdate(onProgress?: (pct: number) => void): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(process as any).pkg) {
    throw new Error('Self-update is only supported when running as a compiled binary.');
  }

  const info = await checkUpdate();
  if (!info.hasUpdate) return info.latestVersion;
  if (!info.downloadUrl) {
    throw new Error(
      `No binary found for ${process.platform}/${process.arch} in release ${info.latestVersion}.\n` +
      `Download manually from https://github.com/${REPO}/releases`
    );
  }

  const tmpFile = path.join(os.tmpdir(), path.basename(info.downloadUrl));
  try {
    await downloadFile(info.downloadUrl, tmpFile, onProgress);
    replaceBinary(tmpFile);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* already moved */ }
  }

  return info.latestVersion;
}

/** Silent background check — logs a notice if a new version is available. */
export function checkUpdateBackground(log: (type: string, msg: string) => void): void {
  checkUpdate()
    .then((info) => {
      if (info.hasUpdate) {
        log('UPDATE', `New version available: ${info.latestVersion} (current: v${info.currentVersion}). Run "whatsbridge update" to upgrade.`);
      }
    })
    .catch(() => { /* ignore — no internet, rate limit, etc. */ });
}
