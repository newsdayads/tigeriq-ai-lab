import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFallbackIssue, renderFallbackPage, readFallbackIssues} from '../api/health-view.mjs';
import {classifyOpenIssue} from '../api/live-status.mjs';

const row = (number,title,body='',labels=[]) => ({
  number,title,body,labels:labels.map(name=>({name})),state:'open',
  html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/'+number,
});

test('GitHub fallback distinguishes five work orders and seven references without guessing workers',()=>{
  const input=[
    row(4902,'[P0][OWNER/VY] Core G6','PRIORITY=P0\nCURRENT_STATE=BLOCKED_G6\nPROGRESS_VERIFIED=true\nPROGRESS_COMPLETED=5\nPROGRESS_TOTAL=6'),
    row(4783,'[P1][NV07] Antigravity','CURRENT_STATE=BLOCKED_S6\nPROGRESS_VERIFIED=true\nPROGRESS_COMPLETED=8\nPROGRESS_TOTAL=10'),
    row(4456,'[P2] TigerIQ News','CURRENT_STATE=WAIT_REVIEW'),
    row(4780,'[P2] REA','CURRENT_STATE=PLANNED\nTIGERIQ_EXECUTABLE=false'),
    row(2293,'[P2] Apify','CURRENT_STATE=EXTERNAL_WAIT'),
    row(280,'[CENTRAL] Hàng đợi'),row(504,'[QUẢN TRỊ] Chính sách'),
    row(1456,'[QUẢN TRỊ] Hợp đồng'),row(497,'[QUẢN TRỊ] Trình duyệt'),
    row(788,'[STATE] Sổ bàn giao'),
    row(4426,'[RESULTS][OWNER] Hộp thư kết quả','RESULT_INBOX=true\nTIGERIQ_EXECUTABLE=false\nRESOURCE_SCOPE=SYSTEM_OWNER_RESULT_INBOX'),
    row(936,'[TÀI NGUYÊN] Danh bạ','RESOURCE_SCOPE=SYSTEM_RESOURCE_CATALOG'),
  ];
  const classified=input.map(classifyFallbackIssue);
  assert.equal(classified.filter(x=>!x.system).length,5);
  assert.equal(classified.filter(x=>x.system).length,7);
  assert.equal(classified.find(x=>x.number===4902).status,'BỊ CHẶN');
  assert.equal(classified.find(x=>x.number===4780).status,'CHỜ / CHƯA SẴN SÀNG');
  const html=renderFallbackPage(input,'2026-10-17T05:25:00+07:00');
  assert.match(html,/CÔNG VIỆC ĐANG MỞ \(5\)/);
  assert.match(html,/HỒ SƠ THAM CHIẾU \(7\)/);
  assert.match(html,/5\/6 mốc/);
  assert.ok(html.indexOf('Core G6')<html.indexOf('Antigravity'));
  assert.ok(html.indexOf('Antigravity')<html.indexOf('TigerIQ News'));
  assert.match(html,/KHÔNG THỂ|Không kết nối được PC01 trực tiếp/);
  assert.doesNotMatch(html,/>ĐANG CHẠY</);
  assert.equal(classifyOpenIssue(input[10]).workKind,'SYSTEM');
  assert.equal(classifyOpenIssue(input[11]).workKind,'SYSTEM');
});

test('GitHub issue HTML text is escaped and URL never taken from untrusted issue',()=>{
  const html=renderFallbackPage([row(3,'[P2] <img src=x onerror=alert(1)>')]);
  assert.ok(!html.includes('<img'));
  assert.match(html,/&lt;img/);
  assert.match(html,/href="https:\/\/github.com\/newsdayads\/tigeriq-ai-lab\/issues\/3"/);
});

test('Unknown fallback source does not imply zero work or live execution',()=>{
  const html=renderFallbackPage(null);
  assert.match(html,/Chưa có dữ liệu danh sách công việc/);
  assert.match(html,/dữ liệu github dự phòng/i);
});

test('GitHub fallback is GET-only, paginated and excludes pull requests',async()=>{
  const seen=[];
  const a=Array.from({length:100},(_,n)=>row(n+1,'[P2] Work '+(n+1)));
  const result=await readFallbackIssues(async(url, init)=>{
    seen.push({url,method:init.method});
    return {ok:true,json:async()=>url.includes('page=1')?a:[row(101,'[P2] Next'), {...row(102,'PR'),pull_request:{url:'a'}}]};
  },'injected_fake_token');
  assert.equal(result.length,101);
  assert.equal(seen.length,2);
  assert.ok(seen.every(x=>x.method==='GET'));
  assert.ok(seen[0].url.includes('page=1') && seen[1].url.includes('page=2'));
});

test('No token and invalid GitHub responses cannot masquerade as complete data',async()=>{
  assert.equal(await readFallbackIssues(async()=>{throw Error('should not fetch')},''),null);
  await assert.rejects(readFallbackIssues(async()=>({ok:false,status:403}), 'sample'),/GITHUB_FALLBACK_HTTP_403/);
});
