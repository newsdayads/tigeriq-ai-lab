import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {codingChatContent,codingChatRequestBody,isNemotron3Super} from '../apps/shared/nvidia-coding-request.mjs';

test('NV20 Nemotron 3 Super turns default reasoning off to preserve 2.2k JSON budget',()=>{
  assert.equal(isNemotron3Super('nvidia/nemotron-3-super-120b-a12b'),true);
  const p=codingChatRequestBody({model:'nvidia/nemotron-3-super-120b-a12b',prompt:'Return ONLY JSON',maxTokens:2200});
  assert.deepEqual(p.messages,[{role:'user',content:'Return ONLY JSON'}]);
  assert.equal(p.temperature,1);
  assert.equal(p.top_p,0.95);
  assert.equal(p.max_tokens,2200);
  assert.equal(p.reasoning_effort,'none');
  assert.deepEqual(p.chat_template_kwargs,{enable_thinking:false,force_nonempty_content:true});
  assert.equal(p.stream,false);
});

test('non-Nemotron and non-NVIDIA chat requests retain previous payload unchanged',()=>{
  const p=codingChatRequestBody({model:'mistral-small-latest',prompt:'hello',maxTokens:2600});
  assert.deepEqual(p,{model:'mistral-small-latest',messages:[{role:'user',content:'hello'}],temperature:0,max_tokens:2600,stream:false});
  const q=codingChatRequestBody({model:'nvidia/other-model',prompt:'hello',maxTokens:2200});
  assert.equal(q.temperature,0);
  assert.equal(Object.hasOwn(q,'reasoning_effort'),false);
  assert.equal(Object.hasOwn(q,'chat_template_kwargs'),false);
});

test('empty responses are retryable invalid responses; NEVER treat hidden reasoning as accepted JSON',()=>{
  assert.equal(codingChatContent({choices:[{message:{content:'{"status":"continue"}'},finish_reason:'stop'}]}),'{"status":"continue"}');
  for(const data of [
    {choices:[{message:{content:'',reasoning_content:'I am still thinking'},finish_reason:'length'}]},
    {choices:[{message:{content:null,reasoning_content:'private reasoning'},finish_reason:'length'}]},
    {choices:[]},
    {},
  ])assert.throws(()=>codingChatContent(data),err=>err.code==='EMPTY_RESPONSE'&&err.message==='EMPTY_RESPONSE');
  let err;
  try{codingChatContent({choices:[{message:{content:'',reasoning_content:'private'},finish_reason:'length'}]})}catch(e){err=e}
  assert.deepEqual(err.detail,{finishReason:'length',responseHadReasoning:true,hasChoices:true});
});

test('rejects invalid model/token budget before network request and never incorporates auth material',()=>{
  for(const maxTokens of [0,-2,32769,3.4,NaN])assert.throws(()=>codingChatRequestBody({model:'nvidia/nemotron-3-super-120b-a12b',maxTokens}),/CODING_CHAT_TOKEN_BUDGET_INVALID/);
  assert.throws(()=>codingChatRequestBody({model:'',maxTokens:2200}),/CODING_CHAT_MODEL_REQUIRED/);
  assert.equal(JSON.stringify(codingChatRequestBody({model:'nvidia/nemotron-3-super-120b-a12b',prompt:'ok',maxTokens:2600})).includes('api_key'),false);
});

test('Coding Lane uses provider-specific builder only on NVIDIA branch without changing other provider dispatch',()=>{
  const src=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(src,/if\(r\.provider==='nvidia'\)return openAi\([^\n]+codingChatRequestBody\(\{model:r\.model,prompt,maxTokens:outputTokens\}\)/);
  assert.match(src,/if\(r\.provider==='mistral'\)return openAi\(/);
  assert.match(src,/if\(r\.provider==='ollama'\)return invokeOllamaChat\(/);
  assert.match(src,/if\(r\.provider==='cohere'\)/);
});
