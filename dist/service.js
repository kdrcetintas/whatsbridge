"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installService = installService;
exports.uninstallService = uninstallService;
exports.serviceInfo = serviceInfo;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
// Windows service name: "WhatsApp API - myinstance"
// Linux systemd unit:   whatsapp-api-myinstance.service
function serviceName(config) {
    return `WhatsBridge - ${config.instanceName}`;
}
function systemdUnitName(config) {
    return `whatsapp-api-${config.instanceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.service`;
}
// ── Platform guard ──────────────────────────────────────────────────────────
function assertAdmin() {
    if (process.platform === 'win32') {
        try {
            (0, child_process_1.execSync)('net session', { stdio: 'ignore' });
        }
        catch {
            throw new Error('Administrator privileges required.\n' +
                '  Right-click the terminal → "Run as administrator" and try again.');
        }
    }
    else {
        if (process.getuid && process.getuid() !== 0) {
            throw new Error('Root privileges required. Run with sudo.');
        }
    }
}
// ── Windows (Task Scheduler) ──────────────────────────────────────────────────
// sc.exe requires the binary to implement the Windows Service Control protocol
// (SERVICE_RUNNING status etc.) which a regular Node/pkg process does not.
// Task Scheduler has no such requirement and works with any executable.
function runPs(script) {
    const tmp = path_1.default.join(require('os').tmpdir(), `wb-${Date.now()}.ps1`);
    fs_1.default.writeFileSync(tmp, script, 'utf-8');
    try {
        (0, child_process_1.execSync)(`powershell -ExecutionPolicy Bypass -NonInteractive -File "${tmp}"`, { stdio: 'pipe' });
    }
    catch (e) {
        const msg = e.stderr?.toString() ?? String(e);
        throw new Error(msg.trim());
    }
    finally {
        try {
            fs_1.default.unlinkSync(tmp);
        }
        catch { /* ignore */ }
    }
}
function installWindows(config) {
    const name = serviceName(config).replace(/'/g, "''");
    const exe = process.execPath.replace(/'/g, "''");
    const cwd = process.cwd().replace(/'/g, "''");
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
function uninstallWindows(config) {
    const name = serviceName(config).replace(/'/g, "''");
    runPs(`
Stop-ScheduledTask -TaskName '${name}' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName '${name}' -Confirm:$false
`);
    return Promise.resolve();
}
// ── Linux (systemd) ──────────────────────────────────────────────────────────
function installLinux(config) {
    const unitName = systemdUnitName(config);
    const unitPath = `/etc/systemd/system/${unitName}`;
    const cwd = process.cwd();
    // When running as a pkg binary, process.execPath is the binary itself.
    // When running via node, use `node dist/cli.js`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isPkg = !!process.pkg;
    const execStart = isPkg
        ? `${process.execPath} start --cwd ${cwd}`
        : `${process.execPath} ${path_1.default.join(__dirname, 'cli.js')} start`;
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
    fs_1.default.writeFileSync(unitPath, unit, 'utf-8');
    (0, child_process_1.execSync)('systemctl daemon-reload', { stdio: 'inherit' });
    (0, child_process_1.execSync)(`systemctl enable ${unitName}`, { stdio: 'inherit' });
    (0, child_process_1.execSync)(`systemctl start ${unitName}`, { stdio: 'inherit' });
}
function uninstallLinux(config) {
    const unitName = systemdUnitName(config);
    const unitPath = `/etc/systemd/system/${unitName}`;
    try {
        (0, child_process_1.execSync)(`systemctl stop ${unitName}`, { stdio: 'ignore' });
    }
    catch { /* already stopped */ }
    try {
        (0, child_process_1.execSync)(`systemctl disable ${unitName}`, { stdio: 'ignore' });
    }
    catch { /* already disabled */ }
    if (fs_1.default.existsSync(unitPath))
        fs_1.default.unlinkSync(unitPath);
    (0, child_process_1.execSync)('systemctl daemon-reload', { stdio: 'ignore' });
}
// ── Public API ───────────────────────────────────────────────────────────────
async function installService(config) {
    assertAdmin();
    if (process.platform === 'win32') {
        await installWindows(config);
    }
    else if (process.platform === 'linux') {
        installLinux(config);
    }
    else {
        throw new Error('Service installation is supported on Windows and Linux only.');
    }
}
async function uninstallService(config) {
    assertAdmin();
    if (process.platform === 'win32') {
        await uninstallWindows(config);
    }
    else if (process.platform === 'linux') {
        uninstallLinux(config);
    }
    else {
        throw new Error('Service management is supported on Windows and Linux only.');
    }
}
function serviceInfo(config) {
    return {
        name: process.platform === 'win32'
            ? serviceName(config)
            : systemdUnitName(config),
        platform: process.platform,
    };
}
