import { startGithubIntake } from './github-intake.mjs';
import { startGithubCodingIntake } from './github-coding-intake.mjs';
import { installOllamaProbeAdapter } from './ollama-probe-adapter.mjs';
import { startUiAutopilotSnapshotServer } from './ui-autopilot-snapshot.mjs';
import { registerGithubWake } from './github-event-bus.mjs';

const restoreFetch=installOllamaProbeAdapter();
const intake=startGithubIntake();
const codingIntake=startGithubCodingIntake();
const uiAutopilot=startUiAutopilotSnapshotServer();
const unregisterGithubIntake=registerGithubWake(()=>intake.wake?.());
const unregisterGithubCoding=registerGithubWake(()=>codingIntake.wake?.());
const stop=async()=>{
  try{await intake.stop?.();}catch{}
  try{await codingIntake.stop?.();}catch{}
  try{unregisterGithubIntake?.();}catch{}
  try{unregisterGithubCoding?.();}catch{}
  try{await uiAutopilot.stop?.();}catch{}
  try{restoreFetch?.();}catch{}
};
process.once('SIGINT',()=>void stop());
process.once('SIGTERM',()=>void stop());
await import('./core.mjs');
