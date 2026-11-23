// ClearPoint CRM on phones: always loads the newest version from the network.
// Only a small "you're offline" page is kept, for when there's no signal.
const C = "cpg-offline-v1";
const OFFLINE = "offline.html";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll([OFFLINE, "brand/cpg-lockup.png"])).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;               // data, images, scripts: straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
