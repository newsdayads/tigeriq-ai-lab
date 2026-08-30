from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)


control_path = Path('api/control.mjs')
control = control_path.read_text(encoding='utf-8')
old_lifecycle = """export function issueEvidenceSummary(comments = []) {\n  const bodies = Array.isArray(comments) ? comments.map((x) => String(x?.body || x || '')) : [];\n  return {\n    claimed: bodies.some((x) => x.includes('TIGERIQ_PC01_CLAIMED') || x.includes('TIGERIQ_JOB_CLAIMED') || x.includes('TIGERIQ_COMMAND_CLAIMED')),\n    result: bodies.some((x) => x.includes('TIGERIQ_PC01_DONE') || x.includes('TIGERIQ_PC01_RESULT') || x.includes('TIGERIQ_JOB_DONE') || x.includes('TIGERIQ_JOB_RESULT') || x.includes('TIGERIQ_COMMAND_RESULT')),\n    failed: bodies.some((x) => x.includes('TIGERIQ_PC01_FAILED') || x.includes('TIGERIQ_JOB_FAILED') || x.includes('TIGERIQ_COMMAND_FAILED')),\n    reviewPass: bodies.some((x) => x.includes('REVIEW_PASS')),\n    judgePass: bodies.some((x) => x.includes('JUDGE_PASS')),\n  };\n}\n\nexport function issueStage(issue, comments = []) {\n  const evidence = issueEvidenceSummary(comments);\n  if (evidence.failed) return 'failed';\n  if (issue?.state === 'closed' && ['not_planned', 'duplicate'].includes(String(issue?.state_reason || ''))) return 'cancelled';\n  if (evidence.result || issue?.state === 'closed') return 'completed';\n  if (evidence.claimed) return 'claimed';\n  return 'queued';\n}\n"""
new_lifecycle = """const LIFECYCLE_MARKERS = new Map([\n  ['TIGERIQ_PC01_CLAIMED', 'claimed'],\n  ['TIGERIQ_JOB_CLAIMED', 'claimed'],\n  ['TIGERIQ_COMMAND_CLAIMED', 'claimed'],\n  ['TIGERIQ_PC01_DONE', 'completed'],\n  ['TIGERIQ_PC01_RESULT', 'completed'],\n  ['TIGERIQ_JOB_DONE', 'completed'],\n  ['TIGERIQ_JOB_RESULT', 'completed'],\n  ['TIGERIQ_COMMAND_RESULT', 'completed'],\n  ['TIGERIQ_PC01_FAILED', 'failed'],\n  ['TIGERIQ_JOB_FAILED', 'failed'],\n  ['TIGERIQ_COMMAND_FAILED', 'failed'],\n]);\n\nfunction exactMarkerLines(body) {\n  return String(body || '')\n    .split(/\\r?\\n/)\n    .map((line) => line.trim())\n    .filter(Boolean);\n}\n\nfunction lifecycleMarker(line) {\n  const first = String(line || '').split(/\\s+/, 1)[0];\n  return LIFECYCLE_MARKERS.has(first) ? first : null;\n}\n\nexport function lifecycleEvents(comments = []) {\n  const rows = Array.isArray(comments) ? comments : [];\n  const events = [];\n  rows.forEach((comment, commentIndex) => {\n    const body = typeof comment === 'string' ? comment : String(comment?.body || '');\n    const createdAt = typeof comment === 'string' ? null : (comment?.created_at || comment?.createdAt || null);\n    const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;\n    exactMarkerLines(body).forEach((line, lineIndex) => {\n      const marker = lifecycleMarker(line);\n      if (!marker) return;\n      events.push({\n        stage: LIFECYCLE_MARKERS.get(marker),\n        marker,\n        createdAt,\n        timestamp: Number.isFinite(timestamp) ? timestamp : null,\n        commentIndex,\n        lineIndex,\n      });\n    });\n  });\n  return events.sort((a, b) => {\n    if (a.timestamp !== null && b.timestamp !== null && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;\n    if (a.timestamp !== null && b.timestamp === null) return -1;\n    if (a.timestamp === null && b.timestamp !== null) return 1;\n    if (a.commentIndex !== b.commentIndex) return a.commentIndex - b.commentIndex;\n    return a.lineIndex - b.lineIndex;\n  });\n}\n\nexport function latestLifecycleStage(comments = []) {\n  const events = lifecycleEvents(comments);\n  return events.length ? events[events.length - 1].stage : null;\n}\n\nexport function issueEvidenceSummary(comments = []) {\n  const rows = Array.isArray(comments) ? comments : [];\n  const events = lifecycleEvents(rows);\n  const stages = new Set(events.map((event) => event.stage));\n  const lines = rows.flatMap((comment) => exactMarkerLines(typeof comment === 'string' ? comment : comment?.body));\n  return {\n    claimed: stages.has('claimed'),\n    result: stages.has('completed'),\n    failed: stages.has('failed'),\n    reviewPass: lines.includes('REVIEW_PASS'),\n    judgePass: lines.includes('JUDGE_PASS'),\n  };\n}\n\nexport function issueStage(issue, comments = []) {\n  if (issue?.state === 'closed' && ['not_planned', 'duplicate'].includes(String(issue?.state_reason || ''))) return 'cancelled';\n  if (issue?.state === 'closed') return 'completed';\n  return latestLifecycleStage(comments) || 'queued';\n}\n"""
control = replace_once(control, old_lifecycle, new_lifecycle, 'retry-safe lifecycle helpers')
old_pc = """  const bodies = Array.isArray(comments) ? comments.map((x) => String(x.body || '')) : [];\n  const claimed = bodies.some((x) => x.includes('TIGERIQ_PC01_CLAIMED'));\n  const terminal = bodies.some((x) => x.includes('TIGERIQ_PC01_DONE') || x.includes('TIGERIQ_PC01_RESULT'));\n  const failed = bodies.some((x) => x.includes('TIGERIQ_PC01_FAILED'));\n  const pc01 = terminal ? 'online' : claimed ? 'working' : failed ? 'degraded' : 'offline';\n"""
new_pc = """  const canaryStage = issueStage(canary, comments);\n  const pc01 = canaryStage === 'completed' ? 'online' : canaryStage === 'claimed' ? 'working' : canaryStage === 'failed' ? 'degraded' : 'offline';\n"""
control = replace_once(control, old_pc, new_pc, 'PC01 shared lifecycle classifier')
control_path.write_text(control, encoding='utf-8')

