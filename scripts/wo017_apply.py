from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)


control_path = Path('api/control.mjs')
control = control_path.read_text(encoding='utf-8')

issue_stage_anchor = """export function issueStage(issue, comments = []) {\n  const evidence = issueEvidenceSummary(comments);\n  if (evidence.failed) return 'failed';\n  if (issue?.state === 'closed' && ['not_planned', 'duplicate'].includes(String(issue?.state_reason || ''))) return 'cancelled';\n  if (evidence.result || issue?.state === 'closed') return 'completed';\n  if (evidence.claimed) return 'claimed';\n  return 'queued';\n}\n"""
issue_stage_new = issue_stage_anchor + """
export function issuePriority(issue) {
  const body = String(issue?.body || '');
  const field = body.match(/(?:^|\\n)## Priority\\s*\\n\\s*(P[012])\\s*(?:\\n|$)/i);
  if (field) return field[1].toUpperCase();
  const title = String(issue?.title || '');
  const titleMatch = title.match(/(?:^|[^A-Z0-9])(P[012])(?:[^A-Z0-9]|$)/i);
  return titleMatch ? titleMatch[1].toUpperCase() : null;
}

export function issueType(issue) {
  const body = String(issue?.body || '');
  if (body.includes('TIGERIQ_COMMAND_V1')) return 'command';
  if (body.includes('TIGERIQ_JOB_V1')) return 'work-order';
  return 'unknown';
}

export function workItemSummary(issue, comments = [], nowMs = Date.now()) {
  const stage = issueStage(issue, comments);
  const evidence = issueEvidenceSummary(comments);
  const updatedAt = issue?.updated_at || issue?.updatedAt || null;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const ageMinutes = Number.isFinite(updatedMs) ? Math.max(0, Math.floor((nowMs - updatedMs) / 60000)) : null;
  const stale = (stage === 'queued' || stage === 'claimed') && ageMinutes !== null && ageMinutes >= 30;
  return {
    number: Number(issue?.number || 0),
    title: String(issue?.title || ''),
    state: String(issue?.state || 'unknown'),
    stateReason: issue?.state_reason || null,
    stage,
    priority: issuePriority(issue),
    type: issueType(issue),
    url: issue?.html_url || issue?.url || null,
    updatedAt,
    ageMinutes,
    stale,
    evidence,
  };
}
"""
control = replace_once(control, issue_stage_anchor, issue_stage_new, 'work item helpers')

identity_anchor = "async function githubIdentity(token) {\n"
board_function = """async function workBoard(token = '') {
  const { owner, repo } = repoParts();
  const [issues, comments] = await Promise.all([
    gh(`/repos/${owner}/${repo}/issues?state=all&per_page=50&sort=updated&direction=desc`, {}, token),
    gh(`/repos/${owner}/${repo}/issues/comments?per_page=100&sort=updated&direction=desc`, {}, token).catch(() => []),
  ]);
  const commentsByIssue = new Map();
  for (const comment of Array.isArray(comments) ? comments : []) {
    const match = String(comment?.issue_url || '').match(/\\/issues\\/(\\d+)$/);
    if (!match) continue;
    const number = Number(match[1]);
    const rows = commentsByIssue.get(number) || [];
    rows.push(comment);
    commentsByIssue.set(number, rows);
  }
  const markerIssues = (Array.isArray(issues) ? issues : [])
    .filter((item) => !item.pull_request && typeof item.body === 'string' && (item.body.includes('TIGERIQ_JOB_V1') || item.body.includes('TIGERIQ_COMMAND_V1')))
    .slice(0, 20);
  const nowMs = Date.now();
  const items = markerIssues.map((item) => workItemSummary(item, commentsByIssue.get(item.number) || [], nowMs));
  const count = (stage) => items.filter((item) => item.stage === stage).length;
  return {
    ok: true,
    generatedAt: new Date(nowMs).toISOString(),
    policy: { staleMinutes: 30, issueLimit: 20, commentLimit: 100, mutation: false },
    summary: {
      total: items.length,
      active: items.filter((item) => item.stage === 'queued' || item.stage === 'claimed').length,
      queued: count('queued'),
      claimed: count('claimed'),
      completed: count('completed'),
      failed: count('failed'),
      cancelled: count('cancelled'),
      stale: items.filter((item) => item.stale).length,
    },
    items,
  };
}

""" + identity_anchor
control = replace_once(control, identity_anchor, board_function, 'work board function')
control = replace_once(control, "      explicitDispatch: true,\n", "      explicitDispatch: true,\n      workBoard: true,\n", 'work board capability')
control = replace_once(control, "    if (operation === 'work-order-status') return json(res, 200, await workOrderStatus(payload, optionalToken));\n", "    if (operation === 'work-order-status') return json(res, 200, await workOrderStatus(payload, optionalToken));\n    if (operation === 'work-board') return json(res, 200, await workBoard(optionalToken));\n", 'work board operation')
control_path.write_text(control, encoding='utf-8')

