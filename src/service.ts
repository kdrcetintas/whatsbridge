import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { Config } from './config';

// Windows service name: "WhatsApp API - myinstance"
// Linux systemd unit:   whatsapp-api-myinstance.service

function serviceName(config: Config): string {
  return `WhatsBridge - ${config.instanceName}`;
}

function systemdUnitName(config: Config): string {
  return `whatsapp-api-${config.instanceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.service`;
}

// ── Platform guard ──────────────────────────────────────────────────────────

function assertAdmin(): void {
  if (process.platform === 'win32') {
    try {
      execSync('net session', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'Administrator privileges required.\n' +
        '  Right-click the terminal → "Run as administrator" and try again.'
      );
    }
  } else {
    if (process.getuid && process.getuid() !== 0) {
      throw new Error('Root privileges required. Run with sudo.');
    }
  }
}

// ── Windows (sc.exe) ─────────────────────────────────────────────────────────
// node-windows is incompatible with pkg binaries (tries to write into the
// read-only snapshot). We use sc.exe directly instead.

function installWindows(config: Config): Promise<void> {
  const name    = serviceName(config);
  const binExe  = process.execPath;
  const cwd     = process.cwd();
  // binPath passed to sc must include the --cwd flag so the service knows
  // which instance directory to use when SCM starts it.
  const binPath = `"${binExe}" start --cwd "${cwd}"`;

  try {
    execSync(`sc.exe create "${name}" binPath= ${JSON.stringify(binPath)} start= auto DisplayName= "${name}"`, { stdio: 'pipe' });
  } catch (e: unknown) {
    const msg = (e as { stderr?: Buffer }).stderr?.toString() ?? String(e);
    if (msg.includes('1073')) throw new Error('Service is already installed.');
    throw new Error(`sc.exe create failed: ${msg.trim()}`);
  }

  try {
    execSync(`sc.exe description "${name}" "WhatsBridge — ${config.instanceName} (port ${config.port})"`, { stdio: 'ignore' });
    execSync(`sc.exe failure "${name}" reset= 60 actions= restart/5000/restart/10000/restart/30000`, { stdio: 'ignore' });
    execSync(`sc.exe start "${name}"`, { stdio: 'pipe' });
  } catch { /* non-fatal */ }

  return Promise.resolve();
}

function uninstallWindows(config: Config): Promise<void> {
  const name = serviceName(config);
  try { execSync(`sc.exe stop "${name}"`, { stdio: 'ignore' }); } catch { /* already stopped */ }
  try {
    execSync(`sc.exe delete "${name}"`, { stdio: 'pipe' });
  } catch (e: unknown) {
    const msg = (e as { stderr?: Buffer }).stderr?.toString() ?? String(e);
    throw new Error(`sc.exe delete failed: ${msg.trim()}`);
  }
  return Promise.resolve();
}

// ── Linux (systemd) ──────────────────────────────────────────────────────────

function installLinux(config: Config): void {
  const unitName = systemdUnitName(config);
  const unitPath = `/etc/systemd/system/${unitName}`;
  const cwd      = process.cwd();

  // When running as a pkg binary, process.execPath is the binary itself.
  // When running via node, use `node dist/cli.js`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isPkg = !!(process as any).pkg;
  const execStart = isPkg
    ? `${process.execPath} start --cwd ${cwd}`
    : `${process.execPath} ${path.join(__dirname, 'cli.js')} start`;

  const unit = [
    '[Unit]',
    `Description=WhatsBridge - ${config.instanceName}`,
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${cwd}`,
    `ExecStart=${execStart}`,
    'Restart=on-failure',
    'RestartSec=5',
    'StandardOutput=journal',
    'StandardError=journal',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');

  fs.writeFileSync(unitPath, unit, 'utf-8');
  execSync('systemctl daemon-reload', { stdio: 'inherit' });
  execSync(`systemctl enable ${unitName}`, { stdio: 'inherit' });
  execSync(`systemctl start ${unitName}`, { stdio: 'inherit' });
}

function uninstallLinux(config: Config): void {
  const unitName = systemdUnitName(config);
  const unitPath = `/etc/systemd/system/${unitName}`;

  try { execSync(`systemctl stop ${unitName}`, { stdio: 'ignore' }); } catch { /* already stopped */ }
  try { execSync(`systemctl disable ${unitName}`, { stdio: 'ignore' }); } catch { /* already disabled */ }
  if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
  execSync('systemctl daemon-reload', { stdio: 'ignore' });
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function installService(config: Config): Promise<void> {
  assertAdmin();
  if (process.platform === 'win32') {
    await installWindows(config);
  } else if (process.platform === 'linux') {
    installLinux(config);
  } else {
    throw new Error('Service installation is supported on Windows and Linux only.');
  }
}

export async function uninstallService(config: Config): Promise<void> {
  assertAdmin();
  if (process.platform === 'win32') {
    await uninstallWindows(config);
  } else if (process.platform === 'linux') {
    uninstallLinux(config);
  } else {
    throw new Error('Service management is supported on Windows and Linux only.');
  }
}

export function serviceInfo(config: Config): { name: string; platform: string } {
  return {
    name: process.platform === 'win32'
      ? serviceName(config)
      : systemdUnitName(config),
    platform: process.platform,
  };
}
