/* Caisse Pro — Service Worker (hors ligne complet)
   Incrémentez VERSION à chaque déploiement pour forcer la mise à jour. */
const VERSION = "caissepro-v3";
const SHELL_CACHE = VERSION + "-shell";
const LIB_CACHE = VERSION + "-libs";

const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-app-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-firestore-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-auth-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js",
  "https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Outfit:wght@400;500;600;700;800;900&display=swap"
];

// Ces domaines ne passent JAMAIS par le cache (Firestore gère son propre cache hors ligne)
const BYPASS = /(firestore\.googleapis\.com|firebaseio\.com|identitytoolkit|securetoken|googleapis\.com\/(identitytoolkit|v1)|google-analytics|googletagmanager)/;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // Tolérant : un fichier manquant ne bloque pas l'installation
    await Promise.all(SHELL.map((u) => shell.add(u).catch(() => {})));
    const libs = await caches.open(LIB_CACHE);
    await Promise.all(LIBS.map((u) => libs.add(new Request(u, { mode: "cors" })).catch(() => {})));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, LIB_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

// Réseau d'abord (max 3,5 s) puis cache : démarrage instantané même avec une mauvaise 2G/3G
function networkFirst(req, cacheName, fallbackUrl) {
  return new Promise((resolve) => {
    let done = false;
    const fromCache = async () => (await caches.match(req)) || (fallbackUrl && (await caches.match(fallbackUrl)));
    const timer = setTimeout(async () => {
      const hit = await fromCache();
      if (hit && !done) { done = true; resolve(hit); }
    }, 3500);
    fetch(req).then(async (res) => {
      clearTimeout(timer);
      if (res && res.ok) { const c = await caches.open(cacheName); c.put(req, res.clone()); }
      if (!done) { done = true; resolve(res); }
    }).catch(async () => {
      clearTimeout(timer);
      const hit = await fromCache();
      if (!done) { done = true; resolve(hit || new Response("Hors ligne", { status: 503, statusText: "Offline" })); }
    });
  });
}

// Cache d'abord + mise à jour en arrière-plan
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await refresh) || new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (BYPASS.test(url.href)) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, SHELL_CACHE, "./index.html"));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
  if (/cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.host)) {
    event.respondWith(staleWhileRevalidate(req, LIB_CACHE));
  }
});
