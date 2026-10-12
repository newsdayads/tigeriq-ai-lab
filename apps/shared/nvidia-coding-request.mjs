// GH-280 / NV20: NVIDIA Nemotron 3 Super emits reasoning by default. Coding
// jobs expect a concise JSON content answer, not a hidden reasoning trace.
// Pure provider request builder: no tokens, credentials, network, or runtime mutation.
// Grounding: https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer
export function isNemotron3Super(model=''){
  return /^nvidia\/nemotron-3-super(?:-120b-a12b)?$/i.test(String(model||'').trim());
}
export function codingChatRequestBody({model,prompt,maxTokens=2200}={}){
  const id=String(model||'').trim();
  if(!id)throw new Error('CODING_CHAT_MODEL_REQUIRED');
  const max=Number(maxTokens);
  if(!Number.isInteger(max)||max<1||max>32768)throw new Error('CODING_CHAT_TOKEN_BUDGET_INVALID');
  const body={
    model:id,
    messages:[{role:'user',content:String(prompt??'')}],
    temperature:0,
    max_tokens:max,
    stream:false,
  };
  if(isNemotron3Super(id)){
    // Provider docs: reasoning_effort='none' disables default thinking,
    // which otherwise can exhaust the tight JSON coding completion budget
    // before message.content is emitted. Do not change other providers/models.
    body.temperature=1;
    body.top_p=0.95;
    body.reasoning_effort='none';
    body.chat_template_kwargs={enable_thinking:false,force_nonempty_content:true};
  }
  return body;
}
export function codingChatContent(response){
  const choice=response?.choices?.[0];
  const content=choice?.message?.content;
  if(typeof content==='string'&&content.trim())return content;
  // Keep reasoning_content out of the JSON output contract. It may contain
  // only an internal rationale, never a valid completed coding task response.
  const e=new Error('EMPTY_RESPONSE');
  e.code='EMPTY_RESPONSE';
  e.detail={
    finishReason:String(choice?.finish_reason||'unknown').slice(0,40),
    responseHadReasoning:Boolean(choice?.message?.reasoning_content),
    hasChoices:Array.isArray(response?.choices)&&response.choices.length>0,
  };
  throw e;
}
