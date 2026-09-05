import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const WEB_LOCAL_VERSION_V15 = 'WEB-LOCAL-396-V3.6';
const MAX_BODY_BYTES = 64 * 1024;

export interface OwnerCockpitV15Options {
  cockpitUrl: string;
  host?: string;
  port?: number;
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function copyHeaders(upstream: Response, res: ServerResponse, contentType?: string): void {
  const blocked = new Set(['content-length', 'transfer-encoding', 'connection', 'content-encoding']);
  for (const [key, value] of upstream.headers.entries()) if (!blocked.has(key.toLowerCase())) res.setHeader(key, value);
  if (contentType) res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
}

const BRAND_MARK = `<div class="mark tq36-brand-mark"><svg class="tq36-brand-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v6c0 4.6-2.8 7.7-7 9-4.2-1.3-7-4.4-7-9V6l7-3Z"/><path d="M7.7 9.2 10.4 11 12 9.5l1.6 1.5 2.7-1.8M12 7.2V12M8.8 14.2c2 1.7 4.4 1.7 6.4 0"/></svg></div>`;
const WORK_TAB = `<a href="/?view=work" data-tq-work-tab="persistent"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="m9 10 1.5 1.5L14 8"/><path d="M9 16h6"/></svg><span>Công việc</span></a>`;

function ensureWorkTab(input: string): string {
  if (input.includes('href="/?view=work"')) {
    return input.replace(/<a([^>]*?)href="\/\?view=work"([^>]*)>/, (full, before: string, after: string) => full.includes('data-tq-work-tab=') ? full : `<a${before}href="/?view=work"${after} data-tq-work-tab="persistent">`);
  }
  return input.replace(/(<nav class="nav">[\s\S]*?<\/a>)/, `$1${WORK_TAB}`);
}

export function applyLiveOverviewV36(input: string): string {
  let html = ensureWorkTab(input)
    .replace(/<meta\s+http-equiv=["']refresh["'][^>]*>/gi, '')
    .replace('data-version="WEB-LOCAL-396-V3.5"', `data-version="${WEB_LOCAL_VERSION_V15}" data-refresh="incremental-10s"`)
    .replace('data-theme="fluent-executive-v35"', 'data-theme="fluent-executive-v36"')
    .replace(/<div class="mark">[\s\S]*?<\/div>(?=<div><b>)/, BRAND_MARK);

  const css = `<style id="tq36-live-overview">
.tq36-brand-mark{width:42px!important;height:42px!important;border-radius:13px!important;background:linear-gradient(145deg,#ffbd52,#ff8b16)!important;color:#07182c!important;box-shadow:0 8px 22px rgba(255,145,28,.23),inset 0 1px 0 rgba(255,255,255,.36)!important}.tq36-brand-svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.nav a[href="/?view=work"]{display:flex!important;visibility:visible!important;opacity:1!important}.nav a[href="/?view=work"] .ico{display:block!important;flex:0 0 auto}.nav a[href="/?view=work"] span{visibility:visible!important;opacity:1!important}@media(min-width:761px){.nav a[href="/?view=work"] span{display:inline!important}}
.tq34-avatar{position:relative!important;display:flex!important;align-items:center!important;justify-content:center!important;line-height:1!important;overflow:visible!important;border:2px solid rgba(255,255,255,.18);box-shadow:0 6px 18px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.2)!important}.tq34-avatar::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:1px solid rgba(255,255,255,.08);pointer-events:none}.tq31-people .tq-person{overflow:visible!important}
#tigeriq-management-v31{display:block!important}.tq31-kpis{margin-bottom:12px!important}.tq31-grid{display:none!important}.tq36-columns{display:grid;grid-template-columns:minmax(0,2.15fr) minmax(330px,.9fr);gap:12px;align-items:start}.tq36-left,.tq36-right{display:flex;flex-direction:column;gap:12px;min-width:0}.tq36-left>.tq31-card,.tq36-right>.tq31-chart-stack,.tq36-left>.tq31-section,.tq36-right>.tq31-section{width:100%;margin:0!important}.tq36-left>.tq31-card{height:auto!important;min-height:0!important;align-self:flex-start}.tq36-left .tq31-table{table-layout:fixed;width:100%}.tq36-left .tq31-table th,.tq36-left .tq31-table td{overflow-wrap:break-word;word-break:normal}.tq36-left .tq31-step{margin-bottom:0!important}.tq36-right .tq31-chart-stack{display:flex!important;flex-direction:column;gap:12px!important}.tq34-team-section,.tq34-system-section,.tq34-owner-section,.tq34-rights-section{grid-column:auto!important;align-self:auto!important}.tq34-rights-section{order:20}.tq34-owner-section{order:20}
.tq36-livebox{display:flex;align-items:center;gap:8px;margin-left:auto}.tq36-live-state{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:6px 10px;border:1px solid #285783;border-radius:9px;background:rgba(8,35,66,.88);color:#b9cde1;font-size:12px;white-space:nowrap}.tq36-live-dot{width:8px;height:8px;border-radius:50%;background:#17d894;box-shadow:0 0 0 4px rgba(23,216,148,.1)}.tq36-live-state[data-state="loading"] .tq36-live-dot{background:#29b8ff;animation:tq36pulse .85s infinite alternate}.tq36-live-state[data-state="error"] .tq36-live-dot{background:#ff9f43}.tq36-refresh{width:34px;height:34px;padding:0;border:1px solid #2a5b8c;border-radius:9px;background:#0b2c51;color:#dcecff;display:grid;place-items:center;cursor:pointer;transition:.16s ease}.tq36-refresh:hover{background:#103a69;border-color:#3b82c8;box-shadow:0 6px 16px rgba(0,0,0,.18)}.tq36-refresh:active{transform:translateY(1px)}.tq36-refresh:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}.tq36-refresh svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.tq36-refresh[aria-busy="true"] svg{animation:tq36spin .8s linear infinite}.tq36-flash{animation:tq36flash .75s ease}.tq36-updated{position:relative}.tq36-updated::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(45,200,255,.5);opacity:0;animation:tq36edge .8s ease}
@keyframes tq36spin{to{transform:rotate(360deg)}}@keyframes tq36pulse{to{transform:scale(1.3);opacity:.65}}@keyframes tq36flash{0%{filter:brightness(1)}35%{filter:brightness(1.16)}100%{filter:brightness(1)}}@keyframes tq36edge{0%{opacity:0}35%{opacity:1}100%{opacity:0}}
@media(max-width:1180px){.tq36-columns{grid-template-columns:1fr}.tq36-right{display:grid;grid-template-columns:1fr 1fr;align-items:start}.tq36-right>.tq31-chart-stack{grid-column:1/-1;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px!important}.tq36-right>.tq31-section{min-width:0}}
@media(max-width:860px){.tq36-right,.tq36-right>.tq31-chart-stack{display:flex!important;flex-direction:column}.tq36-live-state span:last-child{display:none}.tq36-livebox{gap:5px}}
</style>`;

  const liveControl = `<div class="tq36-livebox" aria-live="polite"><div class="tq36-live-state" id="tq36-live-state" data-state="ok"><span class="tq36-live-dot"></span><span>Live · 10 giây</span><span id="tq36-live-age">vừa cập nhật</span></div><button class="tq36-refresh" id="tq36-refresh" type="button" title="Cập nhật ngay" aria-label="Cập nhật ngay"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18 12a6 6 0 0 0-10-4L5 11M6 12a6 6 0 0 0 10 4l3-3"/></svg></button></div>`;
  html = html.replace(/(<header class="top">[\s\S]*?<\/div>)(<form class="search")/, `$1${liveControl}$2`);

  const script = `<script id="tq36-live-script">(()=>{const INTERVAL=10000;let busy=false,last=Date.now();const q=(s,r=document)=>r.querySelector(s);const state=()=>q('#tq36-live-state');const age=()=>q('#tq36-live-age');const btn=()=>q('#tq36-refresh');function arrange(){const root=q('#tigeriq-management-v31');if(!root||q(':scope>.tq36-columns',root))return;const grid=q(':scope>.tq31-grid',root);const work=grid&&q(':scope>.tq31-card',grid);const charts=grid&&q(':scope>.tq31-chart-stack',grid);if(!grid||!work||!charts)return;const left=document.createElement('div');const right=document.createElement('div');const cols=document.createElement('div');left.className='tq36-left';right.className='tq36-right';cols.className='tq36-columns';left.append(work);const team=q(':scope>.tq34-team-section',root);const rights=q(':scope>.tq34-rights-section',root);if(team)left.append(team);if(rights)left.append(rights);right.append(charts);const systems=q(':scope>.tq34-system-section',root);const owner=q(':scope>.tq34-owner-section',root);if(systems)right.append(systems);if(owner)right.append(owner);cols.append(left,right);grid.replaceWith(cols)}function current(){return{kpis:q('#tigeriq-management-v31>.tq31-kpis'),work:q('.tq36-left>.tq31-card'),charts:q('.tq36-right>.tq31-chart-stack'),team:q('.tq34-team-section'),systems:q('.tq34-system-section'),owner:q('.tq34-owner-section'),rights:q('.tq34-rights-section')}}function fresh(doc){const root=q('#tigeriq-management-v31',doc);const grid=root&&q(':scope>.tq31-grid',root);return{kpis:root&&q(':scope>.tq31-kpis',root),work:grid&&q(':scope>.tq31-card',grid),charts:grid&&q(':scope>.tq31-chart-stack',grid),team:root&&q(':scope>.tq34-team-section',root),systems:root&&q(':scope>.tq34-system-section',root),owner:root&&q(':scope>.tq34-owner-section',root),rights:root&&q(':scope>.tq34-rights-section',root)}}function sync(cur,next){let changes=0;for(const key of Object.keys(cur)){const a=cur[key],b=next[key];if(a&&b&&a.innerHTML!==b.innerHTML){a.innerHTML=b.innerHTML;a.classList.remove('tq36-flash','tq36-updated');void a.offsetWidth;a.classList.add('tq36-flash','tq36-updated');changes++}}return changes}async function update(){if(busy||document.hidden)return;busy=true;const s=state(),b=btn();if(s)s.dataset.state='loading';if(b)b.setAttribute('aria-busy','true');try{const res=await fetch(location.href,{cache:'no-store',headers:{'X-TigerIQ-Refresh':'incremental'}});if(!res.ok)throw new Error(String(res.status));const text=await res.text();const doc=new DOMParser().parseFromString(text,'text/html');sync(current(),fresh(doc));last=Date.now();if(s)s.dataset.state='ok'}catch{if(s)s.dataset.state='error'}finally{busy=false;if(b)b.removeAttribute('aria-busy')}}function tick(){const el=age();if(!el)return;const sec=Math.max(0,Math.floor((Date.now()-last)/1000));el.textContent=sec<5?'vừa cập nhật':sec+' giây trước'}arrange();q('#tq36-refresh')?.addEventListener('click',update);setInterval(update,INTERVAL);setInterval(tick,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-last>INTERVAL)update()})})();</script>`;
  html = html.replace('</head>', `${css}</head>`).replace('</body>', `${script}</body>`);
  return html;
}

async function proxy(options: OwnerCockpitV15Options, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const upstream = await fetch(`${options.cockpitUrl}${req.url ?? '/'}`, { method: req.method, headers, body: await readBody(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  if (req.method === 'GET' && upstream.ok && upstreamType.includes('text/html')) {
    const html = applyLiveOverviewV36(await upstream.text());
    copyHeaders(upstream, res, 'text/html; charset=utf-8');
    res.statusCode = upstream.status;
    res.end(html);
    return;
  }
  const payload = Buffer.from(await upstream.arrayBuffer());
  copyHeaders(upstream, res);
  res.statusCode = upstream.status;
  res.end(payload);
}

export async function startOwnerCockpitV15(options: OwnerCockpitV15Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const server = createServer(async (req, res) => {
    try { await proxy(options, req, res); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v15_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}