// Bump on every asset change: the fetch handler is cache-first and never
// revalidates, so a stale CACHE_NAME keeps serving old JS to installed clients.
const CACHE_NAME = 'lumiiq-v3';
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
    '/gaze-engine.js',
    '/gaze/one-euro-filter.js',
    '/gaze/ridge-regression.js',
    '/gaze/gaze-stabilizer.js',
    '/gaze/dwell-controller.js',
    '/gaze/gaze-calibration.js',
    '/gaze/drift-detector.js',
    '/lib/mediapipe/vision_bundle.mjs',
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
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((res) => res || fetch(e.request))
    );
});
