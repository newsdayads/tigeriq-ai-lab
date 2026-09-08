import path from 'node:path';
import { pathToFileURL } from 'node:url';
const distRoot=path.resolve(process.env.TIGERIQ_AI_DIST_ROOT||'dist');
const moduleUrl=pathToFileURL(path.join(distRoot,'packages','model-router','src','index.js')).href;
const { ModelRouter, createGeminiAdapter, createGroqAdapter }=await import(moduleUrl);
const marker=`TIGERIQ_ROUTER_GEMINI_OK_${Date.now()}`;
const router=new ModelRouter([
  createGeminiAdapter({model:'gemini-3.5-flash-lite',timeoutMs:30000,maxOutputTokens:128}),
  createGroqAdapter({model:'openai/gpt-oss-120b',timeoutMs:30000,maxCompletionTokens:128}),
],{primary:{provider:'gemini',model:'gemini-3.5-flash-lite'},fallbacks:[{provider:'groq',model:'openai/gpt-oss-120b'}]},{failureThreshold:1,cooldownMs:30000});
const result=await router.execute({prompt:`Return exactly ${marker}`});
const evidence={test:'GEMINI_ROUTER_LIVE',provider:result.target.provider,model:result.target.model,attempts:result.attempts.map(x=>({provider:x.target.provider,model:x.target.model,ok:x.ok,failureKind:x.failureKind,circuitOpen:x.circuitOpen})),markerMatched:result.text.includes(marker)};
console.log(JSON.stringify(evidence,null,2));
const expected=process.env.TIGERIQ_EXPECT_PROVIDER?.trim();
if(expected&&result.target.provider!==expected)throw new Error(`ROUTER_PROVIDER_UNEXPECTED:${result.target.provider}`);
if(result.target.provider==='gemini'&&!evidence.markerMatched)throw new Error('GEMINI_ROUTER_MARKER_MISSING');