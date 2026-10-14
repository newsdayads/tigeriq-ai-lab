import { BCCT_SECTIONS, publishBcctV4 } from '../../shared/bcct-v4-contract.mjs';
import { projectOwnerWorkCardV6 } from '../../shared/owner-interaction-v6.mjs';

const FILTERS = ['Tất cả', 'Chưa xong', 'P0', 'Đã xong'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function extractIssue(id) {
  const match = String(id).match(/(?:^|[/-])(?:GH-)?(\d{1,8})$/);
  return match ? Number(match[1]) : null;
}
export function buildBcctReport(summary, filter='Tất cả', repo='newsdayads/tigeriq-ai-lab') {
  const all = Array.isArray(summary.workOrders) ? summary.workOrders : [];
  const selected = FILTERS.includes(filter) ? filter : 'Tất cả';
  const matches = all.filter(j=>selected==='Tất cả' || (selected==='Đã xong' ? j.status==='verified' :
    selected==='Chưa xong' ? j.status!=='verified' : /(?:^|\b)P0(?:\b|\])/i.test(j.goal || '')));
  const jobs = matches.map(j=>{const issue=extractIssue(j.id);return issue?{issue,title:j.goal || 'Không rõ tên việc',url:`https://github.com/${repo}/issues/${issue}`}:null}).filter(Boolean);
  const sections = [
    `Dữ liệu nguồn nội bộ tại ${summary.generatedAt}; ${all.length} việc trong nguồn hiện tại. Không suy diễn thành tổng toàn dự án.`,
    `${matches.length} việc khớp bộ lọc ${selected}; chỉ mở liên kết GitHub có mã hợp lệ.`,
    'Chưa xác minh riêng hàng đợi P0 toàn hệ thống từ nguồn này.',
    'Trạng thái công việc nội bộ không chứng minh nhân sự đang chạy trực tiếp.',
    'Chưa xác minh trực tiếp tình trạng nhân sự AI.',
    'Rà soát nguồn GitHub, kiểm chứng các cổng kỹ thuật và nghiệm thu máy thực tế.',
  ];
  return {
    sections:BCCT_SECTIONS.map((title,i)=>({title,text:sections[i]})),
    generatedAt:summary.generatedAt,
    sourceUrl:`https://github.com/${repo}`,
    dataVerified:false,completionPercent:null,status:'CHƯA XÁC MINH',
    filters:{mode:'interactive',options:FILTERS,onSelect:(next)=>`/bcct?filter=${encodeURIComponent(next)}`},
    jobs,rdc:Array.from({length:5},(_,i)=>({account:`RDC0${i+1}`,pc01:'CHƯA XÁC MINH',remainingPct:null})),
    rdcCheckedAt:null,rdcPreferredAccount:null,
  };
}
function buildV6Jobs(summary,validated,filter) {
  return validated.jobs.map(j=>{
    const sourceRow=(summary.workOrders||[]).find(w=>extractIssue(w.id)===j.issue)||{};
    const status=sourceRow.status==='verified'?'DONE':sourceRow.status==='blocked'?'BLOCKED':
      sourceRow.status==='working'?'WORKING':sourceRow.status==='waiting'?'WAITING':'READY';
    const result=projectOwnerWorkCardV6({
      id:'GH-'+j.issue,title:j.title,issueUrl:j.url,
      priority:(String(j.title).match(/\bP[0-5]\b/)||[])[0]||null,status,
      acceptanceVerified:sourceRow.acceptanceVerified===true,
      progress:sourceRow.progress,runtime:sourceRow.runtime,
      blocker:sourceRow.blocker,nextAction:sourceRow.nextAction,
    },{fresh:summary.sourceFresh===true,verified:summary.sourceVerified===true,
      checkedAt:summary.generatedAt});
    if(!result.ok)return '';
    const c=result.card;
    const bar=c.progress.percent===null?'':`<div class="v6-track" role="progressbar" aria-label="Tiến độ ${esc(c.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${c.progress.percent}"><span style="width:${c.progress.percent}%"></span></div>`;
    const extra=[c.blocker&&`<p><strong>ĐIỂM CHẶN:</strong> ${esc(c.blocker)}</p>`,
      c.nextAction&&`<p><strong>BƯỚC TIẾP:</strong> ${esc(c.nextAction)}</p>`].filter(Boolean).join('');
    return `<li class="v6-item"><details><summary><strong>#${j.issue} — ${esc(c.title)}</strong><small class="v6-state v6-${esc(c.state.color)}">${esc(c.state.label)}</small></summary><p class="v6-progress">${esc(c.progress.label)}</p>${bar}${extra}<div class="v6-buttons"><a href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">HỒ SƠ</a><a href="/bcct?filter=${encodeURIComponent(filter||'Tất cả')}">TẢI LẠI TRANG</a></div></details></li>`;
  }).join('') || '<li>Không có mã GitHub được xác minh trong nguồn lọc.</li>';
}
export function renderBcctV4(summary, filter, repo) {
  const report=buildBcctReport(summary,filter,repo);
  let html=null;
  const verdict=publishBcctV4(report,validated=>{
    const nav=FILTERS.map(f=>`<a class="filter" href="/bcct?filter=${encodeURIComponent(f)}" aria-current="${f===filter?'page':'false'}">${esc(f)}</a>`).join('');
    const cards=validated.sections.map((s,i)=>`<section class="card"><h2>${i+1}. ${esc(s.title)}</h2><p>${esc(s.text)}</p></section>`).join('');
    const jobs=buildV6Jobs(summary,validated,filter);
    const rdc=validated.rdc.map(a=>`<li>${esc(a.account)}: CHƯA XÁC MINH — PC01 và hạn mức chưa được kết nối vào nguồn này</li>`).join('');
    html=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BCCT V4 - TigerIQ</title><style>body{font:16px system-ui;margin:0;background:#f4f7fc;color:#172843}main{max-width:900px;margin:auto;padding:18px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.filter{padding:10px 12px;background:#fff;border:1px solid #cad6e9;border-radius:9px;color:#154374;text-decoration:none}[aria-current=page]{background:#d8eafb;font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.card{padding:16px;background:white;border-radius:14px;box-shadow:0 1px 4px #d4deee}.v6-item{list-style:none;margin:8px 0;padding:10px;border:1px solid #cbd5e1;border-radius:12px;min-width:0}.v6-item summary{cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}.v6-item strong{overflow-wrap:anywhere}.v6-item summary:focus-visible,.v6-buttons a:focus-visible{outline:3px solid #317dcc;outline-offset:2px}.v6-state{border-radius:8px;padding:3px 7px;font-weight:700;font-size:12px}.v6-success{background:#d6f4e5;color:#11653a}.v6-info{background:#d8edff;color:#104987}.v6-warning{background:#fff0c4;color:#764c09}.v6-danger{background:#ffe0e0;color:#8b1b1b}.v6-secondary{background:#e9eef4;color:#425269}.v6-progress{margin:10px 0 4px;color:#425269}.v6-track{height:8px;border-radius:5px;overflow:hidden;background:#dbe4ee}.v6-track span{display:block;height:100%;background:#2874bb}.v6-buttons{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.v6-buttons a{display:inline-block;text-decoration:none;border-radius:9px;border:1px solid #9bb7d5;padding:9px 12px;color:#123d70;background:#edf6ff}@media(max-width:460px){main{padding:12px}.card{padding:12px}.v6-item summary{align-items:start}.v6-buttons a{flex:1;text-align:center;min-width:0}}@media(prefers-reduced-motion:reduce){.v6-item *,nav *{transition:none!important;animation:none!important}}h1{font-size:26px}h2{font-size:17px}li{padding:6px}footer{margin-top:20px;color:#465a76}</style></head><body><main><h1>BCCT — TigerIQ V4</h1><p>Nguồn dữ liệu: ${esc(validated.generatedAt)} · Chỉ phản ánh nguồn đã truy xuất</p><nav aria-label="Lọc công việc">${nav}</nav><div class="grid">${cards}</div><section class="card"><h2>Hồ sơ GitHub</h2><ul>${jobs}</ul></section><section class="card"><h2>RDC 5 tài khoản</h2><ul>${rdc}</ul></section><footer>Không có dữ liệu RDC trực tiếp trong ứng dụng này; không giả kết nối hoặc hạn mức.</footer></main></body></html>`;
  });
  return verdict.published ? {ok:true,html} : {ok:false,errors:verdict.errors};
}
