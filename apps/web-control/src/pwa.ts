export const pwaManifest=JSON.stringify({
  name:'TigerIQ AI Lab — Web Control Center',
  short_name:'TigerIQ',
  description:'PC01 control plane for TigerIQ AI Lab',
  start_url:'/',
  scope:'/',
  display:'standalone',
  background_color:'#050a11',
  theme_color:'#07111d',
  orientation:'any',
  icons:[{src:'/pwa-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]
});

export const pwaIcon=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#23dcff"/><stop offset=".55" stop-color="#4e72ff"/><stop offset="1" stop-color="#9b78ff"/></linearGradient></defs><rect width="512" height="512" rx="118" fill="#07111d"/><rect x="58" y="58" width="396" height="396" rx="96" fill="url(#g)"/><path d="M142 154h228v62h-79v166h-70V216h-79z" fill="#fff"/><path d="M310 272h60v110h-60z" fill="#dffaff"/></svg>`;

export const pwaRegister=`(()=>{if(!('serviceWorker' in navigator))return;window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});});})();`;

export const serviceWorker=`const STATIC='tigeriq-pwa-static-v1';
const ALLOWED=new Set(['/manifest.webmanifest','/pwa-icon.svg','/pwa-register.js']);
self.addEventListener('install',event=>{event.waitUntil(caches.open(STATIC).then(cache=>cache.addAll([...ALLOWED])).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==STATIC).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin){return;}
  if(ALLOWED.has(url.pathname)){event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));return;}
  // Operational HTML, sessions, CSRF tokens, API state, goals and controls are always network-only.
  event.respondWith(fetch(event.request));
});`;
