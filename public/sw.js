const CACHE = "gameson-shell-v7";
const SHELL = [
  "/", "/imposter", "/werwolf", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png",
  "/audio/werwolf/wolves.mp3", "/audio/werwolf/cupid.mp3", "/audio/werwolf/wild-child.mp3",
  "/audio/werwolf/thief.mp3", "/audio/werwolf/hunter.mp3", "/audio/werwolf/witch.mp3",
  "/audio/werwolf/seer.mp3", "/audio/werwolf/night-start.mp3", "/audio/werwolf/day-start.mp3",
  "/audio/werwolf/sleep-all.mp3", "/audio/werwolf/sleep-again.mp3",
  "/audio/werwolf/victory-village.mp3", "/audio/werwolf/victory-wolves.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(url.pathname, copy)); return response; }).catch(() => caches.match(url.pathname).then((cached) => cached || caches.match("/"))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); } return response; })));
});
