// Duty Roster — service worker
//
// Purpose: let the app work offline once loaded, WITHOUT that turning into
// "everyone's stuck on an old version forever." Three things make that work:
//
//   1. CACHE_NAME below has a version number in it. Bump this number every
//      time you deploy a real update (e.g. v4 -> v5). That single-character
//      change is what makes this a byte-different file from what a
//      person's browser already has — which is what makes the browser
//      notice there's an update to fetch at all. Forgetting to bump this is
//      the single most common reason "I updated the file but nobody sees
//      it" happens.
//   2. self.skipWaiting() on install + clients.claim() on activate mean a
//      newly installed version takes over immediately instead of sitting
//      idle until every open tab of the app is fully closed (which, for a
//      PWA someone just leaves open, might be never).
//   3. Old caches get deleted on activate, so storage doesn't quietly grow
//      forever across versions.
//
// The matching code in index.html actively polls for a new version of THIS
// file (every ~60s while open, and whenever the tab regains focus) and
// reloads automatically the moment a new one takes control — so a person
// using the app doesn't have to do anything for an update to reach them.

const CACHE_NAME = 'duty-roster-cache-v6'; // ← bump this on every real deploy
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .catch(() => {}) // fine if some of these don't exist in a given deployment
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Let the page tell a freshly-installed, still-"waiting" worker to take
// over right away instead of waiting for a full reload of every tab.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Network-first for navigations (the actual HTML page) — always try to get
// the latest version from the server first, and only fall back to whatever
// was cached if there's no network right now. This is what stops "the
// server has the new version but the browser just won't ask for it."
// Cache-first for everything else (icons, manifest) since those change
// rarely and it's fine to serve them instantly from cache.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const isNavigation = req.mode === 'navigate' ||
        (req.destination === 'document');

    if (isNavigation) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                    return res;
                })
                .catch(() => caches.match(req).then((res) => res || caches.match('./index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                return res;
            }).catch(() => cached);
        })
    );
});