verify_path = Path('scripts/verify_queue_hygiene.mjs')
verify = verify_path.read_text(encoding='utf-8')
verify = replace_once(
    verify,
    "import { normalizeInstruction, workFingerprint, issueStage, issueEvidenceSummary, issuePriority, issueType, workItemSummary } from '../api/control.mjs';",
    "import { normalizeInstruction, workFingerprint, issueStage, issueEvidenceSummary, issuePriority, issueType, workItemSummary, lifecycleEvents, latestLifecycleStage } from '../api/control.mjs';",
    'lifecycle test imports',
)
anchor = "assert.deepEqual(issueEvidenceSummary([{ body: 'TIGERIQ_JOB_CLAIMED\\nREVIEW_PASS' }, { body: 'TIGERIQ_JOB_RESULT PASS\\nJUDGE_PASS' }]), { claimed: true, result: true, failed: false, reviewPass: true, judgePass: true });\n\n"
extra = anchor + """const retryComments = [
  { body: 'TIGERIQ_JOB_CLAIMED', created_at: '2026-08-30T10:00:00Z' },
  { body: 'TIGERIQ_JOB_FAILED reason', created_at: '2026-08-30T10:05:00Z' },
  { body: 'TIGERIQ_JOB_CLAIMED', created_at: '2026-08-30T10:10:00Z' },
];
assert.equal(issueStage({ state: 'open' }, retryComments), 'claimed');
assert.equal(latestLifecycleStage(retryComments), 'claimed');
assert.equal(issueEvidenceSummary(retryComments).failed, true);
assert.equal(issueEvidenceSummary(retryComments).claimed, true);

const recoveredComments = [
  { body: 'TIGERIQ_JOB_FAILED reason', created_at: '2026-08-30T10:05:00Z' },
  { body: 'TIGERIQ_JOB_RESULT PASS', created_at: '2026-08-30T10:15:00Z' },
];
assert.equal(issueStage({ state: 'open' }, recoveredComments), 'completed');

const reverseOrdered = [
  { body: 'TIGERIQ_JOB_CLAIMED', created_at: '2026-08-30T11:00:00Z' },
  { body: 'TIGERIQ_JOB_FAILED reason', created_at: '2026-08-30T10:00:00Z' },
];
assert.equal(issueStage({ state: 'open' }, reverseOrdered), 'claimed');
assert.equal(lifecycleEvents(reverseOrdered).at(-1).stage, 'claimed');

const proseOnly = [
  { body: 'Recovery note: previous TIGERIQ_JOB_FAILED marker was disproven.' },
  { body: '`TIGERIQ_JOB_CLAIMED` is the marker name, not a claim.' },
];
assert.equal(issueStage({ state: 'open' }, proseOnly), 'queued');
assert.deepEqual(issueEvidenceSummary(proseOnly), { claimed: false, result: false, failed: false, reviewPass: false, judgePass: false });

assert.equal(issueStage({ state: 'closed', state_reason: 'not_planned' }, retryComments), 'cancelled');
assert.equal(issueStage({ state: 'closed' }, [{ body: 'TIGERIQ_JOB_FAILED reason' }]), 'completed');

"""
verify = replace_once(verify, anchor, extra, 'retry lifecycle tests')
verify_path.write_text(verify, encoding='utf-8')

print('WO018_PATCH_APPLIED')
