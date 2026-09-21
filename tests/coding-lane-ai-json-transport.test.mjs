import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {compactCurrentFilesForModel,compactPromptForChanges,compactPromptForEdits,currentFilesFromPrompt,expandCompactChanges,extractModelText,isAiUrl,looksLikeJsonObject,matchesExpectedSchema,prepareAiJsonRequest,installAiJsonTransport,salvageTruncatedCompactEdits} from '../apps/tigeriq-coding-lane/ai-json-transport.mjs';
import {buildRepairGenerationPrompt,managerBlockKind} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
import {isRetryableAiError} from '../apps/tigeriq-coding-lane/policy.mjs';

describe('coding lane AI JSON transport',()=>{
  it('routes same-PR CI repair through the compact changes transport',()=>{
    const prompt=buildRepairGenerationPrompt({id:'NV17'},{instruction:'fix CI',paths:['tests/a.test.mjs']},'FILE tests/a.test.mjs\nconst x=1;',['CI Verify: failure']);
    expect(prompt).toContain('REVIEW ISSUES TO FIX');
    expect(prompt).toContain('"changes":[{"path"');
    expect(compactPromptForChanges(prompt)).toContain('"edits":[{"path"');
    expect(compactPromptForChanges(prompt)).toContain('CURRENT FILES:');
  });

  it('forces JSON mode for Gemini',()=>{
    const init=prepareAiJsonRequest('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',{method:'POST',body:JSON.stringify({generationConfig:{temperature:0}})});
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe('application/json');
  });
  it('forces JSON object mode for Groq',()=>{
    const init=prepareAiJsonRequest('https://api.groq.com/openai/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'x'})});
    expect(JSON.parse(init.body).response_format).toEqual({type:'json_object'});
  });
  it('supports NVIDIA OpenAI-compatible JSON mode',()=>{
    const init=prepareAiJsonRequest('https://integrate.api.nvidia.com/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'x'})});
    expect(isAiUrl('https://integrate.api.nvidia.com/v1/chat/completions')).toBe(true);
    expect(JSON.parse(init.body).response_format).toEqual({type:'json_object'});
    expect(extractModelText('https://integrate.api.nvidia.com/v1/chat/completions',{choices:[{message:{content:'{"ok":true}'}}]})).toBe('{"ok":true}');
  });
  it('supports Cloudflare Workers AI prompt and response shape',()=>{
    expect(isAiUrl('https://api.cloudflare.com/client/v4/accounts/a/ai/run/@cf/meta/llama')).toBe(true);
    expect(extractModelText('https://api.cloudflare.com/client/v4/accounts/a/ai/run/@cf/meta/llama',{result:{response:'{"ok":true}'}})).toBe('{"ok":true}');
  });
  it('salvages complete compact edits from a truncated JSON tail',()=>{
    const truncated='{"summary":"partial","edits":[{"path":"apps/a.mjs","search":"const n=1;","replace":"const n=2;"},{"path":"apps/a.mjs","search":"console.log(n);","replace":"console.log(';
    expect(salvageTruncatedCompactEdits(truncated)).toEqual({summary:'partial',edits:[{path:'apps/a.mjs',search:'const n=1;',replace:'const n=2;'}]});
    const prompt='TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\nconst n=1;\nconsole.log(n);\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.';
    expect(expandCompactChanges(prompt,truncated).changes).toEqual([{path:'apps/a.mjs',content:'const n=2;\nconsole.log(n);'}]);
  });

  it('does not salvage a truncated compact payload without any complete edit',()=>{
    const truncated='{"summary":"partial","edits":[{"path":"apps/a.mjs","search":"const n=1;","replace":"const n=2;';
    expect(salvageTruncatedCompactEdits(truncated)).toBe(null);
  });

  it('detects valid versus malformed model JSON',()=>{
    expect(looksLikeJsonObject('\n{"ok":true}\n')).toBe(true);
    expect(looksLikeJsonObject('{bad json}')).toBe(false);
  });
  it('rejects schema-invalid review JSON so transport retries',()=>{
    const prompt='Return ONLY JSON {"decision":"approve|changes_requested","summary":"short","issues":["specific issue"]}.';
    expect(matchesExpectedSchema(prompt,'{"decision":"maybe","summary":"x","issues":[]}')).toBe(false);
    expect(matchesExpectedSchema(prompt,'{"decision":"approve","summary":"x","issues":[]}')).toBe(true);
  });
  it('rejects schema-invalid manager and change payloads',()=>{
    const manager='Return ONLY JSON {"status":"continue|blocked","summary":"short","job":{"title":"short","instruction":"standalone implementation instruction","paths":["exact/repo/path"]}}.';
    const changes='Return ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.';
    expect(matchesExpectedSchema(manager,'{"status":"continue","summary":"x"}')).toBe(false);
    expect(matchesExpectedSchema(changes,'{"summary":"x","changes":[]}')).toBe(false);
  });
  it('extracts provider model text and ignores non AI URLs',()=>{
    expect(isAiUrl('https://api.groq.com/openai/v1/chat/completions')).toBe(true);
    expect(isAiUrl('https://api.github.com/repos/a/b')).toBe(false);
    expect(isAiUrl('not-a-url')).toBe(false);
    expect(extractModelText('https://api.groq.com/openai/v1/chat/completions',{choices:[{message:{content:'{"ok":true}'}}]})).toBe('{"ok":true}');
  });
  it('limits model-visible current files while retaining head and tail excerpts',()=>{
    const body='HEAD'.repeat(30000)+'TAIL';
    const prompt=`TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\n${body}\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.`;
    const compact=compactCurrentFilesForModel(prompt,12000);
    expect(compact.length).toBeLessThan(prompt.length);
    expect(compact).toContain('HEAD');
    expect(compact).toContain('TAIL');
    expect(compact).toContain('full file retained locally');
    expect(currentFilesFromPrompt(prompt).get('apps/a.mjs')).toBe(body);
  });  it('recognizes and compacts repair-edit prompts separately from generation',()=>{
    const large='x'.repeat(30000);
    const prompt=`TASK: fix\nCURRENT FILES:\nFILE apps/a.mjs\nconst n=1;\n${large}\nReturn ONLY compact JSON {"summary":"short","edits":[{"path":"exact allowed path","old":"exact UNIQUE existing snippet","new":"replacement snippet"}]}. Never return a complete file.`;
    expect(matchesExpectedSchema(prompt,JSON.stringify({summary:'ok',edits:[{path:'apps/a.mjs',old:'const n=1;',new:'const n=2;'}]}))).toBe(true);
    expect(matchesExpectedSchema(prompt,JSON.stringify({summary:'bad',edits:[]}))).toBe(false);
    const compact=compactPromptForEdits(prompt,{maxContextChars:5000,maxOutputChars:2400});
    expect(compact.length).toBeLessThan(prompt.length);
    expect(compact).toContain('REPAIR PATCH LIMITS');
    expect(compact).toContain('under 2400 characters');
    expect(compact).toContain('full file retained locally');
  });
  it('rewrites large-file generation to compact edits',()=>{
    const prompt='TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\nconst n=1;\n\n---\n\nFILE tests/new.test.mjs\n\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}. Do not touch paths outside ALLOWED PATHS. Never output secrets. Keep changes minimal and testable.';
    const compact=compactPromptForChanges(prompt);
    expect(compact).toContain('"edits"');
    expect(compact).toContain('Do not return full existing files');
    expect(currentFilesFromPrompt(prompt).get('apps/a.mjs')).toBe('const n=1;');
  });
  it('expands compact edits into complete replacement changes locally',()=>{
    const prompt='TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\nconst n=1;\nconsole.log(n);\n\n---\n\nFILE tests/new.test.mjs\n\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}. Do not touch paths outside ALLOWED PATHS. Never output secrets. Keep changes minimal and testable.';
    const model=JSON.stringify({summary:'small patch',edits:[
      {path:'apps/a.mjs',search:'const n=1;',replace:'const n=2;'},
      {path:'tests/new.test.mjs',content:'import {it} from \'vitest\';\n'},
    ]});
    const expanded=expandCompactChanges(prompt,model);
    expect(expanded.changes).toEqual([
      {path:'apps/a.mjs',content:'const n=2;\nconsole.log(n);'},
      {path:'tests/new.test.mjs',content:'import {it} from \'vitest\';\n'},
    ]);
    expect(matchesExpectedSchema(prompt,JSON.stringify(expanded))).toBe(true);
  });
  it('rejects model fallback to full-file replacement for an existing file',()=>{
    const prompt='TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\nconst n=1;\nconsole.log(n);\n\n---\n\nFILE tests/new.test.mjs\n\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.';
    const model=JSON.stringify({summary:'unsafe whole file',changes:[{path:'apps/a.mjs',content:'const n=2;'}]});
    expect(()=>expandCompactChanges(prompt,model)).toThrow('COMPACT_EDIT_FULL_CONTENT_FOR_EXISTING:apps/a.mjs');
  });

  it('still allows complete content for a new empty file',()=>{
    const prompt='TASK: x\nCURRENT FILES:\nFILE tests/new.test.mjs\n\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.';
    const model=JSON.stringify({summary:'new file',changes:[{path:'tests/new.test.mjs',content:'export const ok=true;\\n'}]});
    expect(expandCompactChanges(prompt,model).changes).toEqual([{path:'tests/new.test.mjs',content:'export const ok=true;\\n'}]);
  });

  it('rejects a destructive compact shrink of a large existing file',()=>{
    const content='BEGIN\n'+'x'.repeat(20000)+'\nEND';
    const prompt=`TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\n${content}\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.`;
    const model=JSON.stringify({summary:'bad shrink',edits:[{path:'apps/a.mjs',search:content,replace:'BEGIN\nEND'}]});
    expect(()=>expandCompactChanges(prompt,model)).toThrow('COMPACT_EDIT_DESTRUCTIVE_SHRINK:apps/a.mjs');
  });

  it('uses a smaller coding prompt on retry after malformed compact JSON',async()=>{
    const previousFetch=globalThis.fetch;
    const previousInstalled=globalThis.__tigeriqAiJsonTransportInstalled;
    let calls=0;
    const promptLengths=[];
    try{
      globalThis.__tigeriqAiJsonTransportInstalled=false;
      globalThis.fetch=async(_input,init)=>{
        calls++;
        const body=JSON.parse(String(init?.body||'{}'));
        promptLengths.push(String(body?.messages?.[0]?.content||'').length);
        const content=calls===1
          ?'{"summary":"truncated","edits":[{"path":"apps/a.mjs","search":"const n=1;","replace":"const n=2;'
          :JSON.stringify({summary:'small patch',edits:[{path:'apps/a.mjs',search:'const n=1;',replace:'const n=2;'}]});
        return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}});
      };
      installAiJsonTransport({maxAttempts:2,baseDelayMs:1,attemptTimeoutMs:1000});
      const large='x'.repeat(30000);
      const prompt=`TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\nconst n=1;\n${large}\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}. Do not touch paths outside ALLOWED PATHS. Never output secrets. Keep changes minimal and testable.`;
      const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:prompt}]})});
      const data=await res.json();
      expect(calls).toBe(2);
      expect(promptLengths[1]).toBeLessThan(promptLengths[0]);
      expect(promptLengths[0]).toBeLessThan(15000);
      expect(data.choices[0].message.content).toContain('"changes"');
      expect(data.choices[0].message.content).toContain('const n=2;');
    }finally{
      globalThis.fetch=previousFetch;
      if(previousInstalled===undefined) delete globalThis.__tigeriqAiJsonTransportInstalled;
      else globalThis.__tigeriqAiJsonTransportInstalled=previousInstalled;
    }
  });

  it('normalizes a truncated compact tail with one complete edit in one provider attempt',async()=>{
    const previousFetch=globalThis.fetch;
    const previousInstalled=globalThis.__tigeriqAiJsonTransportInstalled;
    let calls=0;
    try{
      globalThis.__tigeriqAiJsonTransportInstalled=false;
      globalThis.fetch=async()=>{
        calls++;
        const content='{"summary":"partial","edits":[{"path":"apps/a.mjs","search":"const n=1;","replace":"const n=2;"},{"path":"apps/a.mjs","search":"console.log(n);","replace":"console.log(';
        return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}});
      };
      installAiJsonTransport({maxAttempts:1,attemptTimeoutMs:1000});
      const prompt='TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\nconst n=1;\nconsole.log(n);\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}. Do not touch paths outside ALLOWED PATHS. Never output secrets. Keep changes minimal and testable.';
      const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:prompt}]})});
      const data=await res.json();
      expect(calls).toBe(1);
      const normalized=JSON.parse(data.choices[0].message.content);
      expect(normalized.changes).toEqual([{path:'apps/a.mjs',content:'const n=2;\nconsole.log(n);'}]);
    }finally{
      globalThis.fetch=previousFetch;
      if(previousInstalled===undefined) delete globalThis.__tigeriqAiJsonTransportInstalled;
      else globalThis.__tigeriqAiJsonTransportInstalled=previousInstalled;
    }
  });

  it('always installs a bounded timeout signal even when caller provides none',async()=>{
    const previousFetch=globalThis.fetch;
    const previousInstalled=globalThis.__tigeriqAiJsonTransportInstalled;
    const seen=[];
    try{
      globalThis.__tigeriqAiJsonTransportInstalled=false;
      globalThis.fetch=async(_input,init)=>{
        seen.push(Boolean(init?.signal));
        return new Response(JSON.stringify({choices:[{message:{content:'{"status":"blocked","summary":"ok"}'}}]}),{status:200,headers:{'content-type':'application/json'}});
      };
      installAiJsonTransport({maxAttempts:1,attemptTimeoutMs:25});
      await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'Return ONLY JSON {"status":"continue|blocked","summary":"short","job":{"title":"short","instruction":"standalone implementation instruction","paths":["exact/repo/path"]}}.'}]})});
      expect(seen).toEqual([true]);
    }finally{
      globalThis.fetch=previousFetch;
      if(previousInstalled===undefined) delete globalThis.__tigeriqAiJsonTransportInstalled;
      else globalThis.__tigeriqAiJsonTransportInstalled=previousInstalled;
    }
  });

  it('retries transient AI fetch aborts before failing the job',async()=>{
    const previousFetch=globalThis.fetch;
    const previousInstalled=globalThis.__tigeriqAiJsonTransportInstalled;
    let calls=0;
    const signals=[];
    try{
      globalThis.__tigeriqAiJsonTransportInstalled=false;
      globalThis.fetch=async(_input,init)=>{
        calls++;
        signals.push(Boolean(init?.signal?.aborted));
        if(calls===1) throw new DOMException('This operation was aborted','AbortError');
        return new Response(JSON.stringify({choices:[{message:{content:'{"status":"blocked","summary":"ok"}'}}]}),{status:200,headers:{'content-type':'application/json'}});
      };
      installAiJsonTransport({maxAttempts:2,baseDelayMs:1,attemptTimeoutMs:1000});
      const prompt='Return ONLY JSON {"status":"continue|blocked","summary":"short","job":{"title":"short","instruction":"standalone implementation instruction","paths":["exact/repo/path"]}}.';
      const stale=new AbortController(); stale.abort();
      const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',signal:stale.signal,body:JSON.stringify({messages:[{role:'user',content:prompt}]})});
      expect(res.ok).toBe(true);
      expect(calls).toBe(2);
      expect(signals).toEqual([false,false]);
    }finally{
      globalThis.fetch=previousFetch;
      if(previousInstalled===undefined) delete globalThis.__tigeriqAiJsonTransportInstalled;
      else globalThis.__tigeriqAiJsonTransportInstalled=previousInstalled;
    }
  });  it('rejects ambiguous compact search instead of corrupting a file',()=>{
    const prompt='CURRENT FILES:\nFILE apps/a.mjs\nfoo();\nfoo();\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.';
    const model=JSON.stringify({summary:'x',edits:[{path:'apps/a.mjs',search:'foo();',replace:'bar();'}]});
    expect(()=>expandCompactChanges(prompt,model)).toThrow('COMPACT_EDIT_SEARCH_AMBIGUOUS');
  });
  it('runtime wires compact transport before manager loop',()=>{
    const src=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
    expect(src).toContain("import {installAiJsonTransport} from './ai-json-transport.mjs';");
    const install=src.indexOf('installAiJsonTransport({maxAttempts:1');
    const manager=src.indexOf('await managerTick()');
    expect(install).toBeGreaterThanOrEqual(0);
    expect(manager).toBeGreaterThan(install);
  });

  it('manager soft blocker classification fails over instead of terminal blocking',()=>{
    expect(managerBlockKind('reason for blocking')).toBe('soft');
    expect(managerBlockKind('cannot confirm dependency')).toBe('soft');
    expect(managerBlockKind('SECURITY policy block requires authorization')).toBe('hard');
    expect(managerBlockKind('credential change required')).toBe('hard');
    expect(isRetryableAiError(new Error('MANAGER_SOFT_BLOCK:reason for blocking'))).toBe(true);
  });

});
