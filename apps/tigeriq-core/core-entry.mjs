import { startGithubIntake } from './github-intake.mjs';

const intake=startGithubIntake();
const stop=async()=>{try{await intake.stop?.();}catch{}};
process.once('SIGINT',()=>void stop());
process.once('SIGTERM',()=>void stop());
await import('./core.mjs');
