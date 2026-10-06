// Admin-only. Returns the current window plus every account's submission
// status for it — used both to draw the "who has locked in" status
// dashboard and as the data source for the main app's "Fetch availability"
// button (which then filters to locked-only before importing).

const { getRedis } = require('../lib/db');
const { checkAdminPin, setCors } = require('../lib/auth');

module.exports = async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const auth = checkAdminPin(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    let redis;
    try { redis = getRedis(); } catch (e) {
        res.status(500).json({ error: 'Server misconfigured: Upstash Redis is not connected to this project' });
        return;
    }

    try {
        const win = await redis.get('window');
        const accounts = (await redis.get('accounts')) || {};
        const usernames = Object.keys(accounts);

        let submissions = {};
        if (win) {
            const keys = usernames.map((u) => 'submission:' + win.windowId + ':' + u);
            if (keys.length > 0) {
                const values = await redis.mget(...keys);
                usernames.forEach((u, i) => { if (values[i]) submissions[u] = values[i]; });
            }
        }

        const people = usernames.map((username) => ({
            username,
            displayName: accounts[username].displayName || username,
            designation: accounts[username].designation || 'सी.ए.',
            submission: submissions[username] || null
        }));

        res.status(200).json({ window: win || null, people });
    } catch (e) {
        console.error('fetch-all failed', e);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
};
