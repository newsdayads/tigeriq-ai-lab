export const WORKER_HOSTS = { NV02:'chatgpt.com', NV03:'chatgpt.com', NV04:'gemini.google.com' };
export const WORKER_HINTS = {
  NV02:['/g/g-p-6a925c470aa08191a10595e215d04f4e-tigeriq-ai-lab'],
  NV03:['/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab'],
  NV04:['/notebook/c3a7911e-5a73-41c6-b7db-2e3b17d3983a','/app/']
};

export function hostname(value) { try { return new URL(value).hostname; } catch { return ''; } }
export function allowedUrl(value) { try { const u=new URL(value); return u.protocol==='https:' && new Set(Object.values(WORKER_HOSTS)).has(u.hostname); } catch { return false; } }
export function matchesWorker(workerId,value) {
  try {
    const u = new URL(value);
    const hints = WORKER_HINTS[workerId] || [];
    return u.hostname === WORKER_HOSTS[workerId] && hints.some((hint) => u.pathname.startsWith(hint) && (hint !== '/app/' || u.pathname.length > hint.length));
  } catch { return false; }
}
