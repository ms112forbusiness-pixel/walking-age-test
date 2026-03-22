// Service Worker for 歩行年齢テスト 計測システム
// キャッシュ名を更新するとデプロイ時に古いキャッシュが自動削除されます

const CACHE_NAME = 'walking-age-v7-cache-v1';

// インストール時にキャッシュするローカルアセット（Cache First）
const PRECACHE_URLS = [
  './',
  './manifest.json',
];

// ネットワーク優先でキャッシュするCDNドメイン（Network First）
const RUNTIME_CACHE_DOMAINS = [
  'cdn.tailwindcss.com',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ─── install ───────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ─── activate ──────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Netlify Functions → Network Only（キャッシュ不要）
  if (url.pathname.startsWith('/.netlify/')) {
    return; // ブラウザのデフォルト処理に委ねる
  }

  // PRECACHE_URLS → Cache First
  const isPrecached = PRECACHE_URLS.some((p) => {
    const target = new URL(p, self.location.href);
    return target.pathname === url.pathname;
  });
  if (isPrecached) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 外部CDN → Network First
  const isRuntimeDomain = RUNTIME_CACHE_DOMAINS.some((domain) =>
    url.hostname === domain || url.hostname.endsWith('.' + domain)
  );
  if (isRuntimeDomain) {
    event.respondWith(networkFirst(request));
    return;
  }

  // その他 → Network First
  event.respondWith(networkFirst(request));
});

// ─── Cache First 戦略 ──────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineResponse();
  }
}

// ─── Network First 戦略 ────────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineResponse();
  }
}

// ─── オフライン時フォールバックレスポンス ──────────────────────────────────
function offlineResponse() {
  return new Response('オフラインです。ネットワーク接続を確認してください。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
