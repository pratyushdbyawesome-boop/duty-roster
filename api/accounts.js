// Admin-only: create, update, list, and remove announcer login accounts.
// Stored as a single Redis key "accounts" -> { username: { passwordHash, salt, displayName, designation } }.
// GET never returns password hashes — only what the admin dashboard needs to show.

const { getRedis } = require('../lib/db');
const { randomSalt, hashPassword, checkAdminPin, setCors, parseBody, normalizeUsername, findAccountKey } = require('../lib/auth');

// Usernames/passwords travel in HTTP headers, which can only carry plain ASCII — a Hindi/emoji
// password would make login crash in the browser. Display names (shown to people) can be anything.
const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;
const PASSWORD_RE = /^[\x20-\x7E]{4,64}$/;
const USERNAME_MSG = 'Username must be 2-32 characters: lowercase letters, digits, dot, dash or underscore (no spaces)';
const PASSWORD_MSG = 'Password must be 4-64 plain English characters (letters, digits, symbols — no Hindi/emoji)';

module.exports = async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }

    const auth = await checkAdminPin(req);
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

    // POST has two explicit modes (never a silent overwrite):
    //   { username, password, displayName?, designation? }              -> CREATE. 409 if the username exists.
    //   { username, password?, displayName?, designation?, newUsername?, update:true }
    //                                                                    -> UPDATE an existing account (password reset,
    //                                                                       rename display name / username). 404 if missing.
    if (req.method === 'POST') {
        try {
            const body = parseBody(req);
            const typed = normalizeUsername(body.username);
            if (!typed) { res.status(400).json({ error: 'username is required' }); return; }
            const accounts = (await redis.get('accounts')) || {};
            const existingKey = findAccountKey(accounts, typed);
            const existing = existingKey ? accounts[existingKey] : null;
            const isUpdate = body.update === true;

            if (isUpdate) {
                if (!existing) { res.status(404).json({ error: 'No such account: ' + typed }); return; }
                if (!body.password && body.displayName === undefined && body.designation === undefined && !body.newUsername) {
                    res.status(400).json({ error: 'Nothing to update' }); return;
                }
            } else {
                if (existing) { res.status(409).json({ error: 'Username "' + existingKey + '" already exists — use Edit/Reset password on that row instead' }); return; }
                if (!body.password) { res.status(400).json({ error: 'password is required when creating a new account' }); return; }
                if (!USERNAME_RE.test(typed)) { res.status(400).json({ error: USERNAME_MSG }); return; }
            }

            if (body.password && !PASSWORD_RE.test(body.password.toString())) { res.status(400).json({ error: PASSWORD_MSG }); return; }
            let key = existingKey || typed;
            let renamedFrom = null;
            if (isUpdate && body.newUsername) {
                const nu = normalizeUsername(body.newUsername);
                if (!USERNAME_RE.test(nu)) { res.status(400).json({ error: USERNAME_MSG }); return; }
                if (nu !== normalizeUsername(existingKey)) {
                    if (findAccountKey(accounts, nu)) { res.status(409).json({ error: 'Username "' + nu + '" is already taken' }); return; }
                    renamedFrom = existingKey;
                    key = nu;
                } else if (nu !== existingKey) { // same name, only the legacy mixed case is being normalised
                    renamedFrom = existingKey;
                    key = nu;
                }
            }
            const salt = existing ? existing.salt : randomSalt();
            const passwordHash = body.password ? hashPassword(body.password.toString(), salt) : existing.passwordHash;
            if (renamedFrom) delete accounts[renamedFrom];
            accounts[key] = {
                passwordHash,
                salt,
                displayName: (body.displayName || (existing ? existing.displayName : '') || key).toString(),
                designation: (body.designation || (existing ? existing.designation : '') || 'सी.ए.').toString()
            };
            await redis.set('accounts', accounts);
            if (renamedFrom) {
                // Carry this person's submission for the currently open window over to the new
                // username (submissions are keyed by window + username). Older windows are history only.
                try {
                    const win = await redis.get('window');
                    if (win && win.windowId) {
                        const oldK = 'submission:' + win.windowId + ':' + renamedFrom;
                        const sub = await redis.get(oldK);
                        if (sub) {
                            await redis.set('submission:' + win.windowId + ':' + key, sub);
                            await redis.del(oldK);
                        }
                    }
                } catch (e) { console.error('submission move failed', e); }
            }
            res.status(200).json({ ok: true, username: key, created: !existing, renamedFrom });
        } catch (e) {
            console.error('accounts POST failed', e);
            res.status(500).json({ error: 'Failed to save account' });
        }
        return;
    }

    if (req.method === 'DELETE') {
        try {
            const body = parseBody(req);
            if (!normalizeUsername(body.username)) { res.status(400).json({ error: 'username is required' }); return; }
            const accounts = (await redis.get('accounts')) || {};
            const key = findAccountKey(accounts, body.username);
            if (key) delete accounts[key];
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
