"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfigPath = getConfigPath;
exports.getDataDir = getDataDir;
exports.configExists = configExists;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const CONFIG_FILE = 'whatsbridge.config.json';
function getConfigPath() {
    return path_1.default.join(process.cwd(), CONFIG_FILE);
}
function getDataDir() {
    return path_1.default.join(process.cwd(), 'data');
}
function configExists() {
    return fs_1.default.existsSync(getConfigPath());
}
function loadConfig() {
    const p = getConfigPath();
    if (!fs_1.default.existsSync(p)) {
        throw new Error(`Config not found at ${p}. Run 'whatsbridge init' first.`);
    }
    return JSON.parse(fs_1.default.readFileSync(p, 'utf-8'));
}
function saveConfig(config) {
    fs_1.default.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}
