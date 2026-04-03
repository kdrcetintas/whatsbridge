"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.requireSession = requireSession;
exports.requireApiKey = requireApiKey;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, 10);
}
async function verifyPassword(password, hash) {
    return bcryptjs_1.default.compare(password, hash);
}
function requireSession(req, res, next) {
    if (req.session?.authenticated) {
        next();
        return;
    }
    // API / SSE paths → 401 JSON, pages → redirect
    if (req.path.startsWith('/api/') || req.path.startsWith('/logs/')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    res.redirect('/login');
}
function requireApiKey(apiKey) {
    return (req, res, next) => {
        const key = req.query['api_key'];
        if (key !== apiKey) {
            res.status(401).json({ error: 'Invalid or missing api_key query parameter' });
            return;
        }
        next();
    };
}
