import { startGithubIntake } from './github-intake.mjs';
import { startGithubCodingIntake } from './github-coding-intake.mjs';
import { installOllamaProbeAdapter } from './ollama-probe-adapter.mjs';
import { startUiAutopilotSnapshotServer } from './ui-autopilot-snapshot.mjs';

const restoreFetch=installOllamaProbeAdapter();
const intake=startGithubIntake();
const codingIntake=startGithubCodingIntake();
const uiAutopilot=startUiAutopilotSnapshotServer();
const stop=async()=>{
  try{await intake.stop?.();}catch{}
  try{await codingIntake.stop?.();}catch{}
  try{await uiAutopilot.stop?.();}catch{}
  try{restoreFetch?.();}catch{}
};
process.once('SIGINT',()=>void stop());
process.once('SIGTERM',()=>void stop());
await import('./core.mjs');
