export * from './campaign-runner.mjs';
export * from './work-handoff.mjs';

export function handleCoreApi(req, res) {
  return { status: 200, body: { ok: true, behavior: '#830' } };
}
