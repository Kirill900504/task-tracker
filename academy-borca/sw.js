const CACHE='academy-borca-complete-4';
const ASSETS=["./index.html", "./academy-data.js", "./academy-scenes.js", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png", "./assets/home-cover.webp", "./manifest.webmanifest", "./media/defense_reaction.mp4", "./media/defense_stop.mp4", "./media/distance_circle.mp4", "./media/go_behind.mp4", "./media/grip_basic.mp4", "./media/single_entry.mp4", "./media/single_finish.mp4", "./media/single_variant.mp4", "./media/stance_basic.mp4", "./media/stand_up.mp4", "./media/top_control.mp4"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await Promise.allSettled(ASSETS.map(url=>cache.add(url)));await self.skipWaiting();})));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('academy-borca')||k.startsWith('akademiya-borca')||k.startsWith('academy-wrestling'))&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.headers.has('range')){
  event.respondWith(fetch(request).catch(async()=>{
   const cached=await caches.match(new Request(request.url));if(!cached)return new Response('',{status:416});
   const data=await cached.arrayBuffer(),m=/bytes=(\d+)-(\d*)/.exec(request.headers.get('range')||'');if(!m)return cached;
   const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),data.byteLength-1):data.byteLength-1;
   if(start>=data.byteLength||end<start)return new Response('',{status:416});
   return new Response(data.slice(start,end+1),{status:206,headers:{'Content-Range':'bytes '+start+'-'+end+'/'+data.byteLength,'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Content-Type':cached.headers.get('Content-Type')||'video/mp4'}});
  }));return;
 }
 event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{
  if(response.ok&&response.status===200){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{}));}
  return response;
 }).catch(()=>caches.match(request)));
});