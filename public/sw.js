self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  if(event.request.mode==='navigate'){
    try{
      const url=new URL(event.request.url);
      if(['/index.html','/command-center.html','/workforce.html','/operations.html'].includes(url.pathname)){
        event.respondWith(Response.redirect(new URL('/web-v1/',event.request.url),302));
        return;
      }
    }catch{}
  }
  event.respondWith(fetch(event.request));
});
