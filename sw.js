// Service worker: lets the installed app start when the local server is not
// running, without ever serving stale code when it is.
//
// Strategy: network-first for the app's own files — the server's current
// version whenever it is reachable, the cached copy only when it is not.
// (The previous cache-first handler never revalidated, so after a code change
// browsers kept running the old JavaScript — AUDIT M12.) API requests are
// never cached. Bump CACHE_NAME when the ASSETS list changes.
const CACHE_NAME = 'lumiiq-v7';
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/keyboard.js',
    '/voice.js',
    '/body-map.js',
    '/dictionary.js',
    '/database.js',
    '/phrases.js',
    '/diagnostics.js',
    '/eval/metrics.js',
    '/eval/session-recorder.js',
    '/eval/eval-wizard.js',
    '/gaze-engine.js',
    '/gaze/one-euro-filter.js',
    '/gaze/ridge-regression.js',
    '/gaze/gaze-stabilizer.js',
    '/gaze/dwell-controller.js',
    '/gaze/gaze-calibration.js',
    '/gaze/drift-detector.js',
    '/gaze/gaze-features.js',
    '/lib/mediapipe/vision_bundle.mjs',
    // MediaPipe's WebAssembly runtime (SIMD build; the no-SIMD fallback is
    // cached the first time a browser that needs it fetches it).
    '/lib/mediapipe/wasm/vision_wasm_internal.js',
    '/lib/mediapipe/wasm/vision_wasm_internal.wasm',
    '/models/face_landmarker.task',
    '/manifest.json',
    '/favicon.ico',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    // Only the app's own files; API calls and writes go straight to the network.
    if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
    e.respondWith(
        fetch(e.request)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                }
                return res;
            })
            .catch(() => caches.match(e.request).then((cached) => cached || Response.error()))
    );
});
