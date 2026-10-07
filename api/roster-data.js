// Admin-only: the main roster tool's data (announcer master list, duty history,
// settings) — previously only in the browser's localStorage. One Redis key,
// "roster-data", last-write-wins. Both verbs require the admin PIN.
//   GET  -> { data: <saved blob> | null }
//   POST -> body { data: { weekStart, phoneInDays, balanceDuties, priorityMode,
//                          announcers, history, rosterLog } }  -> { ok, savedAt }

const { getRedis } = require('../lib/db');
const { checkAdminPin, setCors, parseBody } = require('../lib/auth');

const KEY = 'roster-data';

function validate(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return 'data must be an object';
    if (!Array.isArray(d.announcers)) return 'data.announcers must be an array';
    if (d.history !== undefined && (typeof d.history !== 'object' || d.history === null || Array.isArray(d.history))) return 'data.history must be an object';
    if (d.rosterLog !== undefined && !Array.isArray(d.rosterLog)) return 'data.rosterLog must be an array';
    if (d.phoneInDays !== undefined && !Array.isArray(d.phoneInDays)) return 'data.phoneInDays must be an array';
    return null;
}

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
            const data = await redis.get(KEY);
            res.status(200).json({ data: data || null });
        } catch (e) {
            console.error('roster-data GET failed', e);
            res.status(500).json({ error: 'Failed to read roster data' });
        }
        return;
    }

    if (req.method === 'POST') {
        try {
            const body = parseBody(req);
            const err = validate(body.data);
            if (err) { res.status(400).json({ error: err }); return; }
            await redis.set(KEY, body.data);
            res.status(200).json({ ok: true, savedAt: Date.now() });
        } catch (e) {
            console.error('roster-data POST failed', e);
            res.status(500).json({ error: 'Failed to save roster data' });
        }
        return;
    }

    res.status(405).json({ error: 'Method not allowed' });
};
