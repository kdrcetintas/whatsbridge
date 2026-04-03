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
const os_1 = __importDefault(require("os"));
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
// ── Windows (NSSM) ───────────────────────────────────────────────────────────
// sc.exe requires the binary to implement the Windows Service Control protocol.
// NSSM wraps any executable as a proper SCM-compatible service (shows in services.msc).
function extractNssm() {
    const dest = path_1.default.join(os_1.default.tmpdir(), 'whatsbridge-nssm.exe');
    if (fs_1.default.existsSync(dest))
        return dest;
    // When running as pkg binary, __dirname is inside the snapshot.
    // The nssm.exe asset is accessible via path relative to __dirname.
    const src = path_1.default.join(__dirname, '..', 'vendor', 'nssm.exe');
    fs_1.default.copyFileSync(src, dest);
    return dest;
}
function runNssm(args) {
    const nssm = extractNssm();
    try {
        (0, child_process_1.execSync)(`"${nssm}" ${args.map(a => `"${a}"`).join(' ')}`, { stdio: 'pipe' });
    }
    catch (e) {
        const err = e;
        const msg = (err.stderr?.toString() ?? err.stdout?.toString() ?? String(e)).trim();
        throw new Error(msg);
    }
}
function installWindows(config) {
    const name = serviceName(config);
    const exe = process.execPath;
    const cwd = process.cwd();
    runNssm(['install', name, exe, `start --cwd "${cwd}"`]);
    runNssm(['set', name, 'AppDirectory', cwd]);
    runNssm(['set', name, 'Start', 'SERVICE_AUTO_START']);
    runNssm(['set', name, 'AppRestartDelay', '5000']);
    runNssm(['set', name, 'ObjectName', 'LocalSystem']);
    (0, child_process_1.execSync)(`sc start "${name}"`, { stdio: 'pipe' });
}
function uninstallWindows(config) {
    const name = serviceName(config);
    try {
        (0, child_process_1.execSync)(`sc stop "${name}"`, { stdio: 'ignore' });
    }
    catch { /* already stopped */ }
    // NSSM remove with confirmation bypass
    runNssm(['remove', name, 'confirm']);
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
        'Restart=always',
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
        installWindows(config);
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
        uninstallWindows(config);
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
