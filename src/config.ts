import fs from 'fs';
import path from 'path';

export interface Config {
  port: number;
  instanceName: string;
  username: string;
  passwordHash: string;
  apiKey: string;
  githubToken?: string;
}

const CONFIG_FILE = 'whatsbridge.config.json';

export function getConfigPath(): string {
  return path.join(process.cwd(), CONFIG_FILE);
}

export function getDataDir(): string {
  return path.join(process.cwd(), 'data');
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function loadConfig(): Config {
  const p = getConfigPath();
  if (!fs.existsSync(p)) {
    throw new Error(`Config not found at ${p}. Run 'whatsbridge init' first.`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as Config;
}

export function saveConfig(config: Config): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}
