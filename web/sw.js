// Service Worker：アプリの画面を端末に保存し、電波がなくても開けるようにする
// ・同じサイトのファイルは「保存済みのものをすぐ返し、裏で最新に更新する」
// ・GAS など外部への通信は保存しない（そのまま通す）

const CACHE = 'sozorotsuzuri-v0.2.1';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/db.js',
  './js/sync.js',
  './js/util.js',
  './js/photos.js',
  './js/highlight.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('sozorotsuzuri-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('.html') });
      const network = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      if (res) return res;
      // 画面遷移で何も取れなければ、トップページを返す
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});
