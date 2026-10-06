// Shared helpers used by every /api/*.js function in this project.
const crypto = require('crypto');

function randomSalt() {
    return crypto.randomBytes(8).toString('hex');
}

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
}

// Admin actions (managing accounts, opening a new availability window,
// unlocking a submission, fetching everything into the main roster tool)
// are protected by one shared PIN — the same SYNC_PIN env var pattern used
// elsewhere in this project, so there is only one secret to manage.
// Usernames are case-insensitive: "Rakesh", "rakesh" and " RAKESH " are the same
// person. New accounts are always stored lowercase; lookups also tolerate
// legacy accounts that were saved earlier with mixed-case keys.
function normalizeUsername(u) {
    return (u || '').toString().trim().toLowerCase();
}

function findAccountKey(accounts, username) {
    const n = normalizeUsername(username);
    if (!n || !accounts) return null;
    if (Object.prototype.hasOwnProperty.call(accounts, n)) return n;
    return Object.keys(accounts).find((k) => normalizeUsername(k) === n) || null;
}

function safeEqual(a, b) {
    const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function checkAdminPin(req) {
    if (!process.env.SYNC_PIN) {
        return { ok: false, status: 500, error: 'Server misconfigured: SYNC_PIN environment variable is not set' };
    }
    const supplied = req.headers['x-sync-pin'] || '';
    if (!safeEqual(supplied, process.env.SYNC_PIN)) {
        return { ok: false, status: 401, error: 'Wrong or missing admin PIN' };
    }
    return { ok: true };
}

// Each announcer authenticates on every request by sending their own
// username/password as headers (not a session token) — simplest possible
// approach for a small internal tool with a handful of accounts. Looks the
// account up in the accounts table and verifies the password hash.
async function checkAnnouncerAuth(req, redis) {
    const typed = normalizeUsername(req.headers['x-username']);
    const password = (req.headers['x-password'] || '').toString();
    if (!typed || !password) {
        return { ok: false, status: 400, error: 'Missing username or password' };
    }
    const accounts = (await redis.get('accounts')) || {};
    // `username` is the canonical key the account is stored under (and the one
    // submissions are keyed by), which may be a legacy mixed-case key.
    const username = findAccountKey(accounts, typed);
    const account = username ? accounts[username] : null;
    if (!account) {
        return { ok: false, status: 401, error: 'Unknown username or wrong password' };
    }
    const hash = hashPassword(password, account.salt);
    if (hash !== account.passwordHash) {
        return { ok: false, status: 401, error: 'Unknown username or wrong password' };
    }
    return { ok: true, username, account };
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-sync-pin, x-username, x-password');
}

function parseBody(req) {
    if (!req.body) return {};
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    return req.body;
}

module.exports = { normalizeUsername, findAccountKey, randomSalt, hashPassword, checkAdminPin, checkAnnouncerAuth, setCors, parseBody };
