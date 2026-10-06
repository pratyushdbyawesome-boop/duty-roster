// GET    -> an announcer (authenticated via x-username/x-password headers)
//           reads their own current-window submission (or a blank default).
// POST   -> save a draft (avail + phoneIn). Rejected once locked.
// PUT    -> save the final answer AND lock it in one call, so there's no
//           risk of "my last autosave didn't reach the server before I
//           locked" — whatever is sent here becomes the locked answer.
//           Rejected if already locked (locking is final from the
//           announcer's side; only an admin can undo it).
// PATCH  -> admin-only override: unlock one specific announcer's current
//           submission so they can edit and re-lock it.

const { getRedis } = require('../lib/db');
const { checkAdminPin, checkAnnouncerAuth, setCors, parseBody } = require('../lib/auth');

function emptyAvail() {
    const a = {};
    for (let d = 0; d < 7; d++) a[d] = { s1: false, s2: false, s3: false };
    return a;
}

function submissionKey(windowId, username) {
    return 'submission:' + windowId + ':' + username;
}

module.exports = async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }

    let redis;
    try { redis = getRedis(); } catch (e) {
        res.status(500).json({ error: 'Server misconfigured: Upstash Redis is not connected to this project' });
        return;
    }

    if (req.method === 'PATCH') {
        const admin = checkAdminPin(req);
        if (!admin.ok) { res.status(admin.status).json({ error: admin.error }); return; }
        try {
            const body = parseBody(req);
            const username = (body.username || '').toString().trim();
            if (!username) { res.status(400).json({ error: 'username is required' }); return; }
            const win = await redis.get('window');
            if (!win) { res.status(400).json({ error: 'No availability window is open' }); return; }
            const key = submissionKey(win.windowId, username);
            const existing = await redis.get(key);
            if (!existing) { res.status(404).json({ error: 'No submission found for this person in the current window' }); return; }
            existing.locked = false;
            existing.unlockedAt = Date.now();
            await redis.set(key, existing);
            res.status(200).json({ ok: true });
        } catch (e) {
            console.error('submission PATCH failed', e);
            res.status(500).json({ error: 'Failed to unlock submission' });
        }
        return;
    }

    // GET / POST / PUT all act on the authenticated announcer's own record.
    const auth = await checkAnnouncerAuth(req, redis);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    const win = await redis.get('window');

    if (req.method === 'GET') {
        if (!win) { res.status(200).json({ window: null, submission: null }); return; }
        try {
            const existing = await redis.get(submissionKey(win.windowId, auth.username));
            res.status(200).json({
                window: win,
                submission: existing || { avail: emptyAvail(), phoneIn: false, locked: false }
            });
        } catch (e) {
            console.error('submission GET failed', e);
            res.status(500).json({ error: 'Failed to read submission' });
        }
        return;
    }

    if (!win) { res.status(400).json({ error: 'No availability window is currently open' }); return; }
    const key = submissionKey(win.windowId, auth.username);

    if (req.method === 'POST') {
        try {
            const existing = await redis.get(key);
            if (existing && existing.locked) {
                res.status(403).json({ error: 'Already locked — contact the admin to make changes' });
                return;
            }
            const body = parseBody(req);
            const record = {
                avail: body.avail || emptyAvail(),
                phoneIn: !!body.phoneIn,
                locked: false,
                updatedAt: Date.now()
            };
            await redis.set(key, record);
            res.status(200).json({ ok: true });
        } catch (e) {
            console.error('submission POST failed', e);
            res.status(500).json({ error: 'Failed to save draft' });
        }
        return;
    }

    if (req.method === 'PUT') {
        try {
            const existing = await redis.get(key);
            if (existing && existing.locked) {
                res.status(403).json({ error: 'Already locked — contact the admin to make changes' });
                return;
            }
            const body = parseBody(req);
            const record = {
                avail: body.avail || (existing ? existing.avail : emptyAvail()),
                phoneIn: body.phoneIn !== undefined ? !!body.phoneIn : (existing ? existing.phoneIn : false),
                locked: true,
                updatedAt: Date.now(),
                lockedAt: Date.now()
            };
            await redis.set(key, record);
            res.status(200).json({ ok: true });
        } catch (e) {
            console.error('submission PUT failed', e);
            res.status(500).json({ error: 'Failed to lock submission' });
        }
        return;
    }

    res.status(405).json({ error: 'Method not allowed' });
};
