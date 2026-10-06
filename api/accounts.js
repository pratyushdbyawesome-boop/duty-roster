// Admin-only: create, update, list, and remove announcer login accounts.
// Stored as a single Redis key "accounts" -> { username: { passwordHash, salt, displayName, designation } }.
// GET never returns password hashes — only what the admin dashboard needs to show.

const { getRedis } = require('../lib/db');
const { randomSalt, hashPassword, checkAdminPin, setCors, parseBody } = require('../lib/auth');

module.exports = async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }

    const auth = checkAdminPin(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    let redis;
    try { redis = getRedis(); } catch (e) {
        res.status(500).json({ error: 'Server misconfigured: Upstash Redis is not connected to this project' });
        return;
    }

    if (req.method === 'GET') {
        try {
            const accounts = (await redis.get('accounts')) || {};
            const list = Object.keys(accounts).map((username) => ({
                username,
                displayName: accounts[username].displayName || username,
                designation: accounts[username].designation || 'सी.ए.'
            }));
            res.status(200).json({ accounts: list });
        } catch (e) {
            console.error('accounts GET failed', e);
            res.status(500).json({ error: 'Failed to read accounts' });
        }
        return;
    }

    if (req.method === 'POST') {
        try {
            const body = parseBody(req);
            const username = (body.username || '').toString().trim();
            if (!username) { res.status(400).json({ error: 'username is required' }); return; }
            const accounts = (await redis.get('accounts')) || {};
            const existing = accounts[username];

            if (!existing && !body.password) {
                res.status(400).json({ error: 'password is required when creating a new account' });
                return;
            }

            const salt = existing ? existing.salt : randomSalt();
            const passwordHash = body.password
                ? hashPassword(body.password, salt)
                : (existing ? existing.passwordHash : null);

            accounts[username] = {
                passwordHash,
                salt,
                displayName: (body.displayName || username).toString(),
                designation: (body.designation || (existing ? existing.designation : 'सी.ए.')).toString()
            };
            await redis.set('accounts', accounts);
            res.status(200).json({ ok: true, username, created: !existing });
        } catch (e) {
            console.error('accounts POST failed', e);
            res.status(500).json({ error: 'Failed to save account' });
        }
        return;
    }

    if (req.method === 'DELETE') {
        try {
            const body = parseBody(req);
            const username = (body.username || '').toString().trim();
            if (!username) { res.status(400).json({ error: 'username is required' }); return; }
            const accounts = (await redis.get('accounts')) || {};
            delete accounts[username];
            await redis.set('accounts', accounts);
            res.status(200).json({ ok: true });
        } catch (e) {
            console.error('accounts DELETE failed', e);
            res.status(500).json({ error: 'Failed to delete account' });
        }
        return;
    }

    res.status(405).json({ error: 'Method not allowed' });
};
