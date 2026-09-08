const key=process.env.GEMINI_API_KEY;
if(!key)throw new Error('GEMINI_API_KEY_MISSING');
const model=process.env.TIGERIQ_GEMINI_PROBE_MODEL||'gemini-3.5-flash-lite';
const marker=`TIGERIQ_FREE_MODEL_OK_${Date.now()}`;
const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
  method:'POST',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json','x-goog-api-key':key},
  body:JSON.stringify({contents:[{role:'user',parts:[{text:`Return exactly ${marker}`}]}],generationConfig:{maxOutputTokens:128}}),
});
if(!response.ok){const body=await response.text();throw new Error(`GEMINI_MODEL_HTTP_${response.status}:${body.slice(0,800)}`);}
const body=await response.json();
const text=(body.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('\n');
if(!text.includes(marker))throw new Error('GEMINI_MODEL_MARKER_MISSING');
console.log(JSON.stringify({test:'GEMINI_FREE_MODEL_LIVE_PASS',model,markerMatched:true},null,2));