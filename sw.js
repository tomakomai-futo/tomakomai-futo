const CACHE_NAME = 'tomakomai-futo-v4-persistence';
const CORE = ['./','./index.html','./app.js','./manifest.json','./style.css','./config.js','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CORE).catch(()=>{})).then(()=>self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;
  // HTML/JS/manifestは常に最新を優先。古いキャッシュを先に返さない。
  if(url.pathname.endsWith('/app.js')||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/manifest.json')||url.pathname.endsWith('/sw.js')){
    event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(req,copy));return res}).catch(()=>caches.match(req)));
    return;
  }
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(req,copy));return res})));
});
