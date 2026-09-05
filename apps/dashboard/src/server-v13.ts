import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const WEB_LOCAL_VERSION_V13 = 'WEB-LOCAL-396-V3.4';
const MAX_BODY_BYTES = 64 * 1024;

export interface OwnerCockpitV13Options {
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

function plain(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function executiveIcon(path: string): string {
  return `<svg class="tq34-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

function enhancePeople(html: string): string {
  return html.replace(/<article class="tq-person">([\s\S]*?)<\/article>/g, (full, inner: string) => {
    if (inner.includes('tq34-avatar')) return full;
    const text = plain(inner);
    let initials = 'AI';
    let tone = 'blue';
    if (text.includes('Vy (Trợ lý)')) { initials = 'VY'; tone = 'blue'; }
    else if (text.includes('Minh (NV01')) { initials = 'MI'; tone = 'purple'; }
    else if (text.includes('Khoa (NV02')) { initials = 'KH'; tone = 'green'; }
    else if (text.includes('Huy (NV03')) { initials = 'HU'; tone = 'orange'; }
    else if (text.includes('Khải (NV04')) { initials = 'K'; tone = 'violet'; }
    return `<article class="tq-person tq34-person"><div class="tq34-avatar ${tone}">${initials}</div>${inner}</article>`;
  });
}

function enhanceSystems(html: string): string {
  return html.replace(/<article class="tq-system">([\s\S]*?)<\/article>/g, (full, inner: string) => {
    if (inner.includes('tq34-system-icon')) return full;
    const text = plain(inner);
    const path = /PC01|SERVER/i.test(text)
      ? 'M4 5h16v6H4zM4 14h16v5H4zM8 8h.01M8 16.5h.01M12 8h5M12 16.5h5'
      : /WEB/i.test(text)
        ? 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-18c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3ZM3.5 12h17'
        : 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8';
    return `<article class="tq-system tq34-system"><span class="tq34-system-icon">${executiveIcon(path)}</span>${inner}</article>`;
  });
}

function buildDistribution(html: string): string {
  const match = html.match(/<div class="tq31-segments">([\s\S]*?)<\/div><div class="tq31-legend">([\s\S]*?)<\/div>/);
  if (!match) return html;
  const segmentHtml = match[1];
  const legendHtml = match[2];
  const width = (name: string) => Number(segmentHtml.match(new RegExp(`class="${name}" style="width:(\\d+)%"`))?.[1] ?? 0);
  const values = [...legendHtml.matchAll(/<span><b>(\d+)<\/b>/g)].map((item) => Number(item[1]));
  const total = values.reduce((sum, value) => sum + value, 0);
  const active = width('active');
  const waiting = width('waiting');
  const complete = width('complete');
  const paused = width('paused');
  const activeEnd = active;
  const waitingEnd = active + waiting;
  const completeEnd = waitingEnd + complete;
  const donut = `<div class="tq34-distribution"><div class="tq34-donut" style="background:conic-gradient(var(--fx-green) 0 ${activeEnd}%,var(--fx-orange) ${activeEnd}% ${waitingEnd}%,var(--fx-cyan) ${waitingEnd}% ${completeEnd}%,var(--fx-muted) ${completeEnd}% 100%)"><span><b>${total}</b><small>công việc</small></span></div><div class="tq31-legend">${legendHtml}</div></div>`;
  return html.replace(match[0], donut);
}

function markBottomSections(html: string): string {
  let out = html;
  out = out.replace(/<div class="tq31-section">(?=<article class="tq31-card"><h3>[\s\S]{0,500}?Đội AI<\/h3>)/, '<div class="tq31-section tq34-team-section">');
  out = out.replace(/<div class="tq31-section">(?=<article class="tq31-card"><h3>[\s\S]{0,500}?Hệ thống<\/h3>)/, '<div class="tq31-section tq34-system-section">');
  out = out.replace(/<div class="tq31-section">(?=<article class="tq31-card tq31-owner-event"><h3>[\s\S]{0,500}?Quyền xử lý \/ chuyển giao<\/h3>)/, '<div class="tq31-section tq34-rights-section">');
  return out;
}

function addOwnerHighlight(html: string): string {
  if (html.includes('tq34-owner-highlight')) return html;
  const action = html.match(/(<div class="tq-owner[^>]*>[\s\S]*?<\/div>)/)?.[1] ?? '<div class="tq-owner ok">Không có việc cần anh Sơn</div>';
  const good = /Không có việc|không có việc|Không có/.test(plain(action));
  const card = `<div class="tq31-section tq34-owner-section"><article class="tq31-card tq34-owner-highlight ${good ? 'good' : 'attention'}"><div class="tq34-owner-head"><span>${executiveIcon('M4 5h16v12H9l-5 4V5Zm4 5h8M8 14h5')}</span><h3>Cần anh Sơn</h3></div><div class="tq34-owner-body"><span class="tq34-owner-check">${executiveIcon(good ? 'm6 12 4 4 8-9' : 'M12 8v5M12 17h.01')}</span><div>${action}<small>${good ? 'Mọi thứ đang trong tầm kiểm soát.' : 'Có hạng mục cần anh Sơn xem xét.'}</small></div></div></article></div>`;
  const rights = '<div class="tq31-section tq34-rights-section">';
  return html.includes(rights) ? html.replace(rights, `${card}${rights}`) : html.replace('</section>', `${card}</section>`);
}

export function applyFluentExecutiveV34(input: string): string {
  let html = input
    .replace('data-version="WEB-LOCAL-396-V3.3"', `data-version="${WEB_LOCAL_VERSION_V13}" data-theme="fluent-executive-v34"`)
    .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi, '')
    .replace(/@import\s+url\([^)]*fonts\.googleapis\.com[^)]*\);?/gi, '');

  html = buildDistribution(html);
  html = enhancePeople(html);
  html = enhanceSystems(html);
  html = markBottomSections(html);
  html = addOwnerHighlight(html);

  const css = `<style id="tq34-fluent-executive">
:root{--fx-bg:#061429;--fx-bg2:#071b35;--fx-panel:#0a2140;--fx-panel2:#0b274a;--fx-line:#1b4773;--fx-text:#f5f9ff;--fx-soft:#d8e6f6;--fx-muted:#96abc4;--fx-blue:#2196f3;--fx-cyan:#16c7ff;--fx-green:#13d68f;--fx-orange:#ff9f43;--fx-red:#ff536d;--fx-purple:#7c4dff;--fx-violet:#b34cff}
html,body{background:radial-gradient(circle at 48% -12%,#0d3970 0,#071a34 31%,#041123 70%,#030d1b 100%)!important;color:var(--fx-text)!important;font-family:"Segoe UI",Arial,sans-serif!important;font-size:15px!important;line-height:1.5!important}
body,button,input,select,textarea,table{font-family:"Segoe UI",Arial,sans-serif!important;font-weight:400}.shell{grid-template-columns:158px minmax(0,1fr)!important;min-height:100vh;background:transparent}.sidebar{padding:17px 8px 14px!important;background:linear-gradient(180deg,rgba(6,28,55,.98),rgba(5,21,42,.98))!important;border-right:1px solid #1f4c78!important;box-shadow:14px 0 40px rgba(0,0,0,.12);backdrop-filter:blur(16px)}.brand{padding:0 8px 18px!important;gap:10px!important;border-bottom:1px solid rgba(71,126,181,.22)!important}.mark{width:43px!important;height:43px!important;border-radius:14px!important;background:radial-gradient(circle at 32% 25%,#ffd17d,#ff9e2e 42%,#f17800 100%)!important;box-shadow:0 0 24px rgba(255,150,36,.2)}.mark .ico{width:28px!important;height:28px!important}.brand b{font-size:17px!important;font-weight:650!important;letter-spacing:-.02em}.brand small{font-size:13px!important;color:#a9bdd4!important}.nav{gap:7px!important;margin-top:16px!important}.nav a{min-height:46px;padding:11px 12px!important;border-radius:10px!important;color:#9db2ca!important;font-size:14px!important;font-weight:450!important;transition:.18s ease}.nav a .ico{width:20px!important;height:20px!important;stroke-width:1.7}.nav a:hover{color:#fff!important;background:linear-gradient(90deg,rgba(25,117,219,.3),rgba(16,71,129,.24))!important}.nav a.on,.nav a.on:first-child,.nav a:first-child{color:#fff!important;background:linear-gradient(90deg,#087fe4,#125aa9)!important;box-shadow:inset 3px 0 0 #29c8ff,0 8px 22px rgba(0,114,224,.18)!important}.foot{font-size:13px!important;color:#a8bed6!important;border-top:1px solid rgba(71,126,181,.22)!important;padding:14px 8px!important}.content{padding:16px 18px 30px!important;max-width:1900px;margin:0 auto;width:100%}.top{min-height:58px;margin-bottom:12px!important;padding:0 2px;border-bottom:1px solid rgba(64,120,177,.18)}.top>div:first-child h1{font-size:21px!important;font-weight:620!important;letter-spacing:-.02em}.top>div:first-child p{font-size:13px!important;color:#9fb3ca!important;margin-top:2px!important}.search{min-width:330px;background:linear-gradient(180deg,rgba(17,52,94,.88),rgba(10,34,67,.88))!important;border:1px solid #2c5b91!important;border-radius:10px!important;padding:9px 12px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}.search input{width:280px!important;font-size:14px!important;color:#eaf4ff!important}.search .ico{color:#9fc6ef}
#tigeriq-management-v31{display:grid!important;grid-template-columns:minmax(0,1.45fr) minmax(360px,.75fr);gap:12px;margin:0!important;border:0!important;background:transparent!important;box-shadow:none!important;overflow:visible!important;color:var(--fx-text)!important}#tigeriq-management-v31,#tigeriq-management-v31 *{font-family:"Segoe UI",Arial,sans-serif!important;box-sizing:border-box;line-height:1.45}.tq31-top{display:none!important}.tq31-kpis,.tq31-grid{grid-column:1/-1}.tq31-kpis{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:12px!important;padding:0!important}.tq31-kpi{position:relative;min-height:135px!important;border:1px solid rgba(72,151,226,.6)!important;border-radius:14px!important;padding:15px 16px!important;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.08);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}.tq31-kpi:hover{transform:translateY(-2px);box-shadow:0 15px 34px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.1)}.tq31-kpi:nth-child(1){background:linear-gradient(135deg,#0755b0,#0a83e8)!important;border-color:#118eff!important}.tq31-kpi:nth-child(2){background:linear-gradient(135deg,#3e20a8,#6f32e7)!important;border-color:#784dff!important}.tq31-kpi:nth-child(3){background:linear-gradient(135deg,#087b6d,#08a77e)!important;border-color:#16d7b1!important}.tq31-kpi:nth-child(4){background:linear-gradient(135deg,#78361d,#a75a1c)!important;border-color:#ff9f43!important}.tq31-kpi:nth-child(5){background:linear-gradient(135deg,#087044,#07995b)!important;border-color:#12d882!important}.tq31-kpi:after{content:"";position:absolute;right:-22px;bottom:-38px;width:150px;height:110px;border:1px solid rgba(255,255,255,.11);border-radius:48% 52% 0 0;transform:rotate(-12deg);box-shadow:0 -17px 0 rgba(255,255,255,.025),0 -34px 0 rgba(255,255,255,.018)}.tq31-kpi-head{position:relative;z-index:1;display:flex!important;align-items:center!important;gap:10px!important;color:#fff!important;font-size:15px!important;font-weight:620!important;text-transform:none!important;letter-spacing:0!important}.tq31-kpi-head .tq31-icon{width:37px!important;height:37px!important;padding:8px;border-radius:10px;background:rgba(255,255,255,.13);stroke-width:1.7;box-shadow:inset 0 1px 0 rgba(255,255,255,.13)}.tq31-kpi-value{position:relative;z-index:1;display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:16px!important;color:#fff!important;font-size:17px!important;font-weight:520!important;letter-spacing:-.01em}.tq31-owner-action .tq-owner{font-size:15px!important;color:#fff!important}.tq31-grid{grid-template-columns:minmax(0,2.25fr) minmax(320px,.92fr)!important;gap:12px!important;padding:0!important}.tq31-card{border:1px solid rgba(43,94,145,.82)!important;border-radius:14px!important;background:linear-gradient(180deg,rgba(10,34,65,.97),rgba(7,28,55,.97))!important;box-shadow:0 10px 26px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.025);padding:15px!important}.tq31-card h3{margin:0 0 13px!important;color:#f5f9ff!important;font-size:17px!important;font-weight:620!important;letter-spacing:-.01em}.tq31-card h3 .tq31-icon{width:21px!important;height:21px!important;color:var(--fx-cyan)!important;stroke-width:1.8}.tq31-table{font-size:14px!important;border-collapse:separate!important;border-spacing:0!important;overflow:hidden}.tq31-table thead{background:linear-gradient(180deg,#12355f,#102c4e)}.tq31-table th{padding:10px 11px!important;color:#a9bfd6!important;font-size:12px!important;font-weight:520!important;text-transform:none!important;letter-spacing:0!important;border-bottom:1px solid #24507b!important}.tq31-table td{padding:13px 11px!important;color:#e7f0fb!important;font-size:14px!important;border-bottom:1px solid rgba(41,78,116,.62)!important}.tq31-table tr:last-child td{border-bottom:0!important}.tq31-table tbody tr:hover td{background:rgba(22,74,124,.18)}.tq31-step{margin-top:12px!important;padding:11px 12px!important;border:1px solid rgba(54,111,164,.45);border-radius:10px!important;background:#0d2a4b!important;color:#c5d7ea!important;font-size:13px!important}.tq31-step b{font-weight:600!important;color:#f5f9ff!important}.tq31-chart-stack{gap:12px!important}.tq31-chart-stack .tq31-card{padding:14px!important}.tq34-distribution{display:grid;grid-template-columns:132px minmax(0,1fr);gap:14px;align-items:center}.tq34-donut{width:122px;height:122px;border-radius:50%;display:grid;place-items:center;position:relative;box-shadow:0 0 30px rgba(20,193,255,.08)}.tq34-donut:after{content:"";position:absolute;inset:20px;border-radius:50%;background:#08213f;border:1px solid rgba(78,133,188,.45);box-shadow:inset 0 0 16px rgba(0,0,0,.25)}.tq34-donut>span{position:relative;z-index:1;text-align:center;color:#fff}.tq34-donut b{display:block;font-size:28px;line-height:1!important;font-weight:650}.tq34-donut small{display:block;margin-top:3px;color:#abc2d8;font-size:11px}.tq31-legend{display:grid!important;grid-template-columns:1fr!important;gap:7px!important;margin:0!important;color:#a9bdd3!important;font-size:12px!important}.tq31-legend span{display:flex;align-items:center;gap:5px}.tq31-legend b{min-width:16px;color:#fff!important;font-weight:600}.tq31-bar-row{margin-top:9px!important}.tq31-bar-label{font-size:12px!important;color:#d8e6f6!important}.tq31-bar-label b{color:#a8bdd3!important;font-weight:450!important}.tq31-bar-track{height:9px!important;background:#15375e!important;margin-top:5px!important}.tq31-bar-track i{background:linear-gradient(90deg,#0d8de7,#26c5ff)!important;box-shadow:0 0 10px rgba(27,173,255,.2)}.tq31-system-visual{gap:7px!important}.tq31-system-visual span{min-height:60px;padding:10px!important;border-radius:10px!important;font-size:11px!important;background:rgba(7,29,56,.82)}.tq31-system-visual b{font-size:21px!important;font-weight:620!important}.tq31-system-visual .good{border-color:#118b62!important;background:linear-gradient(135deg,rgba(7,100,67,.52),rgba(6,48,46,.6))}.tq31-system-visual .warn{border-color:#bd762a!important;background:linear-gradient(135deg,rgba(128,69,18,.5),rgba(54,36,25,.65))}.tq31-section{padding:0!important}.tq34-team-section{grid-column:1}.tq34-system-section{grid-column:2}.tq34-owner-section{grid-column:2}.tq34-rights-section{grid-column:1}.tq31-people{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:8px!important}.tq31-people .tq-person{position:relative;min-height:155px;padding:12px 9px!important;text-align:center;border:1px solid #24517f!important;border-radius:11px!important;background:linear-gradient(180deg,#0d2b50,#0a213f)!important;transition:.18s ease}.tq31-people .tq-person:hover{transform:translateY(-2px);border-color:#2b89d9!important;background:linear-gradient(180deg,#123764,#0b284a)!important}.tq34-avatar{width:47px;height:47px;margin:0 auto 9px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:15px;font-weight:650;box-shadow:0 6px 18px rgba(0,0,0,.22)}.tq34-avatar.blue{background:linear-gradient(135deg,#0d8ef1,#32c1ff)}.tq34-avatar.purple{background:linear-gradient(135deg,#6b38e8,#b34dff)}.tq34-avatar.green{background:linear-gradient(135deg,#12a76f,#38db8d)}.tq34-avatar.orange{background:linear-gradient(135deg,#f3863b,#ffb34c)}.tq34-avatar.violet{background:linear-gradient(135deg,#973de8,#d64dff)}.tq31-people .tq-person b{font-size:13px!important;font-weight:580!important;color:#fff}.tq31-people .tq-person small{font-size:12px!important;color:#a7bed5!important;line-height:1.35!important}.tq31-people .tq-badge{margin-top:7px!important;padding:4px 8px!important;font-size:11px!important}.tq31-systems{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important}.tq31-systems .tq-system{display:grid!important;grid-template-columns:42px minmax(0,1fr);gap:9px;align-items:center;min-height:84px;padding:11px!important;border:1px solid #24517f!important;border-radius:11px!important;background:linear-gradient(180deg,#0d2b50,#0a213f)!important}.tq34-system-icon{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#0c62bd,#168ee7);box-shadow:0 5px 16px rgba(0,104,210,.2)}.tq34-system-icon .tq34-icon{width:21px;height:21px}.tq31-systems .tq-system b{font-size:13px!important;font-weight:600!important;color:#fff}.tq31-systems .tq-system small{font-size:11px!important;color:#a9bdd1!important}.tq31-systems .tq-badge{font-size:10px!important;padding:3px 6px!important}.tq34-owner-highlight{min-height:128px!important;border-color:#10c983!important;background:radial-gradient(circle at 90% 100%,rgba(6,220,137,.28),transparent 36%),linear-gradient(135deg,#074334,#075f45)!important;box-shadow:0 0 28px rgba(12,202,130,.13),inset 0 1px 0 rgba(255,255,255,.08)!important}.tq34-owner-highlight.attention{border-color:#e08a2d!important;background:linear-gradient(135deg,#5a351c,#7c451b)!important}.tq34-owner-head{display:flex;align-items:center;gap:8px}.tq34-owner-head>span{color:#21ef9d}.tq34-owner-head .tq34-icon{width:22px;height:22px}.tq34-owner-head h3{margin:0!important}.tq34-owner-body{display:flex;align-items:center;justify-content:center;gap:13px;min-height:76px}.tq34-owner-check{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;color:#fff;background:#16d58b;box-shadow:0 0 24px rgba(33,239,157,.42)}.tq34-owner-check .tq34-icon{width:25px;height:25px}.tq34-owner-body .tq-owner{padding:0!important;border:0!important;background:none!important;color:#fff!important;font-size:14px!important;font-weight:560!important}.tq34-owner-body small{display:block;margin-top:4px;color:#bcefd9;font-size:12px}.tq34-rights-section .tq31-card{min-height:128px}.tq31-owner-event{font-size:12px!important;color:#a9bdd2!important}.tq31-tech{font-size:12px!important;color:#9fb3c8!important}.tq31-tech summary{font-size:13px!important;color:#dce8f5!important}.tq34-icon{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.tq31-button,.assign button,.login button,.system-actions button,.decision-box button{min-height:38px!important;border-radius:9px!important;font-size:13px!important;transition:transform .16s ease,box-shadow .16s ease,filter .16s ease}.tq31-button:hover,.assign button:hover,.login button:hover,.system-actions button:hover,.decision-box button:hover{filter:brightness(1.08);box-shadow:0 8px 20px rgba(0,0,0,.22)}.tq31-button:active,.assign button:active,.login button:active,.system-actions button:active,.decision-box button:active{transform:translateY(1px)}
.panel,.assign,.login,.notice{border-color:#214a74!important;background:linear-gradient(180deg,#0b2342,#091b34)!important;border-radius:13px!important}.panel-head h2{font-size:17px!important;font-weight:600!important}.panel-head span,.panel-head a,.muted-note{font-size:13px!important}.work-head,.ai-head{font-size:13px!important;background:#0f2b4d!important}.work-row,.ai-row{font-size:14px!important;min-height:50px}.work-row>div:first-child span,.ai-row small,.model-item span,.service span,.setting span,.setting small,.report-grid span,.report-grid small{font-size:13px!important}.badge{font-size:12px!important}.model-item,.service,.setting,.report-grid article,.detail-grid>div,.goal,.source,.decision-box{background:#0a2341!important;border-color:#214b76!important}.ico,.tq31-icon,.tq34-icon{stroke-width:1.75}
@media(max-width:1350px){.shell{grid-template-columns:142px minmax(0,1fr)!important}.tq31-kpis{grid-template-columns:repeat(3,1fr)!important}.tq31-kpi:nth-child(4),.tq31-kpi:nth-child(5){min-height:118px!important}.tq31-grid{grid-template-columns:1fr!important}.tq34-team-section,.tq34-system-section,.tq34-owner-section,.tq34-rights-section{grid-column:1/-1}.tq31-systems{grid-template-columns:repeat(3,1fr)!important}}
@media(max-width:980px){.shell{grid-template-columns:82px 1fr!important}.brand div:last-child,.nav span,.foot span{display:none!important}.brand{justify-content:center!important;padding:0 0 14px!important}.nav a{justify-content:center!important}.content{padding:12px!important}.tq31-kpis{grid-template-columns:repeat(2,1fr)!important}.tq31-people{grid-template-columns:repeat(3,1fr)!important}.search{min-width:250px}.search input{width:210px!important}}
@media(max-width:760px){.shell{display:block!important}.sidebar{position:sticky!important;top:0!important;z-index:30!important;width:100%!important;height:auto!important;display:flex!important;flex-direction:row!important;padding:7px 9px!important}.brand{border:0!important;margin-right:8px!important}.mark{width:38px!important;height:38px!important}.nav{display:flex!important;margin:0!important;overflow:auto!important}.nav a{min-height:40px!important;padding:8px 10px!important}.content{padding:10px!important}.top{align-items:flex-start!important;gap:8px!important}.top>div:first-child p{display:none}.search{min-width:0!important}.search input{width:145px!important}.tq31-kpis{grid-template-columns:1fr!important}.tq31-kpi{min-height:112px!important}.tq31-people,.tq31-systems,.tq31-system-visual{grid-template-columns:1fr 1fr!important}.tq34-distribution{grid-template-columns:110px 1fr}.tq34-donut{width:100px;height:100px}.tq31-table td{font-size:13px!important}}
@media(max-width:500px){.top>div:first-child{display:none}.search{width:100%}.search input{width:100%!important}.tq31-people,.tq31-systems,.tq31-system-visual{grid-template-columns:1fr!important}.tq34-distribution{grid-template-columns:1fr;justify-items:center}.tq31-legend{width:100%}.tq34-owner-body{justify-content:flex-start}}
</style>`;
  html = html.replace('</head>', `${css}</head>`);
  html = html.replace('<body', '<body data-visual-spec="fluent-executive-mockup"');
  return html;
}

async function proxy(options: OwnerCockpitV13Options, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const upstream = await fetch(`${options.cockpitUrl}${req.url ?? '/'}`, { method: req.method, headers, body: await readBody(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  if (req.method === 'GET' && upstream.ok && upstreamType.includes('text/html')) {
    const html = applyFluentExecutiveV34(await upstream.text());
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

export async function startOwnerCockpitV13(options: OwnerCockpitV13Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const server = createServer(async (req, res) => {
    try { await proxy(options, req, res); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v13_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
