// Asgari service worker: uygulamanın ana ekrana eklenebilmesi ve çevrimdışıyken sade bir uyarı için.
// Finansal veriler ÖNBELLEĞE ALINMAZ; her istek ağa gider.
const OFFLINE = "/offline.html";
self.addEventListener("install", (e) => { e.waitUntil(caches.open("pz-v1").then((c) => c.add(OFFLINE))); self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
