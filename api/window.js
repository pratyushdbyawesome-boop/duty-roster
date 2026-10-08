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
            const { fromDate, deadline, label } = body;
            if (!fromDate || !deadline) {
                res.status(400).json({ error: 'fromDate and deadline are required' });
                return;
            }
            // The whole app indexes the week as Sun=0..Sat=6, so a window MUST start on a Sunday —
            // otherwise availability would be mapped onto the wrong weekdays.
            const from = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? new Date(fromDate + 'T00:00:00Z') : null;
            if (!from || isNaN(from)) { res.status(400).json({ error: 'fromDate must be a valid YYYY-MM-DD date' }); return; }
            if (from.getUTCDay() !== 0) { res.status(400).json({ error: 'The week must start on a Sunday' }); return; }
            const dl = new Date(deadline);
            if (isNaN(dl)) { res.status(400).json({ error: 'deadline is not a valid date/time' }); return; }
            if (dl.getTime() <= Date.now()) { res.status(400).json({ error: 'The deadline must be in the future' }); return; }
            const toDate = new Date(from.getTime() + 6 * 86400000).toISOString().slice(0, 10);
            const win = {
                windowId: Date.now().toString(36),
                fromDate,
                toDate,
                deadline,
                label: (label || '').toString().slice(0, 80),
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
