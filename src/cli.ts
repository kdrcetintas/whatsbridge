#!/usr/bin/env node
import path from 'path';
import crypto from 'crypto';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { configExists, loadConfig, saveConfig } from './config';
import { hashPassword } from './auth';
import { startServer } from './server';
import { installService, uninstallService, serviceInfo } from './service';
import { checkUpdate, performUpdate, currentVersion, checkUpdateBackground } from './updater';

const program = new Command();

program
  .name('whatsbridge')
  .description('WhatsBridge — WhatsApp REST API server with web dashboard')
  .version(currentVersion());

// ── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a new instance in the current directory')
  .action(async () => {
    console.log('\n  WhatsBridge — Setup Wizard\n');

    // Load existing config to use as defaults (if any)
    let existing: ReturnType<typeof loadConfig> | null = null;
    if (configExists()) {
      try { existing = loadConfig(); } catch { /* ignore parse errors */ }

      const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
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

    const basic = await inquirer.prompt<{
      instanceName: string;
      port: number;
      username: string;
    }>([
      {
        type: 'input',
        name: 'instanceName',
        message: 'Instance name:',
        default: existing?.instanceName ?? path.basename(process.cwd()),
      },
      {
        type: 'number',
        name: 'port',
        message: 'Port:',
        default: existing?.port ?? 3001,
        validate: (v: number) =>
          Number.isInteger(v) && v > 0 && v < 65536
            ? true
            : 'Enter a valid port (1–65535)',
      },
      {
        type: 'input',
        name: 'username',
        message: 'Web UI username:',
        default: existing?.username ?? 'admin',
        validate: (v: string) =>
          v.trim().length > 0 ? true : 'Username cannot be empty',
      },
    ]);

    const { password } = await inquirer.prompt<{ password: string }>([
      {
        type: 'password',
        name: 'password',
        message: existing
          ? 'New password: (leave empty to keep current)'
          : 'Web UI password:',
        mask: '*',
        validate: (v: string) => {
          if (existing && v.length === 0) return true; // keep existing
          return v.length >= 6 ? true : 'Minimum 6 characters';
        },
      },
    ]);

    await inquirer.prompt<{ confirm: string }>([
      {
        type: 'password',
        name: 'confirm',
        message: 'Confirm password:',
        mask: '*',
        when: () => password.length > 0, // skip if keeping existing
        validate: (v: string) =>
          v === password ? true : 'Passwords do not match',
      },
    ]);

    // Keep old hash if password left blank, generate new one otherwise
    const passwordHash = password.length > 0
      ? await hashPassword(password)
      : existing!.passwordHash;

    // Keep old API key on overwrite so existing integrations don't break
    const apiKey = existing?.apiKey ?? crypto.randomBytes(24).toString('hex');

    const { githubToken } = await inquirer.prompt<{ githubToken: string }>([
      {
        type: 'password',
        name: 'githubToken',
        message: 'GitHub Personal Access Token (optional, for private repo updates):',
        mask: '*',
        default: '',
      },
    ]);

    saveConfig({
      port: basic.port,
      instanceName: basic.instanceName,
      username: basic.username,
      passwordHash,
      apiKey,
      githubToken: githubToken.trim() || existing?.githubToken,
    });

    const isUpdate = !!existing;
    console.log(`\n  Config ${isUpdate ? 'updated' : 'saved'} → whatsbridge.config.json`);
    if (!isUpdate) console.log(`\n  API Key: ${apiKey}`);
    console.log('\n  Run "whatsbridge start" to launch the server.\n');
  });

// ── start ─────────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the server using config in the current directory')
  .option('--cwd <dir>', 'Working directory (used when started as a system service)')
  .action((opts: { cwd?: string }) => {
    try {
      if (opts.cwd) process.chdir(opts.cwd);
      const config = loadConfig();
      console.log(`\n  Starting ${config.instanceName} on port ${config.port}...\n`);
      checkUpdateBackground((type, msg) => {
        const { log } = require('./logger');
        log(type, msg);
      });
      startServer(config);
    } catch (err: unknown) {
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
  .action(async (opts: { check?: boolean }) => {
    console.log('\n  Checking for updates...');

    // Load stored token if available
    let token: string | undefined;
    try { token = loadConfig().githubToken; } catch { /* no config */ }

    const doUpdate = async (t?: string): Promise<void> => {
      try {
        const info = await checkUpdate(t);
        if (!info.hasUpdate) {
          console.log(`  Already up to date (v${info.currentVersion}).\n`);
          return;
        }
        console.log(`  New version available: ${info.latestVersion} (current: v${info.currentVersion})`);
        if (opts.check) { console.log(); return; }

        console.log('  Downloading update...');
        let lastPct = -1;
        const newVersion = await performUpdate((pct) => {
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r  Downloading... ${pct}%`);
            lastPct = pct;
          }
        }, t);
        console.log(`\r  Updated to ${newVersion}. Restart to apply.\n`);

        // Persist token if it was newly provided
        if (t && t !== token) {
          try { const cfg = loadConfig(); cfg.githubToken = t; saveConfig(cfg); } catch { /* ignore */ }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'GITHUB_404' && !t) {
          console.log('  Repository not found or private. A GitHub Personal Access Token is required.');
          const { pat } = await inquirer.prompt<{ pat: string }>([{
            type: 'password',
            name: 'pat',
            message: '  GitHub Personal Access Token:',
            mask: '*',
            validate: (v: string) => v.trim().length > 0 ? true : 'Token cannot be empty',
          }]);
          return doUpdate(pat.trim());
        }
        console.error(`\n  Update failed: ${msg}\n`);
        process.exit(1);
      }
    };

    await doUpdate(token);
  });

// ── service ───────────────────────────────────────────────────────────────────

const service = program.command('service').description('Manage the system service');

service
  .command('install')
  .description('Install and start as a system service (requires admin/sudo)')
  .action(async () => {
    let config;
    try {
      config = loadConfig();
    } catch (err: unknown) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }

    const info = serviceInfo(config);
    console.log(`\n  Installing service "${info.name}"...`);

    try {
      await installService(config);
      console.log('\n  Service installed and started successfully.');
      if (process.platform === 'win32') {
        console.log('  Manage it via: Services (services.msc) or Task Manager → Services');
      } else {
        console.log(`  Manage it via: sudo systemctl status ${info.name}`);
      }
      console.log();
    } catch (err: unknown) {
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
      config = loadConfig();
    } catch (err: unknown) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }

    const info = serviceInfo(config);

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Remove service "${info.name}"?`,
      default: false,
    }]);

    if (!confirm) { console.log('  Aborted.\n'); process.exit(0); }

    try {
      await uninstallService(config);
      console.log('\n  Service removed successfully.\n');
    } catch (err: unknown) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
