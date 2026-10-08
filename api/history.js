// Admin-only: duty history (per-announcer counts + finalised weekly rosters),
// stored server-side under the Redis key "duty-history" = { history, rosterLog }.
// Mutations are explicit operations (not whole-blob overwrites), so a stale tab
// on another device can never wipe or roll back history.
//   GET  -> { data: { history, rosterLog } | null }
//   POST { op:'finalize', week:{weekStart,finalizedAt,slots[]} }  -> counts +1 per filled slot, appends week (keeps 52)
//   POST { op:'rename',   from, to }                              -> moves counts and past-roster names
//   POST { op:'replace',  history, rosterLog }                    -> import / one-time migration
//   POST { op:'clear' }
// Every POST returns { ok, data } with the full updated record.

const { getRedis } = require('../lib/db');
const { checkAdminPin, setCors, parseBody } = require('../lib/auth');

const KEY = 'duty-history';
const MAX_WEEKS = 52;

function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }

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

    try {
        if (req.method === 'GET') {
            res.status(200).json({ data: (await redis.get(KEY)) || null });
            return;
        }
        if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

        const body = parseBody(req);
        const cur = (await redis.get(KEY)) || {};
        let history = isObj(cur.history) ? cur.history : {};
        let rosterLog = Array.isArray(cur.rosterLog) ? cur.rosterLog : [];

        if (body.op === 'finalize') {
            const w = body.week;
            if (!isObj(w) || !Array.isArray(w.slots)) { res.status(400).json({ error: 'week.slots is required' }); return; }
            // Finalising a week that is already logged REPLACES it (reverse its counts first),
            // so double-taps / re-finalising never double-count duties.
            if (w.weekStart) {
                const i = rosterLog.findIndex((x) => x && x.weekStart === w.weekStart);
                if (i >= 0) {
                    (rosterLog[i].slots || []).forEach((sl) => {
                        if (sl && sl.name && history[sl.name]) { history[sl.name]--; if (history[sl.name] <= 0) delete history[sl.name]; }
                    });
                    rosterLog.splice(i, 1);
                }
            }
            w.slots.forEach((s) => { if (s && s.name) history[s.name] = (history[s.name] || 0) + 1; });
            rosterLog.push(w);
            if (rosterLog.length > MAX_WEEKS) rosterLog = rosterLog.slice(-MAX_WEEKS);
        } else if (body.op === 'rename') {
            const from = (body.from || '').toString(), to = (body.to || '').toString();
            if (!from || !to) { res.status(400).json({ error: 'from and to are required' }); return; }
            if (from !== to) {
                if (history[from] !== undefined) { history[to] = (history[to] || 0) + history[from]; delete history[from]; }
                rosterLog.forEach((wk) => (wk.slots || []).forEach((s) => { if (s && s.name === from) s.name = to; }));
            }
        } else if (body.op === 'replace') {
            if (!isObj(body.history) || !Array.isArray(body.rosterLog)) { res.status(400).json({ error: 'history (object) and rosterLog (array) are required' }); return; }
            history = body.history;
            rosterLog = body.rosterLog.slice(-MAX_WEEKS);
        } else if (body.op === 'clear') {
            history = {}; rosterLog = [];
        } else {
            res.status(400).json({ error: 'Unknown op' }); return;
        }

        const data = { history, rosterLog };
        await redis.set(KEY, data);
        res.status(200).json({ ok: true, data });
    } catch (e) {
        console.error('history failed', e);
        res.status(500).json({ error: 'Failed to access duty history' });
    }
};
