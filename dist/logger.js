"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logBus = void 0;
exports.log = log;
exports.getRecentLogs = getRecentLogs;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
const config_1 = require("./config");
exports.logBus = new events_1.EventEmitter();
exports.logBus.setMaxListeners(100);
const recentLogs = [];
const MAX_RECENT = 500;
function log(type, msg) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 19);
    const entry = { time, type, msg };
    console.log(`[${time}] [${type}] ${msg}`);
    try {
        const logDir = path_1.default.join((0, config_1.getDataDir)(), 'logs');
        if (!fs_1.default.existsSync(logDir))
            fs_1.default.mkdirSync(logDir, { recursive: true });
        fs_1.default.appendFileSync(path_1.default.join(logDir, `${date}.log`), `[${time}] [${type}] ${msg}\n`);
    }
    catch { /* ignore */ }
    recentLogs.push(entry);
    if (recentLogs.length > MAX_RECENT)
        recentLogs.shift();
    exports.logBus.emit('log', entry);
}
function getRecentLogs() {
    return [...recentLogs];
}
