/* Академия борца: всегда пробуем сеть, затем офлайн-кеш. */
const CACHE='academy-wrestling-motion-v3';
const ASSETS=['./index.html','./manifest.webmanifest','./apple-touch-icon.png','./icon-192.png','./icon-512.webp','./motion/stance.webp','./motion/grip.webp','./motion/single_leg.webp','./motion/defense.webp'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(ASSETS.map(url=>cache.add(url)))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
  caches.keys().then(names=>Promise.all(names.filter(name=>name.startsWith('akademiya-borca')||name.startsWith('academy-wrestling-')).filter(name=>name!==CACHE).map(name=>caches.delete(name)))),
  self.clients.claim()
 ]));
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 event.respondWith(fetch(req,{cache:'no-store'}).then(response=>{
   if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,clone)));}
   return response;
 }).catch(()=>caches.match(req)));
});
