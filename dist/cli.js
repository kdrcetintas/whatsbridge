#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const commander_1 = require("commander");
const inquirer_1 = __importDefault(require("inquirer"));
const config_1 = require("./config");
const auth_1 = require("./auth");
const server_1 = require("./server");
const service_1 = require("./service");
const updater_1 = require("./updater");
const program = new commander_1.Command();
program
    .name('whatsbridge')
    .description('WhatsBridge — WhatsApp REST API server with web dashboard')
    .version((0, updater_1.currentVersion)());
// ── init ─────────────────────────────────────────────────────────────────────
program
    .command('init')
    .description('Initialize a new instance in the current directory')
    .action(async () => {
    console.log('\n  WhatsBridge — Setup Wizard\n');
    // Load existing config to use as defaults (if any)
    let existing = null;
    if ((0, config_1.configExists)()) {
        try {
            existing = (0, config_1.loadConfig)();
        }
        catch { /* ignore parse errors */ }
        const { overwrite } = await inquirer_1.default.prompt([
            {
                type: 'confirm',
                name: 'overwrite',
                message: 'A config already exists here. Overwrite?',
                default: false,
            },
        ]);
        if (!overwrite) {
            console.log('  Aborted.\n');
            process.exit(0);
        }
    }
    const basic = await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'instanceName',
            message: 'Instance name:',
            default: existing?.instanceName ?? path_1.default.basename(process.cwd()),
        },
        {
            type: 'number',
            name: 'port',
            message: 'Port:',
            default: existing?.port ?? 3001,
            validate: (v) => Number.isInteger(v) && v > 0 && v < 65536
                ? true
                : 'Enter a valid port (1–65535)',
        },
        {
            type: 'input',
            name: 'username',
            message: 'Web UI username:',
            default: existing?.username ?? 'admin',
            validate: (v) => v.trim().length > 0 ? true : 'Username cannot be empty',
        },
    ]);
    const { password } = await inquirer_1.default.prompt([
        {
            type: 'password',
            name: 'password',
            message: existing
                ? 'New password: (leave empty to keep current)'
                : 'Web UI password:',
            mask: '*',
            validate: (v) => {
                if (existing && v.length === 0)
                    return true; // keep existing
                return v.length >= 6 ? true : 'Minimum 6 characters';
            },
        },
    ]);
    await inquirer_1.default.prompt([
        {
            type: 'password',
            name: 'confirm',
            message: 'Confirm password:',
            mask: '*',
            when: () => password.length > 0, // skip if keeping existing
            validate: (v) => v === password ? true : 'Passwords do not match',
        },
    ]);
    // Keep old hash if password left blank, generate new one otherwise
    const passwordHash = password.length > 0
        ? await (0, auth_1.hashPassword)(password)
        : existing.passwordHash;
    // Keep old API key on overwrite so existing integrations don't break
    const apiKey = existing?.apiKey ?? crypto_1.default.randomBytes(24).toString('hex');
    (0, config_1.saveConfig)({
        port: basic.port,
        instanceName: basic.instanceName,
        username: basic.username,
        passwordHash,
        apiKey,
    });
    const isUpdate = !!existing;
    console.log(`\n  Config ${isUpdate ? 'updated' : 'saved'} → whatsbridge.config.json`);
    if (!isUpdate)
        console.log(`\n  API Key: ${apiKey}`);
    console.log('\n  Run "whatsbridge start" to launch the server.\n');
});
// ── start ─────────────────────────────────────────────────────────────────────
program
    .command('start')
    .description('Start the server using config in the current directory')
    .option('--cwd <dir>', 'Working directory (used when started as a system service)')
    .action((opts) => {
    try {
        if (opts.cwd)
            process.chdir(opts.cwd);
        const config = (0, config_1.loadConfig)();
        console.log(`\n  Starting ${config.instanceName} on port ${config.port}...\n`);
        (0, updater_1.checkUpdateBackground)((type, msg) => {
            const { log } = require('./logger');
            log(type, msg);
        });
        (0, server_1.startServer)(config);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  Error: ${msg}\n`);
        process.exit(1);
    }
});
// ── update ────────────────────────────────────────────────────────────────────
program
    .command('update')
    .description('Check for and install the latest update')
    .option('--check', 'Only check for updates, do not install')
    .action(async (opts) => {
    console.log('\n  Checking for updates...');
    try {
        const info = await (0, updater_1.checkUpdate)();
        if (!info.hasUpdate) {
            console.log(`  Already up to date (v${info.currentVersion}).\n`);
            return;
        }
        console.log(`  New version available: ${info.latestVersion} (current: v${info.currentVersion})`);
        if (opts.check) {
            console.log();
            return;
        }
        console.log('  Downloading update...');
        let lastPct = -1;
        const newVersion = await (0, updater_1.performUpdate)((pct) => {
            if (pct !== lastPct && pct % 10 === 0) {
                process.stdout.write(`\r  Downloading... ${pct}%`);
                lastPct = pct;
            }
        });
        console.log(`\r  Updated to ${newVersion}. Restart to apply.\n`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  Update failed: ${msg}\n`);
        process.exit(1);
    }
});
// ── service ───────────────────────────────────────────────────────────────────
const service = program.command('service').description('Manage the system service');
service
    .command('install')
    .description('Install and start as a system service (requires admin/sudo)')
    .action(async () => {
    let config;
    try {
        config = (0, config_1.loadConfig)();
    }
    catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
        process.exit(1);
    }
    const info = (0, service_1.serviceInfo)(config);
    console.log(`\n  Installing service "${info.name}"...`);
    try {
        await (0, service_1.installService)(config);
        console.log('\n  Service installed and started successfully.');
        if (process.platform === 'win32') {
            console.log('  Manage it via: Services (services.msc) or Task Manager → Services');
        }
        else {
            console.log(`  Manage it via: sudo systemctl status ${info.name}`);
        }
        console.log();
    }
    catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
        process.exit(1);
    }
});
service
    .command('uninstall')
    .description('Stop and remove the system service')
    .action(async () => {
    let config;
    try {
        config = (0, config_1.loadConfig)();
    }
    catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
        process.exit(1);
    }
    const info = (0, service_1.serviceInfo)(config);
    const { confirm } = await inquirer_1.default.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Remove service "${info.name}"?`,
            default: false,
        }]);
    if (!confirm) {
        console.log('  Aborted.\n');
        process.exit(0);
    }
    try {
        await (0, service_1.uninstallService)(config);
        console.log('\n  Service removed successfully.\n');
    }
    catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
        process.exit(1);
    }
});
program.parse(process.argv);
