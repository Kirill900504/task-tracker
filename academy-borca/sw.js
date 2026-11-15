/* Академия борца 7.4: страницы загружаются из сети; офлайн — только запасной вариант. */
const CACHE='academy-borca-pwa-7-4';
const SHELL=['./index.html','./academy-data.js','./academy-scenes.js','./manifest.webmanifest','./apple-touch-icon.png','./icon-192.png'];
self.addEventListener('install',event=>event.waitUntil(
 caches.open(CACHE).then(cache=>Promise.allSettled(SHELL.map(url=>cache.add(url)))).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
 caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE&&(key.startsWith('academy-borca')||key.startsWith('academy-wrestling')||key.startsWith('akademiya-borca'))).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 const isNavigation=request.mode==='navigate'||url.pathname.endsWith('/index.html')||url.pathname.endsWith('.js')||url.pathname.endsWith('.webmanifest');
 if(request.headers.has('range')){event.respondWith(fetch(request));return;}
 event.respondWith(fetch(request,{cache:isNavigation?'no-store':'default'}).then(response=>{
  if(response.ok&&response.status===200&&isNavigation){
    const copy=response.clone();
    event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{}));
  }
  return response;
 }).catch(()=>caches.match(request).then(cached=>cached||Response.error())));
});
