import {describe,expect,it} from 'vitest';
import {extractModelText,isAiUrl,looksLikeJsonObject,prepareAiJsonRequest} from '../apps/tigeriq-coding-lane/ai-json-transport.mjs';

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
  it('extracts provider model text and ignores non AI URLs',()=>{
    expect(isAiUrl('https://api.groq.com/openai/v1/chat/completions')).toBe(true);
    expect(isAiUrl('https://api.github.com/repos/a/b')).toBe(false);
    expect(extractModelText('https://api.groq.com/openai/v1/chat/completions',{choices:[{message:{content:'{"ok":true}'}}]})).toBe('{"ok":true}');
  });
});
