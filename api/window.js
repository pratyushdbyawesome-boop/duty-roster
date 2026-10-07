// GET is public (both the admin dashboard and the announcer login page need
// to know the current window) — there's nothing sensitive in it.
// POST (admin only) opens a NEW window. Submissions are stored keyed by
// windowId, so opening a new window automatically makes every previous
// submission irrelevant without needing to delete anything — a fresh round
// always starts with everyone unlocked and blank.

const { getRedis } = require('../lib/db');
const { checkAdminPin, setCors, parseBody } = require('../lib/auth');

module.exports = async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }

    let redis;
    try { redis = getRedis(); } catch (e) {
        res.status(500).json({ error: 'Server misconfigured: Upstash Redis is not connected to this project' });
        return;
    }

    if (req.method === 'GET') {
        try {
            const win = await redis.get('window');
            res.status(200).json({ window: win || null });
        } catch (e) {
            console.error('window GET failed', e);
            res.status(500).json({ error: 'Failed to read window' });
        }
        return;
    }

    if (req.method === 'POST') {
        const auth = await checkAdminPin(req);
        if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
        try {
            const body = parseBody(req);
            const { fromDate, toDate, deadline, label } = body;
            if (!fromDate || !toDate || !deadline) {
                res.status(400).json({ error: 'fromDate, toDate and deadline are all required' });
                return;
            }
            const win = {
                windowId: Date.now().toString(36),
                fromDate,
                toDate,
                deadline,
                label: label || '',
                createdAt: Date.now()
            };
            await redis.set('window', win);
            res.status(200).json({ ok: true, window: win });
        } catch (e) {
            console.error('window POST failed', e);
            res.status(500).json({ error: 'Failed to open new window' });
        }
        return;
    }

    res.status(405).json({ error: 'Method not allowed' });
};
