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
// ── Windows (sc.exe) ─────────────────────────────────────────────────────────
// node-windows is incompatible with pkg binaries (tries to write into the
// read-only snapshot). We use sc.exe directly instead.
function installWindows(config) {
    const name = serviceName(config);
    const binExe = process.execPath;
    const cwd = process.cwd();
    // binPath passed to sc must include the --cwd flag so the service knows
    // which instance directory to use when SCM starts it.
    const binPath = `"${binExe}" start --cwd "${cwd}"`;
    try {
        (0, child_process_1.execSync)(`sc.exe create "${name}" binPath= ${JSON.stringify(binPath)} start= auto DisplayName= "${name}"`, { stdio: 'pipe' });
    }
    catch (e) {
        const msg = e.stderr?.toString() ?? String(e);
        if (msg.includes('1073'))
            throw new Error('Service is already installed.');
        throw new Error(`sc.exe create failed: ${msg.trim()}`);
    }
    try {
        (0, child_process_1.execSync)(`sc.exe description "${name}" "WhatsBridge — ${config.instanceName} (port ${config.port})"`, { stdio: 'ignore' });
        (0, child_process_1.execSync)(`sc.exe failure "${name}" reset= 60 actions= restart/5000/restart/10000/restart/30000`, { stdio: 'ignore' });
        (0, child_process_1.execSync)(`sc.exe start "${name}"`, { stdio: 'pipe' });
    }
    catch { /* non-fatal */ }
    return Promise.resolve();
}
function uninstallWindows(config) {
    const name = serviceName(config);
    try {
        (0, child_process_1.execSync)(`sc.exe stop "${name}"`, { stdio: 'ignore' });
    }
    catch { /* already stopped */ }
    try {
        (0, child_process_1.execSync)(`sc.exe delete "${name}"`, { stdio: 'pipe' });
    }
    catch (e) {
        const msg = e.stderr?.toString() ?? String(e);
        throw new Error(`sc.exe delete failed: ${msg.trim()}`);
    }
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
