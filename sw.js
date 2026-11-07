// Zeemal Health Clinic offline support. Bump CACHE when the offline shell changes.
const CACHE='zeemal-clinic-v13';
const CORE=['./','./index.html','./manifest.json','./zeemal-health-clinic-logo.svg','./zeemal-health-clinic-logo.png'];
const ZXING='https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const SDK=[
 ZXING,
 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
];
self.addEventListener('install',e=>{
 e.waitUntil(caches.open(CACHE).then(c=>Promise.all([
  ...CORE.map(u=>c.add(u).catch(()=>{})),
  ...SDK.map(u=>fetch(u,{mode:'no-cors'}).then(r=>c.put(u,r)).catch(()=>{}))
 ])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
 e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
 const req=e.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin===location.origin){
  // Apni files: pehle internet se taake update foran milay, na ho to saved copy.
  e.respondWith(fetch(req).then(r=>{
   // Treat HTTP errors like network failures so a previously cached app shell remains usable.
   if(!r||!r.ok)throw new Error('HTTP '+(r&&r.status));
   const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp)).catch(()=>{});
   return r;
  }).catch(()=>caches.match(req).then(m=>m||caches.match('./index.html'))));
 }else if(url.hostname==='www.gstatic.com'||(/^(cdn\.jsdelivr\.net|unpkg\.com)$/.test(url.hostname)&&url.pathname.indexOf('@zxing/library@0.21.3')>=0)){
  // Firebase scripts and the pinned ZXing scanner library: saved copy pehle.
  e.respondWith(caches.match(req).then(m=>m||fetch(req).then(r=>{
   const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp));return r;
  })));
 }
 // Baqi Firebase calls ko Firebase khud sambhalta hai.
});