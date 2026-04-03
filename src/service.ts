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

// ── Windows (Task Scheduler) ──────────────────────────────────────────────────
// sc.exe requires the binary to implement the Windows Service Control protocol
// (SERVICE_RUNNING status etc.) which a regular Node/pkg process does not.
// Task Scheduler has no such requirement and works with any executable.

function runPs(script: string): void {
  const tmp = path.join(require('os').tmpdir(), `wb-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, script, 'utf-8');
  try {
    execSync(`powershell -ExecutionPolicy Bypass -NonInteractive -File "${tmp}"`, { stdio: 'pipe' });
  } catch (e: unknown) {
    const msg = (e as { stderr?: Buffer }).stderr?.toString() ?? String(e);
    throw new Error(msg.trim());
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function installWindows(config: Config): Promise<void> {
  const name = serviceName(config).replace(/'/g, "''");
  const exe  = process.execPath.replace(/'/g, "''");
  const cwd  = process.cwd().replace(/'/g, "''");

  runPs(`
$action   = New-ScheduledTaskAction -Execute '${exe}' -Argument 'start --cwd "${cwd}"'
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet \`
              -RestartCount 5 \`
              -RestartInterval (New-TimeSpan -Minutes 1) \`
              -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
Register-ScheduledTask -TaskName '${name}' \`
  -Action $action -Trigger $trigger \`
  -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName '${name}'
`);
  return Promise.resolve();
}

function uninstallWindows(config: Config): Promise<void> {
  const name = serviceName(config).replace(/'/g, "''");
  runPs(`
Stop-ScheduledTask -TaskName '${name}' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName '${name}' -Confirm:$false
`);
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
