import { executeCloudTask, reviewCloudTask, judgeCloudTask } from './cloud-workforce.mjs';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' || process.env.VERCEL_ENV !== 'preview' || String(req.query?.key || '') !== 'p0-20260901-7f91a2') {
    return send(res, 404, { error: 'not_found' });
  }
  try {
    const instruction = 'Compute 6 * 7 and return only the numeric result as the task result. This is a bounded reasoning-only task with no external action.';
    const expectedEvidence = 'Executor returns 42; independent reviewer passes; judge passes.';
    const execution = await executeCloudTask({ instruction, expectedEvidence });
    if (execution.status !== 'completed') return send(res, 502, { ok: false, stage: 'executor', blocker: execution.blocker || 'executor_blocked' });
    const review = await reviewCloudTask({ instruction, expectedEvidence, result: execution.result, evidenceSummary: execution.evidenceSummary });
    if (!review.pass) return send(res, 502, { ok: false, stage: 'reviewer', reviewerModel: review.modelUsed });
    const judge = await judgeCloudTask({ instruction, expectedEvidence, result: execution.result, evidenceSummary: execution.evidenceSummary, review });
    if (!judge.pass) return send(res, 502, { ok: false, stage: 'judge', judgeModel: judge.modelUsed });
    return send(res, 200, {
      ok: true,
      result: execution.result,
      executorModel: execution.modelUsed,
      reviewerModel: review.modelUsed,
      judgeModel: judge.modelUsed,
      pc01Required: false,
    });
  } catch (error) {
    return send(res, Number(error?.status) || 502, {
      ok: false,
      stage: 'error',
      error: String(error?.message || error).slice(0, 120),
      details: String(error?.details || '').slice(0, 400),
    });
  }
}