import {installAiJsonTransport} from './ai-json-transport.mjs';

const paidAllowed=String(process.env.TIGERIQ_ALLOW_PAID_AI||'false').toLowerCase()==='true';
if(!paidAllowed){
  if(process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED!=='true') delete process.env.GROQ_API_KEY;
  if(process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED!=='true') delete process.env.GEMINI_API_KEY;
  if(process.env.TIGERIQ_COHERE_TRIAL_CONFIRMED!=='true') delete process.env.COHERE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.HF_TOKEN;
}
installAiJsonTransport({maxAttempts:3});
await import('./coding-lane.mjs');
