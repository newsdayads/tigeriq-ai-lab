import {describe,expect,it} from 'vitest';
import {compactCurrentFilesForModel,compactPromptForChanges,currentFilesFromPrompt,expandCompactChanges,extractModelText,isAiUrl,looksLikeJsonObject,matchesExpectedSchema,prepareAiJsonRequest,installAiJsonTransport} from '../apps/tigeriq-coding-lane/ai-json-transport.mjs';

describe('coding lane AI JSON transport',()=>{
  it('forces JSON mode for Gemini',()=>{
    const init=prepareAiJsonRequest('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',{method:'POST',body:JSON.stringify({generationConfig:{temperature:0}})});
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe('application/json');
  });
  it('forces JSON object mode for Groq',()=>{
    const init=prepareAiJsonRequest('https://api.groq.com/openai/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'x'})});
    expect(JSON.parse(init.body).response_format).toEqual({type:'json_object'});
  });
  it('detects valid versus malformed model JSON',()=>{
    expect(looksLikeJsonObject('```json\n{"ok":true}\n```')).toBe(true);
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
    expect(extractModelText('https://api.groq.com/openai/v1/chat/completions',{choices:[{message:{content:'{"ok":true}'}}]})).toBe('{"ok":true}');
  });
  it('limits model-visible current files while retaining head and tail excerpts',()=>{
    const body='HEAD'+'.'.repeat(30000)+'TAIL';
    const prompt=`TASK: x\nCURRENT FILES:\nFILE apps/a.mjs\n${body}\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.`;
    const compact=compactCurrentFilesForModel(prompt,12000);
    expect(compact.length).toBeLessThan(prompt.length);
    expect(compact).toContain('HEAD');
    expect(compact).toContain('TAIL');
    expect(compact).toContain('full file retained locally');
    expect(currentFilesFromPrompt(prompt).get('apps/a.mjs')).toContain('.'.repeat(30000));
  });  it('rewrites large-file generation to compact edits',()=>{
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
});

