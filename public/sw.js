self.addEventListener('install',()=>self.skipWaiting());

function isLegacyChatUrl(value){
  try{return new URL(value).pathname==='/index.html'}catch{return false}
}
function cameFromCommandCenter(value){
  try{return new URL(value).pathname==='/command-center.html'}catch{return false}
}

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await self.clients.claim();
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  await Promise.all(windows.map(client=>isLegacyChatUrl(client.url)?client.navigate('/command-center.html'):Promise.resolve()));
})()));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  if(event.request.mode==='navigate'&&isLegacyChatUrl(event.request.url)&&!cameFromCommandCenter(event.request.referrer)){
    event.respondWith(Response.redirect(new URL('/command-center.html',event.request.url),302));
    return;
  }
  event.respondWith(fetch(event.request));
});