index_path = Path('public/index.html')
index = index_path.read_text(encoding='utf-8')
old_show = "async function showWork(){const rows=loadTracked();if(!rows.length){addBubble('Phiên này chưa có công việc nào được theo dõi. Hàng đợi hệ thống vẫn xem được ở Xem trạng thái.','assistant','TigerIQ AI · công việc');await refresh(false);return}await pollTracked(true)}"
new_show = """function ageLabel(minutes){if(minutes===null||minutes===undefined)return 'không rõ tuổi';if(minutes<60)return `${minutes} phút`;const hours=Math.floor(minutes/60);if(hours<24)return `${hours} giờ`;return `${Math.floor(hours/24)} ngày`}
async function showWork(){try{const d=await api({operation:'work-board'});const s=d.summary||{};const lines=[`Work Board · ${s.active||0} đang hoạt động · ${s.stale||0} cần chú ý · ${s.completed||0} hoàn tất gần đây`];const items=Array.isArray(d.items)?d.items:[];if(!items.length)lines.push('Chưa có Work Order/command trong phạm vi gần đây.');else items.slice(0,10).forEach(x=>lines.push(`#${x.number} · ${x.priority||'—'} · ${stageText[x.stage]||x.stage} · ${ageLabel(x.ageMinutes)}${x.stale?' · ⚠ cần chú ý':''} · ${x.title}`));const b=addBubble(lines.join('\\n'),'assistant','TigerIQ AI · Work Board · GitHub evidence');items.slice(0,5).forEach(x=>{if(!x.url)return;const a=document.createElement('a');a.href=x.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Mở #'+x.number;a.style.display='inline-block';a.style.margin='8px 12px 0 0';b.append(a)})}catch(e){addBubble('Chưa tải được Work Board: '+(e.details||e.message),'assistant','TigerIQ AI · Work Board')}}"""
index = replace_once(index, old_show, new_show, 'system work board UI')
old_ai_error = "addBubble('Não AI hiện chưa sẵn sàng nên em không tự biến câu này thành Work Order. Em sẽ giữ fail-safe cho tới khi kênh GPT hoạt động đúng.','assistant','TigerIQ AI')"
new_ai_error = "addBubble('Não AI hiện chưa sẵn sàng nên em không tự biến câu này thành Work Order. Nếu cần thực thi ngay, bấm Giao việc để tạo Work Order trực tiếp không dùng GPT.','assistant','TigerIQ AI')"
index = replace_once(index, old_ai_error, new_ai_error, 'AI failure direct-mode hint')
index_path.write_text(index, encoding='utf-8')

verify_path = Path('scripts/verify_queue_hygiene.mjs')
verify = verify_path.read_text(encoding='utf-8')
verify = replace_once(verify, "import { normalizeInstruction, workFingerprint, issueStage, issueEvidenceSummary } from '../api/control.mjs';", "import { normalizeInstruction, workFingerprint, issueStage, issueEvidenceSummary, issuePriority, issueType, workItemSummary } from '../api/control.mjs';", 'helper imports')
verify_anchor = "assert.deepEqual(issueEvidenceSummary([{ body: 'TIGERIQ_JOB_CLAIMED\\nREVIEW_PASS' }, { body: 'TIGERIQ_JOB_RESULT PASS\\nJUDGE_PASS' }]), { claimed: true, result: true, failed: false, reviewPass: true, judgePass: true });\n"
verify_extra = verify_anchor + """
const boardIssue = {
  number: 77,
  title: '[P0] [TigerIQ AI] Work Board sample',
  body: 'TIGERIQ_JOB_V1\\n\\n## Priority\\nP0',
  state: 'open',
  state_reason: null,
  updated_at: '2026-08-30T12:00:00.000Z',
  html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/77',
};
assert.equal(issuePriority(boardIssue), 'P0');
assert.equal(issueType(boardIssue), 'work-order');
const boardSummary = workItemSummary(boardIssue, [{ body: 'TIGERIQ_JOB_CLAIMED\\nREVIEW_PASS' }], Date.parse('2026-08-30T13:00:00.000Z'));
assert.equal(boardSummary.stage, 'claimed');
assert.equal(boardSummary.ageMinutes, 60);
assert.equal(boardSummary.stale, true);
assert.equal(boardSummary.evidence.reviewPass, true);
assert.equal(Object.hasOwn(boardSummary, 'body'), false);
assert.equal(Object.hasOwn(boardSummary, 'comments'), false);
"""
verify = replace_once(verify, verify_anchor, verify_extra, 'work board helper tests')
verify_path.write_text(verify, encoding='utf-8')

Path('scripts/verify_work_board_ui.mjs').write_text("""import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync('public/index.html', 'utf8');
assert.match(html, /id=\"quickWork\"/);
assert.match(html, /operation:'work-board'/);
assert.match(html, /TigerIQ AI · Work Board · GitHub evidence/);
assert.match(html, /Giao việc để tạo Work Order trực tiếp không dùng GPT/);
console.log('WO017_WORK_BOARD_UI_PASS');
""", encoding='utf-8')

workflow_path = Path('.github/workflows/wo014-queue-hygiene.yml')
workflow = workflow_path.read_text(encoding='utf-8')
workflow = replace_once(workflow, "      - name: Verify deterministic queue hygiene\n        run: node scripts/verify_queue_hygiene.mjs\n      - name: Existing build gate\n", "      - name: Verify deterministic queue hygiene\n        run: node scripts/verify_queue_hygiene.mjs\n      - name: Verify Work Board UI\n        run: node scripts/verify_work_board_ui.mjs\n      - name: Existing build gate\n", 'persistent Work Board gate')
workflow_path.write_text(workflow, encoding='utf-8')

print('WO017_PATCH_APPLIED')
