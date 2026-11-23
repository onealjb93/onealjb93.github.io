/* fin-sw.js — cache-first stale-while-revalidate for the Finance
   page's three chart data files (load-speed build, 2026-11-23).

   Registered from finance.html only. It intercepts fetches for
   exactly these paths and nothing else — every other request,
   on every page, passes through untouched:

     finance-chart-first.json   (the first-paint split)
     finance-chart-daily.json   (the full daily file)
     finance-chart-data.json    (the weekly file)

   Strategy per handled request:
   - A cached copy younger than 26 hours is returned immediately;
     in parallel the network copy is fetched, and the cache entry
     is replaced ONLY when the network copy's `through` date
     differs from the cached copy's — `through`, not timestamps,
     decides, so re-pushing an identical file costs nothing and a
     new data day always lands. (The page's own background refresh
     picks the fresh copy up on the same terms as any fetch.)
   - A cached copy older than 26 hours is never painted from:
     the request goes network-first (a missed workflow evening
     plus a full day is the hard bound on staleness), falling
     back to the cached copy only if the network fails.
   - No cached copy: network, then cache what arrived.

   The `through` date and the storage time ride in a small
   metadata cache beside the responses, so the big bodies are
   never parsed just to decide freshness — `through` is read
   from the head of the network text, where the pipeline writes
   it as a top-level key ahead of the series block.

   Cache name is versioned: bump it to kill a bad cache. */
'use strict';

var CACHE = 'fin-data-v1';
var META = 'fin-data-v1-meta';
var HANDLED = ['finance-chart-first.json', 'finance-chart-daily.json', 'finance-chart-data.json'];
var MAX_AGE_MS = 26 * 60 * 60 * 1000;

function handledName(url) {
    var path = new URL(url).pathname;
    for (var i = 0; i < HANDLED.length; i++) {
        if (path.slice(-HANDLED[i].length) === HANDLED[i]) return HANDLED[i];
    }
    return null;
}

function throughOf(text) {
    // Top-level "through" is written before "series"; the first
    // match in the head of the file is the file's own date.
    var m = /"through":"([^"]+)"/.exec(text.slice(0, 4096));
    return m ? m[1] : null;
}

/* The metadata key is a plain relative path — a 'meta:' prefix
   would parse as a URL scheme and the Cache API would refuse it. */
function metaKey(name) { return 'meta/' + name; }

function readMeta(name) {
    return caches.open(META).then(function (c) {
        return c.match(metaKey(name)).then(function (r) {
            return r ? r.json() : null;
        });
    }).catch(function () { return null; });
}

function writeMeta(name, through) {
    return caches.open(META).then(function (c) {
        return c.put(metaKey(name), new Response(JSON.stringify({ through: through, at: Date.now() }), {
            headers: { 'Content-Type': 'application/json' }
        }));
    }).catch(function () { /* metadata is an optimisation; its loss is a cache miss, never an error */ });
}

function store(name, request, response, through) {
    var copy = response.clone();
    return caches.open(CACHE).then(function (c) {
        return c.put(request, copy);
    }).then(function () { return writeMeta(name, through); });
}

/* Fetch the network copy; if its `through` moved, replace the
   cache entry. Returns the network response (for network-first
   callers). Any failure rejects and the caller decides. */
function refresh(name, request) {
    return fetch(request).then(function (response) {
        if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status));
        return response.text().then(function (text) {
            var through = throughOf(text);
            var fresh = new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            });
            return readMeta(name).then(function (meta) {
                if (!meta || meta.through !== through) {
                    return store(name, request, fresh.clone(), through).then(function () { return fresh; });
                }
                return fresh;
            });
        });
    });
}

self.addEventListener('install', function (event) {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
    var name = handledName(event.request.url);
    if (!name || event.request.method !== 'GET') return; // untouched pass-through
    event.respondWith(
        caches.open(CACHE).then(function (cache) {
            return cache.match(event.request).then(function (cached) {
                if (!cached) return refresh(name, event.request);
                return readMeta(name).then(function (meta) {
                    var age = meta && meta.at ? Date.now() - meta.at : Infinity;
                    if (age > MAX_AGE_MS) {
                        // Never painted from: network-first, the
                        // stale copy only as a failure fallback.
                        return refresh(name, event.request).catch(function () { return cached; });
                    }
                    // Paint the cached copy now; refresh behind it.
                    event.waitUntil(refresh(name, event.request).catch(function () { /* the cached copy already answered */ }));
                    return cached;
                });
            });
        }).catch(function () {
            // The cache layer itself failed: an ordinary fetch is
            // the answer — a cache miss, never a broken page.
            return fetch(event.request);
        })
    );
});
