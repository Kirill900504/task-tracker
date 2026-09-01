// Minimal service worker — exists only to satisfy PWA installability
// (Chrome/Edge require an active SW to offer "Install app"). Deliberately
// does no caching: this app needs live, authenticated data on every load,
// so every request just passes straight through to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
