import { startGithubIntake } from './github-intake.mjs';
import { RotatingIdleAuditor } from './core.mjs';
import { startGithubCodingIntake } from './github-coding-intake.mjs';
import { installOllamaProbeAdapter } from './ollama-probe-adapter.mjs';

const restoreFetch=installOllamaProbeAdapter();
const intake=startGithubIntake();
const codingIntake=startGithubCodingIntake();
const stop=async()=>{try{await intake.stop?.();}catch{}try{await codingIntake.stop?.();}catch{}try{restoreFetch?.();}catch{}};
process.once('SIGINT',()=>void stop());
process.once('SIGTERM',()=>void stop());
await import('./core.mjs');
const realEventBus = { emit: async (type, data) => { try { await event(type, data); } catch {} } };
const auditor = new RotatingIdleAuditor(realEventBus);
if (process.env.NODE_ENV !== 'test') {
  auditor.start();
}
