import { BCCT_SECTIONS, publishBcctV4 } from '../../shared/bcct-v4-contract.mjs';

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
export function renderBcctV4(summary, filter, repo) {
  const report=buildBcctReport(summary,filter,repo);
  let html=null;
  const verdict=publishBcctV4(report,validated=>{
    const nav=FILTERS.map(f=>`<a class="filter" href="/bcct?filter=${encodeURIComponent(f)}" aria-current="${f===filter?'page':'false'}">${esc(f)}</a>`).join('');
    const cards=validated.sections.map((s,i)=>`<section class="card"><h2>${i+1}. ${esc(s.title)}</h2><p>${esc(s.text)}</p></section>`).join('');
    const jobs=validated.jobs.map(j=>`<li><a href="${esc(j.url)}">#${j.issue} — ${esc(j.title)}</a></li>`).join('') || '<li>Không có mã GitHub được xác minh trong nguồn lọc.</li>';
    const rdc=validated.rdc.map(a=>`<li>${esc(a.account)}: CHƯA XÁC MINH — PC01 và hạn mức chưa được kết nối vào nguồn này</li>`).join('');
    html=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BCCT V4 - TigerIQ</title><style>body{font:16px system-ui;margin:0;background:#f4f7fc;color:#172843}main{max-width:900px;margin:auto;padding:18px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.filter{padding:10px 12px;background:#fff;border:1px solid #cad6e9;border-radius:9px;color:#154374;text-decoration:none}[aria-current=page]{background:#d8eafb;font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.card{padding:16px;background:white;border-radius:14px;box-shadow:0 1px 4px #d4deee}h1{font-size:26px}h2{font-size:17px}li{padding:6px}footer{margin-top:20px;color:#465a76}</style></head><body><main><h1>BCCT — TigerIQ V4</h1><p>Nguồn dữ liệu: ${esc(validated.generatedAt)} · Chỉ phản ánh nguồn đã truy xuất</p><nav aria-label="Lọc công việc">${nav}</nav><div class="grid">${cards}</div><section class="card"><h2>Hồ sơ GitHub</h2><ul>${jobs}</ul></section><section class="card"><h2>RDC 5 tài khoản</h2><ul>${rdc}</ul></section><footer>Không có dữ liệu RDC trực tiếp trong ứng dụng này; không giả kết nối hoặc hạn mức.</footer></main></body></html>`;
  });
  return verdict.published ? {ok:true,html} : {ok:false,errors:verdict.errors};
}
