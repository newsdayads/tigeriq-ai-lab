/** GH-5284: real downloadable field-test HTML, not Android/S10 hardware QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {LEVELS} from '../dist/engine/levels.js';
import {enumerateSolutions,replaceExactlyOne,simulate} from '../dist/engine/robot.js';

const path=new URL('../preview/robot-oops-g06-field-test.html',import.meta.url);
const labels={MOVE:'Đi tới',TURN_LEFT:'Quay trái',TURN_RIGHT:'Quay phải',
  PICK:'Nhặt',DROP:'Đặt',PRESS:'Nhấn',WAIT:'Đợi'};

async function openFieldPreview(){
  const html=await readFile(path,'utf8');
  const script=/<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script,'ONE_INLINE_SCRIPT_REQUIRED');
  const dom=new Map();
  const make=()=>({
    children:[],hidden:false,disabled:false,textContent:'',className:'',onclick:null,
    classList:{toggle(){}},
    appendChild(node){this.children.push(node);return node},
    replaceChildren(){this.children=[]}
  });
  const document={getElementById(id){if(!dom.has(id))dom.set(id,make());return dom.get(id)},
    createElement(){return make()}};
  const window={};
  const writes=[];
  const localStorage={getItem(){return null},setItem(k,v){writes.push({k,v})}};
  runInNewContext(script,{window,document,localStorage,console,Math,JSON});
  return {html,window,get:id=>document.getElementById(id),writes};
}
test('published candidate uses exact canonical five-level puzzle data, not duplicate approximations',async()=>{
  const {window}=await openFieldPreview();
  assert.equal(JSON.stringify(window.TigerIQGame.LEVELS),JSON.stringify(LEVELS));
  for(const level of window.TigerIQGame.LEVELS){
    assert.equal(window.TigerIQGame.simulate(level,level.originalCommands).win,false,level.id);
    const answer=enumerateSolutions(LEVELS.find(x=>x.id===level.id));
    assert.ok(answer.length>0,level.id);
    const cmd=replaceExactlyOne(level,answer[0]);
    assert.equal(window.TigerIQGame.simulate(level,cmd).win,true,level.id);
    assert.equal(simulate(level,cmd).win,true,level.id);
  }
});
test('downloadable candidate completes five real UI button paths and persists 5/5',async()=>{
  const {get,writes}=await openFieldPreview();
  const press=b=>{assert.equal(typeof b?.onclick,'function');b.onclick()};
  for(let i=0;i<LEVELS.length;i++){
    if(i===0)press(get('levels').children[i]);
    const level=LEVELS[i];
    const answer=enumerateSolutions(level)[0].replacement;
    press(get('commands').children[level.editableSlot]);
    const button=get('choices').children.find(b=>b.textContent===labels[answer]);
    assert.ok(button,level.id);
    press(button);
    assert.equal(get('run').disabled,false);
    press(get('run'));
    assert.equal(get('result').hidden,false);
    assert.match(get('resultTitle').textContent,/ĐÃ GIÚP ROBOT/);
    press(get('next'));
  }
  assert.equal(get('select').hidden,false);
  assert.match(get('progress').textContent,/5\/5/);
  assert.ok(writes.length===5);
});
test('wrong edit visibly fails and retry does not reuse the previous answer',async()=>{
  const {get}=await openFieldPreview();
  get('levels').children[0].onclick();
  get('commands').children[LEVELS[0].editableSlot].onclick();
  get('choices').children.find(b=>b.textContent===labels.WAIT).onclick();
  get('run').onclick();
  assert.match(get('resultTitle').textContent,/CHƯA THÀNH CÔNG/);
  assert.equal(get('next').hidden,true);
  get('again').onclick();
  assert.equal(get('play').hidden,false);
  assert.equal(get('run').disabled,true);
});
test('published candidate is self-contained and makes no external network calls',async()=>{
  const {html}=await openFieldPreview();
  assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+href=|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/i);
  assert.match(html,/<meta name="viewport"/);
  assert.match(html,/Robot Oops!/);
});
